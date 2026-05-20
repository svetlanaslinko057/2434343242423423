"""
Phase 2B PR-1 — Money write-path bridge.

This module is the **migration glue** from the 15 grandfathered legacy money
writers (escrow_layer.py, escrow_api.py, wayforpay_callback path, …) onto
the canonical `domains/money/MoneyService`.

Migration strategy (per user's operational principle for Phase 2B):

  legacy writer → legacy collections write (UNCHANGED)
                ↓
                → bridge_*  →  MoneyService.<op>  →  MoneyRepository.append()
                                                     (canonical `money_ledger_events`)

  Legacy collections (`escrows`, `escrow_payouts`, `dev_wallets`, …) keep
  being populated so existing readers do not break. As Phase 2B progresses
  we flip individual readers to query the canonical ledger; in Phase 2C/2D
  the legacy writes themselves get removed.

Idempotency contract:
  Every bridge call derives a deterministic `idempotency_key` from the
  business identifier (escrow_id, payout_id, invoice_id) so retries from
  the legacy path (e.g. a webhook re-fire, a manual admin force) NEVER
  double-charge. The MoneyService append already returns the existing
  entry on `DuplicateKeyError`, so this layer just has to pick stable keys.

Failure isolation:
  The bridge is INVOKED FROM legacy writers AFTER their own write succeeds.
  If the bridge itself fails (MoneyService not yet initialised, ledger
  index race during startup, currency unsupported, …) the bridge must
  NOT raise back into the legacy path — legacy correctness is preserved
  even if canonical mirror lags. All such failures are logged.

  This matches `module_motion.py`'s already-emergent convergence pattern
  (see audit/MONEY_WRITER_INVENTORY_ADDENDUM_2026-05-14.md §C) and is what
  makes the bridge safe to ship before the legacy paths are removed.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

log = logging.getLogger(__name__)

# Module-level singleton — set once at app startup by `init_money_service`.
_money_service: Optional[Any] = None
_money_repo: Optional[Any] = None


# ── Cents conversion ────────────────────────────────────────────────────────
def _to_cents(dollars: Any) -> int:
    """Convert a legacy float-dollars amount to integer cents.

    Legacy `escrow_layer` stores dollar amounts as Python floats; the
    domain model only accepts ints (no float drift). Round half-to-even via
    `round()` matches the policy in `domains.money.policies.default_platform_fee_cents`.
    """
    return int(round(float(dollars) * 100))


# ── Startup wiring ──────────────────────────────────────────────────────────
async def init_money_service(db) -> None:
    """Construct the canonical MoneyService once per process.

    Called from `server.py` startup. Subsequent calls are no-ops so reload
    cycles don't re-instantiate.
    """
    global _money_service, _money_repo
    if _money_service is not None:
        return

    try:
        from infrastructure.db.repositories.money import MoneyRepository
        from domains.money import MoneyService
        from shared.events import get_event_bus

        repo = MoneyRepository(db)
        try:
            await repo.ensure_indexes()
        except Exception as e:  # noqa: BLE001
            # Legacy `money_ledger.py` may already own conflicting indexes.
            # Sparse indexes coexist with legacy docs (which lack `entry_id`).
            # Log so an operator can diagnose, but never block startup.
            log.warning(f"MONEY BRIDGE: ensure_indexes warning (non-fatal): {e}")

        bus = get_event_bus()
        _money_repo = repo
        _money_service = MoneyService(ledger=repo, events=bus)
        log.info("MONEY BRIDGE: MoneyService initialised (Phase 2B PR-1)")
    except Exception as e:  # noqa: BLE001
        log.error(f"MONEY BRIDGE: init failed (legacy path stays canonical): {e}")
        _money_service = None
        _money_repo = None


def get_money_service():
    """Accessor for tests / introspection. Returns None if not initialised."""
    return _money_service


def get_money_repo():
    return _money_repo


# ── Escrow bridges ──────────────────────────────────────────────────────────
async def bridge_escrow_hold(escrow: dict, funded_by: str) -> None:
    """Mirror `escrow_layer.fund_escrow` into MoneyService.hold_escrow.

    Legacy escrow_layer writes:
      • escrows.status = funded
      • escrows.locked_amount = total
    Bridge writes:
      • money_ledger_events: +cents on ac_escrow:<project_id>, kind=escrow_hold

    Idempotency_key: `legacy_escrow_hold:<escrow_id>` — stable across retries
    because legacy `fund_escrow` is itself idempotent (pre-checks status).
    """
    if _money_service is None:
        return
    try:
        from domains.money import Money
        project_id = escrow.get("project_id") or escrow.get("module_id") or "unknown"
        client_id = escrow.get("client_id") or funded_by or "system"
        amount = Money(_to_cents(escrow.get("total_amount", 0)), "USD")
        if amount.cents == 0:
            return
        await _money_service.hold_escrow(
            project_id=project_id,
            amount=amount,
            client_id=client_id,
            actor=funded_by or "system",
            module_id=escrow.get("module_id"),
            idempotency_key=f"legacy_escrow_hold:{escrow.get('escrow_id')}",
            memo=f"legacy bridge: fund_escrow escrow_id={escrow.get('escrow_id')}",
        )
    except Exception as e:  # noqa: BLE001
        log.warning(
            "MONEY BRIDGE: bridge_escrow_hold suppressed",
            extra={"escrow_id": escrow.get("escrow_id"), "error": str(e)},
        )


async def bridge_escrow_release(escrow: dict, payout: dict) -> None:
    """Mirror per-developer `escrow_payouts` insert into MoneyService.release_escrow.

    Called once per developer share inside `escrow_layer.release_escrow`.
    The MoneyService split is:
      • ac_escrow:<project>      −amount
      • ac_dev:<developer_id>    +(amount − fee)
      • ac_plat:platform         +fee

    For Phase 2B PR-1 we explicitly pass `fee_cents=0` to PRESERVE current
    legacy economics (escrow_layer pays the full share to the developer; no
    platform fee is withheld at the escrow stage). The fee policy can be
    layered in later as a deliberate decision, not as a migration side
    effect.

    Idempotency_key: `legacy_escrow_release:<payout_id>` — payout_id is a
    fresh UUID per share so each line is its own event.
    """
    if _money_service is None:
        return
    try:
        from domains.money import Money
        project_id = escrow.get("project_id") or escrow.get("module_id") or "unknown"
        developer_id = payout.get("developer_id") or "unknown"
        amount = Money(_to_cents(payout.get("amount", 0)), "USD")
        if amount.cents == 0:
            return
        await _money_service.release_escrow(
            project_id=project_id,
            amount=amount,
            developer_id=developer_id,
            actor=payout.get("triggered_by") or "system",
            module_id=escrow.get("module_id"),
            fee_cents=0,  # legacy parity — no fee at escrow stage
            idempotency_key=f"legacy_escrow_release:{payout.get('payout_id')}",
            memo=f"legacy bridge: release escrow={escrow.get('escrow_id')} payout={payout.get('payout_id')}",
        )
    except Exception as e:  # noqa: BLE001
        log.warning(
            "MONEY BRIDGE: bridge_escrow_release suppressed",
            extra={
                "escrow_id": escrow.get("escrow_id"),
                "payout_id": payout.get("payout_id"),
                "error": str(e),
            },
        )


async def bridge_escrow_refund(escrow: dict, refund_amount_dollars: float, reason: str) -> None:
    """Mirror `escrow_layer.refund_escrow` (the funds-returned-to-client part)
    into MoneyService.refund_escrow.

    Note: the legacy `refund_escrow` may also call `release_escrow` for
    `completed_share` BEFORE refunding the remainder. That partial-release
    path is bridged separately via `bridge_escrow_release`. This bridge
    only mirrors the final refund-to-client portion.

    Idempotency_key: `legacy_escrow_refund:<escrow_id>:<cents>` — includes
    amount so partial → fuller refunds are distinguishable. Legacy refunds
    are one-shot per escrow_id so the key is effectively stable.
    """
    if _money_service is None:
        return
    try:
        from domains.money import Money
        cents = _to_cents(refund_amount_dollars)
        if cents <= 0:
            return
        project_id = escrow.get("project_id") or escrow.get("module_id") or "unknown"
        client_id = escrow.get("client_id") or "system"
        await _money_service.refund_escrow(
            project_id=project_id,
            amount=Money(cents, "USD"),
            client_id=client_id,
            actor="legacy_refund",
            reason=reason,
            module_id=escrow.get("module_id"),
            idempotency_key=f"legacy_escrow_refund:{escrow.get('escrow_id')}:{cents}",
        )
    except Exception as e:  # noqa: BLE001
        log.warning(
            "MONEY BRIDGE: bridge_escrow_refund suppressed",
            extra={"escrow_id": escrow.get("escrow_id"), "error": str(e)},
        )


# ── Task-earnings bridges (Phase 2B PR-2) ───────────────────────────────────
async def bridge_task_earning_approved(earning: dict) -> None:
    """Mirror `task_earnings.earning_status: pending_qa → approved` into
    MoneyService.accrue_task_earning.

    Fired from `earnings_layer.handle_qa_result` AND `qa_layer.evaluate_qa_result`
    (both are legacy approval sites today). Idempotency_key carries the
    `revision_count` because the legacy code can re-approve an earning after
    a revision, with a NEW final_earning — each revision is its own accrual
    event. PR-2.1 will pair the new accrual with a reversal of the prior one.

    The bridge writes to the SEPARATE `ac_accrual:<developer_id>` account
    axis - this is intentional, see MoneyService.accrue_task_earning docstring
    for why it doesn't double-count with the PR-1 escrow_release bridge.
    """
    if _money_service is None:
        return
    try:
        from domains.money import Money
        earning_id = earning.get("earning_id")
        developer_id = earning.get("user_id") or "unknown"
        task_id = earning.get("task_id") or earning_id or "unknown"
        amount_cents = _to_cents(earning.get("final_earning") or earning.get("base_earning") or 0)
        if amount_cents <= 0 or not earning_id:
            return
        revision_count = int(earning.get("revision_count", 0) or 0)
        await _money_service.accrue_task_earning(
            developer_id=developer_id,
            amount=Money(amount_cents, "USD"),
            task_id=task_id,
            earning_id=earning_id,
            actor=earning.get("approved_by") or "qa_pipeline",
            module_id=earning.get("module_id"),
            project_id=earning.get("project_id"),
            revision_count=revision_count,
            idempotency_key=f"legacy_task_earning_approved:{earning_id}:rev{revision_count}",
            memo=f"legacy bridge: task earning approved earning_id={earning_id}",
        )
    except Exception as e:  # noqa: BLE001
        log.warning(
            "MONEY BRIDGE: bridge_task_earning_approved suppressed",
            extra={"earning_id": earning.get("earning_id"), "error": str(e)},
        )


async def bridge_task_earning_reversed(earning: dict, reason: str) -> None:
    """Mirror earning cancellation/downgrade into MoneyService.reverse_task_earning.

    Idempotent: if no prior accrual exists for this `earning_id`, returns
    None silently. If a prior accrual exists, appends a compensating entry
    that brings the net delta on `ac_accrual:<developer_id>` back to zero.

    Used from:
      - earnings_layer.handle_qa_result when QA result moves a previously-
        approved earning to HELD/CANCELLED
      - admin manual void (future PR)
    """
    if _money_service is None:
        return
    try:
        earning_id = earning.get("earning_id")
        if not earning_id:
            return
        await _money_service.reverse_task_earning(
            earning_id=earning_id,
            actor=earning.get("cancelled_by") or "qa_pipeline",
            reason=reason,
            idempotency_key=f"legacy_task_earning_reversed:{earning_id}:{reason[:32]}",
        )
    except Exception as e:  # noqa: BLE001
        log.warning(
            "MONEY BRIDGE: bridge_task_earning_reversed suppressed",
            extra={"earning_id": earning.get("earning_id"), "error": str(e)},
        )


# ── Payout bridge (Phase 2B PR-3) ───────────────────────────────────────────
async def bridge_payout_processed(
    *,
    developer_id: str,
    amount_dollars: float,
    legacy_id: str,
    legacy_kind: str = "withdrawal",
    actor: str = "system",
    revision: int = 0,
    external_ref: str = "",
) -> None:
    """Mirror a legacy payout success into MoneyService.process_payout.

    Fired from:
      - `server.py /api/admin/withdrawals/{id}/mark-paid` after the CAS that
        flips `dev_withdrawals.status: approved -> paid` AND after
        `dev_wallets.$inc {pending_withdrawal: -A, withdrawn_lifetime: +A}`.
      - `payout_layer.mark_batch_paid` after `payout_batches.status -> paid`
        AND after all `task_earnings.earning_status -> paid`.

    Ledger movement:
      - debit `ac_dev:<developer_id>`  (developer wallet drains)
      - credit `ac_ext:<developer_id>` (notional external destination)
      - kind = "payout"

    Idempotency_key: `legacy_payout_processed:<legacy_id>:rev<revision>`.
    Revision is 0 by default; bumped only if an admin force-replays a payout
    after a partial failure (rare ops path; reserved).

    Failure modes (all logged + swallowed; legacy remains authoritative):
      - `PolicyDenied money_insufficient_balance` — canonical `ac_dev` doesn't
        carry enough balance YET (pre-existing legacy wallet balance hasn't
        been backfilled into ledger; Phase 2C replay will fix this). This is
        a DIVERGENCE signal, not a money-loss event.
      - `PolicyDenied money_payout_below_minimum` — legacy allowed a payout
        below `PAYOUT_BATCH_MIN_AMOUNT` ($10). Logged as a policy divergence
        between legacy and canonical rules.
      - Any other exception: logged with full context.
    """
    if _money_service is None:
        return
    try:
        from domains.money import Money
        cents = _to_cents(amount_dollars)
        if cents <= 0 or not legacy_id or not developer_id:
            return
        idem = f"legacy_payout_processed:{legacy_id}:rev{revision}"
        await _money_service.process_payout(
            developer_id=developer_id,
            amount=Money(cents, "USD"),
            actor=actor,
            payout_batch_id=legacy_id,
            external_ref=external_ref,
            idempotency_key=idem,
        )
    except Exception as e:  # noqa: BLE001
        # Use repr() so PolicyDenied subclass + code field are both visible
        log.warning(
            "MONEY BRIDGE: bridge_payout_processed suppressed",
            extra={
                "legacy_id": legacy_id,
                "developer_id": developer_id,
                "amount_dollars": amount_dollars,
                "legacy_kind": legacy_kind,
                "error": repr(e),
            },
        )


# ── Diagnostics ─────────────────────────────────────────────────────────────
async def diagnostics() -> dict:
    """Read-only diagnostic — counts ledger entries by kind for the new authority.

    Returned shape mirrors `MoneyRepository.project_movement` but global, not
    per-project. Used by Phase 2B exit metric (`money_divergence начинает
    терять смысл` when these counts catch up with legacy `escrow_payouts`).
    """
    if _money_repo is None:
        return {"initialised": False}
    try:
        pipeline = [
            {"$match": {"entry_id": {"$exists": True}}},
            {"$group": {"_id": "$kind", "n": {"$sum": 1}, "delta_cents": {"$sum": "$delta_cents"}}},
        ]
        out: dict[str, dict] = {}
        async for row in _money_repo.collection.aggregate(pipeline):
            out[row["_id"]] = {"events": int(row["n"]), "delta_cents": int(row["delta_cents"])}
        return {"initialised": True, "by_kind": out}
    except Exception as e:  # noqa: BLE001
        return {"initialised": True, "error": str(e)}
