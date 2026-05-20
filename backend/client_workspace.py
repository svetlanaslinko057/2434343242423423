"""
Block 9.0 — Client Workspace (READ-ONLY, AGGREGATION ONLY)

One endpoint: GET /api/client/project/{project_id}/workspace

Purpose (1 screen = 1 question):
    "What's happening with my project right now?"

Returns:
    - project header          (id, title)
    - status + cause + 1-line explanation
    - KPI summary             (revenue / cost / paid / profit)
    - modules                 (status / progress / developer / cost_status)

Intentionally does NOT return:
    - system_actions    → lives in /api/client/operator (that's its job)
    - opportunities     → lives in /api/client/operator/opportunities
    - pending_decisions → lives on individual module endpoints

No new business logic. Reuses shared helpers from client_operator
(_risk_state, _cost_status) — admin & client can never diverge on risk.
No new collections. Reads db.projects, db.modules, db.payouts, db.users.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from client_operator import _cost_status, _risk_state

router = APIRouter(prefix="/api", tags=["client-workspace"])


def _explain(risk: str, over_count: int, warn_count: int) -> str:
    if risk == "blocked":
        return "System paused parts of the project to protect your budget."
    if risk == "at_risk":
        if over_count:
            return "One or more modules went over budget — review and rebalance."
        return "System is watching cost pressure across modules."
    if risk == "watch":
        return "System is monitoring performance and cost."
    return "Everything is running smoothly."


def _cause(risk: str, paused_sys: int, over_count: int, warn_count: int) -> Optional[str]:
    """Short 2–4 words for the header pill: 'Blocked · <cause>'."""
    if risk == "blocked":
        if over_count and paused_sys:
            return "margin risk"
        if over_count:
            return "over budget"
        if paused_sys:
            return "paused by system"
        return "margin risk"
    if risk == "at_risk":
        return "over budget" if over_count else "cost pressure"
    if risk == "watch":
        return "near limits" if warn_count else "monitoring"
    return None  # healthy → no subtitle


def _status_label(risk: str) -> str:
    return {
        "healthy": "Healthy",
        "watch": "Watch",
        "at_risk": "At risk",
        "blocked": "Blocked",
    }.get(risk, "Unknown")


# Sort priority for module list:
#   1. paused by system  (system intervened — most urgent)
#   2. over_budget
#   3. warning (near limit)
#   4. active (in_progress / review / pending)
#   5. paused (manual)
#   6. done / completed
def _module_sort_key(m: Dict[str, Any]) -> int:
    if m.get("paused_by_system"):
        return 0
    cs = m.get("cost_status")
    st = m.get("status")
    if cs == "over_budget":
        return 1
    if cs == "warning":
        return 2
    if st in ("in_progress", "review", "pending"):
        return 3
    if st == "paused":
        return 4
    return 5


def init_router(db, get_current_user_dep):

    @router.get("/client/project/{project_id}/workspace")
    async def client_workspace(project_id: str,
                               user=Depends(get_current_user_dep)) -> Dict[str, Any]:
        client_id = user.user_id if hasattr(user, "user_id") else user["user_id"]

        # 1. Project (auth scope)
        project = await db.projects.find_one(
            {"project_id": project_id, "client_id": client_id}, {"_id": 0},
        )
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # 2. Modules
        modules = await db.modules.find(
            {"project_id": project_id}, {"_id": 0},
        ).to_list(1000)
        module_ids = [m["module_id"] for m in modules]

        # 3. Payouts (earned = approved+paid, paid = paid) — same rule as Operator/Costs
        payouts_by_mod: Dict[str, List[Dict[str, Any]]] = {}
        if module_ids:
            all_p = await db.payouts.find(
                {"module_id": {"$in": module_ids}}, {"_id": 0},
            ).to_list(5000)
            for po in all_p:
                payouts_by_mod.setdefault(po["module_id"], []).append(po)

        # 4. Dev assignments → display names
        dev_ids = list({m.get("assigned_to") for m in modules if m.get("assigned_to")})
        dev_name_by_id: Dict[str, str] = {}
        if dev_ids:
            users = await db.users.find(
                {"user_id": {"$in": dev_ids}},
                {"_id": 0, "user_id": 1, "name": 1, "email": 1},
            ).to_list(500)
            for u in users:
                dev_name_by_id[u["user_id"]] = u.get("name") or u.get("email") or "Developer"

        # 5. Enrich modules (totals + risk rollup)
        tot_revenue = tot_cost = tot_paid = tot_earned = 0.0
        enriched_modules: List[Dict[str, Any]] = []
        risk_input: List[Dict[str, Any]] = []   # lean copy for _risk_state()

        for m in modules:
            mid = m["module_id"]
            payouts = payouts_by_mod.get(mid, [])
            earned = sum(float(x.get("amount") or 0) for x in payouts
                         if x.get("status") in ("approved", "paid"))
            paid = sum(float(x.get("amount") or 0) for x in payouts
                       if x.get("status") == "paid")
            revenue = float(m.get("final_price") or m.get("price") or 0)
            cost = float(m.get("base_price") or revenue)
            progress_ratio = (earned / cost) if cost > 0 else 0.0
            cost_status = _cost_status(earned, cost)
            status = m.get("status") or "pending"
            paused_by_system = (status == "paused" and m.get("paused_by") == "guardian")

            dev_id = m.get("assigned_to")
            dev_label = dev_name_by_id.get(dev_id or "", "") if dev_id else ""

            enriched_modules.append({
                "module_id": mid,
                "module_title": m.get("title") or "",
                "status": status,
                "paused_by_system": paused_by_system,
                "progress": round(min(progress_ratio, 1.0), 2),
                "progress_pct": int(min(progress_ratio, 1.0) * 100),
                "price": round(revenue, 2),
                "cost": round(cost, 2),
                "earned": round(earned, 2),
                "paid": round(paid, 2),
                "cost_status": cost_status,
                "developer_id": dev_id,
                "developer_name": dev_label,
            })
            risk_input.append({
                "status": status,
                "paused_by": m.get("paused_by"),
                "cost_status": cost_status,
            })

            tot_revenue += revenue
            tot_cost += cost
            tot_earned += earned
            tot_paid += paid

        # 6. Rollup
        risk = _risk_state(risk_input)
        over_count = sum(1 for m in enriched_modules if m["cost_status"] == "over_budget")
        warn_count = sum(1 for m in enriched_modules if m["cost_status"] == "warning")
        paused_sys = sum(1 for m in enriched_modules if m["paused_by_system"])
        active_count = sum(1 for m in enriched_modules
                           if m["status"] in ("pending", "in_progress", "review"))

        # BD-15 (slice #3) — additive module status counts.
        # Authority promotion per I-06: ≥2 frontend consumers (mobile project-
        # detail counters + mobile project-list inline counters) were doing
        # the same `.filter().length` synthesis client-side; web cabinet already
        # proves the same shape is server-computable via /full's workspace.
        # Narrow, additive, explicit. NOT a universal stats object.
        sc_in_progress = sum(1 for m in enriched_modules if m["status"] == "in_progress")
        sc_review = sum(1 for m in enriched_modules if m["status"] == "review")
        sc_done = sum(1 for m in enriched_modules
                      if m["status"] in ("done", "completed"))
        sc_paused = sum(1 for m in enriched_modules if m["status"] == "paused")

        # 7. Sort modules by priority (system-paused → over-budget → warning → active → …)
        enriched_modules.sort(key=_module_sort_key)

        # 8. Latest system action — the operator/guardian audit trail.
        # Surfacing the most recent line on the hero turns the project from
        # "managed by you" to "managed by the system, you supervise".
        last_action = await db.auto_actions.find_one(
            {"project_id": project_id},
            {"_id": 0, "type": 1, "impact": 1, "reason": 1, "created_at": 1},
            sort=[("created_at", -1)],
        )
        system_action = None
        if last_action:
            system_action = {
                "label": last_action.get("impact") or last_action.get("reason") or "System acted",
                "type": last_action.get("type"),
                "at": last_action.get("created_at"),
            }

        # Deposit block — surfaces 10% deposit required at conversion
        # (visitor → register → claim). Frontend renders a Pay-deposit card on
        # the project screen when `required: True`. Additive: legacy projects
        # without a deposit_amount/awaiting_deposit status get `required:False`.
        proj_status = project.get("status") or ""
        deposit_required = (
            proj_status == "awaiting_deposit"
            and not project.get("deposit_paid", False)
            and float(project.get("deposit_amount") or 0) > 0
        )
        deposit_block = {
            "required": bool(deposit_required),
            "paid": bool(project.get("deposit_paid", False)),
            "amount": float(project.get("deposit_amount") or 0),
            "final_price": float(project.get("final_price") or 0),
            "project_status": proj_status or None,
        }

        return {
            "project": {
                "project_id": project_id,
                "project_title": project.get("name") or project.get("title") or "",
                "status": proj_status or None,
                "created_at": project.get("created_at"),
            },
            "deposit": deposit_block,
            "summary": {
                "revenue": round(tot_revenue, 2),
                "cost": round(tot_cost, 2),
                "earned": round(tot_earned, 2),
                "paid": round(tot_paid, 2),
                "profit": round(tot_revenue - tot_cost, 2),
                "active_modules": active_count,
                "total_modules": len(enriched_modules),
                "over_budget_count": over_count,
                "warning_count": warn_count,
                "paused_by_system_count": paused_sys,
            },
            # BD-15 — module status counts (slice #3 promotion, I-06 satisfied).
            # Authoritative aggregation: frontend MUST NOT recompute.
            "status_counts": {
                "in_progress": sc_in_progress,
                "review": sc_review,
                "done": sc_done,
                "paused": sc_paused,
                "total": len(enriched_modules),
            },
            "status": risk,                 # healthy | watch | at_risk | blocked
            "status_label": _status_label(risk),
            "cause": _cause(risk, paused_sys, over_count, warn_count),
            "explanation": _explain(risk, over_count, warn_count),
            "system_action": system_action,
            "modules": enriched_modules,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    return router
