"""
ProjectsRepository — single writer for `db.projects`.

Today (audit 2026-05-19): db.projects written by 5 files (mock_seed,
module_motion, overdue_engine, seed_money_demo, server). Target single owner.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .base import BaseRepository


class ProjectsRepository(BaseRepository):
    collection_name = "projects"
    id_field = "project_id"

    async def ensure_indexes(self) -> None:
        await self._coll.create_index("project_id", unique=True)
        await self._coll.create_index("client_id")
        await self._coll.create_index("status")
        await self._coll.create_index([("created_at", -1)])

    # ── Reads ───────────────────────────────────────────────────────────────
    async def find_by_client(self, client_id: str) -> list[dict[str, Any]]:
        return await self.find_many(
            {"client_id": client_id}, sort=[("created_at", -1)]
        )

    async def find_active(self) -> list[dict[str, Any]]:
        return await self.find_many({"status": {"$in": ["active", "in_progress"]}})

    # ── Writes (typed) ──────────────────────────────────────────────────────
    async def update_status(self, project_id: str, status: str) -> int:
        return await self._update_one(
            {"project_id": project_id},
            {"$set": {"status": status, "updated_at": datetime.now(timezone.utc)}},
        )

    async def update_progress(self, project_id: str, progress: float) -> int:
        """Set project completion percentage (0.0 - 100.0)."""
        return await self._update_one(
            {"project_id": project_id},
            {"$set": {"progress": progress, "updated_at": datetime.now(timezone.utc)}},
        )

    async def increment_progress(self, project_id: str, delta: float) -> int:
        return await self._update_one(
            {"project_id": project_id},
            {
                "$inc": {"progress": delta},
                "$set": {"updated_at": datetime.now(timezone.utc)},
            },
        )

    async def mark_idle(self, project_id: str) -> int:
        """Event-engine flags project as idle (no module motion for N days)."""
        return await self._update_one(
            {"project_id": project_id},
            {"$set": {"idle_flagged_at": datetime.now(timezone.utc)}},
        )
