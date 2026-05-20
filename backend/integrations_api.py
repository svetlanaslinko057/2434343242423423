"""
Этап 5.0 — Capability Matrix API.

Single read-only endpoint that publishes the honest state of every
integration capability. This is the system's epistemic primitive for
"what can I rely on right now?".

UI/admin/CI all consume the same shape. No vendor names leak — every
field is capability-level (`payment.mode`, never `stripe.connected`).

Wired into the main api_router from server.py:

    from integrations_api import router as integrations_router
    api_router.include_router(integrations_router)
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from integrations import registry

router = APIRouter(prefix="/integrations", tags=["integrations"])


@router.get("/capabilities")
async def get_capability_matrix() -> dict:
    """Honest capability matrix.

    Response shape (stable contract — UI depends on it):

        {
          "capabilities": {
            "payment":  {capability, provider, mode, available, reason, details},
            "mail":     {...},
            "storage":  {...},
            "oauth":    {...},
            "ai":       {...}
          },
          "summary": {
            "total":         5,
            "live":          0,
            "mock":          4,
            "degraded":      0,
            "unavailable":   1,
            "all_live":      false,
            "any_unavailable": true
          }
        }

    `mode` is one of: `live | mock | degraded | unavailable`.
    No vendor-specific fields. No silent fallbacks.

    Public endpoint (no auth) — exposes only capability/mode/provider names,
    no secrets. Mirrors the philosophy of `/api/healthz`.
    """
    matrix = registry.capabilities()
    summary = {
        "total": len(matrix),
        "live": sum(1 for c in matrix.values() if c["mode"] == "live"),
        "mock": sum(1 for c in matrix.values() if c["mode"] == "mock"),
        "degraded": sum(1 for c in matrix.values() if c["mode"] == "degraded"),
        "unavailable": sum(1 for c in matrix.values() if c["mode"] == "unavailable"),
    }
    summary["all_live"] = summary["live"] == summary["total"]
    summary["any_unavailable"] = summary["unavailable"] > 0
    return {
        "capabilities": matrix,
        "summary": summary,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Step 6.2.1 — Capability manifest (runtime-client gate policy).
# UI runtime-client consumes this on boot to decide: hard-block vs soft-warn
# per capability when calls would hit a non-live mode.
#
# Policy (hard = block request entirely; soft = let request pass + show badge):
#   payment, oauth → hard (cannot fake identity / money)
#   ai, storage, mail → soft (graceful degradation OK)
#
# This is the SOURCE OF TRUTH for capability gating across web + expo.
# Layered cache lives in runtime-client (memory → persisted → network);
# server only serves the canonical state with a timestamp.
import time as _time

_CAPABILITY_POLICY = {
    "payment": "hard",
    "oauth": "hard",
    "ai": "soft",
    "storage": "soft",
    "mail": "soft",
}


@router.get("/manifest")
async def get_capability_manifest() -> dict:
    """Runtime-client capability manifest.

    Wraps `/capabilities` with per-capability gate policy and a server
    timestamp for the runtime-client's freshness check (TTL 5 min).
    """
    matrix = registry.capabilities()
    out: dict[str, dict] = {}
    for name, cap in matrix.items():
        out[name] = {
            "mode": cap["mode"],          # live | mock | degraded | unavailable
            "available": cap["available"],
            "policy": _CAPABILITY_POLICY.get(name, "soft"),
            "provider": cap.get("provider"),
            "reason": cap.get("reason"),
        }
    return {
        "capabilities": out,
        "server_time": int(_time.time() * 1000),
        "ttl_ms": 5 * 60 * 1000,  # runtime-client refreshes every 5 min max
        "version": "1",            # bump when the contract changes
    }


@router.post("/payments/webhook")
async def payment_webhook(request: Request) -> dict:
    """Vendor-neutral payment webhook entrypoint (Этап 5.1).

    The request body is forwarded to `registry.payment().verify_webhook()`,
    which returns a normalized `PaymentEvent`:

        {
          valid: bool,
          event_type: str | null,    # 'payment_succeeded' | 'payment_failed' | ...
          invoice_id: str | null,
          provider_ref: str | null,  # opaque — never the raw vendor id name
          status: str | null,
          amount: float | null,
          currency: str | null,
          error: str | null
        }

    Business logic only consumes those normalized fields. Vendor-specific
    payload lives in `event.raw` and is logged for debugging only.

    Signature verification is the live adapter's responsibility — the mock
    accepts everything; Stripe/WayForPay live adapters MUST implement HMAC
    check before flipping LIVE in Этап 5.2.
    """
    body = await request.body()
    headers = dict(request.headers)
    provider = registry.payment()
    state = provider.health()
    event = await provider.verify_webhook(body, headers)
    return {
        "valid": event.valid,
        "event_type": event.event_type,
        "invoice_id": event.invoice_id,
        "provider_ref": event.provider_ref,
        "status": event.status,
        "amount": event.amount,
        "currency": event.currency,
        "error": event.error,
        "mode": state.mode.value,
    }
