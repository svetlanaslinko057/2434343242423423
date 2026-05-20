"""
Money value objects.

Money is denominated in INTEGER CENTS to avoid float drift. Conversion to
display amounts (dollars) is a presentation concern — domains operate in
cents only.

`AccountId` is a typed wrapper to prevent mixing developer wallets with
client deposit accounts at compile time (even in Python — via prefixes).
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Final

from shared.errors import InvariantViolated

SUPPORTED_CURRENCIES: Final[tuple[str, ...]] = ("USD", "EUR", "UAH")


class AccountKind(str, Enum):
    """Type of money account. The prefix determines the AccountId namespace.

    Why typed prefixes: today's bugs come from passing a developer user_id
    where a client deposit account_id is expected. Prefix collisions are
    caught at boundary.
    """

    CLIENT_DEPOSIT = "client_deposit"   # client's pre-paid balance with us
    ESCROW = "escrow"                    # money held against a project/module
    DEVELOPER_WALLET = "dev_wallet"      # developer earnings pending payout
    VALIDATOR_WALLET = "validator_wallet"
    PLATFORM_REVENUE = "platform"        # our cut (fees)
    EXTERNAL = "external"                # outbound to bank / inbound from card
    EARNINGS_ACCRUAL = "earnings_accrual"  # Phase 2B PR-2: per-task approved-but-unpaid
                                           # earnings, parallel to escrow→dev_wallet flow.
                                           # Source of truth for `task_earnings` collection.

    @property
    def prefix(self) -> str:
        return {
            AccountKind.CLIENT_DEPOSIT: "ac_client",
            AccountKind.ESCROW: "ac_escrow",
            AccountKind.DEVELOPER_WALLET: "ac_dev",
            AccountKind.VALIDATOR_WALLET: "ac_val",
            AccountKind.PLATFORM_REVENUE: "ac_plat",
            AccountKind.EXTERNAL: "ac_ext",
            AccountKind.EARNINGS_ACCRUAL: "ac_accrual",
        }[self]


@dataclass(frozen=True, slots=True)
class AccountId:
    """Typed account identifier with kind + opaque owner reference."""

    kind: AccountKind
    owner_ref: str   # business object id (user_id / project_id / "platform")

    def __str__(self) -> str:
        return f"{self.kind.prefix}:{self.owner_ref}"

    def __post_init__(self) -> None:
        if not self.owner_ref or ":" in self.owner_ref:
            raise InvariantViolated(
                "AccountId.owner_ref must be non-empty and not contain ':'",
                code="money_account_id_invalid",
                context={"owner_ref": self.owner_ref, "kind": self.kind.value},
            )


def account_id(kind: AccountKind, owner_ref: str) -> str:
    """Build a stringified account id — what gets stored in ledger entries."""
    return str(AccountId(kind=kind, owner_ref=owner_ref))


@dataclass(frozen=True, slots=True)
class Money:
    """Integer cents + currency. No floats. No silent precision loss."""

    cents: int
    currency: str = "USD"

    def __post_init__(self) -> None:
        if not isinstance(self.cents, int):
            raise InvariantViolated(
                "Money.cents must be int (no floats — use round-trip via str/decimal upstream)",
                code="money_amount_not_int",
                context={"cents": self.cents, "type": type(self.cents).__name__},
            )
        if self.currency not in SUPPORTED_CURRENCIES:
            raise InvariantViolated(
                f"currency {self.currency!r} is not supported",
                code="money_currency_unsupported",
                context={"currency": self.currency, "allowed": list(SUPPORTED_CURRENCIES)},
            )

    @classmethod
    def zero(cls, currency: str = "USD") -> "Money":
        return cls(0, currency)

    @property
    def is_positive(self) -> bool:
        return self.cents > 0

    @property
    def is_zero(self) -> bool:
        return self.cents == 0

    def negate(self) -> "Money":
        return Money(-self.cents, self.currency)

    def __add__(self, other: "Money") -> "Money":
        if not isinstance(other, Money) or other.currency != self.currency:
            raise InvariantViolated(
                "cannot add Money of different currencies",
                code="money_currency_mismatch",
                context={"left": self.currency, "right": getattr(other, "currency", None)},
            )
        return Money(self.cents + other.cents, self.currency)

    def __sub__(self, other: "Money") -> "Money":
        return self + other.negate()

    def __str__(self) -> str:
        sign = "-" if self.cents < 0 else ""
        major, minor = divmod(abs(self.cents), 100)
        return f"{sign}{self.currency} {major}.{minor:02d}"
