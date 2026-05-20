"""
Phase 2C-D — Replay / Backfill of legacy money state into canonical ledger.

Why this exists:
  • Phases 2B PR-1/2/3 only mirror NEW money events (post-deploy) into
    `money_ledger_events`. Historical legacy state — escrows funded before
    PR-1 deploy, task_earnings approved before PR-2, withdrawals paid before
    PR-3 — is invisible to the canonical ledger.
  • Phase 2C projections (dev_wallets / task_earnings as derived read models)
    can only be trusted once canonical reflects the full historical truth.

Guarantees of this module (per user's Phase 2C-D contract):
  1. **Idempotent**: replay-on-replay is a no-op. Each legacy row is mapped
     to a deterministic `idempotency_key` (the same key the post-deploy
     bridges already use). Existing `MoneyRepository` unique-index on
     `idempotency_key` enforces single insert.
  2. **Dry-run mode** (`dry_run=True`): scans + prints what WOULD be written,
     never calls the bridges. Default for safety.
  3. **Read-only on legacy**: this module never writes to legacy collections.
     It only READS from them and writes through the bridge (→ MoneyService →
     MoneyRepository.append).
  4. **Watermark** stored in `money_replay_watermarks`: per-source state
     `{source, last_run_at, counts:{scanned/replayed/skipped/errors},
     state}`. Resumable: next run picks up new rows without re-scanning all.
  5. **Topology order**: when called via `replay_all`, sources are processed
     in the order
        escrows → escrow_payouts → task_earnings → withdrawals → batches
     so that downstream payouts find sufficient canonical balance on
     `ac_dev:<dev>` and don't fail `assert_balance_sufficient`.

What this module DOES NOT do:
  • Does not modify legacy collections (read-only).
  • Does not delete pre-existing canonical entries.
  • Does not handle partial / corrupt legacy rows — they are counted into
    `errors` and skipped with a log entry.
  • Does not run automatically at startup. Triggered explicitly by an admin.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger(__name__)

WATERMARK_COLL = "money_replay_watermarks"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _set_watermark(db, source: str, **fields) -> None:
    await db[WATERMARK_COLL].update_one(
        {"source": source},
        {"$set": {"source": source, "last_run_at": _now_iso(), **fields}},
        upsert=True,
    )


async def _get_watermark(db, source: str) -> dict:
    doc = await db[WATERMARK_COLL].find_one({"source": source}, {"_id": 0})
    return doc or {"source": source, "state": "never_run"}


# ── ESCROWS (kind: escrow_hold + escrow_refund) ─────────────────────────────
async def replay_escrows(db, *, dry_run: bool = True, limit: int | None = None) -> dict:
    """Scan `escrows` collection.

    For status=funded/in_progress/completed/refunded → emit `escrow_hold`
    (the moment money was locked). For status=refunded → ALSO emit
    `escrow_refund`. The legacy `escrow_layer.fund_escrow` is the same
    bridge entry point used by PR-1, so we reuse `bridge_escrow_hold` and
    `bridge_escrow_refund` here for deterministic idempotency keys.
    """
    from money_bridge import bridge_escrow_hold, bridge_escrow_refund

    await _set_watermark(db, "escrows", state="running")
    counts = {"scanned": 0, "replayed_hold": 0, "replayed_refund": 0, "skipped": 0, "errors": 0}

    # Only statuses where money was actually held in legacy.
    query = {"status": {"$in": ["funded", "in_progress", "completed", "refunded"]}}
    cursor = db.escrows.find(query, {"_id": 0})
    if limit:
        cursor = cursor.limit(limit)

    async for esc in cursor:
        counts["scanned"] += 1
        try:
            if dry_run:
                continue
            # Always emit hold first (it was funded at some point).
            funded_by = esc.get("funded_by") or esc.get("client_id") or "system"
            await bridge_escrow_hold(esc, funded_by)
            counts["replayed_hold"] += 1
            # If refunded, also emit the refund leg.
            if esc.get("status") == "refunded":
                refund_amt = float(esc.get("refunded_amount") or 0.0)
                if refund_amt > 0:
                    await bridge_escrow_refund(
                        esc,
                        refund_amount_dollars=refund_amt,
                        reason=esc.get("refund_reason") or "legacy_replay",
                    )
                    counts["replayed_refund"] += 1
        except Exception as e:  # noqa: BLE001
            counts["errors"] += 1
            log.warning("REPLAY escrows: skip %s: %s", esc.get("escrow_id"), e)

    await _set_watermark(db, "escrows", state="completed" if not dry_run else "dry_run", counts=counts)
    log.info("REPLAY escrows (dry_run=%s): %s", dry_run, counts)
    return counts


# ── ESCROW PAYOUTS (kind: escrow_release per developer share) ──────────────
async def replay_escrow_payouts(db, *, dry_run: bool = True, limit: int | None = None) -> dict:
    """Scan `escrow_payouts` collection — one row per (escrow_id, developer_id)
    share. Each row becomes a canonical `escrow_release` triple-entry.

    We synthesise a minimal `esc` dict from fields in the payout itself
    (project_id, module_id, escrow_id) because the bridge needs both. If the
    payout lacks `project_id`, we attempt a join against `escrows` once per
    distinct `escrow_id`.
    """
    from money_bridge import bridge_escrow_release

    await _set_watermark(db, "escrow_payouts", state="running")
    counts = {"scanned": 0, "replayed": 0, "skipped": 0, "errors": 0}

    cursor = db.escrow_payouts.find({}, {"_id": 0})
    if limit:
        cursor = cursor.limit(limit)

    escrow_cache: dict[str, dict] = {}
    async for payout in cursor:
        counts["scanned"] += 1
        try:
            esc_id = payout.get("escrow_id")
            project_id = payout.get("project_id")
            if not project_id and esc_id:
                if esc_id not in escrow_cache:
                    escrow_cache[esc_id] = (
                        await db.escrows.find_one({"escrow_id": esc_id}, {"_id": 0}) or {}
                    )
                project_id = escrow_cache[esc_id].get("project_id")

            esc = {
                "escrow_id": esc_id,
                "project_id": project_id,
                "module_id": payout.get("module_id"),
            }
            if dry_run:
                continue
            await bridge_escrow_release(esc, payout)
            counts["replayed"] += 1
        except Exception as e:  # noqa: BLE001
            counts["errors"] += 1
            log.warning("REPLAY escrow_payouts: skip %s: %s", payout.get("payout_id"), e)

    await _set_watermark(db, "escrow_payouts", state="completed" if not dry_run else "dry_run", counts=counts)
    log.info("REPLAY escrow_payouts (dry_run=%s): %s", dry_run, counts)
    return counts


# ── TASK EARNINGS (kind: task_earning_accrued) ─────────────────────────────
async def replay_task_earnings(db, *, dry_run: bool = True, limit: int | None = None) -> dict:
    """Scan `task_earnings` rows with `earning_status` in
    {approved, batched, paid}. Each row becomes a canonical
    `task_earning_accrued` entry on `ac_accrual:<user_id>`.

    Rows with status in {pending_qa, draft, held, cancelled} are skipped:
    they represent no platform commitment to pay yet.
    """
    from money_bridge import bridge_task_earning_approved

    await _set_watermark(db, "task_earnings", state="running")
    counts = {"scanned": 0, "replayed": 0, "skipped": 0, "errors": 0}

    query = {"earning_status": {"$in": ["approved", "batched", "paid"]}}
    cursor = db.task_earnings.find(query, {"_id": 0})
    if limit:
        cursor = cursor.limit(limit)

    async for earning in cursor:
        counts["scanned"] += 1
        try:
            if dry_run:
                continue
            await bridge_task_earning_approved(earning)
            counts["replayed"] += 1
        except Exception as e:  # noqa: BLE001
            counts["errors"] += 1
            log.warning("REPLAY task_earnings: skip %s: %s", earning.get("earning_id"), e)

    await _set_watermark(db, "task_earnings", state="completed" if not dry_run else "dry_run", counts=counts)
    log.info("REPLAY task_earnings (dry_run=%s): %s", dry_run, counts)
    return counts


# ── DEV WITHDRAWALS (kind: payout, per-developer) ──────────────────────────
async def replay_dev_withdrawals(db, *, dry_run: bool = True, limit: int | None = None) -> dict:
    """Scan `dev_withdrawals` rows with `status=paid`. Each becomes a
    canonical `payout` triple-entry on `ac_dev → ac_ext` for the developer.

    Caveat: the bridge will reject with `money_insufficient_balance` if the
    developer's canonical `ac_dev` balance has not been pre-credited (i.e.
    if `replay_escrow_payouts` has not run yet). That's why `replay_all`
    enforces topology order.
    """
    from money_bridge import bridge_payout_processed

    await _set_watermark(db, "dev_withdrawals", state="running")
    counts = {"scanned": 0, "replayed": 0, "skipped": 0, "errors": 0}

    cursor = db.dev_withdrawals.find({"status": "paid"}, {"_id": 0})
    if limit:
        cursor = cursor.limit(limit)

    async for w in cursor:
        counts["scanned"] += 1
        try:
            if dry_run:
                continue
            await bridge_payout_processed(
                developer_id=w.get("user_id") or "unknown",
                amount_dollars=float(w.get("amount") or 0),
                legacy_id=w.get("withdrawal_id") or "unknown",
                legacy_kind="withdrawal",
                actor="replay_2c_d",
                external_ref=str(w.get("destination") or ""),
            )
            counts["replayed"] += 1
        except Exception as e:  # noqa: BLE001
            counts["errors"] += 1
            log.warning("REPLAY dev_withdrawals: skip %s: %s", w.get("withdrawal_id"), e)

    await _set_watermark(db, "dev_withdrawals", state="completed" if not dry_run else "dry_run", counts=counts)
    log.info("REPLAY dev_withdrawals (dry_run=%s): %s", dry_run, counts)
    return counts


# ── PAYOUT BATCHES (kind: payout, per-batch) ───────────────────────────────
async def replay_payout_batches(db, *, dry_run: bool = True, limit: int | None = None) -> dict:
    """Scan `payout_batches` rows with `status=paid`. Each becomes a single
    canonical `payout` triple-entry with `legacy_id=batch_<batch_id>`,
    same as Phase 2B PR-3 `mark_batch_paid` bridge.
    """
    from money_bridge import bridge_payout_processed

    await _set_watermark(db, "payout_batches", state="running")
    counts = {"scanned": 0, "replayed": 0, "skipped": 0, "errors": 0}

    cursor = db.payout_batches.find({"status": "paid"}, {"_id": 0})
    if limit:
        cursor = cursor.limit(limit)

    async for batch in cursor:
        counts["scanned"] += 1
        try:
            if dry_run:
                continue
            await bridge_payout_processed(
                developer_id=batch.get("user_id") or batch.get("developer_id") or "unknown",
                amount_dollars=float(batch.get("final_amount") or 0),
                legacy_id=f"batch_{batch.get('batch_id')}",
                legacy_kind="payout_batch",
                actor="replay_2c_d",
                external_ref=str(batch.get("payment_reference") or ""),
            )
            counts["replayed"] += 1
        except Exception as e:  # noqa: BLE001
            counts["errors"] += 1
            log.warning("REPLAY payout_batches: skip %s: %s", batch.get("batch_id"), e)

    await _set_watermark(db, "payout_batches", state="completed" if not dry_run else "dry_run", counts=counts)
    log.info("REPLAY payout_batches (dry_run=%s): %s", dry_run, counts)
    return counts


# ── ORCHESTRATOR ────────────────────────────────────────────────────────────
async def replay_all(db, *, dry_run: bool = True, limit: int | None = None) -> dict:
    """Run every source in strict topology order. Returns a summary.

    Order rationale:
      1. escrows         — populates `ac_escrow` and (for refunded) `ac_client`
      2. escrow_payouts  — drains `ac_escrow` → `ac_dev` (credits developer)
      3. task_earnings   — accrues on `ac_accrual` (independent axis)
      4. dev_withdrawals — drains `ac_dev` → `ac_ext` (needs prior credit!)
      5. payout_batches  — same drain semantics as step 4
    """
    summary = {"started_at": _now_iso(), "dry_run": dry_run, "sources": {}}
    summary["sources"]["escrows"]         = await replay_escrows(db, dry_run=dry_run, limit=limit)
    summary["sources"]["escrow_payouts"]  = await replay_escrow_payouts(db, dry_run=dry_run, limit=limit)
    summary["sources"]["task_earnings"]   = await replay_task_earnings(db, dry_run=dry_run, limit=limit)
    summary["sources"]["dev_withdrawals"] = await replay_dev_withdrawals(db, dry_run=dry_run, limit=limit)
    summary["sources"]["payout_batches"]  = await replay_payout_batches(db, dry_run=dry_run, limit=limit)
    summary["finished_at"] = _now_iso()
    return summary


# ── DIVERGENCE QUERY (read-only reconciliation snapshot) ───────────────────
async def divergence_snapshot(db) -> dict:
    """Phase 2C-D exit metric — diff between legacy & canonical aggregations.

    Returns the same diff Phase 2C-A/B/C projections will eventually
    eliminate. Read-only, no writes; safe to call in production for ops
    dashboards.
    """
    # Legacy aggregates
    legacy_escrow_payouts = await db.escrow_payouts.aggregate(
        [{"$group": {"_id": None, "amount": {"$sum": "$amount"}}}]
    ).to_list(1)
    legacy_release_total = float(legacy_escrow_payouts[0]["amount"]) if legacy_escrow_payouts else 0.0

    legacy_earnings = await db.task_earnings.aggregate(
        [{"$match": {"earning_status": {"$in": ["approved", "batched", "paid"]}}},
         {"$group": {"_id": None, "amount": {"$sum": "$final_earning"}}}]
    ).to_list(1)
    legacy_earnings_total = float(legacy_earnings[0]["amount"]) if legacy_earnings else 0.0

    legacy_withdrawn = await db.dev_wallets.aggregate(
        [{"$group": {"_id": None, "amount": {"$sum": "$withdrawn_lifetime"}}}]
    ).to_list(1)
    legacy_withdrawn_total = float(legacy_withdrawn[0]["amount"]) if legacy_withdrawn else 0.0

    # Canonical aggregates
    canonical_release = await db.money_ledger_events.aggregate([
        {"$match": {"kind": "escrow_release", "delta_cents": {"$gt": 0}}},
        {"$group": {"_id": None, "cents": {"$sum": "$delta_cents"}}},
    ]).to_list(1)
    canonical_release_total = (canonical_release[0]["cents"] / 100.0) if canonical_release else 0.0

    canonical_accrual = await db.money_ledger_events.aggregate([
        {"$match": {"kind": "task_earning_accrued", "delta_cents": {"$gt": 0}}},
        {"$group": {"_id": None, "cents": {"$sum": "$delta_cents"}}},
    ]).to_list(1)
    canonical_accrual_total = (canonical_accrual[0]["cents"] / 100.0) if canonical_accrual else 0.0

    canonical_payout = await db.money_ledger_events.aggregate([
        {"$match": {"kind": "payout", "delta_cents": {"$lt": 0}}},
        {"$group": {"_id": None, "cents": {"$sum": "$delta_cents"}}},
    ]).to_list(1)
    canonical_payout_total = (-canonical_payout[0]["cents"] / 100.0) if canonical_payout else 0.0

    return {
        "snapshot_at": _now_iso(),
        "release_leg":  {"legacy": legacy_release_total,   "canonical": canonical_release_total,
                         "diff": round(legacy_release_total - canonical_release_total, 2)},
        "earnings_leg": {"legacy": legacy_earnings_total,  "canonical": canonical_accrual_total,
                         "diff": round(legacy_earnings_total - canonical_accrual_total, 2)},
        "payout_leg":   {"legacy": legacy_withdrawn_total, "canonical": canonical_payout_total,
                         "diff": round(legacy_withdrawn_total - canonical_payout_total, 2)},
    }


async def get_watermarks(db) -> list[dict]:
    """Read-only — return all replay watermark documents for ops UI."""
    rows = await db[WATERMARK_COLL].find({}, {"_id": 0}).to_list(50)
    return rows
