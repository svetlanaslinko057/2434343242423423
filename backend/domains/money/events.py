"""
Money domain events.

Published by MoneyService AFTER a successful ledger append. Subscribers
(wallet projection, dashboard projection, notification dispatcher, audit
log) react to these without coupling to MoneyService internals.

Convention:
  • Every event carries the resulting `entry_id` for traceability
  • Every event carries `account_id` (str form) and `delta_cents`
  • Subscribers MUST be idempotent — events may be re-published in the
    case of restart / replay
"""
from __future__ import annotations

from dataclasses import dataclass, field

from shared.events import DomainEvent


@dataclass(kw_only=True)
class MoneyChanged(DomainEvent):
    """Base for any money movement. Subscribers wanting "any change" listen here.

    Concrete subclasses below carry domain-specific context (project_id,
    module_id, payout_batch_id, etc.) so reactors don't need to fetch the
    ledger to know what happened.
    """
    entry_id: str
    account_id: str
    delta_cents: int
    currency: str = "USD"
    actor: str = ""              # user_id or system component name


@dataclass(kw_only=True)
class EscrowHeld(MoneyChanged):
    """Client funds moved into escrow against a project/module."""
    project_id: str
    module_id: str | None = None
    client_id: str = ""


@dataclass(kw_only=True)
class EscrowReleased(MoneyChanged):
    """Escrow released to developer wallet after acceptance."""
    project_id: str
    module_id: str | None = None
    developer_id: str = ""


@dataclass(kw_only=True)
class EscrowRefunded(MoneyChanged):
    """Escrow refunded back to client (cancellation / dispute resolved against builder)."""
    project_id: str
    module_id: str | None = None
    client_id: str = ""
    reason: str = ""


@dataclass(kw_only=True)
class PlatformFeeCharged(MoneyChanged):
    """Platform fee withheld from a release/payout."""
    source_entry_id: str          # the release/payout this fee derives from
    fee_pct: float = 0.0


@dataclass(kw_only=True)
class ValidatorCredited(MoneyChanged):
    """QA validator earnings for a verified module."""
    validator_id: str
    module_id: str
    qa_decision_id: str = ""


@dataclass(kw_only=True)
class TaskEarningAccrued(MoneyChanged):
    """Phase 2B PR-2 — a per-task earning has been QA-approved.

    This is parallel to `EscrowReleased`: where the latter records the
    module-level escrow → dev_wallet flow, this records the per-task accrual
    of "platform owes developer X for task Y". The legacy `task_earnings`
    collection becomes a projection of these events (Phase 2C).

    Distinguishing field: `task_id` is required; `module_id` is optional.
    """
    developer_id: str
    task_id: str
    earning_id: str
    module_id: str | None = None
    revision_count: int = 0


@dataclass(kw_only=True)
class TaskEarningReversed(MoneyChanged):
    """A previously accrued task earning is being adjusted or cancelled.

    Used when QA result downgrades a previously-approved earning, or when an
    admin manually voids an earning. Carries the reversed `entry_id` for
    audit.
    """
    developer_id: str
    earning_id: str
    reversed_entry_id: str
    reason: str = ""


@dataclass(kw_only=True)
class PayoutProcessed(MoneyChanged):
    """Developer wallet → external bank account."""
    developer_id: str
    payout_batch_id: str
    external_ref: str = ""        # provider transaction id


@dataclass(kw_only=True)
class TransactionReversed(MoneyChanged):
    """An earlier ledger entry was compensated by a reversing entry.

    Append-only ledger does not delete — we append the opposite delta.
    """
    reversed_entry_id: str
    reason: str = ""
