"""
Decision Layer (Step 4C) — Decision Tracking System

Это L5 системы: система управления решениями (не просто analytics).

Архитектура:
- Recommendations: генерируются динамически (НЕ хранятся)
- Actions: source of truth, audit trail решений (хранятся)

Flow:
Signal → Recommendation (dynamic) → Action (stored) → Decision → Outcome

Recommendation (ephemeral):
{
  id: f"{project_id}:{type}",
  project_id: str,
  type: 'increase_price' | 'reduce_revision' | 'reassign' | 'scope_control',
  reason: str,
  confidence: float,
  expected_impact: float,
  priority: 'critical' | 'high' | 'medium',
  drivers: [{factor, value, impact}],
  metrics: {margin_percent, revision_share, etc}
}

Action (persistent, source of truth):
{
  action_id: uuid,
  project_id: str,
  recommendation_id: str,  # "{project_id}:{type}"
  type: str,
  status: 'pending' | 'accepted' | 'rejected',
  decided_by: str,
  decided_at: datetime,
  note: str,
  created_at: datetime,
  outcome: {
    status: 'pending' | 'measured',
    impact_realized: float,  # actual $ saved/earned
    measured_at: datetime
  }
}
"""

import uuid
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)


# ============ COLLECTIONS INIT ============

async def init_decision_collections(db):
    """Initialize actions collection with UNIQUE index on (project_id, type)"""
    
    actions_collection = db['actions']
    
    # Create indexes for actions
    await actions_collection.create_index('action_id', unique=True)
    await actions_collection.create_index('project_id')
    await actions_collection.create_index('type')
    await actions_collection.create_index('status')
    await actions_collection.create_index('decided_by')
    await actions_collection.create_index('created_at')
    
    # CRITICAL: UNIQUE constraint on (project_id, type)
    await actions_collection.create_index(
        [('project_id', 1), ('type', 1)],
        unique=True
    )
    
    logger.info("✅ Actions collection initialized with 7 indexes (including UNIQUE on project_id+type)")
    
    return {'actions': actions_collection}


# ============ DETECTION ENGINES (Dynamic Recommendations) ============

async def detect_underpriced_projects(db) -> List[Dict[str, Any]]:
    """
    Обнаруживает недооценённые проекты (revenue < dev_cost).
    
    Returns динамически сгенерированные recommendations (НЕ сохраняет в БД).
    """
    projects_collection = db['projects']
    task_earnings_collection = db['task_earnings']
    
    recommendations = []
    
    # Получить все проекты
    projects = await projects_collection.find({}).to_list(length=None)
    
    for project in projects:
        project_id = project.get('project_id')
        project_name = project.get('project_title', 'Unknown Project')
        revenue_total = project.get('revenue_total', 0)
        
        # Посчитать dev_cost для проекта
        pipeline = [
            {'$match': {'project_id': project_id}},
            {'$group': {
                '_id': None,
                'total_cost': {'$sum': '$final_earning'},
                'revision_cost': {'$sum': '$revision_impact.revision_cost'}
            }}
        ]
        
        result = await task_earnings_collection.aggregate(pipeline).to_list(length=1)
        
        if not result:
            continue
            
        total_cost = result[0].get('total_cost', 0)
        revision_cost = result[0].get('revision_cost', 0)
        
        # Обнаружение: revenue < total_cost (убыток)
        if total_cost > 0 and revenue_total < total_cost:
            loss_amount = total_cost - revenue_total
            margin_percent = ((revenue_total - total_cost) / total_cost * 100) if total_cost > 0 else 0
            
            # Определить priority
            if abs(margin_percent) >= 50:
                priority = 'critical'
            elif abs(margin_percent) >= 25:
                priority = 'high'
            else:
                priority = 'medium'
            
            # Drivers (причины)
            drivers = [
                {
                    'factor': 'total_dev_cost',
                    'value': f'${total_cost:,.0f}',
                    'impact': 'high'
                },
                {
                    'factor': 'project_revenue',
                    'value': f'${revenue_total:,.0f}',
                    'impact': 'high'
                },
                {
                    'factor': 'revenue_deficit',
                    'value': f'-${loss_amount:,.0f}',
                    'impact': 'critical'
                }
            ]
            
            if revision_cost > 0:
                drivers.append({
                    'factor': 'revision_cost',
                    'value': f'${revision_cost:,.0f}',
                    'impact': 'medium'
                })
            
            # Metrics (числа для принятия решений)
            metrics = {
                'margin_percent': round(margin_percent, 1),
                'loss_amount': round(loss_amount, 2),
                'revenue_total': revenue_total,
                'dev_cost_total': total_cost,
                'revision_share': round((revision_cost / total_cost * 100) if total_cost > 0 else 0, 1)
            }
            
            recommendation = {
                'id': f"{project_id}:increase_price",
                'project_id': project_id,
                'project_name': project_name,
                'type': 'increase_price',
                'reason': f'Project revenue (${revenue_total:,.0f}) is below dev cost (${total_cost:,.0f}). Loss: ${loss_amount:,.0f}.',
                'confidence': 0.95,  # High confidence - это математика
                'expected_impact': loss_amount,  # $ amount если исправить
                'priority': priority,
                'drivers': drivers,
                'metrics': metrics
            }
            
            recommendations.append(recommendation)
    
    return recommendations


async def detect_high_revision_cost(db) -> List[Dict[str, Any]]:
    """
    Обнаруживает проекты с высокой стоимостью ревизий (revision_cost / total_cost > 15%).
    
    Returns динамически сгенерированные recommendations.
    """
    task_earnings_collection = db['task_earnings']
    projects_collection = db['projects']
    
    recommendations = []
    
    # Агрегация по проектам
    pipeline = [
        {'$group': {
            '_id': '$project_id',
            'total_cost': {'$sum': '$final_earning'},
            'revision_cost': {'$sum': '$revision_impact.revision_cost'},
            'revision_hours': {'$sum': '$revision_hours'},
        }},
        {'$match': {
            'total_cost': {'$gt': 0},
            '$expr': {
                '$gt': [
                    {'$divide': ['$revision_cost', '$total_cost']},
                    0.15
                ]
            }
        }}
    ]
    
    results = await task_earnings_collection.aggregate(pipeline).to_list(length=None)
    
    for result in results:
        project_id = result['_id']
        total_cost = result['total_cost']
        revision_cost = result['revision_cost']
        revision_hours = result['revision_hours']
        
        revision_share = (revision_cost / total_cost * 100) if total_cost > 0 else 0
        
        # Получить название проекта
        project = await projects_collection.find_one({'project_id': project_id})
        project_name = project.get('project_title', 'Unknown Project') if project else 'Unknown Project'
        
        # Priority
        if revision_share >= 30:
            priority = 'critical'
        elif revision_share >= 20:
            priority = 'high'
        else:
            priority = 'medium'
        
        # Drivers
        drivers = [
            {
                'factor': 'revision_cost',
                'value': f'${revision_cost:,.0f}',
                'impact': 'high'
            },
            {
                'factor': 'revision_hours',
                'value': f'{revision_hours:.1f}h',
                'impact': 'high'
            },
            {
                'factor': 'revision_share',
                'value': f'{revision_share:.1f}%',
                'impact': 'critical'
            }
        ]
        
        # Metrics
        metrics = {
            'revision_share': round(revision_share, 1),
            'revision_cost': round(revision_cost, 2),
            'total_cost': round(total_cost, 2),
            'revision_hours': round(revision_hours, 1)
        }
        
        recommendation = {
            'id': f"{project_id}:reduce_revision",
            'project_id': project_id,
            'project_name': project_name,
            'type': 'reduce_revision',
            'reason': f'Revision cost (${revision_cost:,.0f}) is {revision_share:.1f}% of total dev cost. Quality issues detected.',
            'confidence': 0.90,
            'expected_impact': revision_cost,  # потенциальная экономия
            'priority': priority,
            'drivers': drivers,
            'metrics': metrics
        }
        
        recommendations.append(recommendation)
    
    return recommendations


# ============ UNIFIED DETECTION (Recommendation + Action) ============

async def get_underpriced_with_actions(db) -> List[Dict[str, Any]]:
    """
    Главная функция Decision Layer.
    
    Returns unified objects с:
    - project info
    - margin/loss metrics
    - recommendation (dynamic)
    - action status (from DB)
    """
    actions_collection = db['actions']
    
    # Получить динамические recommendations
    underpriced_recs = await detect_underpriced_projects(db)
    high_revision_recs = await detect_high_revision_cost(db)
    
    all_recommendations = underpriced_recs + high_revision_recs
    
    # Для каждого recommendation получить action status
    unified_objects = []
    
    for rec in all_recommendations:
        project_id = rec['project_id']
        rec_type = rec['type']
        
        # Найти action для этого recommendation
        action = await actions_collection.find_one({
            'project_id': project_id,
            'type': rec_type
        })
        
        # Action status
        if action:
            action_status = {
                'status': action['status'],
                'decided_by': action.get('decided_by'),
                'decided_at': action.get('decided_at'),
                'note': action.get('note'),
                'outcome': action.get('outcome', {'status': 'pending'})
            }
        else:
            action_status = {
                'status': 'pending',
                'outcome': {'status': 'pending'}
            }
        
        # Unified object
        unified = {
            'project_id': rec['project_id'],
            'project_name': rec['project_name'],
            'problem_type': rec['type'],
            'priority': rec['priority'],
            'loss_amount': rec['expected_impact'],
            'margin_percent': rec['metrics'].get('margin_percent', 0),
            'drivers': rec['drivers'],
            'recommendation': {
                'id': rec['id'],
                'type': rec['type'],
                'reason': rec['reason'],
                'confidence': rec['confidence'],
                'expected_impact': rec['expected_impact'],
                'metrics': rec['metrics']
            },
            'action': action_status
        }
        
        unified_objects.append(unified)
    
    # Сортировать по priority (critical first)
    priority_order = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}
    unified_objects.sort(key=lambda x: priority_order.get(x['priority'], 99))
    
    return unified_objects


# ============ ACTION MANAGEMENT (UPSERT) ============

async def upsert_action(
    db,
    project_id: str,
    recommendation_id: str,
    rec_type: str,
    status: str,  # 'accepted' | 'rejected'
    decided_by: str,
    expected_impact: float,  # prediction для calibration
    note: str = ""
) -> Dict[str, Any]:
    """
    UPSERT action: создать если нет, обновить если есть.
    
    Это главная функция для фиксации решений админа.
    Сохраняет expected_impact для future calibration.
    """
    actions_collection = db['actions']
    
    # Попытаться найти существующий action
    existing_action = await actions_collection.find_one({
        'project_id': project_id,
        'type': rec_type
    })
    
    if existing_action:
        # UPDATE
        await actions_collection.update_one(
            {'project_id': project_id, 'type': rec_type},
            {
                '$set': {
                    'status': status,
                    'decided_by': decided_by,
                    'decided_at': datetime.now(timezone.utc),
                    'note': note,
                    'expected_impact': expected_impact  # обновляем prediction
                }
            }
        )
        
        logger.info(f"✅ Action updated: {project_id}:{rec_type} → {status}")
        
        return {
            'action_id': existing_action['action_id'],
            'operation': 'updated',
            'status': status
        }
    else:
        # CREATE
        action = {
            'action_id': str(uuid.uuid4()),
            'project_id': project_id,
            'recommendation_id': recommendation_id,
            'type': rec_type,
            'status': status,
            'decided_by': decided_by,
            'decided_at': datetime.now(timezone.utc),
            'note': note,
            'expected_impact': expected_impact,  # сохраняем prediction
            'created_at': datetime.now(timezone.utc),
            'outcome': {
                'status': 'pending'
            }
        }
        
        await actions_collection.insert_one(action)
        
        logger.info(f"✅ Action created: {project_id}:{rec_type} → {status}")
        
        return {
            'action_id': action['action_id'],
            'operation': 'created',
            'status': status
        }


async def get_all_actions(db) -> List[Dict[str, Any]]:
    """
    Получить все actions (audit trail).
    """
    actions_collection = db['actions']
    
    actions = await actions_collection.find({}).sort('created_at', -1).to_list(length=None)
    
    for action in actions:
        action.pop('_id', None)
    
    return actions


async def record_outcome(
    db,
    action_id: str,
    impact_realized: float
) -> Dict[str, Any]:
    """
    Зафиксировать outcome для action (закрыть feedback loop).
    
    Args:
        action_id: ID действия
        impact_realized: Реальный финансовый эффект ($ saved/earned)
    
    Returns:
        Updated action
    """
    actions_collection = db['actions']
    
    result = await actions_collection.update_one(
        {'action_id': action_id},
        {
            '$set': {
                'outcome': {
                    'status': 'measured',
                    'impact_realized': impact_realized,
                    'measured_at': datetime.now(timezone.utc)
                }
            }
        }
    )
    
    if result.modified_count == 0:
        raise ValueError(f"Action {action_id} not found")
    
    logger.info(f"✅ Outcome recorded: {action_id} → ${impact_realized}")
    
    return {
        'action_id': action_id,
        'impact_realized': impact_realized,
        'status': 'measured'
    }


# ============ CALIBRATION LAYER (L6 — Learning) ============

async def calculate_decision_metrics(db) -> List[Dict[str, Any]]:
    """
    Calibration Layer: измеряет эффективность типов решений.
    
    Для каждого type считает:
    - avg_expected (prediction)
    - avg_realized (fact)
    - avg_delta (prediction vs reality)
    - success_rate (% где |delta| < 20% of expected)
    - samples (количество измерений)
    
    Returns агрегированные метрики по типам решений.
    """
    actions_collection = db['actions']
    
    # Получить все actions с measured outcomes
    actions_with_outcomes = await actions_collection.find({
        'outcome.status': 'measured',
        'status': 'accepted',
        'expected_impact': {'$exists': True}
    }).to_list(length=None)
    
    # Группировать по type
    metrics_by_type = {}
    
    for action in actions_with_outcomes:
        rec_type = action['type']
        expected = action['expected_impact']
        realized = action['outcome']['impact_realized']
        delta = realized - expected
        
        if rec_type not in metrics_by_type:
            metrics_by_type[rec_type] = {
                'type': rec_type,
                'expected_values': [],
                'realized_values': [],
                'delta_values': []
            }
        
        metrics_by_type[rec_type]['expected_values'].append(expected)
        metrics_by_type[rec_type]['realized_values'].append(realized)
        metrics_by_type[rec_type]['delta_values'].append(delta)
    
    # Агрегировать метрики
    calibration_metrics = []
    
    for rec_type, data in metrics_by_type.items():
        expected_values = data['expected_values']
        realized_values = data['realized_values']
        delta_values = data['delta_values']
        
        samples = len(realized_values)
        
        if samples > 0:
            avg_expected = sum(expected_values) / samples
            avg_realized = sum(realized_values) / samples
            avg_delta = sum(delta_values) / samples
            
            # Success rate: где |delta| < 20% of expected
            threshold = 0.20
            successes = sum(1 for i, exp in enumerate(expected_values) 
                          if abs(delta_values[i]) < abs(exp * threshold))
            success_rate = (successes / samples) * 100 if samples > 0 else 0
            
            metric = {
                'type': rec_type,
                'avg_expected': round(avg_expected, 2),
                'avg_realized': round(avg_realized, 2),
                'avg_delta': round(avg_delta, 2),
                'success_rate': round(success_rate, 1),
                'samples': samples,
                'total_impact': round(sum(realized_values), 2)
            }
            
            calibration_metrics.append(metric)
    
    # Сортировать по avg_realized (самые эффективные первыми)
    calibration_metrics.sort(key=lambda x: x['avg_realized'], reverse=True)
    
    return calibration_metrics
