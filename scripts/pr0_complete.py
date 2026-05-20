#!/usr/bin/env python3
"""
PR-0 completion run — finishes from the bounded-failure point.

Pre-existing state on entry (verified by `pr0_execute.py` run #1):
  - backfill source_path on dev_earning_log: DONE (6 rows)
  - dev_earning_log unique (module_id, source_path): DONE
  - escrow_payouts unique payout_id: PRE-EXISTING (index name `payout_id_1`,
    spec {'key': [('payout_id', 1)], 'unique': True}) — invariant already
    in place before PR-0 started. NOT a "catch-and-continue" — this is
    a discovered convergence point (analogous to §C of the addendum).
  - payouts unique payout_id: NOT DONE — this script finishes it.

Per signed PR-0 constraints, this script is allowed only because:
  - it does NOT delete duplicates
  - it does NOT merge rows
  - it does NOT wrap in retry / catch-and-continue
  - it does NOT modify smoke artefacts or baseline hashes
  - it explicitly asserts the pre-existing escrow_payouts unique constraint
    rather than silently relying on it
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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def capture_state(db, label: str) -> dict:
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
        state["collections"][coll] = await db[coll].count_documents({})
        idx = await db[coll].index_information()
        # Now also record uniqueness flag
        state["indexes"][coll] = {
            name: {
                "key": spec.get("key"),
                "unique": spec.get("unique", False),
            }
            for name, spec in idx.items()
        }

    state["source_path_presence"] = {
        "with":    await db.dev_earning_log.count_documents({"source_path": {"$exists": True}}),
        "without": await db.dev_earning_log.count_documents({"source_path": {"$exists": False}}),
    }
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
    state["blast_radius"] = await money_divergence.blast_radius(db)
    return state


async def assert_or_create_unique_index(db, coll: str, key, intended_name: str) -> dict:
    """Idempotent unique-index installer.

    If an index with the same key spec already exists and is already unique,
    declare invariant met and return WITHOUT mutation. If it exists but is
    NOT unique, FAIL HARD (this script does not delete data; auto-drop is
    forbidden per signed constraints).

    Returns {action, status, ...}. status in {'created', 'preexisting_ok',
    'FAILED_NON_UNIQUE', 'FAILED_OTHER'}.
    """
    if isinstance(key, str):
        key_list = [(key, 1)]
    else:
        key_list = list(key)

    existing = await db[coll].index_information()
    for name, spec in existing.items():
        spec_key = list(spec.get("key") or [])
        if spec_key == key_list:
            if spec.get("unique"):
                return {
                    "step": "index",
                    "collection": coll,
                    "key": key_list,
                    "intended_name": intended_name,
                    "existing_name": name,
                    "status": "preexisting_ok",
                    "note": "convergence point — unique constraint already in place",
                }
            else:
                return {
                    "step": "index",
                    "collection": coll,
                    "key": key_list,
                    "existing_name": name,
                    "status": "FAILED_NON_UNIQUE",
                    "note": "existing index on this key is NOT unique; cannot auto-drop per PR-0 constraints. Manual rollback + decision required.",
                }

    # No existing index on this key — create it.
    try:
        name = await db[coll].create_index(key_list, unique=True, name=intended_name)
        return {
            "step": "index",
            "collection": coll,
            "key": key_list,
            "name": name,
            "status": "created",
        }
    except Exception as e:
        return {
            "step": "index",
            "collection": coll,
            "key": key_list,
            "status": "FAILED_OTHER",
            "error": str(e),
        }


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "test_database")]

    print(f"[{_now()}] PR-0 completion run")
    print()

    print("--- Re-asserting all 3 unique-index invariants (idempotent) ---")
    actions = []
    actions.append(await assert_or_create_unique_index(
        db, "dev_earning_log",
        [("module_id", 1), ("source_path", 1)],
        "dev_earning_log_module_source_unique",
    ))
    actions.append(await assert_or_create_unique_index(
        db, "escrow_payouts", "payout_id", "escrow_payouts_payout_id_unique",
    ))
    actions.append(await assert_or_create_unique_index(
        db, "payouts", "payout_id", "payouts_payout_id_unique",
    ))

    failed = [a for a in actions if a["status"].startswith("FAILED")]
    for a in actions:
        print(f"  {a}")
    print()

    if failed:
        print("PR-0 BLOCKED — at least one invariant could not be asserted.")
        sys.exit(2)

    # Compose post-flight state
    print("--- Post-flight state capture ---")
    post = await capture_state(db, "post")
    with (OUT_DIR / "state_post.json").open("w") as f:
        json.dump(post, f, indent=2, default=str)
    print(f"  saved: {OUT_DIR / 'state_post.json'}")
    print(f"  collections: {post['collections']}")
    print(f"  source_path_presence: {post['source_path_presence']}")
    print(f"  duplicates_post: {post['duplicates']}")
    print()

    print("--- Topology comparison vs state_pre.json ---")
    with (OUT_DIR / "state_pre.json").open() as f:
        pre = json.load(f)

    diff = {"equal": True, "differences": []}

    # collection counts
    for c in pre["collections"]:
        if pre["collections"][c] != post["collections"].get(c):
            diff["equal"] = False
            diff["differences"].append({"axis": "count", "collection": c,
                                         "pre": pre["collections"][c],
                                         "post": post["collections"].get(c)})

    # balances
    for kind in ["dev_wallets", "users_legacy"]:
        for uid, v in pre["balances"][kind].items():
            if v != post["balances"][kind].get(uid):
                diff["equal"] = False
                diff["differences"].append({"axis": "balance", "kind": kind,
                                             "user_id": uid, "pre": v,
                                             "post": post["balances"][kind].get(uid)})

    # blast_radius metrics
    pre_m = (pre.get("blast_radius") or {}).get("metrics") or {}
    post_m = (post.get("blast_radius") or {}).get("metrics") or {}
    for metric in set(pre_m.keys()) | set(post_m.keys()):
        a, b = pre_m.get(metric), post_m.get(metric)
        # Compare deeply, excluding incidental ordering
        if json.dumps(a, sort_keys=True, default=str) != json.dumps(b, sort_keys=True, default=str):
            diff["equal"] = False
            diff["differences"].append({"axis": "blast_radius_metric",
                                         "metric": metric, "pre": a, "post": b})

    # source_path completeness
    expected_with = pre["source_path_presence"]["with"] + pre["source_path_presence"]["without"]
    if post["source_path_presence"]["with"] != expected_with:
        diff["equal"] = False
        diff["differences"].append({"axis": "backfill_completeness",
                                     "expected": expected_with,
                                     "actual": post["source_path_presence"]["with"]})

    with (OUT_DIR / "topology_diff.json").open("w") as f:
        json.dump(diff, f, indent=2, default=str)
    print(f"  saved: {OUT_DIR / 'topology_diff.json'}")
    print(f"  equal: {diff['equal']}")
    for d in diff["differences"]:
        print(f"  DIFFERENCE: {d}")
    print()

    print("=" * 70)
    if diff["equal"]:
        print("PR-0 TOPOLOGY INVARIANT: HOLDS.")
        print("Provisional acceptance: granted.")
        print("Next: re-run 3 smoke traces to validate detector class distribution.")
    else:
        print("PR-0 BLOCKED — topology changed. Per §E.5, ROLLBACK and investigate.")
        sys.exit(3)


if __name__ == "__main__":
    asyncio.run(main())
