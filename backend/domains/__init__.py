"""
Bounded contexts — domain logic lives here.

Each subdirectory is ONE bounded context with its own service / models /
events / policies. Cross-context communication ONLY through events
(shared.events.EventBus), never via direct imports.

Architecture tests in `tests/architecture/` enforce these boundaries.
"""
