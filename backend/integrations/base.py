"""
Base contracts for the Integration Boundary Layer.

Every external dependency (payments, mail, storage, OAuth, AI) inherits from
`Provider`. Mock and live implementations share the same shape — the only
honest way to tell them apart is `provider.health()`.
"""

from __future__ import annotations

import enum
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


class Capability(str, enum.Enum):
    """Top-level capabilities the system can depend on."""

    PAYMENT = "payment"
    MAIL = "mail"
    STORAGE = "storage"
    OAUTH = "oauth"
    AI = "ai"


class AvailabilityMode(str, enum.Enum):
    """
    The four honest states an integration can be in.

    Anything else (silent fallback, hidden mocks, fake success) is forbidden
    and was the kind of behaviour Этап 4 removed from the UI layer.
    """

    LIVE = "live"
    """Vendor SDK is wired, credentials are valid, real calls happen."""

    MOCK = "mock"
    """Deterministic local impl. Returns same shape as live, no external I/O."""

    DEGRADED = "degraded"
    """Vendor reachable but with caveat — partial outage, deprecated key, etc."""

    UNAVAILABLE = "unavailable"
    """No credentials AND no mock. Calls raise ProviderError."""


@dataclass
class CapabilityState:
    """
    Honest answer to "can I rely on this integration right now?".

    Always serialized identically — UI/admin renders this struct directly.
    """

    capability: Capability
    provider_name: str
    mode: AvailabilityMode
    available: bool
    reason: Optional[str] = None
    """Human-readable explanation when mode != LIVE.
    Examples:
      - "STRIPE_SECRET_KEY missing"
      - "RESEND_API_KEY rejected by provider (401)"
      - "Mock provider — no production calls will be made"
    """
    details: dict = field(default_factory=dict)
    """Optional vendor-neutral metadata (e.g. configured_from='env'|'db')."""

    def as_dict(self) -> dict:
        return {
            "capability": self.capability.value,
            "provider": self.provider_name,
            "mode": self.mode.value,
            "available": self.available,
            "reason": self.reason,
            "details": self.details,
        }


class ProviderError(RuntimeError):
    """
    Raised by provider implementations when the operation cannot proceed.

    Carries the capability + mode + reason so callers can render an honest
    message to the user (NOT a fake success).
    """

    def __init__(
        self,
        message: str,
        *,
        capability: Capability,
        mode: AvailabilityMode = AvailabilityMode.UNAVAILABLE,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.capability = capability
        self.mode = mode
        self.retryable = retryable

    def as_dict(self) -> dict:
        return {
            "error": str(self),
            "capability": self.capability.value,
            "mode": self.mode.value,
            "retryable": self.retryable,
        }


class Provider(ABC):
    """
    Base for every concrete integration.

    Subclasses must:
      1. set `capability` (class attr)
      2. set `name` (e.g. "stripe", "mock-payment")
      3. implement `health()` — never lie about LIVE when keys are missing.
    """

    capability: Capability
    name: str = "base"

    @abstractmethod
    def health(self) -> CapabilityState:
        """
        Return the current honest availability.

        Must be cheap (no network calls). For deeper liveness checks expose
        a separate `ping()` per capability if needed.
        """
        ...
