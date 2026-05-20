"""
Tests for Phase 2C-B1 — dev_wallets projection shadow.

Validates the contract from `/app/backend/money_projections.py`:
  • build_dev_wallet_projection — pure read, derived from ledger
  • rebuild_all — dry_run does not write; live write is idempotent
  • compare — classifies legacy↔ledger relationship including mock_orphan

These tests use mongomock-style stubs via a thin in-memory `FakeDb`
so they run without a real Mongo instance. The projection module only
talks to `db[<coll>]` with `find`, `find_one`, `aggregate`,
`update_one`, `count_documents` — all small enough to mock.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

import pytest

import money_projections as mp


# ── Minimal async-Mongo stub ────────────────────────────────────────────────
class _FakeCursor:
    def __init__(self, docs: list[dict]):
        self._docs = docs

    def sort(self, *_a, **_kw):
        return self

    def skip(self, n: int):
        self._docs = self._docs[n:]
        return self

    def limit(self, n: int):
        self._docs = self._docs[:n]
        return self

    async def to_list(self, _length: int | None = None) -> list[dict]:
        return list(self._docs)

    def __aiter__(self):
        async def gen():
            for d in self._docs:
                yield d
        return gen()


class _FakeCollection:
    def __init__(self):
        self._rows: list[dict] = []

    async def insert_one(self, doc: dict):
        self._rows.append(dict(doc))

    def find(self, query=None, projection=None):
        rows = self._match(query or {})
        return _FakeCursor([self._project(r, projection) for r in rows])

    async def find_one(self, query=None, projection=None, sort=None):
        rows = self._match(query or {})
        if sort:
            rows = sorted(
                rows,
                key=lambda r: r.get(sort[0][0]) or "",
                reverse=sort[0][1] == -1,
            )
        return self._project(rows[0], projection) if rows else None

    async def update_one(self, query, update, upsert=False):
        rows = self._match(query)
        if rows:
            row = rows[0]
            row.update(update.get("$set", {}))
        elif upsert:
            row = {}
            row.update(query)
            row.update(update.get("$set", {}))
            self._rows.append(row)

    async def count_documents(self, query):
        return len(self._match(query))

    def aggregate(self, pipeline):
        # Only the patterns money_projections actually uses:
        #  • $match + $group sum delta_cents (per account_id)
        #  • $match regex + $group _id=account_id  (discovery)
        match = next((s["$match"] for s in pipeline if "$match" in s), {})
        rows = self._match(match)
        group = next((s["$group"] for s in pipeline if "$group" in s), None)
        if group and "total" in group:
            total = sum(r.get("delta_cents", 0) for r in rows)
            return _FakeCursor([{"total": total}] if rows else [])
        if group and group.get("_id") == "$account_id":
            uniq = sorted({r["account_id"] for r in rows if "account_id" in r})
            return _FakeCursor([{"_id": a} for a in uniq])
        return _FakeCursor([])

    def _match(self, q: dict) -> list[dict]:
        out = []
        for r in self._rows:
            if all(self._cmp(r.get(k), v) for k, v in q.items()):
                out.append(r)
        return out

    @staticmethod
    def _cmp(actual, expected):
        if isinstance(expected, dict):
            if "$in" in expected:
                return actual in expected["$in"]
            if "$regex" in expected:
                import re
                return bool(re.search(expected["$regex"], str(actual or "")))
            return False
        return actual == expected

    @staticmethod
    def _project(row, projection):
        if not projection:
            return dict(row)
        if any(v == 0 for v in projection.values()):
            return {k: v for k, v in row.items() if projection.get(k, 1) != 0}
        keep = {k for k, v in projection.items() if v == 1}
        return {k: v for k, v in row.items() if k in keep}


class _FakeDb:
    def __init__(self):
        self._colls: dict[str, _FakeCollection] = {}

    def __getitem__(self, name):
        return self._colls.setdefault(name, _FakeCollection())

    def __getattr__(self, name):
        return self[name]


def _seed_ledger(db, account_id: str, delta_cents: int,
                 occurred_at: str | None = None):
    """Synchronously plant a ledger row. `occurred_at` defaults to now."""
    db[mp.LEDGER_COLL]._rows.append({  # type: ignore[attr-defined]
        "account_id": account_id,
        "delta_cents": int(delta_cents),
        "currency": "USD",
        "occurred_at": occurred_at or datetime.now(timezone.utc).isoformat(),
    })


# ── Tests ──────────────────────────────────────────────────────────────────
def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_build_projection_for_pure_ledger_developer():
    db = _FakeDb()
    # Developer earned $42.00 (escrow_release credit), paid out $10.00,
    # plus has $5.00 accrual_pending awaiting payout.
    _seed_ledger(db, "ac_dev:dev_alpha", 4200)        # +$42
    _seed_ledger(db, "ac_dev:dev_alpha", -1000)       # -$10 payout
    _seed_ledger(db, "ac_ext:dev_alpha", 1000)        # +$10 outbound
    _seed_ledger(db, "ac_accrual:dev_alpha", 500)     # +$5

    proj = _run(mp.build_dev_wallet_projection(db, "dev_alpha"))
    assert proj["available_balance_cents"] == 3200
    assert proj["withdrawn_lifetime_cents"] == 1000
    assert proj["earned_lifetime_cents"] == 4200       # = available + withdrawn
    assert proj["accrual_pending_cents"] == 500
    assert proj["pending_withdrawal_cents"] is None   # not derivable from ledger
    assert proj["source"] == "ledger"
    assert proj["ledger_accounts"]["wallet"] == "ac_dev:dev_alpha"


def test_build_projection_empty_when_no_ledger_activity():
    db = _FakeDb()
    proj = _run(mp.build_dev_wallet_projection(db, "dev_ghost"))
    assert proj["available_balance_cents"] == 0
    assert proj["earned_lifetime_cents"] == 0
    assert proj["accrual_pending_cents"] == 0
    assert proj["last_ledger_activity_at"] is None


def test_rebuild_dry_run_does_not_write():
    db = _FakeDb()
    _seed_ledger(db, "ac_dev:dev_a", 1000)
    _seed_ledger(db, "ac_dev:dev_b", 2500)

    result = _run(mp.rebuild_all_dev_wallet_projections(db, dry_run=True))
    assert result["dry_run"] is True
    assert result["counts"]["discovered"] == 2
    assert result["counts"]["computed"] == 2
    assert result["counts"]["written"] == 0
    assert len(result["projections"]) == 2
    # Projection collection must remain empty.
    stored = _run(db[mp.PROJECTION_COLL].count_documents({}))
    assert stored == 0
    # Watermark must mark dry_run state (not "completed").
    wm = _run(db[mp.WATERMARK_COLL].find_one({"key": "rebuild_all"}))
    assert wm["state"] == "dry_run"


def test_rebuild_live_writes_then_is_idempotent():
    db = _FakeDb()
    _seed_ledger(db, "ac_dev:dev_a", 1000)
    _seed_ledger(db, "ac_dev:dev_b", 2500)

    first = _run(
        mp.rebuild_all_dev_wallet_projections(db, dry_run=False)
    )
    assert first["counts"]["written"] == 2
    assert first["counts"]["unchanged"] == 0

    second = _run(
        mp.rebuild_all_dev_wallet_projections(db, dry_run=False)
    )
    # No ledger change between runs ⇒ all rows must be skipped as unchanged.
    assert second["counts"]["written"] == 0
    assert second["counts"]["unchanged"] == 2


def test_rebuild_live_detects_new_ledger_activity():
    db = _FakeDb()
    _seed_ledger(db, "ac_dev:dev_a", 1000)
    _run(mp.rebuild_all_dev_wallet_projections(db, dry_run=False))

    # New credit lands AFTER the first rebuild.
    _seed_ledger(db, "ac_dev:dev_a", 500)
    again = _run(
        mp.rebuild_all_dev_wallet_projections(db, dry_run=False)
    )
    assert again["counts"]["written"] == 1
    assert again["counts"]["unchanged"] == 0


def test_compare_matches_when_legacy_mirrors_ledger():
    db = _FakeDb()
    _seed_ledger(db, "ac_dev:dev_match", 4200)
    # Legacy wallet says $42 available, $42 earned, $0 withdrawn.
    db.dev_wallets._rows.append({  # type: ignore[attr-defined]
        "user_id": "dev_match",
        "available_balance": 42.0,
        "earned_lifetime": 42.0,
        "withdrawn_lifetime": 0.0,
        "pending_withdrawal": 0.0,
    })
    cmp = _run(mp.compare_dev_wallet_projection(db, "dev_match"))
    assert cmp["classification"] == "matches"
    assert cmp["diff_cents"] == {
        "available_balance": 0,
        "earned_lifetime": 0,
        "withdrawn_lifetime": 0,
    }


def test_compare_classifies_mock_seed_payout_orphan():
    """The known Phase 2C-D payout_leg orphan: legacy claims a payout
    occurred but there's no source escrow_release in the ledger, so
    ac_ext is empty. Projection must flag this as `mock_orphan`."""
    db = _FakeDb()
    # Ledger: $0 balance — no escrow_release ever recorded for this dev.
    # Legacy: $50 available, $3800 withdrawn lifetime (mock-seed orphan).
    db.dev_wallets._rows.append({  # type: ignore[attr-defined]
        "user_id": "dev_orphan",
        "available_balance": 0.0,
        "earned_lifetime": 3800.0,
        "withdrawn_lifetime": 3800.0,
        "pending_withdrawal": 0.0,
    })
    cmp = _run(mp.compare_dev_wallet_projection(db, "dev_orphan"))
    assert cmp["classification"] == "mock_orphan"
    assert cmp["diff_cents"]["withdrawn_lifetime"] == 380000
    # And we do NOT mask it: projection still reports the truth from ledger.
    assert cmp["projection"]["withdrawn_lifetime_cents"] == 0


def test_compare_classifies_legacy_only():
    db = _FakeDb()
    db.dev_wallets._rows.append({  # type: ignore[attr-defined]
        "user_id": "dev_legacy",
        "available_balance": 12.0,
        "earned_lifetime": 12.0,
        "withdrawn_lifetime": 0.0,
    })
    cmp = _run(mp.compare_dev_wallet_projection(db, "dev_legacy"))
    assert cmp["classification"] == "legacy_only"


def test_compare_classifies_ledger_only():
    db = _FakeDb()
    _seed_ledger(db, "ac_dev:dev_new", 7700)
    cmp = _run(mp.compare_dev_wallet_projection(db, "dev_new"))
    assert cmp["classification"] == "ledger_only"
    assert cmp["legacy"]["present"] is False


def test_rebuild_does_not_touch_legacy_dev_wallets():
    """The most important invariant of Phase 2C-B1: shadow projection
    must never mutate the legacy collection."""
    db = _FakeDb()
    db.dev_wallets._rows.append({  # type: ignore[attr-defined]
        "user_id": "dev_a",
        "available_balance": 99.99,
        "earned_lifetime": 99.99,
        "withdrawn_lifetime": 0.0,
    })
    _seed_ledger(db, "ac_dev:dev_a", 1000)  # ledger disagrees
    _run(mp.rebuild_all_dev_wallet_projections(db, dry_run=False))
    legacy = _run(db.dev_wallets.find_one({"user_id": "dev_a"}))
    assert legacy["available_balance"] == 99.99   # unchanged
    assert legacy["earned_lifetime"] == 99.99     # unchanged
