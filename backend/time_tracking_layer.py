"""
Time Tracking Layer - Core (Step 2A)
Production-grade timer infrastructure

This is not a timer. This is:
- Labor accounting infrastructure
- Measurement layer on top of acceptance control point
- Foundation for earnings truth

Core Principle:
Task accepted → Timer started → Work measured → Session logged → Aggregates updated
"""

from typing import Optional, Dict, Any, List
from datetime import datetime, timezone, timedelta
import logging
import uuid

logger = logging.getLogger(__name__)

# ============ CONSTANTS ============

# Time categories
CATEGORY_EXECUTION = "execution"
CATEGORY_DEBUGGING = "debugging"
CATEGORY_REVISION = "revision"
CATEGORY_COMMUNICATION = "communication"
CATEGORY_QA_FIX = "qa_fix"

VALID_CATEGORIES = [
    CATEGORY_EXECUTION,
    CATEGORY_DEBUGGING,
    CATEGORY_REVISION,
    CATEGORY_COMMUNICATION,
    CATEGORY_QA_FIX
]

# Allowed task statuses for timer
TIMER_ALLOWED_STATUSES = ["accepted", "in_progress", "revision"]

# Timer limits
MIN_SESSION_MINUTES = 1  # Minimum 1 minute
MAX_SESSION_HOURS = 12  # Maximum 12 hours


# ============ ACTIVE TIMER MANAGEMENT ============

async def get_active_timer(user_id: str, db) -> Optional[Dict[str, Any]]:
    """
    Get developer's active timer
    
    Returns None if no active timer
    """
    timer = await db.active_timers.find_one({"user_id": user_id}, {"_id": 0})
    
    if timer:
        # Calculate elapsed time
        started_at = datetime.fromisoformat(timer["started_at"].replace('Z', '+00:00'))
        now = datetime.now(timezone.utc)
        elapsed = now - started_at
        elapsed_minutes = int(elapsed.total_seconds() / 60)
        
        # Get task details
        task = await db.work_units.find_one({"unit_id": timer["task_id"]}, {"_id": 0})
        
        return {
            **timer,
            "elapsed_minutes": elapsed_minutes,
            "task_title": task.get("title") if task else "Unknown",
            "project_name": task.get("project_name") if task else "Unknown"
        }
    
    return None


async def start_timer(
    user_id: str,
    task_id: str,
    category: str,
    note: Optional[str] = None,
    db = None
) -> Dict[str, Any]:
    """
    Start timer session
    
    This is a truth action - work begins here
    
    Rules:
    1. Only one active timer per developer
    2. Timer only on accepted/in_progress/revision tasks
    3. If task = accepted → auto transition to in_progress
    4. Cannot timer other developer's task
    
    Returns:
        Timer record or raises exception
    """
    # Validate category
    if category not in VALID_CATEGORIES:
        raise ValueError(f"Invalid category. Must be one of: {VALID_CATEGORIES}")
    
    # Check: No existing active timer
    existing_timer = await db.active_timers.find_one({"user_id": user_id}, {"_id": 0})
    if existing_timer:
        raise ValueError(f"You already have an active timer running on task {existing_timer['task_id']}")
    
    # Get task
    task = await db.work_units.find_one({"unit_id": task_id}, {"_id": 0})
    if not task:
        raise ValueError(f"Task {task_id} not found")
    
    # Check: Task assigned to user
    if task.get("assigned_to") != user_id:
        raise ValueError("Cannot start timer on task not assigned to you")
    
    # Check: Task status allows timer
    task_status = task.get("status")
    if task_status not in TIMER_ALLOWED_STATUSES:
        raise ValueError(f"Cannot start timer on task with status '{task_status}'. Allowed: {TIMER_ALLOWED_STATUSES}")
    
    # Check: No other timer on this task
    other_timer = await db.active_timers.find_one({"task_id": task_id}, {"_id": 0})
    if other_timer:
        raise ValueError("Another developer already has a timer running on this task")
    
    now = datetime.now(timezone.utc)
    
    # Create active timer
    timer_doc = {
        "timer_id": f"timer_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "task_id": task_id,
        "project_id": task.get("project_id"),
        "category": category,
        "started_at": now.isoformat(),
        "note": note or "",
        "created_at": now.isoformat()
    }
    
    await db.active_timers.insert_one(timer_doc)
    
    # Update task: Mark timer active
    update_data = {
        "active_timer_user_id": user_id,
        "active_timer_lock_reason": category,  # NEW: Why working (execution/revision)
        "last_tracked_at": now.isoformat()
    }
    
    # Auto-transition: accepted → in_progress
    if task_status == "accepted":
        update_data["status"] = "in_progress"
        update_data["started_at"] = now.isoformat()
        
        # Track first timer start (gold metric)
        if not task.get("first_timer_started_at"):
            update_data["first_timer_started_at"] = now.isoformat()
        
        logger.info(f"TASK AUTO-TRANSITION: {task_id} accepted → in_progress (timer started)")
    
    await db.work_units.update_one(
        {"unit_id": task_id},
        {"$set": update_data}
    )
    
    logger.info(f"TIMER STARTED: {timer_doc['timer_id']} by {user_id} on {task_id} ({category})")
    
    return {
        "timer_id": timer_doc["timer_id"],
        "task_id": task_id,
        "category": category,
        "started_at": timer_doc["started_at"],
        "message": "Timer started",
        "task_status_changed": task_status == "accepted"
    }


async def stop_timer(
    user_id: str,
    note: Optional[str] = None,
    source: str = "manual_stop",
    db = None
) -> Dict[str, Any]:
    """
    Stop active timer
    
    Creates time_log entry and updates task aggregates
    
    Args:
        user_id: Developer ID
        note: Optional note about the work done
        source: 'manual_stop' | 'submit_auto_stop' | 'system_cleanup'
    
    Returns:
        Time log record
    """
    # Find active timer
    timer = await db.active_timers.find_one({"user_id": user_id}, {"_id": 0})
    
    if not timer:
        # No active timer - idempotency
        return {
            "message": "No active timer to stop",
            "already_stopped": True
        }
    
    now = datetime.now(timezone.utc)
    started_at = datetime.fromisoformat(timer["started_at"].replace('Z', '+00:00'))
    
    # Calculate duration
    duration = now - started_at
    duration_minutes = int(duration.total_seconds() / 60)
    duration_hours = round(duration_minutes / 60, 2)
    
    # Sanity check: Minimum 1 minute
    if duration_minutes < MIN_SESSION_MINUTES:
        logger.warning(f"Timer session too short: {duration_minutes}m. Setting to {MIN_SESSION_MINUTES}m")
        duration_minutes = MIN_SESSION_MINUTES
        duration_hours = round(MIN_SESSION_MINUTES / 60, 2)
    
    # Sanity check: Maximum 12 hours
    if duration_hours > MAX_SESSION_HOURS:
        logger.warning(f"Timer session too long: {duration_hours}h. Capping at {MAX_SESSION_HOURS}h")
        duration_hours = MAX_SESSION_HOURS
        duration_minutes = MAX_SESSION_HOURS * 60
    
    # Create time log entry
    log_doc = {
        "log_id": f"tlog_{uuid.uuid4().hex[:12]}",
        "task_id": timer["task_id"],
        "project_id": timer.get("project_id"),
        "user_id": user_id,
        
        "type": "timer",  # This was a live timer session
        "source": source,
        "category": timer["category"],
        
        "started_at": timer["started_at"],
        "ended_at": now.isoformat(),
        "duration_minutes": duration_minutes,
        "duration_hours": duration_hours,
        
        "note": note or timer.get("note", ""),
        
        "created_at": now.isoformat(),
        "updated_at": None
    }
    
    await db.time_logs.insert_one(log_doc)
    
    # Delete active timer
    await db.active_timers.delete_one({"user_id": user_id})
    
    # Update task: Clear active timer flag
    await db.work_units.update_one(
        {"unit_id": timer["task_id"]},
        {
            "$set": {
                "active_timer_user_id": None,
                "last_tracked_at": now.isoformat()
            }
        }
    )
    
    # Recalculate task time aggregates
    await recalculate_task_time_aggregates(timer["task_id"], db)
    
    logger.info(f"TIMER STOPPED: {timer['timer_id']} by {user_id} - {duration_hours}h logged ({source})")
    
    return {
        "log_id": log_doc["log_id"],
        "duration_minutes": duration_minutes,
        "duration_hours": duration_hours,
        "category": timer["category"],
        "task_id": timer["task_id"],
        "message": "Timer stopped and session logged"
    }


# ============ AGGREGATION ============

async def recalculate_task_time_aggregates(task_id: str, db) -> Dict[str, Any]:
    """
    Recalculate task time from all logs
    
    Updates:
    - actual_hours
    - time_breakdown (by category)
    - timer_count
    - manual_entry_count
    - actual_vs_estimated_ratio
    - first_timer_started_at (NEW - trust metric)
    - manual_ratio_task (NEW - trust metric)
    - last_manual_log_at, last_timer_log_at (NEW)
    
    This is critical for earnings calculation later
    """
    # Get all time logs for task (excluding deleted)
    logs = await db.time_logs.find({
        "task_id": task_id,
        "deleted": {"$ne": True}
    }, {"_id": 0}).sort("started_at", 1).to_list(500)
    
    if not logs:
        # No logs yet - reset to zero
        await db.work_units.update_one(
            {"unit_id": task_id},
            {
                "$set": {
                    "actual_hours": 0,
                    "time_breakdown": {},
                    "timer_count": 0,
                    "manual_entry_count": 0,
                    "actual_vs_estimated_ratio": 0,
                    "manual_ratio_task": 0
                }
            }
        )
        return {"actual_hours": 0, "time_breakdown": {}}
    
    # Calculate total hours
    total_hours = sum(log["duration_hours"] for log in logs)
    
    # Breakdown by category
    breakdown = {}
    for log in logs:
        category = log["category"]
        breakdown[category] = round(breakdown.get(category, 0) + log["duration_hours"], 2)
    
    # Count timer vs manual
    timer_count = sum(1 for log in logs if log["type"] == "timer")
    manual_count = sum(1 for log in logs if log["type"] == "manual")
    
    # Calculate manual/timer ratio for task
    manual_hours = sum(log["duration_hours"] for log in logs if log["type"] == "manual")
    manual_ratio = manual_hours / total_hours if total_hours > 0 else 0
    
    # Find first timer start (gold metric for actual work start)
    first_timer_log = next((log for log in logs if log["type"] == "timer"), None)
    first_timer_started_at = first_timer_log["started_at"] if first_timer_log else None
    
    # Find last manual/timer timestamps
    manual_logs = [log for log in logs if log["type"] == "manual"]
    timer_logs = [log for log in logs if log["type"] == "timer"]
    
    last_manual_log_at = manual_logs[-1]["started_at"] if manual_logs else None
    last_timer_log_at = timer_logs[-1]["started_at"] if timer_logs else None
    
    # Get task estimated hours for ratio
    task = await db.work_units.find_one({"unit_id": task_id}, {"_id": 0})
    estimated_hours = task.get("estimated_hours", 0) if task else 0
    
    # Calculate ratio
    ratio = round(total_hours / estimated_hours, 2) if estimated_hours > 0 else 0
    
    # Prepare update
    update_data = {
        "actual_hours": round(total_hours, 2),
        "time_breakdown": breakdown,
        "timer_count": timer_count,
        "manual_entry_count": manual_count,
        "actual_vs_estimated_ratio": ratio,
        "manual_ratio_task": round(manual_ratio, 3),
        "last_tracked_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Only set first_timer_started_at if we found one and it's not already set
    if first_timer_started_at and not task.get("first_timer_started_at"):
        update_data["first_timer_started_at"] = first_timer_started_at
    
    if last_manual_log_at:
        update_data["last_manual_log_at"] = last_manual_log_at
    
    if last_timer_log_at:
        update_data["last_timer_log_at"] = last_timer_log_at
    
    # Update task
    await db.work_units.update_one(
        {"unit_id": task_id},
        {"$set": update_data}
    )
    
    logger.info(f"TASK AGGREGATES UPDATED: {task_id} - {round(total_hours, 2)}h total (manual_ratio: {round(manual_ratio, 2)})")
    
    return {
        "actual_hours": round(total_hours, 2),
        "time_breakdown": breakdown,
        "timer_count": timer_count,
        "manual_entry_count": manual_count,
        "manual_ratio": round(manual_ratio, 3)
    }


# ============ MANUAL TIME ENTRY (STEP 2B) ============

# Constants
MAX_MANUAL_ENTRY_HOURS = 12
MAX_DAILY_HOURS = 16
MANUAL_TIME_ABUSE_THRESHOLD = 0.5  # 50%
TIME_EDIT_WINDOW_HOURS = 24


async def add_manual_time(
    user_id: str,
    task_id: str,
    duration_minutes: int,
    category: str,
    note: str,
    started_at: Optional[str] = None,
    manual_reason_type: Optional[str] = None,
    db = None
) -> Dict[str, Any]:
    """
    Add manual time entry
    
    This is correction layer - use when timer wasn't running
    
    Rules:
    1. Duration: 5min - 12h per entry
    2. Cannot overlap with active timer
    3. Cannot exceed 16h per day total
    4. Category required
    5. Cannot log future time
    6. Task must be assigned to user
    7. Reason type recommended for trust tracking
    
    Args:
        user_id: Developer ID
        task_id: Task ID
        duration_minutes: Duration (5-720 minutes)
        category: Time category (required)
        note: Description of work done (required)
        started_at: When work started (optional, defaults to now - duration)
        manual_reason_type: Why manual entry needed (optional but recommended)
    """
    # Validate category
    if category not in VALID_CATEGORIES:
        raise ValueError(f"Invalid category. Must be one of: {VALID_CATEGORIES}")
    
    # Validate manual reason type if provided
    if manual_reason_type and manual_reason_type not in VALID_MANUAL_REASONS:
        raise ValueError(f"Invalid manual_reason_type. Must be one of: {VALID_MANUAL_REASONS}")
    
    # Validate note
    if not note or not note.strip():
        raise ValueError("Note is required for manual time entry")
    
    # Validate duration: 5min - 12h
    if duration_minutes < 5:
        raise ValueError("Duration must be at least 5 minutes")
    
    if duration_minutes > MAX_MANUAL_ENTRY_HOURS * 60:
        raise ValueError(f"Duration cannot exceed {MAX_MANUAL_ENTRY_HOURS} hours per entry")
    
    # Get task
    task = await db.work_units.find_one({"unit_id": task_id}, {"_id": 0})
    if not task:
        raise ValueError(f"Task {task_id} not found")
    
    # Check: Task assigned to user
    if task.get("assigned_to") != user_id:
        raise ValueError("Cannot log time on task not assigned to you")
    
    # Calculate timestamps
    now = datetime.now(timezone.utc)
    
    if started_at:
        start_dt = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
        
        # Cannot log future time
        if start_dt > now:
            raise ValueError("Cannot log time in the future")
    else:
        # Default: now - duration
        start_dt = now - timedelta(minutes=duration_minutes)
    
    end_dt = start_dt + timedelta(minutes=duration_minutes)
    
    # Cannot end in future
    if end_dt > now:
        raise ValueError("End time cannot be in the future")
    
    # Check: No active timer (cannot overlap)
    active_timer = await db.active_timers.find_one({"user_id": user_id}, {"_id": 0})
    if active_timer:
        raise ValueError("Cannot add manual time while timer is running. Stop timer first.")
    
    # Check: Daily total limit (16h per day)
    day_start = start_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    
    # Get existing logs for this day
    day_logs = await db.time_logs.find({
        "user_id": user_id,
        "started_at": {
            "$gte": day_start.isoformat(),
            "$lt": day_end.isoformat()
        }
    }, {"_id": 0}).to_list(100)
    
    existing_day_minutes = sum(log["duration_minutes"] for log in day_logs)
    new_total = existing_day_minutes + duration_minutes
    
    if new_total > MAX_DAILY_HOURS * 60:
        raise ValueError(
            f"Daily limit exceeded. You already have {existing_day_minutes / 60:.1f}h logged today. "
            f"Maximum is {MAX_DAILY_HOURS}h per day."
        )
    
    duration_hours = round(duration_minutes / 60, 2)
    
    # Create time log entry
    log_doc = {
        "log_id": f"tlog_{uuid.uuid4().hex[:12]}",
        "task_id": task_id,
        "project_id": task.get("project_id"),
        "user_id": user_id,
        
        "type": "manual",  # Manual entry, not timer session
        "source": "manual_addition",
        "category": category,
        
        "started_at": start_dt.isoformat(),
        "ended_at": end_dt.isoformat(),
        "duration_minutes": duration_minutes,
        "duration_hours": duration_hours,
        
        "note": note.strip(),
        
        # Manual entry metadata (trust layer)
        "manual_reason_type": manual_reason_type,  # Why manual entry was needed
        
        # Session integrity flags
        "is_system_generated": False,
        "is_recovered_session": False,
        "is_capped": False,
        
        "created_at": now.isoformat(),
        "updated_at": None,
        "created_by": user_id
    }
    
    await db.time_logs.insert_one(log_doc)
    
    # Recalculate task time aggregates
    await recalculate_task_time_aggregates(task_id, db)
    
    # Update developer manual time ratio
    await update_developer_manual_ratio(user_id, db)
    
    logger.info(f"MANUAL TIME ADDED: {log_doc['log_id']} by {user_id} - {duration_hours}h on {task_id} ({category})")
    
    return {
        "log_id": log_doc["log_id"],
        "duration_minutes": duration_minutes,
        "duration_hours": duration_hours,
        "category": category,
        "task_id": task_id,
        "message": "Manual time logged successfully"
    }


async def update_developer_manual_ratio(user_id: str, db):
    """
    Calculate and update developer's manual vs timer ratio
    
    Flags if manual > 50% (abuse threshold)
    """
    # Get all time logs for past week
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    
    logs = await db.time_logs.find({
        "user_id": user_id,
        "started_at": {"$gte": week_ago.isoformat()}
    }, {"_id": 0}).to_list(500)
    
    if not logs:
        return
    
    # Calculate manual vs timer
    manual_minutes = sum(log["duration_minutes"] for log in logs if log["type"] == "manual")
    timer_minutes = sum(log["duration_minutes"] for log in logs if log["type"] == "timer")
    total_minutes = manual_minutes + timer_minutes
    
    manual_ratio = manual_minutes / total_minutes if total_minutes > 0 else 0
    
    # Flag if abuse threshold exceeded
    manual_time_flag = manual_ratio > MANUAL_TIME_ABUSE_THRESHOLD
    
    # Update developer record
    await db.users.update_one(
        {"user_id": user_id},
        {
            "$set": {
                "manual_vs_timer_ratio": round(manual_ratio, 2),
                "manual_time_flag": manual_time_flag,
                "manual_time_ratio_updated_at": datetime.now(timezone.utc).isoformat()
            }
        }
    )
    
    # Alert admin if flagged
    if manual_time_flag:
        logger.warning(f"MANUAL TIME ABUSE FLAG: {user_id} - {round(manual_ratio * 100, 1)}% manual time this week")


async def edit_time_log(
    log_id: str,
    user_id: str,
    duration_minutes: Optional[int] = None,
    category: Optional[str] = None,
    note: Optional[str] = None,
    db = None
) -> Dict[str, Any]:
    """
    Edit time log entry
    
    Rules:
    1. Can only edit within 24h of creation
    2. Can only edit own logs
    3. Admin can edit anytime
    
    Args:
        log_id: Time log ID
        user_id: User requesting edit
        duration_minutes: New duration (optional)
        category: New category (optional)
        note: New note (optional)
    """
    # Get log
    log = await db.time_logs.find_one({"log_id": log_id}, {"_id": 0})
    if not log:
        raise ValueError(f"Time log {log_id} not found")
    
    # Check ownership
    if log["user_id"] != user_id:
        # Only admin can edit other's logs
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        if user.get("role") != "admin":
            raise ValueError("Cannot edit time log of another user")
    
    # Check edit window (24h)
    created_at = datetime.fromisoformat(log["created_at"].replace('Z', '+00:00'))
    now = datetime.now(timezone.utc)
    hours_since_creation = (now - created_at).total_seconds() / 3600
    
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if user.get("role") != "admin" and hours_since_creation > TIME_EDIT_WINDOW_HOURS:
        raise ValueError(f"Cannot edit time log older than {TIME_EDIT_WINDOW_HOURS} hours. Contact admin for changes.")
    
    # Build update
    update_data = {
        "updated_at": now.isoformat()
    }
    
    if duration_minutes is not None:
        # Validate duration
        if duration_minutes < 5:
            raise ValueError("Duration must be at least 5 minutes")
        if duration_minutes > MAX_MANUAL_ENTRY_HOURS * 60:
            raise ValueError(f"Duration cannot exceed {MAX_MANUAL_ENTRY_HOURS} hours")
        
        update_data["duration_minutes"] = duration_minutes
        update_data["duration_hours"] = round(duration_minutes / 60, 2)
        
        # Recalculate end time
        started_at = datetime.fromisoformat(log["started_at"].replace('Z', '+00:00'))
        new_end = started_at + timedelta(minutes=duration_minutes)
        update_data["ended_at"] = new_end.isoformat()
    
    if category is not None:
        if category not in VALID_CATEGORIES:
            raise ValueError(f"Invalid category. Must be one of: {VALID_CATEGORIES}")
        update_data["category"] = category
    
    if note is not None:
        if not note.strip():
            raise ValueError("Note cannot be empty")
        update_data["note"] = note.strip()
    
    # Update log
    await db.time_logs.update_one(
        {"log_id": log_id},
        {"$set": update_data}
    )
    
    # Recalculate task aggregates
    await recalculate_task_time_aggregates(log["task_id"], db)
    
    logger.info(f"TIME LOG EDITED: {log_id} by {user_id}")
    
    return {
        "log_id": log_id,
        "message": "Time log updated successfully",
        "updated_fields": list(update_data.keys())
    }


async def delete_time_log(
    log_id: str,
    user_id: str,
    reason: str,
    db = None
) -> Dict[str, Any]:
    """
    Delete time log entry
    
    Rules:
    1. Can only delete within 24h
    2. Admin can delete anytime
    3. Reason required
    """
    # Get log
    log = await db.time_logs.find_one({"log_id": log_id}, {"_id": 0})
    if not log:
        raise ValueError(f"Time log {log_id} not found")
    
    # Check ownership
    if log["user_id"] != user_id:
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        if user.get("role") != "admin":
            raise ValueError("Cannot delete time log of another user")
    
    # Check edit window
    created_at = datetime.fromisoformat(log["created_at"].replace('Z', '+00:00'))
    now = datetime.now(timezone.utc)
    hours_since_creation = (now - created_at).total_seconds() / 3600
    
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if user.get("role") != "admin" and hours_since_creation > TIME_EDIT_WINDOW_HOURS:
        raise ValueError(f"Cannot delete time log older than {TIME_EDIT_WINDOW_HOURS} hours. Contact admin.")
    
    # Soft delete (mark as deleted, don't remove)
    await db.time_logs.update_one(
        {"log_id": log_id},
        {
            "$set": {
                "deleted": True,
                "deleted_at": now.isoformat(),
                "deleted_by": user_id,
                "deletion_reason": reason
            }
        }
    )
    
    # Recalculate task aggregates (excluding deleted logs)
    await recalculate_task_time_aggregates(log["task_id"], db)
    
    logger.info(f"TIME LOG DELETED: {log_id} by {user_id} - {reason}")
    
    return {
        "log_id": log_id,
        "message": "Time log deleted successfully"
    }


async def get_developer_manual_time_stats(user_id: str, db) -> Dict[str, Any]:
    """
    Get developer's manual time statistics
    
    For monitoring abuse/discipline
    """
    # Past week
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    
    logs = await db.time_logs.find({
        "user_id": user_id,
        "started_at": {"$gte": week_ago.isoformat()},
        "deleted": {"$ne": True}
    }, {"_id": 0}).to_list(500)
    
    if not logs:
        return {
            "total_hours": 0,
            "manual_hours": 0,
            "timer_hours": 0,
            "manual_ratio": 0,
            "flagged": False
        }
    
    manual_minutes = sum(log["duration_minutes"] for log in logs if log["type"] == "manual")
    timer_minutes = sum(log["duration_minutes"] for log in logs if log["type"] == "timer")
    total_minutes = manual_minutes + timer_minutes
    
    manual_ratio = manual_minutes / total_minutes if total_minutes > 0 else 0
    flagged = manual_ratio > MANUAL_TIME_ABUSE_THRESHOLD
    
    return {
        "total_hours": round(total_minutes / 60, 2),
        "manual_hours": round(manual_minutes / 60, 2),
        "timer_hours": round(timer_minutes / 60, 2),
        "manual_ratio": round(manual_ratio, 2),
        "manual_percentage": round(manual_ratio * 100, 1),
        "flagged": flagged,
        "threshold": MANUAL_TIME_ABUSE_THRESHOLD
    }


# ============ UTILITIES ============

async def get_task_time_logs(task_id: str, db, limit: int = 100) -> List[Dict[str, Any]]:
    """
    Get all time logs for a task
    
    Returns logs sorted by started_at (newest first)
    """
    logs = await db.time_logs.find(
        {"task_id": task_id},
        {"_id": 0}
    ).sort("started_at", -1).limit(limit).to_list(limit)
    
    return logs


async def auto_stop_timer_on_submit(task_id: str, db) -> Optional[Dict[str, Any]]:
    """
    Auto-stop timer when task is submitted
    
    Called from task submission endpoint
    """
    # Find active timer on this task
    timer = await db.active_timers.find_one({"task_id": task_id}, {"_id": 0})
    
    if not timer:
        return None
    
    user_id = timer["user_id"]
    
    # Stop timer with special source
    result = await stop_timer(
        user_id=user_id,
        note="Auto-stopped on task submission",
        source="submit_auto_stop",
        db=db
    )
    
    logger.info(f"TIMER AUTO-STOPPED ON SUBMIT: {task_id}")
    
    return result


async def validate_timer_state(user_id: str, db) -> Dict[str, Any]:
    """
    Validate developer's timer state
    
    Checks for inconsistencies and returns status
    """
    active_timer = await db.active_timers.find_one({"user_id": user_id}, {"_id": 0})
    
    if not active_timer:
        return {
            "has_active_timer": False,
            "status": "ok"
        }
    
    # Check if timer is stale (> 12 hours)
    started_at = datetime.fromisoformat(active_timer["started_at"].replace('Z', '+00:00'))
    now = datetime.now(timezone.utc)
    elapsed = now - started_at
    elapsed_hours = elapsed.total_seconds() / 3600
    
    if elapsed_hours > 12:
        return {
            "has_active_timer": True,
            "status": "stale",
            "timer": active_timer,
            "elapsed_hours": round(elapsed_hours, 1),
            "warning": "Timer has been running for over 12 hours"
        }
    
    # Check if task still exists and assigned
    task = await db.work_units.find_one({"unit_id": active_timer["task_id"]}, {"_id": 0})
    
    if not task:
        return {
            "has_active_timer": True,
            "status": "orphaned",
            "timer": active_timer,
            "warning": "Task no longer exists"
        }
    
    if task.get("assigned_to") != user_id:
        return {
            "has_active_timer": True,
            "status": "mismatched",
            "timer": active_timer,
            "warning": "Task no longer assigned to you"
        }
    
    return {
        "has_active_timer": True,
        "status": "ok",
        "timer": active_timer,
        "elapsed_hours": round(elapsed_hours, 2)
    }


# ============ RECOVERY & CLEANUP ============

async def cleanup_stale_timers(db, hours_threshold: int = 12) -> List[Dict[str, Any]]:
    """
    Find and auto-stop timers running > threshold hours
    
    This is a recovery job, run periodically
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours_threshold)
    
    stale_timers = await db.active_timers.find({
        "started_at": {"$lt": cutoff.isoformat()}
    }, {"_id": 0}).to_list(100)
    
    cleaned = []
    
    for timer in stale_timers:
        user_id = timer["user_id"]
        
        # Auto-stop
        await stop_timer(
            user_id=user_id,
            note=f"Auto-stopped: session exceeded {hours_threshold} hours",
            source="system_cleanup",
            db=db
        )
        
        cleaned.append({
            "timer_id": timer["timer_id"],
            "user_id": user_id,
            "task_id": timer["task_id"],
            "elapsed_hours": round((datetime.now(timezone.utc) - datetime.fromisoformat(timer["started_at"].replace('Z', '+00:00'))).total_seconds() / 3600, 1)
        })
        
        logger.warning(f"STALE TIMER CLEANED: {timer['timer_id']} - {user_id}")
    
    return cleaned


async def recover_timer_on_login(user_id: str, db) -> Optional[Dict[str, Any]]:
    """
    Check for active timer on login
    
    Returns timer info for UI to show "Resume?" prompt
    """
    timer_state = await validate_timer_state(user_id, db)
    
    if not timer_state["has_active_timer"]:
        return None
    
    if timer_state["status"] == "stale":
        # Auto-stop stale timer
        await stop_timer(
            user_id=user_id,
            note="Auto-stopped: stale session on login",
            source="login_recovery",
            db=db
        )
        return {
            "action": "auto_stopped",
            "reason": "Timer was running for over 12 hours"
        }
    
    if timer_state["status"] in ["orphaned", "mismatched"]:
        # Delete orphaned timer
        await db.active_timers.delete_one({"user_id": user_id})
        return {
            "action": "deleted",
            "reason": "Timer was on invalid task"
        }
    
    # Valid timer - return for resume prompt
    return {
        "action": "resume_prompt",
        "timer": timer_state["timer"],
        "elapsed_hours": timer_state["elapsed_hours"]
    }



# ============ TRUST & CONFIDENCE LAYER (STEP 2 ENHANCEMENTS) ============

# Manual reason types
VALID_MANUAL_REASONS = [
    "forgot_timer",
    "interruption",
    "offline_work",
    "retroactive_correction",
    "meeting_untracked",
    "other"
]

# Suspicious pattern types
PATTERN_MANUAL_SPAM = "manual_spam"
PATTERN_MANUAL_HEAVY = "manual_heavy"
PATTERN_MAXED_ENTRIES = "maxed_entries"
PATTERN_FRAGMENTATION = "fragmentation"
PATTERN_LATE_LOGGING = "late_logging"
PATTERN_TIME_BURST = "time_burst"
PATTERN_NIGHT_ANOMALY = "night_anomaly"
PATTERN_ZERO_EXECUTION = "zero_execution"

# Thresholds
SUSPICIOUS_THRESHOLD = 0.7
MANUAL_RATIO_WARNING = 0.35
MANUAL_RATIO_DANGER = 0.5
NIGHT_START_HOUR = 2
NIGHT_END_HOUR = 5


async def compute_suspicious_patterns(
    user_id: str,
    period_start: datetime,
    period_end: datetime,
    db
) -> Dict[str, Any]:
    """
    Detect suspicious time logging patterns
    
    Returns 8 pattern types with evidence and composite score
    
    Args:
        user_id: Developer ID
        period_start: Start of analysis period
        period_end: End of analysis period
    
    Returns:
        {
            "patterns": [...],  # List of detected patterns
            "suspicious_score": 0.0-1.0,
            "flagged": bool
        }
    """
    # Get all logs for period
    logs = await db.time_logs.find({
        "user_id": user_id,
        "started_at": {
            "$gte": period_start.isoformat(),
            "$lt": period_end.isoformat()
        },
        "deleted": {"$ne": True}
    }, {"_id": 0}).sort("started_at", 1).to_list(1000)
    
    if not logs:
        return {
            "patterns": [],
            "suspicious_score": 0.0,
            "flagged": False
        }
    
    patterns = []
    weights_total = 0.0
    
    # Pattern 1: Manual spam (>3 manual подряд за короткий период)
    manual_consecutive = 0
    max_manual_consecutive = 0
    for log in logs:
        if log["type"] == "manual":
            manual_consecutive += 1
            max_manual_consecutive = max(max_manual_consecutive, manual_consecutive)
        else:
            manual_consecutive = 0
    
    if max_manual_consecutive > 3:
        severity = min(0.3 + (max_manual_consecutive - 3) * 0.1, 1.0)
        patterns.append({
            "type": PATTERN_MANUAL_SPAM,
            "severity": round(severity, 2),
            "evidence": f"{max_manual_consecutive} consecutive manual entries",
            "weight": severity * 0.15,
            "recommended_action": "Review manual entry reasons. Consider using timer more consistently."
        })
        weights_total += severity * 0.15
    
    # Pattern 2: Manual heavy (manual_ratio > 0.5)
    manual_minutes = sum(log["duration_minutes"] for log in logs if log["type"] == "manual")
    total_minutes = sum(log["duration_minutes"] for log in logs)
    manual_ratio = manual_minutes / total_minutes if total_minutes > 0 else 0
    
    if manual_ratio > MANUAL_RATIO_DANGER:
        severity = min((manual_ratio - MANUAL_RATIO_DANGER) * 2 + 0.5, 1.0)
        patterns.append({
            "type": PATTERN_MANUAL_HEAVY,
            "severity": round(severity, 2),
            "evidence": f"{round(manual_ratio * 100, 1)}% manual time (threshold: 50%)",
            "weight": severity * 0.2,
            "recommended_action": "Manual entries exceed 50% of total. Start using timer for all sessions."
        })
        weights_total += severity * 0.2
    
    # Pattern 3: Maxed entries (часто записи близко к лимиту 10-12h)
    maxed_count = sum(1 for log in logs if log["duration_hours"] >= 10)
    maxed_ratio = maxed_count / len(logs) if logs else 0
    
    if maxed_ratio > 0.15:  # >15% of logs are 10+ hours
        severity = min(maxed_ratio * 3, 1.0)
        patterns.append({
            "type": PATTERN_MAXED_ENTRIES,
            "severity": round(severity, 2),
            "evidence": f"{maxed_count} entries ≥10h out of {len(logs)} total",
            "weight": severity * 0.12,
            "recommended_action": "Many long sessions detected. Split work into realistic chunks."
        })
        weights_total += severity * 0.12
    
    # Pattern 4: Fragmentation (много мелких записей <10 мин)
    fragmented_count = sum(1 for log in logs if log["duration_minutes"] < 10)
    fragmented_ratio = fragmented_count / len(logs) if logs else 0
    
    if fragmented_ratio > 0.3:  # >30% are <10 min
        severity = min(fragmented_ratio * 2, 1.0)
        patterns.append({
            "type": PATTERN_FRAGMENTATION,
            "severity": round(severity, 2),
            "evidence": f"{fragmented_count} entries <10min out of {len(logs)} total",
            "weight": severity * 0.1,
            "recommended_action": "Many micro-sessions detected. Consider batching small tasks."
        })
        weights_total += severity * 0.1
    
    # Pattern 5: Late logging (delay > 2-4h)
    late_logs = []
    for log in logs:
        if log["type"] == "manual":
            started_at = datetime.fromisoformat(log["started_at"].replace('Z', '+00:00'))
            created_at = datetime.fromisoformat(log["created_at"].replace('Z', '+00:00'))
            delay_hours = (created_at - started_at).total_seconds() / 3600
            
            if delay_hours > 4:
                late_logs.append((log["log_id"], delay_hours))
    
    if late_logs:
        manual_logs = [log for log in logs if log["type"] == "manual"]
        late_ratio = len(late_logs) / len(manual_logs) if manual_logs else 0
        if late_ratio > 0.3:
            severity = min(late_ratio * 1.5, 1.0)
            avg_delay = sum(d for _, d in late_logs) / len(late_logs)
            patterns.append({
                "type": PATTERN_LATE_LOGGING,
                "severity": round(severity, 2),
                "evidence": f"{len(late_logs)} manual entries logged {round(avg_delay, 1)}h after work",
                "weight": severity * 0.13,
                "recommended_action": "Log time promptly to improve accuracy and trust."
            })
            weights_total += severity * 0.13
    
    # Pattern 6: Time burst (5-6 записей за 1-2 минуты)
    burst_groups = []
    sorted_logs = sorted(logs, key=lambda x: x["created_at"])
    
    for i in range(len(sorted_logs) - 4):
        window = sorted_logs[i:i+5]
        first_created = datetime.fromisoformat(window[0]["created_at"].replace('Z', '+00:00'))
        last_created = datetime.fromisoformat(window[-1]["created_at"].replace('Z', '+00:00'))
        window_minutes = (last_created - first_created).total_seconds() / 60
        
        if window_minutes < 2:  # 5 logs in <2 minutes
            burst_groups.append(window_minutes)
    
    if burst_groups:
        severity = min(len(burst_groups) * 0.3, 1.0)
        patterns.append({
            "type": PATTERN_TIME_BURST,
            "severity": round(severity, 2),
            "evidence": f"{len(burst_groups)} burst groups detected (5+ entries in <2min)",
            "weight": severity * 0.15,
            "recommended_action": "Avoid logging multiple entries at once. Log in real-time."
        })
        weights_total += severity * 0.15
    
    # Pattern 7: Night anomaly (регулярно 2-5 ночи + высокая активность)
    night_logs = []
    for log in logs:
        started_at = datetime.fromisoformat(log["started_at"].replace('Z', '+00:00'))
        hour = started_at.hour
        
        if NIGHT_START_HOUR <= hour < NIGHT_END_HOUR:
            night_logs.append(log)
    
    night_ratio = len(night_logs) / len(logs) if logs else 0
    night_minutes = sum(log["duration_minutes"] for log in night_logs)
    
    if night_ratio > 0.15 and night_minutes > 120:  # >15% at night and >2h total
        severity = min(night_ratio * 3, 1.0)
        patterns.append({
            "type": PATTERN_NIGHT_ANOMALY,
            "severity": round(severity, 2),
            "evidence": f"{len(night_logs)} entries between 2-5am ({round(night_minutes/60, 1)}h total)",
            "weight": severity * 0.08,
            "recommended_action": "Unusual night activity detected. Verify timezone or work schedule."
        })
        weights_total += severity * 0.08
    
    # Pattern 8: Zero execution (execution < 40% и debugging+revision > 50%)
    # Calculate category breakdown
    category_minutes = {}
    for log in logs:
        cat = log["category"]
        category_minutes[cat] = category_minutes.get(cat, 0) + log["duration_minutes"]
    
    execution_ratio = category_minutes.get("execution", 0) / total_minutes if total_minutes > 0 else 0
    debug_revision_minutes = category_minutes.get("debugging", 0) + category_minutes.get("revision", 0)
    debug_revision_ratio = debug_revision_minutes / total_minutes if total_minutes > 0 else 0
    
    if execution_ratio < 0.4 and debug_revision_ratio > 0.5:
        severity = min((0.5 - execution_ratio) * 2 + 0.3, 1.0)
        patterns.append({
            "type": PATTERN_ZERO_EXECUTION,
            "severity": round(severity, 2),
            "evidence": f"Execution {round(execution_ratio*100, 1)}% (low), Debugging+Revision {round(debug_revision_ratio*100, 1)}% (high)",
            "weight": severity * 0.17,
            "recommended_action": "Low execution time suggests scope/quality issues. Review task clarity and QA process."
        })
        weights_total += severity * 0.17
    
    # Calculate composite suspicious_score
    suspicious_score = min(weights_total, 1.0)
    flagged = suspicious_score > SUSPICIOUS_THRESHOLD
    
    return {
        "patterns": patterns,
        "suspicious_score": round(suspicious_score, 3),
        "flagged": flagged,
        "total_logs": len(logs),
        "manual_ratio": round(manual_ratio, 3)
    }


async def compute_consistency_score(
    user_id: str,
    period_start: datetime,
    period_end: datetime,
    db
) -> float:
    """
    Calculate consistency score (0-1) based on work pattern regularity
    
    Penalizes:
    - Burst logging (many entries in short time)
    - "All at once" patterns
    - Extreme variance in session lengths
    - Large gaps between sessions
    
    Returns:
        0.0-1.0 where 1.0 = perfectly consistent, 0.0 = highly erratic
    """
    logs = await db.time_logs.find({
        "user_id": user_id,
        "started_at": {
            "$gte": period_start.isoformat(),
            "$lt": period_end.isoformat()
        },
        "deleted": {"$ne": True}
    }, {"_id": 0}).sort("started_at", 1).to_list(1000)
    
    if not logs or len(logs) < 3:
        return 0.5  # Neutral score for insufficient data
    
    penalties = []
    
    # Check session length variance
    durations = [log["duration_minutes"] for log in logs]
    mean_duration = sum(durations) / len(durations)
    
    if mean_duration > 0:
        variance = sum((d - mean_duration) ** 2 for d in durations) / len(durations)
        std_dev = variance ** 0.5
        coefficient_of_variation = std_dev / mean_duration
        
        # High variance = penalty
        if coefficient_of_variation > 1.0:
            penalties.append(min(coefficient_of_variation * 0.2, 0.3))
    
    # Check for burst logging (many logs created at same time)
    creation_times = [datetime.fromisoformat(log["created_at"].replace('Z', '+00:00')) for log in logs]
    creation_gaps = []
    
    for i in range(1, len(creation_times)):
        gap_minutes = (creation_times[i] - creation_times[i-1]).total_seconds() / 60
        creation_gaps.append(gap_minutes)
    
    # Count micro-gaps (<1 minute between logs)
    micro_gaps = sum(1 for gap in creation_gaps if gap < 1)
    if micro_gaps > len(logs) * 0.2:  # >20% created rapidly
        penalties.append(0.2)
    
    # Check work distribution across period
    period_hours = (period_end - period_start).total_seconds() / 3600
    days = max(period_hours / 24, 1)
    
    # Count unique work days
    work_dates = set()
    for log in logs:
        started = datetime.fromisoformat(log["started_at"].replace('Z', '+00:00'))
        work_dates.add(started.date())
    
    # If all work compressed into <30% of period days = penalty
    days_coverage = len(work_dates) / days
    if days_coverage < 0.3:
        penalties.append(0.25)
    
    # Calculate final score
    total_penalty = min(sum(penalties), 0.8)
    consistency_score = max(1.0 - total_penalty, 0.0)
    
    return round(consistency_score, 3)


async def compute_time_confidence_score(
    user_id: str,
    period_start: datetime,
    period_end: datetime,
    db
) -> Dict[str, Any]:
    """
    Calculate composite time confidence score (0-1)
    
    Formula:
    confidence = (
        (1 - manual_ratio) * 0.4 +
        qa_pass_rate * 0.2 +
        (1 - revision_ratio) * 0.15 +
        (1 - suspicious_score) * 0.15 +
        consistency_score * 0.1
    )
    
    Returns:
        {
            "confidence_score": 0.0-1.0,
            "components": {...},
            "interpretation": "..."
        }
    """
    # Get logs for period
    logs = await db.time_logs.find({
        "user_id": user_id,
        "started_at": {
            "$gte": period_start.isoformat(),
            "$lt": period_end.isoformat()
        },
        "deleted": {"$ne": True}
    }, {"_id": 0}).to_list(1000)
    
    if not logs:
        return {
            "confidence_score": 0.5,
            "components": {},
            "interpretation": "insufficient_data",
            "note": "No time logs for period"
        }
    
    # Component 1: Manual ratio (0.4 weight)
    manual_minutes = sum(log["duration_minutes"] for log in logs if log["type"] == "manual")
    total_minutes = sum(log["duration_minutes"] for log in logs)
    manual_ratio = manual_minutes / total_minutes if total_minutes > 0 else 0
    
    manual_score = (1 - manual_ratio) * 0.4
    
    # Component 2: QA pass rate (0.2 weight)
    # Get from developer performance record
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    qa_pass_rate = 0.8  # Default fallback
    qa_pass_rate_source = "default"
    
    if user and user.get("performance"):
        perf_qa = user["performance"].get("qa_pass_rate")
        if perf_qa is not None:
            qa_pass_rate = perf_qa
            qa_pass_rate_source = "user_performance"
    
    qa_score = qa_pass_rate * 0.2
    
    # Component 3: Revision ratio (0.15 weight)
    revision_minutes = sum(log["duration_minutes"] for log in logs if log["category"] == "revision")
    revision_ratio = revision_minutes / total_minutes if total_minutes > 0 else 0
    
    revision_score = (1 - revision_ratio) * 0.15
    
    # Component 4: Suspicious score (0.15 weight)
    suspicious_data = await compute_suspicious_patterns(user_id, period_start, period_end, db)
    suspicious_score = suspicious_data["suspicious_score"]
    
    suspicious_score_component = (1 - suspicious_score) * 0.15
    
    # Component 5: Consistency score (0.1 weight)
    consistency = await compute_consistency_score(user_id, period_start, period_end, db)
    consistency_component = consistency * 0.1
    
    # Calculate final confidence
    confidence = manual_score + qa_score + revision_score + suspicious_score_component + consistency_component
    confidence = max(0.0, min(1.0, confidence))
    
    # Interpretation
    if confidence >= 0.9:
        interpretation = "excellent"
    elif confidence >= 0.7:
        interpretation = "good"
    elif confidence >= 0.5:
        interpretation = "acceptable"
    else:
        interpretation = "needs_improvement"
    
    return {
        "confidence_score": round(confidence, 3),
        "components": {
            "manual_ratio": round(manual_ratio, 3),
            "manual_score": round(manual_score, 3),
            "qa_pass_rate": round(qa_pass_rate, 3),
            "qa_pass_rate_source": qa_pass_rate_source,
            "qa_score": round(qa_score, 3),
            "revision_ratio": round(revision_ratio, 3),
            "revision_score": round(revision_score, 3),
            "suspicious_score": round(suspicious_score, 3),
            "suspicious_score_component": round(suspicious_score_component, 3),
            "consistency_score": round(consistency, 3),
            "consistency_component": round(consistency_component, 3)
        },
        "interpretation": interpretation,
        "suspicious_patterns": suspicious_data["patterns"]
    }


async def get_developer_time_trust_summary(
    user_id: str,
    period: str = "week",
    db = None
) -> Dict[str, Any]:
    """
    Get comprehensive time trust summary for developer
    
    This is the main API response for trust metrics
    
    Args:
        user_id: Developer ID
        period: 'today' | 'week' | 'month'
    
    Returns:
        Complete trust analysis with patterns, scores, and recommendations
    """
    now = datetime.now(timezone.utc)
    
    if period == "today":
        period_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        period_end = now
    elif period == "month":
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        period_end = now
    else:  # week (default)
        days_since_monday = now.weekday()
        period_start = now - timedelta(days=days_since_monday)
        period_start = period_start.replace(hour=0, minute=0, second=0, microsecond=0)
        period_end = now
    
    # Get all components
    confidence_data = await compute_time_confidence_score(user_id, period_start, period_end, db)
    
    # Get basic stats
    logs = await db.time_logs.find({
        "user_id": user_id,
        "started_at": {
            "$gte": period_start.isoformat(),
            "$lt": period_end.isoformat()
        },
        "deleted": {"$ne": True}
    }, {"_id": 0}).to_list(1000)
    
    total_hours = sum(log["duration_hours"] for log in logs) if logs else 0
    manual_hours = sum(log["duration_hours"] for log in logs if log["type"] == "manual") if logs else 0
    timer_hours = sum(log["duration_hours"] for log in logs if log["type"] == "timer") if logs else 0
    
    # Category breakdown
    category_breakdown = {}
    for log in logs:
        cat = log["category"]
        category_breakdown[cat] = category_breakdown.get(cat, 0) + log["duration_hours"]
    
    # Calculate category percentages and statuses
    category_analysis = {}
    if total_hours > 0:
        for cat, hours in category_breakdown.items():
            pct = hours / total_hours
            
            # Determine status based on category thresholds
            if cat == "execution":
                status = "good" if pct >= 0.6 else "warning" if pct >= 0.4 else "bad"
            elif cat == "revision":
                status = "bad" if pct > 0.15 else "warning" if pct > 0.10 else "good"
            elif cat == "debugging":
                status = "bad" if pct > 0.25 else "warning" if pct > 0.15 else "good"
            else:
                status = "neutral"
            
            category_analysis[cat] = {
                "hours": round(hours, 2),
                "percentage": round(pct * 100, 1),
                "status": status
            }
    
    # Primary issue (highest severity pattern)
    primary_issue = None
    if confidence_data["suspicious_patterns"]:
        top_pattern = max(confidence_data["suspicious_patterns"], key=lambda p: p["severity"])
        primary_issue = {
            "type": top_pattern["type"],
            "severity": top_pattern["severity"],
            "message": top_pattern["evidence"],
            "action": top_pattern["recommended_action"]
        }
    
    # Impact level based on manual ratio and suspicious score
    manual_ratio = manual_hours / total_hours if total_hours > 0 else 0
    suspicious_score = confidence_data["components"]["suspicious_score"]
    
    if manual_ratio > 0.6 or suspicious_score > 0.7:
        impact_level = "critical"
    elif manual_ratio > 0.5 or suspicious_score > 0.5:
        impact_level = "high"
    elif manual_ratio > 0.35 or suspicious_score > 0.3:
        impact_level = "medium"
    else:
        impact_level = "low"
    
    # Confidence label (user-friendly)
    confidence_score = confidence_data["confidence_score"]
    if confidence_score >= 0.9:
        confidence_label = "HIGH TRUST"
    elif confidence_score >= 0.7:
        confidence_label = "STABLE"
    elif confidence_score >= 0.5:
        confidence_label = "WARNING"
    else:
        confidence_label = "LOW TRUST"
    
    # Trend — compare current period confidence to the previous period of
    # the same length. Stage 2 (May 9, 2026): replaces stub-stable with real
    # historical comparison.
    try:
        prev_window = period_end - period_start
        prev_start = period_start - prev_window
        prev_end = period_start
        prev_conf = await compute_time_confidence_score(user_id, prev_start, prev_end, db)
        prev_score = prev_conf["confidence_score"]
        delta = confidence_score - prev_score
        if delta > 0.05:
            trend = "improving"
        elif delta < -0.05:
            trend = "declining"
        else:
            trend = "stable"
    except Exception:
        # If historical data is missing or compute fails, fall back to stable.
        # This keeps the endpoint honest (no fake trend) while not breaking.
        trend = "stable"
    
    # Build response
    return {
        "user_id": user_id,
        "period": period,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        
        "summary": {
            "total_hours": round(total_hours, 2),
            "manual_hours": round(manual_hours, 2),
            "timer_hours": round(timer_hours, 2),
            "manual_ratio": round(manual_ratio, 3),
            "total_logs": len(logs)
        },
        
        "category_breakdown": {k: round(v, 2) for k, v in category_breakdown.items()},
        "category_analysis": category_analysis,
        
        "trust_metrics": {
            "confidence_score": confidence_data["confidence_score"],
            "confidence_label": confidence_label,
            "confidence_interpretation": confidence_data["interpretation"],
            "suspicious_score": confidence_data["components"]["suspicious_score"],
            "consistency_score": confidence_data["components"]["consistency_score"],
            "flagged": confidence_data["components"]["suspicious_score"] > SUSPICIOUS_THRESHOLD,
            "impact_level": impact_level,
            "trend": trend
        },
        
        "primary_issue": primary_issue,
        "patterns": confidence_data["suspicious_patterns"],
        
        "components": confidence_data["components"],
        
        "recommendations": generate_trust_recommendations(confidence_data, total_hours)
    }


def generate_trust_recommendations(confidence_data: Dict[str, Any], total_hours: float) -> List[str]:
    """
    Generate actionable recommendations based on trust metrics
    """
    recommendations = []
    
    components = confidence_data["components"]
    patterns = confidence_data["suspicious_patterns"]
    
    # Manual ratio
    if components["manual_ratio"] > MANUAL_RATIO_DANGER:
        recommendations.append("CRITICAL: Use timer for all work sessions to reduce manual ratio below 50%")
    elif components["manual_ratio"] > MANUAL_RATIO_WARNING:
        recommendations.append("Use timer more consistently. Current manual ratio is elevated.")
    
    # Patterns
    if patterns:
        top_pattern = max(patterns, key=lambda p: p["severity"])
        recommendations.append(f"Address {top_pattern['type']}: {top_pattern['recommended_action']}")
    
    # Consistency
    if components["consistency_score"] < 0.5:
        recommendations.append("Improve consistency: Log time regularly throughout work period, avoid bulk logging.")
    
    # Revision
    if components["revision_ratio"] > 0.2:
        recommendations.append("High revision time (>20%). Review QA feedback and initial task clarity.")
    
    # Overall confidence
    if confidence_data["confidence_score"] < 0.5:
        recommendations.append("Overall confidence is low. Focus on timer usage and consistent logging habits.")
    
    if not recommendations:
        recommendations.append("Trust metrics are healthy. Keep up consistent timer usage.")
    
    return recommendations
