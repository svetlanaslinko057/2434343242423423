"""OAuthProvider — vendor-neutral identity-token verification contract."""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Optional

from .base import Capability, Provider


@dataclass
class OAuthIdentity:
    """
    Vendor-neutral identity returned from a verified OAuth flow.

    The system NEVER stores Google/Apple/Microsoft-specific fields. We only
    persist what every provider gives us: a stable `subject` ID + email +
    optional display name + verified flag. Vendor-specific bits go in `raw`.
    """

    success: bool
    subject: Optional[str]
    """Stable provider-side user ID (Google `sub`, Apple `sub`, etc.)"""
    email: Optional[str]
    email_verified: bool = False
    name: Optional[str] = None
    picture_url: Optional[str] = None
    error: Optional[str] = None
    raw: dict = field(default_factory=dict)


class OAuthProvider(Provider, abc.ABC):
    capability = Capability.OAUTH

    @abc.abstractmethod
    async def verify_id_token(self, id_token: str) -> OAuthIdentity:
        """
        Verify a provider-issued ID token (JWT) and return the identity.

        Implementations MUST check the token's `aud` against this provider's
        configured client_id — otherwise tokens from other apps could be
        replayed against ours.
        """
        ...
