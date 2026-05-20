"""
EVENT ENGINE - System Nervous System

This is NOT audit log. This is NOT AI recommendations.
This is operational signals that require attention.

Events track production pressure:
- task stuck
- dev overloaded
- QA backlog
- project idle
- revision loops

Events feed:
- Control Center (critical feed)
- Project War Room (project-specific signals)
- Developer Profile (dev-specific warnings)
"""

from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Any
import uuid
import logging

logger = logging.getLogger(__name__)

# ============ EVENT TYPES ============

# Project events
EVENT_PROJECT_IDLE = "project_idle"
EVENT_PROJECT_AT_RISK = "project_at_risk"
EVENT_PROJECT_DEADLINE_PRESSURE = "project_deadline_pressure"

# Task events
EVENT_TASK_STUCK = "task_stuck"
EVENT_TASK_OVERDUE = "task_overdue"
EVENT_TASK_REVISION_LOOP = "task_revision_loop"
EVENT_TASK_UNASSIGNED = "task_unassigned"
EVENT_TASK_WAITING_REVIEW_TOO_LONG = "task_waiting_review_too_long"

# Developer events
EVENT_DEVELOPER_OVERLOADED = "developer_overloaded"
EVENT_DEVELOPER_IDLE = "developer_idle"
EVENT_DEVELOPER_QUALITY_DROP = "developer_quality_drop"
EVENT_DEVELOPER_NO_UPDATE = "developer_no_update"

# QA events
EVENT_QA_BACKLOG_HIGH = "qa_backlog_high"
EVENT_QA_STALE = "qa_stale"
EVENT_QA_REPEAT_FAIL = "qa_repeat_fail"

# Finance events (secondary layer - future)
EVENT_EARNING_HELD_TOO_LONG = "earning_held_too_long"
EVENT_BATCH_WAITING_APPROVAL = "batch_waiting_approval"
EVENT_PROJECT_MARGIN_DANGER = "project_margin_danger"

# ============ SEVERITY LEVELS ============

SEVERITY_INFO = "info"
SEVERITY_WARNING = "warning"
SEVERITY_CRITICAL = "critical"

# ============ STATUS ============

STATUS_OPEN = "open"
STATUS_ACKNOWLEDGED = "acknowledged"
STATUS_RESOLVED = "resolved"

# ============ ENTITY TYPES ============

ENTITY_PROJECT = "project"
ENTITY_TASK = "task"
ENTITY_DEVELOPER = "developer"
ENTITY_QA = "qa"
ENTITY_SYSTEM = "system"

# ============ CONFIGURATION ============

# Task thresholds
TASK_STUCK_HOURS = 12
TASK_WAITING_REVIEW_HOURS = 8
REVISION_LOOP_THRESHOLD = 2

# Developer thresholds
DEVELOPER_OVERLOAD_LIMIT = 5
DEVELOPER_NO_UPDATE_HOURS = 24

# Project thresholds
PROJECT_IDLE_HOURS = 24

# QA thresholds
QA_BACKLOG_THRESHOLD = 10


# ============ EVENT MODEL ============

def create_event(
    event_type: str,
    entity_type: str,
    entity_id: str,
    severity: str,
    title: str,
    message: str,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Create event document"""
    now = datetime.now(timezone.utc)
    
    event = {
        "event_id": f"evt_{uuid.uuid4().hex[:12]}",
        "type": event_type,
        "severity": severity,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "project_id": project_id,
        "user_id": user_id,
        "title": title,
        "message": message,
        "meta": meta or {},
        "status": STATUS_OPEN,
        "created_at": now.isoformat(),
        "acknowledged_at": None,
        "resolved_at": None,
        # Deduplication key
        "dedupe_key": f"{event_type}:{entity_type}:{entity_id}"
    }
    
    return event


def get_dedupe_key(event_type: str, entity_type: str, entity_id: str) -> str:
    """Get deduplication key for event"""
    return f"{event_type}:{entity_type}:{entity_id}"


# ============ DETECTOR 1: TASK STUCK ============

async def detect_task_stuck(db) -> List[Dict[str, Any]]:
    """
    Detect tasks that are stuck (no activity for TASK_STUCK_HOURS)
    
    Conditions:
    - status = in_progress
    - last_activity_at > TASK_STUCK_HOURS ago
    """
    events = []
    threshold = datetime.now(timezone.utc) - timedelta(hours=TASK_STUCK_HOURS)
    
    # Find tasks in progress with no recent activity
    stuck_tasks = await db.work_units.find({
        "status": "in_progress",
        "$or": [
            {"last_activity_at": {"$lt": threshold.isoformat()}},
            {"last_activity_at": {"$exists": False}}  # Old tasks without this field
        ]
    }, {"_id": 0}).to_list(100)
    
    for task in stuck_tasks:
        last_activity = task.get("last_activity_at")
        if last_activity:
            last_activity_dt = datetime.fromisoformat(last_activity) if isinstance(last_activity, str) else last_activity
            hours_idle = (datetime.now(timezone.utc) - last_activity_dt).total_seconds() / 3600
        else:
            created_at = task.get("created_at")
            if isinstance(created_at, str):
                created_at = datetime.fromisoformat(created_at)
            hours_idle = (datetime.now(timezone.utc) - created_at).total_seconds() / 3600
        
        event = create_event(
            event_type=EVENT_TASK_STUCK,
            entity_type=ENTITY_TASK,
            entity_id=task["unit_id"],
            severity=SEVERITY_WARNING if hours_idle < 24 else SEVERITY_CRITICAL,
            title=f"Task stuck: {task.get('title', 'Untitled')}",
            message=f"No activity for {int(hours_idle)} hours",
            project_id=task.get("project_id"),
            user_id=task.get("assigned_to"),
            meta={
                "status": task.get("status"),
                "hours_idle": int(hours_idle),
                "assigned_to": task.get("assigned_to")
            }
        )
        events.append(event)
    
    return events


# ============ DETECTOR 2: TASK WAITING REVIEW TOO LONG ============

async def detect_task_waiting_review(db) -> List[Dict[str, Any]]:
    """
    Detect tasks waiting for QA review too long
    
    Conditions:
    - status = submitted / review
    - no QA decision for > TASK_WAITING_REVIEW_HOURS
    """
    events = []
    threshold = datetime.now(timezone.utc) - timedelta(hours=TASK_WAITING_REVIEW_HOURS)
    
    # Find submitted tasks
    waiting_tasks = await db.work_units.find({
        "status": {"$in": ["submitted", "review", "validation"]}
    }, {"_id": 0}).to_list(100)
    
    for task in waiting_tasks:
        # Skip if missing unit_id
        if "unit_id" not in task:
            continue
        
        # Check if there's a recent QA decision
        qa_decision = await db.qa_decisions.find_one(
            {"unit_id": task["unit_id"]},
            {"_id": 0},
            sort=[("created_at", -1)]
        )
        
        # If no QA decision or old one
        submitted_at = task.get("submitted_at") or task.get("updated_at") or task.get("created_at")
        if isinstance(submitted_at, str):
            submitted_at = datetime.fromisoformat(submitted_at)
        
        if not qa_decision or datetime.fromisoformat(qa_decision["created_at"]) < threshold:
            hours_waiting = (datetime.now(timezone.utc) - submitted_at).total_seconds() / 3600
            
            if hours_waiting > TASK_WAITING_REVIEW_HOURS:
                event = create_event(
                    event_type=EVENT_TASK_WAITING_REVIEW_TOO_LONG,
                    entity_type=ENTITY_TASK,
                    entity_id=task["unit_id"],
                    severity=SEVERITY_WARNING if hours_waiting < 24 else SEVERITY_CRITICAL,
                    title=f"Task waiting review: {task.get('title', 'Untitled')}",
                    message=f"Waiting for QA review for {int(hours_waiting)} hours",
                    project_id=task.get("project_id"),
                    user_id=task.get("assigned_to"),
                    meta={
                        "status": task.get("status"),
                        "hours_waiting": int(hours_waiting)
                    }
                )
                events.append(event)
    
    return events


# ============ DETECTOR 3: TASK REVISION LOOP ============

async def detect_task_revision_loop(db) -> List[Dict[str, Any]]:
    """
    Detect tasks in revision loop
    
    Conditions:
    - revision_count >= REVISION_LOOP_THRESHOLD
    """
    events = []
    
    # Find tasks with high revision count
    revision_tasks = await db.work_units.find({
        "revision_count": {"$gte": REVISION_LOOP_THRESHOLD}
    }, {"_id": 0}).to_list(100)
    
    for task in revision_tasks:
        # Get latest QA decision
        qa_decision = await db.qa_decisions.find_one(
            {"unit_id": task["unit_id"]},
            {"_id": 0},
            sort=[("created_at", -1)]
        )
        
        event = create_event(
            event_type=EVENT_TASK_REVISION_LOOP,
            entity_type=ENTITY_TASK,
            entity_id=task["unit_id"],
            severity=SEVERITY_CRITICAL if task.get("revision_count", 0) >= 3 else SEVERITY_WARNING,
            title=f"Task in revision loop: {task.get('title', 'Untitled')}",
            message=f"Revision count: {task.get('revision_count', 0)}",
            project_id=task.get("project_id"),
            user_id=task.get("assigned_to"),
            meta={
                "revision_count": task.get("revision_count", 0),
                "last_qa_result": qa_decision.get("result") if qa_decision else None,
                "last_qa_severity": qa_decision.get("severity") if qa_decision else None
            }
        )
        events.append(event)
    
    return events


# ============ DETECTOR 4: DEVELOPER OVERLOADED ============

async def detect_developer_overloaded(db) -> List[Dict[str, Any]]:
    """
    Detect overloaded developers
    
    Conditions:
    - active_tasks > DEVELOPER_OVERLOAD_LIMIT
    """
    events = []
    
    # Aggregate active tasks per developer
    pipeline = [
        {
            "$match": {
                "status": {"$in": ["assigned", "in_progress", "review", "revision"]},
                "assigned_to": {"$ne": None}
            }
        },
        {
            "$group": {
                "_id": "$assigned_to",
                "active_count": {"$sum": 1},
                "tasks": {"$push": {"unit_id": "$unit_id", "title": "$title", "status": "$status"}}
            }
        }
    ]
    
    results = await db.work_units.aggregate(pipeline).to_list(100)
    
    for result in results:
        developer_id = result["_id"]
        active_count = result["active_count"]
        
        if active_count > DEVELOPER_OVERLOAD_LIMIT:
            # Get developer info
            developer = await db.users.find_one({"user_id": developer_id}, {"_id": 0})
            
            event = create_event(
                event_type=EVENT_DEVELOPER_OVERLOADED,
                entity_type=ENTITY_DEVELOPER,
                entity_id=developer_id,
                severity=SEVERITY_CRITICAL if active_count > DEVELOPER_OVERLOAD_LIMIT + 2 else SEVERITY_WARNING,
                title=f"Developer overloaded: {developer.get('name', developer_id) if developer else developer_id}",
                message=f"{active_count} active tasks (limit: {DEVELOPER_OVERLOAD_LIMIT})",
                user_id=developer_id,
                meta={
                    "active_tasks": active_count,
                    "recommended_limit": DEVELOPER_OVERLOAD_LIMIT,
                    "task_list": result["tasks"][:5]  # Top 5 for display
                }
            )
            events.append(event)
    
    return events


# ============ DETECTOR 5: PROJECT IDLE ============

async def detect_project_idle(db) -> List[Dict[str, Any]]:
    """
    Detect idle projects
    
    Conditions:
    - No activity (time logs, status changes) for > PROJECT_IDLE_HOURS
    """
    events = []
    threshold = datetime.now(timezone.utc) - timedelta(hours=PROJECT_IDLE_HOURS)
    
    # Get all active projects
    projects = await db.projects.find({
        "status": {"$in": ["active", "in_progress"]}
    }, {"_id": 0}).to_list(100)
    
    for project in projects:
        project_id = project["project_id"]
        
        # Check for recent time logs
        recent_time_log = await db.time_logs.find_one(
            {
                "project_id": project_id,
                "created_at": {"$gte": threshold.isoformat()}
            },
            {"_id": 0}
        )
        
        # Check for recent task updates
        recent_task_update = await db.work_units.find_one(
            {
                "project_id": project_id,
                "updated_at": {"$gte": threshold.isoformat()}
            },
            {"_id": 0}
        )
        
        if not recent_time_log and not recent_task_update:
            # Project is idle
            event = create_event(
                event_type=EVENT_PROJECT_IDLE,
                entity_type=ENTITY_PROJECT,
                entity_id=project_id,
                severity=SEVERITY_WARNING,
                title=f"Project idle: {project.get('name', 'Untitled')}",
                message=f"No activity for {PROJECT_IDLE_HOURS}+ hours",
                project_id=project_id,
                meta={
                    "hours_idle": PROJECT_IDLE_HOURS,
                    "project_name": project.get("name"),
                    "current_stage": project.get("current_stage")
                }
            )
            events.append(event)
    
    return events


# ============ DETECTOR 6: QA BACKLOG HIGH ============

async def detect_qa_backlog_high(db) -> List[Dict[str, Any]]:
    """
    Detect high QA backlog
    
    Conditions:
    - Tasks in review queue > QA_BACKLOG_THRESHOLD
    """
    events = []
    
    # Count tasks waiting for QA
    qa_count = await db.work_units.count_documents({
        "status": {"$in": ["submitted", "review", "validation"]}
    })
    
    if qa_count > QA_BACKLOG_THRESHOLD:
        event = create_event(
            event_type=EVENT_QA_BACKLOG_HIGH,
            entity_type=ENTITY_SYSTEM,
            entity_id="qa_system",
            severity=SEVERITY_CRITICAL if qa_count > QA_BACKLOG_THRESHOLD * 2 else SEVERITY_WARNING,
            title=f"QA backlog high: {qa_count} tasks",
            message=f"{qa_count} tasks waiting for QA review (threshold: {QA_BACKLOG_THRESHOLD})",
            meta={
                "queue_size": qa_count,
                "threshold": QA_BACKLOG_THRESHOLD
            }
        )
        events.append(event)
    
    return events


# ============ MAIN DETECTION ENGINE ============

async def run_detection_scan(db) -> Dict[str, Any]:
    """
    Run all detectors and create/update events
    
    Returns:
    - created_count: number of new events
    - updated_count: number of updated events
    - resolved_count: number of auto-resolved events
    """
    logger.info("EVENT ENGINE: Starting detection scan")
    
    all_detected_events = []
    
    # Run all detectors
    detectors = [
        ("task_stuck", detect_task_stuck),
        ("task_waiting_review", detect_task_waiting_review),
        ("task_revision_loop", detect_task_revision_loop),
        ("developer_overloaded", detect_developer_overloaded),
        ("project_idle", detect_project_idle),
        ("qa_backlog_high", detect_qa_backlog_high),
    ]
    
    for detector_name, detector_func in detectors:
        try:
            events = await detector_func(db)
            all_detected_events.extend(events)
            logger.info(f"EVENT ENGINE: {detector_name} detected {len(events)} events")
        except Exception as e:
            logger.error(f"EVENT ENGINE: {detector_name} failed: {str(e)}")
    
    # Process events (upsert with deduplication)
    created_count = 0
    updated_count = 0
    
    for event in all_detected_events:
        dedupe_key = event["dedupe_key"]
        
        # Check if event already exists and is open
        existing = await db.events.find_one({
            "dedupe_key": dedupe_key,
            "status": STATUS_OPEN
        }, {"_id": 0})
        
        if existing:
            # Update existing event (refresh meta, update message)
            await db.events.update_one(
                {"event_id": existing["event_id"]},
                {"$set": {
                    "meta": event["meta"],
                    "message": event["message"],
                    "severity": event["severity"],
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }}
            )
            updated_count += 1
        else:
            # Create new event
            await db.events.insert_one(event)
            created_count += 1
    
    # Auto-resolve events that no longer exist
    # Get all open events
    open_events = await db.events.find({"status": STATUS_OPEN}, {"_id": 0}).to_list(1000)
    
    detected_dedupe_keys = {e["dedupe_key"] for e in all_detected_events}
    resolved_count = 0
    
    for open_event in open_events:
        if open_event["dedupe_key"] not in detected_dedupe_keys:
            # Event no longer detected - auto-resolve
            await db.events.update_one(
                {"event_id": open_event["event_id"]},
                {"$set": {
                    "status": STATUS_RESOLVED,
                    "resolved_at": datetime.now(timezone.utc).isoformat(),
                    "resolved_by": "system_auto"
                }}
            )
            resolved_count += 1
    
    logger.info(f"EVENT ENGINE: Scan complete - created: {created_count}, updated: {updated_count}, resolved: {resolved_count}")
    
    return {
        "created_count": created_count,
        "updated_count": updated_count,
        "resolved_count": resolved_count,
        "total_detected": len(all_detected_events)
    }


# ============ LIFECYCLE HOOKS ============

async def create_event_on_revision(db, task: Dict[str, Any], qa_decision: Dict[str, Any]):
    """Hook: Create event when task goes to revision (especially 2nd+ time)"""
    revision_count = task.get("revision_count", 0)
    
    if revision_count >= REVISION_LOOP_THRESHOLD:
        event = create_event(
            event_type=EVENT_TASK_REVISION_LOOP,
            entity_type=ENTITY_TASK,
            entity_id=task["unit_id"],
            severity=SEVERITY_CRITICAL if revision_count >= 3 else SEVERITY_WARNING,
            title=f"Task in revision loop: {task.get('title', 'Untitled')}",
            message=f"Revision count: {revision_count}",
            project_id=task.get("project_id"),
            user_id=task.get("assigned_to"),
            meta={
                "revision_count": revision_count,
                "last_qa_result": qa_decision.get("result"),
                "last_qa_severity": qa_decision.get("severity")
            }
        )
        
        # Upsert
        dedupe_key = event["dedupe_key"]
        existing = await db.events.find_one({"dedupe_key": dedupe_key, "status": STATUS_OPEN}, {"_id": 0})
        
        if existing:
            await db.events.update_one(
                {"event_id": existing["event_id"]},
                {"$set": {"meta": event["meta"], "message": event["message"]}}
            )
        else:
            await db.events.insert_one(event)


async def create_event_on_task_unassigned(db, task: Dict[str, Any]):
    """Hook: Create event when task is created without assignee"""
    if not task.get("assigned_to"):
        event = create_event(
            event_type=EVENT_TASK_UNASSIGNED,
            entity_type=ENTITY_TASK,
            entity_id=task["unit_id"],
            severity=SEVERITY_INFO,
            title=f"Task unassigned: {task.get('title', 'Untitled')}",
            message="Task created but not assigned to any developer",
            project_id=task.get("project_id"),
            meta={
                "status": task.get("status"),
                "priority": task.get("priority")
            }
        )
        
        await db.events.insert_one(event)


async def resolve_event_on_task_assigned(db, task_id: str):
    """Hook: Resolve unassigned event when task gets assigned"""
    dedupe_key = get_dedupe_key(EVENT_TASK_UNASSIGNED, ENTITY_TASK, task_id)
    
    await db.events.update_one(
        {"dedupe_key": dedupe_key, "status": STATUS_OPEN},
        {"$set": {
            "status": STATUS_RESOLVED,
            "resolved_at": datetime.now(timezone.utc).isoformat(),
            "resolved_by": "system_auto"
        }}
    )


async def resolve_event_on_task_completed(db, task_id: str):
    """Hook: Resolve all task-related events when task is completed"""
    await db.events.update_many(
        {
            "entity_type": ENTITY_TASK,
            "entity_id": task_id,
            "status": STATUS_OPEN
        },
        {"$set": {
            "status": STATUS_RESOLVED,
            "resolved_at": datetime.now(timezone.utc).isoformat(),
            "resolved_by": "system_auto"
        }}
    )
