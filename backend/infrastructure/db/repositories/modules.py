"""
ModulesRepository — single writer for `db.modules`.

Today (audit 2026-05-19): db.modules written by **14 files** — the
single worst case of shared mutable state in the system. Target single owner.

Lifecycle (canonical enum, source-of-truth):
    pending → in_progress → review → revision_requested → done
                                  └→ rejected
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .base import BaseRepository

# Canonical lifecycle states.
MODULE_STATES: tuple[str, ...] = (
    "pending",
    "in_progress",
    "review",
    "revision_requested",
    "done",
    "rejected",
)


class ModulesRepository(BaseRepository):
    collection_name = "modules"
    id_field = "module_id"

    async def ensure_indexes(self) -> None:
        await self._coll.create_index("module_id", unique=True)
        await self._coll.create_index("project_id")
        await self._coll.create_index("assigned_to")
        await self._coll.create_index("status")
        await self._coll.create_index([("project_id", 1), ("status", 1)])
        await self._coll.create_index([("created_at", -1)])

    # ── Reads ───────────────────────────────────────────────────────────────
    async def find_by_project(self, project_id: str) -> list[dict[str, Any]]:
        return await self.find_many({"project_id": project_id})

    async def find_by_assignee(self, user_id: str) -> list[dict[str, Any]]:
        return await self.find_many(
            {"assigned_to": user_id, "status": {"$in": ["in_progress", "review"]}}
        )

    async def find_by_status(self, status: str) -> list[dict[str, Any]]:
        return await self.find_many({"status": status})

    async def status_counts(self, project_id: str) -> dict[str, int]:
        """Aggregation served from the repo so callers don't grow .filter chains.
        Mirrors the `status_counts` additive shape adopted in Phase 1 substrate
        slice #3 (BD-15)."""
        pipeline = [
            {"$match": {"project_id": project_id}},
            {"$group": {"_id": "$status", "n": {"$sum": 1}}},
        ]
        counts = {s: 0 for s in MODULE_STATES}
        async for row in self._coll.aggregate(pipeline):
            counts[row["_id"]] = row["n"]
        return counts

    # ── Writes (typed) ──────────────────────────────────────────────────────
    async def update_status(self, module_id: str, status: str) -> int:
        if status not in MODULE_STATES:
            from shared.errors import InvariantViolated

            raise InvariantViolated(
                f"unknown module status '{status}'",
                code="module_status_invalid",
                context={"module_id": module_id, "status": status, "allowed": list(MODULE_STATES)},
            )
        return await self._update_one(
            {"module_id": module_id},
            {"$set": {"status": status, "updated_at": datetime.now(timezone.utc)}},
        )

    async def assign_to(self, module_id: str, user_id: str) -> int:
        return await self._update_one(
            {"module_id": module_id},
            {
                "$set": {
                    "assigned_to": user_id,
                    "assigned_at": datetime.now(timezone.utc),
                    "status": "in_progress",
                }
            },
        )

    async def unassign(self, module_id: str) -> int:
        return await self._update_one(
            {"module_id": module_id},
            {
                "$set": {
                    "assigned_to": None,
                    "status": "pending",
                    "unassigned_at": datetime.now(timezone.utc),
                }
            },
        )
