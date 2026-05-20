"""MailProvider — vendor-neutral transactional email contract."""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import List, Optional

from .base import Capability, Provider


@dataclass
class MailMessage:
    to: str
    subject: str
    text: str
    """Plain-text body. Required."""
    html: Optional[str] = None
    """HTML body. Optional — provider must fall back to text if absent."""
    from_email: Optional[str] = None
    """Sender email. None → provider default."""
    from_name: Optional[str] = None
    reply_to: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    """For provider-side categorization (Resend tags, Sendgrid categories…)."""
    metadata: dict = field(default_factory=dict)
    """Vendor-neutral key/value pairs for tracking. Stored alongside delivery."""


@dataclass
class MailResult:
    """Identical shape across all MailProvider implementations."""

    success: bool
    provider_ref: Optional[str]
    """Vendor-side message ID (e.g. Resend's `id`) — opaque."""
    delivered_to: Optional[str] = None
    error: Optional[str] = None
    raw: dict = field(default_factory=dict)


class MailProvider(Provider, abc.ABC):
    capability = Capability.MAIL

    @abc.abstractmethod
    async def send(self, msg: MailMessage) -> MailResult:
        """Deliver one transactional email. Never raises on user-input errors —
        returns `MailResult(success=False, error=...)` instead, so callers can
        fall through to honest UI state without try/except clutter."""
        ...
