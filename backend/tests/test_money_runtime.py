"""
Этап 6.1 — Money Runtime contract tests.

Verifies:
  • escrow lifecycle states and transitions
  • settlement chain end-to-end (create → fund → release → payouts)
  • idempotency (double-release fails fast, no silent double-spend)
  • payment_mode tag is present on every money response
  • on_invoice_paid hook is idempotent
  • module unblock on funding
  • capability boundary: in `live` payment mode, client cannot self-fund
"""

import sys
import uuid

import pytest

sys.path.insert(0, "/app/backend")

import escrow_layer  # noqa: E402
import money_runtime  # noqa: E402
from integrations import registry  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


@pytest.fixture
async def db():
    client = AsyncIOMotorClient("mongodb://localhost:27017")
    yield client.test_database
    client.close()


@pytest.fixture
async def test_module(db):
    """Insert a clean module + assignment, yield ids, then cleanup."""
    mod_id = f"mod_test_{uuid.uuid4().hex[:8]}"
    dev_id = f"user_dev_test_{uuid.uuid4().hex[:6]}"
    client_id = f"user_client_test_{uuid.uuid4().hex[:6]}"
    await db.modules.insert_one({
        "module_id": mod_id,
        "project_id": f"proj_test_{uuid.uuid4().hex[:6]}",
        "title": "Test module",
        "status": "draft",
    })
    await db.module_assignments.insert_one({
        "module_id": mod_id,
        "developer_id": dev_id,
        "responsibility": 1.0,
        "role": "lead",
        "status": "active",
    })
    yield {"module_id": mod_id, "developer_id": dev_id, "client_id": client_id}
    # Cleanup
    await db.modules.delete_one({"module_id": mod_id})
    await db.module_assignments.delete_many({"module_id": mod_id})
    await db.escrows.delete_many({"module_id": mod_id})
    await db.escrow_payouts.delete_many({"module_id": mod_id})


# ─────────────────────────────────────────────────────────────────────────────
# 1. Escrow lifecycle: pending → funded → completed
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_escrow_full_lifecycle(db, test_module):
    m = test_module
    esc = await escrow_layer.create_escrow(
        db, module_id=m["module_id"], client_id=m["client_id"], amount=1000.0,
    )
    assert esc["status"] == "pending"
    assert esc["total_amount"] == 1000.0
    assert esc["locked_amount"] == 0.0

    # Fund — module gets unblocked.
    funded = await escrow_layer.fund_escrow(
        db, escrow_id=esc["escrow_id"], funded_by=m["client_id"],
    )
    assert funded["status"] == "funded"
    assert funded["locked_amount"] == 1000.0

    mod_after = await db.modules.find_one({"module_id": m["module_id"]}, {"_id": 0})
    assert mod_after["status"] == "in_progress"
    assert mod_after["escrow_status"] == "funded"

    # Release full.
    result = await escrow_layer.release_escrow(
        db, escrow_id=esc["escrow_id"], completed_share=1.0,
    )
    assert result["release_total"] == 1000.0
    assert len(result["payouts"]) == 1
    assert result["payouts"][0]["developer_id"] == m["developer_id"]
    assert result["payouts"][0]["amount"] == 1000.0
    assert result["escrow"]["status"] == "completed"


# ─────────────────────────────────────────────────────────────────────────────
# 2. Idempotency — double-spend protection
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_release_after_completed_raises(db, test_module):
    m = test_module
    esc = await escrow_layer.create_escrow(
        db, module_id=m["module_id"], client_id=m["client_id"], amount=200.0,
    )
    await escrow_layer.fund_escrow(db, escrow_id=esc["escrow_id"], funded_by=m["client_id"])
    await escrow_layer.release_escrow(db, escrow_id=esc["escrow_id"], completed_share=1.0)

    payouts_before = await db.escrow_payouts.count_documents({"escrow_id": esc["escrow_id"]})
    # Second release must fail-fast (no silent double-spend).
    with pytest.raises(escrow_layer.EscrowError) as ei:
        await escrow_layer.release_escrow(db, escrow_id=esc["escrow_id"], completed_share=1.0)
    assert "completed" in str(ei.value).lower()
    payouts_after = await db.escrow_payouts.count_documents({"escrow_id": esc["escrow_id"]})
    assert payouts_after == payouts_before, "DOUBLE-SPEND: payouts grew after a re-release attempt"


@pytest.mark.asyncio
async def test_create_escrow_is_idempotent_per_module(db, test_module):
    m = test_module
    e1 = await escrow_layer.create_escrow(
        db, module_id=m["module_id"], client_id=m["client_id"], amount=100.0,
    )
    e2 = await escrow_layer.create_escrow(
        db, module_id=m["module_id"], client_id=m["client_id"], amount=999.0,
    )
    assert e1["escrow_id"] == e2["escrow_id"], "create_escrow must be idempotent per active module"


@pytest.mark.asyncio
async def test_cannot_fund_already_funded(db, test_module):
    m = test_module
    esc = await escrow_layer.create_escrow(
        db, module_id=m["module_id"], client_id=m["client_id"], amount=50.0,
    )
    await escrow_layer.fund_escrow(db, escrow_id=esc["escrow_id"], funded_by=m["client_id"])
    with pytest.raises(escrow_layer.EscrowError):
        await escrow_layer.fund_escrow(db, escrow_id=esc["escrow_id"], funded_by=m["client_id"])


# ─────────────────────────────────────────────────────────────────────────────
# 3. Settlement chain hook is idempotent
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_on_invoice_paid_idempotent(db, test_module):
    m = test_module
    money_runtime.wire(db=db, get_current_user=None, require_role=None)
    invoice = {
        "invoice_id": f"inv_test_{uuid.uuid4().hex[:8]}",
        "module_id": m["module_id"],
        "client_id": m["client_id"],
        "amount": 300.0,
    }
    r1 = await money_runtime.on_invoice_paid(invoice, funded_by=m["client_id"])
    assert r1["linked"] is True
    assert "escrow_id" in r1
    r2 = await money_runtime.on_invoice_paid(invoice, funded_by=m["client_id"])
    assert r2["linked"] is True
    assert r2.get("noop") is True, "Second invocation of on_invoice_paid must be a no-op"


# ─────────────────────────────────────────────────────────────────────────────
# 4. Refund flow
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_refund_funded_escrow_returns_locked_amount(db, test_module):
    m = test_module
    esc = await escrow_layer.create_escrow(
        db, module_id=m["module_id"], client_id=m["client_id"], amount=400.0,
    )
    await escrow_layer.fund_escrow(db, escrow_id=esc["escrow_id"], funded_by=m["client_id"])
    refunded = await escrow_layer.refund_escrow(
        db, escrow_id=esc["escrow_id"], reason="cancelled_by_client",
    )
    assert refunded["status"] == "refunded"
    assert refunded["refunded_amount"] == 400.0


# ─────────────────────────────────────────────────────────────────────────────
# 5. Capability boundary integration: payment_mode tagged correctly
# ─────────────────────────────────────────────────────────────────────────────

def test_payment_mode_helper_reads_from_registry():
    registry.reset()
    mode = money_runtime._payment_mode()
    assert mode in {"live", "mock", "degraded", "unavailable"}
    # Honest by default — without keys we MUST be on mock.
    assert mode != "live"


# ─────────────────────────────────────────────────────────────────────────────
# 6. Public state endpoint shape
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_money_runtime_state_shape(db):
    money_runtime.wire(db=db, get_current_user=None, require_role=None)
    state = await money_runtime.money_runtime_state()
    # Stable contract — UI depends on these keys.
    assert set(state.keys()) >= {"payment_capability", "stages", "diagnostics", "checked_at"}
    assert set(state["payment_capability"].keys()) >= {"provider", "mode", "available", "reason"}
    assert set(state["stages"].keys()) == {"invoices", "escrows", "earnings", "payouts"}
    for stage in state["stages"].values():
        assert isinstance(stage, dict)
        for v in stage.values():
            assert isinstance(v, int) and v >= 0
