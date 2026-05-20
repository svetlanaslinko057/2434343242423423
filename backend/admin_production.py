"""
Block A1 — Admin Production State (READ-ONLY, AGGREGATION ONLY)

One endpoint: GET /api/admin/production

Purpose:
    Operational heartbeat of the entire platform for the admin cockpit:
      - portfolio distribution by project risk  (healthy/watch/at_risk/blocked)
      - money snapshot                           (revenue/cost/paid/profit/profit_at_risk)
      - work state                               (active/paused_by_system/over_budget)
      - system activity last 24h                 (auto actions by source)

    No new business logic. No new formulas. No new collections.
    Reuses pure helpers from client_operator (_risk_state, _cost_status)
    and reads directly from the same collections that power the client
    surfaces: db.modules, db.payouts, db.auto_actions.

    The contract is the SAME for every UI that consumes it
    (Web admin cockpit, future Expo admin screen — they share one JSON).
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException

from client_operator import _cost_status, _risk_state

router = APIRouter(prefix="/api", tags=["admin-production"])


def init_router(db, get_current_user_dep):

    @router.get("/admin/production")
    async def admin_production(user=Depends(get_current_user_dep)) -> Dict[str, Any]:
        # Admin-only surface. Role check — same rule used elsewhere in server.py.
        role = user.role if hasattr(user, "role") else user.get("role")
        if role != "admin":
            raise HTTPException(status_code=403, detail="Admin only")

        # 1. Modules (global, all clients)
        modules = await db.modules.find({}, {"_id": 0}).to_list(20000)
        module_ids = [m["module_id"] for m in modules if m.get("module_id")]

        # 2. Payouts grouped by module_id (single query — source of truth for $)
        payouts_by_mod: Dict[str, List[Dict[str, Any]]] = {}
        if module_ids:
            pos = await db.payouts.find(
                {"module_id": {"$in": module_ids}}, {"_id": 0},
            ).to_list(100000)
            for p in pos:
                payouts_by_mod.setdefault(p["module_id"], []).append(p)

        # 3. Enrich modules with cost_status + revenue/cost/paid
        revenue_total = 0.0
        cost_total    = 0.0
        paid_total    = 0.0
        profit_at_risk = 0.0

        active_count        = 0
        paused_by_system_ct = 0
        over_budget_count   = 0

        enriched: List[Dict[str, Any]] = []
        for m in modules:
            mid = m.get("module_id")
            revenue = float(m.get("final_price") or m.get("price") or 0)
            cost    = float(m.get("base_price")  or revenue)
            po      = payouts_by_mod.get(mid or "", [])
            earned  = sum(float(x.get("amount") or 0)
                          for x in po if x.get("status") in ("approved", "paid"))
            paid    = sum(float(x.get("amount") or 0)
                          for x in po if x.get("status") == "paid")

            cost_status = _cost_status(earned, cost)
            status      = m.get("status") or "pending"
            by_guardian = (status == "paused" and m.get("paused_by") == "guardian")

            enriched.append({
                "project_id": m.get("project_id"),
                "status": status,
                "paused_by": m.get("paused_by"),
                "cost_status": cost_status,
            })

            # Totals
            revenue_total += revenue
            cost_total    += cost
            paid_total    += paid
            if cost_status == "over_budget":
                # Overrun = money that will never come back (paid beyond the cap)
                profit_at_risk += max(0.0, earned - cost)
                over_budget_count += 1
            if status in ("pending", "in_progress", "review"):
                active_count += 1
            if by_guardian:
                paused_by_system_ct += 1

        # 4. Portfolio — group modules by project_id → _risk_state per project
        by_project: Dict[str, List[Dict[str, Any]]] = {}
        for e in enriched:
            pid = e.get("project_id")
            if not pid:
                continue
            by_project.setdefault(pid, []).append(e)

        portfolio = {"healthy": 0, "watch": 0, "at_risk": 0, "blocked": 0}
        for _pid, mods in by_project.items():
            portfolio[_risk_state(mods)] = portfolio.get(_risk_state(mods), 0) + 1

        # 5. System activity — last 24h, counted by source
        since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        actions_24h = await db.auto_actions.find(
            {"created_at": {"$gte": since}},
            {"_id": 0, "source": 1},
        ).to_list(100000)

        total_24h       = len(actions_24h)
        guardian_count  = sum(1 for a in actions_24h if a.get("source") == "guardian")
        operator_count  = sum(1 for a in actions_24h if a.get("source") == "operator")

        return {
            "portfolio": portfolio,
            "money": {
                "revenue":        round(revenue_total, 2),
                "cost":           round(cost_total, 2),
                "paid":           round(paid_total, 2),
                "profit":         round(revenue_total - cost_total, 2),
                "profit_at_risk": round(profit_at_risk, 2),
            },
            "work": {
                "active_modules":   active_count,
                "paused_by_system": paused_by_system_ct,
                "over_budget":      over_budget_count,
            },
            "system": {
                "auto_actions_24h": total_24h,
                "guardian_actions": guardian_count,
                "operator_actions": operator_count,
            },
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    return router
