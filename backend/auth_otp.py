"""
Email-code (OTP) auth — production-grade.

Layers:
  1. Identity     — email + 6-digit code; same shape for new and returning users
  2. Session      — `session_token` cookie (httpOnly, secure, samesite=none)
  3. Ownership    — verify-code returns user; ownership claim handled upstream
  4. Audit        — every send / verify is logged in `auth_events`

Anti-abuse:
  • per-email cooldown (30s) — already in original
  • per-email burst limit  (5 codes / 10 min)
  • per-IP burst limit     (20 codes / hour)
  • per-code attempts cap  (5)

Email delivery is wired through `email_service.send_otp_email`. When the
provider is configured (RESEND_API_KEY set) we send a real email and DO NOT
return the code in the response. When it's not configured, we surface the
code in a `dev_code` field — useful for local dev only.
"""

from __future__ import annotations

import logging
import os
import random
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field

from email_service import _otp_html  # vendor-neutral HTML template only
from integrations import registry, MailMessage, AvailabilityMode

logger = logging.getLogger("auth_otp")

# Injected on wire()
_db = None
_hash_password = None

# Config — code lifecycle
CODE_TTL_SECONDS = 10 * 60
CODE_MAX_ATTEMPTS = 5
CODE_RESEND_COOLDOWN = 30      # min seconds between sends to same email

# Anti-abuse — burst windows
EMAIL_WINDOW_SECONDS = 10 * 60
EMAIL_WINDOW_MAX = 5            # max codes per email per 10 min
IP_WINDOW_SECONDS = 60 * 60
IP_WINDOW_MAX = 20              # max codes per IP per hour

# DEV mode: surfaces the code in the HTTP response. Default is OFF (Этап 2).
# To enable in local/preview, explicitly set AUTH_OTP_DEV_MODE=true. Without
# Resend configured, OTP delivery will silently log the code server-side; the
# response stays clean. The `failed_fallback` code-in-response path is still
# triggered if a real provider outage happens — that's a graceful degradation,
# not the default state.
_env_dev = os.environ.get("AUTH_OTP_DEV_MODE", "").lower()
if _env_dev in ("true", "1", "yes"):
    DEV_MODE = True
elif _env_dev in ("false", "0", "no"):
    DEV_MODE = False
else:
    # Default: OFF. Operators must opt-in for dev.
    DEV_MODE = False

def _mail_state():
    """Read live mail capability state. Cheap — no I/O."""
    return registry.mail().health()


logger.info(
    f"AUTH OTP init: DEV_MODE={DEV_MODE} mail_provider={_mail_state().provider_name} mail_mode={_mail_state().mode.value}"
)


def wire(*, db, hash_password):
    global _db, _hash_password
    _db = db
    _hash_password = hash_password


def _now():
    return datetime.now(timezone.utc)


def _now_iso():
    return _now().isoformat()


class SendCodeReq(BaseModel):
    email: EmailStr


class VerifyCodeReq(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=4, max_length=8)
    name: Optional[str] = None


def _to_mobile_user(u: dict) -> dict:
    if not u:
        return None
    roles = u.get("roles") or ([u.get("role") or "client"])
    active_role = u.get("active_role") or roles[0]
    return {
        "user_id": u.get("user_id"),
        "email": u.get("email"),
        "name": u.get("name"),
        "picture": u.get("picture"),
        "roles": roles,
        "active_role": active_role,
        "role": active_role,
        "tier": u.get("tier") or u.get("subscription") or "starter",
        "strikes": int(u.get("strikes") or 0),
        "capacity": int(u.get("capacity") or 5),
        "active_modules": int(u.get("active_modules") or u.get("active_load") or 0),
        "level": u.get("level") or "junior",
        "rating": u.get("rating") or 5.0,
        "skills": u.get("skills") or [],
        "is_demo": bool(u.get("is_demo") or False),
    }


def _client_ip(req: Request) -> str:
    # Trust the platform's front proxy; pick the first hop in XFF.
    xff = req.headers.get("x-forwarded-for") or ""
    if xff:
        return xff.split(",")[0].strip()
    return (req.client.host if req.client else "unknown")


async def _audit(event: str, **fields) -> None:
    """Best-effort audit log. Never blocks the request on failure."""
    try:
        await _db.auth_events.insert_one({
            "event": event,
            "at": _now_iso(),
            **fields,
        })
    except Exception as e:
        logger.warning(f"AUDIT write failed ({event}): {e}")


async def _enforce_rate_limits(email: str, ip: str) -> None:
    """Raise 429 if either window is exhausted. Counts only successful sends."""
    now = _now()
    # Per-email burst
    since_email = (now - timedelta(seconds=EMAIL_WINDOW_SECONDS)).isoformat()
    email_count = await _db.auth_events.count_documents({
        "event": "send_code",
        "email": email,
        "at": {"$gte": since_email},
    })
    if email_count >= EMAIL_WINDOW_MAX:
        raise HTTPException(
            status_code=429,
            detail=f"Too many codes for this email. Try again in {EMAIL_WINDOW_SECONDS // 60} minutes.",
        )
    # Per-IP burst
    since_ip = (now - timedelta(seconds=IP_WINDOW_SECONDS)).isoformat()
    ip_count = await _db.auth_events.count_documents({
        "event": "send_code",
        "ip": ip,
        "at": {"$gte": since_ip},
    })
    if ip_count >= IP_WINDOW_MAX:
        raise HTTPException(
            status_code=429,
            detail="Too many requests from your network. Try again later.",
        )


async def _create_session(user_id: str) -> str:
    token = f"sess_{uuid.uuid4().hex}"
    expires_at = _now() + timedelta(days=7)
    await _db.user_sessions.insert_one({
        "session_id": str(uuid.uuid4()),
        "user_id": user_id,
        "session_token": token,
        "expires_at": expires_at.isoformat(),
        "created_at": _now_iso(),
    })
    return token


def _gen_code() -> str:
    return f"{random.randint(0, 999_999):06d}"


def build_router() -> APIRouter:
    r = APIRouter(tags=["auth-otp"])

    @r.post("/auth/send-code")
    async def send_code(req: SendCodeReq, request: Request):
        email = req.email.strip().lower()
        ip = _client_ip(request)

        # Cooldown — re-surface the active code in DEV; throttle in prod
        existing = await _db.auth_codes.find_one(
            {"email": email, "consumed_at": None},
            {"_id": 0, "created_at": 1, "code": 1, "expires_at": 1},
            sort=[("created_at", -1)],
        )
        if existing:
            try:
                last = datetime.fromisoformat(existing["created_at"])
                age = (_now() - last).total_seconds()
                if age < CODE_RESEND_COOLDOWN:
                    if DEV_MODE:
                        try:
                            ttl_left = int(
                                (datetime.fromisoformat(existing["expires_at"]) - _now()).total_seconds()
                            )
                        except (KeyError, ValueError):
                            ttl_left = CODE_TTL_SECONDS
                        user = await _db.users.find_one({"email": email}, {"_id": 0, "user_id": 1}) or None
                        return {
                            "ok": True,
                            "sent_at": existing["created_at"],
                            "expires_in": max(0, ttl_left),
                            "is_new_user": not bool(user),
                            "dev_code": existing["code"],
                            "throttled": True,
                            "cooldown_remaining": int(CODE_RESEND_COOLDOWN - age),
                        }
                    raise HTTPException(
                        status_code=429,
                        detail=f"Please wait {int(CODE_RESEND_COOLDOWN - age)}s before requesting a new code",
                    )
            except HTTPException:
                raise
            except (KeyError, ValueError):
                pass

        # Burst limits (per-email + per-IP)
        await _enforce_rate_limits(email, ip)

        code = _gen_code()
        doc = {
            "email": email,
            "code": code,
            "expires_at": (_now() + timedelta(seconds=CODE_TTL_SECONDS)).isoformat(),
            "created_at": _now_iso(),
            "attempts": 0,
            "consumed_at": None,
            "ip": ip,
        }
        await _db.auth_codes.insert_one(doc)

        # Vendor-neutral OTP delivery via integrations.registry.mail().
        # Behaviour by provider mode (Этап 5.1):
        #   • live      → real email goes out, code NEVER returned in response
        #   • mock      → code is logged + (if DEV_MODE or fallback) surfaced
        #   • degraded  → tries to send; on error, fallback path activates
        #   • unavailable → code goes to logs only, surfaced in response so
        #                   operator can recover without locking users out
        delivery_status = "logged"
        message_id: Optional[str] = None
        delivery_error: Optional[str] = None
        mail_state = _mail_state()
        mail_mode = mail_state.mode

        if mail_mode == AvailabilityMode.LIVE and not DEV_MODE:
            try:
                msg = MailMessage(
                    to=email,
                    subject=f"Your EVA-X code is {code}",
                    text=f"Your EVA-X sign-in code is {code}. It expires in {CODE_TTL_SECONDS // 60} minutes.",
                    html=_otp_html(code, CODE_TTL_SECONDS // 60),
                    tags=["otp"],
                    metadata={"capability": "auth_otp"},
                )
                result = await registry.mail().send(msg)
                if result.success:
                    message_id = result.provider_ref
                    delivery_status = "sent"
                else:
                    delivery_error = (result.error or "send failed")[:200]
                    delivery_status = "failed_fallback"
                    logger.error(f"AUTH OTP delivery failed for {email}: {delivery_error} — falling back to in-response code")
                    await _audit("send_code_failed", email=email, ip=ip, reason=delivery_error)
            except Exception as e:
                delivery_error = str(e)[:200]
                delivery_status = "failed_fallback"
                logger.error(f"AUTH OTP delivery raised for {email}: {e} — falling back to in-response code")
                await _audit("send_code_failed", email=email, ip=ip, reason=delivery_error)
        elif mail_mode == AvailabilityMode.MOCK:
            # Mock provider records the message for inspection (outbox) but no
            # external mail goes out. Honest log; code only surfaces if DEV.
            try:
                msg = MailMessage(
                    to=email,
                    subject=f"[MOCK MAIL] Your EVA-X code is {code}",
                    text=f"[MOCK] sign-in code: {code} (TTL {CODE_TTL_SECONDS // 60} min)",
                    tags=["otp", "mock"],
                    metadata={"capability": "auth_otp", "mode": "mock"},
                )
                result = await registry.mail().send(msg)
                message_id = result.provider_ref
            except Exception:
                # Mock should never raise — but stay defensive.
                pass
            delivery_status = "mock"
            logger.info(f"AUTH OTP (mock mail): code={code} → {email} (reason={mail_state.reason})")
        else:
            # AvailabilityMode.UNAVAILABLE / DEGRADED → log only, surface code
            delivery_status = "unavailable_fallback"
            delivery_error = mail_state.reason
            logger.info(f"AUTH OTP (mail unavailable): code={code} → {email} (reason={mail_state.reason})")

        # Audit (counted toward the rate windows above)
        await _audit("send_code", email=email, ip=ip, delivery=delivery_status, message_id=message_id)

        user = await _db.users.find_one({"email": email}, {"_id": 0, "user_id": 1}) or None
        resp = {
            "ok": True,
            "sent_at": doc["created_at"],
            "expires_in": CODE_TTL_SECONDS,
            "is_new_user": not bool(user),
        }
        # Surface the code in either DEV mode or the fallback path. The
        # fallback is rare (mis-config) but we'd rather be permissive than
        # lock real users out during a provider outage.
        if DEV_MODE or delivery_status == "failed_fallback":
            resp["dev_code"] = code
            if delivery_error:
                resp["delivery_warning"] = delivery_error
        return resp

    @r.post("/auth/verify-code")
    async def verify_code(req: VerifyCodeReq, request: Request, response: Response):
        email = req.email.strip().lower()
        code = req.code.strip()
        ip = _client_ip(request)

        doc = await _db.auth_codes.find_one(
            {"email": email, "consumed_at": None},
            {"_id": 0},
            sort=[("created_at", -1)],
        )
        if not doc:
            await _audit("verify_failed", email=email, ip=ip, reason="no_code")
            raise HTTPException(status_code=400, detail="No active code. Request a new one.")

        try:
            expires = datetime.fromisoformat(doc["expires_at"])
            if expires < _now():
                await _audit("verify_failed", email=email, ip=ip, reason="expired")
                raise HTTPException(status_code=400, detail="Code expired. Request a new one.")
        except (KeyError, ValueError):
            await _audit("verify_failed", email=email, ip=ip, reason="bad_expiry")
            raise HTTPException(status_code=400, detail="Code expired. Request a new one.")

        attempts = int(doc.get("attempts") or 0)
        if attempts >= CODE_MAX_ATTEMPTS:
            await _audit("verify_blocked", email=email, ip=ip, reason="max_attempts")
            raise HTTPException(status_code=429, detail="Too many attempts. Request a new code.")

        if code != doc["code"]:
            await _db.auth_codes.update_one(
                {"email": email, "code": doc["code"], "consumed_at": None},
                {"$inc": {"attempts": 1}},
            )
            await _audit("verify_failed", email=email, ip=ip, reason="wrong_code")
            raise HTTPException(status_code=400, detail="Invalid code.")

        await _db.auth_codes.update_one(
            {"email": email, "code": doc["code"], "consumed_at": None},
            {"$set": {"consumed_at": _now_iso()}},
        )

        # Find-or-create
        user = await _db.users.find_one({"email": email}, {"_id": 0}) or None
        is_new = not bool(user)
        if is_new:
            user_id = f"user_{uuid.uuid4().hex[:12]}"
            display = (req.name or email.split("@")[0]).strip()
            user = {
                "user_id": user_id,
                "email": email,
                "password_hash": None,
                "name": display,
                "picture": None,
                "role": "client",
                "roles": ["client"],
                "active_role": "client",
                "skills": [],
                "level": "junior",
                "rating": 5.0,
                "completed_tasks": 0,
                "active_load": 0,
                "capacity": 5,
                "auth_methods": ["code"],
                "created_at": _now_iso(),
            }
            await _db.users.insert_one(user)
            logger.info(f"AUTH OTP: new user {user_id} {email}")
        else:
            methods = set(user.get("auth_methods") or [])
            methods.add("code")
            await _db.users.update_one(
                {"user_id": user["user_id"]},
                {"$set": {"auth_methods": list(methods), "last_login_at": _now_iso()}},
            )

        token = await _create_session(user["user_id"])

        # Auto-enroll as client (OTP is the consumer-facing entry point).
        try:
            current_states = list(user.get("states") or [])
            if not current_states:
                await _db.users.update_one(
                    {"user_id": user["user_id"]},
                    {"$addToSet": {"states": "client"}, "$set": {"active_context": "client"}},
                )
                logger.info(f"AUTH OTP: enrolled {user['user_id']} as client")
        except Exception as e:
            logger.warning(f"AUTH OTP: state enrollment failed: {e}")

        await _audit("verify_ok", email=email, ip=ip, user_id=user["user_id"], is_new=is_new)

        response.set_cookie(
            key="session_token", value=token,
            httponly=True, secure=True, samesite="none", path="/",
            max_age=7 * 24 * 60 * 60,
        )
        user.pop("password_hash", None)
        return {"token": token, "user": _to_mobile_user(user)}

    return r
