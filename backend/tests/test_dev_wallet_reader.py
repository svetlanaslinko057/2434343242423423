"""
Tests for Phase 2C-B3 — `dev_wallet_reader` dual-read facade.

Validates:
  • Stage A (flag off) returns LEGACY shape (float dollars)
  • Stage B (flag on)  returns PROJECTION-derived numbers in legacy shape
  • dual-read always happens regardless of flag (forensic logging)
  • Projection failure falls back to legacy (UI never breaks)
  • Mismatch is logged structured + at INFO for `mock_orphan`
  • `pending_withdrawal` always comes from legacy (projection has none)
  • No write side-effects on dev_wallets OR dev_wallets_projection

Uses the same `FakeDb` stub as `test_dev_wallet_projection.py`.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

import pytest

import dev_wallet_reader as facade
import money_projections as mp


# ── Re-use the FakeDb scaffolding pattern ──────────────────────────────────
class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, *_a, **_kw):
        return self

    def skip(self, n):
        self._docs = self._docs[n:]
        return self

    def limit(self, n):
        self._docs = self._docs[:n]
        return self

    async def to_list(self, _length=None):
        return list(self._docs)

    def __aiter__(self):
        async def gen():
            for d in self._docs:
                yield d
        return gen()


class _FakeCollection:
    def __init__(self):
        self._rows = []

    async def find_one(self, query=None, projection=None, sort=None):
        rows = self._match(query or {})
        if sort:
            rows = sorted(rows, key=lambda r: r.get(sort[0][0]) or "",
                          reverse=sort[0][1] == -1)
        if not rows:
            return None
        r = rows[0]
        return {k: v for k, v in r.items() if k != "_id"}

    def find(self, query=None, projection=None):
        return _FakeCursor(self._match(query or {}))

    async def update_one(self, *_a, **_kw):
        raise AssertionError("facade must NEVER write")

    async def insert_one(self, *_a, **_kw):
        raise AssertionError("facade must NEVER write")

    async def count_documents(self, q):
        return len(self._match(q))

    def aggregate(self, pipeline):
        match = next((s["$match"] for s in pipeline if "$match" in s), {})
        rows = self._match(match)
        group = next((s["$group"] for s in pipeline if "$group" in s), None)
        if group and "total" in group:
            total = sum(r.get("delta_cents", 0) for r in rows)
            return _FakeCursor([{"total": total}] if rows else [])
        return _FakeCursor([])

    def _match(self, q):
        out = []
        for r in self._rows:
            ok = True
            for k, v in q.items():
                actual = r.get(k)
                if isinstance(v, dict) and "$in" in v:
                    if actual not in v["$in"]:
                        ok = False
                        break
                elif isinstance(v, dict) and "$regex" in v:
                    import re
                    if not re.search(v["$regex"], str(actual or "")):
                        ok = False
                        break
                elif actual != v:
                    ok = False
                    break
            if ok:
                out.append(r)
        return out


class _FakeDb:
    def __init__(self):
        self._colls = {}

    def __getitem__(self, name):
        return self._colls.setdefault(name, _FakeCollection())

    def __getattr__(self, name):
        return self[name]


def _seed_ledger(db, account_id, delta):
    db[mp.LEDGER_COLL]._rows.append({
        "account_id": account_id,
        "delta_cents": int(delta),
        "currency": "USD",
        "occurred_at": datetime.now(timezone.utc).isoformat(),
    })


def _seed_legacy(db, **fields):
    db.dev_wallets._rows.append({k: v for k, v in fields.items()})


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(autouse=True)
def _reset_env():
    """Each test starts with the flag OFF (Stage A). Tests that need
    Stage B set the env explicitly."""
    os.environ.pop(facade.PROJECTION_FLAG_ENV, None)
    yield
    os.environ.pop(facade.PROJECTION_FLAG_ENV, None)


# ── Tests ──────────────────────────────────────────────────────────────────
def test_stage_a_returns_legacy_shape_in_float_dollars():
    db = _FakeDb()
    _seed_legacy(
        db, user_id="dev_a",
        available_balance=12.50, earned_lifetime=100.00,
        withdrawn_lifetime=87.50, pending_withdrawal=0.0,
    )
    _seed_ledger(db, "ac_dev:dev_a", 1250)   # matches legacy
    _seed_ledger(db, "ac_ext:dev_a", 8750)
    out = _run(facade.read_dev_wallet(db, "dev_a"))
    assert out["_stage"] == "legacy_primary"
    assert out["_read_source"] == "legacy"
    assert out["available_balance"] == 12.50
    assert out["earned_lifetime"] == 100.00
    assert out["withdrawn_lifetime"] == 87.50
    assert out["_classification"] == "matches"


def test_stage_b_returns_projection_in_legacy_shape():
    os.environ[facade.PROJECTION_FLAG_ENV] = "true"
    db = _FakeDb()
    _seed_legacy(
        db, user_id="dev_a",
        available_balance=12.50, earned_lifetime=100.00,
        withdrawn_lifetime=87.50, pending_withdrawal=4.20,
    )
    _seed_ledger(db, "ac_dev:dev_a", 1250)
    _seed_ledger(db, "ac_ext:dev_a", 8750)
    out = _run(facade.read_dev_wallet(db, "dev_a"))
    assert out["_stage"] == "projection_primary"
    assert out["_read_source"] == "projection"
    assert out["available_balance"] == 12.50
    assert out["earned_lifetime"] == 100.00
    assert out["withdrawn_lifetime"] == 87.50
    # `pending_withdrawal` MUST come from legacy in Stage B because the
    # projection has no source for it.
    assert out["pending_withdrawal"] == 4.20


def test_pending_withdrawal_always_from_legacy_even_in_stage_b():
    os.environ[facade.PROJECTION_FLAG_ENV] = "true"
    db = _FakeDb()
    _seed_legacy(
        db, user_id="dev_a",
        available_balance=12.50, earned_lifetime=100.00,
        withdrawn_lifetime=87.50, pending_withdrawal=999.99,
    )
    _seed_ledger(db, "ac_dev:dev_a", 1250)
    _seed_ledger(db, "ac_ext:dev_a", 8750)
    out = _run(facade.read_dev_wallet(db, "dev_a"))
    assert out["pending_withdrawal"] == 999.99


def test_stage_a_logs_warning_on_mismatch(caplog):
    db = _FakeDb()
    # Legacy says $50 available, ledger says $30 → divergence.
    _seed_legacy(
        db, user_id="dev_diverged",
        available_balance=50.0, earned_lifetime=50.0,
        withdrawn_lifetime=0.0, pending_withdrawal=0.0,
    )
    _seed_ledger(db, "ac_dev:dev_diverged", 3000)
    caplog.set_level(logging.WARNING, logger="dev_wallet_reader")
    out = _run(facade.read_dev_wallet(db, "dev_diverged"))
    # Stage A still returns legacy.
    assert out["_read_source"] == "legacy"
    assert out["available_balance"] == 50.0
    # But the mismatch was logged at WARN.
    warns = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert any("dev_wallet_read.mismatch" in r.getMessage() for r in warns)


def test_mock_orphan_mismatch_logged_at_info_not_warning(caplog):
    db = _FakeDb()
    # Mock orphan: legacy claims withdrawn $3800, ledger has nothing.
    _seed_legacy(
        db, user_id="dev_orphan",
        available_balance=0.0, earned_lifetime=3800.0,
        withdrawn_lifetime=3800.0, pending_withdrawal=0.0,
    )
    caplog.set_level(logging.INFO, logger="dev_wallet_reader")
    _run(facade.read_dev_wallet(db, "dev_orphan"))
    info_records = [r for r in caplog.records
                    if r.levelno == logging.INFO
                    and "dev_wallet_read.mismatch" in r.getMessage()
                    and "mock_orphan" in r.getMessage()]
    warn_records = [r for r in caplog.records
                    if r.levelno == logging.WARNING
                    and "dev_wallet_read.mismatch" in r.getMessage()]
    assert info_records, "orphan mismatch should log at INFO"
    assert not warn_records, "orphan must NOT log at WARN (would page ops)"


def test_facade_never_writes_to_either_collection():
    db = _FakeDb()
    _seed_legacy(db, user_id="dev_a", available_balance=10.0,
                 earned_lifetime=10.0, withdrawn_lifetime=0.0)
    _seed_ledger(db, "ac_dev:dev_a", 1000)
    # The _FakeCollection.update_one / insert_one raise AssertionError if
    # they get called, so a successful read proves no write happened.
    _run(facade.read_dev_wallet(db, "dev_a"))
    _run(facade.read_dev_wallet(db, "dev_a"))   # idempotent on reads too


def test_stage_b_falls_back_to_legacy_when_projection_explodes(monkeypatch):
    os.environ[facade.PROJECTION_FLAG_ENV] = "true"
    db = _FakeDb()
    _seed_legacy(db, user_id="dev_a", available_balance=42.0,
                 earned_lifetime=42.0, withdrawn_lifetime=0.0,
                 pending_withdrawal=0.0)

    async def _boom(*_a, **_kw):
        raise RuntimeError("simulated projection failure")
    monkeypatch.setattr(mp, "compare_dev_wallet_projection", _boom)

    out = _run(facade.read_dev_wallet(db, "dev_a"))
    # Stage tag is still projection_primary (flag was on) BUT we fell
    # back to legacy because the projection raised.
    assert out["_stage"] == "projection_primary"
    assert out["_read_source"] == "legacy"   # safety fallback
    assert out["available_balance"] == 42.0


def test_missing_legacy_returns_zeros_in_legacy_shape():
    db = _FakeDb()  # no rows
    out = _run(facade.read_dev_wallet(db, "dev_ghost"))
    assert out["_read_source"] == "legacy_missing"
    assert out["available_balance"] == 0.0
    assert out["earned_lifetime"] == 0.0
    assert out["withdrawn_lifetime"] == 0.0
    assert out["pending_withdrawal"] == 0.0


def test_flag_is_read_on_every_call_not_cached():
    db = _FakeDb()
    _seed_legacy(db, user_id="dev_a", available_balance=10.0,
                 earned_lifetime=10.0, withdrawn_lifetime=0.0,
                 pending_withdrawal=0.0)
    _seed_ledger(db, "ac_dev:dev_a", 1000)

    # Stage A
    out1 = _run(facade.read_dev_wallet(db, "dev_a"))
    assert out1["_stage"] == "legacy_primary"
    # Flip live
    os.environ[facade.PROJECTION_FLAG_ENV] = "true"
    out2 = _run(facade.read_dev_wallet(db, "dev_a"))
    assert out2["_stage"] == "projection_primary"
    # Flip back
    os.environ[facade.PROJECTION_FLAG_ENV] = "false"
    out3 = _run(facade.read_dev_wallet(db, "dev_a"))
    assert out3["_stage"] == "legacy_primary"
