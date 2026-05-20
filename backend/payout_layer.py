"""
PAYOUT LAYER (STEP 3C)

This is the CASH FLOW layer.

Earnings → Batches → Freeze → Payment

Philosophy:
- NO earning changes after batching (frozen)
- NO payment without approval
- FULL trace: task → earning → batch → payment
- Financial discipline enforced
"""

import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

# ============ BATCH STATUS ============

BATCH_STATUS_DRAFT = "draft"
BATCH_STATUS_APPROVED = "approved"
BATCH_STATUS_PAID = "paid"

VALID_BATCH_STATUSES = [BATCH_STATUS_DRAFT, BATCH_STATUS_APPROVED, BATCH_STATUS_PAID]

# ============ PAYMENT METHODS ============

PAYMENT_METHOD_BANK_TRANSFER = "bank_transfer"
PAYMENT_METHOD_PAYPAL = "paypal"
PAYMENT_METHOD_CRYPTO = "crypto"
PAYMENT_METHOD_OTHER = "other"


async def create_payout_batch(
    user_id: str,
    period_start: datetime,
    period_end: datetime,
    db = None
) -> Dict[str, Any]:
    """
    Create payout batch from approved earnings
    
    This FREEZES earnings - they become immutable.
    
    Flow:
    1. Find all approved earnings for period (not already batched)
    2. Create batch
    3. FREEZE earnings (frozen=True, earning_status=batched)
    4. Lock batch composition
    
    Args:
        user_id: Developer ID
        period_start: Start of payout period
        period_end: End of payout period
    
    Returns:
        Payout batch document
    
    Raises:
        ValueError: If no approved earnings found
    """
    from earnings_layer import EARNING_STATUS_APPROVED, EARNING_STATUS_BATCHED
    
    now = datetime.now(timezone.utc)
    
    # 1. Find approved earnings (not yet batched)
    approved_earnings = await db.task_earnings.find({
        "user_id": user_id,
        "earning_status": EARNING_STATUS_APPROVED,
        "payout_batch_id": None,  # Not already in a batch
        "frozen": False,  # Double-check: not frozen
        "created_at": {
            "$gte": period_start.isoformat(),
            "$lt": period_end.isoformat()
        }
    }, {"_id": 0}).to_list(500)
    
    if not approved_earnings:
        raise ValueError(f"No approved earnings found for user {user_id} in period {period_start.date()} - {period_end.date()}")
    
    # 2. DOUBLE-BATCH PROTECTION: Verify each earning
    low_confidence_earnings = []
    
    for earning in approved_earnings:
        if earning.get("earning_status") != EARNING_STATUS_APPROVED:
            raise ValueError(f"Earning {earning['earning_id']} is not approved (status: {earning.get('earning_status')})")
        
        if earning.get("frozen"):
            raise ValueError(f"Earning {earning['earning_id']} is already frozen/batched")
        
        if earning.get("payout_batch_id"):
            raise ValueError(f"Earning {earning['earning_id']} already belongs to batch {earning.get('payout_batch_id')}")
        
        # 3. TRUST-PAYOUT LINK: Check confidence gate
        confidence_score = earning.get("time_confidence_score", 0)
        confidence_gate = earning.get("confidence_gate", {})
        
        if confidence_score < 0.6 or confidence_gate.get("requires_review"):
            low_confidence_earnings.append({
                "earning_id": earning["earning_id"],
                "task_id": earning["task_id"],
                "confidence_score": confidence_score,
                "reason": confidence_gate.get("reason", "low_confidence")
            })
    
    # If there are low-confidence earnings, warn (but don't block - admin decision)
    if low_confidence_earnings:
        logger.warning(
            f"BATCH CREATION WARNING: {len(low_confidence_earnings)} low-confidence earnings included. "
            f"Review recommended before approval. Earnings: {[e['earning_id'] for e in low_confidence_earnings]}"
        )
    
    # 3. Calculate batch amounts (SNAPSHOT - never recalculate)
    earning_ids = [e["earning_id"] for e in approved_earnings]
    
    # Build earnings snapshot for batch (frozen amounts)
    earnings_snapshot = []
    gross_amount = 0
    adjustments_total = 0
    final_amount = 0
    
    for e in approved_earnings:
        base = e["base_earning"]
        adj = (
            e.get("time_adjustment", 0) + 
            e.get("quality_adjustment", 0) + 
            e.get("manual_review_adjustment", 0)
        )
        final = e["final_earning"]
        
        earnings_snapshot.append({
            "earning_id": e["earning_id"],
            "task_id": e["task_id"],
            "base_earning": base,
            "adjustments": adj,
            "final_earning": final
        })
        
        gross_amount += base
        adjustments_total += adj
        final_amount += final
    
    # 4. Create batch
    batch_id = f"batch_{uuid.uuid4().hex[:12]}"
    
    batch_doc = {
        "batch_id": batch_id,
        "user_id": user_id,
        
        # Earnings in this batch
        "earning_ids": earning_ids,
        "task_count": len(earning_ids),
        
        # SNAPSHOT: Amounts frozen at batch creation (NEVER recalculate)
        "gross_amount": round(gross_amount, 2),
        "adjustments_total": round(adjustments_total, 2),
        "final_amount": round(final_amount, 2),
        
        # SNAPSHOT: Earnings breakdown (immutable record)
        "earnings_snapshot": earnings_snapshot,
        
        # TRUST-PAYOUT LINK: Low confidence warnings
        "low_confidence_count": len(low_confidence_earnings),
        "low_confidence_earnings": low_confidence_earnings,
        "requires_confidence_review": len(low_confidence_earnings) > 0,
        
        # Status
        "status": BATCH_STATUS_DRAFT,
        "frozen": False,  # Will be frozen on approval
        
        # Period
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        
        # Approval tracking
        "created_at": now.isoformat(),
        "created_by": None,  # Will be set from API
        "approved_at": None,
        "approved_by": None,
        
        # Payment tracking
        "paid_at": None,
        "payment_method": None,
        "payment_reference": None
    }
    
    # Insert batch
    await db.payout_batches.insert_one(batch_doc)
    
    # 4. FREEZE earnings
    for earning_id in earning_ids:
        await db.task_earnings.update_one(
            {"earning_id": earning_id},
            {"$set": {
                "frozen": True,  # IMMUTABLE
                "payout_batch_id": batch_id,
                "earning_status": EARNING_STATUS_BATCHED,
                "batched_at": now.isoformat(),
                "updated_at": now.isoformat()
            }}
        )
    
    logger.info(f"BATCH CREATED: {batch_id} for {user_id} - {len(earning_ids)} earnings, ${final_amount:.2f}")
    
    return batch_doc


async def approve_payout_batch(
    batch_id: str,
    approved_by: str,
    db = None
) -> Dict[str, Any]:
    """
    Approve payout batch
    
    This makes the batch ready for payment.
    
    Flow:
    1. Check batch exists and is in draft status
    2. Update batch status to approved
    3. Set approved_at and approved_by
    4. Freeze batch (no more changes allowed)
    
    Args:
        batch_id: Batch ID
        approved_by: Admin user ID who approved
    
    Returns:
        Updated batch
    
    Raises:
        ValueError: If batch not found or not in draft status
    """
    now = datetime.now(timezone.utc)
    
    # Get batch
    batch = await db.payout_batches.find_one({"batch_id": batch_id}, {"_id": 0})
    
    if not batch:
        raise ValueError(f"Batch {batch_id} not found")
    
    if batch["status"] != BATCH_STATUS_DRAFT:
        raise ValueError(f"Batch {batch_id} is not in draft status (current: {batch['status']})")
    
    # Update batch
    await db.payout_batches.update_one(
        {"batch_id": batch_id},
        {"$set": {
            "status": BATCH_STATUS_APPROVED,
            "frozen": True,  # Freeze batch composition
            "approved_at": now.isoformat(),
            "approved_by": approved_by
        }}
    )
    
    # Get updated batch
    batch_updated = await db.payout_batches.find_one({"batch_id": batch_id}, {"_id": 0})
    
    logger.info(f"BATCH APPROVED: {batch_id} by {approved_by} - ${batch['final_amount']:.2f}")
    
    return batch_updated


async def mark_batch_paid(
    batch_id: str,
    payment_method: str,
    payment_reference: str = "",
    db = None
) -> Dict[str, Any]:
    """
    Mark batch as paid
    
    This is the final step - money has been transferred.
    
    Flow:
    1. Check batch is approved
    2. Update batch status to paid
    3. Update all earnings to paid status
    4. Set paid_at timestamp
    
    Args:
        batch_id: Batch ID
        payment_method: bank_transfer | paypal | crypto | other
        payment_reference: Transaction ID or reference
    
    Returns:
        Updated batch
    
    Raises:
        ValueError: If batch not approved or already paid
    """
    from earnings_layer import EARNING_STATUS_PAID
    
    now = datetime.now(timezone.utc)
    
    # Get batch
    batch = await db.payout_batches.find_one({"batch_id": batch_id}, {"_id": 0})
    
    if not batch:
        raise ValueError(f"Batch {batch_id} not found")
    
    if batch["status"] == BATCH_STATUS_PAID:
        raise ValueError(f"Batch {batch_id} is already marked as paid")
    
    if batch["status"] != BATCH_STATUS_APPROVED:
        raise ValueError(f"Batch {batch_id} must be approved before marking as paid (current: {batch['status']})")
    
    # Update batch
    await db.payout_batches.update_one(
        {"batch_id": batch_id},
        {"$set": {
            "status": BATCH_STATUS_PAID,
            "paid_at": now.isoformat(),
            "payment_method": payment_method,
            "payment_reference": payment_reference
        }}
    )
    
    # Update all earnings in batch to paid
    for earning_id in batch["earning_ids"]:
        await db.task_earnings.update_one(
            {"earning_id": earning_id},
            {"$set": {
                "earning_status": EARNING_STATUS_PAID,
                "paid_at": now.isoformat(),
                "updated_at": now.isoformat()
            }}
        )
    
    logger.info(f"BATCH PAID: {batch_id} - {payment_method} - ${batch['final_amount']:.2f}")

    # Phase 2B PR-3 — canonical mirror: a payout_batch close is the
    # batch-level analog of a per-developer withdrawal mark-paid. Same
    # bridge function records `kind=payout` on `ac_dev:<developer> ->
    # ac_ext:<developer>`. Bridge is internally exception-safe; legacy
    # update above is authoritative.
    from money_bridge import bridge_payout_processed  # lazy import
    await bridge_payout_processed(
        developer_id=batch.get("user_id") or batch.get("developer_id") or "unknown",
        amount_dollars=float(batch.get("final_amount") or 0),
        legacy_id=f"batch_{batch_id}",
        legacy_kind="payout_batch",
        actor="admin_batch",
        external_ref=payment_reference,
    )

    # Get updated batch
    batch_updated = await db.payout_batches.find_one({"batch_id": batch_id}, {"_id": 0})
    
    return batch_updated


async def get_developer_batches(
    user_id: str,
    status: Optional[str] = None,
    db = None
) -> List[Dict[str, Any]]:
    """
    Get payout batches for developer
    
    Args:
        user_id: Developer ID
        status: Filter by status (draft | approved | paid) or None for all
    
    Returns:
        List of batches
    """
    query = {"user_id": user_id}
    
    if status:
        if status not in VALID_BATCH_STATUSES:
            raise ValueError(f"Invalid status. Must be one of: {VALID_BATCH_STATUSES}")
        query["status"] = status
    
    batches = await db.payout_batches.find(
        query,
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    
    return batches


async def get_batch_details(
    batch_id: str,
    db = None
) -> Dict[str, Any]:
    """
    Get batch details with earnings breakdown
    
    Args:
        batch_id: Batch ID
    
    Returns:
        Batch with earnings list
    
    Raises:
        ValueError: If batch not found
    """
    # Get batch
    batch = await db.payout_batches.find_one({"batch_id": batch_id}, {"_id": 0})
    
    if not batch:
        raise ValueError(f"Batch {batch_id} not found")
    
    # Get earnings in batch
    earnings = await db.task_earnings.find({
        "earning_id": {"$in": batch["earning_ids"]}
    }, {"_id": 0}).to_list(500)
    
    # Get task titles
    task_ids = [e["task_id"] for e in earnings]
    tasks = await db.work_units.find({
        "unit_id": {"$in": task_ids}
    }, {"_id": 0, "unit_id": 1, "title": 1}).to_list(500)
    
    task_map = {t["unit_id"]: t.get("title", "Untitled") for t in tasks}
    
    # Build earnings summary
    earnings_summary = []
    for earning in earnings:
        earnings_summary.append({
            "earning_id": earning["earning_id"],
            "task_id": earning["task_id"],
            "task_title": task_map.get(earning["task_id"], "Unknown"),
            "base_earning": earning["base_earning"],
            "quality_adjustment": earning.get("quality_adjustment", 0),
            "time_adjustment": earning.get("time_adjustment", 0),
            "manual_review_adjustment": earning.get("manual_review_adjustment", 0),
            "final_earning": earning["final_earning"],
            "revision_count": earning.get("revision_count", 0),
            "first_pass_success": earning.get("first_pass_success", False)
        })
    
    return {
        **batch,
        "earnings": earnings_summary
    }


async def get_admin_batch_overview(
    status: Optional[str] = None,
    db = None
) -> Dict[str, Any]:
    """
    Get admin overview of all batches
    
    Args:
        status: Filter by status or None for all
    
    Returns:
        Overview with stats and batch list
    """
    query = {}
    if status:
        if status not in VALID_BATCH_STATUSES:
            raise ValueError(f"Invalid status. Must be one of: {VALID_BATCH_STATUSES}")
        query["status"] = status
    
    # Get batches
    batches = await db.payout_batches.find(
        query,
        {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    
    # Calculate stats
    draft_batches = [b for b in batches if b["status"] == BATCH_STATUS_DRAFT]
    approved_batches = [b for b in batches if b["status"] == BATCH_STATUS_APPROVED]
    paid_batches = [b for b in batches if b["status"] == BATCH_STATUS_PAID]
    
    stats = {
        "total_batches": len(batches),
        "draft_count": len(draft_batches),
        "approved_count": len(approved_batches),
        "paid_count": len(paid_batches),
        "draft_amount": sum(b["final_amount"] for b in draft_batches),
        "approved_amount": sum(b["final_amount"] for b in approved_batches),
        "paid_amount": sum(b["final_amount"] for b in paid_batches)
    }
    
    # Get user names
    user_ids = list(set(b["user_id"] for b in batches))
    users = await db.users.find({
        "user_id": {"$in": user_ids}
    }, {"_id": 0, "user_id": 1, "name": 1, "email": 1}).to_list(200)
    
    user_map = {u["user_id"]: {"name": u.get("name", "Unknown"), "email": u.get("email")} for u in users}
    
    # Add user info to batches
    for batch in batches:
        user_info = user_map.get(batch["user_id"], {"name": "Unknown", "email": ""})
        batch["developer_name"] = user_info["name"]
        batch["developer_email"] = user_info["email"]
    
    return {
        "stats": stats,
        "batches": batches
    }


async def get_approved_earnings_ready_for_batch(
    user_id: str,
    db = None
) -> Dict[str, Any]:
    """
    Get approved earnings ready to be batched
    
    Args:
        user_id: Developer ID
    
    Returns:
        Summary of earnings ready for batch
    """
    from earnings_layer import EARNING_STATUS_APPROVED
    
    # Get approved earnings not yet in batch
    approved_earnings = await db.task_earnings.find({
        "user_id": user_id,
        "earning_status": EARNING_STATUS_APPROVED,
        "payout_batch_id": None
    }, {"_id": 0}).to_list(500)
    
    if not approved_earnings:
        return {
            "user_id": user_id,
            "ready_for_batch": False,
            "earnings_count": 0,
            "total_amount": 0,
            "earnings": []
        }
    
    total_amount = sum(e["final_earning"] for e in approved_earnings)
    
    # Get task titles
    task_ids = [e["task_id"] for e in approved_earnings]
    tasks = await db.work_units.find({
        "unit_id": {"$in": task_ids}
    }, {"_id": 0, "unit_id": 1, "title": 1}).to_list(500)
    
    task_map = {t["unit_id"]: t.get("title", "Untitled") for t in tasks}
    
    # Build summary
    earnings_summary = []
    for earning in approved_earnings:
        earnings_summary.append({
            "earning_id": earning["earning_id"],
            "task_id": earning["task_id"],
            "task_title": task_map.get(earning["task_id"], "Unknown"),
            "final_earning": earning["final_earning"],
            "approved_at": earning.get("approved_at")
        })
    
    return {
        "user_id": user_id,
        "ready_for_batch": True,
        "earnings_count": len(approved_earnings),
        "total_amount": round(total_amount, 2),
        "earnings": earnings_summary
    }
