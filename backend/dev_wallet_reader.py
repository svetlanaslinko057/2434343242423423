"""
Phase 2C-B3 — developer wallet read facade (dual-read switch).

Purpose
-------
Every user-facing read of a developer's wallet (UI, payout eligibility,
dashboard tiles) flows through `read_dev_wallet()`. The facade reads
BOTH the canonical projection (`dev_wallets_projection`) AND the legacy
collection (`dev_wallets`), compares them on every call, logs structured
warnings when they disagree, and returns whichever source the operator
has selected via the `MONEY_READS_FROM_PROJECTION` feature flag.

Stage rollout — implemented by THIS file
----------------------------------------
    Stage A  (default)  flag=false  →  return legacy, log on mismatch
    Stage B             flag=true   →  return projection, log on mismatch
    Stage C             flag=true   →  same as B, divergence engine keeps
                                       reading legacy directly (for the
                                       compare/divergence endpoints).

Critical invariants this file MUST uphold
-----------------------------------------
    1. PROJECTION NEVER MUTATES STATE.  This file does not write to
       `dev_wallets_projection`. The shadow rebuild runs through
       `/api/admin/money/projections/dev-wallets/rebuild` only.
    2. LEGACY WRITES UNTOUCHED.  This file does not write to
       `dev_wallets`. The 11 grandfathered legacy writers stay.
    3. NEITHER MoneyService NOR money_projections IS MODIFIED.  The
       facade is a thin read-only adapter.
    4. The OUTPUT SHAPE matches the legacy `dev_wallets` document
       (float dollars, fields: `user_id`, `available_balance`,
       `earned_lifetime`, `withdrawn_lifetime`, `pending_withdrawal`),
       so call-sites can be migrated without touching their consumers.

Flag wiring
-----------
Read at every call (NOT cached) so an operator can flip a config map
without restarting the backend. Reading an env var on every call is
cheap (~µs) and worth the rollout safety.

Mismatch logging
----------------
Mismatches are logged as a single structured WARN line tagged
`event=dev_wallet_read.mismatch` with: `user_id`, `field`,
`legacy_cents`, `projection_cents`, `delta_cents`, and the
classification from `money_projections.compare_dev_wallet_projection`.
The `mock_orphan` developer is EXPECTED to mismatch and is logged at
INFO (not WARN) so it does not pollute the alarm channel.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import money_projections as _projections


log = logging.getLogger(__name__)


PROJECTION_FLAG_ENV = "MONEY_READS_FROM_PROJECTION"

# Schema the facade always returns, regardless of source. Matches what
# every existing legacy reader expects (float dollars).
WALLET_FIELDS = (
    "user_id",
    "available_balance",
    "earned_lifetime",
    "withdrawn_lifetime",
    "pending_withdrawal",
)


def _flag_on() -> bool:
    """`True` when the operator has flipped the cutover flag to Stage B.
    Read on every call so config changes apply without a restart."""
    return os.environ.get(PROJECTION_FLAG_ENV, "false").strip().lower() in (
        "1", "true", "yes", "on",
    )


def _cents_to_dollars(c: int | None) -> float:
    return round((int(c) if c is not None else 0) / 100.0, 2)


# ── Shape adapters ─────────────────────────────────────────────────────────
def _projection_to_legacy_shape(projection: dict, legacy: dict) -> dict:
    """Translate the cents-based projection into the float-dollar
    `dev_wallets` document shape every caller already expects.

    `pending_withdrawal` is NOT in the ledger; we fall back to the
    legacy value (or 0 if no legacy doc). This keeps the projection
    a passive read-model and avoids forcing pending into the ledger.
    """
    return {
        "user_id": projection["user_id"],
        "available_balance": _cents_to_dollars(
            projection.get("available_balance_cents")
        ),
        "earned_lifetime": _cents_to_dollars(
            projection.get("earned_lifetime_cents")
        ),
        "withdrawn_lifetime": _cents_to_dollars(
            projection.get("withdrawn_lifetime_cents")
        ),
        "pending_withdrawal": round(
            float(legacy.get("pending_withdrawal") or 0), 2
        ),
        # Forensic-only fields. UI consumers ignore them, but they keep
        # the response trail traceable through the dual-read window.
        "_read_source": "projection",
        "_accrual_pending_cents": projection.get("accrual_pending_cents"),
    }


def _legacy_normalised(legacy: dict, user_id: str) -> dict:
    """Return the legacy doc in canonical schema with `_read_source`
    tagged. Missing-doc case returns zeros (same as the original
    `find_one(...) or {default}` fallback at every call-site)."""
    if not legacy:
        return {
            "user_id": user_id,
            "available_balance": 0.0,
            "earned_lifetime": 0.0,
            "withdrawn_lifetime": 0.0,
            "pending_withdrawal": 0.0,
            "_read_source": "legacy_missing",
        }
    out: dict[str, Any] = {"_read_source": "legacy"}
    for f in WALLET_FIELDS:
        if f == "user_id":
            out[f] = legacy.get("user_id") or user_id
        else:
            out[f] = round(float(legacy.get(f) or 0), 2)
    return out


# ── The facade ─────────────────────────────────────────────────────────────
async def read_dev_wallet(db, user_id: str) -> dict[str, Any]:
    """Single canonical entry-point for "what's in this dev's wallet?".

    Always performs the dual-read and the compare so the divergence
    signal flows whether or not the cutover flag is on. Returns either
    legacy (Stage A) or projection (Stage B) depending on the flag.

    NEVER raises on projection failure — if the projection read fails
    for any reason, the facade falls back to legacy and logs the error.
    A bad projection must not break the UI.
    """
    legacy = (
        await db.dev_wallets.find_one({"user_id": user_id}, {"_id": 0})
        or {}
    )

    projection: dict[str, Any] | None = None
    classification = "skipped"
    try:
        comparison = await _projections.compare_dev_wallet_projection(
            db, user_id
        )
        projection = comparison.get("projection") or {}
        classification = comparison.get("classification") or "unknown"
        _log_compare(user_id, comparison)
    except Exception as e:  # noqa: BLE001 — projection must NEVER break UI reads
        log.warning(
            "event=dev_wallet_read.projection_error user_id=%s err=%r "
            "→ falling back to legacy", user_id, e,
        )
        projection = None

    use_projection = _flag_on() and projection is not None
    if use_projection:
        out = _projection_to_legacy_shape(projection, legacy)
    else:
        out = _legacy_normalised(legacy, user_id)

    # Forensic: which stage we are in for THIS read.
    out["_stage"] = "projection_primary" if _flag_on() else "legacy_primary"
    out["_classification"] = classification
    return out


def _log_compare(user_id: str, comparison: dict[str, Any]) -> None:
    """Emit a structured WARN for every legacy↔projection mismatch.

    Two classifications represent KNOWN demo/seed divergence patterns
    where the canonical ledger has nothing to compare against:
      • `mock_orphan` — legacy claims a payout the ledger never recorded
        (the Phase 2C-D seeded orphan).
      • `legacy_only` — legacy doc exists, ledger has zero activity for
        this dev (other demo/seed-only wallets that pre-date the bridge).

    Both are operationally expected and must NOT page the on-call. They
    are logged at INFO so the divergence trail is still searchable.
    Anything else (`diverged`, `ledger_only`, …) wakes operations up.
    """
    classification = comparison.get("classification") or "unknown"
    diff = comparison.get("diff_cents") or {}
    nonzero = {k: v for k, v in diff.items() if int(v or 0) != 0}

    if not nonzero:
        # Either `matches` or both sides empty — nothing to report.
        return

    msg = (
        f"event=dev_wallet_read.mismatch user_id={user_id} "
        f"classification={classification} diff_cents={nonzero}"
    )
    if classification in ("mock_orphan", "legacy_only"):
        log.info(msg)
    else:
        log.warning(msg)
