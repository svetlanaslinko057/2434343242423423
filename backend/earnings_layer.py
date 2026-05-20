"""
EARNINGS ENGINE (STEP 3A - CORE BACKEND)

This is the MONEY LAYER.

Assignment Engine → who does
Acceptance Layer → agreed or not
Time Layer → how much worked
Trust Layer → can we trust
Earnings Layer → how much we pay ← YOU ARE HERE

Philosophy:
- Controlled review, not auto-punishment
- QA-gated earnings
- Transparency (explainability)
- Manageability (admin control)
"""

import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

# ============ BILLING MODES ============

BILLING_MODE_FIXED = "fixed"
BILLING_MODE_HOURLY = "hourly"
BILLING_MODE_HYBRID = "hybrid"

VALID_BILLING_MODES = [BILLING_MODE_FIXED, BILLING_MODE_HOURLY, BILLING_MODE_HYBRID]

# ============ STATUSES ============

# QA Status (separate from earning status)
QA_STATUS_PENDING = "pending"
QA_STATUS_PASSED = "passed"
QA_STATUS_FAILED = "failed"
QA_STATUS_REVISION = "revision"

# Earning Status
EARNING_STATUS_DRAFT = "draft"
EARNING_STATUS_PENDING_QA = "pending_qa"
EARNING_STATUS_APPROVED = "approved"
EARNING_STATUS_HELD = "held"
EARNING_STATUS_FLAGGED = "flagged"
EARNING_STATUS_BATCHED = "batched"
EARNING_STATUS_PAID = "paid"
EARNING_STATUS_CANCELLED = "cancelled"

# Batch Status
BATCH_STATUS_DRAFT = "draft"
BATCH_STATUS_APPROVED = "approved"
BATCH_STATUS_PAID = "paid"

# Review Reasons
REVIEW_REASON_LOW_CONFIDENCE = "low_confidence"
REVIEW_REASON_HIGH_OVERRUN = "high_overrun"
REVIEW_REASON_MANUAL_HEAVY = "manual_heavy"
REVIEW_REASON_SUSPICIOUS_PATTERNS = "suspicious_patterns"
REVIEW_REASON_ADMIN_FLAG = "admin_flag"

# Impact Levels
IMPACT_LOW = "low"
IMPACT_MEDIUM = "medium"
IMPACT_HIGH = "high"

# ============ THRESHOLDS ============

# Quality adjustment
QUALITY_ADJ_1ST_PASS = 0.0  # No penalty for first pass QA
QUALITY_ADJ_1_REVISION = -0.05  # -5% for 1 revision
QUALITY_ADJ_2PLUS_REVISIONS = -0.10  # -10% for 2+ revisions

# Time adjustment thresholds
TIME_OVERRUN_SAFE = 1.25  # Up to 25% overrun is OK
TIME_OVERRUN_MODERATE = 1.5  # 25-50% overrun needs review

# Confidence gate
CONFIDENCE_GATE_THRESHOLD = 0.6  # Below this = requires review

# Revision impact
REVISION_IMPACT_HIGH_THRESHOLD = 0.2  # revision_hours / actual_hours > 20% = high impact


async def create_task_earning(
    task_id: str,
    user_id: str,
    project_id: str,
    estimated_hours: float,
    actual_hours: float,
    hourly_rate: float,
    time_confidence_score: float,
    billing_mode: str = BILLING_MODE_FIXED,
    db = None
) -> Dict[str, Any]:
    """
    Create earning entity for task
    
    Called when:
    - Task submitted for QA
    - Developer completes work
    
    Args:
        task_id: Work unit ID
        user_id: Developer ID
        project_id: Project ID
        estimated_hours: Original estimate
        actual_hours: Actual time tracked
        hourly_rate: Developer rate (from user profile or project assignment)
        time_confidence_score: Trust score from time tracking layer
        billing_mode: fixed | hourly | hybrid
    
    Returns:
        Earning document
    """
    # ============ P0.3 FIX: TASK ↔ EARNING VALIDATION ============
    # Earning НЕ МОЖЕТ существовать без task_id
    if not task_id:
        raise ValueError("Invalid earning: task_id required")
    
    # Validate task exists
    work_unit = await db['work_units'].find_one({'work_unit_id': task_id})
    if not work_unit:
        raise ValueError(f"Invalid earning: task {task_id} not found")
    
    # Validate project linkage
    if not project_id:
        raise ValueError("Invalid earning: project_id required")
    
    task_project = work_unit.get('project_id')
    if task_project and task_project != project_id:
        logger.warning(f"Project mismatch: earning {project_id} vs task {task_project}")
    # ============================================================
    
    now = datetime.now(timezone.utc)
    
    # Validate billing mode
    if billing_mode not in VALID_BILLING_MODES:
        billing_mode = BILLING_MODE_FIXED
    
    # Calculate base earning based on billing mode
    if billing_mode == BILLING_MODE_FIXED:
        base_hours = estimated_hours
    elif billing_mode == BILLING_MODE_HOURLY:
        base_hours = actual_hours
    else:  # HYBRID
        base_hours = min(actual_hours, estimated_hours * 1.25)
    
    base_earning = base_hours * hourly_rate
    
    # Check confidence gate
    confidence_gate = calculate_confidence_gate(
        time_confidence_score=time_confidence_score,
        actual_hours=actual_hours,
        estimated_hours=estimated_hours
    )
    
    # Initial earning status
    if confidence_gate["blocked_auto_approval"]:
        earning_status = EARNING_STATUS_FLAGGED
    else:
        earning_status = EARNING_STATUS_PENDING_QA
    
    # Create earning document
    earning_doc = {
        "earning_id": f"earn_{uuid.uuid4().hex[:12]}",
        "task_id": task_id,
        "project_id": project_id,
        "user_id": user_id,
        
        # Billing
        "billing_mode": billing_mode,
        "base_hours": base_hours,
        "hourly_rate": hourly_rate,
        
        # Time metrics
        "estimated_hours": estimated_hours,
        "actual_hours": actual_hours,
        "actual_vs_estimated_ratio": round(actual_hours / estimated_hours, 2) if estimated_hours > 0 else 0,
        
        # Earning calculation
        "base_earning": round(base_earning, 2),
        "time_adjustment": 0.0,
        "quality_adjustment": 0.0,
        "manual_review_adjustment": 0.0,
        "final_earning": round(base_earning, 2),  # Will be recalculated after QA
        
        # QA & Status (SEPARATE)
        "qa_status": QA_STATUS_PENDING,
        "earning_status": earning_status,
        
        # Quality metrics
        "revision_count": 0,
        "revision_hours": 0.0,
        "revision_cost": 0.0,
        "revision_impact": None,
        
        # Trust metrics
        "time_confidence_score": time_confidence_score,
        "confidence_gate": confidence_gate,
        
        # Payout tracking
        "payout_batch_id": None,
        "approved_at": None,
        "paid_at": None,
        "frozen": False,  # Locked when batched
        
        # Flags
        "requires_manual_review": confidence_gate["requires_review"],
        "review_reason": confidence_gate["reason"],
        
        # Explainability (transparency)
        "explainability": {
            "base_hours": base_hours,
            "actual_hours": actual_hours,
            "estimated_hours": estimated_hours,
            "rate": hourly_rate,
            "billing_mode": billing_mode,
            "quality_adjustment_pct": 0.0,
            "time_flag": False,
            "confidence_score": time_confidence_score,
            "final_formula": f"{base_earning:.2f} (base, pending QA)"
        },
        
        "created_at": now.isoformat(),
        "updated_at": now.isoformat()
    }
    
    # Insert to DB
    await db.task_earnings.insert_one(earning_doc)
    
    logger.info(f"EARNING CREATED: {earning_doc['earning_id']} for task {task_id} - ${base_earning:.2f} ({earning_status})")
    
    return earning_doc


def calculate_confidence_gate(
    time_confidence_score: float,
    actual_hours: float,
    estimated_hours: float
) -> Dict[str, Any]:
    """
    Determine if earning requires review based on trust metrics
    
    This is the bridge: time trust → money trust
    
    Returns:
        {
            "requires_review": bool,
            "reason": str or None,
            "blocked_auto_approval": bool
        }
    """
    requires_review = False
    reason = None
    blocked_auto_approval = False
    
    # Check 1: Low confidence score
    if time_confidence_score < CONFIDENCE_GATE_THRESHOLD:
        requires_review = True
        reason = REVIEW_REASON_LOW_CONFIDENCE
        blocked_auto_approval = True  # Block auto-approval
    
    # Check 2: High overrun (even if confidence is OK)
    overrun_ratio = actual_hours / estimated_hours if estimated_hours > 0 else 0
    if overrun_ratio > TIME_OVERRUN_MODERATE:
        requires_review = True
        if not reason:
            reason = REVIEW_REASON_HIGH_OVERRUN
        blocked_auto_approval = True
    
    return {
        "requires_review": requires_review,
        "reason": reason,
        "blocked_auto_approval": blocked_auto_approval
    }


async def apply_quality_adjustment(
    earning: Dict[str, Any],
    db = None
) -> Dict[str, Any]:
    """
    Calculate quality adjustment based on revision count
    
    Soft penalties:
    - 0 revisions (first pass QA) = 0%
    - 1 revision = -5%
    - 2+ revisions = -10%
    
    Args:
        earning: Earning document
    
    Returns:
        Updated earning with quality_adjustment
    """
    revision_count = earning.get("revision_count", 0)
    base_earning = earning["base_earning"]
    
    if revision_count == 0:
        quality_adjustment_pct = QUALITY_ADJ_1ST_PASS
    elif revision_count == 1:
        quality_adjustment_pct = QUALITY_ADJ_1_REVISION
    else:  # 2+
        quality_adjustment_pct = QUALITY_ADJ_2PLUS_REVISIONS
    
    quality_adjustment = base_earning * quality_adjustment_pct
    
    earning["quality_adjustment"] = round(quality_adjustment, 2)
    earning["explainability"]["quality_adjustment_pct"] = quality_adjustment_pct
    
    return earning


async def apply_time_adjustment(
    earning: Dict[str, Any],
    db = None
) -> Dict[str, Any]:
    """
    Apply time adjustment based on overrun
    
    Controlled review approach:
    - Up to 1.25x: no penalty
    - 1.25-1.5x: flag for review, no penalty yet
    - 1.5x+: hold earning, admin must decide
    
    Args:
        earning: Earning document
    
    Returns:
        Updated earning with time_adjustment and flags
    """
    actual_hours = earning["actual_hours"]
    estimated_hours = earning["estimated_hours"]
    overrun_ratio = actual_hours / estimated_hours if estimated_hours > 0 else 0
    
    # Time adjustment (for now always 0, controlled via status)
    time_adjustment = 0.0
    time_flag = False
    
    if overrun_ratio <= TIME_OVERRUN_SAFE:
        # Safe zone
        pass
    elif TIME_OVERRUN_SAFE < overrun_ratio <= TIME_OVERRUN_MODERATE:
        # Moderate overrun - flag but don't penalize
        time_flag = True
        earning["requires_manual_review"] = True
        if not earning.get("review_reason"):
            earning["review_reason"] = REVIEW_REASON_HIGH_OVERRUN
    else:  # > 1.5x
        # High overrun - hold
        time_flag = True
        earning["earning_status"] = EARNING_STATUS_HELD
        earning["requires_manual_review"] = True
        earning["review_reason"] = REVIEW_REASON_HIGH_OVERRUN
    
    earning["time_adjustment"] = round(time_adjustment, 2)
    earning["explainability"]["time_flag"] = time_flag
    
    return earning


async def calculate_revision_impact(
    earning: Dict[str, Any],
    db = None
) -> Dict[str, Any]:
    """
    Calculate revision impact (not just metric, but signal)
    
    Used for:
    - Assignment engine (avoid high-revision devs)
    - Dev scoring
    - Pricing adjustments
    
    Args:
        earning: Earning document
    
    Returns:
        Updated earning with revision_impact
    """
    revision_hours = earning.get("revision_hours", 0)
    actual_hours = earning.get("actual_hours", 0)
    hourly_rate = earning.get("hourly_rate", 0)
    
    if revision_hours == 0:
        earning["revision_impact"] = None
        return earning
    
    # Calculate revision cost
    revision_cost = revision_hours * hourly_rate
    
    # Calculate impact level
    if actual_hours > 0:
        revision_ratio = revision_hours / actual_hours
        if revision_ratio > REVISION_IMPACT_HIGH_THRESHOLD:
            impact_level = IMPACT_HIGH
        elif revision_ratio > 0.1:  # 10-20%
            impact_level = IMPACT_MEDIUM
        else:
            impact_level = IMPACT_LOW
    else:
        impact_level = IMPACT_LOW
    
    earning["revision_cost"] = round(revision_cost, 2)
    earning["revision_impact"] = {
        "revision_hours": revision_hours,
        "revision_cost": round(revision_cost, 2),
        "impact_level": impact_level,
        "revision_ratio": round(revision_hours / actual_hours, 2) if actual_hours > 0 else 0
    }
    
    return earning


async def recalculate_task_earning(
    earning_id: str,
    db = None
) -> Dict[str, Any]:
    """
    Recalculate earning (after QA result, admin adjustment, etc.)
    
    Only allowed if not frozen (not batched/paid)
    
    Args:
        earning_id: Earning ID
    
    Returns:
        Updated earning
    """
    earning = await db.task_earnings.find_one({"earning_id": earning_id}, {"_id": 0})
    
    if not earning:
        raise ValueError(f"Earning {earning_id} not found")
    
    # Check if frozen
    if earning.get("frozen"):
        raise ValueError(f"Earning {earning_id} is frozen (batched/paid), cannot recalculate")
    
    # Apply adjustments
    earning = await apply_quality_adjustment(earning, db)
    earning = await apply_time_adjustment(earning, db)
    earning = await calculate_revision_impact(earning, db)
    
    # Calculate final earning
    final_earning = (
        earning["base_earning"] +
        earning["time_adjustment"] +
        earning["quality_adjustment"] +
        earning["manual_review_adjustment"]
    )
    
    # Clamp to 0 (no negative earnings)
    final_earning = max(0, final_earning)
    
    earning["final_earning"] = round(final_earning, 2)
    
    # Update explainability
    formula_parts = [f"{earning['base_earning']:.2f} (base)"]
    
    if earning["quality_adjustment"] != 0:
        formula_parts.append(f"{earning['quality_adjustment']:+.2f} (quality)")
    
    if earning["time_adjustment"] != 0:
        formula_parts.append(f"{earning['time_adjustment']:+.2f} (time)")
    
    if earning["manual_review_adjustment"] != 0:
        formula_parts.append(f"{earning['manual_review_adjustment']:+.2f} (manual)")
    
    earning["explainability"]["final_formula"] = " ".join(formula_parts) + f" = ${final_earning:.2f}"
    
    # Update timestamp
    earning["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    # Save to DB
    await db.task_earnings.update_one(
        {"earning_id": earning_id},
        {"$set": earning}
    )
    
    logger.info(f"EARNING RECALCULATED: {earning_id} - ${final_earning:.2f} (status: {earning['earning_status']})")
    
    return earning


async def handle_qa_result(
    task_id: str,
    qa_status: str,
    revision_hours: float = 0.0,
    db = None
) -> Dict[str, Any]:
    """
    Handle QA result and update earning
    
    Flow:
    - QA pass → earning approved (if not flagged)
    - QA fail → earning held, revision tracked
    
    Args:
        task_id: Task ID
        qa_status: passed | failed
        revision_hours: Hours spent on revision (if applicable)
    
    Returns:
        Updated earning
    """
    # Get earning
    earning = await db.task_earnings.find_one({"task_id": task_id}, {"_id": 0})
    
    if not earning:
        raise ValueError(f"No earning found for task {task_id}")
    
    # Check if frozen
    if earning.get("frozen"):
        raise ValueError("Earning is frozen, cannot update QA status")
    
    # Update QA status
    earning["qa_status"] = qa_status
    
    if qa_status == QA_STATUS_PASSED:
        # QA passed
        earning["revision_count"] = earning.get("revision_count", 0)  # Keep count
        
        # Recalculate with final adjustments
        earning = await apply_quality_adjustment(earning, db)
        earning = await apply_time_adjustment(earning, db)
        earning = await calculate_revision_impact(earning, db)
        
        # Calculate final
        final_earning = (
            earning["base_earning"] +
            earning["time_adjustment"] +
            earning["quality_adjustment"] +
            earning["manual_review_adjustment"]
        )
        final_earning = max(0, final_earning)
        earning["final_earning"] = round(final_earning, 2)
        
        # Determine earning status
        if earning.get("requires_manual_review") or earning.get("confidence_gate", {}).get("blocked_auto_approval"):
            earning["earning_status"] = EARNING_STATUS_FLAGGED
        else:
            earning["earning_status"] = EARNING_STATUS_APPROVED
            earning["approved_at"] = datetime.now(timezone.utc).isoformat()
        
    elif qa_status == QA_STATUS_FAILED:
        # QA failed - hold earning, track revision
        earning["qa_status"] = QA_STATUS_REVISION
        earning["earning_status"] = EARNING_STATUS_HELD
        earning["revision_count"] = earning.get("revision_count", 0) + 1
        earning["revision_hours"] = earning.get("revision_hours", 0) + revision_hours
        
        # Recalculate revision impact
        earning = await calculate_revision_impact(earning, db)
    
    # Update explainability
    earning["explainability"]["quality_adjustment_pct"] = earning.get("quality_adjustment", 0) / earning["base_earning"] if earning["base_earning"] > 0 else 0
    
    formula_parts = [f"{earning['base_earning']:.2f} (base)"]
    if earning["quality_adjustment"] != 0:
        formula_parts.append(f"{earning['quality_adjustment']:+.2f} (quality)")
    if earning["time_adjustment"] != 0:
        formula_parts.append(f"{earning['time_adjustment']:+.2f} (time)")
    if earning["manual_review_adjustment"] != 0:
        formula_parts.append(f"{earning['manual_review_adjustment']:+.2f} (manual)")
    
    earning["explainability"]["final_formula"] = " ".join(formula_parts) + f" = ${earning['final_earning']:.2f}"
    
    earning["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    # Save
    await db.task_earnings.update_one(
        {"earning_id": earning["earning_id"]},
        {"$set": earning}
    )

    # Phase 2B PR-2 — canonical mirror: route the earning's state change
    # through MoneyService. APPROVED → accrual (+amount on ac_accrual:<dev>);
    # HELD/CANCELLED after a previous approval → reversal. Bridge functions
    # are internally exception-safe so the legacy save above is always
    # authoritative.
    from money_bridge import bridge_task_earning_approved, bridge_task_earning_reversed
    if earning["earning_status"] == EARNING_STATUS_APPROVED:
        await bridge_task_earning_approved(earning)
    elif earning["earning_status"] in (EARNING_STATUS_HELD, EARNING_STATUS_CANCELLED):
        # If a prior accrual exists, reverse it; otherwise no-op.
        await bridge_task_earning_reversed(earning, reason=f"qa_status={qa_status}")

    logger.info(f"QA RESULT: task {task_id} - {qa_status} → earning {earning['earning_status']} (${earning['final_earning']:.2f})")
    
    return earning


async def get_developer_earnings_summary(
    user_id: str,
    period: str = "week",
    db = None
) -> Dict[str, Any]:
    """
    Get developer earnings summary
    
    Args:
        user_id: Developer ID
        period: today | week | month
    
    Returns:
        Summary with pending/approved/batched/paid breakdown
    """
    now = datetime.now(timezone.utc)
    
    if period == "today":
        period_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "month":
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    else:  # week
        days_since_monday = now.weekday()
        period_start = now - timedelta(days=days_since_monday)
        period_start = period_start.replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Get all earnings for period
    earnings = await db.task_earnings.find({
        "user_id": user_id,
        "created_at": {"$gte": period_start.isoformat()}
    }, {"_id": 0}).to_list(500)
    
    # Breakdown by status (amounts + counts)
    pending_qa_list = [e for e in earnings if e["earning_status"] == EARNING_STATUS_PENDING_QA]
    approved_list = [e for e in earnings if e["earning_status"] == EARNING_STATUS_APPROVED]
    batched_list = [e for e in earnings if e["earning_status"] == EARNING_STATUS_BATCHED]
    held_list = [e for e in earnings if e["earning_status"] == EARNING_STATUS_HELD]
    flagged_list = [e for e in earnings if e["earning_status"] == EARNING_STATUS_FLAGGED]
    
    pending_qa = sum(e["final_earning"] for e in pending_qa_list)
    approved = sum(e["final_earning"] for e in approved_list)
    in_batch = sum(e["final_earning"] for e in batched_list)
    held = sum(e["final_earning"] for e in held_list)
    flagged = sum(e["final_earning"] for e in flagged_list)
    
    # Get lifetime paid (all time)
    paid_total_agg = await db.task_earnings.aggregate([
        {"$match": {"user_id": user_id, "earning_status": EARNING_STATUS_PAID}},
        {"$group": {"_id": None, "total": {"$sum": "$final_earning"}, "count": {"$sum": 1}}}
    ]).to_list(1)
    
    paid_total = paid_total_agg[0]["total"] if paid_total_agg else 0
    paid_count = paid_total_agg[0]["count"] if paid_total_agg else 0
    
    # Calculate adjustments breakdown
    gross = sum(e["base_earning"] for e in earnings)
    quality_adjustments = sum(e.get("quality_adjustment", 0) for e in earnings)
    time_adjustments = sum(e.get("time_adjustment", 0) for e in earnings)
    manual_adjustments = sum(e.get("manual_review_adjustment", 0) for e in earnings)
    final_total = sum(e["final_earning"] for e in earnings)
    
    return {
        "user_id": user_id,
        "period": period,
        "period_start": period_start.isoformat(),
        
        # Operational summary (amounts)
        "pending_qa_amount": round(pending_qa, 2),
        "approved_amount": round(approved, 2),
        "batched_amount": round(in_batch, 2),
        "held_amount": round(held, 2),
        "flagged_amount": round(flagged, 2),
        "paid_total": round(paid_total, 2),
        
        # Counts
        "pending_qa_count": len(pending_qa_list),
        "approved_count": len(approved_list),
        "batched_count": len(batched_list),
        "held_count": len(held_list),
        "flagged_count": len(flagged_list),
        "paid_count": paid_count,
        
        # Breakdown (legacy, kept for compatibility)
        "breakdown": {
            "gross": round(gross, 2),
            "quality_adjustments": round(quality_adjustments, 2),
            "time_adjustments": round(time_adjustments, 2),
            "manual_adjustments": round(manual_adjustments, 2),
            "final": round(final_total, 2)
        },
        
        "earnings_count": len(earnings)
    }


async def get_developer_earnings_tasks(
    user_id: str,
    status_filter: Optional[str] = None,
    db = None
) -> Dict[str, Any]:
    """
    Get developer task earnings list with explainability preview
    
    Args:
        user_id: Developer ID
        status_filter: Filter by status (all | pending_qa | approved | held | flagged | batched | paid)
    
    Returns:
        List of task earnings with explainability preview
    """
    query = {"user_id": user_id}
    
    if status_filter and status_filter != "all":
        status_map = {
            "pending_qa": EARNING_STATUS_PENDING_QA,
            "approved": EARNING_STATUS_APPROVED,
            "held": EARNING_STATUS_HELD,
            "flagged": EARNING_STATUS_FLAGGED,
            "batched": EARNING_STATUS_BATCHED,
            "paid": EARNING_STATUS_PAID
        }
        if status_filter in status_map:
            query["earning_status"] = status_map[status_filter]
    
    # Get earnings
    earnings = await db.task_earnings.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    
    # Get task titles
    task_ids = [e["task_id"] for e in earnings]
    tasks = await db.work_units.find({
        "unit_id": {"$in": task_ids}
    }, {"_id": 0, "unit_id": 1, "title": 1, "project_id": 1}).to_list(200)
    
    task_map = {t["unit_id"]: t for t in tasks}
    
    # Get project names
    project_ids = list(set(t.get("project_id") for t in tasks if t.get("project_id")))
    projects = await db.projects.find({
        "project_id": {"$in": project_ids}
    }, {"_id": 0, "project_id": 1, "name": 1}).to_list(50)
    
    project_map = {p["project_id"]: p.get("name", "Unknown") for p in projects}
    
    # Build response
    tasks_list = []
    for e in earnings:
        task = task_map.get(e["task_id"], {})
        project_id = task.get("project_id", "unknown")
        
        # Calculate adjustments total
        adjustments_total = (
            e.get("time_adjustment", 0) +
            e.get("quality_adjustment", 0) +
            e.get("manual_review_adjustment", 0)
        )
        
        # Build explainability preview (short formula)
        base = e["base_earning"]
        final = e["final_earning"]
        
        if abs(adjustments_total) < 0.01:
            explainability_preview = f"${base:.2f} (no adjustments)"
        else:
            explainability_preview = f"${base:.2f} {adjustments_total:+.2f} = ${final:.2f}"
        
        # Determine "why" (short reason)
        why = ""
        if e["earning_status"] == EARNING_STATUS_HELD:
            if e.get("revision_count", 0) > 0:
                why = f"Revision required (iteration {e.get('qa_iteration_count', 1)})"
            else:
                why = "QA review needed"
        elif e["earning_status"] == EARNING_STATUS_FLAGGED:
            confidence_gate = e.get("confidence_gate", {})
            why = confidence_gate.get("reason", "Requires review")
        elif e.get("revision_count", 0) > 0:
            why = f"QA revision ({e['revision_count']} iteration{'s' if e['revision_count'] > 1 else ''})"
        elif e.get("qa_iteration_count", 0) == 1 and e.get("first_pass_success"):
            why = "First-pass QA success"
        else:
            why = "—"
        
        tasks_list.append({
            "earning_id": e["earning_id"],
            "task_id": e["task_id"],
            "task_title": task.get("title", "Untitled"),
            "project_id": project_id,
            "project_name": project_map.get(project_id, "Unknown"),
            
            "base_earning": e["base_earning"],
            "adjustments_total": round(adjustments_total, 2),
            "final_earning": e["final_earning"],
            
            "earning_status": e["earning_status"],
            "qa_status": e.get("qa_status", "pending"),
            
            "batch_id": e.get("payout_batch_id"),
            
            "why": why,
            "explainability_preview": explainability_preview,
            
            "created_at": e.get("created_at"),
            "approved_at": e.get("approved_at"),
            "paid_at": e.get("paid_at")
        })
    
    return {
        "tasks": tasks_list,
        "total_count": len(tasks_list)
    }


async def get_developer_earnings_held(
    user_id: str,
    db = None
) -> Dict[str, Any]:
    """
    Get developer held earnings (QA revision required)
    
    Returns:
        List of held earnings with reason
    """
    earnings = await db.task_earnings.find({
        "user_id": user_id,
        "earning_status": EARNING_STATUS_HELD
    }, {"_id": 0}).sort("created_at", -1).to_list(100)
    
    # Get task info
    task_ids = [e["task_id"] for e in earnings]
    tasks = await db.work_units.find({
        "unit_id": {"$in": task_ids}
    }, {"_id": 0, "unit_id": 1, "title": 1, "qa_status": 1, "qa_iteration_count": 1}).to_list(100)
    
    task_map = {t["unit_id"]: t for t in tasks}
    
    held_list = []
    for e in earnings:
        task = task_map.get(e["task_id"], {})
        
        # Determine reason
        revision_count = e.get("revision_count", 0)
        qa_iteration = e.get("qa_iteration_count", 1)
        qa_severity = e.get("qa_severity_max", "unknown")
        revision_hours = e.get("revision_hours", 0)
        
        if revision_count > 0:
            reason = f"QA revision required (iteration {qa_iteration})"
        else:
            reason = "QA review in progress"
        
        held_list.append({
            "earning_id": e["earning_id"],
            "task_id": e["task_id"],
            "task_title": task.get("title", "Untitled"),
            
            "amount": e["final_earning"],
            
            "reason": reason,
            "qa_severity": qa_severity,
            "revision_hours": revision_hours,
            "revision_count": revision_count,
            "qa_iteration": qa_iteration,
            
            "created_at": e.get("created_at")
        })
    
    total_amount = sum(e["final_earning"] for e in earnings)
    
    return {
        "held_earnings": held_list,
        "total_count": len(held_list),
        "total_amount": round(total_amount, 2)
    }


async def get_developer_earnings_flagged(
    user_id: str,
    db = None
) -> Dict[str, Any]:
    """
    Get developer flagged earnings (low confidence / requires review)
    
    Returns:
        List of flagged earnings with trust reason
    """
    earnings = await db.task_earnings.find({
        "user_id": user_id,
        "earning_status": EARNING_STATUS_FLAGGED
    }, {"_id": 0}).sort("created_at", -1).to_list(100)
    
    # Get task info
    task_ids = [e["task_id"] for e in earnings]
    tasks = await db.work_units.find({
        "unit_id": {"$in": task_ids}
    }, {"_id": 0, "unit_id": 1, "title": 1}).to_list(100)
    
    task_map = {t["unit_id"]: t for t in tasks}
    
    flagged_list = []
    for e in earnings:
        task = task_map.get(e["task_id"], {})
        
        # Get confidence info
        confidence_score = e.get("time_confidence_score", 0)
        confidence_gate = e.get("confidence_gate", {})
        primary_issue = confidence_gate.get("reason", "unknown")
        
        # Get manual ratio (if available from time logs)
        # For now, use placeholder - can enhance later
        manual_ratio = None
        
        flagged_list.append({
            "earning_id": e["earning_id"],
            "task_id": e["task_id"],
            "task_title": task.get("title", "Untitled"),
            
            "amount": e["final_earning"],
            
            "confidence_score": round(confidence_score, 2),
            "primary_issue": primary_issue,
            "manual_ratio": manual_ratio,
            
            "created_at": e.get("created_at")
        })
    
    total_amount = sum(e["final_earning"] for e in earnings)
    
    return {
        "flagged_earnings": flagged_list,
        "total_count": len(flagged_list),
        "total_amount": round(total_amount, 2)
    }



# ============================================================================
# ADMIN EARNINGS ENDPOINTS (Step 3D)
# ============================================================================

async def get_admin_earnings_overview(
    period: str = "week",
    db = None
) -> Dict[str, Any]:
    """
    Get admin earnings overview (operational header)
    
    Args:
        period: today | week | month
    
    Returns:
        Overview with approved/held/flagged/batches/paid
    """
    now = datetime.now(timezone.utc)
    
    if period == "today":
        period_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "month":
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    else:  # week
        days_since_monday = now.weekday()
        period_start = now - timedelta(days=days_since_monday)
        period_start = period_start.replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Get earnings for period
    earnings = await db.task_earnings.find({
        "created_at": {"$gte": period_start.isoformat()}
    }, {"_id": 0, "earning_status": 1, "final_earning": 1}).to_list(1000)
    
    # Aggregate by status
    approved_earnings = [e for e in earnings if e["earning_status"] == EARNING_STATUS_APPROVED]
    held_earnings = [e for e in earnings if e["earning_status"] == EARNING_STATUS_HELD]
    flagged_earnings = [e for e in earnings if e["earning_status"] == EARNING_STATUS_FLAGGED]
    
    approved_amount = sum(e["final_earning"] for e in approved_earnings)
    held_amount = sum(e["final_earning"] for e in held_earnings)
    flagged_amount = sum(e["final_earning"] for e in flagged_earnings)
    
    # Get batch counts
    draft_batches = await db.payout_batches.count_documents({
        "status": "draft",
        "created_at": {"$gte": period_start.isoformat()}
    })
    
    approved_batches = await db.payout_batches.count_documents({
        "status": "approved",
        "approved_at": {"$gte": period_start.isoformat()}
    })
    
    # Get paid amount this period
    paid_this_period_agg = await db.task_earnings.aggregate([
        {
            "$match": {
                "earning_status": EARNING_STATUS_PAID,
                "paid_at": {"$gte": period_start.isoformat()}
            }
        },
        {"$group": {"_id": None, "total": {"$sum": "$final_earning"}}}
    ]).to_list(1)
    
    paid_this_period = paid_this_period_agg[0]["total"] if paid_this_period_agg else 0
    
    return {
        "period": period,
        "period_start": period_start.isoformat(),
        
        # Operational header KPIs
        "approved_amount": round(approved_amount, 2),
        "held_amount": round(held_amount, 2),
        "flagged_amount": round(flagged_amount, 2),
        
        "draft_batches_count": draft_batches,
        "approved_batches_count": approved_batches,
        
        "paid_this_period": round(paid_this_period, 2)
    }


async def get_admin_approved_earnings(
    db = None
) -> Dict[str, Any]:
    """
    Get admin approved earnings queue (ready for batch)
    
    Returns:
        List of approved earnings grouped by developer
    """
    # Get all approved earnings
    approved_earnings = await db.task_earnings.find({
        "earning_status": EARNING_STATUS_APPROVED,
        "payout_batch_id": None  # Not yet batched
    }, {"_id": 0}).to_list(500)
    
    # Group by user
    user_earnings = {}
    for e in approved_earnings:
        user_id = e["user_id"]
        if user_id not in user_earnings:
            user_earnings[user_id] = []
        user_earnings[user_id].append(e)
    
    # Get user info
    user_ids = list(user_earnings.keys())
    users = await db.users.find({
        "user_id": {"$in": user_ids}
    }, {"_id": 0, "user_id": 1, "name": 1, "email": 1}).to_list(100)
    
    user_map = {u["user_id"]: u for u in users}
    
    # Get project info for first task (to show main project)
    approved_list = []
    for user_id, earnings in user_earnings.items():
        user = user_map.get(user_id, {})
        
        # Get first task's project
        first_task_id = earnings[0]["task_id"] if earnings else None
        first_task = None
        project_name = "Unknown"
        
        if first_task_id:
            first_task = await db.work_units.find_one(
                {"unit_id": first_task_id},
                {"_id": 0, "project_id": 1}
            )
            
            if first_task and first_task.get("project_id"):
                project = await db.projects.find_one(
                    {"project_id": first_task["project_id"]},
                    {"_id": 0, "name": 1}
                )
                if project:
                    project_name = project.get("name", "Unknown")
        
        # Calculate avg confidence
        confidences = [e.get("time_confidence_score", 0) for e in earnings]
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0
        
        total_amount = sum(e["final_earning"] for e in earnings)
        
        approved_list.append({
            "user_id": user_id,
            "user_name": user.get("name", "Unknown"),
            "user_email": user.get("email"),
            
            "tasks_count": len(earnings),
            "total_amount": round(total_amount, 2),
            "avg_confidence": round(avg_confidence, 2),
            
            "project_name": project_name,
            
            "earning_ids": [e["earning_id"] for e in earnings]
        })
    
    # Sort by amount (highest first)
    approved_list.sort(key=lambda x: x["total_amount"], reverse=True)
    
    return {
        "approved_earnings": approved_list,
        "total_developers": len(approved_list),
        "total_amount": round(sum(item["total_amount"] for item in approved_list), 2)
    }


async def get_admin_held_earnings(
    db = None
) -> Dict[str, Any]:
    """
    Get admin held earnings queue
    
    Returns:
        List of held earnings
    """
    held_earnings = await db.task_earnings.find({
        "earning_status": EARNING_STATUS_HELD
    }, {"_id": 0}).sort("created_at", -1).to_list(200)
    
    # Get task and user info
    task_ids = [e["task_id"] for e in held_earnings]
    user_ids = list(set(e["user_id"] for e in held_earnings))
    
    tasks = await db.work_units.find({
        "unit_id": {"$in": task_ids}
    }, {"_id": 0, "unit_id": 1, "title": 1}).to_list(200)
    
    users = await db.users.find({
        "user_id": {"$in": user_ids}
    }, {"_id": 0, "user_id": 1, "name": 1}).to_list(100)
    
    task_map = {t["unit_id"]: t for t in tasks}
    user_map = {u["user_id"]: u for u in users}
    
    held_list = []
    for e in held_earnings:
        task = task_map.get(e["task_id"], {})
        user = user_map.get(e["user_id"], {})
        
        revision_count = e.get("revision_count", 0)
        qa_iteration = e.get("qa_iteration_count", 1)
        qa_severity = e.get("qa_severity_max", "unknown")
        revision_hours = e.get("revision_hours", 0)
        
        if revision_count > 0:
            reason = f"QA revision required (iteration {qa_iteration})"
        else:
            reason = "QA review in progress"
        
        held_list.append({
            "earning_id": e["earning_id"],
            "task_id": e["task_id"],
            "task_title": task.get("title", "Untitled"),
            
            "user_id": e["user_id"],
            "user_name": user.get("name", "Unknown"),
            
            "amount": e["final_earning"],
            
            "reason": reason,
            "qa_severity": qa_severity,
            "revision_hours": revision_hours,
            "revision_count": revision_count,
            "qa_iteration": qa_iteration,
            
            "created_at": e.get("created_at")
        })
    
    total_amount = sum(e["final_earning"] for e in held_earnings)
    
    return {
        "held_earnings": held_list,
        "total_count": len(held_list),
        "total_amount": round(total_amount, 2)
    }


async def get_admin_flagged_earnings(
    db = None
) -> Dict[str, Any]:
    """
    Get admin flagged earnings queue
    
    Returns:
        List of flagged earnings with trust reasons
    """
    flagged_earnings = await db.task_earnings.find({
        "earning_status": EARNING_STATUS_FLAGGED
    }, {"_id": 0}).sort("created_at", -1).to_list(200)
    
    # Get task and user info
    task_ids = [e["task_id"] for e in flagged_earnings]
    user_ids = list(set(e["user_id"] for e in flagged_earnings))
    
    tasks = await db.work_units.find({
        "unit_id": {"$in": task_ids}
    }, {"_id": 0, "unit_id": 1, "title": 1}).to_list(200)
    
    users = await db.users.find({
        "user_id": {"$in": user_ids}
    }, {"_id": 0, "user_id": 1, "name": 1}).to_list(100)
    
    task_map = {t["unit_id"]: t for t in tasks}
    user_map = {u["user_id"]: u for u in users}
    
    flagged_list = []
    for e in flagged_earnings:
        task = task_map.get(e["task_id"], {})
        user = user_map.get(e["user_id"], {})
        
        confidence_score = e.get("time_confidence_score", 0)
        confidence_gate = e.get("confidence_gate", {})
        primary_issue = confidence_gate.get("reason", "unknown")
        
        # Manual ratio placeholder
        manual_ratio = None
        
        flagged_list.append({
            "earning_id": e["earning_id"],
            "task_id": e["task_id"],
            "task_title": task.get("title", "Untitled"),
            
            "user_id": e["user_id"],
            "user_name": user.get("name", "Unknown"),
            
            "amount": e["final_earning"],
            
            "confidence_score": round(confidence_score, 2),
            "primary_issue": primary_issue,
            "manual_ratio": manual_ratio,
            
            "created_at": e.get("created_at")
        })
    
    total_amount = sum(e["final_earning"] for e in flagged_earnings)
    
    return {
        "flagged_earnings": flagged_list,
        "total_count": len(flagged_list),
        "total_amount": round(total_amount, 2)
    }


async def get_project_dev_cost(
    project_id: str,
    db = None
) -> Dict[str, Any]:
    """
    Get project dev labor cost (baseline for margin intelligence)
    
    Args:
        project_id: Project ID
    
    Returns:
        Dev cost breakdown
    """
    # Get all earnings for project
    all_earnings = await db.task_earnings.find({
        "project_id": project_id
    }, {"_id": 0}).to_list(500)
    
    # Group by status
    approved_earnings = [e for e in all_earnings if e["earning_status"] == EARNING_STATUS_APPROVED]
    held_earnings = [e for e in all_earnings if e["earning_status"] == EARNING_STATUS_HELD]
    paid_earnings = [e for e in all_earnings if e["earning_status"] == EARNING_STATUS_PAID]
    
    developer_cost_total = sum(e["final_earning"] for e in all_earnings if e["earning_status"] in [
        EARNING_STATUS_APPROVED, EARNING_STATUS_BATCHED, EARNING_STATUS_PAID
    ])
    
    approved_cost = sum(e["final_earning"] for e in approved_earnings)
    held_cost = sum(e["final_earning"] for e in held_earnings)
    paid_cost = sum(e["final_earning"] for e in paid_earnings)
    
    # Calculate revision cost
    revision_cost = sum(e.get("revision_hours", 0) * e.get("hourly_rate", 0) for e in all_earnings)
    
    # Get project info
    project = await db.projects.find_one(
        {"project_id": project_id},
        {"_id": 0, "name": 1}
    )
    
    project_name = project.get("name", "Unknown") if project else "Unknown"
    
    return {
        "project_id": project_id,
        "project_name": project_name,
        
        "developer_cost_total": round(developer_cost_total, 2),
        "approved_cost": round(approved_cost, 2),
        "held_cost": round(held_cost, 2),
        "paid_cost": round(paid_cost, 2),
        
        "revision_cost": round(revision_cost, 2),
        
        "tasks_count": len(all_earnings)
    }

