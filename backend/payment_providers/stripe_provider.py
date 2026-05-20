"""Stripe payment provider — admin-configurable secret key.

Uses `emergentintegrations.payments.stripe.checkout.StripeCheckout` per the
Emergent Stripe playbook so the same library handles checkout creation,
status polling, and webhook signature verification.

Conforms to BasePaymentProvider so the rest of the app keeps using the
same interface (create_payment / verify_callback) regardless of provider.
"""
from __future__ import annotations

import logging
from typing import Optional

from .base import BasePaymentProvider, PaymentResult, CallbackResult

logger = logging.getLogger(__name__)


class StripeProvider(BasePaymentProvider):
    name = "stripe"

    def __init__(
        self,
        secret_key: str,
        webhook_url: str,
        success_url: str,
        cancel_url: str,
        webhook_secret: Optional[str] = None,
        currency: str = "usd",
    ) -> None:
        self.secret_key = secret_key
        self.webhook_url = webhook_url
        self.success_url = success_url
        self.cancel_url = cancel_url
        self.webhook_secret = webhook_secret or ""
        self.currency = currency or "usd"

    def _checkout(self):
        # Lazy import — keeps server boot fast and avoids
        # crashing the whole backend if the lib is missing.
        from emergentintegrations.payments.stripe.checkout import StripeCheckout
        return StripeCheckout(api_key=self.secret_key, webhook_url=self.webhook_url)

    async def create_payment(self, invoice: dict, return_url: Optional[str] = None) -> PaymentResult:
        from emergentintegrations.payments.stripe.checkout import CheckoutSessionRequest

        amount = float(invoice.get("amount") or 0)
        if amount <= 0:
            return PaymentResult(success=False, error="invoice amount must be > 0")

        # Per playbook: Stripe expects float amounts (1.00, not 100 cents).
        # Currency: prefer admin's configured Stripe currency, else invoice's.
        currency = (invoice.get("currency") or self.currency or "usd").lower()
        # Stripe's API supports many currencies; UAH only via card+conversion,
        # so we default invoices in UAH to USD when going through Stripe.
        if currency == "uah":
            currency = "usd"

        success = (return_url or self.success_url).rstrip("/")
        if "session_id=" not in success:
            sep = "&" if "?" in success else "?"
            success = f"{success}{sep}session_id={{CHECKOUT_SESSION_ID}}"

        metadata = {
            "invoice_id": str(invoice.get("invoice_id") or ""),
            "project_id": str(invoice.get("project_id") or ""),
            "client_id": str(invoice.get("client_id") or ""),
        }

        try:
            req = CheckoutSessionRequest(
                amount=amount,
                currency=currency,
                success_url=success,
                cancel_url=self.cancel_url,
                metadata=metadata,
            )
            session = await self._checkout().create_checkout_session(req)
        except Exception as e:
            logger.exception("Stripe create_checkout_session failed")
            return PaymentResult(success=False, error=str(e)[:300])

        return PaymentResult(
            success=True,
            payment_url=session.url,
            provider_order_id=session.session_id,
            raw={"session_id": session.session_id},
        )

    async def verify_callback(self, payload: dict) -> CallbackResult:
        # Stripe webhooks come in via /api/webhook/stripe — server.py handles
        # the raw body + signature header and calls handle_webhook directly.
        # This entry point is kept for interface compatibility (manual poll).
        session_id = payload.get("session_id") or payload.get("orderReference") or ""
        if not session_id:
            return CallbackResult(valid=False, error="session_id missing")
        try:
            status = await self._checkout().get_checkout_status(session_id)
            mapped = "paid" if status.payment_status == "paid" else (
                "pending" if status.status == "open" else "failed"
            )
            return CallbackResult(
                valid=True,
                provider_order_id=session_id,
                invoice_id=(status.metadata or {}).get("invoice_id"),
                status=mapped,
                amount=(status.amount_total or 0) / 100.0,  # checkout returns cents
                currency=status.currency,
                raw={"session_id": session_id, "status": status.status, "payment_status": status.payment_status},
            )
        except Exception as e:
            logger.exception("Stripe verify_callback error")
            return CallbackResult(valid=False, error=str(e)[:300])

    async def get_status(self, session_id: str):
        """Used by /api/payments/stripe/status/{session_id} polling."""
        return await self._checkout().get_checkout_status(session_id)

    async def handle_webhook(self, body: bytes, signature: str):
        """Verify + parse Stripe webhook. Returns the typed event response."""
        return await self._checkout().handle_webhook(body, signature)
