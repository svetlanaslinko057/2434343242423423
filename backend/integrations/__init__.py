"""
Integration Boundary Layer (Этап 5.0).

Goal: the application depends on **capabilities**, not on vendors.

UI / business logic should never type the word "Stripe", "Resend",
"Cloudinary", "Google" — they call:

    paymentProvider.create_checkout(...)
    mailProvider.send_otp(...)
    storageProvider.put_file(...)
    oauthProvider.verify_id_token(...)
    aiProvider.complete(...)

Every provider — real or mock — returns the **same shape**. UI cannot tell
them apart. Switching providers (Stripe → WayForPay, Resend → Sendgrid,
real → mock for testing) is a one-line config change, NOT a code rewrite.

Public surface:
    from integrations import registry
    p = registry.payment()       # current PaymentProvider implementation
    m = registry.mail()
    s = registry.storage()
    o = registry.oauth()
    a = registry.ai()
    caps = registry.capabilities()  # honest matrix for UI/admin
"""

from __future__ import annotations

from .base import (
    Capability,
    AvailabilityMode,
    CapabilityState,
    Provider,
    ProviderError,
)
from .payment import PaymentProvider, CheckoutRequest, CheckoutResult, PaymentEvent
from .mail import MailProvider, MailMessage, MailResult
from .storage import StorageProvider, StoragePutResult, StorageObject
from .oauth import OAuthProvider, OAuthIdentity
from .ai import AIProvider, AIMessage, AICompletion

from . import registry

__all__ = [
    # base
    "Capability",
    "AvailabilityMode",
    "CapabilityState",
    "Provider",
    "ProviderError",
    # payment
    "PaymentProvider",
    "CheckoutRequest",
    "CheckoutResult",
    "PaymentEvent",
    # mail
    "MailProvider",
    "MailMessage",
    "MailResult",
    # storage
    "StorageProvider",
    "StoragePutResult",
    "StorageObject",
    # oauth
    "OAuthProvider",
    "OAuthIdentity",
    # ai
    "AIProvider",
    "AIMessage",
    "AICompletion",
    # registry
    "registry",
]
