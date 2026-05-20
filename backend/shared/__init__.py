"""
Shared cross-cutting primitives.

NOT a domain — only infrastructure used by every domain:
  • config       — typed application configuration
  • constants    — business constants (pricing tiers, thresholds, magic numbers)
  • errors       — typed exception hierarchy (replaces silent except: pass)
  • events       — in-memory domain event bus (cross-domain communication)
  • logging      — structured logging helper

Rules (enforced by tests/architecture/):
  • shared/* must not import from domains/* or infrastructure/*
  • shared/* must not depend on FastAPI, Motor, or external services
  • shared/* must remain pure Python with stdlib + pydantic only
"""

from .errors import (
    DomainError,
    NotFoundError,
    InvariantViolated,
    PolicyDenied,
    AuthorizationError,
    ConfigurationError,
)
from .events import EventBus, DomainEvent, get_event_bus
from .config import settings, Settings

__all__ = [
    "DomainError",
    "NotFoundError",
    "InvariantViolated",
    "PolicyDenied",
    "AuthorizationError",
    "ConfigurationError",
    "EventBus",
    "DomainEvent",
    "get_event_bus",
    "settings",
    "Settings",
]
