"""
Cloudinary service — mock-aware.

When CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET are configured, generates
real signed-upload params and performs server-side deletion via SDK.

When NOT configured, runs in MOCK mode:
  - signature endpoint returns {"mock": True, ...}
  - the avatar endpoint accepts a multipart upload and stores the file under
    /app/backend/uploads/avatars/{user_id}.{ext}, served via /api/uploads/...

Switching from mock to real is zero-code: drop the three env vars in
backend/.env and restart. The frontend already calls the same endpoints; only
the upload destination changes (Cloudinary CDN vs local proxy).
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger("cloudinary_service")

CLOUD_NAME = os.environ.get("CLOUDINARY_CLOUD_NAME")
API_KEY = os.environ.get("CLOUDINARY_API_KEY")
API_SECRET = os.environ.get("CLOUDINARY_API_SECRET")

UPLOADS_DIR = Path("/app/backend/uploads/avatars")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

MOCK_MODE = not (CLOUD_NAME and API_KEY and API_SECRET)

if not MOCK_MODE:
    import cloudinary  # type: ignore
    import cloudinary.utils  # type: ignore
    import cloudinary.uploader  # type: ignore

    cloudinary.config(
        cloud_name=CLOUD_NAME,
        api_key=API_KEY,
        api_secret=API_SECRET,
        secure=True,
    )
    logger.info(f"CLOUDINARY: real mode (cloud={CLOUD_NAME})")
else:
    logger.info("CLOUDINARY: MOCK mode (no API keys yet — files saved locally)")


def is_mock() -> bool:
    return MOCK_MODE


def signature_payload(user_id: str, resource_type: str = "image") -> dict:
    """
    Generate signed upload params for direct-from-client uploads.
    Folder is locked server-side to users/{user_id}/avatar so a client cannot
    write into someone else's namespace even with a valid signature.
    """
    folder = f"users/{user_id}/avatar"
    if MOCK_MODE:
        return {
            "mock": True,
            "folder": folder,
            "resource_type": resource_type,
        }

    timestamp = int(time.time())
    params = {
        "timestamp": timestamp,
        "folder": folder,
        "resource_type": resource_type,
    }
    signature = cloudinary.utils.api_sign_request(params, API_SECRET)
    return {
        "mock": False,
        "signature": signature,
        "timestamp": timestamp,
        "cloud_name": CLOUD_NAME,
        "api_key": API_KEY,
        "folder": folder,
        "resource_type": resource_type,
    }


async def save_mock_avatar(user_id: str, file_bytes: bytes, ext: str) -> tuple[str, str]:
    """
    MOCK upload: write file to disk, return (public_id, secure_url).
    secure_url is relative to backend root and served by /api/uploads/avatars/.
    """
    safe_ext = (ext or "jpg").lstrip(".").lower()
    if safe_ext not in {"jpg", "jpeg", "png", "webp", "gif"}:
        safe_ext = "jpg"
    public_id = f"users/{user_id}/avatar"
    filename = f"{user_id}.{safe_ext}"
    path = UPLOADS_DIR / filename
    path.write_bytes(file_bytes)
    # cache-bust on each upload by appending mtime
    secure_url = f"/api/account/uploads/avatars/{filename}?v={int(path.stat().st_mtime)}"
    return public_id, secure_url


def delete_asset(public_id: str) -> bool:
    """
    Delete an existing avatar.
    Real mode: cloudinary.uploader.destroy.
    Mock mode: unlink the local file.
    Best-effort — never raises.
    """
    if not public_id:
        return False
    try:
        if MOCK_MODE:
            # public_id is "users/{user_id}/avatar" — pop the local file by user_id
            parts = public_id.split("/")
            if len(parts) < 2:
                return False
            user_id = parts[1]
            for ext in ("jpg", "jpeg", "png", "webp", "gif"):
                candidate = UPLOADS_DIR / f"{user_id}.{ext}"
                if candidate.exists():
                    candidate.unlink()
            return True
        else:
            cloudinary.uploader.destroy(public_id, invalidate=True)
            return True
    except Exception as e:
        logger.warning(f"CLOUDINARY destroy failed ({public_id}): {e}")
        return False


def avatar_cdn_url(public_id: str, version: Optional[int] = None) -> Optional[str]:
    """
    Build a transformed CDN URL for an avatar (400x400, face crop, auto q/f).
    Returns None if no public_id.
    """
    if not public_id or MOCK_MODE:
        return None
    transforms = "c_fill,w_400,h_400,g_face,q_auto,f_auto"
    base = f"https://res.cloudinary.com/{CLOUD_NAME}/image/upload/{transforms}"
    if version:
        return f"{base}/v{version}/{public_id}"
    return f"{base}/{public_id}"
