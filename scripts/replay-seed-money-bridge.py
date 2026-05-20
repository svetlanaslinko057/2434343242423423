#!/usr/bin/env python3
"""
Phase 2C-B4.0.1 — refactored ledger-first deterministic bootstrap.

History
-------
- 2C-B2.5 origin: this script READ legacy `dev_wallets` rows, normalised
  their shape, then drove MoneyService to record canonical entries.
  It depended on the boot-time legacy `dev_wallets` seeding done by
  `server.py:seed_dev_pool`.

- 2C-B4.0 removed the destructive boot wipe + made the legacy insert
  idempotent. Pool wallets stopped being destroyed on every boot, but
  the legacy insert still happened on fresh DB.

- 2C-B4.0.1 (this version): the boot path no longer inserts legacy
  `dev_wallets` rows at all. Canonical pool seed runs through
  MoneyService inline in `seed_dev_pool` (actor=`b4_0_1_pool_seed`).
  This script no longer reads legacy as a source of truth. It owns the
  HARDCODED constant table of pool dev seeding amounts, looks up each
  dev's `user_id` by stable email, and:

      1. Replays the canonical chain (hold_escrow → release_escrow →
         process_payout) — idempotent across runs via deterministic
         idempotency keys AND a durable ledger pre-check.
      2. OPTIONALLY materialises the legacy `dev_wallets` mirror so
         the projection-compare histogram can converge to
         `{matches: 6, mock_orphan: 1}`. The mirror is a read model
         derived from canonical; this script is the SINGLE writer to
         legacy `dev_wallets` for pool devs after B4.0.1.

Constraints honoured
--------------------
- The orphan canary (mock_seed.py `_fixture=mock_seed_orphan_canary_v1`)
  remains untouched — it is a deliberate C-class diagnostic fixture.
- No new B-class synthetic-balance writers are introduced. Canonical
  side runs through MoneyService only.
- Idempotent: re-running is a strict no-op at the ledger level
  (durable check) and at the legacy level (state-equality check).

Usage
-----
    python3 /app/scripts/replay-seed-money-bridge.py             # full replay
    python3 /app/scripts/replay-seed-money-bridge.py --dry-run   # preview
    python3 /app/scripts/replay-seed-money-bridge.py --no-legacy-mirror   # canonical only

Outputs
-------
    /app/audit/seed_money_bridge_replay.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "backend"))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


# ─────────────────────────────────────────────────────────────────────────
# HARDCODED POOL SEED TABLE (must stay in sync with server.py:_dev_pool)
# ─────────────────────────────────────────────────────────────────────────
# Source of truth for synthetic pool balances. Boot uses these same
# numbers (via `_dev_pool[*].earned`); we duplicate them here so the
# script remains self-contained and does NOT read legacy `dev_wallets`.
POOL_SEED: list[dict] = [
    {"email": "alice.kim@atlas.dev",   "earned": 8400.0},
    {"email": "marco.rossi@atlas.dev", "earned": 7100.0},
    {"email": "priya.shah@atlas.dev",  "earned": 5600.0},
    {"email": "luka.horvat@atlas.dev", "earned": 4200.0},
    {"email": "sara.chen@atlas.dev",   "earned": 2400.0},
    {"email": "diego.silva@atlas.dev", "earned": 9800.0},
]
PAID_RATIO = 0.85  # legacy parity with server.py seed_dev_pool


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_cents(dollars: Any) -> int:
    try:
        return int(round(float(dollars or 0) * 100))
    except (TypeError, ValueError):
        return 0


async def _build_money_service(db):
    """Same wiring as `money_bridge.init_money_service` — kept inline so
    the script does not depend on the running FastAPI process."""
    from infrastructure.db.repositories.money import MoneyRepository
    from domains.money import MoneyService
    from shared.events import get_event_bus

    repo = MoneyRepository(db)
    try:
        await repo.ensure_indexes()
    except Exception:  # noqa: BLE001 — index race with running backend is OK
        pass
    return MoneyService(ledger=repo, events=get_event_bus())


async def _ledger_already_has_pool_entries(db, dev_id: str) -> bool:
    """True if the canonical ledger already carries pool-seed entries for
    this dev. Pool seed entries are produced either by
    `server.py:seed_dev_pool` (actor=`b4_0_1_pool_seed`) or by an
    earlier replay (actor=`seed_bridge_replay`)."""
    doc = await db.money_ledger_events.find_one(
        {
            "actor": {"$in": ["b4_0_1_pool_seed", "seed_bridge_replay"]},
            "account_id": {"$in": [f"ac_dev:{dev_id}", f"ac_ext:{dev_id}"]},
        },
        {"_id": 0, "account_id": 1, "actor": 1},
    )
    return doc is not None


async def _replay_canonical(svc, db, dev_id: str, email: str,
                            earned_cents: int, paid_cents: int,
                            dry_run: bool) -> dict:
    """Drive the canonical chain for one dev. Idempotent via ledger
    pre-check + deterministic idempotency keys."""
    from domains.money.models import Money

    plan = {
        "developer_id": dev_id,
        "email": email,
        "earned_cents": earned_cents,
        "paid_cents": paid_cents,
        "legs": ["hold_escrow", "release_escrow"]
                + (["process_payout"] if paid_cents > 0 else []),
        "applied": False,
        "skipped_reason": None,
    }
    if dry_run:
        return plan

    if await _ledger_already_has_pool_entries(db, dev_id):
        plan["skipped_reason"] = "ledger already has pool entries"
        return plan

    project_id = f"b4_0_1_pool_seed_{email}"
    amount = Money(earned_cents, "USD")
    await svc.hold_escrow(
        project_id=project_id,
        amount=amount,
        client_id="pool_seed_client",
        actor="seed_bridge_replay",
        idempotency_key=f"b4_0_1_pool_seed:{email}:hold",
        memo="B4.0.1 replay — canonical pool seed",
    )
    await svc.release_escrow(
        project_id=project_id,
        amount=amount,
        developer_id=dev_id,
        actor="seed_bridge_replay",
        fee_cents=0,
        idempotency_key=f"b4_0_1_pool_seed:{email}:release",
        memo="B4.0.1 replay — release pool earned",
    )
    if paid_cents > 0:
        await svc.process_payout(
            developer_id=dev_id,
            amount=Money(paid_cents, "USD"),
            actor="seed_bridge_replay",
            payout_batch_id=f"b4_0_1_pool_seed_{email}",
            external_ref="b4_0_1_pool_seed_synthetic",
            idempotency_key=f"b4_0_1_pool_seed:{email}:payout",
        )
    plan["applied"] = True
    return plan


async def _materialise_legacy_mirror(db, dev_id: str, earned: float,
                                     paid: float) -> dict:
    """Write a legacy `dev_wallets` row that mirrors the canonical state.

    Idempotent: only writes if the existing legacy fields differ from
    the canonical projection. Always preserves `created_at` if present.
    Returns the {field: applied_value} dict for audit.
    """
    target = {
        "available_balance": round(earned - paid, 2),
        "withdrawn_lifetime": round(paid, 2),
        "pending_withdrawal": 0.0,
        "earned_lifetime": round(earned, 2),
        "paid_lifetime": round(paid, 2),  # for backwards-compat readers
        "updated_at": _now_iso(),
        "_mirror_source": "b4_0_1_replay",
    }
    existing = await db.dev_wallets.find_one(
        {"user_id": dev_id},
        {"_id": 0, "available_balance": 1, "withdrawn_lifetime": 1, "earned_lifetime": 1},
    )
    if existing and (
        abs((existing.get("available_balance") or 0) - target["available_balance"]) < 0.01
        and abs((existing.get("withdrawn_lifetime") or 0) - target["withdrawn_lifetime"]) < 0.01
        and abs((existing.get("earned_lifetime") or 0) - target["earned_lifetime"]) < 0.01
    ):
        return {"action": "no-op", "applied": False}
    await db.dev_wallets.update_one(
        {"user_id": dev_id},
        {"$set": target, "$setOnInsert": {"user_id": dev_id, "created_at": _now_iso()}},
        upsert=True,
    )
    return {"action": "mirror_written", "applied": True, "fields": target}


async def _main(args) -> int:
    from motor.motor_asyncio import AsyncIOMotorClient

    client = AsyncIOMotorClient(args.mongo_url)
    db = client[args.db_name]
    svc = await _build_money_service(db)

    summary: list[dict] = []
    canonical_applied = 0
    canonical_already_done = 0
    legacy_mirror_written = 0
    legacy_mirror_noop = 0
    missing_user = 0

    # Pool entries
    for seed in POOL_SEED:
        email = seed["email"]
        earned = float(seed["earned"])
        paid = round(earned * PAID_RATIO, 2)
        earned_cents = _to_cents(earned)
        paid_cents = _to_cents(paid)

        user = await db.users.find_one({"email": email}, {"_id": 0, "user_id": 1})
        if not user:
            summary.append({"email": email, "skipped": "user not in db"})
            missing_user += 1
            continue
        dev_id = user["user_id"]

        plan = await _replay_canonical(
            svc, db, dev_id, email, earned_cents, paid_cents, args.dry_run
        )
        entry = {"email": email, "developer_id": dev_id, "canonical": plan}
        if plan["applied"]:
            canonical_applied += 1
        elif plan["skipped_reason"]:
            canonical_already_done += 1

        if not args.no_legacy_mirror and not args.dry_run:
            mirror = await _materialise_legacy_mirror(db, dev_id, earned, paid)
            entry["legacy_mirror"] = mirror
            if mirror["applied"]:
                legacy_mirror_written += 1
            else:
                legacy_mirror_noop += 1
        elif args.no_legacy_mirror:
            entry["legacy_mirror"] = {"action": "disabled-by-flag"}

        summary.append(entry)
        print(
            f"  • {email} → {dev_id}  "
            f"earned={earned_cents}¢ paid={paid_cents}¢  "
            f"canonical={'APPLIED' if plan['applied'] else 'NO-OP'}  "
            f"mirror={entry.get('legacy_mirror', {}).get('action', 'skip')}"
        )

    # Orphan canary preservation (count, do not touch)
    orphan_count = await db.dev_wallets.count_documents(
        {"_fixture": "mock_seed_orphan_canary_v1"}
    )
    # Legacy orphan rows from pre-B4.0.1 builds (no _fixture tag) — match
    # by absence of paid_lifetime AND presence of withdrawn_lifetime.
    legacy_orphan_count = await db.dev_wallets.count_documents(
        {
            "_fixture": {"$exists": False},
            "user_id": {"$nin": [s["email"] for s in POOL_SEED]},
            "withdrawn_lifetime": {"$gt": 0},
            "paid_lifetime": {"$exists": False},
        }
    )

    client.close()

    artefact: dict[str, Any] = {
        "phase": "2C-B4.0.1",
        "ran_at": _now_iso(),
        "dry_run": args.dry_run,
        "no_legacy_mirror": args.no_legacy_mirror,
        "totals": {
            "canonical_applied": canonical_applied,
            "canonical_already_done": canonical_already_done,
            "legacy_mirror_written": legacy_mirror_written,
            "legacy_mirror_noop": legacy_mirror_noop,
            "orphan_canary_preserved": orphan_count,
            "legacy_orphan_legacy_format_preserved": legacy_orphan_count,
            "missing_user": missing_user,
        },
        "summary": summary,
    }
    os.makedirs(os.path.dirname(args.json_out), exist_ok=True)
    with open(args.json_out, "w", encoding="utf-8") as f:
        json.dump(artefact, f, indent=2, sort_keys=True, default=str)
    print(f"✓ wrote artefact → {args.json_out}")

    print(
        f"\nreplay done: canonical_applied={canonical_applied} "
        f"canonical_already_done={canonical_already_done} "
        f"legacy_mirror_written={legacy_mirror_written} "
        f"legacy_mirror_noop={legacy_mirror_noop} "
        f"orphan_canary={orphan_count} "
        f"missing_user={missing_user}"
    )
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dry-run", action="store_true",
                   help="preview only — no writes")
    p.add_argument("--no-legacy-mirror", action="store_true",
                   help="skip the legacy `dev_wallets` mirror write "
                        "(canonical chain only)")
    p.add_argument("--mongo-url",
                   default=os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    p.add_argument("--db-name",
                   default=os.environ.get("DB_NAME", "test_database"))
    p.add_argument("--json-out",
                   default="/app/audit/seed_money_bridge_replay.json")
    args = p.parse_args()
    try:
        return asyncio.run(_main(args))
    except Exception as e:  # noqa: BLE001
        print(f"ERROR: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
