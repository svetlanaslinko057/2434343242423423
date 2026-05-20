"""StorageProvider — vendor-neutral object storage contract."""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Optional

from .base import Capability, Provider


@dataclass
class StoragePutResult:
    """Identical shape across all StorageProvider implementations."""

    success: bool
    url: Optional[str]
    """Public URL (or signed URL) where the object can be fetched.
    Mock provider returns a /api/uploads/... URL served by the same backend."""
    key: Optional[str]
    """Vendor-neutral object key. UI uses this for delete/replace ops."""
    size: int = 0
    content_type: Optional[str] = None
    error: Optional[str] = None
    raw: dict = field(default_factory=dict)


@dataclass
class StorageObject:
    """Returned by `get` and `head`."""

    key: str
    url: str
    size: int
    content_type: Optional[str] = None
    metadata: dict = field(default_factory=dict)


class StorageProvider(Provider, abc.ABC):
    capability = Capability.STORAGE

    @abc.abstractmethod
    async def put(
        self,
        *,
        data: bytes,
        key: str,
        content_type: Optional[str] = None,
        public: bool = True,
    ) -> StoragePutResult:
        """Upload `data` under `key`. Returns canonical URL."""
        ...

    @abc.abstractmethod
    async def delete(self, key: str) -> bool:
        """Best-effort delete. Returns True on success or if object didn't exist."""
        ...

    @abc.abstractmethod
    async def head(self, key: str) -> Optional[StorageObject]:
        """Return object metadata or None if not found."""
        ...
