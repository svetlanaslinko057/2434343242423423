"""
QA WORKFLOW HARDENING (STEP 3B)

This is the QUALITY TRUTH LAYER.

Time Layer → how much worked
QA Layer   → how good it was ← YOU ARE HERE
Earnings   → how much to pay

Philosophy:
- QA = decision layer (not just pass/fail checkbox)
- Audit trail mandatory
- Revision hours from REAL time logs
- First-pass success = KPI
- Severity tracking (no auto-penalties yet)
"""

import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

# ============ QA RESULTS ============

QA_RESULT_PASSED = "passed"
QA_RESULT_FAILED = "failed"
QA_RESULT_REVISION = "revision"

VALID_QA_RESULTS = [QA_RESULT_PASSED, QA_RESULT_FAILED, QA_RESULT_REVISION]

# ============ QA SEVERITY ============

QA_SEVERITY_LOW = "low"
QA_SEVERITY_MEDIUM = "medium"
QA_SEVERITY_HIGH = "high"
QA_SEVERITY_CRITICAL = "critical"

VALID_QA_SEVERITIES = [QA_SEVERITY_LOW, QA_SEVERITY_MEDIUM, QA_SEVERITY_HIGH, QA_SEVERITY_CRITICAL]

# ============ TASK STATUS (NORMALIZED) ============

TASK_STATUS_ACCEPTED = "accepted"
TASK_STATUS_IN_PROGRESS = "in_progress"
TASK_STATUS_SUBMITTED = "submitted"
TASK_STATUS_QA_REVIEW = "qa_review"
TASK_STATUS_REVISION = "revision"
TASK_STATUS_DONE = "done"

# ============ QA STATUS (SEPARATE FROM TASK STATUS) ============

QA_STATUS_PENDING = "pending"
QA_STATUS_IN_REVIEW = "in_review"
QA_STATUS_PASSED = "passed"
QA_STATUS_REVISION = "revision"

# ============ REVISION IMPACT ============

REVISION_IMPACT_LOW_THRESHOLD = 0.1  # <10% of actual_hours
REVISION_IMPACT_MEDIUM_THRESHOLD = 0.25  # 10-25%
# >25% = high


async def create_qa_decision(
    task_id: str,
    project_id: str,
    reviewer_id: str,
    result: str,
    severity: str,
    issues: List[Dict[str, Any]],
    note: str = "",
    db = None
) -> Dict[str, Any]:
    """
    Create QA decision (audit trail)
    
    This is the TRUTH of quality outcome.
    
    Args:
        task_id: Task ID
        project_id: Project ID
        reviewer_id: Admin/QA reviewer ID
        result: passed | failed | revision
        severity: low | medium | high | critical (overall severity)
        issues: List of specific issues found
            [{"code": "API_INVALID", "message": "...", "severity": "high"}, ...]
        note: Reviewer notes
    
    Returns:
        QA decision document
    """
    now = datetime.now(timezone.utc)
    
    # Validate result
    if result not in VALID_QA_RESULTS:
        raise ValueError(f"Invalid QA result. Must be one of: {VALID_QA_RESULTS}")
    
    # Validate severity
    if severity not in VALID_QA_SEVERITIES:
        raise ValueError(f"Invalid severity. Must be one of: {VALID_QA_SEVERITIES}")
    
    # Get task to determine iteration
    task = await db.work_units.find_one({"unit_id": task_id}, {"_id": 0})
    if not task:
        raise ValueError(f"Task {task_id} not found")
    
    # Calculate iteration (how many times QA reviewed this task)
    existing_decisions = await db.qa_decisions.count_documents({"task_id": task_id})
    iteration = existing_decisions + 1
    
    # Create decision document
    decision_doc = {
        "qa_decision_id": f"qa_{uuid.uuid4().hex[:12]}",
        "task_id": task_id,
        "project_id": project_id,
        "reviewer_id": reviewer_id,
        
        "result": result,
        "severity": severity,
        
        "issues": issues,  # Detailed issue list
        "note": note,
        
        "iteration": iteration,
        
        "created_at": now.isoformat()
    }
    
    # Save to DB
    await db.qa_decisions.insert_one(decision_doc)
    
    logger.info(f"QA DECISION CREATED: {decision_doc['qa_decision_id']} for task {task_id} - {result} (iteration {iteration})")
    
    return decision_doc


async def calculate_revision_hours_from_logs(
    task_id: str,
    user_id: str,
    db = None
) -> Dict[str, float]:
    """
    Calculate REAL revision hours from time_logs
    
    NOT manual input, NOT guessing.
    From actual tracked time in categories: revision, qa_fix
    
    Args:
        task_id: Task ID
        user_id: Developer ID
    
    Returns:
        {
            "revision_hours": float,
            "qa_fix_hours": float,
            "total_revision_time": float
        }
    """
    # Get all time logs for this task
    logs = await db.time_logs.find({
        "task_id": task_id,
        "user_id": user_id,
        "deleted": {"$ne": True}
    }, {"_id": 0}).to_list(500)
    
    # Calculate revision time
    revision_hours = sum(
        log["duration_hours"] 
        for log in logs 
        if log.get("category") == "revision"
    )
    
    # Calculate QA fix time (specific fixes after QA feedback)
    qa_fix_hours = sum(
        log["duration_hours"]
        for log in logs
        if log.get("category") == "qa_fix"
    )
    
    total_revision_time = revision_hours + qa_fix_hours
    
    return {
        "revision_hours": round(revision_hours, 2),
        "qa_fix_hours": round(qa_fix_hours, 2),
        "total_revision_time": round(total_revision_time, 2)
    }


def calculate_first_pass_success(
    qa_iteration_count: int,
    qa_result: str
) -> bool:
    """
    Determine if task achieved first-pass QA success
    
    This is a KEY KPI for:
    - Developer performance
    - Team quality
    - Assignment engine
    
    Args:
        qa_iteration_count: How many times QA reviewed
        qa_result: Final QA result
    
    Returns:
        True if passed on first attempt, False otherwise
    """
    return qa_iteration_count == 1 and qa_result == QA_RESULT_PASSED


def calculate_revision_impact_level(
    revision_hours: float,
    actual_hours: float
) -> str:
    """
    Calculate revision impact level based on ratio
    
    Args:
        revision_hours: Time spent on revisions
        actual_hours: Total time spent on task
    
    Returns:
        "low" | "medium" | "high"
    """
    if actual_hours == 0:
        return "low"
    
    ratio = revision_hours / actual_hours
    
    if ratio < REVISION_IMPACT_LOW_THRESHOLD:
        return "low"
    elif ratio < REVISION_IMPACT_MEDIUM_THRESHOLD:
        return "medium"
    else:
        return "high"


def map_severity_to_impact(severity: str) -> str:
    """
    Map QA severity to impact level
    
    Args:
        severity: QA severity (low/medium/high/critical)
    
    Returns:
        Impact level for metrics
    """
    if severity == QA_SEVERITY_CRITICAL:
        return "critical"
    elif severity == QA_SEVERITY_HIGH:
        return "high"
    elif severity == QA_SEVERITY_MEDIUM:
        return "medium"
    else:
        return "low"


async def handle_qa_decision_workflow(
    task_id: str,
    project_id: str,
    reviewer_id: str,
    result: str,
    severity: str,
    issues: List[Dict[str, Any]],
    note: str = "",
    db = None
) -> Dict[str, Any]:
    """
    Complete QA decision workflow
    
    This is the MAIN HANDLER for QA decisions.
    
    Flow:
    1. Create QA decision (audit trail)
    2. Update task status
    3. Update earning status
    4. Calculate revision metrics from REAL logs
    5. Update first-pass success
    
    Args:
        task_id: Task ID
        project_id: Project ID
        reviewer_id: Admin/QA reviewer ID
        result: passed | failed | revision
        severity: Overall severity
        issues: List of specific issues
        note: Reviewer notes
    
    Returns:
        Complete workflow result with task + earning updates
    """
    now = datetime.now(timezone.utc)
    
    # 1. Create QA decision (audit trail)
    qa_decision = await create_qa_decision(
        task_id=task_id,
        project_id=project_id,
        reviewer_id=reviewer_id,
        result=result,
        severity=severity,
        issues=issues,
        note=note,
        db=db
    )
    
    # Get task
    task = await db.work_units.find_one({"unit_id": task_id}, {"_id": 0})
    if not task:
        raise ValueError(f"Task {task_id} not found")
    
    user_id = task.get("assigned_to")
    
    # 2. Update task status (normalized lifecycle)
    qa_iteration_count = qa_decision["iteration"]
    
    if result == QA_RESULT_PASSED:
        new_task_status = TASK_STATUS_DONE
        new_qa_status = QA_STATUS_PASSED
        first_pass_success = calculate_first_pass_success(qa_iteration_count, result)
        
        await db.work_units.update_one(
            {"unit_id": task_id},
            {"$set": {
                "status": new_task_status,
                "qa_status": new_qa_status,
                "qa_iteration_count": qa_iteration_count,
                "first_pass_qa": first_pass_success,
                "last_qa_result": result,
                "last_qa_at": now.isoformat(),
                "completed_at": now.isoformat()
            }}
        )
        
        # LIFECYCLE HOOK: Resolve all task-related events when completed
        try:
            from event_engine import resolve_event_on_task_completed
            await resolve_event_on_task_completed(db, task_id)
        except Exception as e:
            logger.warning(f"Failed to resolve task events: {e}")
    
    else:  # FAILED or REVISION
        new_task_status = TASK_STATUS_REVISION
        new_qa_status = QA_STATUS_REVISION
        first_pass_success = False
        
        await db.work_units.update_one(
            {"unit_id": task_id},
            {"$set": {
                "status": new_task_status,
                "qa_status": new_qa_status,
                "qa_iteration_count": qa_iteration_count,
                "first_pass_qa": first_pass_success,
                "last_qa_result": result,
                "last_qa_at": now.isoformat(),
                "revision_requested_at": now.isoformat()
            }}
        )
    
    # 3. Get revision hours from REAL time logs
    revision_data = await calculate_revision_hours_from_logs(task_id, user_id, db)
    
    # 4. Update earning
    from earnings_layer import EARNING_STATUS_APPROVED, EARNING_STATUS_HELD, EARNING_STATUS_FLAGGED
    
    earning = await db.task_earnings.find_one({"task_id": task_id}, {"_id": 0})
    
    if earning:
        # Check if frozen
        if earning.get("frozen"):
            logger.warning(f"Earning {earning['earning_id']} is frozen, skipping update")
        else:
            if result == QA_RESULT_PASSED:
                # QA passed - check confidence gate
                confidence_gate = earning.get("confidence_gate", {})
                
                if confidence_gate.get("requires_review") or confidence_gate.get("blocked_auto_approval"):
                    new_earning_status = EARNING_STATUS_FLAGGED
                else:
                    new_earning_status = EARNING_STATUS_APPROVED
                    
                    # Calculate quality adjustment based on iterations
                    from earnings_layer import apply_quality_adjustment, apply_time_adjustment, calculate_revision_impact
                    
                    earning["revision_count"] = qa_iteration_count - 1  # iterations - 1 = revisions
                    earning = await apply_quality_adjustment(earning, db)
                    earning = await apply_time_adjustment(earning, db)
                    
                    # Calculate final earning
                    final_earning = (
                        earning["base_earning"] +
                        earning.get("time_adjustment", 0) +
                        earning.get("quality_adjustment", 0) +
                        earning.get("manual_review_adjustment", 0)
                    )
                    final_earning = max(0, final_earning)
                    
                    earning["final_earning"] = round(final_earning, 2)
                
                # Update earning with QA data
                await db.task_earnings.update_one(
                    {"earning_id": earning["earning_id"]},
                    {"$set": {
                        "qa_status": "passed",
                        "earning_status": new_earning_status,
                        "qa_iteration_count": qa_iteration_count,
                        "first_pass_success": first_pass_success,
                        "revision_hours": revision_data["revision_hours"],
                        "qa_fix_hours": revision_data["qa_fix_hours"],
                        "qa_severity_max": severity,
                        "approved_at": now.isoformat() if new_earning_status == EARNING_STATUS_APPROVED else None,
                        "quality_adjustment": earning.get("quality_adjustment", 0),
                        "final_earning": earning.get("final_earning", earning["base_earning"]),
                        "updated_at": now.isoformat()
                    }}
                )

                # Phase 2B PR-2 — canonical mirror: when QA path approves
                # the earning, append a TaskEarningAccrued event to the
                # ledger. Bridge is internally exception-safe; if MoneyService
                # is unavailable the legacy update above remains authoritative.
                if new_earning_status == EARNING_STATUS_APPROVED:
                    from money_bridge import bridge_task_earning_approved
                    # Hydrate the updated earning fields the bridge needs
                    bridged = {**earning,
                               "earning_status": new_earning_status,
                               "approved_at": now.isoformat(),
                               "final_earning": earning.get("final_earning", earning["base_earning"]),
                               "approved_by": "qa_layer"}
                    await bridge_task_earning_approved(bridged)

                logger.info(f"EARNING UPDATED: {earning['earning_id']} - {new_earning_status} (first_pass: {first_pass_success})")
            
            else:  # REVISION needed
                new_earning_status = EARNING_STATUS_HELD
                
                await db.task_earnings.update_one(
                    {"earning_id": earning["earning_id"]},
                    {"$set": {
                        "qa_status": "revision",
                        "earning_status": new_earning_status,
                        "qa_iteration_count": qa_iteration_count,
                        "first_pass_success": False,
                        "revision_hours": revision_data["revision_hours"],
                        "qa_fix_hours": revision_data["qa_fix_hours"],
                        "qa_severity_max": severity,
                        "updated_at": now.isoformat()
                    }}
                )
                
                logger.info(f"EARNING HELD: {earning['earning_id']} - revision required (iteration {qa_iteration_count})")
    
    # 5. Calculate revision impact
    revision_impact_level = calculate_revision_impact_level(
        revision_data["total_revision_time"],
        task.get("actual_hours", 0)
    )
    
    # Return complete result
    return {
        "qa_decision": qa_decision,
        "task": {
            "task_id": task_id,
            "status": new_task_status,
            "qa_status": new_qa_status,
            "qa_iteration_count": qa_iteration_count,
            "first_pass_success": first_pass_success
        },
        "earning": {
            "earning_id": earning["earning_id"] if earning else None,
            "earning_status": new_earning_status if earning else None,
            "revision_hours": revision_data["revision_hours"],
            "qa_fix_hours": revision_data["qa_fix_hours"],
            "revision_impact_level": revision_impact_level
        } if earning else None,
        "revision_data": revision_data
    }


async def get_qa_history(
    task_id: str,
    db = None
) -> List[Dict[str, Any]]:
    """
    Get QA decision history for task
    
    Args:
        task_id: Task ID
    
    Returns:
        List of QA decisions (ordered by iteration)
    """
    decisions = await db.qa_decisions.find(
        {"task_id": task_id},
        {"_id": 0}
    ).sort("iteration", 1).to_list(100)
    
    return decisions


async def get_developer_qa_performance(
    user_id: str,
    period: str = "month",
    db = None
) -> Dict[str, Any]:
    """
    Get developer QA performance metrics
    
    Args:
        user_id: Developer ID
        period: today | week | month
    
    Returns:
        QA performance summary
    """
    from datetime import timedelta
    
    now = datetime.now(timezone.utc)
    
    if period == "today":
        period_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        days_since_monday = now.weekday()
        period_start = now - timedelta(days=days_since_monday)
        period_start = period_start.replace(hour=0, minute=0, second=0, microsecond=0)
    else:  # month
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    
    # Get tasks completed in period
    tasks = await db.work_units.find({
        "assigned_to": user_id,
        "status": "done",
        "completed_at": {"$gte": period_start.isoformat()}
    }, {"_id": 0}).to_list(500)
    
    if not tasks:
        return {
            "user_id": user_id,
            "period": period,
            "tasks_completed": 0,
            "first_pass_success_rate": 0,
            "avg_iterations": 0,
            "total_revision_hours": 0
        }
    
    # Calculate metrics
    first_pass_count = sum(1 for t in tasks if t.get("first_pass_qa", False))
    total_iterations = sum(t.get("qa_iteration_count", 1) for t in tasks)
    
    # Get revision hours
    total_revision_hours = 0
    for task in tasks:
        revision_data = await calculate_revision_hours_from_logs(task["unit_id"], user_id, db)
        total_revision_hours += revision_data["total_revision_time"]
    
    first_pass_rate = first_pass_count / len(tasks) if tasks else 0
    avg_iterations = total_iterations / len(tasks) if tasks else 0
    
    return {
        "user_id": user_id,
        "period": period,
        "period_start": period_start.isoformat(),
        "tasks_completed": len(tasks),
        "first_pass_success_count": first_pass_count,
        "first_pass_success_rate": round(first_pass_rate, 3),
        "avg_iterations": round(avg_iterations, 2),
        "total_revision_hours": round(total_revision_hours, 2),
        "total_revision_cost": round(total_revision_hours * 20, 2)  # Assuming $20/hr
    }
