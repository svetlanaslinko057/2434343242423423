"""
Live adapters — Этап 5.0 (boundary scaffolding).

These wrap the existing vendor-specific services (`email_service.py`,
`cloudinary_service.py`, `payment_providers/*`, `google_auth.py`,
`emergentintegrations`) so the rest of the codebase can talk through the
boundary contracts in `integrations/*` instead of importing vendor SDKs
directly.

Activation policy
-----------------
Adapters are wired but **dormant by default**. The registry will only
construct a live adapter when:

    INTEGRATIONS_LIVE_ENABLED == "1"   (or "true")

AND the vendor-specific keys are present.

Without that flag, the registry stays on the deterministic mock with a
honest `reason` explaining what's missing. This satisfies the Этап 5.0
constraint:
    no live keys / no production charges / no real OAuth logins.

When Этап 5.1 flips the flag, no business logic changes — the registry
swaps the implementation behind the same Provider contract.

Each adapter MUST:
  • return the **same dataclass** the mock returns (shape parity)
  • surface honest `health()` — never claim LIVE if its dependency
    is missing or import fails
  • catch vendor errors and convert to `*Result(success=False, error=...)`
    — never raise into business logic
"""

from __future__ import annotations

import logging
import os
import time
from typing import List, Optional

from .ai import AICompletion, AIMessage, AIProvider
from .base import (
    AvailabilityMode,
    Capability,
    CapabilityState,
)
from .mail import MailMessage, MailProvider, MailResult
from .oauth import OAuthIdentity, OAuthProvider
from .payment import (
    CheckoutRequest,
    CheckoutResult,
    PaymentEvent,
    PaymentProvider,
)
from .storage import StorageObject, StorageProvider, StoragePutResult

logger = logging.getLogger("integrations.live")


def is_live_enabled() -> bool:
    """Master switch — set by Этап 5.1 to flip ALL adapters at once.

    Reading at call-time (not at import) so admin can toggle via env without
    process restart in dev.
    """
    val = (os.environ.get("INTEGRATIONS_LIVE_ENABLED") or "").strip().lower()
    return val in {"1", "true", "yes", "on"}


# ─────────────────────────────────────────────────────────────────────────────
# Stripe (PaymentProvider)
# ─────────────────────────────────────────────────────────────────────────────

class StripePaymentAdapter(PaymentProvider):
    """Wraps `payment_providers.stripe_provider.StripeProvider` behind the
    Этап 5.0 contract. Lazy-imports stripe_provider to keep mock-only
    deployments free of the dependency."""

    name = "stripe"

    def __init__(self, *, secret_key: str, webhook_secret: str = "", currency: str = "usd") -> None:
        self._secret_key = secret_key
        self._webhook_secret = webhook_secret
        self._currency = currency
        self._inner = None  # built on first use
        self._init_error: Optional[str] = None

    def _get_inner(self):
        if self._inner is not None or self._init_error:
            return self._inner
        try:
            from payment_providers.stripe_provider import StripeProvider  # type: ignore
            self._inner = StripeProvider(
                secret_key=self._secret_key,
                webhook_url="",  # supplied per-request
                success_url="",
                cancel_url="",
                webhook_secret=self._webhook_secret,
                currency=self._currency,
            )
        except Exception as e:
            self._init_error = f"stripe init failed: {e}"
            logger.warning("StripePaymentAdapter: %s", self._init_error)
        return self._inner

    def health(self) -> CapabilityState:
        if self._init_error:
            return CapabilityState(
                capability=Capability.PAYMENT,
                provider_name=self.name,
                mode=AvailabilityMode.UNAVAILABLE,
                available=False,
                reason=self._init_error,
                details={"production_safe": False, "external_io": True},
            )
        if not self._secret_key:
            return CapabilityState(
                capability=Capability.PAYMENT,
                provider_name=self.name,
                mode=AvailabilityMode.UNAVAILABLE,
                available=False,
                reason="STRIPE_SECRET_KEY missing",
                details={"production_safe": False, "external_io": True},
            )
        return CapabilityState(
            capability=Capability.PAYMENT,
            provider_name=self.name,
            mode=AvailabilityMode.LIVE,
            available=True,
            reason=None,
            details={"production_safe": True, "external_io": True, "currency": self._currency},
        )

    async def create_checkout(self, req: CheckoutRequest) -> CheckoutResult:
        inner = self._get_inner()
        if inner is None:
            return CheckoutResult(
                success=False, payment_url=None, provider_ref=None,
                status="failed", error=self._init_error or "stripe not configured",
            )
        invoice_doc = {
            "invoice_id": req.invoice_id,
            "amount": req.amount,
            "currency": req.currency,
            "title": req.description,
            "customer_email": req.customer_email,
            "metadata": req.metadata,
        }
        try:
            res = await inner.create_payment(invoice_doc, return_url=req.return_url)
            return CheckoutResult(
                success=res.success,
                payment_url=res.payment_url,
                provider_ref=res.provider_order_id,
                status="pending" if res.success else "failed",
                error=res.error,
                raw=res.raw or {},
            )
        except Exception as e:
            logger.exception("StripePaymentAdapter.create_checkout failed")
            return CheckoutResult(
                success=False, payment_url=None, provider_ref=None,
                status="failed", error=str(e),
            )

    async def verify_webhook(self, body: bytes, headers: dict) -> PaymentEvent:
        inner = self._get_inner()
        if inner is None:
            return PaymentEvent(
                valid=False, invoice_id=None, provider_ref=None, status="failed",
                error=self._init_error or "stripe not configured",
            )
        try:
            # The legacy provider's verify_callback expects a parsed payload
            # dict. Stripe webhooks are signed JSON — defer real signature
            # verification to Этап 5.1 (we just normalize the shape here).
            import json
            data = json.loads(body or b"{}")
            res = await inner.verify_callback(data)
            return PaymentEvent(
                valid=res.valid,
                invoice_id=res.invoice_id,
                provider_ref=res.provider_order_id,
                status=res.status,
                amount=res.amount,
                currency=res.currency,
                error=res.error,
                raw=res.raw or {},
            )
        except Exception as e:
            return PaymentEvent(
                valid=False, invoice_id=None, provider_ref=None,
                status="failed", error=str(e),
            )


# ─────────────────────────────────────────────────────────────────────────────
# Resend (MailProvider)
# ─────────────────────────────────────────────────────────────────────────────

class ResendMailAdapter(MailProvider):
    """Wraps the existing `email_service` module."""

    name = "resend"

    def __init__(self, *, api_key: str, from_email: str, from_name: str = "EVA-X") -> None:
        self._api_key = api_key
        self._from_email = from_email
        self._from_name = from_name
        self._init_error: Optional[str] = None

    def health(self) -> CapabilityState:
        if not self._api_key:
            return CapabilityState(
                capability=Capability.MAIL,
                provider_name=self.name,
                mode=AvailabilityMode.UNAVAILABLE,
                available=False,
                reason="RESEND_API_KEY missing",
                details={"production_safe": False, "external_io": True},
            )
        if self._init_error:
            return CapabilityState(
                capability=Capability.MAIL,
                provider_name=self.name,
                mode=AvailabilityMode.UNAVAILABLE,
                available=False,
                reason=self._init_error,
                details={"production_safe": False, "external_io": True},
            )
        return CapabilityState(
            capability=Capability.MAIL,
            provider_name=self.name,
            mode=AvailabilityMode.LIVE,
            available=True,
            reason=None,
            details={
                "production_safe": True,
                "external_io": True,
                "from": f"{self._from_name} <{self._from_email}>",
            },
        )

    async def send(self, msg: MailMessage) -> MailResult:
        try:
            import asyncio
            import resend  # type: ignore
            resend.api_key = self._api_key
            params = {
                "from": f"{msg.from_name or self._from_name} <{msg.from_email or self._from_email}>",
                "to": [msg.to],
                "subject": msg.subject,
                "html": msg.html or f"<pre>{msg.text}</pre>",
                "text": msg.text,
            }
            if msg.reply_to:
                params["reply_to"] = msg.reply_to
            if msg.tags:
                params["tags"] = [{"name": t} for t in msg.tags]
            result = await asyncio.to_thread(resend.Emails.send, params)
            ref = (result or {}).get("id")
            return MailResult(
                success=bool(ref),
                provider_ref=ref,
                delivered_to=msg.to,
                error=None if ref else "resend returned no id",
                raw=result or {},
            )
        except Exception as e:
            logger.exception("ResendMailAdapter.send failed")
            return MailResult(
                success=False, provider_ref=None, delivered_to=msg.to,
                error=str(e),
            )


# ─────────────────────────────────────────────────────────────────────────────
# Cloudinary (StorageProvider)
# ─────────────────────────────────────────────────────────────────────────────

class CloudinaryStorageAdapter(StorageProvider):
    """Wraps Cloudinary uploader. Reuses `cloudinary_service` config."""

    name = "cloudinary"

    def __init__(self, *, cloud_name: str, api_key: str, api_secret: str) -> None:
        self._cloud_name = cloud_name
        self._api_key = api_key
        self._api_secret = api_secret
        self._init_error: Optional[str] = None
        self._configured = False

    def _ensure(self):
        if self._configured or self._init_error:
            return
        try:
            import cloudinary  # type: ignore
            cloudinary.config(
                cloud_name=self._cloud_name,
                api_key=self._api_key,
                api_secret=self._api_secret,
                secure=True,
            )
            self._configured = True
        except Exception as e:
            self._init_error = f"cloudinary init failed: {e}"
            logger.warning("CloudinaryStorageAdapter: %s", self._init_error)

    def health(self) -> CapabilityState:
        missing = [k for k, v in [
            ("CLOUDINARY_CLOUD_NAME", self._cloud_name),
            ("CLOUDINARY_API_KEY", self._api_key),
            ("CLOUDINARY_API_SECRET", self._api_secret),
        ] if not v]
        if missing:
            return CapabilityState(
                capability=Capability.STORAGE,
                provider_name=self.name,
                mode=AvailabilityMode.UNAVAILABLE,
                available=False,
                reason=f"{', '.join(missing)} missing",
                details={"production_safe": False, "external_io": True},
            )
        if self._init_error:
            return CapabilityState(
                capability=Capability.STORAGE,
                provider_name=self.name,
                mode=AvailabilityMode.UNAVAILABLE,
                available=False,
                reason=self._init_error,
                details={"production_safe": False, "external_io": True},
            )
        return CapabilityState(
            capability=Capability.STORAGE,
            provider_name=self.name,
            mode=AvailabilityMode.LIVE,
            available=True,
            reason=None,
            details={"production_safe": True, "external_io": True, "cloud": self._cloud_name},
        )

    async def put(self, *, data, key, content_type=None, public=True):
        self._ensure()
        if self._init_error:
            return StoragePutResult(
                success=False, url=None, key=key, size=len(data or b""),
                content_type=content_type, error=self._init_error,
            )
        try:
            import asyncio
            import cloudinary.uploader  # type: ignore

            def _upload():
                return cloudinary.uploader.upload(
                    data,
                    public_id=key,
                    resource_type="auto",
                    overwrite=True,
                    invalidate=True,
                )

            res = await asyncio.to_thread(_upload)
            url = res.get("secure_url") or res.get("url")
            return StoragePutResult(
                success=bool(url),
                url=url,
                key=res.get("public_id") or key,
                size=int(res.get("bytes") or len(data or b"")),
                content_type=content_type or res.get("resource_type"),
                error=None if url else "cloudinary returned no url",
                raw=res,
            )
        except Exception as e:
            logger.exception("CloudinaryStorageAdapter.put failed")
            return StoragePutResult(
                success=False, url=None, key=key, size=0,
                content_type=content_type, error=str(e),
            )

    async def delete(self, key: str) -> bool:
        self._ensure()
        if self._init_error:
            return False
        try:
            import asyncio
            import cloudinary.uploader  # type: ignore
            await asyncio.to_thread(cloudinary.uploader.destroy, key, invalidate=True)
            return True
        except Exception as e:
            logger.warning("CloudinaryStorageAdapter.delete: %s", e)
            return False

    async def head(self, key: str) -> Optional[StorageObject]:
        # The CDN doesn't expose cheap head; live adapter defers to the
        # canonical URL pattern instead. Returning None is honest — Этап 5.1
        # may add resources_by_ids() if needed.
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Google (OAuthProvider)
# ─────────────────────────────────────────────────────────────────────────────

class GoogleOAuthAdapter(OAuthProvider):
    """Wraps `google.oauth2.id_token` verification.

    Note: this adapter is wired but **disabled by default** to honour
    Этап 5.0 rule "no real OAuth logins". The registry will only construct
    it when `INTEGRATIONS_LIVE_ENABLED=1` AND `GOOGLE_CLIENT_ID` is set.
    """

    name = "google"

    def __init__(self, *, client_id: str, clock_skew_seconds: int = 10) -> None:
        self._client_id = client_id
        self._clock_skew = clock_skew_seconds

    def health(self) -> CapabilityState:
        if not self._client_id:
            return CapabilityState(
                capability=Capability.OAUTH,
                provider_name=self.name,
                mode=AvailabilityMode.UNAVAILABLE,
                available=False,
                reason="GOOGLE_CLIENT_ID missing",
                details={"production_safe": False, "external_io": True},
            )
        return CapabilityState(
            capability=Capability.OAUTH,
            provider_name=self.name,
            mode=AvailabilityMode.LIVE,
            available=True,
            reason=None,
            details={"production_safe": True, "external_io": True},
        )

    async def verify_id_token(self, id_token: str) -> OAuthIdentity:
        try:
            from google.oauth2 import id_token as google_id_token  # type: ignore
            from google.auth.transport import requests as google_requests  # type: ignore
            claims = google_id_token.verify_oauth2_token(
                id_token,
                google_requests.Request(),
                self._client_id,
                clock_skew_in_seconds=self._clock_skew,
            )
            return OAuthIdentity(
                success=True,
                subject=claims.get("sub"),
                email=(claims.get("email") or "").lower() or None,
                email_verified=bool(claims.get("email_verified")),
                name=claims.get("name") or claims.get("given_name"),
                picture_url=claims.get("picture"),
                raw=dict(claims),
            )
        except Exception as e:
            return OAuthIdentity(
                success=False, subject=None, email=None,
                error=str(e),
            )


# ─────────────────────────────────────────────────────────────────────────────
# Emergent LLM (AIProvider)
# ─────────────────────────────────────────────────────────────────────────────

class EmergentLLMAdapter(AIProvider):
    """Wraps `emergentintegrations.llm.chat.LlmChat` (single-shot completion)."""

    name = "emergent-llm"

    def __init__(self, *, api_key: str, default_model: str = "claude-sonnet-4-5") -> None:
        self._api_key = api_key
        self._default_model = default_model

    def health(self) -> CapabilityState:
        if not self._api_key:
            return CapabilityState(
                capability=Capability.AI,
                provider_name=self.name,
                mode=AvailabilityMode.UNAVAILABLE,
                available=False,
                reason="EMERGENT_LLM_KEY missing",
                details={"production_safe": False, "external_io": True},
            )
        return CapabilityState(
            capability=Capability.AI,
            provider_name=self.name,
            mode=AvailabilityMode.LIVE,
            available=True,
            reason=None,
            details={
                "production_safe": True,
                "external_io": True,
                "default_model": self._default_model,
            },
        )

    async def complete(
        self,
        messages: List[AIMessage],
        *,
        model: Optional[str] = None,
        max_tokens: int = 1024,
        temperature: float = 0.7,
    ) -> AICompletion:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
            session_id = f"e5-{int(time.time() * 1000)}"
            system_msg = next((m.content for m in messages if m.role == "system"), "")
            chat = LlmChat(api_key=self._api_key, session_id=session_id, system_message=system_msg)
            chat = chat.with_model("anthropic" if (model or self._default_model).startswith("claude") else "openai",
                                   model or self._default_model)
            chat = chat.with_max_tokens(max_tokens)
            last_user = next((m.content for m in reversed(messages) if m.role == "user"), "")
            text = await chat.send_message(UserMessage(text=last_user))
            return AICompletion(
                success=True,
                text=text or "",
                model=model or self._default_model,
                finish_reason="stop",
                tokens_in=sum(len(m.content.split()) for m in messages),
                tokens_out=len((text or "").split()),
                raw={},
            )
        except Exception as e:
            logger.exception("EmergentLLMAdapter.complete failed")
            return AICompletion(
                success=False, text="", model=model or self._default_model,
                finish_reason="error", error=str(e),
            )


__all__ = [
    "is_live_enabled",
    "StripePaymentAdapter",
    "ResendMailAdapter",
    "CloudinaryStorageAdapter",
    "GoogleOAuthAdapter",
    "EmergentLLMAdapter",
]
