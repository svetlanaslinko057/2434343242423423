"""
Этап 6.1 — Money Runtime / Ledger Continuity.

Append-only ledger of every money-state-changing event in the system.
Single source of truth for the money flow. Idempotent by
(event_type, idempotency_key) — repeat writes are detected, not duplicated.

Event types (canonical chain, in order):
    invoice_paid        — client invoice marked paid
    escrow_funded       — escrow funded after invoice paid
    earning_reserved    — earning reserved (pre-QA)  [optional]
    qa_approved         — QA approved a module
    earning_approved    — developer earning credited (idempotent per module)
    escrow_released     — escrow released to team
    payout_batched      — earning included in a payout batch
    payout_approved     — admin approved a payout batch
    payout_paid         — admin marked a payout batch as paid

The ledger is intentionally vendor-neutral. It does NOT replace the
invoice / escrow / earning / payout collections — it sits ABOVE them so
admins can audit "where did this dollar go" in one query.

Contract:
    record_event(db, event_type, entity_id, payload, idempotency_key=None)
        -> {"recorded": bool, "event_id": str, "duplicate": bool}

    list_events(db, filters, limit=100, skip=0)
        -> {"events": [...], "count": int}
"""
from __future__ import annotations
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger("money_ledger")

# Canonical event types — UI may filter by these.
EVENT_INVOICE_PAID = "invoice_paid"
EVENT_ESCROW_FUNDED = "escrow_funded"
EVENT_EARNING_RESERVED = "earning_reserved"
EVENT_QA_APPROVED = "qa_approved"
EVENT_EARNING_APPROVED = "earning_approved"
EVENT_ESCROW_RELEASED = "escrow_released"
EVENT_PAYOUT_BATCHED = "payout_batched"
EVENT_PAYOUT_APPROVED = "payout_approved"
EVENT_PAYOUT_PAID = "payout_paid"

ALL_EVENTS = [
    EVENT_INVOICE_PAID,
    EVENT_ESCROW_FUNDED,
    EVENT_EARNING_RESERVED,
    EVENT_QA_APPROVED,
    EVENT_EARNING_APPROVED,
    EVENT_ESCROW_RELEASED,
    EVENT_PAYOUT_BATCHED,
    EVENT_PAYOUT_APPROVED,
    EVENT_PAYOUT_PAID,
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ensure_indexes(db) -> None:
    """Idempotent unique index on (event_type, idempotency_key) is the
    safety net against double-write. event_id is also unique.

    Phase 2B PR-1 note: the new `MoneyRepository` (domains/money) shares the
    same `money_ledger_events` collection with this legacy writer, but its
    documents carry `entry_id` instead of `event_id`. Making both unique
    indexes `sparse=True` lets the two schemas coexist without a Mongo
    `E11000 duplicate key error` on `{event_id: null}` collisions.
    """
    await db.money_ledger_events.create_index("event_id", unique=True, sparse=True)
    # idempotency: same (event_type, idempotency_key) cannot be inserted twice
    # sparse=True allows multiple events without idempotency_key (rare)
    await db.money_ledger_events.create_index(
        [("event_type", 1), ("idempotency_key", 1)],
        unique=True,
        sparse=True,
        name="ledger_idempotency_unique",
    )
    await db.money_ledger_events.create_index([("created_at", -1)])
    await db.money_ledger_events.create_index("entity_id")
    await db.money_ledger_events.create_index("project_id")


async def record_event(
    db,
    *,
    event_type: str,
    entity_id: str,
    payload: Optional[dict[str, Any]] = None,
    idempotency_key: Optional[str] = None,
    project_id: Optional[str] = None,
    actor_id: Optional[str] = None,
    amount: Optional[float] = None,
    currency: str = "USD",
    mode: str = "mock",  # live | mock | degraded | unavailable
) -> dict:
    """Append a single money event. Idempotent by (event_type, idempotency_key).

    If `idempotency_key` is provided and a record with the same
    (event_type, idempotency_key) already exists, this is a no-op and
    returns `{"duplicate": True}`. Callers must NOT treat duplicates as
    errors — the canonical chain is allowed to retry safely.
    """
    if event_type not in ALL_EVENTS:
        # Don't reject unknown types — log + record. Lets us add new events
        # without simultaneous deploy of ledger module.
        logger.warning(f"money_ledger: unknown event_type={event_type}")

    if idempotency_key:
        existing = await db.money_ledger_events.find_one(
            {"event_type": event_type, "idempotency_key": idempotency_key},
            {"_id": 0, "event_id": 1},
        )
        if existing:
            return {
                "recorded": False,
                "duplicate": True,
                "event_id": existing["event_id"],
            }

    event_id = f"evt_{uuid.uuid4().hex[:14]}"
    doc = {
        "event_id": event_id,
        "event_type": event_type,
        "entity_id": entity_id,
        "project_id": project_id,
        "actor_id": actor_id,
        "amount": float(amount) if amount is not None else None,
        "currency": currency,
        "mode": mode,
        "payload": payload or {},
        "idempotency_key": idempotency_key,
        "created_at": _now(),
    }
    try:
        await db.money_ledger_events.insert_one({**doc})
    except Exception as e:
        # Race: another writer inserted same (event_type, idempotency_key)
        # between our check and our insert. Re-read and return duplicate.
        if idempotency_key:
            existing = await db.money_ledger_events.find_one(
                {"event_type": event_type, "idempotency_key": idempotency_key},
                {"_id": 0, "event_id": 1},
            )
            if existing:
                return {
                    "recorded": False,
                    "duplicate": True,
                    "event_id": existing["event_id"],
                }
        logger.error(f"money_ledger.record_event failed: {e}")
        raise
    return {"recorded": True, "duplicate": False, "event_id": event_id}


async def list_events(
    db,
    *,
    event_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    project_id: Optional[str] = None,
    actor_id: Optional[str] = None,
    limit: int = 100,
    skip: int = 0,
) -> dict:
    q: dict = {}
    if event_type:
        q["event_type"] = event_type
    if entity_id:
        q["entity_id"] = entity_id
    if project_id:
        q["project_id"] = project_id
    if actor_id:
        q["actor_id"] = actor_id

    total = await db.money_ledger_events.count_documents(q)
    cursor = (
        db.money_ledger_events.find(q, {"_id": 0})
        .sort("created_at", -1)
        .skip(max(0, int(skip)))
        .limit(min(500, max(1, int(limit))))
    )
    items = await cursor.to_list(length=limit)
    return {"events": items, "count": total, "limit": limit, "skip": skip}


async def overview(db) -> dict:
    """Aggregate the ledger for an admin dashboard. Returns counts and
    sums per event_type.

    Phase 2C-B4.2.0a: filter to documents with `event_type` set. The
    `money_ledger_events` collection is shared with the `MoneyRepository`
    schema (which uses `kind` instead of `event_type`); without this
    filter the aggregation returns a synthetic row keyed by `_id=null`
    that breaks downstream string formatting in seed/admin printouts.
    """
    pipeline = [
        {"$match": {"event_type": {"$exists": True, "$ne": None}}},
        {
            "$group": {
                "_id": "$event_type",
                "count": {"$sum": 1},
                "total_amount": {
                    "$sum": {"$ifNull": ["$amount", 0]}
                },
                "last_at": {"$max": "$created_at"},
            }
        }
    ]
    rows = await db.money_ledger_events.aggregate(pipeline).to_list(50)
    by_event: dict[str, dict] = {}
    for r in rows:
        by_event[r["_id"]] = {
            "count": int(r["count"]),
            "total_amount": round(float(r.get("total_amount") or 0), 2),
            "last_at": r.get("last_at"),
        }

    # Make sure every canonical event is present (UI gets a stable shape).
    for k in ALL_EVENTS:
        by_event.setdefault(k, {"count": 0, "total_amount": 0.0, "last_at": None})

    total_events = await db.money_ledger_events.count_documents({})
    return {
        "total_events": total_events,
        "by_event_type": by_event,
        "checked_at": _now(),
    }
