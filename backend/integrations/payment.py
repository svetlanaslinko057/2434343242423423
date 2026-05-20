"""
PaymentProvider — vendor-neutral checkout + webhook contract.

Live impls: Stripe, WayForPay, PayPal, etc.
Mock impl:  deterministic local URL, no external I/O.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Optional

from .base import Capability, Provider


@dataclass
class CheckoutRequest:
    """Vendor-neutral input for `create_checkout`."""

    invoice_id: str
    amount: float
    currency: str  # ISO 4217: USD, EUR, UAH...
    description: str
    return_url: str
    customer_email: Optional[str] = None
    metadata: dict = field(default_factory=dict)


@dataclass
class CheckoutResult:
    """
    Identical shape across all PaymentProvider implementations.

    UI calls `provider.create_checkout(req)` and expects exactly these fields.
    No `stripe_session_id`, no `wfp_signature` — vendor-specific data lives in
    `provider_ref` (opaque) and `raw` (debug only).
    """

    success: bool
    payment_url: Optional[str]
    """URL to redirect the user to. None if success=False."""
    provider_ref: Optional[str]
    """Opaque vendor-side ID we'll receive back in the webhook."""
    status: str = "pending"
    """`pending` | `paid` | `failed` — initial state from provider."""
    error: Optional[str] = None
    raw: dict = field(default_factory=dict)
    """Debug-only — UI must NEVER read this."""


@dataclass
class PaymentEvent:
    """Normalized webhook event (Этап 5.1)."""

    valid: bool
    invoice_id: Optional[str]
    provider_ref: Optional[str]
    status: str  # `paid` | `failed` | `pending` | `refunded`
    event_type: Optional[str] = None
    """Normalized event name. e.g. `payment_succeeded` | `payment_failed` |
    `payment_refunded` | `checkout_completed`. Vendor-specific event names
    are mapped here by the live adapter — business logic must NOT switch on
    raw vendor strings."""
    amount: Optional[float] = None
    currency: Optional[str] = None
    error: Optional[str] = None
    raw: dict = field(default_factory=dict)


class PaymentProvider(Provider, abc.ABC):
    capability = Capability.PAYMENT

    @abc.abstractmethod
    async def create_checkout(self, req: CheckoutRequest) -> CheckoutResult:
        """Return a payment URL the user can be redirected to."""
        ...

    @abc.abstractmethod
    async def verify_webhook(self, body: bytes, headers: dict) -> PaymentEvent:
        """Verify provider signature and normalize the event."""
        ...
