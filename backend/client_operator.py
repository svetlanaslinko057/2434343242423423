"""
Block 8.0 — Operator Mode (project-level control surface, READ-ORIENTED)

One endpoint: GET /api/client/operator
One orchestrator: POST /api/client/operator/{project_id}/action

The orchestrator is NOT new business logic — it only fans out to existing
module endpoints (/modules/{id}/pause, /modules/{id}/resume) and writes a
`system_alerts` row for "request_review". Lock approvals is a pure UI flag
(not persisted here — client keeps it).

No new collections, no new vocabulary. Everything is derived on the fly.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["client-operator"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _cost_status(earned: float, cap: float) -> str:
    if cap <= 0:
        return "under_control"
    if earned > cap:
        return "over_budget"
    if earned > cap * 0.8:
        return "warning"
    return "under_control"


def _risk_state(modules: List[Dict[str, Any]]) -> str:
    """Deterministic risk state for a project from its module cost_status."""
    paused_by_system = sum(1 for m in modules
                           if m.get("status") == "paused" and m.get("paused_by") == "guardian")
    over = sum(1 for m in modules if m.get("cost_status") == "over_budget")
    warn = sum(1 for m in modules if m.get("cost_status") == "warning")

    if paused_by_system >= 1:
        return "blocked"
    if over >= 1 or warn >= 2:
        return "at_risk"
    if warn >= 1:
        return "watch"
    return "healthy"


# ─── Models ────────────────────────────────────────────────────────────────
class OperatorActionReq(BaseModel):
    action: str  # "pause" | "resume" | "request_review"
    note: Optional[str] = None


# ──────────────────────────────────────────────────────────────────────────
def init_router(db, get_current_user_dep):

    # Reuse module pause/resume logic without re-implementing it:
    # we touch modules.status directly, mirroring what work_execution does.
    async def _set_module_status(module_id: str, new_status: str,
                                 uid: str, by_system: bool = False) -> bool:
        m = await db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not m:
            return False
        extras: Dict[str, Any] = {}
        if new_status == "paused":
            extras = {"paused_at": _now_iso(),
                      "paused_by": "guardian" if by_system else uid}
        elif new_status == "in_progress":
            extras = {"resumed_at": _now_iso(), "resumed_by": uid,
                      "paused_by": None, "paused_at": None}
        await db.modules.update_one(
            {"module_id": module_id},
            {"$set": {"status": new_status, **extras}},
        )
        return True

    @router.get("/client/operator")
    async def client_operator(project_id: Optional[str] = None,
                              user=Depends(get_current_user_dep)) -> Dict[str, Any]:
        client_id = user.user_id if hasattr(user, "user_id") else user["user_id"]

        q: Dict[str, Any] = {"client_id": client_id}
        if project_id:
            q["project_id"] = project_id
        projects = await db.projects.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
        project_ids = [p["project_id"] for p in projects]
        if not project_ids:
            return {"projects": [], "summary": {"at_risk": 0, "blocked": 0, "watch": 0, "healthy": 0},
                    "generated_at": datetime.now(timezone.utc).isoformat()}

        # Modules for these projects
        modules = await db.modules.find(
            {"project_id": {"$in": project_ids}}, {"_id": 0},
        ).to_list(2000)
        module_ids = [m["module_id"] for m in modules]

        # Payouts grouped (for earned computation — same rule as /client/costs)
        payouts_by_mod: Dict[str, List[Dict[str, Any]]] = {}
        if module_ids:
            all_p = await db.payouts.find(
                {"module_id": {"$in": module_ids}}, {"_id": 0},
            ).to_list(5000)
            for po in all_p:
                payouts_by_mod.setdefault(po["module_id"], []).append(po)

        # Auto actions + alerts, scoped by module / project
        since_iso = "1970-01-01T00:00:00+00:00"  # no time window here; limit by count
        actions = await db.auto_actions.find(
            {"$or": [
                {"module_id": {"$in": module_ids}},
                {"project_id": {"$in": project_ids}},
            ], "created_at": {"$gte": since_iso}},
            {"_id": 0},
        ).sort("created_at", -1).to_list(400)

        alerts = await db.system_alerts.find(
            {"$or": [
                {"project_id": {"$in": project_ids}},
                {"module_id": {"$in": module_ids}},
                {"entity_type": "project", "entity_id": {"$in": project_ids}},
                {"entity_type": "module", "entity_id": {"$in": module_ids}},
            ], "resolved": {"$ne": True}},
            {"_id": 0},
        ).sort("created_at", -1).to_list(300)

        # Enrich modules with cost_status
        enriched_modules: List[Dict[str, Any]] = []
        for m in modules:
            mid = m["module_id"]
            cap = float(m.get("base_price") or m.get("final_price") or m.get("price") or 0)
            earned = sum(float(x.get("amount") or 0)
                         for x in payouts_by_mod.get(mid, [])
                         if x.get("status") in ("approved", "paid"))
            enriched_modules.append({**m,
                                     "cost_cap": round(cap, 2),
                                     "earned": round(earned, 2),
                                     "cost_status": _cost_status(earned, cap)})

        # Build per-project output
        projects_out: List[Dict[str, Any]] = []
        risk_counts = {"healthy": 0, "watch": 0, "at_risk": 0, "blocked": 0}
        for p in projects:
            pid = p["project_id"]
            proj_modules = [m for m in enriched_modules if m.get("project_id") == pid]
            proj_mod_ids = {m["module_id"] for m in proj_modules}

            # Dedupe actions by (scope, type) — newest wins.
            # For module-scoped: (module_id, type); for project-scoped: ("_project", type)
            seen = set()
            feed: List[Dict[str, Any]] = []
            for a in actions:
                a_mid = a.get("module_id")
                a_pid = a.get("project_id")
                is_for_project = (a_pid == pid) or (a_mid in proj_mod_ids)
                if not is_for_project:
                    continue
                scope_key = a_mid if a_mid else f"project:{a_pid}"
                key = (scope_key, a.get("type"))
                if key in seen:
                    continue
                seen.add(key)
                mod_title = next((m.get("title") for m in proj_modules
                                  if m["module_id"] == a_mid), "")
                feed.append({
                    "kind": "system_action",
                    "id": a.get("action_id"),
                    "type": a.get("type"),
                    "module_id": a_mid,
                    "module_title": mod_title,
                    "confidence": a.get("confidence"),
                    "reason": a.get("reason"),
                    "impact": a.get("impact"),
                    "source": a.get("source", "system"),
                    "created_at": a.get("created_at"),
                })

            # Alerts as feed items
            for al in alerts:
                # scope
                if al.get("project_id") == pid or al.get("entity_id") == pid:
                    scope_ok = True
                elif al.get("module_id") in proj_mod_ids or al.get("entity_id") in proj_mod_ids:
                    scope_ok = True
                else:
                    scope_ok = False
                if not scope_ok:
                    continue
                feed.append({
                    "kind": "system_alert",
                    "id": al.get("alert_id") or al.get("_alert_id"),
                    "type": al.get("type") or al.get("alert_type"),
                    "module_id": al.get("module_id") or (al.get("entity_id") if al.get("entity_type") == "module" else None),
                    "module_title": "",
                    "severity": al.get("severity") or "info",
                    "reason": al.get("message") or al.get("summary") or "",
                    "impact": "",
                    "source": "alert_engine",
                    "created_at": al.get("created_at"),
                })

            # newest first, cap it
            feed.sort(key=lambda x: x.get("created_at") or "", reverse=True)
            feed = feed[:20]

            # Module summary (lightweight)
            mod_summary = [{
                "module_id": m["module_id"],
                "module_title": m.get("title") or "",
                "status": m.get("status"),
                "paused_by_system": (m.get("status") == "paused" and m.get("paused_by") == "guardian"),
                "cost_status": m.get("cost_status"),
                "cost_cap": m.get("cost_cap"),
                "earned": m.get("earned"),
            } for m in proj_modules]

            over_count    = sum(1 for m in proj_modules if m["cost_status"] == "over_budget")
            warn_count    = sum(1 for m in proj_modules if m["cost_status"] == "warning")
            paused_count  = sum(1 for m in proj_modules if m["status"] == "paused")
            paused_sys    = sum(1 for m in proj_modules if m["status"] == "paused" and m.get("paused_by") == "guardian")
            active_count  = sum(1 for m in proj_modules
                                if m["status"] in ("pending", "in_progress", "review"))

            risk = _risk_state(proj_modules)
            risk_counts[risk] = risk_counts.get(risk, 0) + 1

            # 🛡️ Block 8.1 — derived lock state (NO toggle, NO persistence).
            # Mirrors the server-side PROJECT_LOCK rule in /admin/payouts/*/approve.
            lock_approvals = (risk == "blocked") or (over_count > 0)
            lock_reason = None
            if lock_approvals:
                if paused_sys > 0 and over_count > 0:
                    lock_reason = "System paused modules AND others are over budget"
                elif paused_sys > 0:
                    lock_reason = "Modules paused by system to protect margin"
                else:
                    lock_reason = f"{over_count} module{'s' if over_count>1 else ''} over budget"

            # Human-readable project headline
            headline_bits: List[str] = []
            if over_count:   headline_bits.append(f"{over_count} module{'s' if over_count>1 else ''} over budget")
            if paused_sys:   headline_bits.append(f"{paused_sys} paused by system")
            if warn_count and not over_count:  headline_bits.append(f"{warn_count} near limit")
            if not headline_bits: headline_bits.append("All modules within plan")

            projects_out.append({
                "project_id": pid,
                "project_title": p.get("name") or p.get("title") or "",
                "risk_state": risk,
                "headline": " · ".join(headline_bits),
                "lock_approvals": lock_approvals,
                "lock_reason": lock_reason,
                "summary": {
                    "over_budget_count": over_count,
                    "warning_count": warn_count,
                    "paused_count": paused_count,
                    "paused_by_system_count": paused_sys,
                    "active_count": active_count,
                    "total_modules": len(proj_modules),
                },
                "can": {
                    "pause_project":  active_count > 0,
                    "resume_project": paused_count > 0,
                    "request_review": True,
                },
                "actions": feed,
                "modules": mod_summary,
            })

        return {"projects": projects_out, "summary": risk_counts,
                "generated_at": datetime.now(timezone.utc).isoformat()}

    @router.post("/client/operator/{project_id}/action")
    async def operator_action(project_id: str, req: OperatorActionReq,
                              user=Depends(get_current_user_dep)) -> Dict[str, Any]:
        client_id = user.user_id if hasattr(user, "user_id") else user["user_id"]
        uid = client_id
        project = await db.projects.find_one(
            {"project_id": project_id, "client_id": client_id}, {"_id": 0},
        )
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        action = (req.action or "").lower()
        affected = 0

        if action == "pause":
            mods = await db.modules.find(
                {"project_id": project_id,
                 "status": {"$in": ["pending", "in_progress", "review"]}},
                {"_id": 0, "module_id": 1},
            ).to_list(1000)
            for m in mods:
                if await _set_module_status(m["module_id"], "paused", uid=uid):
                    affected += 1

        elif action == "resume":
            mods = await db.modules.find(
                {"project_id": project_id, "status": "paused"}, {"_id": 0, "module_id": 1},
            ).to_list(1000)
            for m in mods:
                if await _set_module_status(m["module_id"], "in_progress", uid=uid):
                    affected += 1

        elif action == "request_review":
            alert_doc = {
                "alert_id": f"al_{uuid.uuid4().hex[:12]}",
                "type": "team_review_requested",
                "severity": "info",
                "project_id": project_id,
                "entity_type": "project",
                "entity_id": project_id,
                "message": req.note or "Client requested a team review",
                "created_at": _now_iso(),
                "resolved": False,
                "source": "operator",
            }
            await db.system_alerts.insert_one(alert_doc)
            affected = 1

        else:
            raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

        return {"ok": True, "action": action, "project_id": project_id, "affected": affected}

    return router
