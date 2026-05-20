"""Mock provider — used in dev when WayForPay creds aren't set.

Returns a fake hosted-payment URL pointing back to our own confirm
endpoint so QA can simulate the round-trip without touching real money.
"""
import os
import time
from .base import BasePaymentProvider, PaymentResult, CallbackResult


class MockPaymentProvider(BasePaymentProvider):
    name = "mock"

    async def create_payment(self, invoice: dict, return_url=None) -> PaymentResult:
        order_ref = invoice.get("invoice_id")
        backend = os.getenv("BACKEND_URL", "")
        # The mock URL is a no-op page; in tests we manually POST to
        # /api/payments/mock/confirm to simulate a paid callback.
        url = f"{backend}/api/payments/mock/page?ref={order_ref}"
        return PaymentResult(success=True, payment_url=url, provider_order_id=order_ref)

    async def verify_callback(self, payload: dict) -> CallbackResult:
        # Mock provider always trusts its own callback.
        return CallbackResult(
            valid=True,
            provider_order_id=payload.get("orderReference"),
            invoice_id=payload.get("orderReference"),
            status=(payload.get("status") or "paid").lower(),
            amount=float(payload.get("amount") or 0),
            currency=payload.get("currency", "USD"),
            raw=payload,
            response_body={"orderReference": payload.get("orderReference"), "status": "accept", "time": int(time.time())},
        )
