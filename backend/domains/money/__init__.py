"""
Money — first bounded context.

Public surface:
  MoneyService       — orchestration / use-cases
  EscrowHeld, EscrowReleased, ...  — domain events
  Money              — typed value object (cents + currency)
  PolicyDenied, ... — re-exported invariant errors

Internal rules (enforced by architecture tests):
  • The ONLY module allowed to call `MoneyRepository._insert_one` /
    `db.money_ledger_events.*` / `db.dev_wallets.*` / `db.payments.*` /
    `db.payouts.*` is `domains/money/`.
  • Other code reaches money state via:
      - MoneyService (writes)
      - MoneyRepository projections (reads)
      - subscribing to events (reactions)
"""
from .models import Money, AccountId, AccountKind, account_id
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
    MoneyChanged,
)
from .service import MoneyService

__all__ = [
    "Money",
    "AccountId",
    "AccountKind",
    "account_id",
    "EscrowHeld",
    "EscrowReleased",
    "EscrowRefunded",
    "PayoutProcessed",
    "PlatformFeeCharged",
    "ValidatorCredited",
    "TaskEarningAccrued",
    "TaskEarningReversed",
    "TransactionReversed",
    "MoneyChanged",
    "MoneyService",
]
