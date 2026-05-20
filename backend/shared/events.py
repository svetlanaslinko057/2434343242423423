"""
In-memory domain event bus.

Cross-domain communication primitive. Domains publish events; subscribers
listen. This is the ONLY allowed way for domain X to react to changes in
domain Y — direct imports across domains are forbidden by architecture tests.

Design intent:
  • In-memory + async (no redis yet — keep latency low, complexity zero)
  • Subscribers run inside the same asyncio loop as publishers
  • Exceptions in subscribers MUST NOT block other subscribers or the publisher
  • Replaceable: when traffic justifies, swap impl for redis/kafka without
    changing call-sites.

Usage:
    from shared.events import get_event_bus, DomainEvent

    @dataclass
    class InvoicePaid(DomainEvent):
        invoice_id: str
        amount: float
        client_id: str

    # publisher side
    await get_event_bus().publish(InvoicePaid(invoice_id="inv_1", amount=100.0, client_id="u_1"))

    # subscriber side (registered at app startup)
    async def on_invoice_paid(ev: InvoicePaid) -> None:
        await deliver_receipt(ev.client_id)

    get_event_bus().subscribe(InvoicePaid, on_invoice_paid)
"""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, TypeVar
from uuid import uuid4

log = logging.getLogger(__name__)

T = TypeVar("T", bound="DomainEvent")


@dataclass(kw_only=True)
class DomainEvent:
    """Base class for all domain events.

    Subclasses should declare additional fields as dataclass attributes.
    Common metadata (event_id, occurred_at) is auto-populated.
    """

    event_id: str = field(default_factory=lambda: f"evt_{uuid4().hex[:12]}")
    occurred_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


Handler = Callable[[T], Awaitable[None]]


class EventBus:
    """Simple async in-memory pub-sub.

    Thread-unsafe by design — assumes single asyncio loop (matches FastAPI).
    """

    def __init__(self) -> None:
        self._handlers: dict[type, list[Handler]] = defaultdict(list)

    def subscribe(self, event_type: type[T], handler: Handler) -> None:
        """Register a handler for an event type. Handlers run in registration order."""
        if not asyncio.iscoroutinefunction(handler):
            raise TypeError(
                f"Handler {handler.__qualname__} for {event_type.__name__} must be async"
            )
        self._handlers[event_type].append(handler)
        log.info(
            "event_bus.subscribed",
            extra={"event_type": event_type.__name__, "handler": handler.__qualname__},
        )

    async def publish(self, event: DomainEvent) -> None:
        """Fan out the event to every registered handler.

        Handler exceptions are logged but never re-raised — one broken
        subscriber must not block others or the publisher.
        """
        event_type = type(event)
        handlers = list(self._handlers.get(event_type, []))
        if not handlers:
            log.debug(
                "event_bus.no_subscribers",
                extra={"event_type": event_type.__name__, "event_id": event.event_id},
            )
            return

        for h in handlers:
            try:
                await h(event)
            except Exception as exc:  # noqa: BLE001 — isolation is the design
                log.exception(
                    "event_bus.handler_failed",
                    extra={
                        "event_type": event_type.__name__,
                        "handler": h.__qualname__,
                        "event_id": event.event_id,
                        "error": str(exc),
                    },
                )

    def reset(self) -> None:
        """Clear all subscribers. Used by tests."""
        self._handlers.clear()


# Module-level singleton, lazily initialised. Apps call get_event_bus() to
# subscribe at startup and publish at runtime.
_bus: EventBus | None = None


def get_event_bus() -> EventBus:
    """Return the shared application event bus, creating it on first call."""
    global _bus
    if _bus is None:
        _bus = EventBus()
    return _bus
