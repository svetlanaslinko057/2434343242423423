"""
MoneyService — the canonical orchestration layer for ALL money movements.

This is the **single write entry point** for the money domain. Every
deposit, escrow hold, release, refund, payout, fee, and reversal in the
system goes through one of these methods.

Architecture invariants (enforced by tests/architecture):
  • Only `domains/money/*` may import `MoneyRepository._insert_one`-style
    direct writes. Everything else uses `MoneyService`.
  • `MoneyService` ALWAYS publishes a `MoneyChanged` subclass event after
    a successful append.
  • Idempotency: every method takes (or derives) an `idempotency_key` so
    callers can safely retry on network failure.

What this class does NOT do:
  • It does NOT talk to Stripe/WayForPay directly. Those are
    `infrastructure/payments/*` adapters; the service receives `external_ref`
    after the adapter succeeds.
  • It does NOT compute prices — that's `pricing_engine.py` (per the user's
    constraint, untouched in Phase 2).
  • It does NOT touch legacy `dev_wallets` / `payments` collections — those
    become read projections via event subscribers in Phase 2B.
"""
from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from shared.events import EventBus
from infrastructure.db.repositories.money import MoneyRepository

from .events import (
    EscrowHeld,
    EscrowReleased,
    EscrowRefunded,
    PayoutProcessed,
    PlatformFeeCharged,
    ValidatorCredited,
    TaskEarningAccrued,
    TaskEarningReversed,
    TransactionReversed,
)
from .models import AccountKind, Money, account_id
from .policies import (
    assert_amount_positive,
    assert_balance_sufficient,
    assert_payout_meets_minimum,
    default_platform_fee_cents,
)

log = logging.getLogger(__name__)


def _entry() -> str:
    """Generate a fresh ledger entry id."""
    return f"entry_{uuid4().hex[:14]}"


class MoneyService:
    """Orchestrates money flows. Single instance per application.

    Inject via FastAPI Depends() or directly in startup wiring. Holds no
    state — safe to share across requests / background tasks.
    """

    def __init__(self, ledger: MoneyRepository, events: EventBus) -> None:
        self._ledger = ledger
        self._events = events

    # ── Public API ──────────────────────────────────────────────────────────

    async def hold_escrow(
        self,
        *,
        project_id: str,
        amount: Money,
        client_id: str,
        actor: str,
        module_id: str | None = None,
        idempotency_key: str | None = None,
        memo: str | None = None,
    ) -> dict[str, Any]:
        """Client deposit moves into project escrow.

        Idempotency key default: stable per (project, module, amount). Caller
        may override for compound flows.
        """
        assert_amount_positive(amount, op="hold_escrow")
        idem = idempotency_key or f"escrow_hold:{project_id}:{module_id or '_'}:{amount.cents}"

        escrow_acct = account_id(AccountKind.ESCROW, project_id)
        entry = await self._ledger.append(
            entry_id=_entry(),
            account_id=escrow_acct,
            delta_cents=amount.cents,
            currency=amount.currency,
            kind="escrow_hold",
            actor=actor,
            idempotency_key=idem,
            project_id=project_id,
            module_id=module_id,
            memo=memo or f"escrow_hold project={project_id}",
            metadata={"client_id": client_id},
        )
        await self._events.publish(
            EscrowHeld(
                entry_id=entry["entry_id"],
                account_id=escrow_acct,
                delta_cents=amount.cents,
                currency=amount.currency,
                actor=actor,
                project_id=project_id,
                module_id=module_id,
                client_id=client_id,
            )
        )
        return entry

    async def release_escrow(
        self,
        *,
        project_id: str,
        amount: Money,
        developer_id: str,
        actor: str,
        module_id: str | None = None,
        fee_cents: int | None = None,
        idempotency_key: str | None = None,
        memo: str | None = None,
    ) -> dict[str, Any]:
        """Escrow → developer wallet.

        Three ledger entries (atomic at the application level):
          1. Escrow account: -amount
          2. Developer wallet: +(amount - fee)
          3. Platform revenue: +fee (if fee>0)

        Atomicity strategy: idempotency keys are derived deterministically so
        replaying a partial failure converges (each step is a no-op if its
        idempotency_key already exists).
        """
        assert_amount_positive(amount, op="release_escrow")

        # Verify escrow has the funds
        escrow_acct = account_id(AccountKind.ESCROW, project_id)
        balance = await self._ledger.balance(escrow_acct, currency=amount.currency)
        assert_balance_sufficient(
            op="release_escrow",
            account_id=escrow_acct,
            current_cents=balance,
            requested_cents=amount.cents,
        )

        fee = fee_cents if fee_cents is not None else default_platform_fee_cents(amount)
        if fee < 0 or fee > amount.cents:
            from shared.errors import InvariantViolated
            raise InvariantViolated(
                "fee_cents must be within [0, amount]",
                code="money_fee_out_of_range",
                context={"fee_cents": fee, "amount_cents": amount.cents},
            )

        base_idem = idempotency_key or f"escrow_release:{project_id}:{module_id or '_'}:{amount.cents}"
        dev_acct = account_id(AccountKind.DEVELOPER_WALLET, developer_id)
        plat_acct = account_id(AccountKind.PLATFORM_REVENUE, "platform")

        # 1. Debit escrow
        debit = await self._ledger.append(
            entry_id=_entry(),
            account_id=escrow_acct,
            delta_cents=-amount.cents,
            currency=amount.currency,
            kind="escrow_release",
            actor=actor,
            idempotency_key=f"{base_idem}#debit",
            project_id=project_id,
            module_id=module_id,
            memo=memo or f"escrow_release project={project_id}",
            metadata={"developer_id": developer_id, "fee_cents": fee},
        )

        # 2. Credit developer (net of fee)
        net_cents = amount.cents - fee
        credit = await self._ledger.append(
            entry_id=_entry(),
            account_id=dev_acct,
            delta_cents=net_cents,
            currency=amount.currency,
            kind="escrow_release",
            actor=actor,
            idempotency_key=f"{base_idem}#credit",
            project_id=project_id,
            module_id=module_id,
            memo=f"earnings net of {fee} cents fee",
            metadata={"source_entry_id": debit["entry_id"], "fee_cents": fee},
        )

        # 3. Credit platform fee (only if non-zero)
        fee_entry: dict[str, Any] | None = None
        if fee > 0:
            fee_entry = await self._ledger.append(
                entry_id=_entry(),
                account_id=plat_acct,
                delta_cents=fee,
                currency=amount.currency,
                kind="fee",
                actor=actor,
                idempotency_key=f"{base_idem}#fee",
                project_id=project_id,
                module_id=module_id,
                memo=f"platform fee on release {debit['entry_id']}",
                metadata={"source_entry_id": debit["entry_id"]},
            )

        # Publish events (release first, then fee — so fee subscribers can read release)
        await self._events.publish(
            EscrowReleased(
                entry_id=credit["entry_id"],
                account_id=dev_acct,
                delta_cents=net_cents,
                currency=amount.currency,
                actor=actor,
                project_id=project_id,
                module_id=module_id,
                developer_id=developer_id,
            )
        )
        if fee_entry:
            await self._events.publish(
                PlatformFeeCharged(
                    entry_id=fee_entry["entry_id"],
                    account_id=plat_acct,
                    delta_cents=fee,
                    currency=amount.currency,
                    actor=actor,
                    source_entry_id=debit["entry_id"],
                    fee_pct=fee / amount.cents if amount.cents else 0.0,
                )
            )

        return {"debit": debit, "credit": credit, "fee": fee_entry}

    async def refund_escrow(
        self,
        *,
        project_id: str,
        amount: Money,
        client_id: str,
        actor: str,
        reason: str,
        module_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Escrow → client deposit (cancellation, dispute won by client)."""
        assert_amount_positive(amount, op="refund_escrow")

        escrow_acct = account_id(AccountKind.ESCROW, project_id)
        balance = await self._ledger.balance(escrow_acct, currency=amount.currency)
        assert_balance_sufficient(
            op="refund_escrow",
            account_id=escrow_acct,
            current_cents=balance,
            requested_cents=amount.cents,
        )

        base_idem = idempotency_key or f"escrow_refund:{project_id}:{module_id or '_'}:{amount.cents}"
        client_acct = account_id(AccountKind.CLIENT_DEPOSIT, client_id)

        debit = await self._ledger.append(
            entry_id=_entry(),
            account_id=escrow_acct,
            delta_cents=-amount.cents,
            currency=amount.currency,
            kind="escrow_refund",
            actor=actor,
            idempotency_key=f"{base_idem}#debit",
            project_id=project_id,
            module_id=module_id,
            memo=f"refund reason={reason}",
            metadata={"client_id": client_id, "reason": reason},
        )
        credit = await self._ledger.append(
            entry_id=_entry(),
            account_id=client_acct,
            delta_cents=amount.cents,
            currency=amount.currency,
            kind="escrow_refund",
            actor=actor,
            idempotency_key=f"{base_idem}#credit",
            project_id=project_id,
            module_id=module_id,
            memo=f"refund credited to {client_id}",
            metadata={"source_entry_id": debit["entry_id"], "reason": reason},
        )

        await self._events.publish(
            EscrowRefunded(
                entry_id=credit["entry_id"],
                account_id=client_acct,
                delta_cents=amount.cents,
                currency=amount.currency,
                actor=actor,
                project_id=project_id,
                module_id=module_id,
                client_id=client_id,
                reason=reason,
            )
        )
        return {"debit": debit, "credit": credit}

    async def credit_validator(
        self,
        *,
        validator_id: str,
        amount: Money,
        module_id: str,
        actor: str,
        qa_decision_id: str = "",
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Pay a QA validator for a verified module.

        Source of funds: platform revenue account (validators are paid out
        of platform fee pool — see PRD HVL section).
        """
        assert_amount_positive(amount, op="credit_validator")
        idem = idempotency_key or f"validator_credit:{validator_id}:{module_id}:{amount.cents}"

        plat_acct = account_id(AccountKind.PLATFORM_REVENUE, "platform")
        val_acct = account_id(AccountKind.VALIDATOR_WALLET, validator_id)

        debit = await self._ledger.append(
            entry_id=_entry(),
            account_id=plat_acct,
            delta_cents=-amount.cents,
            currency=amount.currency,
            kind="adjustment",
            actor=actor,
            idempotency_key=f"{idem}#debit",
            module_id=module_id,
            memo=f"validator credit {validator_id} mod={module_id}",
            metadata={"validator_id": validator_id, "qa_decision_id": qa_decision_id},
        )
        credit = await self._ledger.append(
            entry_id=_entry(),
            account_id=val_acct,
            delta_cents=amount.cents,
            currency=amount.currency,
            kind="adjustment",
            actor=actor,
            idempotency_key=f"{idem}#credit",
            module_id=module_id,
            memo=f"qa validation reward mod={module_id}",
            metadata={"source_entry_id": debit["entry_id"], "qa_decision_id": qa_decision_id},
        )

        await self._events.publish(
            ValidatorCredited(
                entry_id=credit["entry_id"],
                account_id=val_acct,
                delta_cents=amount.cents,
                currency=amount.currency,
                actor=actor,
                validator_id=validator_id,
                module_id=module_id,
                qa_decision_id=qa_decision_id,
            )
        )
        return {"debit": debit, "credit": credit}

    async def accrue_task_earning(
        self,
        *,
        developer_id: str,
        amount: Money,
        task_id: str,
        earning_id: str,
        actor: str,
        module_id: str | None = None,
        project_id: str | None = None,
        revision_count: int = 0,
        idempotency_key: str | None = None,
        memo: str | None = None,
    ) -> dict[str, Any]:
        """Phase 2B PR-2 — record a per-task earning that QA has APPROVED.

        Distinct from `release_escrow`: that one moves escrow → dev_wallet at
        the module level. This one credits a SEPARATE `EARNINGS_ACCRUAL`
        account at the task level, which is the authoritative record of
        "platform owes this developer X cents for task Y, after QA gate".

        Why a separate account axis (not just credit dev_wallet again):
          • the escrow_release bridge (PR-1) already credits `ac_dev:<id>`
          • crediting again here would double-count and break invariants
          • `ac_accrual:<id>` accumulates approved-but-unpaid earnings; the
            payout flow (PR-3) will eventually debit it on payout
          • legacy `task_earnings` collection becomes a pure projection of
            `TaskEarningAccrued` events in Phase 2C

        Single-leg entry (precedent: `hold_escrow`): the accrual originates
        from the platform's commitment, not from a balance transfer. The
        legacy ledger never paired these accruals with a debit either.
        """
        assert_amount_positive(amount, op="accrue_task_earning")
        idem = idempotency_key or f"task_earning_accrued:{earning_id}:{revision_count}:{amount.cents}"

        accr_acct = account_id(AccountKind.EARNINGS_ACCRUAL, developer_id)
        entry = await self._ledger.append(
            entry_id=_entry(),
            account_id=accr_acct,
            delta_cents=amount.cents,
            currency=amount.currency,
            kind="task_earning_accrued",
            actor=actor,
            idempotency_key=idem,
            project_id=project_id,
            module_id=module_id,
            memo=memo or f"task earning approved earning_id={earning_id} task={task_id}",
            metadata={
                "developer_id": developer_id,
                "task_id": task_id,
                "earning_id": earning_id,
                "revision_count": revision_count,
            },
        )
        await self._events.publish(
            TaskEarningAccrued(
                entry_id=entry["entry_id"],
                account_id=accr_acct,
                delta_cents=amount.cents,
                currency=amount.currency,
                actor=actor,
                developer_id=developer_id,
                task_id=task_id,
                earning_id=earning_id,
                module_id=module_id,
                revision_count=revision_count,
            )
        )
        return entry

    async def reverse_task_earning(
        self,
        *,
        earning_id: str,
        actor: str,
        reason: str,
        idempotency_key: str | None = None,
    ) -> dict[str, Any] | None:
        """Phase 2B PR-2 — reverse a previously-accrued task earning.

        Used when (a) QA result downgrades a previously-approved earning, or
        (b) admin manually voids an earning. We find the most-recent accrual
        entry for this `earning_id` and append a compensating negative entry.

        Returns the reversal entry, or `None` if no prior accrual exists
        (idempotent — safe to call when nothing was ever accrued).
        """
        original = await self._ledger.collection.find_one(
            {
                "kind": "task_earning_accrued",
                "metadata.earning_id": earning_id,
            },
            sort=[("occurred_at", -1)],
            projection={"_id": 0},
        )
        if not original:
            return None

        idem = idempotency_key or f"task_earning_reversed:{earning_id}:{original['entry_id']}"
        reverse = await self._ledger.append(
            entry_id=_entry(),
            account_id=original["account_id"],
            delta_cents=-original["delta_cents"],
            currency=original.get("currency", "USD"),
            kind="task_earning_reversed",
            actor=actor,
            idempotency_key=idem,
            project_id=original.get("project_id"),
            module_id=original.get("module_id"),
            memo=f"reversal of accrual {original['entry_id']}: {reason}",
            metadata={
                "developer_id": original.get("metadata", {}).get("developer_id"),
                "earning_id": earning_id,
                "reversed_entry_id": original["entry_id"],
                "reason": reason,
            },
        )
        await self._events.publish(
            TaskEarningReversed(
                entry_id=reverse["entry_id"],
                account_id=original["account_id"],
                delta_cents=-original["delta_cents"],
                currency=original.get("currency", "USD"),
                actor=actor,
                developer_id=original.get("metadata", {}).get("developer_id", ""),
                earning_id=earning_id,
                reversed_entry_id=original["entry_id"],
                reason=reason,
            )
        )
        return reverse

    async def process_payout(
        self,
        *,
        developer_id: str,
        amount: Money,
        actor: str,
        payout_batch_id: str,
        external_ref: str = "",
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Developer wallet → external bank.

        The actual money transfer is done by an `infrastructure/payments`
        adapter BEFORE this method is called. This method only records
        the ledger movement once the external transfer is confirmed.
        """
        assert_amount_positive(amount, op="process_payout")
        assert_payout_meets_minimum(amount)

        dev_acct = account_id(AccountKind.DEVELOPER_WALLET, developer_id)
        balance = await self._ledger.balance(dev_acct, currency=amount.currency)
        assert_balance_sufficient(
            op="process_payout",
            account_id=dev_acct,
            current_cents=balance,
            requested_cents=amount.cents,
        )

        idem = idempotency_key or f"payout:{payout_batch_id}:{developer_id}:{amount.cents}"
        ext_acct = account_id(AccountKind.EXTERNAL, developer_id)

        debit = await self._ledger.append(
            entry_id=_entry(),
            account_id=dev_acct,
            delta_cents=-amount.cents,
            currency=amount.currency,
            kind="payout",
            actor=actor,
            idempotency_key=f"{idem}#debit",
            memo=f"payout batch={payout_batch_id}",
            metadata={"developer_id": developer_id, "payout_batch_id": payout_batch_id, "external_ref": external_ref},
        )
        credit = await self._ledger.append(
            entry_id=_entry(),
            account_id=ext_acct,
            delta_cents=amount.cents,
            currency=amount.currency,
            kind="payout",
            actor=actor,
            idempotency_key=f"{idem}#credit",
            memo=f"outbound to bank batch={payout_batch_id}",
            metadata={"source_entry_id": debit["entry_id"], "external_ref": external_ref},
        )

        await self._events.publish(
            PayoutProcessed(
                entry_id=debit["entry_id"],
                account_id=dev_acct,
                delta_cents=-amount.cents,
                currency=amount.currency,
                actor=actor,
                developer_id=developer_id,
                payout_batch_id=payout_batch_id,
                external_ref=external_ref,
            )
        )
        return {"debit": debit, "credit": credit}

    async def reverse_transaction(
        self,
        *,
        original_entry_id: str,
        actor: str,
        reason: str,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Compensating entry — append-only ledgers never delete.

        Reads the original entry and writes its mirror (opposite delta,
        same account). All subscribers see a `TransactionReversed` event.
        """
        original = await self._ledger.collection.find_one(
            {"entry_id": original_entry_id}, {"_id": 0}
        )
        if not original:
            from shared.errors import NotFoundError
            raise NotFoundError(
                "original entry not found for reversal",
                code="money_reversal_target_missing",
                context={"original_entry_id": original_entry_id},
            )

        idem = idempotency_key or f"reverse:{original_entry_id}"

        reverse = await self._ledger.append(
            entry_id=_entry(),
            account_id=original["account_id"],
            delta_cents=-original["delta_cents"],
            currency=original.get("currency", "USD"),
            kind="adjustment",
            actor=actor,
            idempotency_key=idem,
            project_id=original.get("project_id"),
            module_id=original.get("module_id"),
            memo=f"reversal of {original_entry_id}: {reason}",
            metadata={"reversed_entry_id": original_entry_id, "reason": reason},
        )
        await self._events.publish(
            TransactionReversed(
                entry_id=reverse["entry_id"],
                account_id=original["account_id"],
                delta_cents=-original["delta_cents"],
                currency=original.get("currency", "USD"),
                actor=actor,
                reversed_entry_id=original_entry_id,
                reason=reason,
            )
        )
        return reverse

    # ── Read helpers (thin wrappers — prefer subscribing to events) ─────────

    async def balance_for(
        self, kind: AccountKind, owner_ref: str, currency: str = "USD"
    ) -> Money:
        cents = await self._ledger.balance(account_id(kind, owner_ref), currency=currency)
        return Money(cents, currency)

    async def project_movement(self, project_id: str) -> dict[str, int]:
        """Diagnostics: aggregate by kind for a project."""
        return await self._ledger.project_movement(project_id)
