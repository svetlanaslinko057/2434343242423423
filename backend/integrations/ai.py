"""AIProvider — vendor-neutral LLM completion contract.

Models the smallest useful subset: a list of role-tagged messages in,
single completion out. Streaming, tools, vision can be added later as
optional capability-feature flags via `health().details["features"]`.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import List, Optional

from .base import Capability, Provider


@dataclass
class AIMessage:
    role: str  # "system" | "user" | "assistant"
    content: str


@dataclass
class AICompletion:
    """Identical shape across all AIProvider implementations."""

    success: bool
    text: str
    """The model's reply. Empty string on failure (NOT None — keeps callers
    that do `.strip()` from blowing up)."""
    model: Optional[str] = None
    """Vendor-side model identifier actually used (might differ from request
    if router fell back). UI may display this for transparency."""
    finish_reason: Optional[str] = None
    """`stop` | `length` | `content_filter` | `error` — vendor-neutral."""
    tokens_in: int = 0
    tokens_out: int = 0
    error: Optional[str] = None
    raw: dict = field(default_factory=dict)


class AIProvider(Provider, abc.ABC):
    capability = Capability.AI

    @abc.abstractmethod
    async def complete(
        self,
        messages: List[AIMessage],
        *,
        model: Optional[str] = None,
        max_tokens: int = 1024,
        temperature: float = 0.7,
    ) -> AICompletion:
        """Run a single-shot completion. No streaming in v1."""
        ...
