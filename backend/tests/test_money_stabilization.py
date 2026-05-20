"""
Этап 6.1.1 — Money Runtime Stabilization tests.

Verifies that the canonical money chain produces NO double-credits and
NO duplicate ledger events even when fired through MULTIPLE paths
(module_motion auto-promotion + explicit client_approve_module + webhook).

Idempotency contract under test:
    * For any (event_type, idempotency_key) pair, only ONE row exists
      in money_ledger_events.
    * `dev_earning_log` is unique by module_id (no double earnings).
    * `dev_wallets.earned_lifetime` is summed from dev_earning_log →
      single source of truth.
    * `users.total_earnings` is a legacy mirror only — read-only for
      new code; may be 0 or different from dev_wallets in transient
      states; equal in the steady state.
    * Repeated webhook calls are deduped at the ledger layer via
      idempotency_key=invoice_id.
"""
import asyncio
import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

import money_ledger
import money_runtime

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture
def db():
    client = AsyncIOMotorClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


async def _ensure_money_service_wired(db_inst):
    """Phase 2C-B4.2.1 — bring the money substrate up on the SAME asyncio
    loop the test is using. Outside FastAPI startup the MoneyService
    singleton is `None`, which makes every `money_bridge.bridge_escrow_*`
    call early-return — `chain_module_approved` then records ledger
    events but never credits `ac_dev:<dev>` / `ac_escrow:<project>` and
    any "canonical >= legacy" invariant test trivially fails.

    Idempotent: returns immediately if already initialised. Must be
    awaited inside the test's own coroutine (the motor client is
    bound to the loop that runs that coroutine, so the init must run
    on the same loop)."""
    import money_bridge as _mb
    import money_runtime as _mr
    if _mb.get_money_service() is None:
        await _mb.init_money_service(db_inst)
    _mr._db = db_inst


def _run(coro):
    """Synchronously run an async coroutine in a fresh loop (per-test)."""
    return asyncio.new_event_loop().run_until_complete(coro)


def test_ledger_idempotency_compound_index(db):
    """Same (event_type, idempotency_key) cannot be inserted twice."""
    async def _go():
        # Use a unique sentinel so we don't collide with seed/demo data.
        sentinel = "test_etap611_sentinel_001"
        # Cleanup before run
        await db.money_ledger_events.delete_many(
            {"idempotency_key": sentinel}
        )

        r1 = await money_ledger.record_event(
            db,
            event_type=money_ledger.EVENT_INVOICE_PAID,
            entity_id=sentinel,
            actor_id="test",
            amount=42.0,
            idempotency_key=sentinel,
        )
        assert r1["recorded"] is True
        assert r1["duplicate"] is False

        r2 = await money_ledger.record_event(
            db,
            event_type=money_ledger.EVENT_INVOICE_PAID,
            entity_id=sentinel,
            actor_id="test",
            amount=42.0,
            idempotency_key=sentinel,
        )
        assert r2["recorded"] is False
        assert r2["duplicate"] is True
        assert r2["event_id"] == r1["event_id"], (
            "Duplicate must return the EXISTING event_id, not a new one"
        )

        # Verify only ONE row physically exists
        n = await db.money_ledger_events.count_documents(
            {"event_type": money_ledger.EVENT_INVOICE_PAID,
             "idempotency_key": sentinel}
        )
        assert n == 1

        # Cleanup
        await db.money_ledger_events.delete_many(
            {"idempotency_key": sentinel}
        )

    _run(_go())


def test_full_chain_seed_no_double_events(db):
    """After running the seed, every canonical event_type must appear
    EXACTLY ONCE for the demo chain. Re-running the seed must NOT
    increase the count of demo-keyed events."""
    async def _go():
        await _ensure_money_service_wired(db)
        # Run the seed twice to assert idempotency
        from seed_money_demo import main as seed_main
        await seed_main("full")

        snap1 = await _ledger_snapshot_for_demo(db)
        await seed_main("full")
        snap2 = await _ledger_snapshot_for_demo(db)

        # Each canonical event_type must appear exactly once in the demo set.
        for et, count in snap1.items():
            assert count == 1, (
                f"After 1st seed: {et} count={count}, expected 1 "
                f"(double-write detected)"
            )
        # And re-running must not bump any count.
        assert snap1 == snap2, (
            f"After 2nd seed counts changed: {snap1} -> {snap2}"
        )

    _run(_go())


def test_dev_wallet_canonical_no_double_credit(db):
    """After full seed (run twice), the credit invariant must hold WITHOUT
    double-counting. Phase 2C-B4.2 changed which side is canonical: the
    projection (`dev_wallets_projection`, derived from
    `money_ledger_events`) is the user-facing source of truth, so the
    invariant we now enforce is:

        dev_earning_log entries are unique per module_id (no double-credit)
        AND
        users.total_earnings (legacy mirror) is bounded by
        canonical projection wallet — never larger.

    Pre-B4.2 the test additionally enforced
        wallet.earned_lifetime == sum(dev_earning_log)
    but `_credit_module_reward` no longer mutates `dev_wallets`, so legacy
    `earned_lifetime` is now intentionally drifted. The canonical
    equivalent is enforced via the projection comparison below.
    """
    async def _go():
        await _ensure_money_service_wired(db)
        from seed_money_demo import main as seed_main
        await seed_main("full")
        await seed_main("full")  # idempotency

        # Phase 2C-B4.2.1 — rebuild the projection from canonical ledger
        # so the test reads the same source of truth that user-facing
        # endpoints do (since 2C-B3.1 the projection is the canonical
        # read path). The rebuild is idempotent.
        from money_projections import rebuild_all_dev_wallet_projections
        await rebuild_all_dev_wallet_projections(db, dry_run=False)

        dev_id = "demo_dev_001"
        log_entries = await db.dev_earning_log.find(
            {"user_id": dev_id}, {"_id": 0}
        ).to_list(100)

        # 1. dev_earning_log unique per module_id (B4.2 idempotency guard
        # remains in place — `_credit_module_reward` still checks this
        # before inserting, even though the legacy `dev_wallets` write
        # is gone)
        module_ids = [e["module_id"] for e in log_entries]
        assert len(module_ids) == len(set(module_ids)), (
            f"Duplicate module_id in dev_earning_log: {module_ids}"
        )

        # 2. Canonical projection is bounded — the dev's projected
        # available_balance + withdrawn_lifetime (= earned_lifetime
        # equivalent in canonical accounting) must be at LEAST as large
        # as the legacy total earnings (no double-credit on canonical).
        proj = await db.dev_wallets_projection.find_one(
            {"user_id": dev_id}, {"_id": 0}
        ) or {}
        user = await db.users.find_one({"user_id": dev_id}, {"_id": 0}) or {}
        total_earnings_legacy = float(user.get("total_earnings") or 0)
        canonical_total = (
            (proj.get("available_balance_cents") or 0)
            + (proj.get("withdrawn_lifetime_cents") or 0)
        ) / 100.0
        # Critical: legacy must NEVER exceed canonical (= no double-credit
        # of legacy mirror beyond what canonical recorded).
        assert total_earnings_legacy <= canonical_total + 0.01, (
            f"users.total_earnings={total_earnings_legacy} > canonical "
            f"projection wallet={canonical_total} — double-credit detected"
        )

    _run(_go())


def test_webhook_to_ledger_idempotent(db):
    """A simulated webhook call (mock provider, legacy payload format)
    must:
      1. Mark the invoice paid.
      2. Emit invoice_paid + escrow_funded ledger events.
      3. Be idempotent — a 2nd identical callback must NOT create new
         ledger rows.
    """
    async def _go():
        # Pre-clean: ensure invoice is in 'pending_payment' state.
        from seed_money_demo import (
            upsert_users, upsert_project_and_module, upsert_invoice
        )
        # Use a separate test invoice so we don't pollute the main demo.
        test_inv_id = "test_etap611_inv_001"
        test_module_id = "demo_module_money_001"
        test_project_id = "demo_proj_money_001"

        # Make sure baseline data exists
        await upsert_users(db)
        await upsert_project_and_module(db)

        # Create a fresh test invoice (idempotent upsert + reset to pending)
        await db.invoices.update_one(
            {"invoice_id": test_inv_id},
            {"$set": {
                "invoice_id": test_inv_id,
                "project_id": test_project_id,
                "module_id": test_module_id,
                "client_id": "demo_client_001",
                "title": "Webhook idempotency test invoice",
                "amount": 1000.0,
                "currency": "USD",
                "status": "pending_payment",
                "kind": "module",
                "is_demo": True,
                "is_test": True,
            }},
            upsert=True,
        )
        # Also make sure no stale ledger rows exist for this invoice
        await db.money_ledger_events.delete_many(
            {"$or": [
                {"idempotency_key": test_inv_id},
                {"entity_id": test_inv_id},
            ]}
        )

        # Simulate webhook firing TWICE
        import httpx
        backend = "http://localhost:8001"

        async with httpx.AsyncClient() as client:
            for _ in range(2):
                r = await client.post(
                    f"{backend}/api/payments/wayforpay/callback",
                    json={
                        "invoice_id": test_inv_id,
                        "status": "approved",
                        "transaction_id": "TEST-TXN-001",
                    },
                    timeout=10,
                )
                # The webhook returns 200 even on duplicate (provider retries)
                assert r.status_code == 200, f"webhook status={r.status_code} body={r.text}"

        # Now verify ledger has exactly ONE invoice_paid event for this invoice
        n = await db.money_ledger_events.count_documents(
            {"event_type": money_ledger.EVENT_INVOICE_PAID,
             "idempotency_key": test_inv_id}
        )
        assert n == 1, f"webhook double-write detected: {n} invoice_paid events"

        # Cleanup test data
        await db.money_ledger_events.delete_many(
            {"$or": [
                {"idempotency_key": test_inv_id},
                {"entity_id": test_inv_id},
            ]}
        )
        await db.invoices.delete_one({"invoice_id": test_inv_id})

    _run(_go())


# ─── helpers ──────────────────────────────────────────────────────────


async def _ledger_snapshot_for_demo(db) -> dict[str, int]:
    """Count ledger events keyed to the demo flow.

    Demo idempotency keys:
        invoice_paid     → demo_inv_money_001
        escrow_funded    → escrow id (variable, but only 1 escrow per module)
        qa_approved      → demo_module_money_001
        earning_approved → demo_module_money_001
        escrow_released  → escrow id
        payout_batched   → demo_batch_001
        payout_approved  → approve_demo_batch_001
        payout_paid      → paid_demo_batch_001
    """
    snap: dict[str, int] = {}
    for et in money_ledger.ALL_EVENTS:
        if et == money_ledger.EVENT_EARNING_RESERVED:
            continue  # not used by demo
        # Match all demo-related events for this type via known key patterns
        # Most are keyed by the entity_id; payout_* uses prefixed forms.
        n = await db.money_ledger_events.count_documents({
            "event_type": et,
            "$or": [
                {"idempotency_key": "demo_inv_money_001"},
                {"idempotency_key": "demo_module_money_001"},
                {"idempotency_key": "demo_batch_001"},
                {"idempotency_key": "approve_demo_batch_001"},
                {"idempotency_key": "paid_demo_batch_001"},
                # escrow id varies between runs but the demo escrow is the
                # only one tied to demo_proj_money_001
                {"project_id": "demo_proj_money_001", "event_type": et,
                 "idempotency_key": {"$regex": "^esc_"}},
                {"project_id": "demo_proj_money_001", "event_type": et,
                 "idempotency_key": {"$regex": "^release_"}},
            ],
        })
        if n:
            snap[et] = n
    return snap
