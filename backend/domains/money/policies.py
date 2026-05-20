"""
Money invariants and policy checks.

Pure functions — no I/O. Called by MoneyService BEFORE writing to the
ledger. Each function raises a typed exception with full context, never
returns a boolean (boolean checks invite silent skipping).

Why a separate file: invariants are the most important code in the money
domain. Keeping them in one place makes review easier and lets tests
target them directly.
"""
from __future__ import annotations

from shared.errors import InvariantViolated, PolicyDenied
from shared.constants import (
    PAYOUT_BATCH_MIN_AMOUNT,
    WITHDRAWAL_DEFAULT_FEE_PCT,
)

from .models import Money


def assert_amount_positive(amount: Money, *, op: str) -> None:
    """Most operations require positive amounts. Refunds/reversals use the
    `negate()` helper inside MoneyService, never raw negative inputs from
    callers."""
    if not amount.is_positive:
        raise InvariantViolated(
            f"{op}: amount must be positive, got {amount}",
            code="money_amount_non_positive",
            context={"op": op, "cents": amount.cents, "currency": amount.currency},
        )


def assert_balance_sufficient(
    *,
    op: str,
    account_id: str,
    current_cents: int,
    requested_cents: int,
) -> None:
    """Outgoing transfers must not push an account below zero.

    This is the ONLY place where we enforce non-negativity — it lives next
    to the service, not the repository, because the service computes the
    balance projection right before issuing the debit.
    """
    if current_cents < requested_cents:
        raise PolicyDenied(
            f"{op}: insufficient balance",
            code="money_insufficient_balance",
            context={
                "op": op,
                "account_id": account_id,
                "balance_cents": current_cents,
                "requested_cents": requested_cents,
                "short_cents": requested_cents - current_cents,
            },
        )


def assert_payout_meets_minimum(amount: Money) -> None:
    """Provider fees make tiny payouts uneconomical. Honour the configured floor."""
    min_cents = int(round(PAYOUT_BATCH_MIN_AMOUNT * 100))
    if amount.cents < min_cents:
        raise PolicyDenied(
            f"payout: amount below minimum ({amount} < {PAYOUT_BATCH_MIN_AMOUNT} {amount.currency})",
            code="money_payout_below_min",
            context={
                "amount_cents": amount.cents,
                "min_cents": min_cents,
                "currency": amount.currency,
            },
        )


def default_platform_fee_cents(release_amount: Money) -> int:
    """Default platform fee = WITHDRAWAL_DEFAULT_FEE_PCT of the release.

    Returns INTEGER cents. Rounding policy: round half-to-even (Python default
    via `round`) to avoid systematic bias in our favour or against developers.
    """
    return int(round(release_amount.cents * WITHDRAWAL_DEFAULT_FEE_PCT))
