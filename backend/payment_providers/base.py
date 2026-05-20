"""Abstract payment provider interface."""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, Any


@dataclass
class PaymentResult:
    success: bool
    payment_url: Optional[str] = None
    provider_order_id: Optional[str] = None
    raw: Optional[dict] = None
    error: Optional[str] = None


@dataclass
class CallbackResult:
    """Outcome of verifying a provider callback."""
    valid: bool
    invoice_id: Optional[str] = None
    provider_order_id: Optional[str] = None
    status: str = "unknown"  # paid | failed | pending | refunded
    amount: Optional[float] = None
    currency: Optional[str] = None
    raw: Optional[dict] = None
    error: Optional[str] = None
    response_body: Optional[Any] = None  # what to send back to provider


class BasePaymentProvider(ABC):
    name: str = "base"

    @abstractmethod
    async def create_payment(self, invoice: dict, return_url: str) -> PaymentResult: ...

    @abstractmethod
    async def verify_callback(self, payload: dict) -> CallbackResult: ...
