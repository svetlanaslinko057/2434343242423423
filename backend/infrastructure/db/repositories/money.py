"""
MoneyRepository — append-only ledger of money movements.

This is the SINGLE-WRITER substrate for the Money pilot (Phase 0 → Phase 1).
The audit (2026-05-19 §1.5) showed money is fragmented across 10 files with
THREE parallel sources of truth (`money_ledger.py` 219 LoC,
`money_runtime.py` 365, `money_divergence.py` 1117). `money_divergence.py`
exists ONLY because there is no single writer; with a real ledger it can be
deleted.

Append-only semantics:
  • Every state-changing money event creates a new document; nothing is mutated.
  • Balances are computed as `SUM(deltas WHERE account_id = X)`.
  • Idempotency is enforced via `idempotency_key` unique index.
  • Each entry has a stable `entry_id`, the `actor`, the `kind` and the
    `delta_cents` (integer to avoid float drift).

Collection: `money_ledger_events`. Replaces ad-hoc writes to
`dev_earning_log`, `dev_wallets`, `payments`, etc. for new code paths.
Legacy collections remain readable for back-compat during migration.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from pymongo import ASCENDING
from pymongo.errors import DuplicateKeyError

from shared.errors import InvariantViolated

from .base import BaseRepository

log = logging.getLogger(__name__)

# Canonical event kinds — extend deliberately.
KINDS: tuple[str, ...] = (
    "deposit",            # client funds escrow
    "escrow_hold",        # transfer client → escrow
    "escrow_release",     # transfer escrow → developer wallet
    "escrow_refund",      # transfer escrow → client
    "payout",             # transfer developer wallet → external bank
    "fee",                # platform fee withheld
    "adjustment",         # admin manual correction (traceable)
    "refund",             # client-facing refund
    "task_earning_accrued",   # Phase 2B PR-2: QA-approved per-task earning recorded on EARNINGS_ACCRUAL axis
    "task_earning_reversed",  # Phase 2B PR-2: compensating entry for downgraded/cancelled prior accrual
)


class MoneyRepository(BaseRepository):
    collection_name = "money_ledger_events"
    id_field = "entry_id"

    async def ensure_indexes(self) -> None:
        # Drop legacy unique indexes from the pre-Phase-2 owner of this
        # collection. Old `money_ledger.py` indexed `event_id` (unique, NOT
        # sparse) — our new schema uses `entry_id`, so every new doc would
        # collide on `event_id=null`. We are the canonical owner now.
        #
        # Phase 2C-B4.2.0a (Feb 2026): also drop the simple `idempotency_key_1`
        # index. It conflicted with `money_ledger.py`'s composite
        # `(event_type, idempotency_key)` semantics — the legacy ledger
        # writer is allowed to have two events sharing the same
        # idempotency_key when their event_type differs (e.g.
        # qa_approved + earning_approved both keyed by module_id). The
        # composite `ledger_idempotency_unique` from `money_ledger.py` is
        # the canonical idempotency guard for BOTH schemas — for
        # MoneyRepository entries (no event_type) it reduces to
        # `(null, idempotency_key)` which still rejects same-key duplicates,
        # and for ledger events it correctly distinguishes by event_type.
        legacy_indexes = {
            "event_id_1",
            "event_type_1_idempotency_key_1",
            "idempotency_key_1",
        }
        existing = await self._coll.index_information()
        for name in legacy_indexes:
            if name in existing:
                try:
                    await self._coll.drop_index(name)
                except Exception as e:  # noqa: BLE001 — best-effort migration
                    log.debug("money_repo.legacy_index_drop_skipped",
                              extra={"index": name, "error": str(e)})

        # `sparse=True` is critical: the legacy `money_ledger.py` writer
        # populates this collection with docs that have `event_id` instead of
        # `entry_id`. A non-sparse unique index would collide on null. After
        # Phase 2B drains the legacy writer, the index can be tightened.
        await self._coll.create_index("entry_id", unique=True, sparse=True)
        # idempotency_key uniqueness is enforced by the composite
        # `ledger_idempotency_unique` (event_type, idempotency_key) created
        # in `money_ledger.ensure_indexes`. We do NOT create a simple unique
        # index here — see B4.2.0a comment above.
        await self._coll.create_index([("account_id", ASCENDING), ("occurred_at", ASCENDING)])
        await self._coll.create_index("kind")
        await self._coll.create_index("project_id")

    # ── Writes ──────────────────────────────────────────────────────────────
    async def append(
        self,
        *,
        entry_id: str,
        account_id: str,
        delta_cents: int,
        kind: str,
        actor: str,
        idempotency_key: str | None = None,
        project_id: str | None = None,
        module_id: str | None = None,
        currency: str = "USD",
        memo: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Append a single ledger event.

        Idempotent: if `idempotency_key` was already used, the existing entry
        is returned (no second insert, no exception). This is what makes
        retries safe — callers never need to handle a conflict path.

        Raises `InvariantViolated` on:
          • unknown kind
          • zero delta_cents
        """
        if kind not in KINDS:
            raise InvariantViolated(
                f"unknown money event kind '{kind}'",
                code="money_kind_invalid",
                context={"kind": kind, "allowed": list(KINDS)},
            )
        if delta_cents == 0:
            raise InvariantViolated(
                "money event delta_cents must be non-zero",
                code="money_delta_zero",
                context={"account_id": account_id, "kind": kind},
            )

        doc = {
            "entry_id": entry_id,
            "account_id": account_id,
            "delta_cents": int(delta_cents),
            "currency": currency,
            "kind": kind,
            "actor": actor,
            "project_id": project_id,
            "module_id": module_id,
            "memo": memo,
            "metadata": metadata or {},
            "occurred_at": datetime.now(timezone.utc),
        }
        if idempotency_key:
            doc["idempotency_key"] = idempotency_key

        try:
            await self._coll.insert_one(doc)
        except DuplicateKeyError:
            # Idempotent: the same idempotency_key already produced a result.
            # Return the existing entry so the caller can proceed normally.
            if idempotency_key:
                existing = await self._coll.find_one(
                    {"idempotency_key": idempotency_key}, {"_id": 0}
                )
                if existing:
                    return existing
            # Unlikely path: insert hit a different unique (entry_id collision).
            raise

        # Strip _id for return value (BaseRepository projection contract).
        doc.pop("_id", None)
        return doc

    # ── Reads ───────────────────────────────────────────────────────────────
    async def balance(self, account_id: str, *, currency: str = "USD") -> int:
        """Sum of delta_cents for an account in given currency."""
        pipeline = [
            {"$match": {"account_id": account_id, "currency": currency}},
            {"$group": {"_id": None, "total": {"$sum": "$delta_cents"}}},
        ]
        async for row in self._coll.aggregate(pipeline):
            return int(row["total"])
        return 0

    async def history(
        self,
        account_id: str,
        *,
        limit: int = 50,
        kind: str | None = None,
    ) -> list[dict[str, Any]]:
        q: dict[str, Any] = {"account_id": account_id}
        if kind:
            q["kind"] = kind
        return await self.find_many(q, sort=[("occurred_at", -1)], limit=limit)

    async def project_movement(self, project_id: str) -> dict[str, int]:
        """Total deltas grouped by kind for a project (admin diagnostics)."""
        pipeline = [
            {"$match": {"project_id": project_id}},
            {"$group": {"_id": "$kind", "total": {"$sum": "$delta_cents"}}},
        ]
        out: dict[str, int] = {}
        async for row in self._coll.aggregate(pipeline):
            out[row["_id"]] = int(row["total"])
        return out
