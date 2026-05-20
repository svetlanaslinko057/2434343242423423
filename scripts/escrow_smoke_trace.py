#!/usr/bin/env python3
"""
Escrow Smoke Trace — Stage 7A observation.

Fires ONE real escrow lifecycle (invoice → escrow → release) through the
existing writers (escrow_layer.create_escrow, fund_escrow, release_escrow,
on_module_done) on an ISOLATED test module prefixed `smoke_`. After each
step, snapshots the Money Divergence Detector and records what classes
emerge. Output is a structured trace, NOT a fix.

Purpose:
    Catch the FIRST real-runtime divergence on the canonical chain. We
    expect to see at least one of:
        - escrow_payouts_orphan  (S-1: release_escrow runs without the
                                    parallel _credit_module_reward path)
        - ledger_missing         (chain does not emit money_ledger_events)
        - users.total_earnings   (legacy mirror $inc happens here)

What this script DOES touch:
    - Inserts ONE fresh module (`smoke_mod_<uuid>`)
    - Inserts ONE fresh client (`smoke_cli_<uuid>`)
    - Inserts ONE fresh developer (`smoke_dev_<uuid>`)
    - Inserts ONE module_assignment row
    - Inserts ONE invoice (`smoke_inv_<uuid>`)
    - Calls escrow_layer.create_escrow / fund_escrow / on_module_done
      EXACTLY as production does.
    All inserted rows are tagged `smoke_seed: True` for trivial cleanup.

What this script does NOT touch:
    - Existing seeded users / modules / wallets
    - The money writers themselves — we call them, we don't modify them
    - The detector — pure read

Run:
    python3 /app/scripts/escrow_smoke_trace.py
    python3 /app/scripts/escrow_smoke_trace.py --cleanup
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path("/app/backend")
sys.path.insert(0, str(BACKEND_DIR))

try:
    from dotenv import load_dotenv
    load_dotenv(BACKEND_DIR / ".env")
except ImportError:
    pass

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

import escrow_layer  # noqa: E402
import money_divergence  # noqa: E402
import money_runtime  # noqa: E402


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect():
    url = os.environ.get("MONGO_URL")
    name = os.environ.get("DB_NAME", "test_database")
    if not url:
        print("ERROR: MONGO_URL not set", file=sys.stderr)
        sys.exit(2)
    return AsyncIOMotorClient(url)[name]


async def cleanup(db):
    """Remove all rows with smoke_seed=True. Idempotent."""
    targets = [
        "modules", "users", "invoices", "escrows", "escrow_payouts",
        "module_assignments", "dev_earning_log", "dev_wallets",
        "money_ledger_events", "payouts",
    ]
    summary = {}
    for c in targets:
        r = await db[c].delete_many({"smoke_seed": True})
        if r.deleted_count:
            summary[c] = r.deleted_count
    return summary


async def seed(db, run_id: str) -> dict:
    """Create a clean smoke universe. Returns the ids."""
    module_id = f"smoke_mod_{run_id}"
    client_id = f"smoke_cli_{run_id}"
    developer_id = f"smoke_dev_{run_id}"
    invoice_id = f"smoke_inv_{run_id}"
    project_id = f"smoke_proj_{run_id}"
    now = _now()

    await db.users.insert_many([
        {
            "user_id": client_id, "email": f"client+{run_id}@smoke.local",
            "role": "client", "name": "Smoke Client",
            "smoke_seed": True, "created_at": now,
        },
        {
            "user_id": developer_id, "email": f"dev+{run_id}@smoke.local",
            "role": "developer", "name": "Smoke Dev", "tier": "middle",
            "smoke_seed": True, "created_at": now,
            "total_earnings": 0.0, "escrow_earnings": 0.0,
        },
    ])

    await db.modules.insert_one({
        "module_id": module_id, "project_id": project_id,
        "title": "Smoke trace module",
        "client_price": 1000.0, "status": "accepted",
        "assigned_to": developer_id, "developer_id": developer_id,
        "smoke_seed": True, "created_at": now,
    })

    await db.module_assignments.insert_one({
        "assignment_id": f"smoke_assign_{run_id}",
        "module_id": module_id, "developer_id": developer_id,
        "role": "developer", "responsibility": 1.0,
        "status": "active", "smoke_seed": True, "created_at": now,
    })

    await db.invoices.insert_one({
        "invoice_id": invoice_id, "module_id": module_id,
        "project_id": project_id, "client_id": client_id,
        "amount": 1000.0, "status": "pending_payment",
        "smoke_seed": True, "created_at": now,
    })

    return {
        "run_id": run_id,
        "module_id": module_id, "client_id": client_id,
        "developer_id": developer_id, "invoice_id": invoice_id,
        "project_id": project_id,
    }


async def snapshot(db, ids: dict, step_name: str) -> dict:
    """Snapshot the detector + raw collection state for one module/dev/invoice."""
    mod_diff = await money_divergence._diff_module(db, ids["module_id"])
    dev_diff = await money_divergence._diff_developer(db, ids["developer_id"])

    raw_invoice = await db.invoices.find_one(
        {"invoice_id": ids["invoice_id"]}, {"_id": 0}
    )
    raw_escrow = await db.escrows.find_one(
        {"module_id": ids["module_id"]}, {"_id": 0}
    )
    raw_module = await db.modules.find_one(
        {"module_id": ids["module_id"]}, {"_id": 0}
    )
    raw_wallet = await db.dev_wallets.find_one(
        {"user_id": ids["developer_id"]}, {"_id": 0}
    )
    raw_user = await db.users.find_one(
        {"user_id": ids["developer_id"]},
        {"_id": 0, "total_earnings": 1, "escrow_earnings": 1},
    )
    raw_log_count = await db.dev_earning_log.count_documents(
        {"module_id": ids["module_id"]}
    )
    raw_escrow_payouts = await db.escrow_payouts.count_documents(
        {"module_id": ids["module_id"]}
    )
    raw_ledger_count = await db.money_ledger_events.count_documents(
        {"$or": [
            {"entity_id": ids["module_id"]},
            {"entity_id": ids["invoice_id"]},
        ]}
    )

    return {
        "step": step_name,
        "at": _now(),
        "raw": {
            "invoice_status": (raw_invoice or {}).get("status"),
            "invoice_paid_at": (raw_invoice or {}).get("paid_at"),
            "invoice_settlement_escrow_id": (raw_invoice or {}).get("settlement_escrow_id"),
            "escrow_status": (raw_escrow or {}).get("status"),
            "escrow_locked": (raw_escrow or {}).get("locked_amount"),
            "escrow_released": (raw_escrow or {}).get("released_amount"),
            "module_status": (raw_module or {}).get("status"),
            "module_escrow_status": (raw_module or {}).get("escrow_status"),
            "wallet_earned_lifetime": (raw_wallet or {}).get("earned_lifetime"),
            "wallet_available_balance": (raw_wallet or {}).get("available_balance"),
            "users_total_earnings": (raw_user or {}).get("total_earnings"),
            "users_escrow_earnings": (raw_user or {}).get("escrow_earnings"),
            "dev_earning_log_rows_for_module": raw_log_count,
            "escrow_payouts_rows_for_module": raw_escrow_payouts,
            "ledger_events_for_module_or_invoice": raw_ledger_count,
        },
        "divergence": {
            "module": {
                "ok": mod_diff.get("ok"),
                "classes": [d["class"] for d in mod_diff.get("divergences", [])],
                "full": mod_diff,
            },
            "developer": {
                "ok": dev_diff.get("ok"),
                "classes": [d["class"] for d in dev_diff.get("divergences", [])],
                # Trim full developer diff to avoid noise from unrelated state
                # — caller may want it; keep only the smoke module's contribution
                "canonical": dev_diff.get("canonical"),
                "audit": dev_diff.get("audit"),
                "legacy": dev_diff.get("legacy"),
            },
        },
    }


async def run_trace(db) -> dict:
    run_id = uuid.uuid4().hex[:8]
    ids = await seed(db, run_id)

    # Wire money_runtime so on_invoice_paid hook has _db bound.
    # (money_runtime.wire normally happens via server.py; we replicate the
    # _db binding without router registration since we don't need HTTP here.)
    money_runtime._db = db

    snapshots = []

    # T0 — fresh smoke universe, no money yet
    snapshots.append(await snapshot(db, ids, "T0_seeded_pending_invoice"))

    # T1 — mark invoice paid → triggers money_runtime.on_invoice_paid →
    # escrow_layer.create_escrow + fund_escrow
    await db.invoices.update_one(
        {"invoice_id": ids["invoice_id"]},
        {"$set": {
            "status": "paid",
            "paid_at": _now(),
            "smoke_step": "T1",
        }},
    )
    invoice_doc = await db.invoices.find_one(
        {"invoice_id": ids["invoice_id"]}, {"_id": 0}
    )
    chain_result = await money_runtime.on_invoice_paid(
        invoice_doc, funded_by=ids["client_id"]
    )
    snap_t1 = await snapshot(db, ids, "T1_invoice_paid_chain_fired")
    snap_t1["chain_result"] = chain_result
    snapshots.append(snap_t1)

    # T2 — module flips to done → triggers escrow_layer.on_module_done →
    # release_escrow → escrow_payouts.insert + users.$inc total_earnings
    # CRUCIAL: we DO NOT call _credit_module_reward here. The HTTP path
    # client_approve_module calls both. This smoke fires only the escrow
    # branch — exactly to observe whether the parallel-writer divergence
    # surfaces as escrow_payouts_orphan in the detector.
    await db.modules.update_one(
        {"module_id": ids["module_id"]},
        {"$set": {"status": "done", "smoke_step": "T2"}},
    )
    release_result = await escrow_layer.on_module_done(db, ids["module_id"])
    snap_t2 = await snapshot(db, ids, "T2_module_done_escrow_released")
    snap_t2["release_result"] = {
        "released": release_result is not None,
        "release_total": (release_result or {}).get("release_total"),
        "payouts_count": len((release_result or {}).get("payouts", [])),
    } if release_result else {"released": False}
    snapshots.append(snap_t2)

    # T3 — final read, no extra action (lets background loops, if any,
    # settle). We don't sleep — production motion is 15s, irrelevant here.
    snapshots.append(await snapshot(db, ids, "T3_final_settled_state"))

    # Build the comparison table
    table = []
    for s in snapshots:
        table.append({
            "step": s["step"],
            "invoice": s["raw"]["invoice_status"],
            "escrow": s["raw"]["escrow_status"],
            "locked": s["raw"]["escrow_locked"],
            "released": s["raw"]["escrow_released"],
            "wallet_earned": s["raw"]["wallet_earned_lifetime"],
            "users.total_earnings": s["raw"]["users_total_earnings"],
            "dev_earning_log#": s["raw"]["dev_earning_log_rows_for_module"],
            "escrow_payouts#": s["raw"]["escrow_payouts_rows_for_module"],
            "ledger#": s["raw"]["ledger_events_for_module_or_invoice"],
            "module_diverged": not s["divergence"]["module"]["ok"],
            "module_classes": s["divergence"]["module"]["classes"],
        })

    return {
        "run_id": run_id,
        "ids": ids,
        "table": table,
        "snapshots": snapshots,
        "started_at": snapshots[0]["at"],
        "finished_at": snapshots[-1]["at"],
    }


async def amain(args):
    db = _connect()
    if args.cleanup:
        summary = await cleanup(db)
        print(json.dumps({"cleaned": summary}, indent=2))
        return
    trace = await run_trace(db)
    if args.cleanup_after:
        cleanup_summary = await cleanup(db)
        trace["cleanup"] = cleanup_summary
    json.dump(trace, sys.stdout, indent=2, ensure_ascii=False, default=str)
    sys.stdout.write("\n")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--cleanup", action="store_true",
                   help="Remove all smoke_seed=True rows and exit.")
    p.add_argument("--cleanup-after", action="store_true",
                   help="Run trace then clean up. Defaults to keeping rows for inspection.")
    args = p.parse_args()
    asyncio.run(amain(args))


if __name__ == "__main__":
    main()
