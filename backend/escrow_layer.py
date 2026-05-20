"""
BLOCK 6 — MONEY LAYER: escrow-backed module lifecycle.

Core principle: MONEY BEFORE WORK.
  client accept → escrow.pending → client fund → escrow.funded
                → module.in_progress → module.done → escrow.released
                                                   → cancel → refund

Escrow states:
  pending             — created at module accept, waiting for funds
  funded              — client paid, full amount locked, work may start
  partially_released  — some share paid out after partial completion
  completed           — module done, 100% released to team
  refunded            — module cancelled, remaining returned to client

Flow guards:
  1. module can only transition to `in_progress` when escrow.status == funded
  2. release happens ONLY through module.done or admin-approved cancel
  3. split between team members uses Block 3 responsibility shares
  4. no manual payouts bypassing escrow
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Optional


def _now():
    return datetime.now(timezone.utc).isoformat()


STATUS_PENDING = "pending"
STATUS_FUNDED = "funded"
STATUS_PARTIAL = "partially_released"
STATUS_COMPLETED = "completed"
STATUS_REFUNDED = "refunded"

MODULE_AWAITING_FUNDING = "awaiting_funding"


class EscrowError(Exception):
    pass


# ========== CREATE ==========

async def create_escrow(
    db, module_id: str, client_id: str, amount: float,
    emit_event=None,
) -> dict:
    """Called when client accepts a module suggestion. Idempotent per module."""
    existing = await db.escrows.find_one(
        {"module_id": module_id, "status": {"$ne": STATUS_REFUNDED}},
        {"_id": 0},
    )
    if existing:
        return existing

    module = await db.modules.find_one({"module_id": module_id}, {"_id": 0})
    if not module:
        raise EscrowError(f"Module not found: {module_id}")

    doc = {
        "escrow_id": f"esc_{uuid.uuid4().hex[:12]}",
        "module_id": module_id,
        "project_id": module.get("project_id"),
        "client_id": client_id,
        "total_amount": round(float(amount), 2),
        "locked_amount": 0.0,
        "released_amount": 0.0,
        "refunded_amount": 0.0,
        "status": STATUS_PENDING,
        "created_at": _now(),
        "funded_at": None,
        "completed_at": None,
    }
    await db.escrows.insert_one({**doc})

    # Park module in awaiting_funding until client pays
    await db.modules.update_one(
        {"module_id": module_id},
        {
            "$set": {
                "status": MODULE_AWAITING_FUNDING,
                "escrow_id": doc["escrow_id"],
                "escrow_status": STATUS_PENDING,
            }
        },
    )

    if emit_event:
        await emit_event(
            "escrow:created",
            {
                "escrow_id": doc["escrow_id"],
                "module_id": module_id,
                "client_id": client_id,
                "amount": doc["total_amount"],
            },
        )
    return doc


# ========== FUND ==========

async def fund_escrow(
    db, escrow_id: str, funded_by: str, emit_event=None,
) -> dict:
    """Client pays. Simulated payment — hook real Stripe later."""
    esc = await db.escrows.find_one({"escrow_id": escrow_id}, {"_id": 0})
    if not esc:
        raise EscrowError("Escrow not found")
    if esc["status"] != STATUS_PENDING:
        raise EscrowError(f"Cannot fund escrow in status {esc['status']}")

    now = _now()
    await db.escrows.update_one(
        {"escrow_id": escrow_id},
        {
            "$set": {
                "status": STATUS_FUNDED,
                "locked_amount": esc["total_amount"],
                "funded_at": now,
                "funded_by": funded_by,
            }
        },
    )

    # Unlock module for work
    await db.modules.update_one(
        {"module_id": esc["module_id"]},
        {
            "$set": {
                "status": "in_progress",
                "escrow_status": STATUS_FUNDED,
                "work_started_at": now,
            }
        },
    )

    # Phase 2B PR-1 — canonical mirror: also record this fund event in the
    # `money_ledger_events` ledger via MoneyService. The bridge is internally
    # exception-safe (see money_bridge module docstring) — it never raises
    # back into the legacy path even when MoneyService is unavailable.
    from money_bridge import bridge_escrow_hold  # lazy: avoid circular at module import
    await bridge_escrow_hold(esc, funded_by)

    if emit_event:
        await emit_event(
            "escrow:funded",
            {
                "escrow_id": escrow_id,
                "module_id": esc["module_id"],
                "amount": esc["total_amount"],
            },
        )
    return await db.escrows.find_one({"escrow_id": escrow_id}, {"_id": 0})


# ========== RELEASE ==========

async def release_escrow(
    db, escrow_id: str, completed_share: float = 1.0,
    triggered_by: str = "module_done", emit_event=None,
) -> dict:
    """
    Split locked funds to team by `responsibility` share.
    `completed_share` 0..1 (1.0 on module.done, fractional for partial releases).
    """
    esc = await db.escrows.find_one({"escrow_id": escrow_id}, {"_id": 0})
    if not esc:
        raise EscrowError("Escrow not found")
    if esc["status"] not in (STATUS_FUNDED, STATUS_PARTIAL):
        raise EscrowError(f"Cannot release from status {esc['status']}")

    completed_share = max(0.0, min(1.0, float(completed_share)))
    release_total = round(esc["total_amount"] * completed_share
                          - esc["released_amount"], 2)
    if release_total <= 0:
        return esc

    # Find team
    assignments = await db.module_assignments.find(
        {"module_id": esc["module_id"], "status": "active"}, {"_id": 0}
    ).to_list(50)
    if not assignments:
        raise EscrowError("No active team to release funds to")

    # Split by responsibility
    total_resp = sum(float(a.get("responsibility", 0)) for a in assignments)
    if total_resp <= 0:
        raise EscrowError("Team responsibilities sum to 0")

    payout_records = []
    now = _now()
    for a in assignments:
        share = float(a.get("responsibility", 0)) / total_resp
        amount = round(release_total * share, 2)
        payout = {
            "payout_id": f"pay_{uuid.uuid4().hex[:12]}",
            "escrow_id": escrow_id,
            "module_id": esc["module_id"],
            "developer_id": a["developer_id"],
            "amount": amount,
            "status": "paid",
            "role": a.get("role"),
            "responsibility": a.get("responsibility"),
            "triggered_by": triggered_by,
            "created_at": now,
        }
        await db.escrow_payouts.insert_one({**payout})
        payout_records.append(payout)

        # Phase 2B PR-1 — canonical mirror per developer share. Bridge is
        # internally exception-safe; it logs and returns rather than raising.
        from money_bridge import bridge_escrow_release  # lazy import
        await bridge_escrow_release(esc, payout)

        # Этап 6.1.1 — canonical wallet path: `dev_wallets` is the single
        # source of truth for available_balance / earned_lifetime. We
        # mirror to `users.total_earnings` ONLY as a legacy/backward-compat
        # field (read by older UI). The escrow_payout row stays as the
        # immutable per-release record. The `_credit_module_reward` flow
        # in server.py is what writes to dev_wallets — we deliberately do
        # NOT credit dev_wallets here, because that path is fired by
        # client_approve_module / module_motion via the same chain. If
        # we credited here too, the same module would double-credit.
        await db.users.update_one(
            {"user_id": a["developer_id"]},
            {"$inc": {"total_earnings": amount, "escrow_earnings": amount}},
        )

    new_released = round(esc["released_amount"] + release_total, 2)
    new_status = (
        STATUS_COMPLETED
        if abs(new_released - esc["total_amount"]) < 0.01
        else STATUS_PARTIAL
    )
    updates = {
        "released_amount": new_released,
        "locked_amount": round(esc["total_amount"] - new_released, 2),
        "status": new_status,
    }
    if new_status == STATUS_COMPLETED:
        updates["completed_at"] = now

    await db.escrows.update_one(
        {"escrow_id": escrow_id}, {"$set": updates}
    )
    await db.modules.update_one(
        {"module_id": esc["module_id"]},
        {"$set": {"escrow_status": new_status}},
    )

    if emit_event:
        await emit_event(
            "escrow:released",
            {
                "escrow_id": escrow_id,
                "module_id": esc["module_id"],
                "amount": release_total,
                "payouts": len(payout_records),
                "final_status": new_status,
            },
        )

    return {
        "escrow": await db.escrows.find_one({"escrow_id": escrow_id}, {"_id": 0}),
        "payouts": payout_records,
        "release_total": release_total,
    }


# ========== REFUND ==========

async def refund_escrow(
    db, escrow_id: str, completed_share: float = 0.0,
    reason: str = "cancelled", emit_event=None,
) -> dict:
    """
    Partial payout for completed work, rest back to client.
    `completed_share` — how much to pay team before refund.
    """
    esc = await db.escrows.find_one({"escrow_id": escrow_id}, {"_id": 0})
    if not esc:
        raise EscrowError("Escrow not found")
    if esc["status"] not in (STATUS_FUNDED, STATUS_PARTIAL, STATUS_PENDING):
        raise EscrowError(f"Cannot refund from status {esc['status']}")

    # 1. Pending → full refund, no payout
    if esc["status"] == STATUS_PENDING:
        await db.escrows.update_one(
            {"escrow_id": escrow_id},
            {
                "$set": {
                    "status": STATUS_REFUNDED,
                    "refunded_amount": esc["total_amount"],
                    "refund_reason": reason,
                    "refunded_at": _now(),
                }
            },
        )
        await db.modules.update_one(
            {"module_id": esc["module_id"]},
            {"$set": {"status": "cancelled", "escrow_status": STATUS_REFUNDED}},
        )
        # Pending → no funds were ever held in MoneyService (hold_escrow only
        # runs on fund_escrow). Nothing to mirror.
        if emit_event:
            await emit_event(
                "escrow:refunded",
                {
                    "escrow_id": escrow_id,
                    "module_id": esc["module_id"],
                    "amount": esc["total_amount"],
                    "paid_to_team": 0,
                    "reason": reason,
                },
            )
        return await db.escrows.find_one({"escrow_id": escrow_id}, {"_id": 0})

    # 2. Funded/partial → release partial, refund rest
    completed_share = max(0.0, min(1.0, float(completed_share)))
    if completed_share > 0:
        await release_escrow(
            db, escrow_id, completed_share=completed_share,
            triggered_by="partial_cancel", emit_event=emit_event,
        )
        esc = await db.escrows.find_one({"escrow_id": escrow_id}, {"_id": 0})

    refund_amount = round(esc["locked_amount"], 2)
    now = _now()
    await db.escrows.update_one(
        {"escrow_id": escrow_id},
        {
            "$set": {
                "status": STATUS_REFUNDED,
                "refunded_amount": refund_amount,
                "locked_amount": 0.0,
                "refund_reason": reason,
                "refunded_at": now,
            }
        },
    )
    await db.modules.update_one(
        {"module_id": esc["module_id"]},
        {"$set": {"status": "cancelled", "escrow_status": STATUS_REFUNDED}},
    )

    # Phase 2B PR-1 — canonical mirror: refund event into MoneyService.
    # Bridge is internally exception-safe.
    from money_bridge import bridge_escrow_refund  # lazy import
    await bridge_escrow_refund(esc, refund_amount, reason)

    if emit_event:
        await emit_event(
            "escrow:refunded",
            {
                "escrow_id": escrow_id,
                "module_id": esc["module_id"],
                "amount": refund_amount,
                "paid_to_team": esc["released_amount"],
                "reason": reason,
            },
        )

    return await db.escrows.find_one({"escrow_id": escrow_id}, {"_id": 0})


# ========== READ / ADMIN ==========

async def get_escrow(db, escrow_id: str) -> Optional[dict]:
    esc = await db.escrows.find_one({"escrow_id": escrow_id}, {"_id": 0})
    if not esc:
        return None
    # Enrich with payouts
    payouts = await db.escrow_payouts.find(
        {"escrow_id": escrow_id}, {"_id": 0}
    ).to_list(50)
    esc["payouts"] = payouts
    return esc


async def get_escrow_for_module(db, module_id: str) -> Optional[dict]:
    esc = await db.escrows.find_one(
        {"module_id": module_id, "status": {"$ne": STATUS_REFUNDED}},
        {"_id": 0},
    )
    if not esc:
        return None
    payouts = await db.escrow_payouts.find(
        {"escrow_id": esc["escrow_id"]}, {"_id": 0}
    ).to_list(50)
    esc["payouts"] = payouts
    return esc


async def admin_dashboard(db) -> dict:
    pipeline = [
        {"$group": {
            "_id": "$status",
            "count": {"$sum": 1},
            "total": {"$sum": "$total_amount"},
            "locked": {"$sum": "$locked_amount"},
            "released": {"$sum": "$released_amount"},
            "refunded": {"$sum": "$refunded_amount"},
        }}
    ]
    by_status = await db.escrows.aggregate(pipeline).to_list(20)
    summary = {
        "total_locked": 0.0,
        "total_released": 0.0,
        "total_refunded": 0.0,
        "escrow_count": 0,
    }
    by_status_map = {}
    for s in by_status:
        by_status_map[s["_id"]] = {
            "count": s["count"],
            "total": round(s["total"], 2),
            "locked": round(s["locked"], 2),
            "released": round(s["released"], 2),
            "refunded": round(s["refunded"], 2),
        }
        summary["total_locked"] += s["locked"]
        summary["total_released"] += s["released"]
        summary["total_refunded"] += s["refunded"]
        summary["escrow_count"] += s["count"]

    summary = {k: round(v, 2) if isinstance(v, float) else v
               for k, v in summary.items()}

    # Recent escrows
    recent = await db.escrows.find({}, {"_id": 0}).sort(
        "created_at", -1
    ).limit(10).to_list(10)

    return {
        "summary": summary,
        "by_status": by_status_map,
        "recent": recent,
    }


async def list_client_escrows(db, client_id: str) -> list[dict]:
    rows = await db.escrows.find(
        {"client_id": client_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    # Enrich with module title
    mod_ids = [r["module_id"] for r in rows]
    mods = {}
    async for m in db.modules.find(
        {"module_id": {"$in": mod_ids}}, {"_id": 0, "module_id": 1, "title": 1}
    ):
        mods[m["module_id"]] = m.get("title", "")
    for r in rows:
        r["module_title"] = mods.get(r["module_id"], "")
    return rows


async def list_dev_payouts(db, developer_id: str) -> list[dict]:
    return await db.escrow_payouts.find(
        {"developer_id": developer_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)


# ========== MODULE HOOKS ==========

async def on_module_done(
    db, module_id: str, emit_event=None
) -> Optional[dict]:
    """Hook called when module transitions to `done`. Releases escrow in full."""
    esc = await db.escrows.find_one(
        {"module_id": module_id, "status": {"$in": [STATUS_FUNDED, STATUS_PARTIAL]}},
        {"_id": 0},
    )
    if not esc:
        return None
    return await release_escrow(
        db, esc["escrow_id"], completed_share=1.0,
        triggered_by="module_done", emit_event=emit_event,
    )


async def ensure_indexes(db):
    await db.escrows.create_index("escrow_id", unique=True)
    await db.escrows.create_index([("module_id", 1), ("status", 1)])
    await db.escrows.create_index("client_id")
    await db.escrow_payouts.create_index("payout_id", unique=True)
    await db.escrow_payouts.create_index("developer_id")
    await db.escrow_payouts.create_index("escrow_id")
