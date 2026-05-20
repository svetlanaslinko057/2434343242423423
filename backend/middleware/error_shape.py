"""
Canonical error shape (Step 6.2.1).

Every error returned to UI uses this exact shape. Replaces FastAPI's
default {"detail": "..."} with an envelope that carries:
- a stable `code` (machine-readable) — UI dispatches off this, NOT off message
- `retryable` flag — runtime-client retry middleware obeys this
- optional `capability` + `mode` — for capability-aware UI
- `request_id` — tied to RequestIdMiddleware for log correlation
- optional `hint` — human-readable next step

Wired in server.py via:
    fastapi_app.add_exception_handler(HTTPException, http_exception_handler)
    fastapi_app.add_exception_handler(Exception, unhandled_exception_handler)

Endpoints can ALSO raise:
    raise CanonicalHTTPError(code="contract_required", status=409,
                             message="Sign the contract first",
                             capability="payment", mode="live")
"""
from __future__ import annotations
import logging
from typing import Optional, Any
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .request_id import get_request_id

logger = logging.getLogger("error_shape")

# ─── Stable code registry ────────────────────────────────────────────────────
# Add new codes here. UI imports the same constants from runtime-client/errors.
class ErrorCode:
    # Auth
    UNAUTHORIZED = "unauthorized"
    FORBIDDEN = "forbidden"
    SESSION_EXPIRED = "session_expired"
    # Validation
    INVALID_INPUT = "invalid_input"
    NOT_FOUND = "not_found"
    CONFLICT = "conflict"
    # Business
    CONTRACT_REQUIRED = "contract_required"
    PAYMENT_FAILED = "payment_failed"
    INSUFFICIENT_FUNDS = "insufficient_funds"
    ESCROW_LOCKED = "escrow_locked"
    # Runtime
    CAPABILITY_OFFLINE = "capability_offline"
    CAPABILITY_DEGRADED = "capability_degraded"
    RATE_LIMITED = "rate_limited"
    # Internal
    INTERNAL_ERROR = "internal_error"
    UPSTREAM_ERROR = "upstream_error"


_RETRYABLE_CODES = {
    ErrorCode.RATE_LIMITED,
    ErrorCode.UPSTREAM_ERROR,
    ErrorCode.CAPABILITY_DEGRADED,
}

# Map common HTTP status → default code (used when handler raises plain HTTPException).
_STATUS_TO_CODE = {
    400: ErrorCode.INVALID_INPUT,
    401: ErrorCode.UNAUTHORIZED,
    403: ErrorCode.FORBIDDEN,
    404: ErrorCode.NOT_FOUND,
    409: ErrorCode.CONFLICT,
    422: ErrorCode.INVALID_INPUT,
    429: ErrorCode.RATE_LIMITED,
}


class CanonicalHTTPError(HTTPException):
    """Raise this from handlers to attach a stable code + capability metadata."""

    def __init__(
        self,
        *,
        code: str,
        status: int,
        message: str,
        retryable: Optional[bool] = None,
        capability: Optional[str] = None,
        mode: Optional[str] = None,
        hint: Optional[str] = None,
        details: Optional[Any] = None,
    ):
        super().__init__(status_code=status, detail=message)
        self.code = code
        self.message = message
        self.retryable = bool(retryable) if retryable is not None else (code in _RETRYABLE_CODES)
        self.capability = capability
        self.mode = mode
        self.hint = hint
        # `details` is the canonical extension slot — used by validation
        # errors for per-field info, and by business errors (e.g.
        # contract_required) for context like {contract_id, project_id}.
        self.details = details


def _envelope(
    *,
    code: str,
    message: str,
    status: int,
    retryable: bool,
    capability: Optional[str],
    mode: Optional[str],
    hint: Optional[str],
    request_id: str,
) -> dict[str, Any]:
    out = {
        "ok": False,
        "code": code,
        "message": message,
        "status": status,
        "retryable": retryable,
        "request_id": request_id,
    }
    if capability:
        out["capability"] = capability
    if mode:
        out["mode"] = mode
    if hint:
        out["hint"] = hint
    return out


# ─── Handlers ────────────────────────────────────────────────────────────────
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Normalises HTTPException + CanonicalHTTPError + Starlette 404/405."""
    rid = get_request_id()
    if isinstance(exc, CanonicalHTTPError):
        body = _envelope(
            code=exc.code,
            message=exc.message,
            status=exc.status_code,
            retryable=exc.retryable,
            capability=exc.capability,
            mode=exc.mode,
            hint=exc.hint,
            request_id=rid,
        )
        if exc.details is not None:
            body["details"] = exc.details
    else:
        # Plain HTTPException — synthesise code from status.
        code = _STATUS_TO_CODE.get(exc.status_code, ErrorCode.INTERNAL_ERROR)
        # detail can be string OR dict (FastAPI allows both).
        # Structured dict form — `{kind, message, hint, detail}` — is used
        # by handlers that want to surface a human narrative (UI shows
        # `message` + `hint`, ignores raw `detail`). When present, lift its
        # fields into the envelope so the UI doesn't have to parse a stringified
        # repr.
        hint: Optional[str] = None
        details: Optional[Any] = None
        if isinstance(exc.detail, dict):
            d = exc.detail
            msg = str(d.get("message") or d.get("detail") or "Error")
            hint = d.get("hint") if isinstance(d.get("hint"), str) else None
            # Keep the full original dict in `details` for clients that want it
            # (request_id stays the correlation key, kind is the stable bucket).
            details = d
        else:
            msg = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        body = _envelope(
            code=code,
            message=msg,
            status=exc.status_code,
            retryable=code in _RETRYABLE_CODES,
            capability=None,
            mode=None,
            hint=hint,
            request_id=rid,
        )
        if details is not None:
            body["details"] = details
    return JSONResponse(status_code=exc.status_code, content=body)


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Pydantic/422 → invalid_input envelope (preserves field errors in `details`)."""
    rid = get_request_id()
    body = _envelope(
        code=ErrorCode.INVALID_INPUT,
        message="Request validation failed",
        status=422,
        retryable=False,
        capability=None,
        mode=None,
        hint="Check the `details` field for per-field errors",
        request_id=rid,
    )
    body["details"] = exc.errors()
    return JSONResponse(status_code=422, content=body)


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Last-resort 500. Logs full traceback with request_id, never leaks internals."""
    rid = get_request_id()
    logger.exception(
        "UNHANDLED rid=%s path=%s method=%s err=%s",
        rid, request.url.path, request.method, type(exc).__name__,
    )
    body = _envelope(
        code=ErrorCode.INTERNAL_ERROR,
        message="Internal server error",
        status=500,
        retryable=True,  # 500 is generally safe to retry once
        capability=None,
        mode=None,
        hint="If this persists, contact support with the request_id",
        request_id=rid,
    )
    return JSONResponse(status_code=500, content=body)
