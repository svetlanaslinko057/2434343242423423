"""
Phase 2C-B1 — Developer wallet projection (shadow).

This module derives the canonical developer wallet state purely from the
`money_ledger_events` collection and writes it to a SEPARATE projection
collection `dev_wallets_projection`. It DOES NOT touch the legacy
`dev_wallets` collection.

Why a shadow projection (not a switch)
---------------------------------------
After Phase 2C-D replay/backfill the ledger contains the full historical
truth for release_leg ($0 diff) and earnings_leg ($0 diff). The payout_leg
still carries the known mock-seed orphan ($3,750 legacy without source).

Before flipping any UI reader from `dev_wallets` to a ledger-derived
balance, we have to demonstrate that the projection itself is:
  • repeatable (same ledger → same numbers)
  • idempotent (re-build = no-op for unchanged developers)
  • complete (every developer with any ledger activity OR a legacy wallet
    appears in the projection)
  • honest (the orphan diff stays visible — we do not mask it by silently
    copying from legacy)

Once the shadow projection passes a multi-day observation against
`dev_wallets` and the comparison diff is well-understood, the next step
(Phase 2C-B3) will swap the read path; only after THAT is stable does
2C-B4 remove legacy writes. This file delivers 2C-B1 only.

Source-of-truth accounts (per developer `<dev>`)
-------------------------------------------------
    ac_dev:<dev>      developer wallet balance
                      (+ escrow_release, - payout)
    ac_accrual:<dev>  earnings accrual axis (per-task, post-QA)
                      (+ task_earning_accrued, - task_earning_reversed)
    ac_ext:<dev>      external outbound mirror (per process_payout credit)

Projection mapping (integer cents — no float arithmetic)
--------------------------------------------------------
    available_balance_cents = balance(ac_dev)
    withdrawn_lifetime_cents = balance(ac_ext)
    earned_lifetime_cents = balance(ac_dev) + balance(ac_ext)
                             # everything that ever landed in the wallet
                             # (active balance + already-paid-out)
    accrual_pending_cents = balance(ac_accrual)

The legacy `dev_wallets.pending_withdrawal` does NOT have a ledger source
(in-flight payout state is not a confirmed event). The projection records
it as `null` so callers can distinguish "unknown" from "zero".

Public API
----------
    build_dev_wallet_projection(db, developer_id) -> dict
        Pure read. Returns the projection dict computed from the ledger.

    rebuild_all_dev_wallet_projections(db, dry_run=True, limit=None) -> dict
        Discover every developer with ledger activity OR a legacy wallet,
        compute their projection, and (if not dry_run) upsert into
        `dev_wallets_projection`. Idempotent. Writes a watermark.

    compare_dev_wallet_projection(db, developer_id) -> dict
        Returns legacy vs projection deltas for one developer + a
        classification (`matches`, `legacy_only`, `ledger_only`,
        `mock_orphan`, `diverged`).

This module is the SINGLE writer for `dev_wallets_projection`. Nothing
else writes to it; legacy `dev_wallets` writes are untouched and remain in
their existing files (server.py, escrow_layer.py, …).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

log = logging.getLogger(__name__)

# Collections owned by this module
PROJECTION_COLL = "dev_wallets_projection"
WATERMARK_COLL = "dev_wallet_projection_watermarks"

# Ledger collection we READ from (single source of truth for cents).
LEDGER_COLL = "money_ledger_events"

# Account prefixes — kept here as string constants to avoid importing
# `domains.money.models` (which would couple the projection to the domain
# layer; projection is a passive read-model and should depend only on
# the persisted prefix names already in the ledger).
PREFIX_DEV = "ac_dev"
PREFIX_ACCRUAL = "ac_accrual"
PREFIX_EXT = "ac_ext"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Account balance helpers ────────────────────────────────────────────────
async def _balance_cents(db, account_id: str, currency: str = "USD") -> int:
    """Sum delta_cents on a single account. Mirrors
    `MoneyRepository.balance` but does NOT depend on the repo singleton
    being initialised — projection must work even if the bridge is down."""
    pipeline = [
        {"$match": {"account_id": account_id, "currency": currency}},
        {"$group": {"_id": None, "total": {"$sum": "$delta_cents"}}},
    ]
    async for row in db[LEDGER_COLL].aggregate(pipeline):
        return int(row.get("total") or 0)
    return 0


async def _last_ledger_activity(db, developer_id: str) -> Optional[str]:
    """Most recent occurred_at across the three developer accounts.
    Returns ISO string or None if developer has no ledger activity."""
    accounts = [
        f"{PREFIX_DEV}:{developer_id}",
        f"{PREFIX_ACCRUAL}:{developer_id}",
        f"{PREFIX_EXT}:{developer_id}",
    ]
    doc = await db[LEDGER_COLL].find_one(
        {"account_id": {"$in": accounts}},
        sort=[("occurred_at", -1)],
        projection={"_id": 0, "occurred_at": 1},
    )
    if not doc:
        return None
    raw = doc.get("occurred_at")
    if isinstance(raw, datetime):
        return raw.isoformat()
    return str(raw) if raw else None


# ── Public: build single projection ────────────────────────────────────────
async def build_dev_wallet_projection(
    db, developer_id: str, *, currency: str = "USD"
) -> dict[str, Any]:
    """Compute the ledger-derived wallet state for one developer.

    Pure read. Does NOT write anywhere — callers that want persistence go
    through `rebuild_all_dev_wallet_projections` or hit the admin endpoint.
    """
    dev_acct = f"{PREFIX_DEV}:{developer_id}"
    accr_acct = f"{PREFIX_ACCRUAL}:{developer_id}"
    ext_acct = f"{PREFIX_EXT}:{developer_id}"

    available = await _balance_cents(db, dev_acct, currency=currency)
    withdrawn = await _balance_cents(db, ext_acct, currency=currency)
    accrual = await _balance_cents(db, accr_acct, currency=currency)
    earned = available + withdrawn  # everything that ever credited ac_dev
    last_activity = await _last_ledger_activity(db, developer_id)

    return {
        "user_id": developer_id,
        "currency": currency,
        "available_balance_cents": int(available),
        "withdrawn_lifetime_cents": int(withdrawn),
        "earned_lifetime_cents": int(earned),
        "accrual_pending_cents": int(accrual),
        # Pending withdrawal is in-flight (not yet on the ledger), so the
        # projection cannot derive it. `null` signals "unknown", distinct
        # from a confirmed zero.
        "pending_withdrawal_cents": None,
        "last_ledger_activity_at": last_activity,
        "source": "ledger",
        "ledger_accounts": {
            "wallet": dev_acct,
            "accrual": accr_acct,
            "external": ext_acct,
        },
        "computed_at": _now_iso(),
    }


# ── Discovery: who needs a projection? ─────────────────────────────────────
async def _discover_developer_ids(db) -> list[str]:
    """Union of:
      1. distinct dev IDs appearing on `ac_dev:<id>` / `ac_accrual:<id>` /
         `ac_ext:<id>` in the canonical ledger.
      2. user_ids in the legacy `dev_wallets` collection (so the comparison
         endpoint can still see legacy-only orphans).
    """
    ids: set[str] = set()

    # From ledger account_ids
    cursor = db[LEDGER_COLL].aggregate([
        {"$match": {"account_id": {
            "$regex": rf"^({PREFIX_DEV}|{PREFIX_ACCRUAL}|{PREFIX_EXT}):"
        }}},
        {"$group": {"_id": "$account_id"}},
    ])
    async for row in cursor:
        acct = row.get("_id") or ""
        if ":" in acct:
            ids.add(acct.split(":", 1)[1])

    # From legacy dev_wallets (read-only)
    async for w in db.dev_wallets.find({}, {"_id": 0, "user_id": 1}):
        uid = w.get("user_id")
        if uid:
            ids.add(uid)

    return sorted(ids)


# ── Public: rebuild all ────────────────────────────────────────────────────
async def rebuild_all_dev_wallet_projections(
    db, *, dry_run: bool = True, limit: Optional[int] = None,
    currency: str = "USD",
) -> dict[str, Any]:
    """Compute projections for every known developer.

    `dry_run=True` (the default) returns the would-be projection rows
    without writing anything. Even the watermark is tagged `dry_run` so
    operators can tell a preview from a real rebuild.

    `dry_run=False` upserts each projection into `dev_wallets_projection`
    keyed by `user_id`. Idempotent: re-running with no ledger changes is a
    no-op at the document-content level (Mongo will rewrite the doc but the
    values are identical and downstream watchers can compare on
    `last_ledger_activity_at`).
    """
    counts = {
        "discovered": 0,
        "computed": 0,
        "written": 0,
        "unchanged": 0,
        "errors": 0,
    }

    dev_ids = await _discover_developer_ids(db)
    counts["discovered"] = len(dev_ids)
    if limit:
        dev_ids = dev_ids[: int(limit)]

    state = "dry_run" if dry_run else "running"
    await db[WATERMARK_COLL].update_one(
        {"key": "rebuild_all"},
        {"$set": {
            "key": "rebuild_all",
            "state": state,
            "started_at": _now_iso(),
            "discovered": counts["discovered"],
        }},
        upsert=True,
    )

    rows: list[dict[str, Any]] = []
    for dev_id in dev_ids:
        try:
            proj = await build_dev_wallet_projection(
                db, dev_id, currency=currency
            )
            counts["computed"] += 1
            rows.append(proj)
            if dry_run:
                continue

            # Idempotency check: if the existing document is byte-equal on
            # the cents fields AND on `last_ledger_activity_at`, skip the
            # write so we don't churn `updated_at` for unchanged rows.
            existing = await db[PROJECTION_COLL].find_one(
                {"user_id": dev_id},
                {
                    "_id": 0,
                    "available_balance_cents": 1,
                    "withdrawn_lifetime_cents": 1,
                    "earned_lifetime_cents": 1,
                    "accrual_pending_cents": 1,
                    "last_ledger_activity_at": 1,
                },
            )
            unchanged = bool(
                existing
                and existing.get("available_balance_cents") == proj["available_balance_cents"]
                and existing.get("withdrawn_lifetime_cents") == proj["withdrawn_lifetime_cents"]
                and existing.get("earned_lifetime_cents") == proj["earned_lifetime_cents"]
                and existing.get("accrual_pending_cents") == proj["accrual_pending_cents"]
                and existing.get("last_ledger_activity_at") == proj["last_ledger_activity_at"]
            )
            if unchanged:
                counts["unchanged"] += 1
                continue

            await db[PROJECTION_COLL].update_one(
                {"user_id": dev_id},
                {"$set": {**proj, "updated_at": _now_iso()}},
                upsert=True,
            )
            counts["written"] += 1
        except Exception as e:  # noqa: BLE001 — projection MUST be best-effort
            counts["errors"] += 1
            log.warning(
                f"money_projections.rebuild failed dev={dev_id}: {e}"
            )

    final_state = "dry_run" if dry_run else "completed"
    await db[WATERMARK_COLL].update_one(
        {"key": "rebuild_all"},
        {"$set": {
            "key": "rebuild_all",
            "state": final_state,
            "last_run_at": _now_iso(),
            "counts": counts,
            "currency": currency,
        }},
        upsert=True,
    )

    result: dict[str, Any] = {
        "dry_run": dry_run,
        "currency": currency,
        "counts": counts,
        "state": final_state,
    }
    # Only return the projection rows themselves when dry-running — a real
    # rebuild against thousands of developers should not echo the whole
    # set back over the wire. Caller paginates via the GET endpoint.
    if dry_run:
        result["projections"] = rows
    return result


# ── Public: legacy vs projection comparison ────────────────────────────────
async def compare_dev_wallet_projection(
    db, developer_id: str, *, currency: str = "USD"
) -> dict[str, Any]:
    """Return the diff between legacy `dev_wallets` and the ledger-derived
    projection for one developer. Read-only on both sides.

    Classification:
        matches       — every cents field equal within 1 cent
        legacy_only   — legacy has a wallet, ledger has zero activity
        ledger_only   — ledger has activity, legacy doc is missing
        mock_orphan   — legacy.withdrawn_lifetime > 0 but ac_ext is empty
                        (the known Phase 2C-D payout_leg orphan)
        diverged      — neither of the above; admin should investigate
    """
    projection = await build_dev_wallet_projection(
        db, developer_id, currency=currency
    )
    legacy = await db.dev_wallets.find_one(
        {"user_id": developer_id}, {"_id": 0}
    ) or {}

    # Legacy stores DOLLARS as floats. Convert to cents (round half-to-even)
    # using the same convention as `money_bridge._to_cents`.
    def _l_cents(field: str) -> int:
        v = legacy.get(field)
        if v is None:
            return 0
        try:
            return int(round(float(v) * 100))
        except (TypeError, ValueError):
            return 0

    legacy_available = _l_cents("available_balance")
    legacy_earned = _l_cents("earned_lifetime")
    legacy_withdrawn = _l_cents("withdrawn_lifetime")
    legacy_pending = _l_cents("pending_withdrawal")

    diff_available = legacy_available - projection["available_balance_cents"]
    diff_earned = legacy_earned - projection["earned_lifetime_cents"]
    diff_withdrawn = legacy_withdrawn - projection["withdrawn_lifetime_cents"]

    ledger_total_activity = (
        projection["available_balance_cents"]
        + projection["withdrawn_lifetime_cents"]
        + projection["accrual_pending_cents"]
    )

    if not legacy and ledger_total_activity == 0:
        classification = "neither"
    elif not legacy and ledger_total_activity != 0:
        classification = "ledger_only"
    elif (
        projection["withdrawn_lifetime_cents"] == 0
        and legacy_withdrawn > 0
        and projection["available_balance_cents"] == 0
    ):
        # The mock-seed payout orphan: legacy says paid-out, ledger has
        # no payout history (no source escrow_release before bridge). Match
        # this BEFORE the generic legacy_only branch so the diagnostic is
        # specific rather than just "no ledger row".
        classification = "mock_orphan"
    elif legacy and ledger_total_activity == 0:
        classification = "legacy_only"
    elif (
        abs(diff_available) <= 1
        and abs(diff_earned) <= 1
        and abs(diff_withdrawn) <= 1
    ):
        classification = "matches"
    elif (
        projection["withdrawn_lifetime_cents"] == 0
        and legacy_withdrawn > 0
        and abs(diff_available) <= 1
    ):
        # Mixed orphan: legacy + small ledger trace from later activity.
        classification = "mock_orphan"
    else:
        classification = "diverged"

    return {
        "user_id": developer_id,
        "currency": currency,
        "classification": classification,
        "legacy": {
            "available_balance_cents": legacy_available,
            "earned_lifetime_cents": legacy_earned,
            "withdrawn_lifetime_cents": legacy_withdrawn,
            "pending_withdrawal_cents": legacy_pending,
            "present": bool(legacy),
        },
        "projection": projection,
        "diff_cents": {
            "available_balance": diff_available,
            "earned_lifetime": diff_earned,
            "withdrawn_lifetime": diff_withdrawn,
        },
        "computed_at": _now_iso(),
    }


# ── Public: snapshot read for admin UI ─────────────────────────────────────
async def list_dev_wallet_projections(
    db, *, limit: int = 100, skip: int = 0
) -> dict[str, Any]:
    """Paginated read of the stored projection. Sorted by
    `last_ledger_activity_at` desc so the most-active developers come
    first. Returns `count` so the UI can paginate."""
    total = await db[PROJECTION_COLL].count_documents({})
    rows = await (
        db[PROJECTION_COLL]
        .find({}, {"_id": 0})
        .sort("last_ledger_activity_at", -1)
        .skip(max(0, int(skip)))
        .limit(min(500, max(1, int(limit))))
        .to_list(limit)
    )
    watermark = await db[WATERMARK_COLL].find_one(
        {"key": "rebuild_all"}, {"_id": 0}
    )
    return {
        "count": total,
        "limit": limit,
        "skip": skip,
        "projections": rows,
        "watermark": watermark,
    }
