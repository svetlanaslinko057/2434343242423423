#!/usr/bin/env python3
"""
PR-0 Constraint Enforcement Layer — execution script.

Operating under signed Decisions 1=D, 2=E, 4=A and the PR-0 execution
contract in /app/audit/MONEY_WRITER_INVENTORY_ADDENDUM_2026-05-14.md §D, §E.

ALLOWED:
    - create indexes
    - backfill source_path="approve_module" only where field absent
    - DuplicateKeyError surfacing

FORBIDDEN:
    - deleting duplicates
    - merging rows
    - retry wrappers
    - catch-and-continue
    - auto-heal migrations
    - topology-changing writes
    - detector suppression

ACCEPTANCE:
    duplicates can no longer become invisible
    AND
    topology(post) == topology(pre)
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # type: ignore
load_dotenv("/app/backend/.env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
import money_divergence  # noqa: E402

OUT_DIR = Path("/app/audit/pr0_artefacts")
OUT_DIR.mkdir(parents=True, exist_ok=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def capture_state(db, label: str) -> dict:
    """Read-only snapshot of all relevant collections + blast_radius."""
    state = {
        "label": label,
        "captured_at": _now(),
        "collections": {},
        "indexes": {},
        "duplicates": {},
        "balances": {},
        "blast_radius": None,
    }
    for coll in [
        "dev_earning_log", "escrow_payouts", "payouts", "earnings",
        "dev_wallets", "escrows", "dev_withdrawals", "withdrawals",
        "money_ledger_events", "invoices", "task_earnings", "users",
    ]:
        cnt = await db[coll].count_documents({})
        idx = await db[coll].index_information()
        state["collections"][coll] = cnt
        state["indexes"][coll] = sorted(idx.keys())

    # source_path presence on dev_earning_log
    state["source_path_presence"] = {
        "with":    await db.dev_earning_log.count_documents({"source_path": {"$exists": True}}),
        "without": await db.dev_earning_log.count_documents({"source_path": {"$exists": False}}),
    }

    # duplicate scans on planned-unique keys
    state["duplicates"]["dev_earning_log_by_module_id"] = len(
        await db.dev_earning_log.aggregate([
            {"$group": {"_id": "$module_id", "n": {"$sum": 1}}},
            {"$match": {"n": {"$gt": 1}}},
        ]).to_list(1000)
    )
    state["duplicates"]["dev_earning_log_by_module_source"] = len(
        await db.dev_earning_log.aggregate([
            {"$group": {"_id": {"m": "$module_id", "s": "$source_path"}, "n": {"$sum": 1}}},
            {"$match": {"n": {"$gt": 1}}},
        ]).to_list(1000)
    )
    state["duplicates"]["escrow_payouts_by_payout_id"] = len(
        await db.escrow_payouts.aggregate([
            {"$group": {"_id": "$payout_id", "n": {"$sum": 1}}},
            {"$match": {"n": {"$gt": 1}}},
        ]).to_list(1000)
    )
    state["duplicates"]["payouts_by_payout_id"] = len(
        await db.payouts.aggregate([
            {"$group": {"_id": "$payout_id", "n": {"$sum": 1}}},
            {"$match": {"n": {"$gt": 1}}},
        ]).to_list(1000)
    )

    # canonical balances on every user — frozen comparison axis
    wallets = await db.dev_wallets.find({}, {"_id": 0}).to_list(10000)
    state["balances"]["dev_wallets"] = {
        w["user_id"]: {
            "available_balance":    w.get("available_balance", 0),
            "pending_withdrawal":   w.get("pending_withdrawal", 0),
            "earned_lifetime":      w.get("earned_lifetime", 0),
            "withdrawn_lifetime":   w.get("withdrawn_lifetime", 0),
        }
        for w in wallets
    }
    users_legacy = await db.users.find(
        {"total_earnings": {"$exists": True}},
        {"_id": 0, "user_id": 1, "total_earnings": 1, "escrow_earnings": 1},
    ).to_list(10000)
    state["balances"]["users_legacy"] = {
        u["user_id"]: {
            "total_earnings":   u.get("total_earnings", 0),
            "escrow_earnings":  u.get("escrow_earnings", 0),
        }
        for u in users_legacy
    }

    # blast_radius — the canonical PR-0 invariant
    try:
        state["blast_radius"] = await money_divergence.blast_radius(db)
    except Exception as e:
        state["blast_radius"] = {"error": str(e)}

    return state


async def execute_pr0(db) -> dict:
    """The ONLY mutating actions in this script. Strictly within allowlist."""
    actions = []

    # ─────────────────────────────────────────────────────────────────────
    # Step 1: backfill source_path on dev_earning_log (idempotent — only
    # where field absent). Default value "approve_module" matches the
    # historical single trigger Path A.
    # ─────────────────────────────────────────────────────────────────────
    backfill_result = await db.dev_earning_log.update_many(
        {"source_path": {"$exists": False}},
        {"$set": {"source_path": "approve_module"}},
    )
    actions.append({
        "step": "backfill_source_path",
        "collection": "dev_earning_log",
        "filter": {"source_path": {"$exists": False}},
        "set": {"source_path": "approve_module"},
        "matched": backfill_result.matched_count,
        "modified": backfill_result.modified_count,
    })

    # ─────────────────────────────────────────────────────────────────────
    # Step 2: create unique indexes. ANY failure = stop + surface, no
    # delete-on-duplicate. If you see DuplicateKeyError, do NOT touch
    # data; that's a rollback signal per §E.5.
    # ─────────────────────────────────────────────────────────────────────
    try:
        idx_name = await db.dev_earning_log.create_index(
            [("module_id", 1), ("source_path", 1)],
            unique=True,
            name="dev_earning_log_module_source_unique",
        )
        actions.append({"step": "index", "collection": "dev_earning_log",
                        "key": [("module_id", 1), ("source_path", 1)],
                        "unique": True, "name": idx_name, "status": "ok"})
    except Exception as e:
        actions.append({"step": "index", "collection": "dev_earning_log",
                        "status": "FAILED", "error": str(e)})
        return {"actions": actions, "status": "FAILED_AT_DEV_EARNING_LOG_INDEX"}

    try:
        # escrow_payouts already has a non-unique payout_id_1. Need to
        # drop and recreate as unique. This is the only index drop in PR-0.
        existing = await db.escrow_payouts.index_information()
        if "payout_id_1" in existing and not existing["payout_id_1"].get("unique"):
            await db.escrow_payouts.drop_index("payout_id_1")
            actions.append({"step": "drop_legacy_index", "collection": "escrow_payouts",
                            "name": "payout_id_1", "reason": "non-unique → recreate as unique"})
        idx_name = await db.escrow_payouts.create_index(
            "payout_id", unique=True, name="escrow_payouts_payout_id_unique",
        )
        actions.append({"step": "index", "collection": "escrow_payouts",
                        "key": "payout_id", "unique": True, "name": idx_name, "status": "ok"})
    except Exception as e:
        actions.append({"step": "index", "collection": "escrow_payouts",
                        "status": "FAILED", "error": str(e)})
        return {"actions": actions, "status": "FAILED_AT_ESCROW_PAYOUTS_INDEX"}

    try:
        idx_name = await db.payouts.create_index(
            "payout_id", unique=True, name="payouts_payout_id_unique",
        )
        actions.append({"step": "index", "collection": "payouts",
                        "key": "payout_id", "unique": True, "name": idx_name, "status": "ok"})
    except Exception as e:
        actions.append({"step": "index", "collection": "payouts",
                        "status": "FAILED", "error": str(e)})
        return {"actions": actions, "status": "FAILED_AT_PAYOUTS_INDEX"}

    return {"actions": actions, "status": "ok"}


def compare_states(pre: dict, post: dict) -> dict:
    """Topology equation evaluation per §E.3 of addendum."""
    diff = {"equal": True, "differences": []}

    # E.3.2 — counts(any_collection, post) == counts(any_collection, baseline)
    for c in pre["collections"]:
        if pre["collections"][c] != post["collections"].get(c):
            diff["equal"] = False
            diff["differences"].append({
                "axis": "collection_count", "collection": c,
                "pre": pre["collections"][c], "post": post["collections"].get(c),
            })

    # E.3.4 — balances(any_user, post) == balances(any_user, baseline)
    for kind in ["dev_wallets", "users_legacy"]:
        for uid in pre["balances"][kind]:
            if pre["balances"][kind][uid] != post["balances"][kind].get(uid):
                diff["equal"] = False
                diff["differences"].append({
                    "axis": "balance", "kind": kind, "user_id": uid,
                    "pre": pre["balances"][kind][uid],
                    "post": post["balances"][kind].get(uid),
                })

    # E.3.1 + E.3.5 — blast_radius carrier_mass + detector class distribution
    br_pre = (pre.get("blast_radius") or {}).get("metrics") or {}
    br_post = (post.get("blast_radius") or {}).get("metrics") or {}
    for metric in set(br_pre.keys()) | set(br_post.keys()):
        pv, pv2 = br_pre.get(metric), br_post.get(metric)
        if pv != pv2:
            diff["equal"] = False
            diff["differences"].append({
                "axis": "blast_radius_metric", "metric": metric,
                "pre": pv, "post": pv2,
            })

    # source_path post-backfill must equal pre.with + pre.without
    expected = pre["source_path_presence"]["with"] + pre["source_path_presence"]["without"]
    actual_with = post["source_path_presence"]["with"]
    if actual_with != expected:
        diff["equal"] = False
        diff["differences"].append({
            "axis": "backfill_completeness",
            "expected_with_source_path": expected,
            "actual_with_source_path": actual_with,
        })

    return diff


async def main():
    db = AsyncIOMotorClient(
        os.environ["MONGO_URL"]
    )[os.environ.get("DB_NAME", "test_database")]

    print(f"[{_now()}] PR-0 Constraint Enforcement Layer execution")
    print("Scope: 3 unique indexes + source_path backfill. Application code: UNCHANGED.")
    print()

    print("--- Step A: pre-flight state capture ---")
    pre = await capture_state(db, "pre")
    with (OUT_DIR / "state_pre.json").open("w") as f:
        json.dump(pre, f, indent=2, default=str)
    print(f"  saved: {OUT_DIR / 'state_pre.json'}")
    print(f"  collections: {pre['collections']}")
    print(f"  duplicates: {pre['duplicates']}")
    print(f"  blast_radius.metrics: {(pre['blast_radius'] or {}).get('metrics')}")
    print()

    print("--- Step B: execute PR-0 mutations ---")
    exec_result = await execute_pr0(db)
    with (OUT_DIR / "execution.json").open("w") as f:
        json.dump(exec_result, f, indent=2, default=str)
    print(f"  saved: {OUT_DIR / 'execution.json'}")
    for a in exec_result["actions"]:
        print(f"  {a}")
    print(f"  STATUS: {exec_result['status']}")
    print()

    if exec_result["status"] != "ok":
        print("PR-0 FAILED. Aborting before post-flight. No further mutation attempted.")
        print("Per §E.5: investigate and rollback before retry.")
        sys.exit(2)

    print("--- Step C: post-flight state capture ---")
    post = await capture_state(db, "post")
    with (OUT_DIR / "state_post.json").open("w") as f:
        json.dump(post, f, indent=2, default=str)
    print(f"  saved: {OUT_DIR / 'state_post.json'}")
    print(f"  collections: {post['collections']}")
    print(f"  source_path_presence: {post['source_path_presence']}")
    print(f"  blast_radius.metrics: {(post['blast_radius'] or {}).get('metrics')}")
    print()

    print("--- Step D: topology equation evaluation ---")
    diff = compare_states(pre, post)
    with (OUT_DIR / "topology_diff.json").open("w") as f:
        json.dump(diff, f, indent=2, default=str)
    print(f"  saved: {OUT_DIR / 'topology_diff.json'}")
    print(f"  equal: {diff['equal']}")
    for d in diff["differences"]:
        print(f"  DIFFERENCE: {d}")
    print()

    print("=" * 70)
    if diff["equal"]:
        print("PR-0 PROVISIONAL ACCEPTANCE — topology equation holds.")
        print("Next: re-run 3 smoke traces; compare divergence classes structurally.")
    else:
        print("PR-0 BLOCKED — topology changed. Per §E.5, ROLLBACK and investigate.")
        sys.exit(3)


if __name__ == "__main__":
    asyncio.run(main())
