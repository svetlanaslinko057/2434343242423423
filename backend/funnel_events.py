"""
Funnel telemetry — minimal, surface-agnostic event recorder.

Wired in server.py via:
    from funnel_events import router as funnel_router
    fastapi_app.include_router(funnel_router)

POST /api/funnel/event
  Body: { event: str, surface?: str, props?: dict }
  Writes one document to `funnel_events`:
    { event, surface, props, occurred_at }

The point of this endpoint is to answer "where do users drop off in the
top-of-funnel describe flow?" without standing up an analytics platform.
Auth-free on purpose — the describe surface is pre-login, and forcing
auth on telemetry would bias the very measurement.

To answer the funnel question, query Mongo directly:

    db.funnel_events.aggregate([
      { $match: { event: { $in: ["describe_opened","describe_completed","estimate_generated"] } } },
      { $group: { _id: "$event", n: { $sum: 1 } } }
    ])

Drop-off rate = 1 - (next_event_count / previous_event_count).

Fire-and-forget on the client side. Backend never throws on bad input —
unknown event names are recorded as-is so we can spot typos without
breaking the request.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("funnel_events")
router = APIRouter(prefix="/api", tags=["funnel"])

# Stable surface buckets — keep small. New surfaces require a deliberate add
# so we don't end up with 20 free-form strings in the data.
VALID_SURFACES = {"visitor", "authed", "admin", "unknown"}

# Recognized events — recorded as-is even if unknown so we don't drop signal,
# but logged at INFO so typos are visible in backend logs.
KNOWN_EVENTS = {
    # /describe funnel
    "describe_opened",
    "describe_completed",
    "estimate_generated",
}

_MAX_PROPS_BYTES = 2_000  # cheap guard against props payload abuse


class FunnelEventIn(BaseModel):
    event: str
    surface: Optional[str] = None
    # Optional device hint ("mobile" | "desktop"). Same shape as the analyze-url
    # telemetry — frontend computes it from viewport width. Free-form up to 16
    # chars; stored only when provided so legacy aggregations stay clean.
    device: Optional[str] = None
    props: Optional[Dict[str, Any]] = None


def _coerce_surface(raw: Optional[str]) -> str:
    s = (raw or "unknown").strip().lower()[:32]
    return s if s in VALID_SURFACES else "unknown"


def _trim_props(p: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(p, dict):
        return {}
    # Best-effort size guard. Truncate keys/values; never reject the call.
    out: Dict[str, Any] = {}
    used = 0
    for k, v in p.items():
        try:
            ks = str(k)[:64]
            if isinstance(v, (int, float, bool)) or v is None:
                vs: Any = v
                added = len(ks) + 16
            else:
                vs = str(v)[:128]
                added = len(ks) + len(vs)
            if used + added > _MAX_PROPS_BYTES:
                break
            out[ks] = vs
            used += added
        except Exception:
            continue
    return out


@router.post("/funnel/event")
async def record_funnel_event(body: FunnelEventIn):
    """Record one funnel event. Auth-free, fire-and-forget contract.

    Returns `{ok: true}` on accepted (even for unknown event names).
    400 only if `event` is missing/empty — that's a client bug, surface it.
    """
    event = (body.event or "").strip()[:64]
    if not event:
        raise HTTPException(
            status_code=400,
            detail={
                "kind": "INVALID_EVENT",
                "message": "Event name is required.",
                "hint": "Pass `event` like 'describe_opened'.",
                "detail": "empty event",
            },
        )

    surface = _coerce_surface(body.surface)
    props = _trim_props(body.props)
    device = (body.device or "").strip().lower()[:16] or None

    from server import db as _db
    try:
        doc = {
            "event": event,
            "surface": surface,
            "props": props,
            "occurred_at": datetime.now(timezone.utc),
        }
        if device:
            doc["device"] = device
        await _db.funnel_events.insert_one(doc)
    except Exception as e:  # pragma: no cover — never block the request
        logger.warning(f"FUNNEL: insert failed event={event} err={e}")

    if event not in KNOWN_EVENTS:
        logger.info(f"FUNNEL: unknown event recorded as-is event={event} surface={surface}")

    return {"ok": True}
