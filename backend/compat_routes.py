"""
COMPAT ROUTES — UI ↔ API alias layer.

Web/Expo UI calls legacy paths (e.g. `/admin/finance`) that don't exist
on the backend — canonical equivalents are at richer paths
(e.g. `/admin/mobile/finance`). This module is the single, isolated
shim that forwards legacy → canonical so the audit's "404 wall" closes
without polluting `server.py` with duplicate business logic.

Rules of this layer:
- One file. No business logic.
- Each alias points to a canonical handler or aggregator.
- Each route is documented with a `# COMPAT:` header explaining
  legacy_path → canonical_path.
- Every alias is wrapped with `@compat_decorator(canonical=...)` which:
    - tags response with `x-compat-route: true` + `x-canonical-path`
    - emits a structured JSON log line for migration tracking
- Forwarding strategy: internal HTTP via httpx (auth cookie/header
  passed through). Aggregators read MongoDB directly.

Wired in server.py after all canonical routers are mounted.
"""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
import httpx
import logging

from middleware.compat_observability import compat_decorator

logger = logging.getLogger(__name__)


def build_router(*, db, get_current_user, require_role) -> APIRouter:
    """Build compat router. All deps injected from server.py."""
    r = APIRouter(prefix="/api", tags=["compat-aliases"])

    # ─────────────────────────────────────────────────────────────────────
    # Internal forwarder — issues a localhost call to the canonical path
    # and propagates auth (cookie OR Authorization header) and query.
    # Small overhead (one extra hop), but zero logic duplication.
    # ─────────────────────────────────────────────────────────────────────
    async def _forward(req: Request, canonical_path: str, method: str = "GET", **extra_query):
        url = f"http://localhost:8001{canonical_path}"
        params = dict(req.query_params)
        params.update({k: v for k, v in extra_query.items() if v is not None})
        # Propagate auth — cookie OR bearer — and request_id for tracing.
        headers = {}
        cookie = req.headers.get("cookie")
        if cookie:
            headers["cookie"] = cookie
        auth = req.headers.get("authorization")
        if auth:
            headers["authorization"] = auth
        # Forward x-request-id so canonical handler logs match.
        rid = getattr(req.state, "request_id", None)
        if rid:
            headers["x-request-id"] = rid
        body = None
        if method.upper() not in ("GET", "HEAD", "DELETE"):
            try:
                body = await req.body()
            except Exception:
                body = None
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.request(
                method, url, params=params, headers=headers, content=body,
            )
        try:
            return JSONResponse(status_code=resp.status_code, content=resp.json())
        except Exception:
            return JSONResponse(
                status_code=resp.status_code,
                content={"detail": resp.text[:500]},
            )

    # ═════════════════════════════════════════════════════════════════════
    # ADMIN
    # ═════════════════════════════════════════════════════════════════════

    # COMPAT: web UI still calls /admin/finance, canonical is /admin/mobile/finance
    @r.get("/admin/finance")
    @compat_decorator(canonical="/api/admin/mobile/finance")
    async def alias_admin_finance(req: Request):
        return await _forward(req, "/api/admin/mobile/finance")

    # COMPAT: web UI calls /admin/integrations, canonical is /admin/settings/integrations
    @r.get("/admin/integrations")
    @compat_decorator(canonical="/api/admin/settings/integrations")
    async def alias_admin_integrations(req: Request):
        return await _forward(req, "/api/admin/settings/integrations")

    # COMPAT: web UI calls /admin/integrations/capabilities, canonical is /integrations/capabilities
    @r.get("/admin/integrations/capabilities")
    @compat_decorator(canonical="/api/integrations/capabilities")
    async def alias_admin_capabilities(req: Request):
        return await _forward(req, "/api/integrations/capabilities")

    # COMPAT: web UI calls /admin/billing/overview, canonical is /admin/money/overview
    @r.get("/admin/billing/overview")
    @compat_decorator(canonical="/api/admin/money/overview")
    async def alias_admin_billing_overview(req: Request):
        return await _forward(req, "/api/admin/money/overview")

    # COMPAT: web UI calls /admin/payments (list), canonical is /admin/payments/transactions
    @r.get("/admin/payments")
    @compat_decorator(canonical="/api/admin/payments/transactions")
    async def alias_admin_payments(req: Request):
        return await _forward(req, "/api/admin/payments/transactions")

    # COMPAT: web UI calls /admin/control (operator hub), canonical is /admin/control-center/overview
    @r.get("/admin/control")
    @compat_decorator(canonical="/api/admin/control-center/overview")
    async def alias_admin_control(req: Request):
        return await _forward(req, "/api/admin/control-center/overview")

    # COMPAT: web UI calls /admin/llm, canonical is /admin/settings/llm
    @r.get("/admin/llm")
    @compat_decorator(canonical="/api/admin/settings/llm")
    async def alias_admin_llm(req: Request):
        return await _forward(req, "/api/admin/settings/llm")

    # COMPAT: web UI calls /admin/mobile (top-level), canonical is /admin/mobile/home
    @r.get("/admin/mobile")
    @compat_decorator(canonical="/api/admin/mobile/home")
    async def alias_admin_mobile(req: Request):
        return await _forward(req, "/api/admin/mobile/home")

    # COMPAT: web UI calls /admin/operator, canonical is /operator/feed
    @r.get("/admin/operator")
    @compat_decorator(canonical="/api/operator/feed")
    async def alias_admin_operator(req: Request):
        return await _forward(req, "/api/operator/feed")

    # COMPAT: web UI calls /admin/leads (queue view), aggregator reads db.leads directly
    # (canonical /leads/* are per-lead-id, not a list view)
    @r.get("/admin/leads")
    @compat_decorator(canonical="aggregator:db.leads")
    async def alias_admin_leads(req: Request, _=Depends(require_role("admin"))):
        rows = await db.leads.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
        by_status: dict[str, int] = {}
        for row in rows:
            st = row.get("status") or "new"
            by_status[st] = by_status.get(st, 0) + 1
        return {"leads": rows, "total": len(rows), "by_status": by_status}

    # COMPAT: web UI calls /admin/system (top-level dashboard), aggregator combines
    # /admin/system-settings + /admin/system-alerts + /admin/system/users counts.
    @r.get("/admin/system")
    @compat_decorator(canonical="aggregator:system_config+alerts+users")
    async def alias_admin_system(req: Request, _=Depends(require_role("admin"))):
        settings = await db.system_config.find_one({"key": "main"}, {"_id": 0}) or {}
        alerts_open = await db.system_alerts.count_documents({"status": "open"})
        users_total = await db.users.count_documents({})
        users_blocked = await db.users.count_documents({"status": "blocked"})
        actions_pending = await db.system_actions.count_documents({"status": "awaiting_manual"})
        return {
            "mode": settings.get("mode", "manual"),
            "settings": settings,
            "alerts_open": alerts_open,
            "users_total": users_total,
            "users_blocked": users_blocked,
            "actions_pending": actions_pending,
        }

    # COMPAT: web UI calls /admin/system/snapshot, same payload as /admin/system
    @r.get("/admin/system/snapshot")
    @compat_decorator(canonical="aggregator:system_config+alerts+users")
    async def alias_admin_system_snapshot(req: Request, _=Depends(require_role("admin"))):
        settings = await db.system_config.find_one({"key": "main"}, {"_id": 0}) or {}
        alerts_open = await db.system_alerts.count_documents({"status": "open"})
        users_total = await db.users.count_documents({})
        users_blocked = await db.users.count_documents({"status": "blocked"})
        actions_pending = await db.system_actions.count_documents({"status": "awaiting_manual"})
        return {
            "mode": settings.get("mode", "manual"),
            "settings": settings,
            "alerts_open": alerts_open,
            "users_total": users_total,
            "users_blocked": users_blocked,
            "actions_pending": actions_pending,
        }

    # ═════════════════════════════════════════════════════════════════════
    # CLIENT
    # ═════════════════════════════════════════════════════════════════════

    # COMPAT: web UI calls /billing/overview, canonical is /client/billing/summary
    @r.get("/billing/overview")
    @compat_decorator(canonical="/api/client/billing/summary")
    async def alias_billing_overview(req: Request):
        return await _forward(req, "/api/client/billing/summary")

    # COMPAT: web UI calls /notifications/unread, canonical is /notifications/my?unread=true
    @r.get("/notifications/unread")
    @compat_decorator(canonical="/api/notifications/my?unread=true")
    async def alias_notifications_unread(req: Request):
        return await _forward(req, "/api/notifications/my", unread="true")

    # COMPAT: web UI calls /activity (top-level feed), canonical is /activity/workspace/all
    @r.get("/activity")
    @compat_decorator(canonical="/api/activity/workspace/all")
    async def alias_activity(req: Request):
        return await _forward(req, "/api/activity/workspace/all")

    # ═════════════════════════════════════════════════════════════════════
    # DEVELOPER
    # ═════════════════════════════════════════════════════════════════════

    # COMPAT: web UI calls /developer/earnings, canonical is /developer/earnings/summary
    @r.get("/developer/earnings")
    @compat_decorator(canonical="/api/developer/earnings/summary")
    async def alias_developer_earnings(req: Request):
        return await _forward(req, "/api/developer/earnings/summary")

    # COMPAT: web UI calls /developer/leaderboard, canonical is /developer/intelligence/leaderboard
    @r.get("/developer/leaderboard")
    @compat_decorator(canonical="/api/developer/intelligence/leaderboard")
    async def alias_developer_leaderboard(req: Request):
        return await _forward(req, "/api/developer/intelligence/leaderboard")

    # COMPAT: web UI calls /marketplace (top-level), canonical is /marketplace/modules
    @r.get("/marketplace")
    @compat_decorator(canonical="/api/marketplace/modules")
    async def alias_marketplace(req: Request):
        return await _forward(req, "/api/marketplace/modules")

    # COMPAT: web UI calls /marketplace/opportunities, canonical is /marketplace/modules
    @r.get("/marketplace/opportunities")
    @compat_decorator(canonical="/api/marketplace/modules")
    async def alias_marketplace_opportunities(req: Request):
        return await _forward(req, "/api/marketplace/modules")

    # COMPAT: web UI calls /me/wallet, canonical is /developer/wallet
    @r.get("/me/wallet")
    @compat_decorator(canonical="/api/developer/wallet")
    async def alias_me_wallet(req: Request):
        return await _forward(req, "/api/developer/wallet")

    # COMPAT: web UI calls /dev_work (snake_case legacy), canonical is /dev/work
    @r.get("/dev_work")
    @compat_decorator(canonical="/api/dev/work")
    async def alias_dev_work(req: Request):
        return await _forward(req, "/api/dev/work")

    return r
