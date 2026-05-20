"""
Request-ID middleware (Step 6.2.1).

Generates / propagates `x-request-id` for every HTTP request:
- If client sent one → use it (allows distributed tracing).
- Otherwise generate a fresh UUID4 (short form).
- Attaches to `request.state.request_id` so handlers can read it.
- Echoes back in `x-request-id` response header.
- Adds to ContextVar so any logger.info() inside the request scope
  carries the id automatically (via filter `RequestIdFilter`).

This is the foundation: every error, every compat-route log, every
money-runtime event will carry the same request_id from this point on.
"""
from __future__ import annotations
import uuid
import contextvars
import logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

REQUEST_ID_HEADER = "x-request-id"
_request_id_ctx: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default="-"
)


def get_request_id() -> str:
    """Read current request_id from contextvars. Returns '-' outside a request."""
    return _request_id_ctx.get()


class RequestIdFilter(logging.Filter):
    """Logging filter — injects request_id into every LogRecord."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _request_id_ctx.get()
        return True


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Starlette middleware. Mount BEFORE CORS so id covers full pipeline."""

    async def dispatch(self, request: Request, call_next) -> Response:
        rid = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex[:16]
        request.state.request_id = rid
        token = _request_id_ctx.set(rid)
        try:
            response = await call_next(request)
        finally:
            _request_id_ctx.reset(token)
        response.headers[REQUEST_ID_HEADER] = rid
        return response


def install_request_id_logging() -> None:
    """Attach RequestIdFilter to root logger so all logs carry rid."""
    root = logging.getLogger()
    # Avoid duplicate filters on hot-reload.
    for f in root.filters:
        if isinstance(f, RequestIdFilter):
            return
    root.addFilter(RequestIdFilter())
