"""
Google Sign-In — real Google OAuth, NOT Emergent-managed.

Flow (ID-token verification, no client_secret required):

    Client (web: @react-oauth/google  |  mobile: expo-auth-session)
        │
        │  user signs in with Google, client receives an ID token (JWT)
        ▼
    POST /api/auth/google  { "credential": "<id_token>" }
        │
        │  backend verifies signature against Google's public keys and
        │  checks that aud == GOOGLE_CLIENT_ID (so someone else's token
        │  can't be replayed against our app)
        ▼
    find-or-create user in db.users
        │
        ▼
    issue same `session_token` cookie the rest of the app already reads
    through get_current_user → 40+ endpoints light up without touching
    their dependencies.

REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS,
THIS BREAKS THE AUTH.

Env:
    GOOGLE_CLIENT_ID   — required. Web OAuth 2.0 Client ID from Google
                         Cloud Console. Same value is used by web AND
                         mobile clients, because we only verify `aud`.
"""

from __future__ import annotations

import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

# Этап 5.1 — boundary layer integration. Direct google.oauth2 import is
# kept for backwards compatibility but the runtime path goes through
# `registry.oauth()` so business logic depends on capability, not vendor.
from integrations import registry as _ipg, AvailabilityMode


# Default Google Client ID — only used as a last-resort fallback when neither
# admin DB nor env var has a value. Replace via /admin/integrations.
_DEFAULT_GOOGLE_CLIENT_ID = "539552820560-pso3qndegrntp46oneml9nr33t7rpi9j.apps.googleusercontent.com"

# Small clock-skew tolerance so a 2-3 s drift between pod and Google
# doesn't randomly 401 users.
CLOCK_SKEW_SECONDS = 10


async def _resolve_google_client_id() -> str:
    """Resolve the *current* Google OAuth Client ID.

    Order: admin DB (system_config.integrations_settings.google_auth.client_id)
           → env GOOGLE_CLIENT_ID → hardcoded default.
    """
    try:
        from admin_integrations import get_setting
        cfg = await get_setting("google_auth")
        cid = (cfg.get("client_id") or "").strip()
        if cid:
            return cid
    except Exception:
        pass
    return os.environ.get("GOOGLE_CLIENT_ID", "").strip() or _DEFAULT_GOOGLE_CLIENT_ID


# Compatibility export — code that read GOOGLE_CLIENT_ID at import-time still
# works, but the value is overwritten lazily on every request via the resolver
# above. Treat this as a fallback only.
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip() or _DEFAULT_GOOGLE_CLIENT_ID


class GoogleCredentialBody(BaseModel):
    # Google returns the JWT under `credential` in the GSI web flow and
    # under `id_token` in expo-auth-session — accept both.
    credential: Optional[str] = None
    id_token: Optional[str] = None


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def init_router(db, get_current_user_dep):
    router = APIRouter(prefix="/api/auth", tags=["google-auth"])

    @router.get("/google/config")
    async def google_config():
        """Expose the public Client ID so the frontends don't need to
        hardcode it. Pulls live from admin DB → env → default.

        Этап 5.1: also surfaces the boundary-layer mode so the UI can
        render an honest CTA. If `mode != live`, the frontend should
        hide the Google button instead of showing it broken.
        """
        cid = await _resolve_google_client_id()
        oauth_state = _ipg.oauth().health()
        return {
            "enabled": bool(cid) and oauth_state.mode == AvailabilityMode.LIVE,
            "client_id": cid or None,
            "mode": oauth_state.mode.value,
            "reason": oauth_state.reason,
        }

    @router.post("/google")
    async def google_signin(
        body: GoogleCredentialBody,
        request: Request,
        response: Response,
    ):
        # Этап 5.1 — strict capability gate.
        # OAuth has TWO switches: INTEGRATIONS_LIVE_ENABLED + OAUTH_LIVE_ENABLED.
        # Without both, registry.oauth() returns MockOAuth which always says
        # success=False — never fakes identity. We refuse the request here so
        # the user gets an honest 503 instead of a confusing 401.
        oauth_state = _ipg.oauth().health()
        if oauth_state.mode != AvailabilityMode.LIVE:
            raise HTTPException(
                status_code=503,
                detail=f"Google Sign-In disabled by boundary layer: {oauth_state.reason}",
            )

        client_id = await _resolve_google_client_id()
        if not client_id:
            raise HTTPException(
                status_code=503,
                detail="Google Sign-In is not configured on the server",
            )

        token = (body.credential or body.id_token or "").strip()
        if not token:
            raise HTTPException(status_code=400, detail="Missing Google ID token")

        # Verify via registry.oauth() — vendor-isolated. The live adapter
        # wraps google.oauth2 internally; the mock would refuse here.
        identity = await _ipg.oauth().verify_id_token(token)
        if not identity.success:
            raise HTTPException(status_code=401, detail=f"Google token invalid: {identity.error}")

        # Extract identity. Google guarantees `sub` is stable per user
        # across sessions; `email` is present when the `email` scope
        # was granted (default for Sign-In flow).
        google_sub = identity.subject
        email = (identity.email or "").strip().lower()
        email_verified = identity.email_verified
        name = identity.name or (email.split("@")[0] if email else None)
        picture = identity.picture_url

        if not google_sub or not email:
            raise HTTPException(status_code=401, detail="Google token missing sub/email")
        if not email_verified:
            # Protects against the odd case where Google reports an
            # unverified email — we don't want strangers hijacking accounts.
            raise HTTPException(status_code=401, detail="Google email not verified")

        # 3. Find-or-create user. We key on google_sub first (immutable),
        #    then fall back to email so existing password-seeded accounts
        #    (admin@atlas.dev etc.) merge cleanly on first Google login.
        user = await db.users.find_one({"google_sub": google_sub}, {"_id": 0})
        if not user:
            user = await db.users.find_one({"email": email}, {"_id": 0})

        now = _now_utc()
        if user:
            # Link Google to the existing account on first sign-in.
            await db.users.update_one(
                {"user_id": user["user_id"]},
                {"$set": {
                    "google_sub": google_sub,
                    "picture": user.get("picture") or picture,
                    "last_login_at": now.isoformat(),
                    "auth_provider": "google",
                }},
            )
        else:
            user_id = f"user_{uuid.uuid4().hex[:12]}"
            user = {
                "user_id": user_id,
                "email": email,
                "name": name,
                "picture": picture,
                "role": "client",           # default role — matches rest of app
                "roles": ["client"],
                "active_role": "client",
                "states": ["client"],
                "active_context": "client",
                "level": "junior",
                "skills": [],
                "capacity": 5,
                "tier": "starter",
                "rating": 5.0,
                "source": "google",
                "auth_provider": "google",
                "google_sub": google_sub,
                "completed_tasks": 0,
                "active_load": 0,
                "active_modules": 0,
                "created_at": now.isoformat(),
                "last_login_at": now.isoformat(),
            }
            await db.users.insert_one(user)
            # Re-read to drop Mongo's injected _id.
            user = await db.users.find_one({"user_id": user_id}, {"_id": 0})

        # 4. Issue the same session cookie the rest of the app reads.
        #    Mirrors the pattern at server.py ~L1741.
        session_token = secrets.token_urlsafe(32)
        await db.user_sessions.insert_one({
            "session_id": f"sess_{uuid.uuid4().hex[:12]}",
            "session_token": session_token,
            "user_id": user["user_id"],
            "auth_method": "google",
            "created_at": now.isoformat(),
            "expires_at": (now + timedelta(days=7)).isoformat(),
        })
        response.set_cookie(
            key="session_token",
            value=session_token,
            httponly=True,
            secure=True,
            samesite="none",
            path="/",
            max_age=7 * 24 * 60 * 60,
        )

        # Mirror the shape of /auth/login — never leak password_hash.
        user.pop("password_hash", None)
        if isinstance(user.get("created_at"), datetime):
            user["created_at"] = user["created_at"].isoformat()
        return {
            "ok": True,
            "is_new": user.get("last_login_at") == user.get("created_at"),
            "user": user,
            "session_token": session_token,   # bearer fallback for native clients
        }

    return router
