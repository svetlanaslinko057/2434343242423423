"""
Этап 6.1 — Money Runtime Activation.

Wires `escrow_layer.py` (until now unrouted, 11 functions, 0 endpoints) into
the FastAPI app and provides a vendor-neutral `/api/money/runtime/state`
read endpoint that exposes the **continuity** of the money flow:

    invoice -> escrow.pending -> client_pay -> escrow.funded
            -> module.in_progress -> module.done -> escrow.released
            -> developer earnings + payout batch

Honest mode tagging: every response carries `payment_mode` from the
boundary layer (`registry.payment().health().mode`) so the UI can render
either a real Pay button or a "Sandbox payment environment — no real
charge" honest state.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import escrow_layer
from integrations import registry as _ipg

logger = logging.getLogger("money_runtime")

# Module-level holders bound at wire() time.
_db = None

router = APIRouter(tags=["money-runtime"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _payment_mode() -> str:
    """live | mock | degraded | unavailable. UI must hide live CTAs when
    mode != live and show a sandbox badge instead."""
    return _ipg.payment().health().mode.value


# ─────────────────────────────────────────────────────────────────────────────
# Request/response models — frozen shape, vendor-neutral.
# ─────────────────────────────────────────────────────────────────────────────

class CreateEscrowReq(BaseModel):
    module_id: str
    amount: float


class FundEscrowReq(BaseModel):
    invoice_id: Optional[str] = None  # idempotency link to paid invoice


class ReleaseEscrowReq(BaseModel):
    completed_share: float = 1.0  # 0..1
    triggered_by: str = "admin_release"


class RefundEscrowReq(BaseModel):
    reason: str = "cancelled"


def wire(*, db, get_current_user, require_role):
    """Called from server.py after it has built `db` and the auth deps.
    Routes are registered HERE so we can use the real Depends(...) values
    without going through a lambda (FastAPI inspects the signature)."""
    global _db
    _db = db

    # ============ ESCROW LIFECYCLE ============

    @router.post("/escrow/create")
    async def escrow_create(
        body: CreateEscrowReq,
        user=Depends(require_role("client", "admin")),
    ):
        try:
            doc = await escrow_layer.create_escrow(
                _db, module_id=body.module_id,
                client_id=user.user_id, amount=body.amount,
            )
            return {**doc, "payment_mode": _payment_mode()}
        except escrow_layer.EscrowError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @router.post("/escrow/{escrow_id}/fund")
    async def escrow_fund(
        escrow_id: str,
        body: FundEscrowReq,
        user=Depends(require_role("client", "admin")),
    ):
        """Mark escrow as funded.

        `payment_mode == 'mock'`: this endpoint is the canonical "I paid"
        trigger for sandbox demos. UI must show a sandbox badge BEFORE
        the user clicks. No real money moves.

        `payment_mode == 'live'`: client direct POST is forbidden — funding
        flips automatically via the payment-provider webhook, AFTER
        signature-verified payment. Admin override is allowed for recovery.
        """
        mode = _payment_mode()
        if mode == "live" and user.role != "admin":
            raise HTTPException(
                status_code=403,
                detail="In live mode escrow funding is automated via payment webhook",
            )
        try:
            doc = await escrow_layer.fund_escrow(
                _db, escrow_id=escrow_id, funded_by=user.user_id,
            )
            # Settlement chain: mark linked invoice as settled.
            if body.invoice_id:
                await _db.invoices.update_one(
                    {"invoice_id": body.invoice_id, "status": {"$ne": "paid"}},
                    {"$set": {
                        "status": "paid",
                        "paid_at": _now(),
                        "settlement_escrow_id": escrow_id,
                        "payment_mode": mode,
                    }},
                )
            return {**doc, "payment_mode": mode, "funding_mode": mode}
        except escrow_layer.EscrowError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @router.post("/escrow/{escrow_id}/release")
    async def escrow_release(
        escrow_id: str,
        body: ReleaseEscrowReq,
        user=Depends(require_role("admin")),
    ):
        try:
            result = await escrow_layer.release_escrow(
                _db, escrow_id=escrow_id,
                completed_share=body.completed_share,
                triggered_by=body.triggered_by,
            )
            # release_escrow returns {escrow, payouts, release_total}
            return {**result, "payment_mode": _payment_mode()}
        except escrow_layer.EscrowError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @router.post("/escrow/{escrow_id}/refund")
    async def escrow_refund(
        escrow_id: str,
        body: RefundEscrowReq,
        user=Depends(require_role("admin")),
    ):
        try:
            doc = await escrow_layer.refund_escrow(
                _db, escrow_id=escrow_id, reason=body.reason,
            )
            return {**doc, "payment_mode": _payment_mode()}
        except escrow_layer.EscrowError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # ============ ESCROW READS ============

    @router.get("/escrow/module/{module_id}")
    async def escrow_for_module(
        module_id: str,
        user=Depends(get_current_user),
    ):
        doc = await escrow_layer.get_escrow_for_module(_db, module_id=module_id)
        if not doc:
            return {"escrow": None, "payment_mode": _payment_mode()}
        return {**doc, "payment_mode": _payment_mode()}

    @router.get("/escrow/{escrow_id}")
    async def escrow_get(
        escrow_id: str,
        user=Depends(get_current_user),
    ):
        doc = await escrow_layer.get_escrow(_db, escrow_id=escrow_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Escrow not found")
        is_admin = user.role == "admin"
        is_owner = doc.get("client_id") == user.user_id
        if not (is_admin or is_owner):
            mod = await _db.modules.find_one({"module_id": doc["module_id"]}, {"_id": 0})
            team_ids = {m.get("user_id") for m in (mod or {}).get("team", [])}
            if user.user_id not in team_ids:
                raise HTTPException(status_code=403, detail="Not authorized")
        return {**doc, "payment_mode": _payment_mode()}

    @router.get("/client/escrows")
    async def client_escrows(
        user=Depends(require_role("client", "admin")),
    ):
        items = await escrow_layer.list_client_escrows(_db, client_id=user.user_id)
        return {
            "escrows": items,
            "count": len(items),
            "payment_mode": _payment_mode(),
        }

    @router.get("/developer/escrow-payouts")
    async def developer_escrow_payouts(
        user=Depends(require_role("developer", "admin")),
    ):
        """Per-escrow payout records to this developer. Complements the
        existing /api/developer/earnings/* (per-task) and
        /api/developer/payout/batches (batch-level) endpoints — this is
        the escrow-bound view."""
        items = await escrow_layer.list_dev_payouts(_db, developer_id=user.user_id)
        return {
            "payouts": items,
            "count": len(items),
            "payment_mode": _payment_mode(),
        }

    @router.get("/admin/escrow/dashboard")
    async def admin_escrow_dashboard(
        user=Depends(require_role("admin")),
    ):
        data = await escrow_layer.admin_dashboard(_db)
        return {**data, "payment_mode": _payment_mode()}


# ============ MONEY RUNTIME STATE (public, no auth) ============

@router.get("/money/runtime/state")
async def money_runtime_state():
    """Single source of truth for the money flow's current state.

    Public endpoint (no auth) — counts only, no PII, no individual amounts.
    UI consumes this to render the "settlement chain" banner showing where
    the system currently stands and whether any link is degraded.
    """
    pay_state = _ipg.payment().health()

    invoices_total = await _db.invoices.count_documents({})
    invoices_paid = await _db.invoices.count_documents({"status": "paid"})
    invoices_pending = await _db.invoices.count_documents(
        {"status": {"$in": ["pending_payment", "draft", "overdue"]}}
    )

    escrows_total = await _db.escrows.count_documents({})
    escrows_pending = await _db.escrows.count_documents({"status": escrow_layer.STATUS_PENDING})
    escrows_funded = await _db.escrows.count_documents({"status": escrow_layer.STATUS_FUNDED})
    escrows_partial = await _db.escrows.count_documents({"status": escrow_layer.STATUS_PARTIAL})
    escrows_completed = await _db.escrows.count_documents({"status": escrow_layer.STATUS_COMPLETED})
    escrows_refunded = await _db.escrows.count_documents({"status": escrow_layer.STATUS_REFUNDED})

    payouts_total = await _db.payouts.count_documents({})
    payouts_paid = await _db.payouts.count_documents({"status": "paid"})

    earning_logs = await _db.dev_earning_log.count_documents({})

    diagnostics = []
    orphan_paid = await _db.invoices.count_documents({
        "status": "paid",
        "settlement_escrow_id": {"$exists": False},
    })
    if orphan_paid > 0:
        diagnostics.append({
            "level": "info",
            "code": "paid_invoices_without_escrow_link",
            "count": orphan_paid,
            "message": "Some paid invoices predate the escrow settlement chain.",
        })
    diagnostics.append({
        "level": "info",
        "code": "escrows_in_funded_state",
        "count": escrows_funded,
        "message": "Funds locked, awaiting module completion.",
    })

    return {
        "payment_capability": {
            "provider": pay_state.provider_name,
            "mode": pay_state.mode.value,
            "available": pay_state.available,
            "reason": pay_state.reason,
        },
        "stages": {
            "invoices": {
                "total": invoices_total,
                "paid": invoices_paid,
                "pending": invoices_pending,
            },
            "escrows": {
                "total": escrows_total,
                "pending": escrows_pending,
                "funded": escrows_funded,
                "partially_released": escrows_partial,
                "completed": escrows_completed,
                "refunded": escrows_refunded,
            },
            "earnings": {
                "log_entries": earning_logs,
            },
            "payouts": {
                "total": payouts_total,
                "paid": payouts_paid,
            },
        },
        "diagnostics": diagnostics,
        "checked_at": _now(),
    }


# ============ SETTLEMENT CHAIN HOOKS ============
#
# Called from server.py's existing endpoints (invoice mark-paid, module
# mark-done) so the money flow becomes end-to-end without rewriting those
# endpoints. Each hook is idempotent.

async def on_invoice_paid(invoice_doc: dict, *, funded_by: Optional[str] = None) -> dict:
    """Called after an invoice flips to status=paid. Funds the linked
    module's escrow if one exists, creating it lazily if not.
    Idempotent."""
    if _db is None:
        return {"linked": False, "reason": "money_runtime not wired"}
    module_id = invoice_doc.get("module_id")
    if not module_id:
        return {"linked": False, "reason": "invoice has no module_id"}

    existing = await escrow_layer.get_escrow_for_module(_db, module_id=module_id)
    if existing and existing["status"] == escrow_layer.STATUS_FUNDED:
        return {"linked": True, "escrow_id": existing["escrow_id"], "noop": True}

    if not existing:
        try:
            existing = await escrow_layer.create_escrow(
                _db,
                module_id=module_id,
                client_id=invoice_doc.get("client_id") or funded_by or "system",
                amount=float(invoice_doc.get("amount") or 0),
            )
        except escrow_layer.EscrowError as e:
            return {"linked": False, "reason": str(e)}

    if existing["status"] == escrow_layer.STATUS_PENDING:
        try:
            funded = await escrow_layer.fund_escrow(
                _db, escrow_id=existing["escrow_id"],
                funded_by=funded_by or invoice_doc.get("client_id") or "system",
            )
            return {"linked": True, "escrow_id": funded["escrow_id"], "funded": True}
        except escrow_layer.EscrowError as e:
            return {"linked": False, "reason": str(e)}

    return {"linked": True, "escrow_id": existing["escrow_id"]}


async def on_module_done_chain(module_id: str) -> dict:
    """Called when a module flips to status=done. Releases escrow which
    cascades into developer earnings via escrow_layer.release_escrow."""
    if _db is None:
        return {"released": False, "reason": "money_runtime not wired"}
    try:
        result = await escrow_layer.on_module_done(_db, module_id=module_id)
        return result or {"released": True}
    except Exception as e:
        logger.warning(f"on_module_done_chain failed for {module_id}: {e}")
        return {"released": False, "reason": str(e)}
