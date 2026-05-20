"""
Typed exception hierarchy.

Replaces silent `except: pass` patterns. Every domain operation that can fail
raises a typed exception. HTTP adapter layer (app/routers) translates them
into HTTP status codes; never the other way around.

Hierarchy:
    DomainError                     ← base for any business-rule failure
      ├── NotFoundError             ← resource missing (HTTP 404)
      ├── InvariantViolated         ← business invariant breached (HTTP 422)
      ├── PolicyDenied              ← policy/quota refused the action (HTTP 403)
      ├── AuthorizationError        ← caller lacks permission (HTTP 403)
      ├── ConfigurationError        ← system mis-configured (HTTP 500)
      └── ExternalServiceError      ← 3rd-party adapter failed (HTTP 502)
"""
from __future__ import annotations
from typing import Any


class DomainError(Exception):
    """Base for all business-rule failures. Carries machine-readable code + context."""

    code: str = "domain_error"
    http_status: int = 400

    def __init__(self, message: str, *, code: str | None = None, context: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        self.context = context or {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "error": self.code,
            "message": self.message,
            "context": self.context,
        }


class NotFoundError(DomainError):
    """Resource missing in the system of record."""

    code = "not_found"
    http_status = 404


class InvariantViolated(DomainError):
    """A business invariant was breached (e.g. balance would go negative)."""

    code = "invariant_violated"
    http_status = 422


class PolicyDenied(DomainError):
    """A policy/quota/rule explicitly refused the action."""

    code = "policy_denied"
    http_status = 403


class AuthorizationError(DomainError):
    """Caller is authenticated but lacks permission for this action."""

    code = "forbidden"
    http_status = 403


class ConfigurationError(DomainError):
    """System is mis-configured. Fail loud — do not silently fall back."""

    code = "configuration_error"
    http_status = 500


class ExternalServiceError(DomainError):
    """3rd-party adapter (Stripe / Resend / Cloudinary / OpenAI) failed."""

    code = "external_service_error"
    http_status = 502
