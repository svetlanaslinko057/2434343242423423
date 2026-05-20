"""
Account / Identity layer — Phase 1 of User Ownership Layer.

Endpoints (mounted under /api):
  GET    /account/me                        — full identity object (profile + security flags)
  PATCH  /account/me                        — update name / phone / company / timezone / language
  GET    /account/me/avatar/signature       — Cloudinary signed-upload params (or {mock: true})
  POST   /account/me/avatar                 — finalize avatar (real JSON or mock multipart)
  DELETE /account/me/avatar                 — remove avatar
  GET    /account/uploads/avatars/{f}       — serve mock avatar bytes (public URL)

  POST   /account/me/change-email/request   — send OTP to NEW email
  POST   /account/me/change-email/confirm   — verify OTP and switch email

  POST   /account/me/2fa/enable             — turn on email-OTP at login
  POST   /account/me/2fa/disable/request    — send OTP for disable confirmation
  POST   /account/me/2fa/disable/confirm    — verify OTP and turn 2fa off

  DELETE /account/me/request                — send OTP for delete confirmation
  DELETE /account/me/confirm                — verify OTP and soft-delete

  GET    /account/sessions                  — list active sessions
  POST   /account/sessions/revoke-others    — revoke every session except current

NOTE: namespace is /account/* (not /me/*) because /api/me is already taken
by the L0 home context endpoint in server.py (different concern).

OTP for destructive actions reuses `auth_codes` collection from auth_otp.py.
We add a `purpose` field so a code minted for "change-email" can't disable 2FA.
"""
from __future__ import annotations

import logging
import os
import random
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Body, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field

import cloudinary_service  # special-case: signed-upload feature only
from integrations import registry as _ipg, AvailabilityMode

logger = logging.getLogger("account_layer")

# Injected on wire()
_db = None
_get_current_user = None

OTP_TTL_SECONDS = 10 * 60
OTP_PURPOSES = {"change_email", "disable_2fa", "delete_account"}

UPLOADS_DIR = Path("/app/backend/uploads/avatars")


def wire(*, db, get_current_user):
    global _db, _get_current_user
    _db = db
    _get_current_user = get_current_user


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _gen_code() -> str:
    return f"{random.randint(0, 999_999):06d}"


def _identity_view(u: dict) -> dict:
    """Public-safe identity object. Hides password_hash and internal flags."""
    if not u:
        return {}
    return {
        "user_id": u.get("user_id"),
        "email": u.get("email"),
        "name": u.get("name"),
        "avatar_url": u.get("avatar_url"),
        "phone": u.get("phone"),
        "company": u.get("company"),
        "timezone": u.get("timezone"),
        "language": u.get("language") or "en",
        "role": u.get("active_role") or u.get("role") or "client",
        "roles": u.get("roles") or [u.get("role") or "client"],
        "subscription": u.get("subscription") or "starter",
        "two_factor_enabled": bool(u.get("two_factor_enabled") or False),
        "is_deleted": bool(u.get("is_deleted") or False),
        "created_at": u.get("created_at"),
        "last_login_at": u.get("last_login_at"),
    }


# ─── OTP helpers (separate from auth_codes used for login) ───

async def _otp_issue(user_id: str, email: str, purpose: str, request: Request) -> dict:
    """Issue a one-time code bound to (user_id, purpose). Returns dev_code in DEV_MODE."""
    if purpose not in OTP_PURPOSES:
        raise HTTPException(status_code=400, detail="Invalid purpose")

    code = _gen_code()
    doc = {
        "user_id": user_id,
        "email": email.strip().lower(),
        "purpose": purpose,
        "code": code,
        "attempts": 0,
        "consumed_at": None,
        "expires_at": (_now() + timedelta(seconds=OTP_TTL_SECONDS)).isoformat(),
        "created_at": _now_iso(),
    }
    await _db.account_otps.insert_one(doc)

    # Try real email delivery; fall back to logging the code.
    dev_code: Optional[str] = code
    try:
        from email_service import is_configured as email_configured, send_otp_email
        if email_configured():
            await send_otp_email(email, code, ttl_minutes=OTP_TTL_SECONDS // 60)
            dev_code = None
            logger.info(f"ACCOUNT OTP sent to {email} (purpose={purpose})")
        else:
            logger.warning(f"ACCOUNT OTP (DEV) {purpose} for {email}: {code}")
    except Exception as e:
        logger.warning(f"ACCOUNT OTP delivery failed: {e} — dev_code surfaced")

    return {
        "ok": True,
        "expires_in": OTP_TTL_SECONDS,
        "dev_code": dev_code,  # null in production
    }


async def _otp_verify(user_id: str, code: str, purpose: str) -> bool:
    """Atomically verify and consume an OTP. Raises 400/410/429 on failure."""
    doc = await _db.account_otps.find_one(
        {"user_id": user_id, "purpose": purpose, "consumed_at": None},
        sort=[("created_at", -1)],
    )
    if not doc:
        raise HTTPException(status_code=400, detail="No active code for this action")

    expires_at = datetime.fromisoformat(doc["expires_at"])
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < _now():
        raise HTTPException(status_code=410, detail="Code expired — request a new one")

    if doc.get("attempts", 0) >= 5:
        raise HTTPException(status_code=429, detail="Too many failed attempts — request a new code")

    if doc["code"] != code.strip():
        await _db.account_otps.update_one({"_id": doc["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Invalid code")

    await _db.account_otps.update_one(
        {"_id": doc["_id"]},
        {"$set": {"consumed_at": _now_iso()}},
    )
    return True


# ─── Pydantic ───

class ProfilePatch(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    phone: Optional[str] = Field(None, max_length=40)
    company: Optional[str] = Field(None, max_length=120)
    timezone: Optional[str] = Field(None, max_length=64)
    language: Optional[str] = Field(None, max_length=8)


class AvatarFinalize(BaseModel):
    """Sent by frontend after a successful direct-to-Cloudinary upload."""
    public_id: str
    secure_url: str
    version: Optional[int] = None


class ChangeEmailRequest(BaseModel):
    new_email: EmailStr


class OtpConfirm(BaseModel):
    code: str = Field(..., min_length=4, max_length=8)


class ChangeEmailConfirm(OtpConfirm):
    new_email: EmailStr


# ─── Router ───

def build_router() -> APIRouter:
    r = APIRouter(tags=["account"])

    # ── Identity ────────────────────────────────────────────────

    @r.get("/account/me")
    async def get_me(user=Depends(_get_current_user)):
        uid = user.user_id
        u = await _db.users.find_one({"user_id": uid}, {"_id": 0, "password_hash": 0})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        return _identity_view(u)

    @r.patch("/account/me")
    async def patch_me(body: ProfilePatch, user=Depends(_get_current_user)):
        uid = user.user_id
        update: dict = {}
        for field in ("name", "phone", "company", "timezone", "language"):
            v = getattr(body, field)
            if v is not None:
                v = v.strip() if isinstance(v, str) else v
                if v == "":
                    v = None
                update[field] = v
        if not update:
            raise HTTPException(status_code=400, detail="Nothing to update")

        update["updated_at"] = _now_iso()
        await _db.users.update_one({"user_id": uid}, {"$set": update})
        u = await _db.users.find_one({"user_id": uid}, {"_id": 0, "password_hash": 0})
        return _identity_view(u)

    # ── Data export ─────────────────────────────────────────────
    # Snapshot of everything we hold for this user — account profile,
    # their projects, invoices, support tickets, notifications. Returned
    # as plain JSON. The web client triggers a file download, native shows
    # a summary. _id is stripped everywhere; no PII outside their own.
    @r.get("/account/me/export")
    async def export_me(user=Depends(_get_current_user)):
        uid = user.user_id
        u = await _db.users.find_one({"user_id": uid}, {"_id": 0, "password_hash": 0, "totp_secret": 0, "recovery_codes": 0})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        projects = await _db.projects.find(
            {"$or": [{"user_id": uid}, {"client_id": uid}]},
            {"_id": 0},
        ).to_list(500)
        invoices = await _db.invoices.find({"client_id": uid}, {"_id": 0}).to_list(500)
        tickets  = await _db.support_tickets.find({"user_id": uid}, {"_id": 0}).to_list(500)
        notifs   = await _db.notifications.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {
            "exported_at": _now_iso(),
            "account": u,
            "projects": projects,
            "invoices": invoices,
            "support_tickets": tickets,
            "notifications": notifs,
        }

    # ── Avatar ──────────────────────────────────────────────────

    @r.get("/account/me/avatar/signature")
    async def avatar_signature(user=Depends(_get_current_user)):
        """Direct-to-CDN signed upload feature.

        This is a vendor-specific capability (Cloudinary signed uploads).
        We expose it ONLY when storage provider mode is `live` AND the
        underlying live adapter advertises the feature. Otherwise the
        client must POST multipart to /account/me/avatar (unified path).
        """
        s_state = _ipg.storage().health()
        if s_state.mode != AvailabilityMode.LIVE:
            return {
                "mock": True,
                "mode": s_state.mode.value,
                "reason": s_state.reason,
                "folder": f"users/{user.user_id}/avatar",
                "resource_type": "image",
            }
        # Vendor-specific extension delegated to legacy module.
        return cloudinary_service.signature_payload(user.user_id, "image")

    @r.post("/account/me/avatar")
    async def avatar_finalize(
        request: Request,
        user=Depends(_get_current_user),
    ):
        uid = user.user_id
        existing = await _db.users.find_one({"user_id": uid}, {"_id": 0, "avatar_public_id": 1})
        old_public_id = existing.get("avatar_public_id") if existing else None

        # Two transports: real (JSON {public_id, secure_url} from direct-CDN
        # signed upload) or multipart (server-mediated upload via boundary).
        ctype = (request.headers.get("content-type") or "").lower()
        public_id: Optional[str] = None
        secure_url: Optional[str] = None
        version: Optional[int] = None

        storage = _ipg.storage()
        s_state = storage.health()

        if "multipart/form-data" in ctype:
            form = await request.form()
            upload = form.get("file")
            if not upload or not hasattr(upload, "read"):
                raise HTTPException(status_code=400, detail="file field required")
            file_bytes = await upload.read()
            if len(file_bytes) > 5 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="File too large (max 5MB)")
            filename = getattr(upload, "filename", "avatar.jpg") or "avatar.jpg"
            ext = filename.rsplit(".", 1)[-1] if "." in filename else "jpg"
            ext = ext.lower() if ext.lower() in {"jpg", "jpeg", "png", "webp", "gif"} else "jpg"
            content_type = upload.content_type if hasattr(upload, "content_type") else f"image/{ext}"
            key = f"users/{uid}/avatar.{ext}"
            put = await storage.put(data=file_bytes, key=key, content_type=content_type, public=True)
            if not put.success:
                raise HTTPException(status_code=502, detail=f"storage_error: {put.error}")
            public_id = put.key
            secure_url = put.url
        else:
            body = await request.json()
            try:
                payload = AvatarFinalize(**body)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Invalid body: {e}")
            public_id = payload.public_id
            secure_url = payload.secure_url
            version = payload.version
            if s_state.mode != AvailabilityMode.LIVE:
                raise HTTPException(
                    status_code=400,
                    detail=f"Storage not live ({s_state.mode.value}: {s_state.reason}) — upload via multipart instead",
                )

        # Persist + best-effort cleanup of old asset
        await _db.users.update_one(
            {"user_id": uid},
            {"$set": {
                "avatar_public_id": public_id,
                "avatar_url": secure_url,
                "avatar_version": version,
                "updated_at": _now_iso(),
            }},
        )
        if old_public_id and old_public_id != public_id:
            await storage.delete(old_public_id)

        return {"avatar_url": secure_url, "public_id": public_id}

    @r.delete("/account/me/avatar")
    async def avatar_delete(user=Depends(_get_current_user)):
        uid = user.user_id
        existing = await _db.users.find_one({"user_id": uid}, {"_id": 0, "avatar_public_id": 1})
        if existing and existing.get("avatar_public_id"):
            await _ipg.storage().delete(existing["avatar_public_id"])
        await _db.users.update_one(
            {"user_id": uid},
            {"$unset": {"avatar_public_id": "", "avatar_url": "", "avatar_version": ""},
             "$set": {"updated_at": _now_iso()}},
        )
        return {"ok": True}

    # Public endpoint to serve mock avatars (no auth — URLs are unguessable per user_id)
    @r.get("/account/uploads/avatars/{filename}")
    async def serve_mock_avatar(filename: str):
        # Block path traversal
        if "/" in filename or ".." in filename:
            raise HTTPException(status_code=400, detail="Invalid filename")
        path = UPLOADS_DIR / filename
        if not path.exists():
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(path)

    # ── Change email (OTP-protected) ────────────────────────────

    @r.post("/account/me/change-email/request")
    async def change_email_request(body: ChangeEmailRequest, request: Request, user=Depends(_get_current_user)):
        new_email = body.new_email.strip().lower()
        if new_email == (user.email or "").lower():
            raise HTTPException(status_code=400, detail="Same as current email")
        clash = await _db.users.find_one({"email": new_email}, {"_id": 0, "user_id": 1})
        if clash and clash["user_id"] != user.user_id:
            raise HTTPException(status_code=409, detail="Email already in use")
        return await _otp_issue(user.user_id, new_email, "change_email", request)

    @r.post("/account/me/change-email/confirm")
    async def change_email_confirm(body: ChangeEmailConfirm, user=Depends(_get_current_user)):
        new_email = body.new_email.strip().lower()
        await _otp_verify(user.user_id, body.code, "change_email")

        clash = await _db.users.find_one({"email": new_email}, {"_id": 0, "user_id": 1})
        if clash and clash["user_id"] != user.user_id:
            raise HTTPException(status_code=409, detail="Email already in use")

        old_email = (user.email or "").lower()
        await _db.users.update_one(
            {"user_id": user.user_id},
            {"$set": {"email": new_email, "updated_at": _now_iso()}},
        )
        # Audit: self-initiated email change.
        await _db.user_audit_log.insert_one({
            "type": "user_action",
            "action": "email_changed",
            "user_id": user.user_id,
            "payload": {"from": old_email, "to": new_email},
            "timestamp": _now_iso(),
        })
        u = await _db.users.find_one({"user_id": user.user_id}, {"_id": 0, "password_hash": 0})
        return _identity_view(u)

    # ── 2FA toggle ──────────────────────────────────────────────

    @r.post("/account/me/2fa/enable")
    async def two_fa_enable(user=Depends(_get_current_user)):
        # DEPRECATED toy enable. The real flow now lives in two_factor.py:
        #   POST /account/me/2fa/setup           → secret + QR
        #   POST /account/me/2fa/setup/verify    → activate + recovery codes
        # We keep this endpoint for backward compat but it no longer flips
        # the flag — it points the caller at the new flow so a stolen
        # session can never silently enable 2FA without the user actually
        # proving they have the authenticator on the other side.
        raise HTTPException(
            status_code=400,
            detail="Use /account/me/2fa/setup → /account/me/2fa/setup/verify to enable 2FA (TOTP).",
        )

    @r.post("/account/me/2fa/disable/request")
    async def two_fa_disable_request(request: Request, user=Depends(_get_current_user)):
        # DEPRECATED email-OTP disable. New disable lives in two_factor.py
        # and requires a TOTP or recovery code instead. We keep an email-OTP
        # fallback for users who lost the authenticator AND ran out of
        # recovery codes — that path goes through support / password reset.
        raise HTTPException(
            status_code=400,
            detail="Use POST /account/me/2fa/disable with your authenticator code or a recovery code.",
        )

    @r.post("/account/me/2fa/disable/confirm")
    async def two_fa_disable_confirm(body: OtpConfirm, user=Depends(_get_current_user)):
        raise HTTPException(
            status_code=400,
            detail="Use POST /account/me/2fa/disable with your authenticator code or a recovery code.",
        )

    # ── Delete account (soft delete) ────────────────────────────

    @r.delete("/account/me/request")
    async def delete_request(request: Request, user=Depends(_get_current_user)):
        return await _otp_issue(user.user_id, user.email or "", "delete_account", request)

    @r.delete("/account/me/confirm")
    async def delete_confirm(body: OtpConfirm, user=Depends(_get_current_user)):
        await _otp_verify(user.user_id, body.code, "delete_account")
        # Soft delete: mark + scramble email so the address can be reused later.
        deleted_email = f"deleted+{user.user_id}@atlas.dev"
        original_email = (user.email or "").lower()
        await _db.users.update_one(
            {"user_id": user.user_id},
            {"$set": {
                "is_deleted": True,
                "deleted_at": _now_iso(),
                "email": deleted_email,
                "name": "Deleted user",
                "avatar_url": None,
                "avatar_public_id": None,
                "two_factor_enabled": False,
            }},
        )
        # Purge sessions
        await _db.user_sessions.delete_many({"user_id": user.user_id})
        # Audit: self-initiated delete.
        await _db.user_audit_log.insert_one({
            "type": "user_action",
            "action": "account_deleted",
            "user_id": user.user_id,
            "payload": {"original_email": original_email},
            "timestamp": _now_iso(),
        })
        return {"ok": True}

    # ── Sessions ────────────────────────────────────────────────

    @r.get("/account/sessions")
    async def list_sessions(request: Request, user=Depends(_get_current_user)):
        current = request.cookies.get("session_token")
        if not current:
            auth_h = request.headers.get("Authorization", "")
            if auth_h.startswith("Bearer "):
                current = auth_h[7:]

        sessions = await _db.user_sessions.find(
            {"user_id": user.user_id},
            {"_id": 0, "session_id": 1, "session_token": 1, "created_at": 1, "expires_at": 1},
        ).sort("created_at", -1).to_list(50)

        out = []
        for s in sessions:
            tok = s.get("session_token", "")
            out.append({
                "session_id": s.get("session_id"),
                "token_preview": (tok[:8] + "…" + tok[-4:]) if len(tok) > 12 else tok,
                "created_at": s.get("created_at"),
                "expires_at": s.get("expires_at"),
                "is_current": tok == current,
            })
        return {"sessions": out}

    @r.post("/account/sessions/revoke-others")
    async def logout_all(request: Request, user=Depends(_get_current_user)):
        current = request.cookies.get("session_token")
        if not current:
            auth_h = request.headers.get("Authorization", "")
            if auth_h.startswith("Bearer "):
                current = auth_h[7:]

        result = await _db.user_sessions.delete_many({
            "user_id": user.user_id,
            "session_token": {"$ne": current},
        })
        return {"ok": True, "revoked": result.deleted_count}

    return r
