"""Phase 4 — Payment Provider Layer.

Provider-agnostic facade. Provider selected at request time from MongoDB
(admin-configurable via /admin/integrations) — falls back to env vars and
finally to the Mock provider so the system never crashes if nothing is
configured.

Resolution order:
  1. Admin override:  app.active_payment_provider in DB (stripe/wayforpay/mock)
  2. Auto-pick:       Stripe configured → stripe; else WayForPay configured → wayforpay
  3. Fallback:        Mock (returns a fake URL — useful in dev / smoke tests)
"""
import logging
import os
from typing import Optional

from .base import BasePaymentProvider, PaymentResult, CallbackResult
from .wayforpay import WayForPayProvider
from .mock import MockPaymentProvider
from .stripe_provider import StripeProvider

logger = logging.getLogger(__name__)


def _build_wayforpay(cfg: dict) -> WayForPayProvider:
    """Build WFP provider with DB-backed config (env still used as last-resort default)."""
    p = WayForPayProvider()
    # Override env-backed defaults with DB values where present.
    if cfg.get("merchant_account"):
        p.merchant_account = cfg["merchant_account"]
    if cfg.get("secret_key"):
        p.secret_key = cfg["secret_key"]
    if cfg.get("domain"):
        p.domain = cfg["domain"]
    if cfg.get("currency"):
        p.currency = cfg["currency"]
    if cfg.get("service_url"):
        p.service_url = cfg["service_url"]
    if cfg.get("return_url"):
        p.return_url_default = cfg["return_url"]
    return p


def _build_stripe(cfg: dict, app_cfg: dict) -> Optional[StripeProvider]:
    secret = (cfg.get("secret_key") or "").strip()
    if not secret:
        return None
    base = (app_cfg.get("preview_url") or os.environ.get("BACKEND_URL") or "").rstrip("/")
    success = f"{base}/api/web-ui/client/billing"  # contains {CHECKOUT_SESSION_ID} placeholder appended by provider
    cancel = f"{base}/api/web-ui/client/billing"
    webhook = f"{base}/api/webhook/stripe"
    return StripeProvider(
        secret_key=secret,
        webhook_url=webhook,
        success_url=success,
        cancel_url=cancel,
        webhook_secret=cfg.get("webhook_secret") or "",
        currency=cfg.get("currency") or "usd",
    )


async def get_provider(db=None) -> BasePaymentProvider:
    """Pick the active payment provider from DB settings.

    Synchronous fallback when `db` is None (used by tests / cold startup) —
    returns Mock to avoid crashes.
    """
    if db is None:
        return MockPaymentProvider()

    doc = await db.system_config.find_one({"key": "integrations_settings"}, {"_id": 0}) or {}
    app_cfg = doc.get("app") or {}
    stripe_cfg = doc.get("stripe") or {}
    wfp_cfg = doc.get("wayforpay") or {}

    forced = (app_cfg.get("active_payment_provider") or "auto").lower()

    if forced == "stripe":
        sp = _build_stripe(stripe_cfg, app_cfg)
        if sp:
            return sp
        logger.warning("payment: forced=stripe but secret_key missing — falling back to mock")
        return MockPaymentProvider()

    if forced == "wayforpay":
        if wfp_cfg.get("merchant_account") and wfp_cfg.get("secret_key"):
            return _build_wayforpay(wfp_cfg)
        logger.warning("payment: forced=wayforpay but creds missing — falling back to mock")
        return MockPaymentProvider()

    if forced == "mock":
        return MockPaymentProvider()

    # forced == "auto": prefer Stripe if configured, else WayForPay, else Mock
    sp = _build_stripe(stripe_cfg, app_cfg)
    if sp:
        return sp
    if wfp_cfg.get("merchant_account") and wfp_cfg.get("secret_key"):
        return _build_wayforpay(wfp_cfg)
    return MockPaymentProvider()


__all__ = [
    "BasePaymentProvider",
    "PaymentResult",
    "CallbackResult",
    "get_provider",
    "StripeProvider",
    "WayForPayProvider",
    "MockPaymentProvider",
]
