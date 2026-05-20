"""
Two-factor authentication — full TOTP implementation.

Replaces the toy email-OTP-only 2FA in account_layer.py with the real thing:
- TOTP secret generated server-side (RFC 6238)
- otpauth:// provisioning URI + PNG QR data-URL for authenticator apps
- 10 single-use recovery codes (bcrypt-hashed, surfaced once at enrollment)
- Login-time TOTP verification with challenge_token state machine
- Recovery code accepted in place of TOTP at login OR for disable

Endpoints (mounted under /api):
  POST   /account/me/2fa/setup                  — start enrollment (returns pending_secret + QR + otpauth_uri)
  POST   /account/me/2fa/setup/verify           — confirm code → activate + return recovery codes (plaintext, ONCE)
  POST   /account/me/2fa/setup/cancel           — drop pending_secret without activating
  POST   /account/me/2fa/disable                — body {code} (TOTP or recovery) → turn 2FA off
  GET    /account/me/2fa/recovery-codes/status  — count of unused recovery codes
  POST   /account/me/2fa/recovery-codes/regenerate — body {code} → new set of 10 (plaintext, ONCE)

  POST   /mobile/auth/2fa/verify                — body {challenge_token, code} → real session
  POST   /auth/2fa/verify                       — same, cookie-based (web)

Schema additions to `users` doc:
  - two_factor_enabled: bool
  - totp_secret: str | None              (active secret, base32, never returned)
  - totp_pending_secret: str | None      (during enrollment only)
  - recovery_codes: list[{hash, used_at}]
  - totp_activated_at: iso str | None

Schema (new collection):
  - two_factor_challenges: { challenge_token, user_id, created_at, expires_at, consumed_at }
"""
from __future__ import annotations

import base64
import io
import logging
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import bcrypt
import pyotp
import qrcode
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, Field

logger = logging.getLogger("two_factor")

_db = None
_get_current_user = None
_create_session = None   # function(user_id) -> session_token, injected from mobile_adapter

ISSUER = "ATLAS DevOS"
CHALLENGE_TTL_SECONDS = 5 * 60
RECOVERY_CODES_COUNT = 10
TRUSTED_DEVICE_TTL_DAYS = 30


def wire(*, db, get_current_user, create_session):
    """Wire dependencies. `create_session` is the existing session-token factory
    so both web and mobile 2fa/verify produce the same session shape."""
    global _db, _get_current_user, _create_session
    _db = db
    _get_current_user = get_current_user
    _create_session = create_session


# ───────────────────────────────────────────────────────────────
# Trusted device helpers — power the "Trust this device for 30 days"
# affordance on the 2FA challenge step.
# ───────────────────────────────────────────────────────────────

def _hash_fingerprint(fingerprint: str) -> str:
    """We hash the client-supplied fingerprint with bcrypt before storing.
    The fingerprint is opaque to us — typically a UUID generated on first
    visit and stored in localStorage/AsyncStorage. Storing the hash means a
    DB compromise can't be used to spoof a trusted device for a different
    user (the attacker would need the original fingerprint AND the user_id
    binding)."""
    return bcrypt.hashpw(fingerprint.encode("utf-8"), bcrypt.gensalt(rounds=8)).decode("utf-8")


def _check_fingerprint(fingerprint: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(fingerprint.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


async def is_device_trusted(user_id: str, fingerprint: Optional[str]) -> bool:
    """Returns True iff `fingerprint` matches an unexpired trusted_devices
    record for this user. Caller uses this to short-circuit the 2FA gate."""
    if not fingerprint or len(fingerprint) < 8:
        return False
    cursor = _db.trusted_devices.find({"user_id": user_id})
    now = _now()
    async for doc in cursor:
        expires_at = doc.get("expires_at_ts")
        if isinstance(expires_at, datetime):
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at < now:
                continue
        elif isinstance(expires_at, str):
            try:
                expires_at = datetime.fromisoformat(expires_at)
                if expires_at.tzinfo is None:
                    expires_at = expires_at.replace(tzinfo=timezone.utc)
                if expires_at < now:
                    continue
            except Exception:
                continue
        else:
            continue
        if _check_fingerprint(fingerprint, doc.get("fingerprint_hash", "")):
            # Refresh last_used_at so the management UI in Settings shows
            # real recency for this device. We don't extend the expiry here
            # — that only happens through trust_device() on an explicit
            # "Trust this device" verify.
            try:
                await _db.trusted_devices.update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"last_used_at": _now_iso()}},
                )
            except Exception:
                pass
            return True
    return False


async def trust_device(
    user_id: str,
    fingerprint: str,
    user_agent: Optional[str] = None,
    label: Optional[str] = None,
) -> None:
    """Persist a trust grant for `fingerprint` valid for TRUSTED_DEVICE_TTL_DAYS."""
    if not fingerprint or len(fingerprint) < 8:
        return
    # If a record for this exact fingerprint already exists, refresh its
    # expiry rather than minting duplicates.
    expires = _now() + timedelta(days=TRUSTED_DEVICE_TTL_DAYS)
    existing_cursor = _db.trusted_devices.find({"user_id": user_id})
    async for doc in existing_cursor:
        if _check_fingerprint(fingerprint, doc.get("fingerprint_hash", "")):
            await _db.trusted_devices.update_one(
                {"_id": doc["_id"]},
                {"$set": {
                    "expires_at": expires.isoformat(),
                    "expires_at_ts": expires,
                    "last_used_at": _now_iso(),
                    "user_agent": (user_agent or "")[:200] or doc.get("user_agent"),
                }},
            )
            return

    await _db.trusted_devices.insert_one({
        "device_id": f"td_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "fingerprint_hash": _hash_fingerprint(fingerprint),
        "user_agent": (user_agent or "")[:200] or None,
        "label": (label or "")[:80] or None,
        "created_at": _now_iso(),
        "last_used_at": _now_iso(),
        "expires_at": expires.isoformat(),
        "expires_at_ts": expires,
    })


# ───────────────────────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _gen_recovery_code() -> str:
    """8-character group + 8-character group, base32-ish. e.g. ABCD-EF12-..."""
    raw = secrets.token_hex(5)  # 10 hex chars
    return f"{raw[:5].upper()}-{raw[5:].upper()}"


def _hash_code(code: str) -> str:
    # Always normalize before hashing so the displayed `XXXXX-XXXXX` form
    # and the user-typed `XXXXXXXXXX` (or `xxxx xxxx` etc.) compare equal.
    return bcrypt.hashpw(_normalize_code(code).encode("utf-8"), bcrypt.gensalt(rounds=8)).decode("utf-8")


def _check_code(code: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_normalize_code(code).encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def _normalize_code(s: str) -> str:
    """Strip whitespace and dashes; uppercase. Works for both 6-digit TOTP and
    XXXXX-XXXXX recovery codes."""
    return (s or "").strip().replace(" ", "").replace("-", "").upper()


def _build_qr_data_url(otpauth_uri: str) -> str:
    """Render an otpauth:// URI as a PNG QR, base64 data-URL — for `<img src=...>`."""
    img = qrcode.make(otpauth_uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


async def _verify_totp_or_recovery(user_id: str, code: str) -> tuple[bool, str]:
    """Verify a 6-digit TOTP or a recovery code against the user's stored
    secrets. Returns (ok, method) where method ∈ {'totp', 'recovery'}.

    Recovery codes are single-use: on success we mark them consumed.
    """
    cleaned = _normalize_code(code)
    if not cleaned:
        return False, ""

    user = await _db.users.find_one(
        {"user_id": user_id},
        {"_id": 0, "totp_secret": 1, "recovery_codes": 1, "two_factor_enabled": 1},
    )
    if not user or not user.get("two_factor_enabled"):
        return False, ""

    secret = user.get("totp_secret")
    # Try TOTP first (digit-only, length 6)
    if secret and cleaned.isdigit() and len(cleaned) == 6:
        totp = pyotp.TOTP(secret)
        # valid_window=1 → accept previous/next 30s window for clock drift
        if totp.verify(cleaned, valid_window=1):
            return True, "totp"

    # Then recovery codes
    codes: List[dict] = user.get("recovery_codes") or []
    for idx, rec in enumerate(codes):
        if rec.get("used_at"):
            continue
        if _check_code(cleaned, rec["hash"]):
            await _db.users.update_one(
                {"user_id": user_id},
                {"$set": {f"recovery_codes.{idx}.used_at": _now_iso()}},
            )
            return True, "recovery"
    return False, ""


# ───────────────────────────────────────────────────────────────
# Models
# ───────────────────────────────────────────────────────────────

class CodeBody(BaseModel):
    code: str = Field(..., min_length=4, max_length=24)


class ChallengeVerify(BaseModel):
    challenge_token: str
    code: str = Field(..., min_length=4, max_length=24)
    device_fingerprint: Optional[str] = Field(default=None, max_length=128)
    trust_device: Optional[bool] = False
    device_label: Optional[str] = Field(default=None, max_length=80)


# ───────────────────────────────────────────────────────────────
# Router (account-side: setup / disable / recovery)
# ───────────────────────────────────────────────────────────────

def build_router() -> APIRouter:
    r = APIRouter(tags=["two-factor"])

    @r.post("/account/me/2fa/setup")
    async def setup_init(user=Depends(_get_current_user)):
        """Start enrollment. Generates a pending secret, stores it WITHOUT
        activating 2FA. Returns provisioning URI + QR data-URL.

        Caller must then POST /account/me/2fa/setup/verify with a fresh code
        from their authenticator app to actually flip the flag.
        """
        u = await _db.users.find_one(
            {"user_id": user.user_id},
            {"_id": 0, "two_factor_enabled": 1, "email": 1, "name": 1},
        )
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        if u.get("two_factor_enabled"):
            raise HTTPException(status_code=400, detail="2FA is already enabled — disable it first to re-enroll")

        secret = pyotp.random_base32()
        await _db.users.update_one(
            {"user_id": user.user_id},
            {"$set": {"totp_pending_secret": secret, "updated_at": _now_iso()}},
        )

        label = u.get("email") or user.user_id
        otpauth_uri = pyotp.TOTP(secret).provisioning_uri(name=label, issuer_name=ISSUER)
        return {
            "secret": secret,  # surface so user can type into Authy/1Password manually
            "otpauth_uri": otpauth_uri,
            "qr_data_url": _build_qr_data_url(otpauth_uri),
            "issuer": ISSUER,
            "label": label,
        }

    @r.post("/account/me/2fa/setup/verify")
    async def setup_verify(body: CodeBody, user=Depends(_get_current_user)):
        """Confirm a TOTP code against the pending secret. On success:
        promote pending→active, mint 10 recovery codes (plaintext, returned
        ONCE), flip two_factor_enabled."""
        u = await _db.users.find_one(
            {"user_id": user.user_id},
            {"_id": 0, "totp_pending_secret": 1, "two_factor_enabled": 1},
        )
        if not u or not u.get("totp_pending_secret"):
            raise HTTPException(status_code=400, detail="No pending enrollment — call /setup first")
        if u.get("two_factor_enabled"):
            raise HTTPException(status_code=400, detail="2FA is already enabled")

        pending = u["totp_pending_secret"]
        cleaned = _normalize_code(body.code)
        if not (cleaned.isdigit() and len(cleaned) == 6):
            raise HTTPException(status_code=400, detail="Enter the 6-digit code from your authenticator app")

        totp = pyotp.TOTP(pending)
        if not totp.verify(cleaned, valid_window=1):
            raise HTTPException(status_code=400, detail="Code didn't match — double-check the time on your device")

        # Mint recovery codes — store hashes, return plaintext exactly once.
        plain_codes = [_gen_recovery_code() for _ in range(RECOVERY_CODES_COUNT)]
        recovery_docs = [{"hash": _hash_code(c), "used_at": None, "created_at": _now_iso()} for c in plain_codes]

        await _db.users.update_one(
            {"user_id": user.user_id},
            {
                "$set": {
                    "two_factor_enabled": True,
                    "totp_secret": pending,
                    "totp_activated_at": _now_iso(),
                    "recovery_codes": recovery_docs,
                    "updated_at": _now_iso(),
                },
                "$unset": {"totp_pending_secret": ""},
            },
        )

        # Audit
        await _db.user_audit_log.insert_one({
            "type": "user_action",
            "action": "two_factor_enabled",
            "user_id": user.user_id,
            "payload": {"method": "totp"},
            "timestamp": _now_iso(),
        })

        return {
            "two_factor_enabled": True,
            "recovery_codes": plain_codes,  # last time the server ever sees these
            "warning": "Save these codes somewhere safe — you will NOT see them again.",
        }

    @r.post("/account/me/2fa/setup/cancel")
    async def setup_cancel(user=Depends(_get_current_user)):
        """Drop a half-finished enrollment."""
        await _db.users.update_one(
            {"user_id": user.user_id},
            {"$unset": {"totp_pending_secret": ""}, "$set": {"updated_at": _now_iso()}},
        )
        return {"ok": True}

    @r.post("/account/me/2fa/disable")
    async def disable(body: CodeBody, user=Depends(_get_current_user)):
        """Turn 2FA off. Requires a valid TOTP code OR an unused recovery code
        — to prevent a stolen session from disabling 2FA on its own."""
        u = await _db.users.find_one(
            {"user_id": user.user_id},
            {"_id": 0, "two_factor_enabled": 1},
        )
        if not u or not u.get("two_factor_enabled"):
            return {"two_factor_enabled": False}  # already off

        ok, method = await _verify_totp_or_recovery(user.user_id, body.code)
        if not ok:
            raise HTTPException(status_code=400, detail="Invalid code — try a fresh authenticator code or a recovery code")

        await _db.users.update_one(
            {"user_id": user.user_id},
            {
                "$set": {
                    "two_factor_enabled": False,
                    "updated_at": _now_iso(),
                },
                "$unset": {"totp_secret": "", "recovery_codes": "", "totp_activated_at": ""},
            },
        )
        await _db.user_audit_log.insert_one({
            "type": "user_action",
            "action": "two_factor_disabled",
            "user_id": user.user_id,
            "payload": {"verified_via": method},
            "timestamp": _now_iso(),
        })
        return {"two_factor_enabled": False, "verified_via": method}

    @r.get("/account/me/2fa/recovery-codes/status")
    async def recovery_status(user=Depends(_get_current_user)):
        u = await _db.users.find_one(
            {"user_id": user.user_id},
            {"_id": 0, "recovery_codes": 1, "two_factor_enabled": 1},
        )
        if not u or not u.get("two_factor_enabled"):
            return {"total": 0, "unused": 0, "enabled": False}
        codes = u.get("recovery_codes") or []
        unused = sum(1 for c in codes if not c.get("used_at"))
        return {"total": len(codes), "unused": unused, "enabled": True}

    @r.post("/account/me/2fa/recovery-codes/regenerate")
    async def recovery_regenerate(body: CodeBody, user=Depends(_get_current_user)):
        """Mint a fresh set of 10 codes. Requires a current TOTP code so a
        stolen cookie can't silently rotate the codes."""
        u = await _db.users.find_one(
            {"user_id": user.user_id},
            {"_id": 0, "two_factor_enabled": 1, "totp_secret": 1},
        )
        if not u or not u.get("two_factor_enabled"):
            raise HTTPException(status_code=400, detail="2FA is not enabled")

        cleaned = _normalize_code(body.code)
        # Regen REQUIRES a TOTP (not a recovery code) — defence in depth.
        if not (cleaned.isdigit() and len(cleaned) == 6):
            raise HTTPException(status_code=400, detail="Enter the 6-digit code from your authenticator app")
        if not pyotp.TOTP(u["totp_secret"]).verify(cleaned, valid_window=1):
            raise HTTPException(status_code=400, detail="Code didn't match")

        plain_codes = [_gen_recovery_code() for _ in range(RECOVERY_CODES_COUNT)]
        recovery_docs = [{"hash": _hash_code(c), "used_at": None, "created_at": _now_iso()} for c in plain_codes]
        await _db.users.update_one(
            {"user_id": user.user_id},
            {"$set": {"recovery_codes": recovery_docs, "updated_at": _now_iso()}},
        )
        return {
            "recovery_codes": plain_codes,
            "warning": "Save these codes somewhere safe — you will NOT see them again.",
        }

    return r


# ───────────────────────────────────────────────────────────────
# Login-side challenge endpoints (mobile + web)
# ───────────────────────────────────────────────────────────────

async def issue_challenge(user_id: str) -> str:
    """Mint a one-time challenge token. Called by login handlers when the
    primary credential (password) was correct but 2FA is enabled.

    Frontend stores this token in memory, prompts the user for their TOTP
    code, then POSTs to /auth/2fa/verify (or /mobile/auth/2fa/verify) which
    returns a real session.
    """
    challenge_token = f"chal_{uuid.uuid4().hex}{secrets.token_hex(8)}"
    expires = _now() + timedelta(seconds=CHALLENGE_TTL_SECONDS)
    await _db.two_factor_challenges.insert_one({
        "challenge_token": challenge_token,
        "user_id": user_id,
        "created_at": _now_iso(),
        "expires_at": expires.isoformat(),
        "expires_at_ts": expires,   # BSON Date for the TTL index in ensure_indexes()
        "consumed_at": None,
        "attempts": 0,
    })
    return challenge_token


async def _consume_challenge(challenge_token: str, code: str) -> Optional[str]:
    """Atomically verify a challenge_token + code. Returns user_id on success;
    raises HTTPException on any failure."""
    doc = await _db.two_factor_challenges.find_one({"challenge_token": challenge_token})
    if not doc:
        raise HTTPException(status_code=400, detail="Invalid or expired challenge")
    if doc.get("consumed_at"):
        raise HTTPException(status_code=400, detail="Challenge already used")
    if doc.get("attempts", 0) >= 5:
        raise HTTPException(status_code=429, detail="Too many failed attempts — sign in again")

    expires = datetime.fromisoformat(doc["expires_at"])
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < _now():
        raise HTTPException(status_code=410, detail="Challenge expired — sign in again")

    ok, method = await _verify_totp_or_recovery(doc["user_id"], code)
    if not ok:
        await _db.two_factor_challenges.update_one(
            {"challenge_token": challenge_token},
            {"$inc": {"attempts": 1}},
        )
        raise HTTPException(status_code=400, detail="Invalid code")

    await _db.two_factor_challenges.update_one(
        {"challenge_token": challenge_token},
        {"$set": {"consumed_at": _now_iso(), "verified_via": method}},
    )
    return doc["user_id"]


def build_login_router(mobile_user_view) -> APIRouter:
    """Login-step routes. `mobile_user_view(user_doc) -> dict` is supplied by
    mobile_adapter so the shape stays consistent with /mobile/auth/login."""
    r = APIRouter(tags=["two-factor-login"])

    @r.post("/mobile/auth/2fa/verify")
    async def mobile_verify(body: ChallengeVerify, request: Request, response: Response):
        user_id = await _consume_challenge(body.challenge_token, body.code)
        user = await _db.users.find_one({"user_id": user_id}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        # Honour "Trust this device for 30 days" — only if the client both
        # asked for it AND provided a fingerprint. We never auto-trust on
        # silent flows.
        if body.trust_device and body.device_fingerprint:
            await trust_device(
                user_id,
                body.device_fingerprint,
                user_agent=request.headers.get("user-agent"),
                label=body.device_label,
            )
        token = await _create_session(user_id)
        response.set_cookie(
            key="session_token", value=token, httponly=True, secure=True,
            samesite="none", path="/", max_age=7 * 24 * 60 * 60,
        )
        return {"token": token, "user": mobile_user_view(user)}

    @r.post("/auth/2fa/verify")
    async def web_verify(body: ChallengeVerify, request: Request, response: Response):
        """Cookie-based verify for the web SPA flow."""
        user_id = await _consume_challenge(body.challenge_token, body.code)
        user = await _db.users.find_one({"user_id": user_id}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        if body.trust_device and body.device_fingerprint:
            await trust_device(
                user_id,
                body.device_fingerprint,
                user_agent=request.headers.get("user-agent"),
                label=body.device_label,
            )
        token = await _create_session(user_id)
        response.set_cookie(
            key="session_token", value=token, httponly=True, secure=True,
            samesite="none", path="/", max_age=7 * 24 * 60 * 60,
        )
        # Strip everything sensitive — never let a 2FA secret leak in any
        # response, even on a success path. Defence in depth on top of the
        # caller's allow-list shaping.
        for f in ("password_hash", "totp_secret", "totp_pending_secret", "recovery_codes"):
            user.pop(f, None)
        return user

    @r.get("/account/me/2fa/trusted-devices")
    async def list_trusted(user=Depends(_get_current_user)):
        """Return active trust grants for this user — useful for the
        Settings → 'Trusted devices' section."""
        now = _now()
        out: List[dict] = []
        async for d in _db.trusted_devices.find({"user_id": user.user_id}):
            ts = d.get("expires_at_ts")
            if isinstance(ts, datetime):
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                if ts < now:
                    continue
            out.append({
                "device_id": d.get("device_id"),
                "label": d.get("label"),
                "user_agent": d.get("user_agent"),
                "created_at": d.get("created_at"),
                "last_used_at": d.get("last_used_at"),
                "expires_at": d.get("expires_at"),
            })
        # Most recent first.
        out.sort(key=lambda x: x.get("last_used_at") or x.get("created_at") or "", reverse=True)
        return {"devices": out}

    @r.delete("/account/me/2fa/trusted-devices/{device_id}")
    async def revoke_trusted(device_id: str, user=Depends(_get_current_user)):
        result = await _db.trusted_devices.delete_one({
            "user_id": user.user_id,
            "device_id": device_id,
        })
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Device not found")
        return {"ok": True, "revoked": device_id}

    @r.post("/account/me/2fa/trusted-devices/revoke-all")
    async def revoke_all_trusted(user=Depends(_get_current_user)):
        """Drop every trust grant — forces every device (including this one
        on its next login) back through the 2FA challenge."""
        result = await _db.trusted_devices.delete_many({"user_id": user.user_id})
        return {"ok": True, "revoked": result.deleted_count}

    return r


async def ensure_indexes(db) -> None:
    """Create TTL + lookup indexes for the two_factor_challenges and
    trusted_devices collections. Safe to call repeatedly — `create_index`
    is idempotent when the spec matches. Called once on startup."""
    try:
        await db.two_factor_challenges.create_index("challenge_token", unique=True)
        # MongoDB TTL: documents whose `expires_at_ts` is older than `now` are
        # purged. We store ISO strings elsewhere; the TTL field is a BSON Date
        # written alongside (server-side sweep is best-effort cleanup of
        # consumed/expired challenges, not the primary verification gate).
        await db.two_factor_challenges.create_index("expires_at_ts", expireAfterSeconds=0)
        await db.trusted_devices.create_index("user_id")
        await db.trusted_devices.create_index("expires_at_ts", expireAfterSeconds=0)
        await db.trusted_devices.create_index("device_id", unique=True, sparse=True)
    except Exception as e:
        logger.warning(f"two_factor index ensure failed: {e}")
