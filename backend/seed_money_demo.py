"""
Этап 6.1 — Money Demo Seed.

Creates a deterministic end-to-end money flow that exercises the canonical
chain. Idempotent — re-running does not duplicate state.

Demo cast:
    admin@evax.demo      / Admin123!
    client@evax.demo     / Client123!
    developer@evax.demo  / Developer123!
    tester@evax.demo     / Tester123!

Demo chain produced:
    1. Project created by client
    2. Module priced (client_price=$1000, dev_reward=$700)
    3. Invoice issued to client
    4. (Optional) admin marks invoice paid
       → ledger: invoice_paid + escrow_funded
    5. Module assigned to developer; status=in_progress
    6. (Optional) client approves module
       → ledger: qa_approved + earning_approved + escrow_released
       → dev wallet credited
    7. (Optional) admin batches earning into payout
       → ledger: payout_batched
    8. (Optional) admin marks batch paid
       → ledger: payout_paid

Run as:
    cd /app/backend && /root/.venv/bin/python seed_money_demo.py
    cd /app/backend && /root/.venv/bin/python seed_money_demo.py --advance=full

Flags:
    --advance=invoice    stop after invoice paid (escrow funded)
    --advance=approve    + client approves module (full chain to wallet)
    --advance=full       + payout batch created, approved, paid (default)
"""
from __future__ import annotations
import argparse
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from passlib.context import CryptContext  # noqa: E402

import money_ledger  # noqa: E402

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "test_database")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _now():
    return datetime.now(timezone.utc).isoformat()


DEMO_USERS = [
    {
        "user_id": "demo_admin_001",
        "email": "admin@evax.demo",
        "password": "Admin123!",
        "name": "Demo Admin",
        "role": "admin",
        "roles": ["admin"],
    },
    {
        "user_id": "demo_client_001",
        "email": "client@evax.demo",
        "password": "Client123!",
        "name": "Demo Client",
        "role": "client",
        "roles": ["client"],
    },
    {
        "user_id": "demo_dev_001",
        "email": "developer@evax.demo",
        "password": "Developer123!",
        "name": "Demo Developer",
        "role": "developer",
        "roles": ["developer"],
    },
    {
        "user_id": "demo_tester_001",
        "email": "tester@evax.demo",
        "password": "Tester123!",
        "name": "Demo Tester",
        "role": "tester",
        "roles": ["tester"],
    },
]


async def upsert_users(db):
    for u in DEMO_USERS:
        existing = await db.users.find_one({"email": u["email"]}, {"_id": 0})
        doc = {
            "user_id": existing.get("user_id") if existing else u["user_id"],
            "email": u["email"],
            "name": u["name"],
            "role": u["role"],
            "roles": u["roles"],
            "password_hash": pwd_context.hash(u["password"]),
            "created_at": _now() if not existing else existing.get("created_at", _now()),
            "is_demo_account": True,
        }
        await db.users.update_one(
            {"email": u["email"]},
            {"$set": doc},
            upsert=True,
        )
    print(f"  ✓ {len(DEMO_USERS)} demo users upserted")


async def upsert_project_and_module(db):
    project_id = "demo_proj_money_001"
    client_id = "demo_client_001"
    module_id = "demo_module_money_001"

    # Project
    await db.projects.update_one(
        {"project_id": project_id},
        {
            "$set": {
                "project_id": project_id,
                "title": "EVA-X Money Demo Project",
                "name": "EVA-X Money Demo Project",
                "description": "Demo project to exercise the canonical money chain.",
                "client_id": client_id,
                "status": "active",
                "payment_plan": "modules",
                "created_at": _now(),
                "is_demo": True,
            }
        },
        upsert=True,
    )

    # Module: $1000 client price, $700 dev_reward, $300 platform margin
    await db.modules.update_one(
        {"module_id": module_id},
        {
            "$set": {
                "module_id": module_id,
                "project_id": project_id,
                "title": "Auth + Onboarding Module",
                "client_price": 1000.0,
                "price": 1000.0,
                "dev_reward": 700.0,
                "status": "review",  # ready for client approval
                "qa_status": "passed",
                "assigned_to": "demo_dev_001",
                "developer_id": "demo_dev_001",
                "created_at": _now(),
                "is_demo": True,
            }
        },
        upsert=True,
    )

    # Module assignment (escrow_layer.release_escrow needs this)
    await db.module_assignments.update_one(
        {"module_id": module_id, "developer_id": "demo_dev_001"},
        {
            "$set": {
                "module_id": module_id,
                "developer_id": "demo_dev_001",
                "role": "developer",
                "responsibility": 1.0,
                "status": "active",
                "created_at": _now(),
            }
        },
        upsert=True,
    )

    print(f"  ✓ project + module ({module_id}) seeded")
    return project_id, module_id, client_id


async def upsert_invoice(db, project_id: str, module_id: str, client_id: str):
    invoice_id = "demo_inv_money_001"
    await db.invoices.update_one(
        {"invoice_id": invoice_id},
        {
            "$set": {
                "invoice_id": invoice_id,
                "project_id": project_id,
                "module_id": module_id,
                "client_id": client_id,
                "title": "Module: Auth + Onboarding",
                "amount": 1000.0,
                "currency": "USD",
                "status": "pending_payment",
                "kind": "module",
                "created_at": _now(),
                "is_demo": True,
            }
        },
        upsert=True,
    )
    print(f"  ✓ invoice {invoice_id} (pending_payment) seeded")
    return invoice_id


async def chain_invoice_paid(db, invoice_id: str):
    """Idempotent: mark invoice paid + ledger event + escrow auto-fund."""
    inv = await db.invoices.find_one({"invoice_id": invoice_id}, {"_id": 0})
    if not inv:
        print("  ✗ invoice missing")
        return

    if inv["status"] != "paid":
        await db.invoices.update_one(
            {"invoice_id": invoice_id},
            {"$set": {"status": "paid", "paid_at": _now()}},
        )

    # Ledger
    rec = await money_ledger.record_event(
        db,
        event_type=money_ledger.EVENT_INVOICE_PAID,
        entity_id=invoice_id,
        project_id=inv.get("project_id"),
        actor_id="demo_admin_001",
        amount=inv["amount"],
        idempotency_key=invoice_id,
        payload={"source": "seed_money_demo"},
    )
    print(f"  ✓ ledger invoice_paid: {'recorded' if rec['recorded'] else 'duplicate'}")

    # Auto-fund escrow via money_runtime (idempotent inside)
    import money_runtime
    # money_runtime needs to be wired (db is set when server starts).
    # In the seed script we wire it directly.
    money_runtime._db = db
    inv = await db.invoices.find_one({"invoice_id": invoice_id}, {"_id": 0})
    chain = await money_runtime.on_invoice_paid(inv, funded_by="demo_admin_001")
    if chain.get("escrow_id"):
        await money_ledger.record_event(
            db,
            event_type=money_ledger.EVENT_ESCROW_FUNDED,
            entity_id=chain["escrow_id"],
            project_id=inv.get("project_id"),
            actor_id="demo_admin_001",
            amount=inv["amount"],
            idempotency_key=chain["escrow_id"],
            payload={"invoice_id": invoice_id, "source": "seed_money_demo"},
        )
        print(f"  ✓ escrow {chain['escrow_id']} funded (chain={chain})")
    else:
        print(f"  ⚠ escrow not funded: {chain}")


async def chain_module_approved(db, module_id: str):
    """Idempotent: client approves → earning + escrow release + ledger."""
    mod = await db.modules.find_one({"module_id": module_id}, {"_id": 0})
    if not mod:
        print("  ✗ module missing")
        return

    # Mark module done if not yet
    if mod["status"] != "done":
        await db.modules.update_one(
            {"module_id": module_id},
            {"$set": {
                "status": "done",
                "qa_status": "passed",
                "approved_by": "demo_client_001",
                "approved_at": _now(),
                "completed_at": _now(),
            }},
        )

    # Credit dev earning (idempotent: dev_earning_log unique per module_id)
    dev_id = mod.get("assigned_to") or "demo_dev_001"
    existing = await db.dev_earning_log.find_one({"module_id": module_id})
    if not existing:
        reward = float(mod.get("dev_reward") or 700)
        client_price = float(mod.get("client_price") or 1000)
        margin = round(client_price - reward, 2)
        log_id = f"de_{uuid.uuid4().hex[:12]}"
        await db.dev_earning_log.insert_one({
            "log_id": log_id,
            "user_id": dev_id,
            "module_id": module_id,
            "project_id": mod.get("project_id"),
            "amount": reward,
            "module_price": client_price,
            "tier": "middle",
            "rate": 0.7,
            "platform_margin": margin,
            "reason": "module_approved",
            "created_at": _now(),
        })
        # Phase 2C-B4.0.1 — route synthetic balance through MoneyService.
        # Previously this block did `db.dev_wallets.update_one(...)` directly,
        # which made `seed_money_demo.py` a B-class legacy writer. Now we
        # use the canonical chain: hold_escrow + release_escrow. Idempotent
        # via deterministic keys tied to module_id.
        from money_bridge import get_money_service
        from domains.money import Money
        _svc = get_money_service()
        if _svc is not None and reward > 0:
            _cents = int(round(reward * 100))
            _project = mod.get("project_id") or f"demo_module_{module_id}"
            await _svc.hold_escrow(
                project_id=_project,
                amount=Money(_cents, "USD"),
                client_id="demo_client_001",
                actor="seed_money_demo",
                module_id=module_id,
                idempotency_key=f"seed_money_demo:hold:{module_id}",
                memo=f"seed_money_demo: synthetic escrow fund for {module_id}",
            )
            await _svc.release_escrow(
                project_id=_project,
                amount=Money(_cents, "USD"),
                developer_id=dev_id,
                actor="seed_money_demo",
                module_id=module_id,
                fee_cents=0,
                idempotency_key=f"seed_money_demo:release:{module_id}",
                memo=f"seed_money_demo: credit dev_id={dev_id}",
            )
        print(f"  ✓ dev earning credited: ${reward} to {dev_id} (via MoneyService)")
    else:
        print(f"  ✓ dev earning already credited (idempotent)")

    # Ledger: qa_approved + earning_approved
    await money_ledger.record_event(
        db,
        event_type=money_ledger.EVENT_QA_APPROVED,
        entity_id=module_id,
        project_id=mod.get("project_id"),
        actor_id="demo_client_001",
        idempotency_key=module_id,
        payload={"approved_by": "demo_client_001"},
    )
    earn_log = await db.dev_earning_log.find_one({"module_id": module_id}, {"_id": 0})
    if earn_log:
        await money_ledger.record_event(
            db,
            event_type=money_ledger.EVENT_EARNING_APPROVED,
            entity_id=earn_log["log_id"],
            project_id=mod.get("project_id"),
            actor_id="demo_client_001",
            amount=float(earn_log["amount"]),
            idempotency_key=module_id,
            payload={
                "developer_id": dev_id,
                "module_id": module_id,
                "tier": earn_log.get("tier"),
                "rate": earn_log.get("rate"),
            },
        )

    # Escrow release via money_runtime hook
    import money_runtime
    money_runtime._db = db
    chain = await money_runtime.on_module_done_chain(module_id)
    if chain and chain.get("payouts"):
        esc = chain.get("escrow") or {}
        await money_ledger.record_event(
            db,
            event_type=money_ledger.EVENT_ESCROW_RELEASED,
            entity_id=esc.get("escrow_id") or module_id,
            project_id=mod.get("project_id"),
            actor_id="demo_client_001",
            amount=float(chain.get("release_total") or 0),
            idempotency_key=esc.get("escrow_id") or f"release_{module_id}",
            payload={
                "module_id": module_id,
                "payout_count": len(chain.get("payouts") or []),
            },
        )
        print(f"  ✓ escrow released: ${chain.get('release_total')} to {len(chain.get('payouts') or [])} dev(s)")
    else:
        print(f"  ⚠ escrow release skipped: {chain}")


async def chain_payout_batched(db):
    """Create payout batch from approved earnings + ledger event."""
    from earnings_layer import EARNING_STATUS_APPROVED, EARNING_STATUS_BATCHED

    dev_id = "demo_dev_001"
    # Pull dev_wallet available_balance — that is our authoritative pool
    # for the demo. Real production batching uses earnings_layer collections.
    wallet = await db.dev_wallets.find_one({"user_id": dev_id}, {"_id": 0})
    if not wallet or float(wallet.get("available_balance") or 0) <= 0:
        print(f"  ⚠ no available balance to batch for {dev_id}")
        return None

    batch_id = "demo_batch_001"
    amount = float(wallet["available_balance"])
    existing = await db.payout_batches.find_one({"batch_id": batch_id}, {"_id": 0})
    if existing:
        print(f"  ✓ payout batch {batch_id} already exists (idempotent)")
        return batch_id

    period_start = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    period_end = datetime.now(timezone.utc).isoformat()

    await db.payout_batches.insert_one({
        "batch_id": batch_id,
        "user_id": dev_id,
        "period_start": period_start,
        "period_end": period_end,
        "earning_ids": [],  # demo
        "final_amount": amount,
        "gross_amount": amount,
        "fees_total": 0.0,
        "status": "draft",
        "created_at": _now(),
        "is_demo": True,
    })

    # Phase 2C-B4.0.1 — replaces the legacy `dev_wallets.update_one` block
    # that moved `available -> pending_withdrawal`. The "pending" intermediate
    # state has no canonical equivalent (it is the D-class lifecycle deferred
    # to B4.3), so for demo purposes we simply record the batch in
    # `payout_batches` and let `mark_batch_paid` drive the canonical payout.
    # No money has actually moved at this stage in the canonical view.

    await money_ledger.record_event(
        db,
        event_type=money_ledger.EVENT_PAYOUT_BATCHED,
        entity_id=batch_id,
        actor_id="demo_admin_001",
        amount=amount,
        idempotency_key=batch_id,
        payload={"developer_id": dev_id, "earning_count": 1},
    )
    print(f"  ✓ payout batch {batch_id} created for ${amount}")
    return batch_id


async def chain_payout_paid(db, batch_id: str):
    batch = await db.payout_batches.find_one({"batch_id": batch_id}, {"_id": 0})
    if not batch:
        return
    if batch["status"] != "paid":
        await db.payout_batches.update_one(
            {"batch_id": batch_id},
            {"$set": {"status": "paid", "paid_at": _now(),
                      "payment_method": "bank_transfer",
                      "payment_reference": "DEMO-TXN-001"}},
        )
        # Phase 2C-B4.0.1 — route the synthetic payout through MoneyService
        # (previously: `db.dev_wallets.update_one $inc pending → withdrawn`).
        # Canonical chain debits `ac_dev:<dev>` and credits `ac_ext:<dev>`,
        # which is the projection's source for `withdrawn_lifetime_cents`.
        amount = float(batch["final_amount"])
        from money_bridge import get_money_service
        from domains.money import Money
        _svc = get_money_service()
        if _svc is not None and amount > 0:
            _cents = int(round(amount * 100))
            await _svc.process_payout(
                developer_id=batch["user_id"],
                amount=Money(_cents, "USD"),
                actor="seed_money_demo",
                payout_batch_id=batch_id,
                external_ref="DEMO-TXN-001",
                idempotency_key=f"seed_money_demo:payout:{batch_id}",
            )

    # Ledger
    await money_ledger.record_event(
        db,
        event_type=money_ledger.EVENT_PAYOUT_APPROVED,
        entity_id=batch_id,
        actor_id="demo_admin_001",
        amount=float(batch["final_amount"]),
        idempotency_key=f"approve_{batch_id}",
        payload={"developer_id": batch.get("user_id")},
    )
    await money_ledger.record_event(
        db,
        event_type=money_ledger.EVENT_PAYOUT_PAID,
        entity_id=batch_id,
        actor_id="demo_admin_001",
        amount=float(batch["final_amount"]),
        idempotency_key=f"paid_{batch_id}",
        payload={
            "developer_id": batch.get("user_id"),
            "payment_method": "bank_transfer",
            "payment_reference": "DEMO-TXN-001",
        },
    )
    print(f"  ✓ payout batch {batch_id} marked paid")


async def main(advance: str):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    await money_ledger.ensure_indexes(db)

    print("=" * 60)
    print("EVA-X Money Demo Seed (Этап 6.1)")
    print("=" * 60)

    print("\n[1/5] Demo users …")
    await upsert_users(db)

    print("\n[2/5] Project + module …")
    project_id, module_id, client_id = await upsert_project_and_module(db)

    print("\n[3/5] Invoice (pending_payment) …")
    invoice_id = await upsert_invoice(db, project_id, module_id, client_id)

    if advance in ("invoice", "approve", "full"):
        print("\n[4/5] Chain: invoice_paid → escrow_funded …")
        await chain_invoice_paid(db, invoice_id)

    if advance in ("approve", "full"):
        print("\n[5/5] Chain: module_approved → earning + escrow_released …")
        await chain_module_approved(db, module_id)

    if advance == "full":
        print("\n[6/?] Chain: payout_batched + payout_paid …")
        batch_id = await chain_payout_batched(db)
        if batch_id:
            await chain_payout_paid(db, batch_id)

    # Summary
    print("\n" + "=" * 60)
    print("LEDGER SUMMARY")
    print("=" * 60)
    overview = await money_ledger.overview(db)
    print(f"  total_events: {overview['total_events']}")
    for et, info in overview["by_event_type"].items():
        if info["count"] > 0:
            print(f"  {et:24s} count={info['count']} total=${info['total_amount']:.2f}")

    wallet = await db.dev_wallets.find_one({"user_id": "demo_dev_001"}, {"_id": 0}) or {}
    print(f"\n  Developer wallet: earned_lifetime=${wallet.get('earned_lifetime', 0):.2f} "
          f"available=${wallet.get('available_balance', 0):.2f} "
          f"pending=${wallet.get('pending_withdrawal', 0):.2f} "
          f"withdrawn=${wallet.get('withdrawn_lifetime', 0):.2f}")

    print("\n  Demo creds (see /app/memory/test_credentials.md):")
    for u in DEMO_USERS:
        print(f"    {u['role']:10s} {u['email']:30s} / {u['password']}")
    print()

    client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--advance",
        default="full",
        choices=["seed", "invoice", "approve", "full"],
        help="seed: just users+project+invoice. invoice: + paid+escrow. "
             "approve: + module approved+earning+release. full: + payout chain.",
    )
    args = parser.parse_args()
    asyncio.run(main(args.advance))
