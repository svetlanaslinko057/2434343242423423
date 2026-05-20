"""
Centralised application configuration.

ALL environment reads happen here. No `os.environ.get(...)` scattered across
the codebase — instead `from shared.config import settings`.

Bound to .env via python-dotenv (loaded by FastAPI startup). Mock keys for
3rd-party integrations are surfaced as `None` so callers can branch
explicitly on `if settings.stripe.secret_key is None`.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


# Load .env once, idempotently. python-dotenv is in requirements.
try:
    from dotenv import load_dotenv
    _ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
    if _ENV_PATH.exists():
        load_dotenv(_ENV_PATH)
except ImportError:  # pragma: no cover — dotenv is in requirements
    pass


def _env(key: str, default: str | None = None) -> str | None:
    """Read an env var, returning None for empty strings so callers can use
    `if settings.x is None` instead of `if not settings.x`."""
    v = os.environ.get(key, default)
    return v if v else None


def _env_int(key: str, default: int) -> int:
    raw = os.environ.get(key)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class MongoSettings:
    url: str = field(default_factory=lambda: _env("MONGO_URL") or "mongodb://localhost:27017")
    db_name: str = field(default_factory=lambda: _env("DB_NAME") or "test_database")


@dataclass(frozen=True)
class StripeSettings:
    secret_key: str | None = field(default_factory=lambda: _env("STRIPE_SECRET_KEY"))
    webhook_secret: str | None = field(default_factory=lambda: _env("STRIPE_WEBHOOK_SECRET"))


@dataclass(frozen=True)
class ResendSettings:
    api_key: str | None = field(default_factory=lambda: _env("RESEND_API_KEY"))
    from_email: str = field(default_factory=lambda: _env("RESEND_FROM_EMAIL") or "noreply@atlas.dev")


@dataclass(frozen=True)
class CloudinarySettings:
    cloud_name: str | None = field(default_factory=lambda: _env("CLOUDINARY_CLOUD_NAME"))
    api_key: str | None = field(default_factory=lambda: _env("CLOUDINARY_API_KEY"))
    api_secret: str | None = field(default_factory=lambda: _env("CLOUDINARY_API_SECRET"))


@dataclass(frozen=True)
class GoogleOAuthSettings:
    client_id: str | None = field(default_factory=lambda: _env("GOOGLE_OAUTH_CLIENT_ID"))
    client_secret: str | None = field(default_factory=lambda: _env("GOOGLE_OAUTH_CLIENT_SECRET"))


@dataclass(frozen=True)
class LLMSettings:
    emergent_key: str | None = field(default_factory=lambda: _env("EMERGENT_LLM_KEY"))
    openai_key: str | None = field(default_factory=lambda: _env("OPENAI_API_KEY"))
    hf_token: str | None = field(default_factory=lambda: _env("HF_TOKEN"))


@dataclass(frozen=True)
class AppSettings:
    app_url: str | None = field(default_factory=lambda: _env("APP_URL"))
    integration_proxy_url: str | None = field(default_factory=lambda: _env("INTEGRATION_PROXY_URL"))
    backend_port: int = field(default_factory=lambda: _env_int("BACKEND_PORT", 8001))


@dataclass(frozen=True)
class Settings:
    """Top-level config aggregator. Inject this instead of reading env directly."""
    mongo: MongoSettings = field(default_factory=MongoSettings)
    stripe: StripeSettings = field(default_factory=StripeSettings)
    resend: ResendSettings = field(default_factory=ResendSettings)
    cloudinary: CloudinarySettings = field(default_factory=CloudinarySettings)
    google_oauth: GoogleOAuthSettings = field(default_factory=GoogleOAuthSettings)
    llm: LLMSettings = field(default_factory=LLMSettings)
    app: AppSettings = field(default_factory=AppSettings)

    @property
    def is_production(self) -> bool:
        """All payment, mail, storage providers configured = ready for production."""
        return bool(
            self.stripe.secret_key
            and self.resend.api_key
            and self.cloudinary.api_key
        )


# Module-level singleton.
settings = Settings()
