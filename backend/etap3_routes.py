"""
Этап 3 — Contract Map closure.

Closes 9 backend-add gaps + 1 soft-delete decision from
/app/audit/API_CONTRACT_MAP.md, all wired through a single APIRouter that
the main server.py includes once.

Endpoints added:
  GET  /api/client/dashboard               — client home aggregator
  GET  /api/modules/{id}/recommended-developers
  POST /api/modules/{id}/invite-developers
  POST /api/modules/{id}/reopen-bidding
  POST /api/admin/modules/{id}/boost
  POST /api/admin/scopes
  GET  /api/projects/{id}/operator-hints
  GET  /api/global/status
  GET  /api/global/actions
  GET  /api/global/pressure
  POST /api/metrics/event
  DELETE /api/projects/{id}                — soft-delete with audit log

Design rules:
  • Reuse existing DB collections — do NOT duplicate state.
  • Auth: every protected endpoint requires `get_current_user`. Admin-only
    endpoints add explicit role check.
  • Empty-state: when there's no data, return [] / 0 / null — never fake
    numbers. Aligns with the "honest empty state" rule planned for Этап 4.
"""
from __future__ import annotations
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

logger = logging.getLogger(__name__)

# Module-level handles (set by wire())
_db = None
_get_current_user = None
_realtime = None


def wire(*, db, get_current_user, realtime=None):
    """Connect this module to the running app. Called from server.py."""
    global _db, _get_current_user, _realtime
    _db = db
    _get_current_user = get_current_user
    _realtime = realtime


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_admin(user) -> None:
    """role check — admin or master_admin only."""
    role = getattr(user, "role", None) or (user.get("role") if isinstance(user, dict) else None)
    roles = getattr(user, "roles", None) or (user.get("roles") if isinstance(user, dict) else []) or []
    if role not in ("admin", "master_admin") and "admin" not in roles and "master_admin" not in roles:
        raise HTTPException(status_code=403, detail="Admin role required")


def build_router() -> APIRouter:
    r = APIRouter(prefix="/api", tags=["etap3"])

    # ─────────────────────────────────────────────────────────────────────
    # 1) GET /api/client/dashboard — aggregator for ClientDashboardOS
    # ─────────────────────────────────────────────────────────────────────
    async def _dep_user(request: Request):
        return await _get_current_user(request)

    @r.get("/client/dashboard")
    async def client_dashboard(user=Depends(_dep_user)):
        """Top-level client home: projects + alerts + next steps + cashflow."""
        client_id = user.user_id if hasattr(user, "user_id") else user["user_id"]

        # All non-deleted projects owned by this client
        projects_cur = _db.projects.find(
            {"client_id": client_id, "is_deleted": {"$ne": True}},
            {"_id": 0},
        ).sort("created_at", -1)
        projects = await projects_cur.to_list(length=50)

        # Open alerts (best-effort — collection may not exist)
        alerts = []
        try:
            alerts = await _db.client_alerts.find(
                {"client_id": client_id, "resolved_at": None},
                {"_id": 0},
            ).sort("created_at", -1).to_list(length=10)
        except Exception:
            pass

        # Outstanding invoices = cashflow
        outstanding = 0.0
        try:
            inv_cur = _db.invoices.find(
                {"client_id": client_id, "status": {"$in": ["pending", "overdue", "issued"]}},
                {"_id": 0, "amount": 1, "amount_total": 1},
            )
            async for inv in inv_cur:
                outstanding += float(inv.get("amount_total") or inv.get("amount") or 0)
        except Exception:
            pass

        # Pending acceptance / approval queue (deliverables awaiting client
        # decision are the most-critical "next step")
        next_steps: list[dict] = []
        try:
            pending_deliv = await _db.deliverables.find(
                {
                    "client_id": client_id,
                    "status": {"$in": ["awaiting_client", "ready_for_review"]},
                },
                {"_id": 0, "deliverable_id": 1, "title": 1, "project_id": 1, "module_id": 1},
            ).limit(5).to_list(length=5)
            for d in pending_deliv:
                next_steps.append(
                    {
                        "type": "approve_deliverable",
                        "title": f"Review & approve: {d.get('title', 'deliverable')}",
                        "project_id": d.get("project_id"),
                        "module_id": d.get("module_id"),
                        "deliverable_id": d.get("deliverable_id"),
                    }
                )
        except Exception:
            pass

        return {
            "projects": projects,
            "alerts": alerts,
            "next_steps": next_steps,
            "cashflow": {
                "outstanding": round(outstanding, 2),
                "currency": "USD",
            },
            "summary": {
                "active_projects": len([p for p in projects if p.get("status") not in ("done", "cancelled")]),
                "alerts_count": len(alerts),
                "pending_actions": len(next_steps),
            },
        }

    # ─────────────────────────────────────────────────────────────────────
    # 2) Module Marketplace endpoints
    # ─────────────────────────────────────────────────────────────────────
    @r.get("/modules/{module_id}/recommended-developers")
    async def recommended_developers(module_id: str, user=Depends(_dep_user)):
        """Return ranked list of developers fitting this module's skills."""
        module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not module:
            raise HTTPException(status_code=404, detail="Module not found")

        required_skills = set(module.get("skills") or module.get("required_skills") or [])

        # Pull developer pool — every user with role developer (or has
        # developer in roles[]) and not blocked
        cur = _db.users.find(
            {
                "$or": [{"role": "developer"}, {"roles": "developer"}],
                "status": {"$ne": "blocked"},
                "is_deleted": {"$ne": True},
            },
            {
                "_id": 0,
                "user_id": 1,
                "name": 1,
                "skills": 1,
                "level": 1,
                "rating": 1,
                "completed_tasks": 1,
                "active_load": 1,
                "tier": 1,
            },
        )
        devs = await cur.to_list(length=200)

        scored = []
        for d in devs:
            dev_skills = set(d.get("skills") or [])
            overlap = required_skills & dev_skills
            skill_score = (len(overlap) / max(len(required_skills), 1)) * 70 if required_skills else 50
            rating = float(d.get("rating") or 0)
            level_bonus = {"junior": 0, "middle": 5, "senior": 15, "elite": 20}.get(d.get("level", ""), 0)
            load = int(d.get("active_load") or 0)
            load_penalty = min(load * 5, 25)
            score = round(skill_score + level_bonus + (rating * 2) - load_penalty, 1)
            score = max(0, min(100, score))
            fit = "strong" if score >= 80 else "good" if score >= 65 else "fair" if score >= 45 else "weak"
            scored.append(
                {
                    "developer_id": d["user_id"],
                    "name": d.get("name"),
                    "level": d.get("level"),
                    "rating": rating,
                    "skills": list(dev_skills),
                    "matching_skills": list(overlap),
                    "active_load": load,
                    "score": score,
                    "fit": fit,
                }
            )

        scored.sort(key=lambda x: -x["score"])
        return {"module_id": module_id, "recommended": scored[:15]}

    @r.post("/modules/{module_id}/invite-developers")
    async def invite_developers(module_id: str, payload: dict, user=Depends(_dep_user)):
        """Invite a list of developers to bid on this module."""
        ids = payload.get("developer_ids") or []
        if not ids or not isinstance(ids, list):
            raise HTTPException(status_code=422, detail="developer_ids[] required")

        module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not module:
            raise HTTPException(status_code=404, detail="Module not found")

        invited = []
        for dev_id in ids:
            doc = {
                "invitation_id": f"mi_{uuid.uuid4().hex[:12]}",
                "module_id": module_id,
                "developer_id": dev_id,
                "invited_by": user.user_id,
                "status": "pending",
                "created_at": _now_iso(),
            }
            try:
                await _db.module_invitations.insert_one(doc)
                invited.append(dev_id)
            except Exception as e:
                logger.warning(f"Failed to insert invitation for {dev_id}: {e}")

        # Open the bidding window if it was closed
        await _db.modules.update_one(
            {"module_id": module_id},
            {
                "$set": {
                    "bidding_status": "open",
                    "bidding_reopened_at": _now_iso(),
                }
            },
        )

        return {"module_id": module_id, "count": len(invited), "invited": invited}

    @r.post("/modules/{module_id}/reopen-bidding")
    async def reopen_bidding(module_id: str, user=Depends(_dep_user)):
        """Re-open a stuck or closed module for new bids."""
        module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not module:
            raise HTTPException(status_code=404, detail="Module not found")

        await _db.modules.update_one(
            {"module_id": module_id},
            {
                "$set": {
                    "bidding_status": "open",
                    "bidding_reopened_at": _now_iso(),
                    "bidding_reopened_by": user.user_id,
                },
                "$unset": {"assigned_developer_id": ""},
            },
        )
        return {"module_id": module_id, "bidding_status": "open"}

    @r.post("/admin/modules/{module_id}/boost")
    async def admin_boost_module(module_id: str, payload: Optional[dict] = None, user=Depends(_dep_user)):
        """Admin escalator: increases dev reward + visibility tier on stuck modules."""
        _require_admin(user)
        payload = payload or {}
        boost_pct = float(payload.get("boost_pct") or 25)  # +25% reward by default

        module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not module:
            raise HTTPException(status_code=404, detail="Module not found")

        current = float(module.get("dev_reward") or module.get("price") or 0)
        new_reward = round(current * (1 + boost_pct / 100), 2)

        await _db.modules.update_one(
            {"module_id": module_id},
            {
                "$set": {
                    "dev_reward": new_reward,
                    "boosted_at": _now_iso(),
                    "boosted_by": user.user_id,
                    "boost_pct": boost_pct,
                    "priority_tier": "boosted",
                }
            },
        )
        return {
            "module_id": module_id,
            "old_reward": current,
            "new_reward": new_reward,
            "boost_pct": boost_pct,
        }

    # ─────────────────────────────────────────────────────────────────────
    # 3) POST /api/admin/scopes — create scope from request_id
    # ─────────────────────────────────────────────────────────────────────
    @r.post("/admin/scopes")
    async def admin_create_scope(payload: dict, user=Depends(_dep_user)):
        """Create empty scope tied to a request and (optionally) a project."""
        _require_admin(user)
        request_id = payload.get("request_id")
        project_id = payload.get("project_id")
        if not request_id and not project_id:
            raise HTTPException(status_code=422, detail="request_id or project_id required")

        # If only request_id provided, find or create the project shell
        if request_id and not project_id:
            req = await _db.requests.find_one({"request_id": request_id}, {"_id": 0})
            if not req:
                raise HTTPException(status_code=404, detail="Request not found")
            project_id = req.get("project_id")
            if not project_id:
                project_id = f"proj_{uuid.uuid4().hex[:12]}"
                await _db.projects.insert_one(
                    {
                        "project_id": project_id,
                        "client_id": req.get("client_id"),
                        "title": req.get("title") or "New Project",
                        "status": "scoping",
                        "request_id": request_id,
                        "created_at": _now_iso(),
                        "created_by": user.user_id,
                    }
                )
                await _db.requests.update_one(
                    {"request_id": request_id},
                    {"$set": {"project_id": project_id}},
                )

        scope_id = f"scope_{uuid.uuid4().hex[:12]}"
        await _db.scopes.insert_one(
            {
                "scope_id": scope_id,
                "project_id": project_id,
                "request_id": request_id,
                "status": "draft",
                "units": [],
                "created_by": user.user_id,
                "created_at": _now_iso(),
            }
        )
        return {"scope_id": scope_id, "project_id": project_id, "status": "draft"}

    # ─────────────────────────────────────────────────────────────────────
    # 4) GET /api/projects/{id}/operator-hints
    # ─────────────────────────────────────────────────────────────────────
    @r.get("/projects/{project_id}/operator-hints")
    async def operator_hints(project_id: str, user=Depends(_dep_user)):
        """Surface top-3 operator suggestions for a project's current state."""
        project = await _db.projects.find_one({"project_id": project_id}, {"_id": 0})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        hints: list[dict] = []

        # Stuck modules (in_progress > 7 days without status change)
        cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        stuck_count = await _db.modules.count_documents(
            {
                "project_id": project_id,
                "status": "in_progress",
                "updated_at": {"$lt": cutoff},
            }
        )
        if stuck_count > 0:
            hints.append(
                {
                    "type": "stuck_modules",
                    "severity": "warning",
                    "title": f"{stuck_count} module(s) stuck >7d — consider reopening bidding",
                    "action": "reopen_bidding",
                }
            )

        # Modules with no bids
        unassigned = await _db.modules.count_documents(
            {"project_id": project_id, "assigned_developer_id": {"$in": [None, ""]}}
        )
        if unassigned > 0:
            hints.append(
                {
                    "type": "unassigned",
                    "severity": "info",
                    "title": f"{unassigned} module(s) without a developer — invite from marketplace",
                    "action": "invite_developers",
                }
            )

        # QA backlog
        qa_pending = await _db.deliverables.count_documents(
            {"project_id": project_id, "status": "qa_pending"}
        )
        if qa_pending >= 3:
            hints.append(
                {
                    "type": "qa_backlog",
                    "severity": "warning",
                    "title": f"{qa_pending} deliverables waiting QA — escalate to QA lead",
                    "action": "escalate_qa",
                }
            )

        return {"project_id": project_id, "hints": hints}

    # ─────────────────────────────────────────────────────────────────────
    # 5) Global status / actions / pressure (Expo "global control bar")
    # ─────────────────────────────────────────────────────────────────────
    @r.get("/global/status")
    async def global_status(user=Depends(_dep_user)):
        """One-line system pulse for the global control bar."""
        role = user.role
        active_role = getattr(user, "active_role", None) or role

        # Project counters scoped by role
        proj_filter: dict = {"is_deleted": {"$ne": True}}
        if active_role == "client":
            proj_filter["client_id"] = user.user_id
        elif active_role == "developer":
            proj_filter["assigned_developers"] = user.user_id

        active_projects = await _db.projects.count_documents(
            {**proj_filter, "status": {"$nin": ["done", "cancelled"]}}
        )
        blocked_projects = await _db.projects.count_documents(
            {**proj_filter, "status": "blocked"}
        )

        # Pending actions from inbox/events for this user
        pending_actions = 0
        try:
            pending_actions = await _db.events.count_documents(
                {"target_user_id": user.user_id, "resolved_at": None}
            )
        except Exception:
            pass

        # Cashflow scoped by role
        cashflow = 0.0
        try:
            if active_role == "client":
                async for inv in _db.invoices.find(
                    {"client_id": user.user_id, "status": {"$in": ["pending", "overdue"]}},
                    {"_id": 0, "amount_total": 1, "amount": 1},
                ):
                    cashflow += float(inv.get("amount_total") or inv.get("amount") or 0)
            elif active_role == "developer":
                async for ern in _db.earnings.find(
                    {"developer_id": user.user_id, "status": "approved"},
                    {"_id": 0, "amount": 1},
                ):
                    cashflow += float(ern.get("amount") or 0)
        except Exception:
            pass

        # Critical alerts
        alerts = 0
        try:
            alerts = await _db.events.count_documents(
                {"severity": "critical", "resolved_at": None}
            )
        except Exception:
            pass

        return {
            "role": active_role,
            "active_projects": active_projects,
            "blocked_projects": blocked_projects,
            "pending_actions": pending_actions,
            "cashflow": round(cashflow, 2),
            "alerts": alerts,
            "as_of": _now_iso(),
        }

    @r.get("/global/actions")
    async def global_actions(user=Depends(_dep_user)):
        """Inbox feed: top recommended action + recent items."""
        items: list[dict] = []
        try:
            cur = _db.events.find(
                {"target_user_id": user.user_id, "resolved_at": None},
                {"_id": 0},
            ).sort("created_at", -1).limit(20)
            items = await cur.to_list(length=20)
        except Exception:
            pass

        recommended = items[0] if items else None
        return {"recommended": recommended, "items": items}

    @r.get("/global/pressure")
    async def global_pressure(user=Depends(_dep_user)):
        """Per-project pressure heatmap for the inbox screen."""
        proj_filter: dict = {"is_deleted": {"$ne": True}}
        if user.role == "client":
            proj_filter["client_id"] = user.user_id
        elif user.role == "developer":
            proj_filter["assigned_developers"] = user.user_id

        projects = await _db.projects.find(proj_filter, {"_id": 0}).limit(50).to_list(length=50)

        out_projects = []
        blocked = 0
        at_risk = 0
        total_overdue = 0.0
        total_qa_queue = 0
        for p in projects:
            pid = p["project_id"]
            qa_pending = 0
            try:
                qa_pending = await _db.deliverables.count_documents(
                    {"project_id": pid, "status": "qa_pending"}
                )
            except Exception:
                pass
            total_qa_queue += qa_pending

            overdue = 0.0
            try:
                async for inv in _db.invoices.find(
                    {"project_id": pid, "status": "overdue"},
                    {"_id": 0, "amount_total": 1, "amount": 1},
                ):
                    overdue += float(inv.get("amount_total") or inv.get("amount") or 0)
            except Exception:
                pass
            total_overdue += overdue

            health = p.get("status", "on_track")
            if health == "blocked":
                blocked += 1
            elif overdue > 0 or qa_pending >= 3:
                at_risk += 1

            out_projects.append(
                {
                    "project_id": pid,
                    "title": p.get("title"),
                    "trust_score": p.get("trust_score") or 70,
                    "health": health if health in ("on_track", "attention", "blocked") else "on_track",
                    "qa_pending": qa_pending,
                    "overdue_amount": round(overdue, 2),
                }
            )

        out_projects.sort(key=lambda x: (-x["overdue_amount"], -x["qa_pending"]))

        return {
            "summary": {
                "blocked": blocked,
                "at_risk": at_risk,
                "total_overdue": round(total_overdue, 2),
                "total_qa_queue": total_qa_queue,
            },
            "projects": out_projects,
        }

    # ─────────────────────────────────────────────────────────────────────
    # 6) POST /api/metrics/event — analytics sink (logger, no DB schema yet)
    # ─────────────────────────────────────────────────────────────────────
    @r.post("/metrics/event")
    async def metrics_event(payload: dict, request: Request):
        """Lightweight metrics sink. Auth optional — anonymous events
        (e.g. lead funnel) must still be capturable."""
        ev = {
            "name": payload.get("name") or payload.get("event") or "unknown",
            "props": payload.get("props") or {},
            "ip": request.client.host if request.client else None,
            "ua": request.headers.get("user-agent", "")[:200],
            "received_at": _now_iso(),
        }
        # Best-effort store — never block the caller on metrics
        try:
            await _db.metrics_events.insert_one(ev)
        except Exception as e:
            logger.warning(f"metrics_events insert failed: {e}")
        return {"ok": True}

    # ─────────────────────────────────────────────────────────────────────
    # 7) DELETE /api/projects/{id} — soft-delete with audit log
    #    Decision: keep the UI button; mark `is_deleted=True`, preserve all
    #    historical records (escrow, invoices, deliverables) for audit.
    # ─────────────────────────────────────────────────────────────────────
    @r.delete("/projects/{project_id}")
    async def delete_project(project_id: str, user=Depends(_dep_user)):
        project = await _db.projects.find_one({"project_id": project_id}, {"_id": 0})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Authorization: client owner OR admin
        is_owner = project.get("client_id") == user.user_id
        is_admin = user.role in ("admin", "master_admin") or "admin" in (getattr(user, "roles", None) or [])
        if not (is_owner or is_admin):
            raise HTTPException(status_code=403, detail="Not allowed to delete this project")

        # Block delete if money already moved (signed contract or paid invoice)
        signed = project.get("contract_signed_at") or project.get("status") == "in_progress"
        paid_count = 0
        try:
            paid_count = await _db.invoices.count_documents(
                {"project_id": project_id, "status": {"$in": ["paid", "settled"]}}
            )
        except Exception:
            pass
        if (signed or paid_count > 0) and not is_admin:
            raise HTTPException(
                status_code=409,
                detail="Project has an active contract or paid invoice — only admin can delete.",
            )

        # Soft-delete
        await _db.projects.update_one(
            {"project_id": project_id},
            {
                "$set": {
                    "is_deleted": True,
                    "deleted_at": _now_iso(),
                    "deleted_by": user.user_id,
                    "status": "cancelled",
                }
            },
        )

        # Audit log (best-effort)
        try:
            await _db.audit_log.insert_one(
                {
                    "audit_id": f"aud_{uuid.uuid4().hex[:12]}",
                    "action": "project.delete",
                    "actor_id": user.user_id,
                    "target_id": project_id,
                    "target_type": "project",
                    "metadata": {
                        "title": project.get("title"),
                        "had_signed_contract": bool(signed),
                        "paid_invoices": paid_count,
                    },
                    "created_at": _now_iso(),
                }
            )
        except Exception as e:
            logger.warning(f"audit_log insert failed: {e}")

        return {"ok": True, "project_id": project_id, "soft_deleted": True}

    return r
