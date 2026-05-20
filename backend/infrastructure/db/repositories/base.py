"""
BaseRepository — shared mechanics for all collection wrappers.

Responsibilities:
  • Hold the Motor collection handle
  • Project out `_id` from every read (Mongo ObjectId is not JSON-serializable)
  • Provide indexes registration hook
  • Provide typed not-found behaviour

NOT responsible for: business logic, cross-collection joins, caching.
Those belong in domain services that COMPOSE repositories.
"""
from __future__ import annotations

import logging
from typing import Any, Iterable

from motor.motor_asyncio import AsyncIOMotorCollection, AsyncIOMotorDatabase

from shared.errors import NotFoundError

log = logging.getLogger(__name__)


class BaseRepository:
    """Abstract base — subclass per collection.

    Subclasses must define:
      • `collection_name` — class attribute, the MongoDB collection name
      • `id_field` — the natural key for `find_one_by_id` (e.g. "user_id")

    Subclasses MAY override:
      • `async def ensure_indexes(self) -> None` — called at startup
    """

    collection_name: str = ""
    id_field: str = ""

    # Fields excluded from every read response (Mongo internals).
    _BASE_EXCLUDE = {"_id": 0}

    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        if not self.collection_name:
            raise RuntimeError(
                f"{type(self).__name__} must declare `collection_name`"
            )
        if not self.id_field:
            raise RuntimeError(
                f"{type(self).__name__} must declare `id_field`"
            )
        self._db = db
        self._coll: AsyncIOMotorCollection = db[self.collection_name]

    @property
    def collection(self) -> AsyncIOMotorCollection:
        """Escape hatch for queries not yet wrapped. Use sparingly during migration."""
        return self._coll

    async def ensure_indexes(self) -> None:
        """Override to register indexes at startup. Idempotent (Mongo dedup-es)."""
        return None

    # ── Reads ───────────────────────────────────────────────────────────────
    async def find_one_by_id(self, entity_id: str) -> dict[str, Any] | None:
        return await self._coll.find_one({self.id_field: entity_id}, self._BASE_EXCLUDE)

    async def get_by_id(self, entity_id: str) -> dict[str, Any]:
        """Like `find_one_by_id` but raises `NotFoundError` if absent."""
        doc = await self.find_one_by_id(entity_id)
        if doc is None:
            raise NotFoundError(
                f"{self.collection_name} not found",
                code=f"{self.collection_name}_not_found",
                context={self.id_field: entity_id},
            )
        return doc

    async def find_many(
        self,
        filter_q: dict[str, Any] | None = None,
        *,
        sort: list[tuple[str, int]] | None = None,
        limit: int = 0,
    ) -> list[dict[str, Any]]:
        cursor = self._coll.find(filter_q or {}, self._BASE_EXCLUDE)
        if sort:
            cursor = cursor.sort(sort)
        if limit:
            cursor = cursor.limit(limit)
        return await cursor.to_list(length=None)

    async def count(self, filter_q: dict[str, Any] | None = None) -> int:
        return await self._coll.count_documents(filter_q or {})

    async def exists(self, entity_id: str) -> bool:
        return (
            await self._coll.count_documents(
                {self.id_field: entity_id}, limit=1
            )
            > 0
        )

    # ── Writes (subclasses add typed methods; these are escape hatches) ─────
    async def _insert_one(self, doc: dict[str, Any]) -> str:
        """Internal — subclass calls this from typed methods like `create_user`."""
        result = await self._coll.insert_one(doc)
        return str(result.inserted_id)

    async def _update_one(
        self, filter_q: dict[str, Any], update: dict[str, Any]
    ) -> int:
        result = await self._coll.update_one(filter_q, update)
        return result.modified_count

    async def _delete_one(self, filter_q: dict[str, Any]) -> int:
        result = await self._coll.delete_one(filter_q)
        return result.deleted_count

    # ── Diagnostics ─────────────────────────────────────────────────────────
    def __repr__(self) -> str:
        return f"<{type(self).__name__} coll={self.collection_name}>"
