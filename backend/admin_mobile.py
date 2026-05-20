"""
Admin Mobile — projection layer (v1 stable).

Mobile = pult. Web = brain.
Mobile НЕ повторяет 95 web admin endpoints — оно общается через
агрегированные ручки этого модуля. Один контракт, без дублирования.

================================================================
ITEM CONTRACT (universal across qa/finance/etc.)
================================================================
Every list item respects this shape:
    {
      "id": "...",                 # primary identifier
      "title": "...",              # one-liner headline
      "subtitle": "...",           # secondary context (project · dev, etc.)
      "status": "...",             # current state
      "created_at": "...",         # ISO UTC, may be null
      "meta": { ... },             # type-specific extras (amount, price, etc.)
      "primary_action": "...",     # default mobile action key
      "actions": [...],            # available action keys
      "web_url": "/admin/..."      # deep-dive link to web admin
    }

================================================================
SEMANTICS (fixed contract)
================================================================
* withdrawal/approve  = "approved for inclusion in a payout batch".
                        Does NOT transfer funds.
* withdrawal/reject   = denied. Funds stay in dev's wallet.
* payout-batches/{id}/approve = REAL money movement (dispatch to provider).
* qa/{id}/approve     = canonical pass → triggers _credit_module_reward.
* qa/{id}/revision    = back to in_progress.
* qa/{id}/reject      = terminal failure. No reward.

================================================================
GUARANTEES
================================================================
1. ALL endpoints require role=admin (HTTP 403 otherwise).
2. ALL POST actions are idempotent: re-issuing → 409 with current_status.
3. ALL POST actions write to db.system_actions_log for cross-surface audit.
4. ALL POST actions emit realtime event to admin role (web sees mobile actions).
5. NO silent failures: reward/audit/realtime errors are logged + raised when
   they affect financial integrity.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Body

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["admin-mobile"])

# Web admin base URL for web_url generation. Backend is mounted at /api on
# the same origin as web build (/api/web-ui). If BACKEND_URL not set,
# we fall back to relative paths — mobile will resolve against EXPO_PUBLIC_BACKEND_URL.
_WEB_BASE = (os.environ.get("BACKEND_URL", "") or "").rstrip("/")
_WEB_PREFIX = f"{_WEB_BASE}/api/web-ui" if _WEB_BASE else "/api/web-ui"


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _web_url(path: str) -> str:
    """Build absolute (or relative if BACKEND_URL missing) web admin URL."""
    if not path.startswith("/"):
        path = "/" + path
    return f"{_WEB_PREFIX}{path}"


def _user_id_of(user) -> Optional[str]:
    """Resolve user_id from either pydantic model or dict."""
    if user is None:
        return None
    if isinstance(user, dict):
        return user.get("user_id")
    return getattr(user, "user_id", None)


def _user_field(user, field: str, default: str = "") -> str:
    if user is None:
        return default
    if isinstance(user, dict):
        return user.get(field) or default
    return getattr(user, field, None) or default


# QA states
QA_AWAITING_DECISION = {"review", "qa_pending"}
QA_RESULT_TO_STATUS = {
    "approve": "completed",
    "revision": "in_progress",
    "reject": "rejected",
}
QA_RESULT_DB = {
    "approve": "passed",
    "revision": "revision_required",
    "reject": "rejected",
}

# Withdrawal states
WITHDRAWAL_AWAITING = {"requested", "pending"}

# Payout batch states
BATCH_AWAITING = {"pending"}


def init_router(db, get_current_user_dep, require_role_dep, realtime=None):
    """Wire with db + admin role guard + realtime emitter (optional).

    realtime: object with `.emit_to_role(role, event, payload)` async method.
              When None, realtime emit is skipped silently (and logged at debug).
    """
    require_admin = require_role_dep("admin")

    # ============================================================
    # AUDIT + REALTIME HELPERS
    # ============================================================
    async def _write_audit(
        admin_id: Optional[str],
        action: str,
        entity_type: str,
        entity_id: str,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Write to system_actions_log for cross-surface audit.

        Failure to write audit is a system integrity issue — we log and
        raise HTTPException so the action is rolled back at API level.
        """
        try:
            await db.system_actions_log.insert_one({
                "log_id": f"slog_{uuid.uuid4().hex[:12]}",
                "admin_id": admin_id,
                "action": action,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "payload": payload or {},
                "source": "admin_mobile",
                "status": "executed",
                "created_at": _iso_now(),
            })
        except Exception as e:  # pragma: no cover — DB failure path
            logger.error(f"audit_log_failed action={action} entity={entity_id} err={e}")
            raise HTTPException(status_code=500, detail="audit_log_failed")

    async def _emit(event: str, payload: Dict[str, Any]) -> None:
        """Realtime emit to admin role. Failures are logged, not raised
        (UI consistency degrades to next refresh — not a money issue)."""
        if realtime is None:
            logger.debug(f"realtime_skipped event={event} (no emitter wired)")
            return
        try:
            await realtime.emit_to_role("admin", event, payload)
        except Exception as e:
            logger.warning(f"realtime_emit_failed event={event} err={e}")

    # ============================================================
    # HOME — single source of truth for the pult landing screen
    # ============================================================
    @router.get("/admin/mobile/home")
    async def home(user=Depends(require_admin)) -> Dict[str, Any]:
        # Money-actionable signals (user can resolve from mobile)
        qa_pending = await db.modules.count_documents({
            "status": {"$in": list(QA_AWAITING_DECISION)},
        })
        withdrawals_pending = await db.withdrawals.count_documents({
            "status": {"$in": list(WITHDRAWAL_AWAITING)},
        })
        payout_batches_pending = await db.payout_batches.count_documents({
            "status": {"$in": list(BATCH_AWAITING)},
        })

        # Snapshot
        active_modules = await db.modules.count_documents({
            "status": {"$in": ["in_progress", "pending"]},
        })
        active_devs = await db.users.count_documents({
            "$or": [{"role": "developer"}, {"roles": "developer"}],
        })

        # Advanced (no direct mobile action — links to web)
        blocked_modules = await db.modules.count_documents({
            "$or": [
                {"status": "blocked"},
                {"flags.blocked": True},
            ],
        })
        overload_pipeline = [
            {"$match": {"status": {"$in": ["in_progress", "pending"]},
                        "assigned_to": {"$ne": None}}},
            {"$group": {"_id": "$assigned_to", "n": {"$sum": 1}}},
            {"$match": {"n": {"$gt": 3}}},
        ]
        overloaded = await db.modules.aggregate(overload_pipeline).to_list(100)
        overloaded_count = len([o for o in overloaded if o.get("_id")])

        # Quick actions surface ONLY when relevant work exists.
        quick_actions: List[Dict[str, Any]] = []
        if qa_pending > 0:
            quick_actions.append({
                "key": "review_qa",
                "label": "Review QA",
                "count": qa_pending,
                "route": "/admin/qa",
                "web_url": _web_url("/admin/qa"),
            })
        if withdrawals_pending + payout_batches_pending > 0:
            quick_actions.append({
                "key": "approve_payouts",
                "label": "Approve payouts",
                "count": withdrawals_pending + payout_batches_pending,
                "route": "/admin/finance",
                "web_url": _web_url("/admin/withdrawals"),
            })

        return {
            "alerts": {
                "qa_pending": qa_pending,
                "withdrawals_pending": withdrawals_pending,
                "payout_batches_pending": payout_batches_pending,
            },
            "snapshot": {
                "active_devs": active_devs,
                "active_modules": active_modules,
                "qa_pending": qa_pending,
            },
            "quick_actions": quick_actions,
            "advanced": {
                "overloaded_devs": overloaded_count,
                "blocked_modules": blocked_modules,
                "web_url": _web_url("/admin/team?filter=overload"),
            },
            "generated_at": _iso_now(),
        }

    # ============================================================
    # QA — list + decision endpoints (action-first, no tables)
    # ============================================================
    @router.get("/admin/mobile/qa")
    async def qa_list(user=Depends(require_admin)) -> Dict[str, Any]:
        mods = await db.modules.find(
            {"status": {"$in": list(QA_AWAITING_DECISION)}},
            {"_id": 0, "module_id": 1, "title": 1, "project_id": 1,
             "assigned_to": 1, "submitted_at": 1, "client_price": 1,
             "status": 1, "revision_count": 1}
        ).sort("submitted_at", 1).limit(50).to_list(50)

        # Enrich with project + dev names
        pids = list({m.get("project_id") for m in mods if m.get("project_id")})
        dids = list({m.get("assigned_to") for m in mods if m.get("assigned_to")})
        proj_map: Dict[str, str] = {}
        dev_map: Dict[str, str] = {}
        if pids:
            for p in await db.projects.find(
                {"project_id": {"$in": pids}},
                {"_id": 0, "project_id": 1, "name": 1, "title": 1}
            ).to_list(200):
                proj_map[p["project_id"]] = p.get("name") or p.get("title") or ""
        if dids:
            for d in await db.users.find(
                {"user_id": {"$in": dids}},
                {"_id": 0, "user_id": 1, "name": 1}
            ).to_list(200):
                dev_map[d["user_id"]] = d.get("name") or "Developer"

        items = []
        for m in mods:
            mid = m["module_id"]
            project_title = proj_map.get(m.get("project_id") or "", "")
            developer_name = dev_map.get(m.get("assigned_to") or "", "")
            subtitle_parts = [s for s in [project_title, developer_name] if s]
            items.append({
                "id": mid,
                "title": m.get("title") or "Module",
                "subtitle": " · ".join(subtitle_parts) or "—",
                "status": m.get("status") or "",
                "created_at": m.get("submitted_at"),
                "meta": {
                    "client_price": float(m.get("client_price") or 0),
                    "revision_count": int(m.get("revision_count") or 0),
                    "project_id": m.get("project_id"),
                    "developer_id": m.get("assigned_to"),
                },
                "primary_action": "approve",
                "actions": ["approve", "revision", "reject"],
                "web_url": _web_url(f"/admin/qa?module_id={mid}"),
            })

        return {
            "items": items,
            "summary": {"pending": len(items), "has_more": False},
            "generated_at": _iso_now(),
        }

    async def _qa_decision(
        module_id: str,
        action_key: str,
        reason: Optional[str],
        admin_id: Optional[str],
    ) -> Dict[str, Any]:
        if action_key not in QA_RESULT_TO_STATUS:
            raise HTTPException(400, detail=f"Invalid action: {action_key}")

        m = await db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not m:
            raise HTTPException(404, detail="Module not found")

        # Idempotency guard — money-critical
        if m.get("status") not in QA_AWAITING_DECISION:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Module already decided",
                    "current_status": m.get("status"),
                    "module_id": module_id,
                },
            )

        new_status = QA_RESULT_TO_STATUS[action_key]
        result_db = QA_RESULT_DB[action_key]

        update_doc: Dict[str, Any] = {
            "$set": {
                "status": new_status,
                "review_notes": reason or "",
                "qa_decided_at": _iso_now(),
                "qa_decided_by": admin_id,
            }
        }
        if action_key == "revision":
            update_doc["$inc"] = {"revision_count": 1}

        await db.modules.update_one({"module_id": module_id}, update_doc)
        await db.qa_decisions.insert_one({
            "module_id": module_id,
            "developer_id": m.get("assigned_to"),
            "result": result_db,
            "reason": reason,
            "decided_by": admin_id,
            "source": "admin_mobile",
            "created_at": _iso_now(),
        })

        # Trigger reward only on pass — same canonical path as web admin.
        # Failure here is FINANCIAL — log loud and raise so admin sees it.
        if action_key == "approve":
            try:
                from server import _credit_module_reward  # type: ignore
                await _credit_module_reward({**m, "status": new_status})
            except HTTPException:
                raise
            except Exception as e:
                logger.error(
                    f"credit_module_reward_failed module={module_id} dev={m.get('assigned_to')} err={e}"
                )
                # Roll back module status so retry is possible
                await db.modules.update_one(
                    {"module_id": module_id},
                    {"$set": {"status": m.get("status")},
                     "$unset": {"qa_decided_at": "", "qa_decided_by": ""}}
                )
                raise HTTPException(500, detail="Reward processing failed; decision rolled back")

        # Audit + realtime
        await _write_audit(
            admin_id=admin_id,
            action=f"qa_{action_key}",
            entity_type="module",
            entity_id=module_id,
            payload={"reason": reason, "previous_status": m.get("status"),
                     "new_status": new_status},
        )
        await _emit("admin.qa_decided", {
            "module_id": module_id,
            "action": action_key,
            "new_status": new_status,
            "by": admin_id,
            "at": _iso_now(),
        })

        return {
            "id": module_id,
            "status": new_status,
            "action": action_key,
            "decided_at": _iso_now(),
        }

    @router.post("/admin/mobile/qa/{module_id}/approve")
    async def qa_approve(module_id: str, user=Depends(require_admin)):
        return await _qa_decision(module_id, "approve", None, _user_id_of(user))

    @router.post("/admin/mobile/qa/{module_id}/revision")
    async def qa_revision(
        module_id: str,
        body: Optional[Dict[str, Any]] = Body(None),
        user=Depends(require_admin),
    ):
        reason = (body or {}).get("reason") or "Revision required"
        return await _qa_decision(module_id, "revision", reason, _user_id_of(user))

    @router.post("/admin/mobile/qa/{module_id}/reject")
    async def qa_reject(
        module_id: str,
        body: Optional[Dict[str, Any]] = Body(None),
        user=Depends(require_admin),
    ):
        reason = (body or {}).get("reason") or "Rejected"
        return await _qa_decision(module_id, "reject", reason, _user_id_of(user))

    # ============================================================
    # FINANCE — withdrawals + payout batches
    # ============================================================
    @router.get("/admin/mobile/finance")
    async def finance(user=Depends(require_admin)) -> Dict[str, Any]:
        withdrawals = await db.withdrawals.find(
            {"status": {"$in": list(WITHDRAWAL_AWAITING)}},
            {"_id": 0}
        ).sort("created_at", 1).limit(50).to_list(50)

        batches = await db.payout_batches.find(
            {"status": {"$in": list(BATCH_AWAITING)}},
            {"_id": 0}
        ).sort("created_at", 1).limit(20).to_list(20)

        # Enrich withdrawals with dev name
        dids = list({w.get("user_id") for w in withdrawals if w.get("user_id")})
        dev_map: Dict[str, str] = {}
        if dids:
            for d in await db.users.find(
                {"user_id": {"$in": dids}},
                {"_id": 0, "user_id": 1, "name": 1, "email": 1}
            ).to_list(200):
                dev_map[d["user_id"]] = d.get("name") or d.get("email") or "Developer"

        withdrawal_items = []
        for w in withdrawals:
            wid = w.get("withdrawal_id") or w.get("id")
            amount = float(w.get("amount") or 0)
            method = w.get("method") or "bank"
            dev_name = dev_map.get(w.get("user_id") or "", "Developer")
            withdrawal_items.append({
                "id": wid,
                "title": f"${amount:,.0f} — {dev_name}",
                "subtitle": f"{method} · {w.get('status')}",
                "status": w.get("status") or "",
                "created_at": w.get("created_at"),
                "meta": {
                    "amount": amount,
                    "currency": w.get("currency") or "USD",
                    "method": method,
                    "developer_id": w.get("user_id"),
                    "developer_name": dev_name,
                },
                "primary_action": "approve",
                "actions": ["approve", "reject"],
                "web_url": _web_url(f"/admin/withdrawals?id={wid}"),
            })

        batch_items = []
        for b in batches:
            bid = b.get("batch_id") or b.get("id")
            total = float(b.get("amount_total") or b.get("total") or 0)
            dev_count = int(b.get("developer_count") or len(b.get("entries") or []))
            batch_items.append({
                "id": bid,
                "title": f"Batch · {dev_count} dev{'s' if dev_count != 1 else ''}",
                "subtitle": f"${total:,.0f} · {b.get('status')}",
                "status": b.get("status") or "",
                "created_at": b.get("created_at"),
                "meta": {
                    "amount_total": total,
                    "developer_count": dev_count,
                    "currency": b.get("currency") or "USD",
                },
                "primary_action": "approve_batch",
                "actions": ["approve_batch"],
                "web_url": _web_url(f"/admin/withdrawals?batch_id={bid}"),
            })

        return {
            "withdrawals": withdrawal_items,
            "payout_batches": batch_items,
            "summary": {
                "withdrawals_pending": len(withdrawal_items),
                "batches_pending": len(batch_items),
                "total_pending_amount": round(
                    sum(w["meta"]["amount"] for w in withdrawal_items)
                    + sum(b["meta"]["amount_total"] for b in batch_items),
                    2,
                ),
            },
            "generated_at": _iso_now(),
        }

    @router.post("/admin/mobile/withdrawals/{withdrawal_id}/approve")
    async def withdrawal_approve(withdrawal_id: str, user=Depends(require_admin)):
        admin_id = _user_id_of(user)
        w = await db.withdrawals.find_one(
            {"$or": [{"withdrawal_id": withdrawal_id}, {"id": withdrawal_id}]},
            {"_id": 0},
        )
        if not w:
            raise HTTPException(404, detail="Withdrawal not found")
        if w.get("status") not in WITHDRAWAL_AWAITING:
            raise HTTPException(409, detail={
                "message": "Withdrawal already processed",
                "current_status": w.get("status"),
            })

        await db.withdrawals.update_one(
            {"$or": [{"withdrawal_id": withdrawal_id}, {"id": withdrawal_id}]},
            {"$set": {
                "status": "approved",
                "approved_at": _iso_now(),
                "approved_by": admin_id,
            }},
        )
        await _write_audit(
            admin_id=admin_id,
            action="withdrawal_approve",
            entity_type="withdrawal",
            entity_id=withdrawal_id,
            payload={"amount": float(w.get("amount") or 0),
                     "developer_id": w.get("user_id")},
        )
        await _emit("admin.withdrawal_decided", {
            "withdrawal_id": withdrawal_id,
            "action": "approve",
            "new_status": "approved",
            "by": admin_id,
            "at": _iso_now(),
        })
        return {
            "id": withdrawal_id,
            "status": "approved",
            "action": "approve",
            "decided_at": _iso_now(),
        }

    @router.post("/admin/mobile/withdrawals/{withdrawal_id}/reject")
    async def withdrawal_reject(
        withdrawal_id: str,
        body: Optional[Dict[str, Any]] = Body(None),
        user=Depends(require_admin),
    ):
        reason = (body or {}).get("reason") or "Rejected by admin"
        admin_id = _user_id_of(user)
        w = await db.withdrawals.find_one(
            {"$or": [{"withdrawal_id": withdrawal_id}, {"id": withdrawal_id}]},
            {"_id": 0},
        )
        if not w:
            raise HTTPException(404, detail="Withdrawal not found")
        if w.get("status") not in WITHDRAWAL_AWAITING:
            raise HTTPException(409, detail={
                "message": "Withdrawal already processed",
                "current_status": w.get("status"),
            })

        await db.withdrawals.update_one(
            {"$or": [{"withdrawal_id": withdrawal_id}, {"id": withdrawal_id}]},
            {"$set": {
                "status": "rejected",
                "rejected_at": _iso_now(),
                "rejected_by": admin_id,
                "rejection_reason": reason,
            }},
        )
        await _write_audit(
            admin_id=admin_id,
            action="withdrawal_reject",
            entity_type="withdrawal",
            entity_id=withdrawal_id,
            payload={"reason": reason, "amount": float(w.get("amount") or 0)},
        )
        await _emit("admin.withdrawal_decided", {
            "withdrawal_id": withdrawal_id,
            "action": "reject",
            "new_status": "rejected",
            "reason": reason,
            "by": admin_id,
            "at": _iso_now(),
        })
        return {
            "id": withdrawal_id,
            "status": "rejected",
            "action": "reject",
            "decided_at": _iso_now(),
        }

    @router.post("/admin/mobile/payout-batches/{batch_id}/approve")
    async def batch_approve(batch_id: str, user=Depends(require_admin)):
        """REAL money-move action. Marks batch as approved_for_payout."""
        admin_id = _user_id_of(user)
        b = await db.payout_batches.find_one(
            {"$or": [{"batch_id": batch_id}, {"id": batch_id}]},
            {"_id": 0},
        )
        if not b:
            raise HTTPException(404, detail="Batch not found")
        if b.get("status") not in BATCH_AWAITING:
            raise HTTPException(409, detail={
                "message": "Batch already processed",
                "current_status": b.get("status"),
            })

        await db.payout_batches.update_one(
            {"$or": [{"batch_id": batch_id}, {"id": batch_id}]},
            {"$set": {
                "status": "approved_for_payout",
                "approved_at": _iso_now(),
                "approved_by": admin_id,
            }},
        )
        await _write_audit(
            admin_id=admin_id,
            action="payout_batch_approve",
            entity_type="payout_batch",
            entity_id=batch_id,
            payload={"amount_total": float(b.get("amount_total") or b.get("total") or 0),
                     "developer_count": int(b.get("developer_count") or 0)},
        )
        await _emit("admin.payout_batch_decided", {
            "batch_id": batch_id,
            "action": "approve",
            "new_status": "approved_for_payout",
            "by": admin_id,
            "at": _iso_now(),
        })
        return {
            "id": batch_id,
            "status": "approved_for_payout",
            "action": "approve_batch",
            "decided_at": _iso_now(),
        }

    # ============================================================
    # PROFILE — admin info + lightweight snapshot
    # ============================================================
    @router.get("/admin/mobile/profile")
    async def profile(user=Depends(require_admin)) -> Dict[str, Any]:
        admin_id = _user_id_of(user) or ""
        admin_email = _user_field(user, "email", "")
        admin_name = _user_field(user, "name", "Admin")

        active_devs = await db.users.count_documents({
            "$or": [{"role": "developer"}, {"roles": "developer"}]
        })
        active_modules = await db.modules.count_documents({
            "status": {"$in": ["in_progress", "pending"]}
        })
        qa_pending = await db.modules.count_documents({
            "status": {"$in": list(QA_AWAITING_DECISION)}
        })

        return {
            "admin": {
                "id": admin_id,
                "name": admin_name,
                "email": admin_email,
                "role": "admin",
            },
            "snapshot": {
                "active_devs": active_devs,
                "active_modules": active_modules,
                "qa_pending": qa_pending,
            },
            "links": [
                {"label": "Open web admin", "web_url": _web_url("/admin/dashboard")},
                {"label": "Audit log", "web_url": _web_url("/admin/system")},
            ],
            "generated_at": _iso_now(),
        }

    # ============================================================
    # WORKFLOW — single aggregate for web AdminV2Workflow (no N+1)
    # ============================================================
    # Groups used to keep filter semantics aligned with mobile contract.
    WF_QA       = ["review", "qa_pending", "submitted"]
    WF_ACTIVE   = ["in_progress", "pending"]
    WF_DONE     = ["completed", "rejected"]
    WF_ALL      = WF_QA + WF_ACTIVE + WF_DONE + ["blocked"]

    @router.get("/admin/mobile/workflow")
    async def workflow(
        filter: str = "all",
        q: str = "",
        limit: int = 50,
        user=Depends(require_admin),
    ) -> Dict[str, Any]:
        """Aggregate modules feed for web Workflow zone.
        Returns item-contract v1 list + per-group summary.
        """
        # 1) Build mongo filter by group
        mongo_filter: Dict[str, Any] = {}
        if filter == "qa":
            mongo_filter = {"status": {"$in": WF_QA}}
        elif filter == "active":
            mongo_filter = {"status": {"$in": WF_ACTIVE}}
        elif filter == "blocked":
            mongo_filter = {"$or": [
                {"status": "blocked"},
                {"flags.blocked": True},
            ]}
        elif filter == "done":
            mongo_filter = {"status": {"$in": WF_DONE}}
        else:
            # "all" — keep broad but still bounded to known buckets
            mongo_filter = {"$or": [
                {"status": {"$in": WF_ALL}},
                {"flags.blocked": True},
            ]}

        # Clamp limit
        try:
            limit = max(1, min(200, int(limit)))
        except Exception:
            limit = 50

        mods = await db.modules.find(
            mongo_filter,
            {"_id": 0, "module_id": 1, "title": 1, "project_id": 1,
             "assigned_to": 1, "submitted_at": 1, "created_at": 1,
             "client_price": 1, "status": 1, "revision_count": 1,
             "flags": 1},
        ).sort("submitted_at", -1).limit(limit + 1).to_list(limit + 1)
        has_more = len(mods) > limit
        mods = mods[:limit]

        # 2) Batch-enrich project + developer names
        pids = list({m.get("project_id") for m in mods if m.get("project_id")})
        dids = list({m.get("assigned_to") for m in mods if m.get("assigned_to")})
        proj_map: Dict[str, str] = {}
        dev_map: Dict[str, str] = {}
        if pids:
            for p in await db.projects.find(
                {"project_id": {"$in": pids}},
                {"_id": 0, "project_id": 1, "name": 1, "title": 1},
            ).to_list(500):
                proj_map[p["project_id"]] = p.get("name") or p.get("title") or ""
        if dids:
            for d in await db.users.find(
                {"user_id": {"$in": dids}},
                {"_id": 0, "user_id": 1, "name": 1, "email": 1},
            ).to_list(500):
                dev_map[d["user_id"]] = d.get("name") or d.get("email") or "Developer"

        # 3) Optional free-text search (client-side over enriched data)
        needle = (q or "").strip().lower()

        def _matches(m: Dict[str, Any]) -> bool:
            if not needle:
                return True
            mid = (m.get("module_id") or "").lower()
            title = (m.get("title") or "").lower()
            dev = (dev_map.get(m.get("assigned_to") or "", "") or "").lower()
            proj = (proj_map.get(m.get("project_id") or "", "") or "").lower()
            return any(needle in s for s in (mid, title, dev, proj))

        # 4) Project items to v1 contract
        items: List[Dict[str, Any]] = []
        for m in mods:
            if not _matches(m):
                continue
            mid = m["module_id"]
            st = m.get("status") or ""
            is_blocked = st == "blocked" or bool((m.get("flags") or {}).get("blocked"))
            is_qa = st in WF_QA
            project_title = proj_map.get(m.get("project_id") or "", "")
            developer_name = dev_map.get(m.get("assigned_to") or "", "")
            subtitle_parts = [s for s in [project_title, developer_name] if s]
            actions: List[str] = []
            primary = "open"
            if is_qa:
                actions = ["approve", "revision", "reject", "open"]
                primary = "approve"
            else:
                actions = ["open"]
            items.append({
                "id": mid,
                "title": m.get("title") or "Module",
                "subtitle": " · ".join(subtitle_parts) or "—",
                "status": "blocked" if is_blocked else st,
                "created_at": m.get("submitted_at") or m.get("created_at"),
                "meta": {
                    "project_id": m.get("project_id"),
                    "project_title": project_title,
                    "developer_id": m.get("assigned_to"),
                    "developer_name": developer_name,
                    "client_price": float(m.get("client_price") or 0),
                    "revision_count": int(m.get("revision_count") or 0),
                },
                "primary_action": primary,
                "actions": actions,
                "web_url": _web_url(f"/admin/workflow?module_id={mid}"),
            })

        # 5) Per-group summary — always counted over FULL buckets (no filter/q)
        qa_n       = await db.modules.count_documents({"status": {"$in": WF_QA}})
        active_n   = await db.modules.count_documents({"status": {"$in": WF_ACTIVE}})
        blocked_n  = await db.modules.count_documents({"$or": [
            {"status": "blocked"}, {"flags.blocked": True},
        ]})
        done_n     = await db.modules.count_documents({"status": {"$in": WF_DONE}})
        total_n    = qa_n + active_n + blocked_n + done_n

        return {
            "items": items,
            "summary": {
                "total": total_n,
                "qa": qa_n,
                "active": active_n,
                "blocked": blocked_n,
                "done": done_n,
                "has_more": has_more,
            },
            "generated_at": _iso_now(),
        }

    # ============================================================
    # VISIBILITY — pressure / risks / recent system actions
    # ============================================================
    # Lazy import inside handler so admin_mobile stays importable
    # in environments where reputation_decay/team_balancer are absent.
    @router.get("/admin/mobile/visibility")
    async def visibility(user=Depends(require_admin)) -> Dict[str, Any]:
        """Signal-only feed for /admin/dashboard.
        NO charts, NO analytics — only items the admin can act on.
        """
        try:
            from reputation_decay import apply_decay  # type: ignore
        except Exception:
            def apply_decay(_last_active, now=None):  # noqa
                return 0

        try:
            from team_balancer import calculate_dev_pressure  # type: ignore
        except Exception:
            def calculate_dev_pressure(active, avg, decay):  # noqa
                base = max(avg, 1.0)
                return round((active / base) * 0.6 + (min(decay, 15) / 15) * 0.4, 3)

        now = datetime.now(timezone.utc)

        # ----------------------------------------------------------
        # 1) PRESSURE — top developers with active_modules vs decay
        # ----------------------------------------------------------
        # Aggregate active modules per developer
        agg = await db.modules.aggregate([
            {"$match": {"status": {"$in": list(WF_ACTIVE)},
                        "assigned_to": {"$ne": None}}},
            {"$group": {"_id": "$assigned_to", "active": {"$sum": 1}}},
        ]).to_list(500)

        active_map = {a["_id"]: a["active"] for a in agg if a.get("_id")}
        if active_map:
            avg_active = sum(active_map.values()) / max(len(active_map), 1)
        else:
            avg_active = 0.0

        dev_ids = list(active_map.keys())
        devs: List[Dict[str, Any]] = []
        if dev_ids:
            devs = await db.users.find(
                {"user_id": {"$in": dev_ids}},
                {"_id": 0, "user_id": 1, "name": 1, "last_active_at": 1, "capacity": 1},
            ).to_list(500)

        pressure_rows: List[Dict[str, Any]] = []
        overloaded_decaying: List[Dict[str, Any]] = []
        for d in devs:
            uid = d["user_id"]
            active = active_map.get(uid, 0)
            decay = int(apply_decay(d.get("last_active_at"), now=now) or 0)
            pscore = float(calculate_dev_pressure(active, avg_active, decay) or 0.0)
            if pscore >= 0.8:
                risk = "high"
            elif pscore >= 0.6:
                risk = "medium"
            else:
                risk = "low"
            row = {
                "developer_id": uid,
                "name": d.get("name") or "Developer",
                "active_modules": active,
                "decay_penalty": decay,
                "pressure_score": round(pscore, 2),
                "risk": risk,
            }
            pressure_rows.append(row)
            if risk in ("high", "medium") and decay >= 5:
                overloaded_decaying.append(row)

        pressure_rows.sort(key=lambda r: r["pressure_score"], reverse=True)
        pressure_top = pressure_rows[:3]

        # ----------------------------------------------------------
        # 2) RISKS — 3 buckets: overload+decay, stuck modules, qa stagnation
        # ----------------------------------------------------------
        risks: List[Dict[str, Any]] = []

        # 2a) overloaded + decaying devs (already computed)
        for r in overloaded_decaying[:3]:
            risks.append({
                "id": f"risk_overload_{r['developer_id']}",
                "type": "overloaded_dev",
                "title": f"{r['name']} is overloaded & inactive",
                "subtitle": f"{r['active_modules']} modules · decay {r['decay_penalty']} · pressure {r['pressure_score']}",
                "severity": r["risk"],
                "web_url": _web_url(f"/admin/team?dev={r['developer_id']}"),
            })

        # 2b) stuck modules (in_progress with old created_at and no submission)
        # Use ISO string compare since created_at is stored as string
        threshold_5d = (now - timedelta(days=5)).isoformat()
        threshold_7d = (now - timedelta(days=7)).isoformat()
        stuck = await db.modules.find(
            {
                "status": "in_progress",
                "created_at": {"$lt": threshold_5d},
                "qa_decided_at": {"$in": [None, ""]},
            },
            {"_id": 0, "module_id": 1, "title": 1, "assigned_to": 1, "created_at": 1},
        ).limit(5).to_list(5)
        for m in stuck:
            sev = "high" if (m.get("created_at") or "") < threshold_7d else "medium"
            dev_name = ""
            if m.get("assigned_to"):
                u = next((x for x in devs if x.get("user_id") == m["assigned_to"]), None)
                dev_name = (u or {}).get("name", "")
            risks.append({
                "id": f"risk_stuck_{m['module_id']}",
                "type": "stuck_module",
                "title": f"Module stuck: {m.get('title') or 'Untitled'}",
                "subtitle": f"in_progress · {dev_name or 'unassigned'}",
                "severity": sev,
                "web_url": _web_url(f"/admin/workflow?module_id={m['module_id']}"),
            })

        # 2c) qa stagnation (review status with old submitted_at)
        threshold_2d = (now - timedelta(days=2)).isoformat()
        threshold_5d_qa = (now - timedelta(days=5)).isoformat()
        stagnant = await db.modules.find(
            {
                "status": {"$in": list(QA_AWAITING_DECISION)},
                "submitted_at": {"$lt": threshold_2d},
            },
            {"_id": 0, "module_id": 1, "title": 1, "submitted_at": 1},
        ).limit(5).to_list(5)
        for m in stagnant:
            sev = "high" if (m.get("submitted_at") or "") < threshold_5d_qa else "medium"
            risks.append({
                "id": f"risk_qa_{m['module_id']}",
                "type": "qa_stagnation",
                "title": f"QA stagnant: {m.get('title') or 'Untitled'}",
                "subtitle": "Awaiting admin decision >2d",
                "severity": sev,
                "web_url": _web_url(f"/admin/qa?module_id={m['module_id']}"),
            })

        # Sort risks: high severity first
        sev_order = {"high": 0, "medium": 1, "low": 2}
        risks.sort(key=lambda r: sev_order.get(r.get("severity", "low"), 3))
        risks_top = risks[:5]

        # ----------------------------------------------------------
        # 3) SYSTEM ACTIONS — what the system did automatically
        # ----------------------------------------------------------
        # Show last 5 actions from non-admin sources (system_decisions).
        sys_rows = await db.system_actions_log.find(
            {"source": {"$ne": "admin_mobile"}},
            {"_id": 0},
        ).sort("created_at", -1).limit(5).to_list(5)

        system_actions: List[Dict[str, Any]] = []
        for r in sys_rows:
            payload = r.get("payload") or {}
            action = r.get("action") or ""
            if action == "auto_reassign":
                title = f'Auto-rebalanced "{payload.get("module_title") or "module"}"'
                subtitle = f'from {payload.get("from_dev_name") or "—"} → {payload.get("to_dev_name") or "—"} · {payload.get("reason") or ""}'
            else:
                title = f'{action}: {r.get("entity_type") or ""} {r.get("entity_id") or ""}'
                subtitle = r.get("source") or ""
            system_actions.append({
                "id": r.get("log_id") or "",
                "action": action,
                "title": title,
                "subtitle": subtitle,
                "source": r.get("source") or "",
                "created_at": r.get("created_at"),
            })

        return {
            "pressure": pressure_top,
            "risks": risks_top,
            "system_actions": system_actions,
            "summary": {
                "tracked_devs": len(pressure_rows),
                "overloaded_decaying": len(overloaded_decaying),
                "risks_total": len(risks),
                "avg_active_modules": round(avg_active, 2),
            },
            "generated_at": _iso_now(),
        }

    # ============================================================
    # AUDIT LOG — read from system_actions_log
    # ============================================================
    @router.get("/admin/audit-log")
    async def audit_log(
        limit: int = 50,
        offset: int = 0,
        action: Optional[str] = None,
        source: Optional[str] = None,
        entity_type: Optional[str] = None,
        user=Depends(require_admin),
    ) -> Dict[str, Any]:
        """Paginated audit log feed for web AdminV2System → Audit tab.
        Reads system_actions_log (written by admin_mobile + legacy writers).
        """
        try:
            limit = max(1, min(200, int(limit)))
        except Exception:
            limit = 50
        try:
            offset = max(0, int(offset))
        except Exception:
            offset = 0

        q: Dict[str, Any] = {}
        if action:
            q["action"] = action
        if source:
            q["source"] = source
        if entity_type:
            q["entity_type"] = entity_type

        total = await db.system_actions_log.count_documents(q)
        rows = await db.system_actions_log.find(
            q, {"_id": 0}
        ).sort("created_at", -1).skip(offset).limit(limit + 1).to_list(limit + 1)
        has_more = len(rows) > limit
        rows = rows[:limit]

        # Enrich actor email in one round-trip
        actor_ids = list({r.get("admin_id") for r in rows if r.get("admin_id")})
        actor_map: Dict[str, Dict[str, Any]] = {}
        if actor_ids:
            for u in await db.users.find(
                {"user_id": {"$in": actor_ids}},
                {"_id": 0, "user_id": 1, "email": 1, "name": 1},
            ).to_list(500):
                actor_map[u["user_id"]] = {
                    "id": u["user_id"],
                    "email": u.get("email") or "",
                    "name": u.get("name") or "",
                }

        items: List[Dict[str, Any]] = []
        for r in rows:
            aid = r.get("admin_id")
            actor = actor_map.get(aid) if aid else None
            if not actor:
                actor = {"id": aid or "", "email": "", "name": ""}
            items.append({
                "id": r.get("log_id") or "",
                "action": r.get("action") or "",
                "source": r.get("source") or "",
                "status": r.get("status") or "",
                "actor": actor,
                "entity": {
                    "type": r.get("entity_type") or "",
                    "id": r.get("entity_id") or "",
                },
                "payload": r.get("payload") or {},
                "created_at": r.get("created_at"),
            })

        return {
            "items": items,
            "summary": {"total": total, "has_more": has_more},
            "generated_at": _iso_now(),
        }

    return router
