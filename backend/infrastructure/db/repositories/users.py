"""
UsersRepository — single writer for `db.users`.

Today (audit 2026-05-19): db.users written by 11 files. This repository is
the target single owner. Migration is incremental — existing callers can be
ported one at a time; new code uses this class exclusively.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .base import BaseRepository


class UsersRepository(BaseRepository):
    collection_name = "users"
    id_field = "user_id"

    async def ensure_indexes(self) -> None:
        await self._coll.create_index("user_id", unique=True)
        await self._coll.create_index("email", unique=True)
        await self._coll.create_index("active_role")
        await self._coll.create_index("created_at")

    # ── Reads ───────────────────────────────────────────────────────────────
    async def find_by_email(self, email: str) -> dict[str, Any] | None:
        return await self._coll.find_one(
            {"email": email.lower().strip()}, {"_id": 0}
        )

    async def find_by_role(self, role: str, limit: int = 100) -> list[dict[str, Any]]:
        return await self.find_many({"active_role": role}, limit=limit)

    # ── Writes (typed) ──────────────────────────────────────────────────────
    async def set_active_role(self, user_id: str, role: str) -> int:
        """Switch a user's active role (multi-role users only)."""
        return await self._update_one(
            {"user_id": user_id},
            {"$set": {"active_role": role, "updated_at": datetime.now(timezone.utc)}},
        )

    async def increment_strikes(self, user_id: str, by: int = 1) -> int:
        """Adjust user strike counter (QA / dispute outcomes)."""
        return await self._update_one(
            {"user_id": user_id}, {"$inc": {"strikes": by}}
        )

    async def update_tier(self, user_id: str, tier: str) -> int:
        """Adjust user tier (junior/middle/senior/elite). Source of truth for
        pricing multipliers — see shared.constants.TIER_MULTIPLIER_*."""
        return await self._update_one(
            {"user_id": user_id},
            {"$set": {"tier": tier, "tier_updated_at": datetime.now(timezone.utc)}},
        )

    async def mark_logged_in(self, user_id: str) -> int:
        return await self._update_one(
            {"user_id": user_id},
            {"$set": {"last_login_at": datetime.now(timezone.utc)}},
        )
