"""
Master Admin Integrations — single source of truth for runtime-configurable secrets.

Stores all admin-managed integration credentials under a single MongoDB doc:

    db.system_config.find_one({"key": "integrations_settings"})

Shape (every block is optional — admin can clear what they don't need):

    {
      "key": "integrations_settings",
      "email": {
        "provider": "resend",
        "api_key":  "re_…",
        "from_email": "noreply@evax.io",
        "from_name":  "EVA-X"
      },
      "google_auth": {
        "client_id":     "….apps.googleusercontent.com",
        "client_secret": "…"
      },
      "wayforpay": {
        "merchant_account": "y_store_in_ua",
        "secret_key":       "…",
        "merchant_password":"…",
        "domain":           "evax.io",
        "currency":         "UAH",
        "service_url":      "<backend>/api/payments/wayforpay/callback",
        "return_url":       "<frontend>/client/billing"
      },
      "stripe": {
        "publishable_key":  "pk_test_…",
        "secret_key":       "sk_test_…",
        "restricted_key":   "rk_test_…",
        "webhook_secret":   "whsec_…",
        "currency":         "usd"
      },
      "app": {
        "preview_url":  "https://<emergent-preview>.preview.emergentagent.com",
        "active_payment_provider": "stripe" | "wayforpay" | "mock"
      }
    }

The admin UI calls:
  GET  /api/admin/settings/integrations           — read masked view
  PUT  /api/admin/settings/integrations/{block}   — update one block
  POST /api/admin/settings/integrations/{block}/test  — live-test connection
  GET  /api/config/public                         — UN-AUTH public config
                                                    (Stripe publishable, Google
                                                     client_id, app URL, flags)

`get_setting(block)` is the helper every other module uses to fetch the
*current* config — never cached, so admin saves take effect on the next
request without a restart.
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger("admin_integrations")

_db = None  # injected by init_router()

SUPPORTED_BLOCKS = ("email", "google_auth", "wayforpay", "stripe", "app", "payments")


# ----------------------------------------------------------------- internals
def _mask(value: Optional[str], head: int = 6, tail: int = 4) -> str:
    if not value:
        return ""
    if len(value) <= head + tail:
        return "*" * len(value)
    return f"{value[:head]}…{value[-tail:]}"


async def _load_doc() -> dict:
    if _db is None:
        return {}
    doc = await _db.system_config.find_one({"key": "integrations_settings"}, {"_id": 0})
    return doc or {}


async def get_setting(block: str) -> dict:
    """Fetch the current settings block. Always async, always live."""
    doc = await _load_doc()
    return doc.get(block) or {}


async def set_setting(block: str, value: dict) -> dict:
    """Replace one block. Caller passes only the fields to update — we merge."""
    if block not in SUPPORTED_BLOCKS:
        raise ValueError(f"unsupported block: {block}")
    current = await get_setting(block)
    merged = {**current, **{k: v for k, v in value.items() if v is not None}}
    # Empty string clears the field (so admin can wipe a key from the UI)
    merged = {k: v for k, v in merged.items() if v != ""}
    await _db.system_config.update_one(
        {"key": "integrations_settings"},
        {"$set": {"key": "integrations_settings", block: merged}},
        upsert=True,
    )
    return merged


# ----------------------------------------------------------------- public view
def _masked_view(doc: dict) -> dict:
    """Build the admin-readable view: secret keys masked, flags surfaced."""
    email = doc.get("email") or {}
    google = doc.get("google_auth") or {}
    wfp = doc.get("wayforpay") or {}
    stripe = doc.get("stripe") or {}
    app = doc.get("app") or {}
    payments = doc.get("payments") or {}

    return {
        "email": {
            "provider": email.get("provider") or "resend",
            "from_email": email.get("from_email") or "",
            "from_name": email.get("from_name") or "",
            "api_key_masked": _mask(email.get("api_key")),
            "configured": bool(email.get("api_key")),
            "env_fallback": bool(os.environ.get("RESEND_API_KEY")),
        },
        "google_auth": {
            "client_id": google.get("client_id") or "",
            "client_secret_masked": _mask(google.get("client_secret")),
            "configured": bool(google.get("client_id")),
            "env_fallback": bool(os.environ.get("GOOGLE_CLIENT_ID")),
        },
        "wayforpay": {
            "merchant_account": wfp.get("merchant_account") or "",
            "secret_key_masked": _mask(wfp.get("secret_key")),
            "merchant_password_masked": _mask(wfp.get("merchant_password")),
            "domain": wfp.get("domain") or "",
            "currency": wfp.get("currency") or "UAH",
            "service_url": wfp.get("service_url") or "",
            "return_url": wfp.get("return_url") or "",
            "language": wfp.get("language") or "AUTO",
            "order_lifetime": int(wfp.get("order_lifetime") or 600),
            "payment_systems": wfp.get("payment_systems") or ["card", "applepay", "googlepay", "privat24"],
            "configured": bool(wfp.get("merchant_account") and wfp.get("secret_key")),
        },
        "stripe": {
            "publishable_key": stripe.get("publishable_key") or "",
            "secret_key_masked": _mask(stripe.get("secret_key")),
            "restricted_key_masked": _mask(stripe.get("restricted_key")),
            "webhook_secret_masked": _mask(stripe.get("webhook_secret")),
            "currency": stripe.get("currency") or "usd",
            "mode": stripe.get("mode") or "payment",
            "capture_method": stripe.get("capture_method") or "automatic",
            "payment_method_types": stripe.get("payment_method_types") or ["card"],
            "billing_address_collection": stripe.get("billing_address_collection") or "auto",
            "phone_number_collection": bool(stripe.get("phone_number_collection")),
            "customer_creation": stripe.get("customer_creation") or "if_required",
            "submit_type": stripe.get("submit_type") or "auto",
            "save_payment_method": bool(stripe.get("save_payment_method")),
            "configured": bool(stripe.get("secret_key")),
        },
        "app": {
            "preview_url": app.get("preview_url") or "",
            "active_payment_provider": app.get("active_payment_provider") or "auto",
        },
        "payments": {
            "default_currency": payments.get("default_currency") or "usd",
            "allowed_currencies": payments.get("allowed_currencies") or ["usd", "eur", "uah"],
            "min_amount": float(payments.get("min_amount") or 1.0),
            "max_amount": float(payments.get("max_amount") or 100000.0),
            "platform_fee_percent": float(payments.get("platform_fee_percent") or 0.0),
            "tax_rate_percent": float(payments.get("tax_rate_percent") or 0.0),
            "tax_behavior": payments.get("tax_behavior") or "exclusive",
            "allow_promotion_codes": bool(payments.get("allow_promotion_codes")),
            "automatic_tax": bool(payments.get("automatic_tax")),
            "locale": payments.get("locale") or "auto",
            "statement_descriptor": payments.get("statement_descriptor") or "EVA-X",
            "success_path": payments.get("success_path") or "/api/web-ui/client/billing?status=success",
            "cancel_path": payments.get("cancel_path") or "/api/web-ui/client/billing?status=cancel",
            "refund_window_days": int(payments.get("refund_window_days") or 14),
        },
    }


# ----------------------------------------------------------------- pydantic
class EmailUpdate(BaseModel):
    api_key: Optional[str] = None
    from_email: Optional[str] = None
    from_name: Optional[str] = None
    provider: Optional[str] = None


class GoogleAuthUpdate(BaseModel):
    client_id: Optional[str] = None
    client_secret: Optional[str] = None


class WayForPayUpdate(BaseModel):
    merchant_account: Optional[str] = None
    secret_key: Optional[str] = None
    merchant_password: Optional[str] = None
    domain: Optional[str] = None
    currency: Optional[str] = None
    service_url: Optional[str] = None
    return_url: Optional[str] = None
    language: Optional[str] = None  # 'AUTO' | 'UA' | 'EN' | 'RU'
    order_lifetime: Optional[int] = None  # seconds
    payment_systems: Optional[list] = None  # ['card','applepay','googlepay','privat24','masterpass']


class StripeUpdate(BaseModel):
    publishable_key: Optional[str] = None
    secret_key: Optional[str] = None
    restricted_key: Optional[str] = None
    webhook_secret: Optional[str] = None
    currency: Optional[str] = None
    mode: Optional[str] = None  # 'payment' | 'subscription'
    capture_method: Optional[str] = None  # 'automatic' | 'manual'
    payment_method_types: Optional[list] = None
    billing_address_collection: Optional[str] = None  # 'auto' | 'required'
    phone_number_collection: Optional[bool] = None
    customer_creation: Optional[str] = None  # 'always' | 'if_required'
    submit_type: Optional[str] = None  # 'auto' | 'pay' | 'book' | 'donate'
    save_payment_method: Optional[bool] = None


class PaymentsUpdate(BaseModel):
    default_currency: Optional[str] = None
    allowed_currencies: Optional[list] = None
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    platform_fee_percent: Optional[float] = None
    tax_rate_percent: Optional[float] = None
    tax_behavior: Optional[str] = None
    allow_promotion_codes: Optional[bool] = None
    automatic_tax: Optional[bool] = None
    locale: Optional[str] = None
    statement_descriptor: Optional[str] = None
    success_path: Optional[str] = None
    cancel_path: Optional[str] = None
    refund_window_days: Optional[int] = None


class AppUpdate(BaseModel):
    preview_url: Optional[str] = None
    active_payment_provider: Optional[str] = None  # 'auto' | 'stripe' | 'wayforpay' | 'mock'


# ----------------------------------------------------------------- seeding
DEFAULT_SEED = {
    # User-provided test keys (May 2026). Admin can rotate these from the UI.
    "wayforpay": {
        "merchant_account": "y_store_in_ua",
        "secret_key": "4f27e43c7052b31c5df78863e0119b51b1e406ef",
        "merchant_password": "a6fcf5fe2a413bdd25bb8b2e7100663a",
        "domain": "evax.io",
        "currency": "UAH",
        "language": "AUTO",
        "order_lifetime": 600,
        "payment_systems": ["card", "applepay", "googlepay", "privat24"],
    },
    "stripe": {
        "publishable_key": "pk_test_51TP0ROBXF2ZAbV1VYJ4kSYk60ImPBed3hZ5S4u3Dc7egaiqxmHU6F2Gn4wVD4eEaCPXneGJmtrJhbzbYA2IB90da00dkoOhmyV",
        "secret_key": "sk_test_51TP0ROBXF2ZAbV1VCkyMZRRpfLZ44sEh8A1Y0SSNohBftnduaQmaXgekWgsR7NwszeUy84K701AZoO9igmlO10HH00jpPTVDHl",
        "restricted_key": "rk_test_51TP0ROBXF2ZAbV1V1e0ziiE2khT8XFL2fflgjrHM7vESaABhHyX6Q6VdnwMQ9DNB0d4lguE18sjIKUERZJ9XCmaH00Jbz6gvI9",
        "currency": "usd",
        "mode": "payment",
        "capture_method": "automatic",
        "payment_method_types": ["card"],
        "billing_address_collection": "auto",
        "phone_number_collection": False,
        "customer_creation": "if_required",
        "submit_type": "auto",
        "save_payment_method": False,
    },
    "app": {
        "preview_url": os.environ.get("APP_URL") or os.environ.get("BACKEND_URL") or "",
        "active_payment_provider": "auto",
    },
    "payments": {
        "default_currency": "usd",
        "allowed_currencies": ["usd", "eur", "uah"],
        "min_amount": 1.0,
        "max_amount": 100000.0,
        "platform_fee_percent": 0.0,
        "tax_rate_percent": 0.0,
        "tax_behavior": "exclusive",
        "allow_promotion_codes": True,
        "automatic_tax": False,
        "locale": "auto",
        "statement_descriptor": "EVA-X",
        "success_path": "/api/web-ui/client/billing?status=success&session_id={CHECKOUT_SESSION_ID}",
        "cancel_path": "/api/web-ui/client/billing?status=cancel",
        "refund_window_days": 14,
    },
}


async def seed_defaults_if_empty(db) -> None:
    """One-shot seed on first boot. Safe to call repeatedly — only fills empty blocks."""
    doc = await db.system_config.find_one({"key": "integrations_settings"}) or {}
    update: dict = {}
    for block, defaults in DEFAULT_SEED.items():
        if not doc.get(block):
            update[block] = defaults
    if update:
        await db.system_config.update_one(
            {"key": "integrations_settings"},
            {"$set": {"key": "integrations_settings", **update}},
            upsert=True,
        )
        logger.info(
            f"INTEGRATIONS seed: added blocks={list(update.keys())} "
            f"(admin can rotate from /admin/integrations)"
        )


# ----------------------------------------------------------------- router
def init_router(db, admin_dep, public_url_helper=None) -> APIRouter:
    """Mounts /api/admin/settings/integrations and /api/config/public."""
    global _db
    _db = db

    router = APIRouter(tags=["admin-integrations"])

    # ----------- ADMIN: read full masked view --------------------
    @router.get("/api/admin/settings/integrations")
    async def read_all(_admin=Depends(admin_dep)):
        doc = await _load_doc()
        return _masked_view(doc)

    # ----------- ADMIN: per-block updaters -----------------------
    @router.put("/api/admin/settings/integrations/email")
    async def update_email(payload: EmailUpdate, _admin=Depends(admin_dep)):
        await set_setting("email", payload.dict())
        # Hot-apply to the running email_service module
        try:
            import email_service
            email_service.set_runtime_config(await get_setting("email"))
        except Exception as e:
            logger.warning(f"email_service hot-reload skipped: {e}")
        return _masked_view(await _load_doc())

    @router.put("/api/admin/settings/integrations/google_auth")
    async def update_google(payload: GoogleAuthUpdate, _admin=Depends(admin_dep)):
        await set_setting("google_auth", payload.dict())
        return _masked_view(await _load_doc())

    @router.put("/api/admin/settings/integrations/wayforpay")
    async def update_wfp(payload: WayForPayUpdate, _admin=Depends(admin_dep)):
        await set_setting("wayforpay", payload.dict())
        return _masked_view(await _load_doc())

    @router.put("/api/admin/settings/integrations/stripe")
    async def update_stripe(payload: StripeUpdate, _admin=Depends(admin_dep)):
        await set_setting("stripe", payload.dict())
        return _masked_view(await _load_doc())

    @router.put("/api/admin/settings/integrations/app")
    async def update_app(payload: AppUpdate, _admin=Depends(admin_dep)):
        # Validate active_payment_provider
        if payload.active_payment_provider:
            if payload.active_payment_provider not in {"auto", "stripe", "wayforpay", "mock"}:
                raise HTTPException(
                    status_code=400,
                    detail="active_payment_provider must be one of: auto, stripe, wayforpay, mock",
                )
        await set_setting("app", payload.dict())
        return _masked_view(await _load_doc())

    @router.put("/api/admin/settings/integrations/payments")
    async def update_payments(payload: PaymentsUpdate, _admin=Depends(admin_dep)):
        # Sanity-check currency lists & ranges
        if payload.tax_behavior and payload.tax_behavior not in {"inclusive", "exclusive", "unspecified"}:
            raise HTTPException(status_code=400, detail="tax_behavior must be inclusive|exclusive|unspecified")
        if payload.min_amount is not None and payload.min_amount < 0:
            raise HTTPException(status_code=400, detail="min_amount must be >= 0")
        if payload.platform_fee_percent is not None and not (0 <= payload.platform_fee_percent <= 50):
            raise HTTPException(status_code=400, detail="platform_fee_percent must be 0-50")
        if payload.tax_rate_percent is not None and not (0 <= payload.tax_rate_percent <= 50):
            raise HTTPException(status_code=400, detail="tax_rate_percent must be 0-50")
        body = payload.dict()
        # Lists must be persisted even if empty (admin might disable a currency)
        if payload.allowed_currencies is not None:
            body["allowed_currencies"] = [c.lower() for c in payload.allowed_currencies]
        await set_setting("payments", body)
        return _masked_view(await _load_doc())

    # ----------- ADMIN: live test-checkout -----------------------
    @router.post("/api/admin/settings/integrations/test-checkout")
    async def live_test_checkout(body: dict, request: Request, _admin=Depends(admin_dep)):
        """Create a real Stripe Checkout Session using the *current* admin
        config and return the hosted URL. Admin clicks → lands on Stripe
        test card form → can verify the entire pipeline with one click.

        Body: { provider: 'stripe'|'wayforpay', amount: float, currency: 'usd' }
        """
        provider = (body.get("provider") or "stripe").lower()
        amount = float(body.get("amount") or 1.0)
        if amount <= 0:
            raise HTTPException(status_code=400, detail="amount must be > 0")

        doc = await _load_doc()
        pay_cfg = doc.get("payments") or {}
        currency = (body.get("currency") or pay_cfg.get("default_currency") or "usd").lower()
        allowed = [c.lower() for c in (pay_cfg.get("allowed_currencies") or ["usd"])]
        if currency not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"currency '{currency}' not in allowed list {allowed}",
            )
        if amount < float(pay_cfg.get("min_amount") or 1.0):
            raise HTTPException(status_code=400, detail="amount below min_amount")
        if amount > float(pay_cfg.get("max_amount") or 100000.0):
            raise HTTPException(status_code=400, detail="amount above max_amount")

        if provider == "stripe":
            stripe_cfg = doc.get("stripe") or {}
            secret = (stripe_cfg.get("secret_key") or "").strip()
            if not secret:
                raise HTTPException(status_code=503, detail="Stripe secret_key not configured")
            try:
                import stripe as stripe_lib
                stripe_lib.api_key = secret

                # Resolve URLs (admin app.preview_url > request origin)
                app_cfg = doc.get("app") or {}
                base = (app_cfg.get("preview_url") or "").rstrip("/")
                if not base:
                    base = f"{request.url.scheme}://{request.headers.get('host', '')}"
                success_path = pay_cfg.get("success_path") or "/api/web-ui/client/billing?status=success&session_id={CHECKOUT_SESSION_ID}"
                cancel_path = pay_cfg.get("cancel_path") or "/api/web-ui/client/billing?status=cancel"
                success_url = success_path if success_path.startswith("http") else f"{base}{success_path}"
                cancel_url = cancel_path if cancel_path.startswith("http") else f"{base}{cancel_path}"

                # Build Stripe Checkout Session with admin's full config
                line_item = {
                    "price_data": {
                        "currency": currency,
                        "product_data": {"name": body.get("description") or "Admin live test"},
                        "unit_amount": int(round(amount * 100)),
                    },
                    "quantity": 1,
                }
                if pay_cfg.get("tax_behavior") in {"inclusive", "exclusive"}:
                    line_item["price_data"]["tax_behavior"] = pay_cfg["tax_behavior"]

                params = {
                    "mode": stripe_cfg.get("mode") or "payment",
                    "line_items": [line_item],
                    "success_url": success_url,
                    "cancel_url": cancel_url,
                    "payment_method_types": stripe_cfg.get("payment_method_types") or ["card"],
                    "metadata": {"test": "1", "admin_live_test": "1"},
                }
                if (stripe_cfg.get("billing_address_collection") or "auto") != "auto":
                    params["billing_address_collection"] = stripe_cfg["billing_address_collection"]
                if stripe_cfg.get("phone_number_collection"):
                    params["phone_number_collection"] = {"enabled": True}
                if stripe_cfg.get("customer_creation") in {"always", "if_required"}:
                    params["customer_creation"] = stripe_cfg["customer_creation"]
                if stripe_cfg.get("submit_type") in {"auto", "pay", "book", "donate"} and params["mode"] == "payment":
                    if stripe_cfg["submit_type"] != "auto":
                        params["submit_type"] = stripe_cfg["submit_type"]
                if pay_cfg.get("allow_promotion_codes"):
                    params["allow_promotion_codes"] = True
                if pay_cfg.get("automatic_tax"):
                    params["automatic_tax"] = {"enabled": True}
                if pay_cfg.get("locale") and pay_cfg["locale"] != "auto":
                    params["locale"] = pay_cfg["locale"]
                if pay_cfg.get("statement_descriptor") and params["mode"] == "payment":
                    params["payment_intent_data"] = {
                        "statement_descriptor_suffix": pay_cfg["statement_descriptor"][:22],
                        "capture_method": stripe_cfg.get("capture_method") or "automatic",
                    }

                session = stripe_lib.checkout.Session.create(**params)
                return {
                    "ok": True,
                    "provider": "stripe",
                    "session_id": session.id,
                    "url": session.url,
                    "amount": amount,
                    "currency": currency,
                    "expires_at": session.expires_at,
                }
            except Exception as e:
                logger.exception("live_test_checkout stripe failed")
                return {"ok": False, "error": f"{type(e).__name__}: {e}"[:400]}

        if provider == "wayforpay":
            wfp_cfg = doc.get("wayforpay") or {}
            if not (wfp_cfg.get("merchant_account") and wfp_cfg.get("secret_key")):
                raise HTTPException(status_code=503, detail="WayForPay not configured")
            # Build a one-off invoice dict and ask the WFP provider to construct the URL.
            from payment_providers.wayforpay import WayForPayProvider
            p = WayForPayProvider()
            for k in ("merchant_account", "secret_key", "domain", "currency"):
                if wfp_cfg.get(k):
                    setattr(p, k, wfp_cfg[k])
            inv = {
                "invoice_id": f"test-{uuid.uuid4().hex[:12]}",
                "amount": amount,
                "currency": (body.get("currency") or wfp_cfg.get("currency") or "UAH").upper(),
                "client_id": "admin-live-test",
                "project_id": "admin-live-test",
                "description": body.get("description") or "Admin live test",
            }
            base = (doc.get("app", {}).get("preview_url") or "").rstrip("/")
            try:
                result = await p.create_payment(inv, return_url=f"{base}/api/web-ui/client/billing?status=test")
                if not result.success:
                    return {"ok": False, "error": result.error}
                return {
                    "ok": True,
                    "provider": "wayforpay",
                    "url": result.payment_url,
                    "order_id": result.provider_order_id,
                    "amount": amount,
                    "currency": inv["currency"],
                }
            except Exception as e:
                logger.exception("live_test_checkout wayforpay failed")
                return {"ok": False, "error": f"{type(e).__name__}: {e}"[:400]}

        raise HTTPException(status_code=400, detail=f"unsupported provider: {provider}")

    # ----------- ADMIN: live tests -------------------------------
    @router.post("/api/admin/settings/integrations/email/test")
    async def test_email(body: dict, _admin=Depends(admin_dep)):
        """Send a one-off test email to whatever address admin types in."""
        try:
            import email_service
            email_service.set_runtime_config(await get_setting("email"))
            if not email_service.is_configured():
                return {"ok": False, "error": "RESEND_API_KEY not configured (set it above and save first)"}
            to = (body.get("to") or "").strip().lower()
            if not to:
                raise HTTPException(status_code=400, detail="to (email) required")
            msg_id = await email_service.send_otp_email(to, "000000", ttl_minutes=10)
            return {"ok": True, "message_id": msg_id, "to": to}
        except Exception as e:
            return {"ok": False, "error": str(e)[:300]}

    @router.post("/api/admin/settings/integrations/stripe/test")
    async def test_stripe(_admin=Depends(admin_dep)):
        """Verify the secret key by trying to retrieve account info."""
        cfg = await get_setting("stripe")
        secret = (cfg.get("secret_key") or "").strip()
        if not secret:
            return {"ok": False, "error": "Stripe secret_key not configured"}
        try:
            import stripe as stripe_lib
            stripe_lib.api_key = secret
            acct = stripe_lib.Account.retrieve()
            # `acct` is a stripe.Account object — supports both attribute and dict access.
            return {
                "ok": True,
                "account_id": getattr(acct, "id", None) or acct["id"],
                "country": getattr(acct, "country", None),
                "default_currency": getattr(acct, "default_currency", None),
                "charges_enabled": getattr(acct, "charges_enabled", None),
                "details_submitted": getattr(acct, "details_submitted", None),
            }
        except Exception as e:
            return {"ok": False, "error": f"{type(e).__name__}: {e}"[:300]}

    @router.post("/api/admin/settings/integrations/wayforpay/test")
    async def test_wfp(_admin=Depends(admin_dep)):
        cfg = await get_setting("wayforpay")
        if not cfg.get("merchant_account") or not cfg.get("secret_key"):
            return {"ok": False, "error": "WayForPay merchant_account/secret_key not configured"}
        # WayForPay has no /me endpoint — best we can do is verify creds shape
        return {
            "ok": True,
            "merchant_account": cfg["merchant_account"],
            "secret_key_length": len(cfg["secret_key"]),
            "domain": cfg.get("domain") or "(missing — set domain to receive payments)",
            "note": "WayForPay does not expose a /me endpoint; live verification happens on first invoice.",
        }

    @router.post("/api/admin/settings/integrations/google_auth/test")
    async def test_google(_admin=Depends(admin_dep)):
        cfg = await get_setting("google_auth")
        if not cfg.get("client_id"):
            return {"ok": False, "error": "Google client_id not configured"}
        # Validate format only (we can't sign-in test from server side)
        cid = cfg["client_id"]
        if not cid.endswith(".apps.googleusercontent.com"):
            return {
                "ok": False,
                "error": "client_id does not look like a valid Google OAuth Client ID (should end with .apps.googleusercontent.com)",
            }
        return {
            "ok": True,
            "client_id": cid,
            "note": "Client ID format valid. Real verification happens on user sign-in.",
        }

    # ----------- PUBLIC: config every frontend needs -------------
    @router.get("/api/config/public")
    async def public_config(request: Request):
        """No auth required. Returns ONLY public-safe config (no secrets).

        Frontends call this on boot to hydrate Stripe.js, Google Sign-In and
        the dynamic preview URL. When the admin saves a new key in the
        admin panel, the next reload of any client picks it up — no
        rebuild, no env change."""
        doc = await _load_doc()
        stripe_cfg = doc.get("stripe") or {}
        google_cfg = doc.get("google_auth") or {}
        app_cfg = doc.get("app") or {}

        # Resolve preview URL: admin override > request origin > env
        preview_url = app_cfg.get("preview_url") or ""
        if not preview_url:
            origin = request.headers.get("origin") or ""
            host = request.headers.get("host") or ""
            scheme = "https" if request.url.scheme == "https" else "http"
            preview_url = origin or (f"{scheme}://{host}" if host else "")

        return {
            "stripe": {
                "enabled": bool(stripe_cfg.get("secret_key")),
                "publishable_key": stripe_cfg.get("publishable_key") or "",
                "currency": stripe_cfg.get("currency") or "usd",
            },
            "google": {
                "enabled": bool(google_cfg.get("client_id")),
                "client_id": google_cfg.get("client_id") or "",
            },
            "wayforpay": {
                "enabled": bool((doc.get("wayforpay") or {}).get("merchant_account")),
            },
            "app": {
                "preview_url": preview_url,
                "active_payment_provider": app_cfg.get("active_payment_provider") or "auto",
            },
        }

    return router
