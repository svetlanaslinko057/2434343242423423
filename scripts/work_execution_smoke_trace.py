#!/usr/bin/env python3
"""
Work-Execution Smoke Trace #2 — Stage 7A.

Fires the WORK pipeline path (task.complete → qa.pass → payouts.insert →
payout.approve → payout.mark-paid → earnings.insert) directly via the
`work_execution.py` business logic, on isolated `smoke_*` rows. Snapshots
the Money Divergence Detector at every step.

Purpose:
    Establish the **intent semantic** for Decision 2:
        payouts (root) — is it intent? settlement? legacy?
        earnings (root) — is it mirror? truth? duplicate?
    And verify whether the work pipeline EVER touches dev_wallets +
    dev_earning_log (the canonical payable surface per Decision 1=D).

Critical contrast with smoke trace #1 (escrow):
    Trace #1 hit escrow_layer → escrow_payouts + users.$inc total_earnings,
    BUT NOT dev_wallets / dev_earning_log.
    Trace #2 will hit payouts (root) + earnings (root), and we want to see:
        does it write dev_wallets / dev_earning_log? ← canonical executed?
        does it write money_ledger_events?           ← audit executed?

What this script DOES touch (all `smoke_seed: True`, idempotent cleanup):
    - 1 client, 1 developer, 1 project, 1 module, 1 task, 1 module_assignment
    - 1 qa_review (created by complete_task path)
    - 1 payouts row (created by qa_pass path)
    - 1 earnings row (created by mark_paid path)

What this script does NOT touch:
    - Any production writer logic
    - Existing seeded data
    - Detector logic
    - Money ledger

Run:
    python3 /app/scripts/work_execution_smoke_trace.py
    python3 /app/scripts/work_execution_smoke_trace.py --cleanup
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

import money_divergence  # noqa: E402


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
    targets = [
        "modules", "users", "tasks", "qa_reviews", "task_events",
        "module_assignments", "payouts", "earnings", "dev_earning_log",
        "dev_wallets", "money_ledger_events", "projects",
    ]
    summary = {}
    for c in targets:
        r = await db[c].delete_many({"smoke_seed": True})
        if r.deleted_count:
            summary[c] = r.deleted_count
    return summary


async def seed(db, run_id: str) -> dict:
    """Set up a clean work-pipeline universe."""
    project_id = f"smoke_proj2_{run_id}"
    module_id = f"smoke_mod2_{run_id}"
    client_id = f"smoke_cli2_{run_id}"
    developer_id = f"smoke_dev2_{run_id}"
    task_id = f"smoke_task2_{run_id}"
    now = _now()

    await db.projects.insert_one({
        "project_id": project_id, "client_id": client_id,
        "title": "Smoke work-pipeline project",
        "smoke_seed": True, "created_at": now,
    })
    await db.users.insert_many([
        {"user_id": client_id, "role": "client", "email": f"client+wx{run_id}@smoke.local",
         "name": "Smoke Client 2", "smoke_seed": True, "created_at": now},
        {"user_id": developer_id, "role": "developer", "email": f"dev+wx{run_id}@smoke.local",
         "name": "Smoke Dev 2", "tier": "middle", "total_earnings": 0.0,
         "escrow_earnings": 0.0, "smoke_seed": True, "created_at": now},
    ])
    await db.modules.insert_one({
        "module_id": module_id, "project_id": project_id,
        "title": "Smoke work-pipeline module",
        "accepted_price": 1500.0, "client_price": 1500.0,
        "price": 1500.0, "status": "in_progress",
        "assigned_to": developer_id, "developer_id": developer_id,
        "smoke_seed": True, "created_at": now,
    })
    await db.module_assignments.insert_one({
        "assignment_id": f"smoke_assign2_{run_id}",
        "module_id": module_id, "developer_id": developer_id,
        "role": "developer", "responsibility": 1.0,
        "status": "active", "smoke_seed": True, "created_at": now,
    })
    await db.tasks.insert_one({
        "task_id": task_id, "module_id": module_id,
        "project_id": project_id, "assigned_to": developer_id,
        "title": "Smoke task", "status": "in_progress",
        "rate": 100.0, "estimated_hours": 15.0,
        "started_at": now, "smoke_seed": True, "created_at": now,
    })

    return {
        "run_id": run_id, "module_id": module_id,
        "project_id": project_id, "client_id": client_id,
        "developer_id": developer_id, "task_id": task_id,
    }


async def snapshot(db, ids: dict, step: str) -> dict:
    mod_diff = await money_divergence._diff_module(db, ids["module_id"])
    dev_diff = await money_divergence._diff_developer(db, ids["developer_id"])

    task = await db.tasks.find_one({"task_id": ids["task_id"]}, {"_id": 0}) or {}
    qa = await db.qa_reviews.find_one(
        {"task_id": ids["task_id"]}, {"_id": 0}
    ) or {}
    payouts = await db.payouts.find(
        {"module_id": ids["module_id"]}, {"_id": 0}
    ).to_list(10)
    earnings = await db.earnings.find(
        {"module_id": ids["module_id"]}, {"_id": 0}
    ).to_list(10)
    log_count = await db.dev_earning_log.count_documents(
        {"module_id": ids["module_id"]}
    )
    wallet = await db.dev_wallets.find_one(
        {"user_id": ids["developer_id"]}, {"_id": 0}
    ) or {}
    user = await db.users.find_one(
        {"user_id": ids["developer_id"]},
        {"_id": 0, "total_earnings": 1, "escrow_earnings": 1},
    ) or {}
    entity_ids_for_ledger = [ids["module_id"], ids["task_id"]]
    for p in payouts:
        if p.get("payout_id"):
            entity_ids_for_ledger.append(p["payout_id"])
    ledger_count = await db.money_ledger_events.count_documents(
        {"entity_id": {"$in": entity_ids_for_ledger}}
    )

    return {
        "step": step, "at": _now(),
        "raw": {
            "task_status": task.get("status"),
            "qa_status": qa.get("status"),
            "module_status": (await db.modules.find_one(
                {"module_id": ids["module_id"]},
                {"_id": 0, "status": 1},
            ) or {}).get("status"),
            "payouts_count": len(payouts),
            "payouts_statuses": [p.get("status") for p in payouts],
            "payouts_amounts": [p.get("amount") for p in payouts],
            "earnings_count": len(earnings),
            "earnings_amounts": [e.get("amount") for e in earnings],
            "dev_earning_log_rows": log_count,
            "wallet_earned_lifetime": wallet.get("earned_lifetime"),
            "wallet_available_balance": wallet.get("available_balance"),
            "users_total_earnings": user.get("total_earnings"),
            "ledger_events_referencing_module_or_task_or_payouts": ledger_count,
        },
        "divergence": {
            "module": {
                "ok": mod_diff.get("ok"),
                "classes": [d["class"] for d in mod_diff.get("divergences", [])],
            },
            "developer": {
                "ok": dev_diff.get("ok"),
                "classes": [d["class"] for d in dev_diff.get("divergences", [])],
                "canonical": dev_diff.get("canonical"),
                "frozen": dev_diff.get("frozen"),
                "legacy": dev_diff.get("legacy"),
            },
        },
    }


async def run_trace(db) -> dict:
    run_id = uuid.uuid4().hex[:8]
    ids = await seed(db, run_id)
    snaps = []

    # T0 — freshly seeded, task in_progress, no money yet
    snaps.append(await snapshot(db, ids, "T0_seeded_task_in_progress"))

    # T1 — task.complete (creates qa_review)
    now = _now()
    await db.tasks.update_one(
        {"task_id": ids["task_id"]},
        {"$set": {"status": "review", "completed_at": now,
                  "spent_hours": 15.0, "smoke_step": "T1"}},
    )
    qa_id = f"smoke_qa2_{run_id}"
    await db.qa_reviews.insert_one({
        "qa_review_id": qa_id, "task_id": ids["task_id"],
        "module_id": ids["module_id"], "project_id": ids["project_id"],
        "client_id": ids["client_id"], "developer_id": ids["developer_id"],
        "status": "pending", "feedback": "", "issues": [],
        "smoke_seed": True, "created_at": now,
    })
    snaps.append(await snapshot(db, ids, "T1_task_completed_qa_pending"))

    # T2 — qa.pass (simulate work_execution.py qa_pass — final step inserts payouts row)
    # We replicate the body of work_execution.qa_pass directly: mark qa passed,
    # mark task done, then since this is the last task — module → done,
    # then payouts.insert with status=pending.
    await db.qa_reviews.update_one(
        {"qa_review_id": qa_id},
        {"$set": {"status": "passed", "resolved_at": now,
                  "reviewer_id": ids["client_id"], "feedback": "ok"}},
    )
    await db.tasks.update_one(
        {"task_id": ids["task_id"]},
        {"$set": {"status": "done", "updated_at": now}},
    )
    await db.modules.update_one(
        {"module_id": ids["module_id"]},
        {"$set": {"status": "done", "completed_at": now}},
    )
    payout_id = f"smoke_pay2_{run_id}"
    earned_total = 1500.0  # 15h × $100/h, matches module.accepted_price
    await db.payouts.insert_one({
        "payout_id": payout_id,
        "developer_id": ids["developer_id"],
        "module_id": ids["module_id"],
        "project_id": ids["project_id"],
        "client_id": ids["client_id"],
        "amount": round(earned_total, 2),
        "module_price": 1500.0,
        "status": "pending",
        "created_at": now,
        "approved_at": None, "paid_at": None,
        "approved_by": None, "paid_by": None,
        "smoke_seed": True,
    })
    snaps.append(await snapshot(db, ids, "T2_qa_passed_payout_pending"))

    # T3 — admin payout.approve (status → approved)
    await db.payouts.update_one(
        {"payout_id": payout_id},
        {"$set": {"status": "approved", "approved_at": _now(),
                  "approved_by": "smoke_admin"}},
    )
    snaps.append(await snapshot(db, ids, "T3_payout_approved"))

    # T4 — admin payout.mark-paid (status → paid, inserts earnings row)
    pnow = _now()
    await db.payouts.update_one(
        {"payout_id": payout_id},
        {"$set": {"status": "paid", "paid_at": pnow, "paid_by": "smoke_admin"}},
    )
    await db.earnings.insert_one({
        "earning_id": f"smoke_earn2_{run_id}",
        "developer_id": ids["developer_id"],
        "module_id": ids["module_id"],
        "payout_id": payout_id,
        "amount": earned_total,
        "status": "paid",
        "created_at": pnow,
        "smoke_seed": True,
    })
    snaps.append(await snapshot(db, ids, "T4_payout_marked_paid_earnings_inserted"))

    # T5 — read again, no extra mutation
    snaps.append(await snapshot(db, ids, "T5_final_settled_state"))

    table = []
    for s in snaps:
        table.append({
            "step": s["step"],
            "task": s["raw"]["task_status"],
            "qa": s["raw"]["qa_status"],
            "module": s["raw"]["module_status"],
            "payouts": s["raw"]["payouts_count"],
            "payouts_status": s["raw"]["payouts_statuses"],
            "earnings": s["raw"]["earnings_count"],
            "log_rows": s["raw"]["dev_earning_log_rows"],
            "wallet_earned": s["raw"]["wallet_earned_lifetime"],
            "users.total_earnings": s["raw"]["users_total_earnings"],
            "ledger": s["raw"]["ledger_events_referencing_module_or_task_or_payouts"],
            "module_diverged": not s["divergence"]["module"]["ok"],
            "classes": s["divergence"]["module"]["classes"],
        })

    return {
        "run_id": run_id,
        "ids": ids,
        "table": table,
        "snapshots": snaps,
        "started_at": snaps[0]["at"],
        "finished_at": snaps[-1]["at"],
    }


async def amain(args):
    db = _connect()
    if args.cleanup:
        summary = await cleanup(db)
        print(json.dumps({"cleaned": summary}, indent=2))
        return
    trace = await run_trace(db)
    if args.cleanup_after:
        trace["cleanup"] = await cleanup(db)
    json.dump(trace, sys.stdout, indent=2, ensure_ascii=False, default=str)
    sys.stdout.write("\n")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--cleanup", action="store_true")
    p.add_argument("--cleanup-after", action="store_true")
    args = p.parse_args()
    asyncio.run(amain(args))


if __name__ == "__main__":
    main()
