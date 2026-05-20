"""
Deterministic mock providers — Этап 5.0.

Every mock returns the SAME shape its live counterpart would. Nothing about
the response should let calling code branch on `isinstance(provider, MockX)`.

Mocks intentionally surface their mock-ness through `health()`, NOT through
the result shape. That's the only honest way: callers ask
`registry.payment().health().mode` to know whether real money will move.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import time
import uuid
from pathlib import Path
from typing import List, Optional

from .ai import AICompletion, AIMessage, AIProvider
from .base import (
    AvailabilityMode,
    Capability,
    CapabilityState,
    Provider,
    ProviderError,
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

logger = logging.getLogger("integrations.mock")

# Single source of truth for "why we're in mock" — overridden by registry
# when constructing each provider. Lets the UI/admin show, e.g.,
#   "STRIPE_SECRET_KEY missing" vs "explicit MOCK_PAYMENT=1 in .env".
DEFAULT_REASON = "No live credentials configured — running deterministic mock."


# ─────────────────────────────────────────────────────────────────────────────
# Mock Payment
# ─────────────────────────────────────────────────────────────────────────────


class MockPaymentProvider(PaymentProvider):
    name = "mock-payment"

    def __init__(self, *, reason: str = DEFAULT_REASON) -> None:
        self._reason = reason

    def health(self) -> CapabilityState:
        return CapabilityState(
            capability=Capability.PAYMENT,
            provider_name=self.name,
            mode=AvailabilityMode.MOCK,
            available=True,
            reason=self._reason,
            details={"production_safe": True, "external_io": False},
        )

    async def create_checkout(self, req: CheckoutRequest) -> CheckoutResult:
        # Deterministic ref: same invoice → same provider_ref. This makes
        # tests reproducible AND prevents UI from leaking unique IDs that
        # look "real" in screenshots.
        provider_ref = "mock_" + hashlib.sha1(req.invoice_id.encode()).hexdigest()[:16]
        # Mock URL points back to our own backend so admin can manually flip
        # status during testing — no Stripe-style hosted page is implied.
        payment_url = f"{req.return_url.rstrip('/')}?mock_ref={provider_ref}"
        logger.info(
            "MOCK_PAYMENT: checkout invoice=%s amount=%s %s ref=%s",
            req.invoice_id, req.amount, req.currency, provider_ref,
        )
        return CheckoutResult(
            success=True,
            payment_url=payment_url,
            provider_ref=provider_ref,
            status="pending",
            raw={"mock": True, "reason": self._reason},
        )

    async def verify_webhook(self, body: bytes, headers: dict) -> PaymentEvent:
        # Mock webhook trusts the body verbatim — there is no signing key
        # here. Live providers MUST verify HMAC/RSA signatures.
        try:
            import json
            data = json.loads(body or b"{}")
        except Exception as e:
            return PaymentEvent(
                valid=False, invoice_id=None, provider_ref=None, status="failed",
                error=f"invalid mock body: {e}",
            )
        return PaymentEvent(
            valid=True,
            invoice_id=data.get("invoice_id"),
            provider_ref=data.get("provider_ref"),
            status=data.get("status", "paid"),
            event_type=data.get("event_type") or f"payment_{data.get('status', 'succeeded')}",
            amount=data.get("amount"),
            currency=data.get("currency"),
            raw={"mock": True},
        )


# ─────────────────────────────────────────────────────────────────────────────
# Mock Mail
# ─────────────────────────────────────────────────────────────────────────────


class MockMailProvider(MailProvider):
    name = "mock-mail"

    def __init__(self, *, reason: str = DEFAULT_REASON) -> None:
        self._reason = reason
        # In-memory outbox so tests / admin can inspect what would have been
        # sent. Capped to last 100 messages — never persisted.
        self.outbox: List[dict] = []

    def health(self) -> CapabilityState:
        return CapabilityState(
            capability=Capability.MAIL,
            provider_name=self.name,
            mode=AvailabilityMode.MOCK,
            available=True,
            reason=self._reason,
            details={"production_safe": True, "external_io": False, "outbox_size": len(self.outbox)},
        )

    async def send(self, msg: MailMessage) -> MailResult:
        ref = f"mock_{uuid.uuid4().hex[:12]}"
        record = {
            "ref": ref,
            "to": msg.to,
            "subject": msg.subject,
            "tags": msg.tags,
            "ts": time.time(),
        }
        self.outbox.append(record)
        if len(self.outbox) > 100:
            self.outbox = self.outbox[-100:]
        logger.info("MOCK_MAIL: queued to=%s subject=%r ref=%s", msg.to, msg.subject, ref)
        return MailResult(
            success=True, provider_ref=ref, delivered_to=msg.to,
            raw={"mock": True, "reason": self._reason},
        )


# ─────────────────────────────────────────────────────────────────────────────
# Mock Storage
# ─────────────────────────────────────────────────────────────────────────────


class MockStorageProvider(StorageProvider):
    name = "mock-storage"

    def __init__(
        self,
        *,
        reason: str = DEFAULT_REASON,
        root: Path = Path("/app/backend/uploads/mock"),
        public_base: str = "/api/uploads/mock",
    ) -> None:
        self._reason = reason
        self._root = root
        self._public_base = public_base.rstrip("/")
        self._root.mkdir(parents=True, exist_ok=True)

    def health(self) -> CapabilityState:
        try:
            count = sum(1 for _ in self._root.rglob("*") if _.is_file())
        except Exception:
            count = -1
        return CapabilityState(
            capability=Capability.STORAGE,
            provider_name=self.name,
            mode=AvailabilityMode.MOCK,
            available=True,
            reason=self._reason,
            details={
                "production_safe": True,
                "external_io": False,
                "root": str(self._root),
                "object_count": count,
            },
        )

    async def put(self, *, data, key, content_type=None, public=True):
        path = self._root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(path.write_bytes, data)
        return StoragePutResult(
            success=True,
            url=f"{self._public_base}/{key}",
            key=key,
            size=len(data),
            content_type=content_type,
            raw={"mock": True, "reason": self._reason},
        )

    async def delete(self, key: str) -> bool:
        path = self._root / key
        try:
            await asyncio.to_thread(path.unlink, missing_ok=True)
            return True
        except Exception:
            return False

    async def head(self, key: str) -> Optional[StorageObject]:
        path = self._root / key
        if not path.is_file():
            return None
        return StorageObject(
            key=key, url=f"{self._public_base}/{key}",
            size=path.stat().st_size,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Mock OAuth
# ─────────────────────────────────────────────────────────────────────────────


class MockOAuthProvider(OAuthProvider):
    """
    Mock OAuth NEVER returns success on real-looking tokens. Authentication
    bypass via mock is forbidden — mock is only honest about being unavailable.

    Any code that actually wants to login a user must call a live provider.
    """

    name = "mock-oauth"

    def __init__(self, *, reason: str = DEFAULT_REASON) -> None:
        self._reason = reason

    def health(self) -> CapabilityState:
        return CapabilityState(
            capability=Capability.OAUTH,
            provider_name=self.name,
            # Note: UNAVAILABLE, not MOCK. We refuse to fake identity.
            mode=AvailabilityMode.UNAVAILABLE,
            available=False,
            reason=self._reason or "OAuth login disabled in mock mode (security boundary).",
            details={"production_safe": True, "external_io": False},
        )

    async def verify_id_token(self, id_token: str) -> OAuthIdentity:
        return OAuthIdentity(
            success=False, subject=None, email=None,
            error=self._reason or "OAuth provider unavailable",
        )


# ─────────────────────────────────────────────────────────────────────────────
# Mock AI
# ─────────────────────────────────────────────────────────────────────────────


class MockAIProvider(AIProvider):
    """
    Returns a deterministic echo so dependent flows can be exercised end-to-end
    without consuming tokens. Output is *clearly* labelled as mock so it can't
    accidentally be shown to a real user as real AI output.
    """

    name = "mock-ai"

    def __init__(self, *, reason: str = DEFAULT_REASON) -> None:
        self._reason = reason

    def health(self) -> CapabilityState:
        return CapabilityState(
            capability=Capability.AI,
            provider_name=self.name,
            mode=AvailabilityMode.MOCK,
            available=True,
            reason=self._reason,
            details={"production_safe": True, "external_io": False},
        )

    async def complete(
        self,
        messages: List[AIMessage],
        *,
        model: Optional[str] = None,
        max_tokens: int = 1024,
        temperature: float = 0.7,
    ) -> AICompletion:
        last_user = next((m.content for m in reversed(messages) if m.role == "user"), "")
        text = f"[MOCK AI] {last_user[:max_tokens]}"
        return AICompletion(
            success=True,
            text=text,
            model=model or "mock-echo",
            finish_reason="stop",
            tokens_in=sum(len(m.content.split()) for m in messages),
            tokens_out=len(text.split()),
            raw={"mock": True, "reason": self._reason},
        )
