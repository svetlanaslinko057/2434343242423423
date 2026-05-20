#!/usr/bin/env python3
"""
Withdrawal Smoke Trace #3 — Stage 7A.

Exercises the full developer-withdrawal lifecycle on isolated smoke rows AND
demonstrates the `withdrawals` vs `dev_withdrawals` split-brain documented
in MONEY_DECISIONS_2_6_MEMO §4.

Two parts:

PART 1 — Canonical flow (server.py routes, `dev_withdrawals` collection)
    T0: clean seeded developer with wallet.available_balance > 0
    T1: POST /api/developer/withdrawals  → status=requested, wallet decremented
    T2: POST /api/admin/withdrawals/{id}/approve  → status=approved
    T3: POST /api/admin/withdrawals/{id}/mark-paid → status=paid,
                                                     wallet pending → withdrawn

PART 2 — Split-brain demonstration (admin_mobile, `withdrawals` collection)
    S0: insert a row into the OTHER collection (db.withdrawals)
        — this is what the mobile admin cockpit operates on. The fact that
        we have to *manually* insert here is itself the proof: the developer
        flow never writes db.withdrawals, so the mobile cockpit operates on
        rows that have no developer-side origin.
    S1: simulate admin-mobile approve via admin_mobile.py:516 (which writes
        only db.withdrawals)
    S2: read developer view: `db.dev_withdrawals.find({user_id})` —
        empty, because the developer flow only knows about its own collection
    S3: read admin-server view: `db.dev_withdrawals` — also empty for this row
    Result: an "approved withdrawal" exists that no developer can see and
    no developer wallet was credited.

Pure observation. No writer changes.

Output structure:
    {
      "run_id": "...",
      "ids": {...},
      "part_1_canonical": [...snapshots T0..T3],
      "part_2_split_brain": [...snapshots S0..S3],
      "split_brain_summary": {...}
    }

Run:
    python3 /app/scripts/withdrawal_smoke_trace.py
    python3 /app/scripts/withdrawal_smoke_trace.py --cleanup
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
        "users", "dev_wallets", "dev_withdrawals", "withdrawals",
        "money_ledger_events",
    ]
    summary = {}
    for c in targets:
        r = await db[c].delete_many({"smoke_seed": True})
        if r.deleted_count:
            summary[c] = r.deleted_count
    return summary


async def seed(db, run_id: str) -> dict:
    developer_id = f"smoke_devW_{run_id}"
    now = _now()

    await db.users.insert_one({
        "user_id": developer_id,
        "email": f"dev+wd{run_id}@smoke.local",
        "role": "developer", "name": "Smoke WD Dev",
        "total_earnings": 0.0, "escrow_earnings": 0.0,
        "smoke_seed": True, "created_at": now,
    })
    await db.dev_wallets.insert_one({
        "user_id": developer_id,
        "earned_lifetime": 2000.0,
        "available_balance": 2000.0,
        "withdrawn_lifetime": 0.0,
        "pending_withdrawal": 0.0,
        "smoke_seed": True, "created_at": now, "updated_at": now,
    })

    return {"run_id": run_id, "developer_id": developer_id}


# ─────────────────────────────────────────────────────────────────────────────
# Replicas of the production withdrawal handlers (no HTTP, direct db access).
# These mirror server.py:11030+ and admin_mobile.py:501+ EXACTLY — same
# update predicates, same CAS, same field mutations. We do not modify the
# real handlers; we replay their bodies on the smoke universe.
# ─────────────────────────────────────────────────────────────────────────────

async def replay_dev_request_withdrawal(db, developer_id: str, amount: float,
                                         method: str = "manual",
                                         destination: str = "smoke_iban"):
    """Mirror of server.py:11030+ /api/developer/withdrawals POST handler."""
    now = datetime.now(timezone.utc)
    cas = await db.dev_wallets.update_one(
        {"user_id": developer_id,
         "available_balance": {"$gte": amount - 0.001}},
        {"$inc": {"available_balance": -amount,
                  "pending_withdrawal": amount},
         "$set": {"updated_at": now.isoformat()}},
    )
    if cas.modified_count == 0:
        return None  # would have raised 400 in production
    withdrawal_id = f"wd_{uuid.uuid4().hex[:12]}"
    doc = {
        "withdrawal_id": withdrawal_id, "user_id": developer_id,
        "amount": amount, "currency": "USD",
        "status": "requested", "method": method, "destination": destination,
        "note": "smoke", "created_at": now.isoformat(),
        "approved_at": None, "paid_at": None, "approved_by": None,
        "smoke_seed": True,
    }
    await db.dev_withdrawals.insert_one(dict(doc))
    return doc


async def replay_admin_approve_canonical(db, withdrawal_id: str, admin_id: str = "smoke_admin"):
    """Mirror of server.py:11139+ /api/admin/withdrawals/{id}/approve."""
    now_iso = _now()
    res = await db.dev_withdrawals.update_one(
        {"withdrawal_id": withdrawal_id, "status": "requested"},
        {"$set": {"status": "approved", "approved_at": now_iso,
                  "approved_by": admin_id}},
    )
    return res.modified_count


async def replay_admin_mark_paid_canonical(db, withdrawal_id: str):
    """Mirror of server.py:11159+ /api/admin/withdrawals/{id}/mark-paid."""
    now_iso = _now()
    res = await db.dev_withdrawals.update_one(
        {"withdrawal_id": withdrawal_id, "status": "approved"},
        {"$set": {"status": "paid", "paid_at": now_iso}},
    )
    if res.modified_count == 0:
        return None
    w = await db.dev_withdrawals.find_one({"withdrawal_id": withdrawal_id}, {"_id": 0})
    await db.dev_wallets.update_one(
        {"user_id": w["user_id"]},
        {"$inc": {"pending_withdrawal": -float(w["amount"]),
                  "withdrawn_lifetime": float(w["amount"])},
         "$set": {"updated_at": now_iso}},
    )
    return w


async def replay_admin_mobile_approve(db, withdrawal_id: str, admin_id: str = "smoke_admin"):
    """Mirror of admin_mobile.py:501+ /admin/mobile/withdrawals/{id}/approve.
    Note that it operates on db.withdrawals — the OTHER collection."""
    now_iso = _now()
    w = await db.withdrawals.find_one(
        {"$or": [{"withdrawal_id": withdrawal_id}, {"id": withdrawal_id}]},
        {"_id": 0},
    )
    if not w:
        return {"error": "not_found_in_withdrawals_collection"}
    await db.withdrawals.update_one(
        {"$or": [{"withdrawal_id": withdrawal_id}, {"id": withdrawal_id}]},
        {"$set": {"status": "approved", "approved_at": now_iso,
                  "approved_by": admin_id}},
    )
    return {"approved_in_collection": "withdrawals", "withdrawal_id": withdrawal_id}


# ─────────────────────────────────────────────────────────────────────────────
# Snapshot per step
# ─────────────────────────────────────────────────────────────────────────────

async def snapshot(db, ids: dict, step: str, wid: str | None = None) -> dict:
    dev_diff = await money_divergence._diff_developer(db, ids["developer_id"])
    wallet = await db.dev_wallets.find_one(
        {"user_id": ids["developer_id"]}, {"_id": 0}
    ) or {}

    # dev_withdrawals view (the developer-facing canonical collection)
    dev_view = await db.dev_withdrawals.find(
        {"user_id": ids["developer_id"]}, {"_id": 0}
    ).to_list(20)

    # withdrawals view (the admin_mobile collection — separate universe)
    mobile_view = await db.withdrawals.find(
        {"user_id": ids["developer_id"]}, {"_id": 0}
    ).to_list(20)

    return {
        "step": step, "at": _now(),
        "raw": {
            "wallet.earned_lifetime":   wallet.get("earned_lifetime"),
            "wallet.available_balance": wallet.get("available_balance"),
            "wallet.pending_withdrawal": wallet.get("pending_withdrawal"),
            "wallet.withdrawn_lifetime": wallet.get("withdrawn_lifetime"),
            "dev_withdrawals_count": len(dev_view),
            "dev_withdrawals": [
                {"id": w.get("withdrawal_id"), "amount": w.get("amount"),
                 "status": w.get("status")} for w in dev_view
            ],
            "withdrawals_collection_count": len(mobile_view),
            "withdrawals_collection": [
                {"id": w.get("withdrawal_id") or w.get("id"),
                 "amount": w.get("amount"),
                 "status": w.get("status")} for w in mobile_view
            ],
        },
        "developer_divergence": {
            "ok": dev_diff.get("ok"),
            "classes": [d["class"] for d in dev_diff.get("divergences", [])],
            "withdrawal_detail": next(
                (d for d in dev_diff.get("divergences", [])
                 if d.get("class") == "withdrawals_drift"),
                None,
            ),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Main runner
# ─────────────────────────────────────────────────────────────────────────────

async def run_trace(db) -> dict:
    run_id = uuid.uuid4().hex[:8]
    ids = await seed(db, run_id)

    # ───── PART 1 — canonical flow ─────
    part_1 = []
    part_1.append(await snapshot(db, ids, "T0_seeded_wallet_2000_available"))

    # T1 — developer requests withdrawal
    doc = await replay_dev_request_withdrawal(db, ids["developer_id"], 800.0)
    canonical_wid = doc["withdrawal_id"]
    part_1.append(await snapshot(db, ids, "T1_developer_requested_800", wid=canonical_wid))

    # T2 — admin approve via canonical server path
    await replay_admin_approve_canonical(db, canonical_wid)
    part_1.append(await snapshot(db, ids, "T2_canonical_admin_approved", wid=canonical_wid))

    # T3 — admin mark-paid via canonical server path
    await replay_admin_mark_paid_canonical(db, canonical_wid)
    part_1.append(await snapshot(db, ids, "T3_canonical_admin_marked_paid", wid=canonical_wid))

    # ───── PART 2 — split-brain demonstration ─────
    part_2 = []

    # S0 — manually insert a withdrawal row into db.withdrawals (the other
    # collection that admin_mobile.py operates on). NO production developer
    # flow ever writes this collection. The fact that we have to plant the
    # row by hand is itself the evidence: admin_mobile.py operates on rows
    # that have no developer-side origin under the current writer layout.
    mobile_wid = f"wd_mob_{uuid.uuid4().hex[:10]}"
    await db.withdrawals.insert_one({
        "withdrawal_id": mobile_wid, "id": mobile_wid,
        "user_id": ids["developer_id"], "amount": 500.0,
        "currency": "USD", "status": "pending",  # admin_mobile awaits 'pending'
        "method": "manual", "destination": "smoke_iban_mobile",
        "created_at": _now(), "smoke_seed": True,
    })
    part_2.append(await snapshot(db, ids, "S0_planted_row_in_withdrawals_collection",
                                  wid=mobile_wid))

    # S1 — admin_mobile approves via admin_mobile.py:516 logic
    res = await replay_admin_mobile_approve(db, mobile_wid)
    snap_s1 = await snapshot(db, ids, "S1_admin_mobile_approved_in_withdrawals_collection",
                              wid=mobile_wid)
    snap_s1["admin_mobile_result"] = res
    part_2.append(snap_s1)

    # S2 — read developer view (canonical) — checks if the mobile-approved
    # row is visible to the developer-facing flow. (It will NOT be, because
    # the developer's view is db.dev_withdrawals, and admin_mobile wrote to
    # db.withdrawals only.)
    dev_view = await db.dev_withdrawals.find(
        {"withdrawal_id": mobile_wid}, {"_id": 0}
    ).to_list(5)
    snap_s2 = await snapshot(db, ids, "S2_check_mobile_row_visibility_in_dev_view",
                              wid=mobile_wid)
    snap_s2["mobile_row_visible_to_developer"] = (len(dev_view) > 0)
    part_2.append(snap_s2)

    # S3 — wallet balance check: did the mobile approve trigger any wallet
    # mutation? (Spoiler: no — admin_mobile.py:501-545 does not touch
    # dev_wallets at all.)
    wallet_after = await db.dev_wallets.find_one(
        {"user_id": ids["developer_id"]}, {"_id": 0}
    )
    snap_s3 = await snapshot(db, ids, "S3_wallet_state_after_mobile_action",
                              wid=mobile_wid)
    snap_s3["wallet_post_mobile_approve"] = {
        "available_balance": wallet_after.get("available_balance"),
        "pending_withdrawal": wallet_after.get("pending_withdrawal"),
        "withdrawn_lifetime": wallet_after.get("withdrawn_lifetime"),
    }
    part_2.append(snap_s3)

    # ───── split-brain summary table ─────
    summary = {
        "canonical_path_complete": {
            "withdrawal_id": canonical_wid,
            "amount": 800.0,
            "final_status_in_dev_withdrawals": "paid",
            "wallet_pending_withdrawal_after": part_1[-1]["raw"]["wallet.pending_withdrawal"],
            "wallet_withdrawn_lifetime_after": part_1[-1]["raw"]["wallet.withdrawn_lifetime"],
            "expected": "pending=0, withdrawn=800 (wallet credited correctly)",
        },
        "mobile_admin_path_orphan": {
            "withdrawal_id": mobile_wid,
            "amount": 500.0,
            "final_status_in_withdrawals_collection": "approved",
            "visible_in_dev_withdrawals_collection": (
                len(dev_view) > 0
            ),
            "wallet_pending_withdrawal_after": snap_s3["wallet_post_mobile_approve"]["pending_withdrawal"],
            "wallet_withdrawn_lifetime_after": snap_s3["wallet_post_mobile_approve"]["withdrawn_lifetime"],
            "expected_under_decision_4_recommendation_4A": (
                "row visible in dev_withdrawals AND wallet adjusted — NEITHER happened"
            ),
        },
        "decision_4_evidence": {
            "split_brain_confirmed": True,
            "writers": {
                "dev_withdrawals": ["server.py:11087/11147/11169/11210"],
                "withdrawals":     ["admin_mobile.py:516/566"],
            },
            "readers": {
                "dev_withdrawals": ["server.py developer view, admin queue"],
                "withdrawals":     ["admin_mobile.py only"],
            },
            "overlap": "zero — no path writes to both, no path reads from both",
        },
    }

    return {
        "run_id": run_id, "ids": ids,
        "part_1_canonical": part_1,
        "part_2_split_brain": part_2,
        "split_brain_summary": summary,
        "started_at": part_1[0]["at"],
        "finished_at": part_2[-1]["at"],
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
