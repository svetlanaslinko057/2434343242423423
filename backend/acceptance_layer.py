"""
Acceptance Layer - Production Grade
Task Intake Window + Control Point for Execution

This module handles:
- Task acceptance/decline/clarification
- Response tracking and deadlines
- Automatic escalation
- Assignment engine integration
"""

from typing import Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import logging

logger = logging.getLogger(__name__)

# ============ CONSTANTS ============

# Response deadline (hours after assignment)
ACCEPTANCE_RESPONSE_DEADLINE_HOURS = 2

# Decline reason types
DECLINE_REASONS = {
    "overloaded": "Currently overloaded with tasks",
    "wrong_stack": "Required stack doesn't match my skills",
    "missing_context": "Task requirements unclear",
    "blocked": "Blocked by dependencies",
    "unavailable": "Not available at this time",
    "other": "Other reason"
}

# Task statuses
STATUS_PENDING = "pending"
STATUS_ASSIGNED = "assigned"
STATUS_ASSIGNED_WAITING_RESPONSE = "assigned_waiting_response"
STATUS_ACCEPTED = "accepted"
STATUS_IN_PROGRESS = "in_progress"
STATUS_SUBMITTED = "submitted"
STATUS_REVIEW = "review"
STATUS_QA = "qa"
STATUS_REVISION = "revision"
STATUS_DONE = "done"
STATUS_BATCHED = "batched"
STATUS_PAID = "paid"


# ============ ACCEPTANCE MODELS ============

def create_task_assignment(
    task_id: str,
    developer_id: str,
    assigned_by: str,
    assignment_reason: str = None
) -> Dict[str, Any]:
    """
    Create task assignment with intake window
    
    Returns assignment document with response deadline
    """
    now = datetime.now(timezone.utc)
    response_deadline = now + timedelta(hours=ACCEPTANCE_RESPONSE_DEADLINE_HOURS)
    
    assignment = {
        "task_id": task_id,
        "developer_id": developer_id,
        "assigned_by": assigned_by,
        "assigned_at": now.isoformat(),
        
        # Intake window
        "status": STATUS_ASSIGNED_WAITING_RESPONSE,
        "response_deadline": response_deadline.isoformat(),
        "response_received": False,
        
        # Assignment context (WHY YOU)
        "assignment_reason": assignment_reason or "Best match for this task",
        "match_score": None,  # From assignment engine
        
        # Response tracking
        "accepted_at": None,
        "declined_at": None,
        "clarification_requested_at": None,
        
        # Latency tracking
        "acceptance_latency_minutes": None,
        
        # Decline tracking
        "decline_reason": None,
        
        # Clarification tracking
        "clarification": None,
        
        "created_at": now.isoformat()
    }
    
    return assignment


def create_decline_reason(
    reason_type: str,
    details: str = None,
    current_load: Dict[str, Any] = None
) -> Dict[str, Any]:
    """
    Create structured decline reason
    
    Args:
        reason_type: One of DECLINE_REASONS keys
        details: Additional details from developer
        current_load: Developer's current load data
    
    Returns:
        Structured decline reason
    """
    if reason_type not in DECLINE_REASONS:
        reason_type = "other"
    
    decline_reason = {
        "type": reason_type,
        "label": DECLINE_REASONS[reason_type],
        "details": details,
        "declined_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Add load context if overloaded
    if reason_type == "overloaded" and current_load:
        decline_reason["load_context"] = {
            "active_tasks_count": current_load.get("active_tasks_count", 0),
            "load_index": current_load.get("load_index", 0),
            "load_status": current_load.get("status", "unknown")
        }
    
    return decline_reason


def create_clarification_request(
    message: str,
    requested_by: str
) -> Dict[str, Any]:
    """
    Create clarification request entity
    
    Not just a boolean - full entity
    """
    clarification = {
        "requested": True,
        "requested_by": requested_by,
        "requested_at": datetime.now(timezone.utc).isoformat(),
        "message": message,
        
        # Response tracking
        "answered": False,
        "answered_by": None,
        "answered_at": None,
        "answer": None,
        
        # Resolution
        "resolved": False,
        "resolved_at": None
    }
    
    return clarification


def calculate_acceptance_latency(assigned_at: str, accepted_at: str) -> int:
    """
    Calculate acceptance latency in minutes
    
    Important metric for developer responsiveness
    """
    assigned_dt = datetime.fromisoformat(assigned_at.replace('Z', '+00:00'))
    accepted_dt = datetime.fromisoformat(accepted_at.replace('Z', '+00:00'))
    
    delta = accepted_dt - assigned_dt
    latency_minutes = int(delta.total_seconds() / 60)
    
    return latency_minutes


# ============ ACCEPTANCE ACTIONS ============

async def accept_task(
    task: Dict[str, Any],
    developer: Dict[str, Any],
    db
) -> Dict[str, Any]:
    """
    Accept task assignment
    
    This is the control point - task enters execution
    """
    task_id = task["unit_id"]
    developer_id = developer["user_id"]
    now = datetime.now(timezone.utc)
    
    # Calculate acceptance latency
    assigned_at = task.get("assigned_at")
    acceptance_latency = calculate_acceptance_latency(assigned_at, now.isoformat()) if assigned_at else 0
    
    # Update task
    update_data = {
        "$set": {
            "status": STATUS_ACCEPTED,
            "accepted": True,
            "accepted_at": now.isoformat(),
            "response_received": True,
            "acceptance_latency_minutes": acceptance_latency
        }
    }
    
    await db.work_units.update_one({"unit_id": task_id}, update_data)
    
    # Update assignment record if exists
    await db.assignments.update_one(
        {"unit_id": task_id, "developer_id": developer_id},
        {
            "$set": {
                "status": "active",
                "accepted_at": now.isoformat(),
                "acceptance_latency_minutes": acceptance_latency
            }
        }
    )
    
    # Lock capacity in assignment engine
    # (Developer's load_index increases, removed from available pool for other tasks)
    
    logger.info(f"TASK ACCEPTED: {task_id} by {developer_id} (latency: {acceptance_latency}m)")
    
    return {
        "message": "Task accepted",
        "task_id": task_id,
        "status": STATUS_ACCEPTED,
        "acceptance_latency_minutes": acceptance_latency
    }


async def decline_task(
    task: Dict[str, Any],
    developer: Dict[str, Any],
    reason_type: str,
    details: str,
    current_load: Dict[str, Any],
    db
) -> Dict[str, Any]:
    """
    Decline task assignment
    
    Structured decline with reason tracking
    """
    task_id = task["unit_id"]
    developer_id = developer["user_id"]
    now = datetime.now(timezone.utc)
    
    # Create structured decline reason
    decline_reason = create_decline_reason(reason_type, details, current_load)
    
    # Update task - back to pending, unassign
    update_data = {
        "$set": {
            "status": STATUS_PENDING,
            "assigned_to": None,
            "declined_at": now.isoformat(),
            "decline_reason": decline_reason,
            "response_received": True
        }
    }
    
    await db.work_units.update_one({"unit_id": task_id}, update_data)
    
    # Update assignment record
    await db.assignments.update_one(
        {"unit_id": task_id, "developer_id": developer_id},
        {
            "$set": {
                "status": "declined",
                "declined_at": now.isoformat(),
                "decline_reason": decline_reason
            }
        }
    )
    
    # Analytics: Track decline patterns
    await db.decline_analytics.update_one(
        {"developer_id": developer_id},
        {
            "$inc": {
                f"decline_reasons.{reason_type}": 1,
                "total_declines": 1
            },
            "$set": {
                "last_decline_at": now.isoformat()
            }
        },
        upsert=True
    )
    
    # Unlock capacity (developer available again)
    
    # Trigger re-assignment (Assignment Engine suggestion)
    # This should call assignment engine to suggest next best developer
    
    logger.info(f"TASK DECLINED: {task_id} by {developer_id} - {reason_type}")
    
    return {
        "message": "Task declined",
        "task_id": task_id,
        "status": STATUS_PENDING,
        "decline_reason": decline_reason,
        "next_action": "Triggering re-assignment"
    }


async def request_clarification(
    task: Dict[str, Any],
    developer: Dict[str, Any],
    message: str,
    db
) -> Dict[str, Any]:
    """
    Request clarification on task
    
    Creates micro-communication layer
    """
    task_id = task["unit_id"]
    developer_id = developer["user_id"]
    
    # Create clarification entity
    clarification = create_clarification_request(message, developer_id)
    
    # Update task
    await db.work_units.update_one(
        {"unit_id": task_id},
        {
            "$set": {
                "clarification": clarification,
                "response_received": True,
                "clarification_requested": True
            }
        }
    )
    
    # Create notification for admin/client
    notification = {
        "type": "clarification_requested",
        "task_id": task_id,
        "developer_id": developer_id,
        "message": message,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Pause SLA timer (task waiting for clarification)
    await db.work_units.update_one(
        {"unit_id": task_id},
        {"$set": {"sla_paused": True, "sla_paused_reason": "clarification"}}
    )
    
    logger.info(f"CLARIFICATION REQUESTED: {task_id} by {developer_id}")
    
    return {
        "message": "Clarification requested",
        "task_id": task_id,
        "clarification": clarification
    }


async def answer_clarification(
    task_id: str,
    answer: str,
    answered_by: str,
    db
) -> Dict[str, Any]:
    """
    Answer clarification request
    
    Admin/client provides answer
    """
    now = datetime.now(timezone.utc)
    
    # Update clarification
    await db.work_units.update_one(
        {"unit_id": task_id},
        {
            "$set": {
                "clarification.answered": True,
                "clarification.answered_by": answered_by,
                "clarification.answered_at": now.isoformat(),
                "clarification.answer": answer,
                "clarification.resolved": True,
                "clarification.resolved_at": now.isoformat(),
                
                # Resume SLA
                "sla_paused": False
            }
        }
    )
    
    # Notify developer
    
    logger.info(f"CLARIFICATION ANSWERED: {task_id} by {answered_by}")
    
    return {
        "message": "Clarification answered",
        "task_id": task_id
    }


# ============ AUTOMATIC REACTIONS ============

async def check_pending_responses(db) -> list:
    """
    Check for tasks awaiting response past deadline
    
    Automatic escalation
    """
    now = datetime.now(timezone.utc)
    
    # Find tasks with status = assigned_waiting_response, deadline passed
    overdue_tasks = await db.work_units.find({
        "status": STATUS_ASSIGNED_WAITING_RESPONSE,
        "response_received": False,
        "response_deadline": {"$lt": now.isoformat()}
    }).to_list(100)
    
    alerts = []
    
    for task in overdue_tasks:
        alert = {
            "type": "acceptance_overdue",
            "task_id": task["unit_id"],
            "developer_id": task.get("assigned_to"),
            "assigned_at": task.get("assigned_at"),
            "deadline": task.get("response_deadline"),
            "overdue_minutes": int((now - datetime.fromisoformat(task["response_deadline"].replace('Z', '+00:00'))).total_seconds() / 60)
        }
        alerts.append(alert)
    
    return alerts


async def auto_escalate_task(task_id: str, db):
    """
    Auto-escalate task if no response
    
    Options:
    1. Send reminder to developer
    2. Unassign and suggest to next best developer
    3. Alert admin
    """
    task = await db.work_units.find_one({"unit_id": task_id})
    
    if not task:
        return
    
    # Mark as escalated
    await db.work_units.update_one(
        {"unit_id": task_id},
        {
            "$set": {
                "escalated": True,
                "escalated_at": datetime.now(timezone.utc).isoformat(),
                "escalation_reason": "no_acceptance_response"
            }
        }
    )
    
    # Send alert to admin
    # Option: Auto-reassign to next best developer
    
    logger.warning(f"TASK ESCALATED: {task_id} - no acceptance response")


async def adjust_assignment_score_on_decline(
    developer_id: str,
    task: Dict[str, Any],
    decline_reason: Dict[str, Any],
    db
):
    """
    Adjust future assignment scoring based on decline
    
    If developer declines due to wrong_stack:
    - Lower skill_fit score for similar tasks
    
    If declines due to overload:
    - Temporarily reduce availability_fit
    """
    reason_type = decline_reason.get("type")
    
    # Track decline patterns
    decline_pattern = {
        "developer_id": developer_id,
        "task_type": task.get("type"),
        "required_stack": task.get("required_stack", []),
        "reason_type": reason_type,
        "declined_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.decline_patterns.insert_one(decline_pattern)
    
    # Future: Use this data to adjust assignment engine scoring
    # For now, just log
    logger.info(f"DECLINE PATTERN RECORDED: {developer_id} - {reason_type} for {task.get('type')}")


# ============ ANALYTICS ============

async def get_acceptance_metrics(developer_id: str, db) -> Dict[str, Any]:
    """
    Get developer's acceptance metrics
    
    Important for performance evaluation
    """
    # Get all assignments
    assignments = await db.assignments.find(
        {"developer_id": developer_id}
    ).to_list(500)
    
    total_assigned = len(assignments)
    accepted_count = sum(1 for a in assignments if a.get("status") == "active")
    declined_count = sum(1 for a in assignments if a.get("status") == "declined")
    
    # Calculate metrics
    acceptance_rate = accepted_count / total_assigned if total_assigned > 0 else 0
    decline_rate = declined_count / total_assigned if total_assigned > 0 else 0
    
    # Average acceptance latency
    accepted_with_latency = [a for a in assignments if a.get("acceptance_latency_minutes") is not None]
    avg_latency = (
        sum(a["acceptance_latency_minutes"] for a in accepted_with_latency) / len(accepted_with_latency)
        if accepted_with_latency else 0
    )
    
    # Decline reasons breakdown
    decline_analytics = await db.decline_analytics.find_one({"developer_id": developer_id}) or {}
    decline_reasons = decline_analytics.get("decline_reasons", {})
    
    return {
        "total_assigned": total_assigned,
        "accepted_count": accepted_count,
        "declined_count": declined_count,
        "acceptance_rate": round(acceptance_rate, 2),
        "decline_rate": round(decline_rate, 2),
        "avg_acceptance_latency_minutes": round(avg_latency, 1),
        "decline_reasons_breakdown": decline_reasons
    }


async def get_task_assignment_context(
    task: Dict[str, Any],
    developer: Dict[str, Any],
    assignment_score: Dict[str, float]
) -> str:
    """
    Generate WHY YOU context for UI
    
    Show developer why this task was assigned to them
    """
    reasons = []
    
    # Skill fit
    if assignment_score.get("skill_fit", 0) > 0.8:
        reasons.append("Excellent skill match")
    elif assignment_score.get("skill_fit", 0) > 0.6:
        reasons.append("Good skill match")
    
    # Availability
    if assignment_score.get("availability_fit", 0) > 0.8:
        reasons.append("Available capacity")
    
    # Performance
    if assignment_score.get("performance_fit", 0) > 0.8:
        reasons.append("Strong track record")
    
    # Quality
    if assignment_score.get("quality_fit", 0) > 0.9:
        reasons.append("High quality rating")
    
    # Context fit
    if assignment_score.get("context_fit", 0) > 0.7:
        reasons.append("Similar to current work")
    
    # Match score
    total_score = assignment_score.get("total_score", 0)
    if total_score > 0.8:
        reasons.append(f"Top match ({int(total_score * 100)}% fit)")
    
    context = " • ".join(reasons) if reasons else "Best available match"
    
    return context
