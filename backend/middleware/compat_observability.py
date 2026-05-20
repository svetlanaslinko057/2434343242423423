"""
Compat layer observability (Step 6.2.1).

Two responsibilities:

1. **Header tagging** — every response from the compat router is decorated with:
       x-compat-route: true
       x-canonical-path: /admin/mobile/finance
   so admins/CI can grep network logs to find legacy URLs in active use.

2. **Structured logging** — emits one JSON line per compat hit:
       {"type":"compat_route_used","legacy":"/admin/finance",
        "canonical":"/admin/mobile/finance","request_id":"...",
        "user_id":"...","status":200}

This makes it possible to:
- Build heatmaps of legacy URL usage,
- Decide which compat aliases are safe to remove,
- Track migration progress page-by-page.

Usage from server.py / compat_routes.py:
    from middleware.compat_observability import compat_decorator
    # decorator factory for an alias handler
    @compat_decorator(canonical="/api/admin/mobile/finance")
    @r.get("/admin/finance")
    async def alias_admin_finance(req): ...
"""
from __future__ import annotations
import inspect
import json
import logging
import functools
from typing import Callable, Awaitable
from starlette.responses import Response
from starlette.requests import Request

from .request_id import get_request_id

logger = logging.getLogger("compat")

COMPAT_ROUTE_HEADER = "x-compat-route"
CANONICAL_PATH_HEADER = "x-canonical-path"


def compat_decorator(*, canonical: str) -> Callable:
    """
    Wraps a compat alias handler. After the inner handler runs:
      - tags response with x-compat-route + x-canonical-path
      - emits a structured log line tied to current request_id

    Works with handlers that return either a Response object OR a dict
    (FastAPI auto-converts dicts to JSONResponse, so we re-wrap to inject
    headers reliably).

    The wrapper preserves the original handler's signature via
    `__signature__` assignment so FastAPI's parameter introspection
    works for handlers with Pydantic body models (POST / PUT / PATCH).
    """
    def wrap(handler: Callable[..., Awaitable]) -> Callable[..., Awaitable]:
        @functools.wraps(handler)
        async def wrapper(*args, **kwargs):
            # Find the Request object in args/kwargs (FastAPI injects it).
            req: Request | None = None
            for a in args:
                if isinstance(a, Request):
                    req = a
                    break
            if req is None:
                req = kwargs.get("req") or kwargs.get("request")

            result = await handler(*args, **kwargs)

            # Normalise to Response so we can attach headers.
            if not isinstance(result, Response):
                from fastapi.responses import JSONResponse
                result = JSONResponse(content=result)

            result.headers[COMPAT_ROUTE_HEADER] = "true"
            result.headers[CANONICAL_PATH_HEADER] = canonical

            # Emit structured log — single JSON line, easy to grep/aggregate.
            payload = {
                "type": "compat_route_used",
                "legacy": str(req.url.path) if req else "unknown",
                "canonical": canonical,
                "request_id": get_request_id(),
                "status": result.status_code,
            }
            # user_id is best-effort — optional dependency.
            try:
                user = getattr(req.state, "current_user", None) if req else None
                if user and isinstance(user, dict):
                    payload["user_id"] = user.get("user_id")
            except Exception:
                pass
            logger.info(json.dumps(payload, ensure_ascii=False))
            return result

        # Preserve original signature explicitly so FastAPI can introspect
        # Pydantic body params (POST/PUT/PATCH). functools.wraps sets
        # __wrapped__ but does NOT copy __signature__, and FastAPI's
        # `get_typed_signature` only follows `__wrapped__` reliably for
        # certain handler shapes — explicit __signature__ is the
        # contract-safe fix that works for all FastAPI versions.
        # `eval_str=True` resolves PEP 563 string annotations
        # (`from __future__ import annotations`) into real types so
        # FastAPI doesn't see them as unresolved ForwardRefs.
        try:
            wrapper.__signature__ = inspect.signature(handler, eval_str=True)
        except (ValueError, TypeError, NameError):
            # Handler has no introspectable signature OR string annotations
            # reference unresolvable names — skip; GET aliases without body
            # models work fine without this.
            pass
        return wrapper
    return wrap
