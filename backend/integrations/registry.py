"""
Provider registry — Этап 5.0.

Singleton selector. Reads env once at import time, picks the right provider
per capability, exposes a single `capabilities()` matrix for the UI.

Selection rules (per capability):
  1. If a provider was explicitly bound at runtime via `bind_*()`, use it.
     (Lets admin UI swap providers without restart, and tests inject fakes.)
  2. Else: env-driven autopick.
       - Live env keys present → instantiate live adapter.
       - Otherwise: instantiate the mock with `reason` describing what's
         missing.
  3. Live adapters live in `live_adapters.py` — they wrap the existing
     services (email_service, cloudinary_service, payment_providers, etc.)
     so the boundary layer is purely a contract veneer over working code.
     We do NOT rewrite working flows in Этап 5.0.

This module never crashes at import. If a live adapter fails to construct
(missing dep, malformed key), we fall back to the mock and surface the
reason via `health()`.
"""

from __future__ import annotations

import logging
import os
from typing import Dict, Optional

from .ai import AIProvider
from .base import Capability, CapabilityState
from .mail import MailProvider
from .mocks import (
    MockAIProvider,
    MockMailProvider,
    MockOAuthProvider,
    MockPaymentProvider,
    MockStorageProvider,
)
from .oauth import OAuthProvider
from .payment import PaymentProvider
from .storage import StorageProvider

logger = logging.getLogger("integrations.registry")

# Active provider instances. Populated lazily.
_INSTANCES: Dict[Capability, object] = {}
# Explicit overrides (admin/test). Beat env autopick.
_OVERRIDES: Dict[Capability, object] = {}


# ─────────────────────────────────────────────────────────────────────────────
# Env presence helpers (cheap, no I/O)
# ─────────────────────────────────────────────────────────────────────────────

def _stripe_keys() -> Optional[str]:
    if os.environ.get("STRIPE_SECRET_KEY"):
        return None  # all good
    return "STRIPE_SECRET_KEY missing"


def _wayforpay_keys() -> Optional[str]:
    if os.environ.get("WAYFORPAY_MERCHANT_ACCOUNT") and os.environ.get("WAYFORPAY_SECRET_KEY"):
        return None
    return "WAYFORPAY_MERCHANT_ACCOUNT or WAYFORPAY_SECRET_KEY missing"


def _resend_keys() -> Optional[str]:
    if os.environ.get("RESEND_API_KEY"):
        return None
    return "RESEND_API_KEY missing"


def _cloudinary_keys() -> Optional[str]:
    needed = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]
    missing = [k for k in needed if not os.environ.get(k)]
    if missing:
        return f"{', '.join(missing)} missing"
    return None


def _google_keys() -> Optional[str]:
    if os.environ.get("GOOGLE_CLIENT_ID"):
        return None
    return "GOOGLE_CLIENT_ID missing"


def _emergent_llm_keys() -> Optional[str]:
    if os.environ.get("EMERGENT_LLM_KEY") or os.environ.get("OPENAI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY"):
        return None
    return "EMERGENT_LLM_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY all missing"


# ─────────────────────────────────────────────────────────────────────────────
# Build / autopick
# ─────────────────────────────────────────────────────────────────────────────

def _live_enabled() -> bool:
    """Master kill-switch. Lazy-imported to avoid touching live_adapters
    when the file is being parsed for the first time."""
    from .live_adapters import is_live_enabled
    return is_live_enabled()


def _build_payment() -> PaymentProvider:
    forced = (os.environ.get("PAYMENT_PROVIDER") or "").lower().strip()
    if forced == "mock":
        return MockPaymentProvider(reason="PAYMENT_PROVIDER=mock (explicit override)")

    stripe_missing = _stripe_keys()
    wfp_missing = _wayforpay_keys()

    # Live adapters only constructed when the master flag is on AND keys
    # are present. Without the flag we stay on mock with an honest reason
    # — Этап 5.0 forbids real charges.
    if _live_enabled() and not stripe_missing:
        try:
            from .live_adapters import StripePaymentAdapter
            return StripePaymentAdapter(
                secret_key=os.environ.get("STRIPE_SECRET_KEY", ""),
                webhook_secret=os.environ.get("STRIPE_WEBHOOK_SECRET", ""),
                currency=os.environ.get("STRIPE_CURRENCY", "usd"),
            )
        except Exception as e:  # pragma: no cover
            return MockPaymentProvider(reason=f"Stripe adapter init failed: {e}")

    # Reason chain — most-specific first.
    if not stripe_missing or not wfp_missing:
        return MockPaymentProvider(
            reason="Payment keys present but INTEGRATIONS_LIVE_ENABLED!=1 — Этап 5.0 boundary keeps system on mock.",
        )
    return MockPaymentProvider(reason=stripe_missing or wfp_missing or "no payment keys")


def _build_mail() -> MailProvider:
    forced = (os.environ.get("MAIL_PROVIDER") or "").lower().strip()
    if forced == "mock":
        return MockMailProvider(reason="MAIL_PROVIDER=mock (explicit override)")

    missing = _resend_keys()
    if _live_enabled() and not missing:
        try:
            from .live_adapters import ResendMailAdapter
            return ResendMailAdapter(
                api_key=os.environ.get("RESEND_API_KEY", ""),
                from_email=os.environ.get("RESEND_FROM_EMAIL", "onboarding@resend.dev"),
                from_name=os.environ.get("RESEND_FROM_NAME", "EVA-X"),
            )
        except Exception as e:  # pragma: no cover
            return MockMailProvider(reason=f"Resend adapter init failed: {e}")

    if not missing:
        return MockMailProvider(
            reason="RESEND_API_KEY present but INTEGRATIONS_LIVE_ENABLED!=1 — Этап 5.0 keeps mail on mock.",
        )
    return MockMailProvider(reason=missing)


def _build_storage() -> StorageProvider:
    forced = (os.environ.get("STORAGE_PROVIDER") or "").lower().strip()
    if forced == "mock":
        return MockStorageProvider(reason="STORAGE_PROVIDER=mock (explicit override)")

    missing = _cloudinary_keys()
    if _live_enabled() and not missing:
        try:
            from .live_adapters import CloudinaryStorageAdapter
            return CloudinaryStorageAdapter(
                cloud_name=os.environ.get("CLOUDINARY_CLOUD_NAME", ""),
                api_key=os.environ.get("CLOUDINARY_API_KEY", ""),
                api_secret=os.environ.get("CLOUDINARY_API_SECRET", ""),
            )
        except Exception as e:  # pragma: no cover
            return MockStorageProvider(reason=f"Cloudinary adapter init failed: {e}")

    if not missing:
        return MockStorageProvider(
            reason="Cloudinary keys present but INTEGRATIONS_LIVE_ENABLED!=1 — Этап 5.0 keeps storage on mock.",
        )
    return MockStorageProvider(reason=missing)


def _build_oauth() -> OAuthProvider:
    forced = (os.environ.get("OAUTH_PROVIDER") or "").lower().strip()
    if forced == "mock":
        return MockOAuthProvider(reason="OAUTH_PROVIDER=mock (explicit override)")

    missing = _google_keys()
    # OAuth has the strictest gate: even with the master flag on, an
    # additional `OAUTH_LIVE_ENABLED=1` is required because OAuth bypass
    # is the highest-impact security boundary in the system.
    oauth_explicit = (os.environ.get("OAUTH_LIVE_ENABLED") or "").strip().lower() in {"1", "true", "yes"}
    if _live_enabled() and oauth_explicit and not missing:
        try:
            from .live_adapters import GoogleOAuthAdapter
            return GoogleOAuthAdapter(
                client_id=os.environ.get("GOOGLE_CLIENT_ID", ""),
            )
        except Exception as e:  # pragma: no cover
            return MockOAuthProvider(reason=f"Google adapter init failed: {e}")

    if not missing:
        return MockOAuthProvider(
            reason="GOOGLE_CLIENT_ID present but OAUTH_LIVE_ENABLED!=1 — Этап 5.0 forbids real OAuth logins.",
        )
    return MockOAuthProvider(reason=missing)


def _build_ai() -> AIProvider:
    forced = (os.environ.get("AI_PROVIDER") or "").lower().strip()
    if forced == "mock":
        return MockAIProvider(reason="AI_PROVIDER=mock (explicit override)")

    missing = _emergent_llm_keys()
    if _live_enabled() and not missing:
        try:
            from .live_adapters import EmergentLLMAdapter
            return EmergentLLMAdapter(
                api_key=os.environ.get("EMERGENT_LLM_KEY") or os.environ.get("OPENAI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY", ""),
                default_model=os.environ.get("AI_DEFAULT_MODEL", "claude-sonnet-4-5"),
            )
        except Exception as e:  # pragma: no cover
            return MockAIProvider(reason=f"AI adapter init failed: {e}")

    if not missing:
        return MockAIProvider(
            reason="LLM key present but INTEGRATIONS_LIVE_ENABLED!=1 — Этап 5.0 keeps AI on mock.",
        )
    return MockAIProvider(reason=missing)


_BUILDERS = {
    Capability.PAYMENT: _build_payment,
    Capability.MAIL: _build_mail,
    Capability.STORAGE: _build_storage,
    Capability.OAUTH: _build_oauth,
    Capability.AI: _build_ai,
}


def _get(cap: Capability):
    if cap in _OVERRIDES:
        return _OVERRIDES[cap]
    if cap not in _INSTANCES:
        try:
            _INSTANCES[cap] = _BUILDERS[cap]()
        except Exception as e:  # pragma: no cover — last-resort safety
            logger.exception("Failed to build provider for %s: %s", cap, e)
            # Safety net — even on builder failure, the system gets a mock.
            _INSTANCES[cap] = {
                Capability.PAYMENT: MockPaymentProvider,
                Capability.MAIL: MockMailProvider,
                Capability.STORAGE: MockStorageProvider,
                Capability.OAUTH: MockOAuthProvider,
                Capability.AI: MockAIProvider,
            }[cap](reason=f"builder error: {e}")
    return _INSTANCES[cap]


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def payment() -> PaymentProvider: return _get(Capability.PAYMENT)
def mail() -> MailProvider: return _get(Capability.MAIL)
def storage() -> StorageProvider: return _get(Capability.STORAGE)
def oauth() -> OAuthProvider: return _get(Capability.OAUTH)
def ai() -> AIProvider: return _get(Capability.AI)


def capabilities() -> Dict[str, dict]:
    """Return the honest capability matrix for UI/admin consumption."""
    out = {}
    for cap in Capability:
        provider = _get(cap)
        try:
            state: CapabilityState = provider.health()
            out[cap.value] = state.as_dict()
        except Exception as e:  # pragma: no cover
            out[cap.value] = {
                "capability": cap.value,
                "provider": "unknown",
                "mode": "unavailable",
                "available": False,
                "reason": f"health() raised {type(e).__name__}: {e}",
                "details": {},
            }
    return out


def bind(capability: Capability, provider) -> None:
    """
    Override the active provider for a capability.

    Used by:
      - tests (inject fakes)
      - admin UI when a key is added at runtime (rebuild + bind)
    """
    _OVERRIDES[capability] = provider
    logger.info("REGISTRY: %s now bound to %s", capability.value, getattr(provider, "name", "?"))


def reset() -> None:
    """Clear all overrides and cached instances. Mostly for tests."""
    _OVERRIDES.clear()
    _INSTANCES.clear()
