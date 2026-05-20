"""
Stage 7A — Money Divergence Detector
=====================================

Implements §9 Step 2 of MONEY_AUTHORITY_CHARTER.md, under the Decision 1
signed result (Option D: split authority by financial meaning).

This module is **read-only**. It performs NO writes, fires NO chains,
queues NO repairs. Its only job: surface where financial truths disagree,
classify each disagreement, and explain it.

Authority map (per Charter §6.1, Option D):

    Domain                    Canonical                  Audit
    ─────────────────────────  ────────────────────────  ─────────────────
    Developer payable          dev_wallets               money_ledger_events
                               (backed by dev_earning_log)
    Client billing             invoices                  money_ledger_events
    Locked-funds lifecycle     escrows                   escrow_payouts +
                                                          money_ledger_events
    Payout intent              payout_batches +          money_ledger_events
                               dev_withdrawals
    Frozen (pending Decision 2): payouts, earnings, task_earnings

Divergence classes (per row):

    ok                       — all values agree within ±$0.01
    escrow_missing           — invoice paid > 0 but no escrow for module
    escrow_unfunded          — escrow exists, status=pending, locked=0
                                 (legitimate transient unless invoice paid)
    wallet_not_credited      — escrow released > 0 BUT dev_earning_log = 0
    escrow_payouts_orphan    — escrow_payouts.sum > 0 BUT dev_earning_log = 0
                                 (the parallel-write divergence from S-1)
    release_mismatch         — escrow.released_amount != Σ escrow_payouts
    legacy_drift             — users.total_earnings != dev_wallets.earned_lifetime
    payouts_root_orphan      — payouts (root).amount written without
                                 dev_earning_log row
    earnings_root_orphan     — earnings (root).final_earning without
                                 dev_earning_log row
    ledger_missing           — canonical mutation present, no ledger event
    double_credit_suspected  — dev_earning_log.amount > 1.5× client_price
                                 OR wallet > expected by > 50%

Output shape (per module row):

    {
      "module_id": "mod_...",
      "project_id": "proj_...",
      "client_price": 4300.0,
      "domains": {
        "invoice":  {"paid_sum": 4300.0, "count": 1, "status_breakdown": {...}},
        "escrow":   {"total": 4300.0, "locked": 4300.0, "released": 4300.0,
                     "status": "completed", "exists": True},
        "wallet":   {"credited_sum": 4300.0, "log_entries": 1,
                     "developers": [{"developer_id": "...", "amount": 4300}]},
        "audit":    {"escrow_payouts_sum": 4300.0, "escrow_payouts_count": 1,
                     "ledger_events_count": 3,
                     "ledger_event_types": ["invoice_paid", "escrow_funded",
                                            "earning_approved"]}
      },
      "divergences": [
        {"class": "ledger_missing", "severity": "info",
         "delta": 0.0, "explanation": "..."}
      ],
      "ok": True
    }

Endpoints (admin-only, all read):

    GET /api/admin/money/divergence/overview
        Aggregate counts per divergence class. Single-call dashboard pulse.

    GET /api/admin/money/divergence/modules?limit=50&skip=0&class=...
        Paginated per-module rows. Optional filter by divergence class.

    GET /api/admin/money/divergence/module/{module_id}
        Full diff for one module (drill-down).

    GET /api/admin/money/divergence/developers?limit=50&skip=0
        Per-developer rows (dev_wallets vs dev_earning_log vs escrow_payouts
        vs legacy users.total_earnings vs payouts/earnings root sums).

    GET /api/admin/money/divergence/developer/{developer_id}
        Full diff for one developer (drill-down).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

logger = logging.getLogger("money_divergence")

# ─── Tolerance for "equal enough". Money math uses cents — round to 2dp
# everywhere, then ±$0.01 is the noise floor.
EPS = 0.01

router = APIRouter(tags=["money-divergence"])

# Bound at wire() time.
_db = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _eq(a: float, b: float) -> bool:
    return abs(round(float(a or 0), 2) - round(float(b or 0), 2)) <= EPS


def _r(x: Any) -> float:
    """Safe round to 2dp."""
    return round(float(x or 0), 2)


# ─────────────────────────────────────────────────────────────────────────────
# Per-module diff
# ─────────────────────────────────────────────────────────────────────────────

async def _module_universe(db) -> list[str]:
    """All module_ids that have ANY money activity anywhere. Union across
    all carriers. Pure read."""
    ids: set[str] = set()

    async for m in db.modules.find(
        {"$or": [
            {"client_price": {"$gt": 0}},
            {"escrow_id": {"$exists": True}},
            {"status": {"$in": ["done", "in_progress", "awaiting_funding"]}},
        ]},
        {"_id": 0, "module_id": 1},
    ):
        if m.get("module_id"):
            ids.add(m["module_id"])

    async for r in db.invoices.find({"module_id": {"$exists": True}}, {"_id": 0, "module_id": 1}):
        if r.get("module_id"):
            ids.add(r["module_id"])

    async for r in db.escrows.find({}, {"_id": 0, "module_id": 1}):
        if r.get("module_id"):
            ids.add(r["module_id"])

    async for r in db.dev_earning_log.find({"module_id": {"$exists": True}}, {"_id": 0, "module_id": 1}):
        if r.get("module_id"):
            ids.add(r["module_id"])

    async for r in db.escrow_payouts.find({}, {"_id": 0, "module_id": 1}):
        if r.get("module_id"):
            ids.add(r["module_id"])

    return sorted(ids)


async def _diff_module(db, module_id: str) -> dict:
    """Compute the full multi-domain diff for one module. Pure read."""
    module = await db.modules.find_one(
        {"module_id": module_id}, {"_id": 0}
    ) or {}
    client_price = _r(module.get("client_price") or module.get("price") or 0)
    project_id = module.get("project_id")

    # ── Domain: invoices
    inv_paid_sum = 0.0
    inv_total_sum = 0.0
    inv_count = 0
    inv_status_breakdown: dict[str, int] = {}
    async for inv in db.invoices.find(
        {"module_id": module_id}, {"_id": 0, "amount": 1, "status": 1}
    ):
        inv_count += 1
        amt = _r(inv.get("amount"))
        inv_total_sum += amt
        st = inv.get("status") or "unknown"
        inv_status_breakdown[st] = inv_status_breakdown.get(st, 0) + 1
        if st == "paid":
            inv_paid_sum += amt

    # ── Domain: escrows
    esc = await db.escrows.find_one(
        {"module_id": module_id, "status": {"$ne": "refunded"}},
        {"_id": 0},
    )
    esc_exists = esc is not None
    esc_total = _r(esc.get("total_amount") if esc else 0)
    esc_locked = _r(esc.get("locked_amount") if esc else 0)
    esc_released = _r(esc.get("released_amount") if esc else 0)
    esc_refunded = _r(esc.get("refunded_amount") if esc else 0)
    esc_status = (esc or {}).get("status")

    # ── Audit: escrow_payouts (per-release immutable records)
    esc_payouts_sum = 0.0
    esc_payouts_count = 0
    esc_payouts_devs: dict[str, float] = {}
    async for p in db.escrow_payouts.find(
        {"module_id": module_id}, {"_id": 0, "amount": 1, "developer_id": 1}
    ):
        esc_payouts_count += 1
        amt = _r(p.get("amount"))
        esc_payouts_sum += amt
        dev = p.get("developer_id") or "?"
        esc_payouts_devs[dev] = _r(esc_payouts_devs.get(dev, 0) + amt)

    # ── Domain: dev_wallets (via dev_earning_log — canonical journal)
    wallet_credited_sum = 0.0
    wallet_log_entries = 0
    wallet_per_dev: list[dict] = []
    per_dev_credits: dict[str, dict] = {}
    async for el in db.dev_earning_log.find(
        {"module_id": module_id},
        {"_id": 0, "amount": 1, "user_id": 1, "tier": 1, "rate": 1, "module_price": 1},
    ):
        wallet_log_entries += 1
        amt = _r(el.get("amount"))
        wallet_credited_sum += amt
        uid = el.get("user_id") or "?"
        bucket = per_dev_credits.setdefault(
            uid,
            {
                "developer_id": uid,
                "amount": 0.0,
                "tier": el.get("tier"),
                "rate": el.get("rate"),
            },
        )
        bucket["amount"] = _r(bucket["amount"] + amt)
    wallet_per_dev = list(per_dev_credits.values())

    # ── Frozen: payouts (root)
    payouts_root_sum = 0.0
    payouts_root_count = 0
    async for p in db.payouts.find(
        {"module_id": module_id}, {"_id": 0, "amount": 1}
    ):
        payouts_root_count += 1
        payouts_root_sum += _r(p.get("amount"))

    # ── Frozen: earnings (root) (linked by module_id if available)
    earnings_root_sum = 0.0
    earnings_root_count = 0
    async for e in db.earnings.find(
        {"module_id": module_id}, {"_id": 0, "final_earning": 1, "amount": 1}
    ):
        earnings_root_count += 1
        # `earnings` rows use both `final_earning` and `amount` historically
        earnings_root_sum += _r(e.get("final_earning") or e.get("amount"))

    # ── Audit: money_ledger_events
    ledger_events = await db.money_ledger_events.find(
        {"entity_id": module_id},
        {"_id": 0, "event_type": 1, "amount": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(100)
    ledger_event_types = sorted({e.get("event_type") for e in ledger_events if e.get("event_type")})

    # Also gather invoice-keyed ledger events for the linked invoice ids
    inv_ids = [i async for i in (
        async_iter_field(db.invoices.find({"module_id": module_id}, {"_id": 0, "invoice_id": 1}), "invoice_id")
    )]
    if inv_ids:
        async for e in db.money_ledger_events.find(
            {"entity_id": {"$in": inv_ids}},
            {"_id": 0, "event_type": 1, "amount": 1, "created_at": 1, "entity_id": 1},
        ).sort("created_at", -1):
            ledger_events.append(e)
            if e.get("event_type"):
                if e["event_type"] not in ledger_event_types:
                    ledger_event_types.append(e["event_type"])

    # ───── Classify divergences ─────
    divs: list[dict] = []

    # 1. escrow_missing — invoice marked paid but no escrow
    if inv_paid_sum > EPS and not esc_exists:
        divs.append({
            "class": "escrow_missing",
            "severity": "error",
            "delta": _r(inv_paid_sum),
            "explanation": (
                f"Invoice(s) for this module total ${inv_paid_sum:.2f} paid, "
                f"but no escrow record exists. settlement chain broken — "
                f"money_runtime.on_invoice_paid likely did not fire."
            ),
        })

    # 2. escrow_unfunded — escrow exists, pending, no funding, but invoice paid
    if esc_exists and esc_status == "pending" and inv_paid_sum > EPS:
        divs.append({
            "class": "escrow_unfunded",
            "severity": "warning",
            "delta": _r(inv_paid_sum),
            "explanation": (
                f"Invoice paid (${inv_paid_sum:.2f}) but escrow status is "
                f"pending and locked_amount=0. fund_escrow() did not run."
            ),
        })

    # 3. release_mismatch — escrow.released vs sum(escrow_payouts.amount)
    if esc_exists and not _eq(esc_released, esc_payouts_sum):
        divs.append({
            "class": "release_mismatch",
            "severity": "error",
            "delta": _r(esc_released - esc_payouts_sum),
            "explanation": (
                f"escrows.released_amount=${esc_released:.2f} does not equal "
                f"Σ escrow_payouts.amount=${esc_payouts_sum:.2f}. Release "
                f"split math diverged from the per-row record."
            ),
        })

    # 4. wallet_not_credited — escrow released but no dev_earning_log
    if esc_released > EPS and wallet_credited_sum < EPS:
        divs.append({
            "class": "wallet_not_credited",
            "severity": "error",
            "delta": _r(esc_released),
            "explanation": (
                f"Escrow released ${esc_released:.2f} but dev_earning_log has "
                f"no entries for this module. _credit_module_reward did not "
                f"fire OR the dev_earning_log idempotency guard short-circuited "
                f"against a stale row."
            ),
        })

    # 5. escrow_payouts_orphan — parallel-write divergence (the S-1 signature)
    if esc_payouts_sum > EPS and wallet_credited_sum < EPS:
        divs.append({
            "class": "escrow_payouts_orphan",
            "severity": "error",
            "delta": _r(esc_payouts_sum),
            "explanation": (
                f"escrow_payouts records exist (${esc_payouts_sum:.2f}) but "
                f"dev_earning_log is empty. escrow_layer.release_escrow ran "
                f"without the parallel _credit_module_reward path. This is "
                f"the structural S-1 evidence: two writers, one ran, the "
                f"other did not."
            ),
        })

    # 6. double_credit_suspected
    if client_price > EPS and wallet_credited_sum > client_price * 1.5:
        divs.append({
            "class": "double_credit_suspected",
            "severity": "error",
            "delta": _r(wallet_credited_sum - client_price),
            "explanation": (
                f"dev_earning_log total ${wallet_credited_sum:.2f} > "
                f"1.5 × client_price (${client_price:.2f}). idempotency guard "
                f"by module_id should make this impossible — investigate "
                f"duplicate module_id rows or seed corruption."
            ),
        })

    # 7. payouts_root_orphan — frozen-collection still being written
    if payouts_root_sum > EPS and wallet_credited_sum < EPS and esc_released < EPS:
        divs.append({
            "class": "payouts_root_orphan",
            "severity": "warning",
            "delta": _r(payouts_root_sum),
            "explanation": (
                f"payouts (root) rows total ${payouts_root_sum:.2f} for this "
                f"module, but neither dev_earning_log nor escrow released. "
                f"work_execution / mobile_adapter / client_acceptance wrote "
                f"to the frozen 'payouts' collection without the canonical chain."
            ),
        })

    # 8. earnings_root_orphan — same idea for the root 'earnings' collection
    if earnings_root_sum > EPS and wallet_credited_sum < EPS and esc_released < EPS:
        divs.append({
            "class": "earnings_root_orphan",
            "severity": "warning",
            "delta": _r(earnings_root_sum),
            "explanation": (
                f"earnings (root) rows total ${earnings_root_sum:.2f} without "
                f"dev_earning_log or escrow release."
            ),
        })

    # 9. ledger_missing — mutations happened but ledger silent
    canonical_mutation_happened = (
        inv_paid_sum > EPS or esc_locked > EPS
        or esc_released > EPS or wallet_credited_sum > EPS
    )
    if canonical_mutation_happened and len(ledger_events) == 0:
        divs.append({
            "class": "ledger_missing",
            "severity": "info",
            "delta": 0.0,
            "explanation": (
                f"Money changed for this module (invoice paid / escrow locked "
                f"/ released / wallet credited) but no money_ledger_events "
                f"entries reference it. Audit log is incomplete — older rows "
                f"predate ledger wiring."
            ),
        })

    return {
        "module_id": module_id,
        "project_id": project_id,
        "module_status": module.get("status"),
        "client_price": client_price,
        "domains": {
            "invoice": {
                "paid_sum": _r(inv_paid_sum),
                "total_sum": _r(inv_total_sum),
                "count": inv_count,
                "status_breakdown": inv_status_breakdown,
            },
            "escrow": {
                "exists": esc_exists,
                "status": esc_status,
                "total": esc_total,
                "locked": esc_locked,
                "released": esc_released,
                "refunded": esc_refunded,
            },
            "wallet": {
                "credited_sum": _r(wallet_credited_sum),
                "log_entries": wallet_log_entries,
                "developers": wallet_per_dev,
            },
            "audit": {
                "escrow_payouts_sum": _r(esc_payouts_sum),
                "escrow_payouts_count": esc_payouts_count,
                "escrow_payouts_by_developer": [
                    {"developer_id": k, "amount": v}
                    for k, v in esc_payouts_devs.items()
                ],
                "ledger_events_count": len(ledger_events),
                "ledger_event_types": ledger_event_types,
            },
            "frozen": {
                "payouts_root_sum": _r(payouts_root_sum),
                "payouts_root_count": payouts_root_count,
                "earnings_root_sum": _r(earnings_root_sum),
                "earnings_root_count": earnings_root_count,
            },
        },
        "divergences": divs,
        "ok": len(divs) == 0,
        "checked_at": _now(),
    }


async def async_iter_field(cursor, field: str):
    """Helper async generator that yields a single field from each doc."""
    async for d in cursor:
        v = d.get(field)
        if v is not None:
            yield v


# ─────────────────────────────────────────────────────────────────────────────
# Per-developer diff
# ─────────────────────────────────────────────────────────────────────────────

async def _developer_universe(db) -> list[str]:
    ids: set[str] = set()
    async for w in db.dev_wallets.find({}, {"_id": 0, "user_id": 1}):
        if w.get("user_id"):
            ids.add(w["user_id"])
    async for u in db.users.find(
        {"$or": [
            {"total_earnings": {"$gt": 0}},
            {"escrow_earnings": {"$gt": 0}},
            {"role": "developer"},
        ]},
        {"_id": 0, "user_id": 1},
    ):
        if u.get("user_id"):
            ids.add(u["user_id"])
    async for el in db.dev_earning_log.find({}, {"_id": 0, "user_id": 1}):
        if el.get("user_id"):
            ids.add(el["user_id"])
    async for ep in db.escrow_payouts.find({}, {"_id": 0, "developer_id": 1}):
        if ep.get("developer_id"):
            ids.add(ep["developer_id"])
    return sorted(ids)


async def _diff_developer(db, developer_id: str) -> dict:
    # Canonical: dev_wallets
    w = await db.dev_wallets.find_one({"user_id": developer_id}, {"_id": 0}) or {}
    wallet_earned = _r(w.get("earned_lifetime"))
    wallet_available = _r(w.get("available_balance"))
    wallet_withdrawn = _r(w.get("withdrawn_lifetime"))
    wallet_pending = _r(w.get("pending_withdrawal"))

    # Journal: dev_earning_log
    log_sum = 0.0
    log_count = 0
    async for el in db.dev_earning_log.find(
        {"user_id": developer_id}, {"_id": 0, "amount": 1}
    ):
        log_sum += _r(el.get("amount"))
        log_count += 1

    # Audit: escrow_payouts per developer
    esc_payouts_sum = 0.0
    esc_payouts_count = 0
    async for p in db.escrow_payouts.find(
        {"developer_id": developer_id}, {"_id": 0, "amount": 1}
    ):
        esc_payouts_sum += _r(p.get("amount"))
        esc_payouts_count += 1

    # Legacy: users.total_earnings / users.escrow_earnings
    u = await db.users.find_one(
        {"user_id": developer_id},
        {"_id": 0, "total_earnings": 1, "escrow_earnings": 1, "email": 1, "role": 1},
    ) or {}
    legacy_total = _r(u.get("total_earnings"))
    legacy_escrow = _r(u.get("escrow_earnings"))

    # Frozen: payouts (root)
    payouts_root_sum = 0.0
    payouts_root_count = 0
    async for p in db.payouts.find(
        {"developer_id": developer_id}, {"_id": 0, "amount": 1}
    ):
        payouts_root_sum += _r(p.get("amount"))
        payouts_root_count += 1

    # Frozen: earnings (root)
    earnings_root_sum = 0.0
    earnings_root_count = 0
    async for e in db.earnings.find(
        {"developer_id": developer_id},
        {"_id": 0, "final_earning": 1, "amount": 1},
    ):
        earnings_root_sum += _r(e.get("final_earning") or e.get("amount"))
        earnings_root_count += 1

    # Payout intent: dev_withdrawals
    withdrawals_paid_sum = 0.0
    withdrawals_pending_sum = 0.0
    async for d in db.dev_withdrawals.find(
        {"user_id": developer_id}, {"_id": 0, "amount": 1, "status": 1}
    ):
        amt = _r(d.get("amount"))
        if d.get("status") == "paid":
            withdrawals_paid_sum += amt
        elif d.get("status") in ("pending", "approved"):
            withdrawals_pending_sum += amt

    divs: list[dict] = []

    # A. wallet vs journal: wallet_earned MUST equal log_sum (Decision 1=D canonical contract)
    if not _eq(wallet_earned, log_sum):
        divs.append({
            "class": "wallet_journal_drift",
            "severity": "error",
            "delta": _r(wallet_earned - log_sum),
            "explanation": (
                f"dev_wallets.earned_lifetime=${wallet_earned:.2f} does not "
                f"equal Σ dev_earning_log.amount=${log_sum:.2f}. The canonical "
                f"wallet is no longer a faithful projection of its journal."
            ),
        })

    # B. wallet balance equation: earned = available + withdrawn + pending
    expected_earned = wallet_available + wallet_withdrawn + wallet_pending
    if not _eq(wallet_earned, expected_earned):
        divs.append({
            "class": "wallet_balance_equation_broken",
            "severity": "error",
            "delta": _r(wallet_earned - expected_earned),
            "explanation": (
                f"earned_lifetime (${wallet_earned:.2f}) != available "
                f"(${wallet_available:.2f}) + withdrawn (${wallet_withdrawn:.2f}) "
                f"+ pending (${wallet_pending:.2f}) = ${expected_earned:.2f}."
            ),
        })

    # C. legacy drift: users.total_earnings vs wallet (Decision 3 pending)
    if not _eq(legacy_total, wallet_earned):
        divs.append({
            "class": "legacy_drift_total_earnings",
            "severity": "warning",
            "delta": _r(legacy_total - wallet_earned),
            "explanation": (
                f"users.total_earnings (${legacy_total:.2f}) differs from "
                f"dev_wallets.earned_lifetime (${wallet_earned:.2f}). Legacy "
                f"mirror is stale. Per Decision 1=D, wallet is canonical; "
                f"per Decision 3 (pending), legacy field's fate is not yet decided."
            ),
        })

    # D. escrow_payouts orphan at developer level
    if esc_payouts_sum > EPS and log_sum < EPS:
        divs.append({
            "class": "escrow_payouts_orphan_dev",
            "severity": "error",
            "delta": _r(esc_payouts_sum),
            "explanation": (
                f"escrow_payouts.amount=${esc_payouts_sum:.2f} for this "
                f"developer but dev_earning_log is empty. Same S-1 parallel-"
                f"writer pattern at developer aggregate level."
            ),
        })

    # E. withdrawal accounting
    if not _eq(withdrawals_paid_sum, wallet_withdrawn):
        divs.append({
            "class": "withdrawals_drift",
            "severity": "warning",
            "delta": _r(withdrawals_paid_sum - wallet_withdrawn),
            "explanation": (
                f"Σ dev_withdrawals(paid)=${withdrawals_paid_sum:.2f} but "
                f"dev_wallets.withdrawn_lifetime=${wallet_withdrawn:.2f}."
            ),
        })

    # F. frozen-collection orphans (warning, not error — Decision 2 pending)
    if payouts_root_sum > EPS and not _eq(payouts_root_sum, log_sum):
        divs.append({
            "class": "payouts_root_drift_dev",
            "severity": "info",
            "delta": _r(payouts_root_sum - log_sum),
            "explanation": (
                f"payouts (root) sum=${payouts_root_sum:.2f} ≠ "
                f"dev_earning_log sum=${log_sum:.2f}. payouts is frozen "
                f"pending Decision 2; difference is expected until then."
            ),
        })

    return {
        "developer_id": developer_id,
        "email": u.get("email"),
        "role": u.get("role"),
        "canonical": {
            "earned_lifetime": wallet_earned,
            "available_balance": wallet_available,
            "withdrawn_lifetime": wallet_withdrawn,
            "pending_withdrawal": wallet_pending,
            "log_sum": _r(log_sum),
            "log_entries": log_count,
        },
        "audit": {
            "escrow_payouts_sum": _r(esc_payouts_sum),
            "escrow_payouts_count": esc_payouts_count,
        },
        "legacy": {
            "users_total_earnings": legacy_total,
            "users_escrow_earnings": legacy_escrow,
        },
        "frozen": {
            "payouts_root_sum": _r(payouts_root_sum),
            "payouts_root_count": payouts_root_count,
            "earnings_root_sum": _r(earnings_root_sum),
            "earnings_root_count": earnings_root_count,
        },
        "withdrawals": {
            "paid_sum": _r(withdrawals_paid_sum),
            "pending_sum": _r(withdrawals_pending_sum),
        },
        "divergences": divs,
        "ok": len(divs) == 0,
        "checked_at": _now(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Public top-level scan (used by overview + script runner)
# ─────────────────────────────────────────────────────────────────────────────

async def scan_modules(db, limit: int = 0) -> list[dict]:
    """Iterate the module universe and produce a diff row for each.
    If limit > 0, stop after that many modules (universe is sorted)."""
    ids = await _module_universe(db)
    if limit > 0:
        ids = ids[:limit]
    out: list[dict] = []
    for mid in ids:
        try:
            row = await _diff_module(db, mid)
            out.append(row)
        except Exception as e:
            logger.warning(f"diff_module({mid}) failed: {e}")
            out.append({
                "module_id": mid,
                "error": str(e),
                "divergences": [{"class": "diff_failed", "severity": "info",
                                 "explanation": str(e)}],
                "ok": False,
            })
    return out


async def scan_developers(db, limit: int = 0) -> list[dict]:
    ids = await _developer_universe(db)
    if limit > 0:
        ids = ids[:limit]
    out: list[dict] = []
    for did in ids:
        try:
            row = await _diff_developer(db, did)
            out.append(row)
        except Exception as e:
            logger.warning(f"diff_developer({did}) failed: {e}")
            out.append({
                "developer_id": did,
                "error": str(e),
                "divergences": [{"class": "diff_failed", "severity": "info",
                                 "explanation": str(e)}],
                "ok": False,
            })
    return out


async def blast_radius(db) -> dict:
    """Stage 7A measurement queries — operational blast-radius sizing.

    All counts are read-only. Each metric answers ONE specific question
    raised by Decisions 2–6. Use this BEFORE signing any further decision
    or starting any writer freeze.

    Key insight surfaced by the smoke trace (2026-05-14):

        Canonical declared (Decision 1=D) ≠ canonical executed.

    The escrow chain bypasses the canonical wallet write entirely. This
    function quantifies HOW WIDE that gap is across the live database.
    """
    metrics: dict = {}

    # ─── M1. Developers with legacy-mirror signal but empty canonical wallet
    # i.e. users.total_earnings > 0 AND (no wallet OR wallet.earned_lifetime = 0)
    # These are the developers Decision 3 would silently zero out if frozen
    # before Decision 5.
    m1_count = 0
    m1_sample: list[dict] = []
    async for u in db.users.find(
        {"$or": [
            {"total_earnings": {"$gt": 0}},
            {"escrow_earnings": {"$gt": 0}},
        ]},
        {"_id": 0, "user_id": 1, "email": 1, "total_earnings": 1, "escrow_earnings": 1},
    ):
        uid = u.get("user_id")
        if not uid:
            continue
        w = await db.dev_wallets.find_one({"user_id": uid}, {"_id": 0, "earned_lifetime": 1}) or {}
        wallet_earned = _r(w.get("earned_lifetime"))
        legacy_total = _r(u.get("total_earnings"))
        legacy_escrow = _r(u.get("escrow_earnings"))
        if (legacy_total > EPS or legacy_escrow > EPS) and wallet_earned < EPS:
            m1_count += 1
            if len(m1_sample) < 10:
                m1_sample.append({
                    "user_id": uid, "email": u.get("email"),
                    "users_total_earnings": legacy_total,
                    "users_escrow_earnings": legacy_escrow,
                    "wallet_earned_lifetime": wallet_earned,
                })
    metrics["M1_legacy_signal_without_wallet"] = {
        "count": m1_count, "sample": m1_sample,
        "question": "Decision 3 — how many developers would Decision 3.A (freeze legacy) silently zero?",
        "blocker_for": ["Decision 3.A"],
    }

    # ─── M2. Wallet ≠ journal sum (canonical contract violation under D)
    # Decision 1=D requires dev_wallets.earned_lifetime == Σ dev_earning_log.amount.
    # This counts the developers where that contract is already broken.
    m2_count = 0
    m2_sample: list[dict] = []
    async for w in db.dev_wallets.find(
        {}, {"_id": 0, "user_id": 1, "earned_lifetime": 1}
    ):
        uid = w.get("user_id")
        if not uid:
            continue
        wallet_earned = _r(w.get("earned_lifetime"))
        log_sum = 0.0
        async for el in db.dev_earning_log.find(
            {"user_id": uid}, {"_id": 0, "amount": 1}
        ):
            log_sum += _r(el.get("amount"))
        if not _eq(wallet_earned, log_sum):
            m2_count += 1
            if len(m2_sample) < 10:
                m2_sample.append({
                    "user_id": uid,
                    "wallet_earned_lifetime": wallet_earned,
                    "log_sum": _r(log_sum),
                    "delta": _r(wallet_earned - log_sum),
                })
    metrics["M2_wallet_journal_drift"] = {
        "count": m2_count, "sample": m2_sample,
        "question": "Decision 1 — is the canonical contract already broken in live data?",
        "blocker_for": ["any reconciliation job"],
    }

    # ─── M3. payouts(root) drift per developer
    # Counts developers where Σ payouts.amount differs from Σ dev_earning_log.
    # NOTE: under recommendation 2.B (intent semantic) this is expected drift,
    # not a bug. The count measures size of the work-pipeline domain.
    m3_count = 0
    m3_sample: list[dict] = []
    pipeline_p = [
        {"$group": {
            "_id": "$developer_id",
            "sum": {"$sum": {"$ifNull": ["$amount", 0]}},
            "count": {"$sum": 1},
        }}
    ]
    async for row in db.payouts.aggregate(pipeline_p):
        uid = row.get("_id")
        if not uid:
            continue
        payouts_sum = _r(row.get("sum"))
        if payouts_sum < EPS:
            continue
        log_sum = 0.0
        async for el in db.dev_earning_log.find(
            {"user_id": uid}, {"_id": 0, "amount": 1}
        ):
            log_sum += _r(el.get("amount"))
        if not _eq(payouts_sum, log_sum):
            m3_count += 1
            if len(m3_sample) < 10:
                m3_sample.append({
                    "developer_id": uid,
                    "payouts_root_sum": payouts_sum,
                    "payouts_root_count": row.get("count"),
                    "dev_earning_log_sum": _r(log_sum),
                    "delta": _r(payouts_sum - log_sum),
                })
    metrics["M3_payouts_root_vs_journal"] = {
        "count": m3_count, "sample": m3_sample,
        "question": "Decision 2 — how large is the work-pipeline domain vs the canonical wallet?",
        "blocker_for": ["Decision 2.A freeze", "any payouts(root) reader change"],
    }

    # ─── M4. Escrow releases without ledger events
    # An escrow row reached completed/partially_released — was a ledger event
    # written for it? Counts the audit gap on the canonical chain.
    m4_count = 0
    m4_sample: list[dict] = []
    async for esc in db.escrows.find(
        {"status": {"$in": ["funded", "partially_released", "completed"]}},
        {"_id": 0, "escrow_id": 1, "module_id": 1, "status": 1,
         "released_amount": 1, "total_amount": 1},
    ):
        # An "escrow_released" ledger event should reference the escrow_id
        # OR the module_id (both are valid entity_ids in our writers).
        led_for_escrow = await db.money_ledger_events.count_documents({
            "$or": [
                {"entity_id": esc.get("escrow_id")},
                {"entity_id": esc.get("module_id")},
            ],
            "event_type": {"$in": ["escrow_funded", "escrow_released",
                                    "earning_approved", "payout_paid"]},
        })
        if led_for_escrow == 0 and _r(esc.get("released_amount")) > EPS:
            m4_count += 1
            if len(m4_sample) < 10:
                m4_sample.append({
                    "escrow_id": esc.get("escrow_id"),
                    "module_id": esc.get("module_id"),
                    "released_amount": _r(esc.get("released_amount")),
                    "status": esc.get("status"),
                })
    metrics["M4_escrow_releases_without_ledger"] = {
        "count": m4_count, "sample": m4_sample,
        "question": "Decision 6 — how silent is the ledger on the canonical chain right now?",
        "blocker_for": ["Decision 6.A enforcement"],
    }

    # ─── M5. Payout intents never settled
    # payouts(root) rows where status is one of {pending, approved, paid}
    # but no corresponding dev_earning_log row exists for the module.
    # i.e. the work pipeline declared an intent that the canonical wallet
    # never observed.
    m5_count = 0
    m5_sample: list[dict] = []
    async for p in db.payouts.find(
        {"status": {"$in": ["pending", "approved", "paid"]}},
        {"_id": 0, "payout_id": 1, "module_id": 1, "developer_id": 1,
         "amount": 1, "status": 1, "created_at": 1},
    ):
        mod_id = p.get("module_id")
        dev_id = p.get("developer_id")
        if not mod_id or not dev_id:
            continue
        log_count = await db.dev_earning_log.count_documents({
            "module_id": mod_id, "user_id": dev_id,
        })
        if log_count == 0:
            m5_count += 1
            if len(m5_sample) < 10:
                m5_sample.append({
                    "payout_id": p.get("payout_id"),
                    "module_id": mod_id, "developer_id": dev_id,
                    "amount": _r(p.get("amount")),
                    "status": p.get("status"),
                    "created_at": p.get("created_at"),
                })
    metrics["M5_payout_intents_never_settled"] = {
        "count": m5_count, "sample": m5_sample,
        "question": "Decision 2 / 5 — how many work-pipeline intents never reached canonical?",
        "blocker_for": ["Decision 5 ordering decision"],
    }

    # ─── M6. Modules done without canonical wallet credit
    # The structural Decision-1≠Decision-1-executed indicator:
    # module.status=done AND escrow_payouts exists AND dev_earning_log empty.
    # This is the runtime fingerprint of "canonical declared ≠ canonical executed".
    m6_count = 0
    m6_sample: list[dict] = []
    async for m in db.modules.find(
        {"status": "done"},
        {"_id": 0, "module_id": 1, "title": 1, "client_price": 1},
    ):
        mid = m.get("module_id")
        if not mid:
            continue
        esc_p_sum = 0.0
        async for ep in db.escrow_payouts.find(
            {"module_id": mid}, {"_id": 0, "amount": 1}
        ):
            esc_p_sum += _r(ep.get("amount"))
        if esc_p_sum < EPS:
            continue  # not a release-on-escrow case
        log_count = await db.dev_earning_log.count_documents({"module_id": mid})
        if log_count == 0:
            m6_count += 1
            if len(m6_sample) < 10:
                m6_sample.append({
                    "module_id": mid, "title": m.get("title"),
                    "client_price": _r(m.get("client_price")),
                    "escrow_payouts_sum": _r(esc_p_sum),
                    "dev_earning_log_rows": 0,
                })
    metrics["M6_modules_done_without_canonical_credit"] = {
        "count": m6_count, "sample": m6_sample,
        "question": "THE Stage 7A question — declared ≠ executed at module level.",
        "blocker_for": ["Decision 5 priority", "Stage 7B unsafe writer freeze"],
    }

    # ─── M7. Total carriers populated vs canonical
    # Money mass per carrier — gives a per-collection sizing of the problem.
    inv_paid_sum = 0.0
    async for inv in db.invoices.find(
        {"status": "paid"}, {"_id": 0, "amount": 1}
    ):
        inv_paid_sum += _r(inv.get("amount"))

    esc_locked_sum = 0.0
    esc_released_sum = 0.0
    async for e in db.escrows.find(
        {}, {"_id": 0, "locked_amount": 1, "released_amount": 1}
    ):
        esc_locked_sum += _r(e.get("locked_amount"))
        esc_released_sum += _r(e.get("released_amount"))

    wallet_earned_sum = 0.0
    async for w in db.dev_wallets.find(
        {}, {"_id": 0, "earned_lifetime": 1}
    ):
        wallet_earned_sum += _r(w.get("earned_lifetime"))

    log_total_sum = 0.0
    async for el in db.dev_earning_log.find(
        {}, {"_id": 0, "amount": 1}
    ):
        log_total_sum += _r(el.get("amount"))

    esc_payouts_total = 0.0
    async for p in db.escrow_payouts.find(
        {}, {"_id": 0, "amount": 1}
    ):
        esc_payouts_total += _r(p.get("amount"))

    payouts_root_total = 0.0
    async for p in db.payouts.find(
        {}, {"_id": 0, "amount": 1}
    ):
        payouts_root_total += _r(p.get("amount"))

    legacy_total_sum = 0.0
    async for u in db.users.find(
        {"total_earnings": {"$gt": 0}}, {"_id": 0, "total_earnings": 1}
    ):
        legacy_total_sum += _r(u.get("total_earnings"))

    ledger_total = await db.money_ledger_events.count_documents({})

    metrics["M7_carrier_mass"] = {
        "carriers": {
            "invoices_paid_sum":      _r(inv_paid_sum),
            "escrows_locked_sum":     _r(esc_locked_sum),
            "escrows_released_sum":   _r(esc_released_sum),
            "dev_wallets_earned_sum": _r(wallet_earned_sum),
            "dev_earning_log_sum":    _r(log_total_sum),
            "escrow_payouts_sum":     _r(esc_payouts_total),
            "payouts_root_sum":       _r(payouts_root_total),
            "users_total_earnings_sum": _r(legacy_total_sum),
            "money_ledger_events_count": ledger_total,
        },
        "question": "Cross-carrier sizing. Numbers that don't match each other = scale of the problem.",
        "blocker_for": ["any reconciliation budget estimate"],
    }

    return {
        "checked_at": _now(),
        "decision": "1=D signed; 2-6 awaiting memo sign-off",
        "principle": "Canonical declared (Decision 1=D) ≠ canonical executed — measure the gap here.",
        "metrics": metrics,
    }


async def overview(db) -> dict:
    modules = await scan_modules(db)
    developers = await scan_developers(db)

    by_class: dict[str, int] = {}
    by_severity: dict[str, int] = {"info": 0, "warning": 0, "error": 0}
    for row in modules + developers:
        for d in row.get("divergences", []):
            cls = d.get("class", "unknown")
            by_class[cls] = by_class.get(cls, 0) + 1
            sev = d.get("severity", "info")
            by_severity[sev] = by_severity.get(sev, 0) + 1

    return {
        "scanned": {
            "modules": len(modules),
            "modules_ok": sum(1 for m in modules if m.get("ok")),
            "modules_diverged": sum(1 for m in modules if not m.get("ok")),
            "developers": len(developers),
            "developers_ok": sum(1 for d in developers if d.get("ok")),
            "developers_diverged": sum(1 for d in developers if not d.get("ok")),
        },
        "by_class": by_class,
        "by_severity": by_severity,
        "authority_map": {
            "developer_payable_canonical": "dev_wallets (backed by dev_earning_log)",
            "client_billing_canonical": "invoices",
            "locked_funds_canonical": "escrows",
            "audit": "money_ledger_events, escrow_payouts",
            "frozen_pending_decision_2": ["payouts", "earnings", "task_earnings"],
            "legacy_pending_decision_3": ["users.total_earnings", "users.escrow_earnings"],
        },
        "charter": "/app/audit/MONEY_AUTHORITY_CHARTER.md",
        "checked_at": _now(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Wire HTTP routes (admin-only). Identical pattern to money_runtime.wire.
# ─────────────────────────────────────────────────────────────────────────────

def wire(*, db, require_role):
    global _db
    _db = db

    @router.get("/admin/money/divergence/overview")
    async def divergence_overview(admin=Depends(require_role("admin"))):
        return await overview(_db)

    @router.get("/admin/money/divergence/modules")
    async def divergence_modules(
        limit: int = Query(50, ge=1, le=500),
        skip: int = Query(0, ge=0),
        cls: Optional[str] = Query(None, description="Filter by divergence class"),
        only_diverged: bool = Query(False),
        admin=Depends(require_role("admin")),
    ):
        rows = await scan_modules(_db)
        if only_diverged:
            rows = [r for r in rows if not r.get("ok")]
        if cls:
            rows = [r for r in rows if any(d.get("class") == cls for d in r.get("divergences", []))]
        total = len(rows)
        rows = rows[skip:skip + limit]
        return {"count": total, "limit": limit, "skip": skip, "rows": rows,
                "checked_at": _now()}

    @router.get("/admin/money/divergence/module/{module_id}")
    async def divergence_module_detail(
        module_id: str, admin=Depends(require_role("admin"))
    ):
        row = await _diff_module(_db, module_id)
        if not row:
            raise HTTPException(status_code=404, detail="No money activity for module")
        return row

    @router.get("/admin/money/divergence/developers")
    async def divergence_developers(
        limit: int = Query(50, ge=1, le=500),
        skip: int = Query(0, ge=0),
        only_diverged: bool = Query(False),
        admin=Depends(require_role("admin")),
    ):
        rows = await scan_developers(_db)
        if only_diverged:
            rows = [r for r in rows if not r.get("ok")]
        total = len(rows)
        rows = rows[skip:skip + limit]
        return {"count": total, "limit": limit, "skip": skip, "rows": rows,
                "checked_at": _now()}

    @router.get("/admin/money/divergence/developer/{developer_id}")
    async def divergence_developer_detail(
        developer_id: str, admin=Depends(require_role("admin"))
    ):
        return await _diff_developer(_db, developer_id)

    @router.get("/admin/money/divergence/blast-radius")
    async def divergence_blast_radius(admin=Depends(require_role("admin"))):
        """Stage 7A measurement queries. Read-only. Sizes the gap between
        Decision 1=D declared canonical and the canonical actually executed."""
        return await blast_radius(_db)
