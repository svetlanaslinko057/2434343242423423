"""
DEVELOPER ECONOMY ENGINE

This is NOT a simple rating system.
This is a developer economy that drives:
- Growth
- Motivation
- Retention
- Competition

Formula:
R = (Q × 0.4) + (S × 0.25) + (T × 0.2) + (E × 0.15)

Where:
- Q (Quality) = QA pass rate
- S (Speed) = delivery speed vs estimate
- T (Trust) = time confidence
- E (Earnings stability) = consistency
"""

from datetime import datetime, timezone, timedelta
from typing import Dict, Optional, List
import logging

logger = logging.getLogger(__name__)

# ============ LEVEL SYSTEM ============

LEVELS = {
    "junior": {"min": 0, "max": 40, "label": "Junior"},
    "middle": {"min": 40, "max": 60, "label": "Middle"},
    "senior": {"min": 60, "max": 80, "label": "Senior"},
    "lead": {"min": 80, "max": 90, "label": "Lead"},
    "elite": {"min": 90, "max": 100, "label": "Elite"}
}

def get_level_from_rating(rating: float) -> str:
    """Get developer level based on rating"""
    for level_key, level_data in LEVELS.items():
        if level_data["min"] <= rating < level_data["max"]:
            return level_key
    return "elite" if rating >= 90 else "junior"


def get_level_label(level: str) -> str:
    """Get human-readable level label"""
    return LEVELS.get(level, {}).get("label", "Junior")


# ============ RATING CALCULATION ============

async def calculate_developer_rating(db, developer_id: str, period_days: int = 30) -> Dict:
    """
    Calculate developer rating
    
    R = (Q × 0.4) + (S × 0.25) + (T × 0.2) + (E × 0.15)
    
    Returns:
    - rating (0-100)
    - level (junior/middle/senior/lead/elite)
    - breakdown (Q, S, T, E components)
    """
    # Get recent tasks
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=period_days)
    
    tasks = await db.work_units.find({
        "assigned_to": developer_id,
        "created_at": {"$gte": cutoff_date.isoformat()}
    }, {"_id": 0}).to_list(500)
    
    if len(tasks) == 0:
        return {
            "rating": 0,
            "level": "junior",
            "level_label": "Junior",
            "breakdown": {"Q": 0, "S": 0, "T": 0, "E": 0},
            "total_tasks": 0
        }
    
    # ============ Q (Quality) 0-100 ============
    qa_decisions = await db.qa_decisions.find({
        "developer_id": developer_id,
        "created_at": {"$gte": cutoff_date.isoformat()}
    }, {"_id": 0}).to_list(500)
    
    if len(qa_decisions) > 0:
        qa_passed = len([q for q in qa_decisions if q.get("result") == "passed"])
        Q = round((qa_passed / len(qa_decisions)) * 100, 2)
    else:
        Q = 50  # Default if no QA data
    
    # ============ S (Speed) 0-100 ============
    # Speed = expected_time / actual_time * 100
    # If faster than expected → >100 (cap at 100)
    # If slower → <100
    
    speed_scores = []
    for task in tasks:
        if task.get("status") == "done" and task.get("estimated_hours") and task.get("actual_hours"):
            expected = task.get("estimated_hours", 1)
            actual = task.get("actual_hours", 1)
            if actual > 0:
                speed = min((expected / actual) * 100, 100)
                speed_scores.append(speed)
    
    S = round(sum(speed_scores) / len(speed_scores), 2) if len(speed_scores) > 0 else 50
    
    # ============ T (Trust) 0-100 ============
    # T = 100 - manual_time_ratio * 100
    # If manual time is low → high trust
    
    try:
        from time_tracking_layer import calculate_developer_time_trust
        time_trust = await calculate_developer_time_trust(db, developer_id, period="month")
        manual_ratio = time_trust.get("manual_ratio", 0.5)
        T = round((1 - manual_ratio) * 100, 2)
    except Exception as e:
        logger.warning(f"Failed to get time trust: {e}")
        T = 50
    
    # ============ E (Earnings stability) 0-100 ============
    # E = consistency of earnings (low variance)
    # Get recent earnings
    earnings = await db.task_earnings.find({
        "developer_id": developer_id,
        "created_at": {"$gte": cutoff_date.isoformat()}
    }, {"_id": 0}).to_list(500)
    
    if len(earnings) > 5:
        amounts = [e.get("final_earning", 0) for e in earnings]
        avg = sum(amounts) / len(amounts)
        variance = sum([(x - avg) ** 2 for x in amounts]) / len(amounts)
        std_dev = variance ** 0.5
        # Low variance = high stability
        # Normalize: if std_dev < 20% of avg → high score
        if avg > 0:
            stability = max(0, min(100, 100 - (std_dev / avg) * 100))
            E = round(stability, 2)
        else:
            E = 50
    else:
        E = 50  # Not enough data
    
    # ============ FINAL RATING ============
    # R = (Q × 0.4) + (S × 0.25) + (T × 0.2) + (E × 0.15)

    base_rating = round(
        (Q * 0.4) + (S * 0.25) + (T * 0.2) + (E * 0.15),
        2
    )

    # ============ DECAY ============
    # Inactive devs lose score. Pulled from reputation_decay so the same
    # formula drives rating here, growth dashboard, and the UI warning.
    try:
        from reputation_decay import apply_decay
        user_doc = await db.users.find_one(
            {"user_id": developer_id},
            {"_id": 0, "last_active_at": 1},
        ) or {}
        decay_penalty = apply_decay(user_doc.get("last_active_at"))
    except Exception as e:
        logger.warning(f"decay lookup failed for {developer_id}: {e}")
        decay_penalty = 0

    rating = max(0.0, round(base_rating - decay_penalty, 2))

    level = get_level_from_rating(rating)
    level_label = get_level_label(level)

    return {
        "rating": rating,
        "level": level,
        "level_label": level_label,
        "breakdown": {
            "Q": Q,
            "S": S,
            "T": T,
            "E": E,
            "base_rating": base_rating,
            "decay_penalty": decay_penalty,
        },
        "total_tasks": len(tasks),
        "total_qa_decisions": len(qa_decisions)
    }


# ============ DYNAMIC EARNINGS MULTIPLIERS ============

async def calculate_earnings_multipliers(db, developer_id: str, task: Dict) -> Dict:
    """
    Calculate dynamic earnings multipliers
    
    final_earning = base × multipliers
    
    Multipliers:
    1. Quality bonus (+0-30%)
    2. Speed bonus (+0-20%)
    3. Trust bonus (+0-10%)
    4. Revision penalty (-5% per revision)
    """
    base_earning = task.get("base_earning", 100)
    
    # Get developer rating
    rating_data = await calculate_developer_rating(db, developer_id, period_days=30)
    Q = rating_data["breakdown"]["Q"]
    S = rating_data["breakdown"]["S"]
    T = rating_data["breakdown"]["T"]
    
    # ============ 1. Quality Bonus ============
    if Q >= 90:
        quality_bonus = 0.30
    elif Q >= 80:
        quality_bonus = 0.15
    elif Q >= 70:
        quality_bonus = 0.05
    else:
        quality_bonus = 0
    
    # ============ 2. Speed Bonus ============
    # If S > 80 (faster than expected)
    if S >= 90:
        speed_bonus = 0.20
    elif S >= 80:
        speed_bonus = 0.10
    else:
        speed_bonus = 0
    
    # ============ 3. Trust Bonus ============
    if T >= 80:
        trust_bonus = 0.10
    elif T >= 70:
        trust_bonus = 0.05
    else:
        trust_bonus = 0
    
    # ============ 4. Revision Penalty ============
    revision_count = task.get("revision_count", 0)
    revision_penalty = revision_count * 0.05
    
    # ============ TOTAL MULTIPLIER ============
    total_multiplier = 1.0 + quality_bonus + speed_bonus + trust_bonus - revision_penalty
    total_multiplier = max(0.5, total_multiplier)  # Floor at 50%
    
    final_earning = round(base_earning * total_multiplier, 2)
    
    return {
        "base_earning": base_earning,
        "quality_bonus": quality_bonus,
        "speed_bonus": speed_bonus,
        "trust_bonus": trust_bonus,
        "revision_penalty": revision_penalty,
        "total_multiplier": total_multiplier,
        "final_earning": final_earning,
        "bonus_amount": round(final_earning - base_earning, 2)
    }


# ============ GROWTH PANEL (What to improve) ============

async def calculate_growth_opportunities(db, developer_id: str) -> List[Dict]:
    """
    Calculate what developer can improve to earn more
    
    Returns list of opportunities sorted by potential impact
    """
    rating_data = await calculate_developer_rating(db, developer_id)
    Q = rating_data["breakdown"]["Q"]
    S = rating_data["breakdown"]["S"]
    T = rating_data["breakdown"]["T"]
    
    # Get recent average earnings
    recent_earnings = await db.task_earnings.find({
        "developer_id": developer_id,
        "status": {"$in": ["approved", "paid"]}
    }, {"_id": 0}).sort("created_at", -1).limit(10).to_list(10)
    
    avg_base = sum([e.get("base_earning", 100) for e in recent_earnings]) / len(recent_earnings) if len(recent_earnings) > 0 else 100
    monthly_tasks = 20  # Assume 20 tasks/month for calculation
    
    opportunities = []
    
    # ============ 1. Improve QA Pass Rate ============
    if Q < 90:
        # If improve to 90%
        current_bonus = 0.15 if Q >= 80 else (0.05 if Q >= 70 else 0)
        target_bonus = 0.30
        bonus_diff = target_bonus - current_bonus
        monthly_impact = round(avg_base * bonus_diff * monthly_tasks, 2)
        
        opportunities.append({
            "area": "QA Pass Rate",
            "current": Q,
            "target": 90,
            "action": "Improve QA pass rate to 90%+",
            "monthly_impact": monthly_impact,
            "priority": "high" if monthly_impact > 200 else "medium"
        })
    
    # ============ 2. Reduce Revisions ============
    # Get avg revisions
    tasks = await db.work_units.find({"assigned_to": developer_id}, {"_id": 0}).limit(20).to_list(20)
    avg_revisions = sum([t.get("revision_count", 0) for t in tasks]) / len(tasks) if len(tasks) > 0 else 0
    
    if avg_revisions > 0:
        # If reduce to 0
        penalty_saved = avg_revisions * 0.05
        monthly_impact = round(avg_base * penalty_saved * monthly_tasks, 2)
        
        opportunities.append({
            "area": "Revisions",
            "current": round(avg_revisions, 2),
            "target": 0,
            "action": "Reduce revisions to zero",
            "monthly_impact": monthly_impact,
            "priority": "high" if monthly_impact > 150 else "medium"
        })
    
    # ============ 3. Increase Speed ============
    if S < 90:
        current_bonus = 0.10 if S >= 80 else 0
        target_bonus = 0.20
        bonus_diff = target_bonus - current_bonus
        monthly_impact = round(avg_base * bonus_diff * monthly_tasks, 2)
        
        opportunities.append({
            "area": "Speed",
            "current": S,
            "target": 90,
            "action": "Deliver faster than estimates",
            "monthly_impact": monthly_impact,
            "priority": "medium"
        })
    
    # ============ 4. Improve Time Trust ============
    if T < 80:
        current_bonus = 0.05 if T >= 70 else 0
        target_bonus = 0.10
        bonus_diff = target_bonus - current_bonus
        monthly_impact = round(avg_base * bonus_diff * monthly_tasks, 2)
        
        opportunities.append({
            "area": "Time Confidence",
            "current": T,
            "target": 80,
            "action": "Use timer more, reduce manual logs",
            "monthly_impact": monthly_impact,
            "priority": "low"
        })
    
    # Sort by monthly impact
    opportunities.sort(key=lambda x: x["monthly_impact"], reverse=True)
    
    return opportunities


# ============ ASSIGNMENT ENGINE (Smart Suggestions) ============

async def suggest_developers_for_task(db, task: Dict, limit: int = 3) -> List[Dict]:
    """
    Suggest top developers for a task
    
    score = (R × 0.5) + (availability × 0.3) + (specialization × 0.2)
    
    Where:
    - R = developer rating
    - availability = 1 - (active_tasks / max_capacity)
    - specialization = match with task tags
    """
    # Get all developers
    developers = await db.users.find({"role": "developer"}, {"_id": 0}).to_list(100)
    
    suggestions = []
    
    for dev in developers:
        dev_id = dev["user_id"]
        
        # Get rating
        rating_data = await calculate_developer_rating(db, dev_id)
        R = rating_data["rating"]
        
        # Get availability
        active_tasks = await db.work_units.count_documents({
            "assigned_to": dev_id,
            "status": {"$in": ["in_progress", "review", "revision"]}
        })
        
        max_capacity = 5  # Configurable
        availability = max(0, 1 - (active_tasks / max_capacity))
        
        # Specialization match (simplified - can be enhanced with tags)
        specialization = 0.5  # Default neutral match
        
        # Calculate score
        score = round((R * 0.5) + (availability * 100 * 0.3) + (specialization * 100 * 0.2), 2)
        
        suggestions.append({
            "developer_id": dev_id,
            "developer_name": dev.get("name"),
            "rating": R,
            "level": rating_data["level_label"],
            "active_tasks": active_tasks,
            "availability": round(availability * 100, 2),
            "score": score
        })
    
    # Sort by score
    suggestions.sort(key=lambda x: x["score"], reverse=True)
    
    return suggestions[:limit]



# ============ ELITE TIER SYSTEM (TOP 10 RETENTION) ============

async def get_elite_developers(db, limit: int = 10) -> List[Dict]:
    """
    Get top developers (Elite Tier)
    
    Elite = Top 10 by rating
    
    Benefits:
    - Access to $1000-$3000 modules
    - +10-15% earnings multiplier
    - Priority module reservation
    - Private module pool
    """
    # Get all active developers with rating
    developers = await db.users.find({
        "role": "developer",
        "rating": {"$exists": True}
    }, {"_id": 0}).to_list(1000)
    
    # Sort by rating desc
    sorted_devs = sorted(developers, key=lambda d: d.get("rating", 0), reverse=True)
    
    # Top N
    elite_devs = sorted_devs[:limit]
    
    return elite_devs


async def is_elite_developer(db, developer_id: str) -> bool:
    """Check if developer is in Elite Tier (Top 10)"""
    elite_devs = await get_elite_developers(db, limit=10)
    elite_ids = [d["user_id"] for d in elite_devs]
    return developer_id in elite_ids


async def get_elite_rank(db, developer_id: str) -> Optional[int]:
    """Get developer's rank (1-10 if elite, else None)"""
    elite_devs = await get_elite_developers(db, limit=10)
    for idx, dev in enumerate(elite_devs):
        if dev["user_id"] == developer_id:
            return idx + 1
    return None


async def calculate_distance_to_elite(db, developer_id: str) -> Dict:
    """
    Calculate how far developer is from Elite Tier
    
    Returns:
    - current_rank: int
    - elite_threshold_rating: float (rating of #10)
    - points_needed: float
    - earnings_gap: int ($ difference to #10)
    """
    # Get all developers sorted by rating
    developers = await db.users.find({
        "role": "developer",
        "rating": {"$exists": True}
    }, {"_id": 0}).to_list(1000)
    
    sorted_devs = sorted(developers, key=lambda d: d.get("rating", 0), reverse=True)
    
    # Find current developer
    current_rank = None
    current_rating = 0
    for idx, dev in enumerate(sorted_devs):
        if dev["user_id"] == developer_id:
            current_rank = idx + 1
            current_rating = dev.get("rating", 0)
            break
    
    # Get #10 rating
    elite_threshold_rating = sorted_devs[9].get("rating", 0) if len(sorted_devs) >= 10 else 0
    points_needed = max(0, elite_threshold_rating - current_rating)
    
    # Estimate earnings gap (mock for now)
    earnings_gap = int(points_needed * 50)  # Rough estimate: 1 rating point = $50/month
    
    return {
        "current_rank": current_rank,
        "elite_threshold_rating": elite_threshold_rating,
        "points_needed": round(points_needed, 1),
        "earnings_gap": earnings_gap,
        "is_elite": current_rank <= 10 if current_rank else False
    }


async def get_elite_module_access_level(db, developer_id: str) -> str:
    """
    Get module access level based on Elite status
    
    Returns:
    - "elite": Access to $1000-$3000 modules
    - "public": Access to $400-$800 modules
    """
    is_elite = await is_elite_developer(db, developer_id)
    return "elite" if is_elite else "public"


async def get_weekly_elite_status(db, developer_id: str) -> Dict:
    """
    Weekly Elite status check
    
    Returns:
    - current_rank: int
    - is_elite: bool
    - earnings_this_week: int
    - quality_this_week: float
    - risk_of_drop: bool (if rank 8-10)
    """
    elite_rank = await get_elite_rank(db, developer_id)
    is_elite = elite_rank is not None
    
    # Mock weekly earnings (need real implementation)
    earnings_this_week = 1840 if is_elite else 840
    quality_this_week = 92.0 if is_elite else 78.0
    
    risk_of_drop = is_elite and elite_rank >= 8
    
    return {
        "current_rank": elite_rank,
        "is_elite": is_elite,
        "earnings_this_week": earnings_this_week,
        "quality_this_week": quality_this_week,
        "risk_of_drop": risk_of_drop,
        "message": "⚠️ You're at risk of losing Elite status" if risk_of_drop else None
    }



async def calculate_earnings_this_week(db, developer_id: str) -> int:
    """
    Calculate developer earnings for current week
    Simplified: sum of completed module prices this week
    """
    from datetime import datetime, timezone, timedelta
    
    # Get start of current week (Monday)
    now = datetime.now(timezone.utc)
    week_start = now - timedelta(days=now.weekday())
    week_start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Find completed modules this week
    completed_modules = await db.modules.find({
        "assigned_to": developer_id,
        "status": "completed",
        "completed_at": {"$gte": week_start}
    }, {"_id": 0, "price": 1}).to_list(100)
    
    total = sum(m.get("price", 0) for m in completed_modules)
    return int(total)


async def get_developer_rating(db, developer_id: str) -> Dict:
    """
    Get developer rating with all components
    Wrapper around calculate_developer_rating
    """
    rating_data = await calculate_developer_rating(db, developer_id)
    
    level = get_level_from_rating(rating_data["rating"])
    level_label = get_level_label(level)
    
    return {
        "rating": rating_data["rating"],
        "level": level,
        "level_label": level_label,
        # `breakdown` is the canonical key from calculate_developer_rating.
        # Expose under both names so old UI keeps working.
        "breakdown": rating_data.get("breakdown", {"Q": 0, "S": 0, "T": 0, "E": 0}),
        "components": rating_data.get("breakdown", {"Q": 0, "S": 0, "T": 0, "E": 0}),
        "growth_opportunities": rating_data.get("growth_opportunities", [])
    }
