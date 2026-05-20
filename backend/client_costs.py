"""
Block 6.1 (re-framed) — Client Cost Control / Project Economy (READ-ONLY)

Answers ONE question: "How much is this project costing me right now?"

This is NOT escrow. This is a ledger of real commitments and actual payouts:
  - revenue  = module.final_price / price       (what the client pays)
  - cost     = module.base_price  / price       (what the team is entitled to)
  - earned   = Σ payouts where status in (approved, paid)   (accrued to dev)
  - paid     = Σ payouts where status == "paid"             (actually paid out)
  - payouts_pending  — exposed so UI can wire "Approve payout" action

No new schema. No new formulas. No writes.
cost_status is imported from client_operator — single source of truth
across client_workspace / client_operator / client_costs / admin_*.

Endpoint: GET /api/client/costs
"""
from __future__ import annotations

from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from typing import Any, Dict, List

from client_operator import _cost_status

router = APIRouter(prefix="/api", tags=["client-costs"])


def init_router(db, get_current_user_dep):
    @router.get("/client/costs")
    async def client_costs(user=Depends(get_current_user_dep)) -> Dict[str, Any]:
        client_id = user.user_id if hasattr(user, "user_id") else user["user_id"]

        # 1. Client projects
        projects = await db.projects.find(
            {"client_id": client_id}, {"_id": 0},
        ).sort("created_at", -1).to_list(200)
        project_ids = [p["project_id"] for p in projects]

        # 2. Modules
        modules: List[Dict[str, Any]] = []
        if project_ids:
            modules = await db.modules.find(
                {"project_id": {"$in": project_ids}}, {"_id": 0},
            ).to_list(1000)

        # 3. Payouts — source of truth for earned/paid
        module_ids = [m["module_id"] for m in modules]
        payouts_by_module: Dict[str, List[Dict[str, Any]]] = {}
        if module_ids:
            all_payouts = await db.payouts.find(
                {"module_id": {"$in": module_ids}}, {"_id": 0},
            ).to_list(5000)
            for p in all_payouts:
                payouts_by_module.setdefault(p["module_id"], []).append(p)

        # 3b. Auto actions — system suggestions layer (Block 5.2 → wired into costs)
        suggestions_by_module: Dict[str, List[Dict[str, Any]]] = {}
        if module_ids:
            actions = await db.auto_actions.find(
                {"module_id": {"$in": module_ids},
                 "type": {"$in": ["auto_rebalance", "auto_add_support",
                                  "auto_review_flag", "auto_escalate",
                                  "auto_pause"]}},
                {"_id": 0},
            ).sort("created_at", -1).to_list(500)
            _SUGG = {
                "auto_rebalance":   ("System rebalanced the team to reduce overload",  "positive"),
                "auto_add_support": ("Extra developer added to keep the timeline",     "positive"),
                "auto_review_flag": ("Module flagged for extra QA review",             "warning"),
                "auto_escalate":    ("Module escalated — needs your attention",        "warning"),
                "auto_pause":       ("System paused this module to protect margin",    "warning"),
            }
            # Dedupe: within each module, keep only the newest action per type.
            # Feed is already sorted newest-first, so .setdefault + skip-if-seen works.
            seen_by_module: Dict[str, set] = {}
            for a in actions:
                mid = a.get("module_id")
                atype = a.get("type")
                if not mid or not atype:
                    continue
                seen = seen_by_module.setdefault(mid, set())
                if atype in seen:
                    continue  # older duplicate → drop
                seen.add(atype)
                text, tone = _SUGG.get(atype, (None, None))
                if not text:
                    continue
                lst = suggestions_by_module.setdefault(mid, [])
                if len(lst) >= 2:  # keep it focused — max 2 per module
                    continue
                lst.append({
                    "action_id": a.get("action_id"),
                    "type": atype,
                    "text": text,
                    "tone": tone,
                })

        # 4. Aggregate
        projects_out: List[Dict[str, Any]] = []
        tot_revenue = tot_cost = tot_paid = tot_earned = 0.0

        for p in projects:
            proj_modules = [m for m in modules if m.get("project_id") == p["project_id"]]
            proj_revenue = proj_cost = proj_paid = proj_earned = 0.0
            mod_rows: List[Dict[str, Any]] = []

            for m in proj_modules:
                payouts = payouts_by_module.get(m["module_id"], [])
                earned = sum(
                    float(x.get("amount") or 0) for x in payouts
                    if x.get("status") in ("approved", "paid")
                )
                paid = sum(
                    float(x.get("amount") or 0) for x in payouts
                    if x.get("status") == "paid"
                )
                pending_payouts = [
                    {"payout_id": x["payout_id"], "amount": float(x.get("amount") or 0)}
                    for x in payouts if x.get("status") == "pending"
                ]
                approved_payouts = [
                    {"payout_id": x["payout_id"], "amount": float(x.get("amount") or 0)}
                    for x in payouts if x.get("status") == "approved"
                ]

                revenue = float(m.get("final_price") or m.get("price") or 0)
                cost = float(m.get("base_price") or revenue)
                progress = (earned / cost) if cost > 0 else 0.0

                mod_rows.append({
                    "module_id": m["module_id"],
                    "module_title": m.get("title") or "",
                    "status": m.get("status") or "pending",
                    "price": round(revenue, 2),
                    "cost": round(cost, 2),
                    "earned": round(earned, 2),
                    "paid": round(paid, 2),
                    "progress": round(progress, 2),
                    "cost_status": _cost_status(earned, cost),
                    "pending_payouts": pending_payouts,
                    "approved_payouts": approved_payouts,
                    "system_suggestions": suggestions_by_module.get(m["module_id"], []),
                })

                proj_revenue += revenue
                proj_cost += cost
                proj_paid += paid
                proj_earned += earned

            projects_out.append({
                "project_id": p["project_id"],
                "project_title": p.get("name") or p.get("title") or "",
                "revenue": round(proj_revenue, 2),
                "cost": round(proj_cost, 2),
                "earned": round(proj_earned, 2),
                "paid": round(proj_paid, 2),
                "profit": round(proj_revenue - proj_cost, 2),
                "modules": mod_rows,
            })

            tot_revenue += proj_revenue
            tot_cost += proj_cost
            tot_paid += proj_paid
            tot_earned += proj_earned

        return {
            "summary": {
                "revenue": round(tot_revenue, 2),
                "committed_cost": round(tot_cost, 2),
                "earned": round(tot_earned, 2),
                "paid_out": round(tot_paid, 2),
                "remaining_cost": round(max(0.0, tot_cost - tot_paid), 2),
                "profit": round(tot_revenue - tot_cost, 2),
            },
            "projects": projects_out,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    return router

