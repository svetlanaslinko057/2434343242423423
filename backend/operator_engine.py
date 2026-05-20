"""
Wave 8 — AI Operator Engine
============================

Autonomous system-awareness layer. Scans live state, proposes actions,
optionally auto-executes. Does NOT duplicate Event Engine. Does NOT
mutate core workflow logic directly — only triggers existing mechanics.

Design invariants:
- Reads from: events, projects, modules, invoices, users
- Writes to:  operator_history (audit), never to core workflow tables
- Emits on:   Socket.IO via realtime.emit_to_role (existing channel)
- Records events via event_engine.create_event (no private bus)

Public surface:
- build_router(deps): returns APIRouter with fully-wired Depends
- operator_scheduler_loop(): coroutine — run as background task
- wire(db, realtime, event_engine): inject runtime globals
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("operator_engine")

# ─────────────────────────────────────────────────────────────
# Runtime wiring (injected by server.py)
# ─────────────────────────────────────────────────────────────
_db = None
_realtime = None
_event_engine = None
_flow_control = None  # Wave 9 hook — optional
_developer_brain = None  # Wave 9.5 hook — optional
_revenue_brain = None  # Wave 10 hook — optional
_scaling_engine = None  # Wave 11 hook — optional


def wire(*, db, realtime, event_engine=None):
    """Called once from server.py before include_router."""
    global _db, _realtime, _event_engine
    _db = db
    _realtime = realtime
    _event_engine = event_engine


def set_flow_control(flow_control_module):
    """Optional: wire Wave 9 so operator can call invite_developers."""
    global _flow_control
    _flow_control = flow_control_module


def set_developer_brain(developer_brain_module):
    """Optional: wire Wave 9.5 for missed-opportunity detection."""
    global _developer_brain
    _developer_brain = developer_brain_module


def set_revenue_brain(revenue_brain_module):
    """Optional: wire Wave 10 for demand-side rules (churn/expansion/retainer/premium)."""
    global _revenue_brain
    _revenue_brain = revenue_brain_module


def set_scaling_engine(scaling_engine_module):
    """Optional: wire Wave 11 so scheduler can run auto-balance when automation_level == 'auto'."""
    global _scaling_engine
    _scaling_engine = scaling_engine_module


def _now():
    return datetime.now(timezone.utc)


def _uid():
    return str(uuid.uuid4())


# ─────────────────────────────────────────────────────────────
# Scan
# ─────────────────────────────────────────────────────────────
async def run_operator_scan() -> List[Dict[str, Any]]:
    if _db is None:
        return []

    actions: List[Dict[str, Any]] = []
    now = _now()

    projects = await _db.projects.find(
        {"status": {"$nin": ["completed", "cancelled"]}}, {"_id": 0}
    ).to_list(500)
    if not projects:
        return []

    # ── PRODUCTION MODE INVARIANT ──────────────────────────────────────
    # dev    → operator produces ZERO actions for that project
    # ai     → full autonomy (standard)
    # hybrid → module-level assignment_mode decides
    projects = [p for p in projects if p.get("production_mode") != "dev"]
    if not projects:
        return []

    all_mods = await _db.modules.find({}, {"_id": 0}).to_list(2000)
    mods_by_project: Dict[str, List[Dict]] = {}
    for m in all_mods:
        mods_by_project.setdefault(m.get("project_id"), []).append(m)

    overdue_invs = await _db.invoices.find(
        {"status": {"$in": ["overdue", "pending"]}}, {"_id": 0}
    ).to_list(1000)

    for p in projects:
        pid = p.get("project_id")
        ptitle = p.get("name") or p.get("title") or "Project"
        mods = mods_by_project.get(pid, [])
        # ── L1 INVARIANT: manual > auto ─────────────────────────────────
        # Strip manual modules before any module-level rule runs.
        # Operator MUST NOT suggest or auto-apply anything on manual modules.
        auto_mods = [m for m in mods if m.get("assignment_mode") != "manual"]

        # Rule A: payment_risk
        for inv in overdue_invs:
            if inv.get("project_id") != pid:
                continue
            overdue_days = 0
            due = inv.get("due_date")
            if due:
                try:
                    dt = datetime.fromisoformat(str(due).replace("Z", "+00:00"))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    overdue_days = max(0, (now - dt).days)
                except Exception:
                    pass
            if inv.get("status") == "overdue" or overdue_days > 0:
                actions.append({
                    "id": f"payment_risk:{pid}:{inv.get('invoice_id','x')}",
                    "type": "payment_risk",
                    "severity": "critical" if overdue_days > 7 else "high",
                    "auto_eligible": True,
                    "auto_action": "send_reminder",
                    "title": f"Overdue invoice on {ptitle}",
                    "project": ptitle, "project_id": pid,
                    "invoice_id": inv.get("invoice_id"),
                    "description": f"Invoice ${inv.get('amount', 0)} · {overdue_days}d overdue",
                    "suggestion": "Send reminder to client",
                    "expected_impact": {"payment_recovery": f"${inv.get('amount', 0)}"},
                    "confidence": 85 if overdue_days > 3 else 65,
                    "why": [f"Status {inv.get('status')}", f"{overdue_days}d past due", "Client may need a nudge"],
                })

        # Rule B: qa_bottleneck
        qa_queue = [m for m in auto_mods if m.get("status") in ("qa_review", "review", "in_review")]
        if len(qa_queue) > 1:
            value = sum(float(m.get("price", 0) or 0) for m in qa_queue)
            actions.append({
                "id": f"qa_bottleneck:{pid}",
                "type": "qa_bottleneck",
                "severity": "high",
                "auto_eligible": False,
                "title": f"{len(qa_queue)} modules stuck in QA",
                "project": ptitle, "project_id": pid,
                "description": "QA queue growing → earnings delayed, timeline at risk",
                "suggestion": "Review QA queue immediately",
                "expected_impact": {"earnings_unlocked": f"${int(value)}", "timeline_saved": "1-2d"},
                "confidence": 88,
                "why": [f"{len(qa_queue)} modules waiting review", "Developers blocked from new work", "Client sees no progress"],
            })

        # Rule C: idle_developer
        for m in auto_mods:
            if m.get("status") != "in_progress":
                continue
            started = m.get("started_at") or m.get("accepted_at")
            if not started:
                continue
            try:
                started_dt = datetime.fromisoformat(str(started).replace("Z", "+00:00"))
                if started_dt.tzinfo is None:
                    started_dt = started_dt.replace(tzinfo=timezone.utc)
                hours_active = (now - started_dt).total_seconds() / 3600
            except Exception:
                continue
            hours_spent = float(m.get("hours_spent", 0) or 0)
            if hours_active > 48 and hours_spent < 2:
                dev_name = "Developer"
                if m.get("assigned_to"):
                    dev = await _db.users.find_one({"user_id": m["assigned_to"]}, {"_id": 0})
                    if dev:
                        dev_name = dev.get("name", "Developer")
                actions.append({
                    "id": f"idle_developer:{pid}:{m.get('module_id')}",
                    "type": "idle_developer",
                    "severity": "medium",
                    "auto_eligible": False,
                    "title": f"Low activity on {m.get('title', 'module')}",
                    "project": ptitle, "project_id": pid, "module_id": m.get("module_id"),
                    "description": f"{dev_name} — {round(hours_active)}h since start, only {hours_spent}h logged",
                    "suggestion": "Check in with developer or consider reassignment",
                    "expected_impact": {"timeline_saved": "2-3d"},
                    "confidence": 65,
                    "why": [f"{round(hours_active)}h since start", f"Only {hours_spent}h logged", "Deadline risk"],
                })

    # Rule D: overload_risk (global)
    devs = await _db.users.find({"role": "developer"}, {"_id": 0}).to_list(500)
    for d in devs:
        cap = int(d.get("capacity") or 0)
        act = int(d.get("active_modules") or 0)
        if cap > 0 and act > cap:
            actions.append({
                "id": f"overload_risk:{d.get('user_id')}",
                "type": "overload_risk",
                "severity": "high",
                "auto_eligible": False,
                "title": f"{d.get('name', 'Developer')} overloaded ({act}/{cap})",
                "project": "—", "project_id": None,
                "description": f"Developer above capacity by {act - cap} module(s)",
                "suggestion": "Redirect new work to other qualified developers",
                "expected_impact": {"burnout_risk": "reduced", "throughput": "stabilized"},
                "confidence": 82,
                "why": [f"{act} active vs cap {cap}", "Quality drops above capacity", "Consider rebalancing"],
            })

    # Rule E: invite_top_devs (Wave 9 — Flow Control hook)
    # Trigger: module.status=open AND no active invitations AND age>2h
    for p in projects:
        pid = p.get("project_id")
        ptitle = p.get("name") or p.get("title") or "Project"
        for m in mods_by_project.get(pid, []):
            # L1: skip manual modules — they are owned by the core team.
            if m.get("assignment_mode") == "manual":
                continue
            if m.get("status") not in ("open", "open_for_bids"):
                continue
            # Age check
            created = m.get("created_at") or m.get("posted_at")
            if not created:
                continue
            try:
                created_dt = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
                if created_dt.tzinfo is None:
                    created_dt = created_dt.replace(tzinfo=timezone.utc)
                hrs = (now - created_dt).total_seconds() / 3600
            except Exception:
                continue
            if hrs < 2:
                continue
            # Skip if already has active invitations
            open_inv = await _db.module_invitations.count_documents({
                "module_id": m.get("module_id"), "status": "sent"
            })
            if open_inv > 0:
                continue
            actions.append({
                "id": f"invite_top_devs:{pid}:{m.get('module_id')}",
                "type": "invite_top_devs",
                "severity": "medium",
                "auto_eligible": True,
                "auto_action": "invite_top3",
                "title": f"Invite top developers for {m.get('title', 'module')}",
                "project": ptitle, "project_id": pid,
                "module_id": m.get("module_id"),
                "description": f"Open {round(hrs)}h with no invitations",
                "suggestion": "Invite top-3 matching developers",
                "expected_impact": {"time_to_start": "-12h", "match_quality": "top-3"},
                "confidence": 72,
                "why": [f"{round(hrs)}h since posted", "No active invitations", "Suitable developers available"],
            })

    # Rule F: missed_opportunity_high_value (Wave 9.5 — Developer Brain hook)
    # Trigger: developer was recommended for 3+ high-value modules that
    # were taken by others; nudge the developer (notify only, no auto-action).
    if _developer_brain is not None:
        for d in devs:
            try:
                missed = await _developer_brain.detect_missed_opportunities(
                    _db, d.get("user_id"), threshold=3, min_price=500,
                )
            except Exception:
                continue
            if len(missed) >= 3:
                total_value = sum(int(m.get("price") or 0) for m in missed[:5])
                actions.append({
                    "id": f"missed_opportunity_high_value:{d.get('user_id')}",
                    "type": "missed_opportunity_high_value",
                    "severity": "medium",
                    "auto_eligible": True,
                    "auto_action": "notify_developer",
                    "title": f"{d.get('name', 'Developer')} missed {len(missed)} high-value modules",
                    "project": "—", "project_id": None,
                    "developer_id": d.get("user_id"),
                    "description": f"Suitable matches — total value ${total_value}",
                    "suggestion": "Nudge developer via notification",
                    "expected_impact": {"reactivation": "likely", "recovered_value": f"${total_value}"},
                    "confidence": 68,
                    "why": [
                        f"{len(missed)} high-value modules passed",
                        "Recommended but not picked up",
                        "Developer may need a visibility bump",
                    ],
                })

    # Rules G-J: Revenue Brain (Wave 10 — demand-side)
    # churn_risk (P1) · expansion_ready (P2) · retainer_ready (P3) · premium_upgrade_ready (P4)
    if _revenue_brain is not None:
        try:
            rev_actions = await _revenue_brain.detect_revenue_actions()
            actions.extend(rev_actions)
        except Exception as e:
            logger.error(f"revenue_brain actions failed: {e}")

    # Reserved hooks for later phases:
    # - Wave 10 Revenue Brain  (expansion / retainer / churn) — Phase 5
    # - Wave 11 Scaling Engine (underpriced / auto-balance) — Phase 6

    sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    actions.sort(key=lambda a: (sev_order.get(a["severity"], 4), -a.get("confidence", 0)))
    return actions


# ─────────────────────────────────────────────────────────────
# Execute + history
# ─────────────────────────────────────────────────────────────
async def _log_history(action: Dict[str, Any], result: Dict[str, Any], triggered_by: str) -> Dict[str, Any]:
    entry = {
        "history_id": _uid(),
        "type": action.get("type"),
        "title": action.get("title"),
        "project": action.get("project"),
        "project_id": action.get("project_id"),
        "module_id": action.get("module_id"),
        "invoice_id": action.get("invoice_id"),
        "severity": action.get("severity"),
        "confidence": action.get("confidence"),
        "auto_action": action.get("auto_action"),
        "suggestion": action.get("suggestion"),
        "result": result,
        "triggered_by": triggered_by,
        "created_at": _now().isoformat(),
    }
    await _db.operator_history.insert_one(entry)
    entry.pop("_id", None)
    return entry


async def _emit(event: str, payload: Dict[str, Any], role: str = "admin"):
    try:
        if _realtime is not None:
            await _realtime.emit_to_role(role, event, payload)
    except Exception as e:
        logger.warning(f"operator realtime emit failed: {e}")


async def _record_event(event_type: str, payload: Dict[str, Any]):
    try:
        if _event_engine and hasattr(_event_engine, "create_event"):
            ev = _event_engine.create_event(
                event_type=event_type,
                entity_type="operator",
                entity_id=payload.get("module_id") or payload.get("project_id") or "system",
                severity=payload.get("severity", "medium"),
                title=payload.get("title", "Operator action"),
                message=payload.get("description") or payload.get("suggestion") or event_type,
                project_id=payload.get("project_id"),
                meta=payload,
            )
            await _db.events.insert_one(ev)
    except Exception as e:
        logger.warning(f"operator event record failed: {e}")


async def execute_action(action: Dict[str, Any], triggered_by: str = "user") -> Dict[str, Any]:
    result: Dict[str, Any] = {"details": "No-op"}
    t = action.get("type")

    if t == "payment_risk":
        await _emit("operator:reminder_sent", {
            "project_id": action.get("project_id"),
            "invoice_id": action.get("invoice_id"),
            "title": action.get("title"),
            "triggered_by": triggered_by,
        }, role="admin")
        await _emit("invoice.reminder", {"invoice_id": action.get("invoice_id")}, role="client")
        await _record_event("operator.reminder_sent", {
            "project_id": action.get("project_id"),
            "invoice_id": action.get("invoice_id"),
            "severity": action.get("severity"),
        })
        result = {"details": "Payment reminder dispatched"}

    elif t == "invite_top_devs":
        # Wave 9 hook — delegate to flow_control (no duplication here)
        mid = action.get("module_id")
        if _flow_control is None or mid is None:
            result = {"details": "Flow Control not wired"}
        else:
            try:
                top = await _flow_control.recommend_top(mid, limit=3)
                dev_ids = [t["developer_id"] for t in top if t.get("developer_id")]
                if not dev_ids:
                    result = {"details": "No suitable developers found"}
                else:
                    inv_res = await _flow_control.invite_developers(
                        mid, dev_ids, invited_by=f"operator:{triggered_by}"
                    )
                    await _record_event("operator.invite_top_devs", {
                        "module_id": mid,
                        "project_id": action.get("project_id"),
                        "invited": dev_ids,
                        "title": action.get("title"),
                        "severity": action.get("severity"),
                    })
                    result = {"details": f"Invited {inv_res['count']} developer(s)", "invited": inv_res["invited"]}
            except Exception as e:
                logger.error(f"invite_top_devs execute error: {e}")
                result = {"details": f"Invite failed: {e}"}

    elif t == "missed_opportunity_high_value":
        # Wave 9.5 hook — notify the developer only (no data mutation)
        dev_id = action.get("developer_id")
        if dev_id:
            await _emit("developer.missed.alert", {
                "developer_id": dev_id,
                "count": action.get("description", ""),
                "triggered_by": triggered_by,
            }, role="admin")
            try:
                if _realtime is not None:
                    await _realtime.emit_to_user(dev_id, "developer.missed.alert", {
                        "title": action.get("title"),
                        "description": action.get("description"),
                    })
            except Exception:
                pass
            await _record_event("operator.missed_opportunity_alert", {
                "developer_id": dev_id,
                "severity": action.get("severity"),
                "title": action.get("title"),
            })
            result = {"details": f"Notified developer {dev_id[:8]}"}
        else:
            result = {"details": "No developer_id"}

    elif t in ("expansion_ready", "premium_upgrade_ready"):
        # Wave 10 — auto-generate opportunities across client's active projects
        if _revenue_brain is None:
            result = {"details": "Revenue Brain not wired"}
        else:
            cid = action.get("client_id")
            try:
                projs = await _db.projects.find(
                    {"client_id": cid, "status": {"$nin": ["completed", "cancelled"]}}, {"_id": 0},
                ).to_list(50)
                brain = await _revenue_brain.compute_client_brain(cid)
                created_total = 0
                if brain:
                    for p in projs:
                        created = await _revenue_brain.generate_opportunities_for_project(p, brain)
                        created_total += len(created)
                await _record_event(f"operator.{t}", {
                    "client_id": cid, "severity": action.get("severity"),
                    "created": created_total, "title": action.get("title"),
                })
                await _emit(f"revenue.{t}.generated", {
                    "client_id": cid, "created": created_total,
                    "triggered_by": triggered_by,
                }, role="admin")
                result = {"details": f"Generated {created_total} opportunity(ies)"}
            except Exception as e:
                logger.error(f"{t} execute error: {e}")
                result = {"details": f"Failed: {e}"}

    elif t == "retainer_ready":
        # Wave 10 — ensure retainer offer exists for the target project
        if _revenue_brain is None:
            result = {"details": "Revenue Brain not wired"}
        else:
            pid = action.get("project_id")
            cid = action.get("client_id")
            try:
                proj = await _db.projects.find_one({"project_id": pid}, {"_id": 0})
                brain = await _revenue_brain.compute_client_brain(cid) if cid else {}
                offer = None
                if proj and brain:
                    offer = await _revenue_brain.ensure_retainer_offer(proj, brain)
                await _record_event("operator.retainer_ready", {
                    "project_id": pid, "client_id": cid,
                    "offer_id": (offer or {}).get("offer_id"),
                    "severity": action.get("severity"),
                })
                await _emit("revenue.retainer.offered", {
                    "project_id": pid, "client_id": cid,
                    "offer_id": (offer or {}).get("offer_id"),
                    "triggered_by": triggered_by,
                }, role="admin")
                result = {"details": "Retainer offer ready" if offer else "No offer created (progress<80% or risky segment)"}
            except Exception as e:
                logger.error(f"retainer_ready execute error: {e}")
                result = {"details": f"Failed: {e}"}

    elif t == "churn_risk":
        # Wave 10 — notify admin only (no automated save-the-client action)
        cid = action.get("client_id")
        await _emit("revenue.churn.alert", {
            "client_id": cid, "title": action.get("title"),
            "severity": action.get("severity"),
            "triggered_by": triggered_by,
        }, role="admin")
        await _record_event("operator.churn_alert", {
            "client_id": cid, "severity": action.get("severity"),
            "title": action.get("title"),
        })
        result = {"details": "Admin notified — schedule personal outreach"}

    await _log_history(action, result, triggered_by)
    return result


# ─────────────────────────────────────────────────────────────
# Scheduler loop
# ─────────────────────────────────────────────────────────────
async def operator_scheduler_loop():
    await asyncio.sleep(10)
    logger.info("OPERATOR SCHEDULER: started (300s interval)")
    while True:
        try:
            if _db is None:
                await asyncio.sleep(10)
                continue
            admins_auto = await _db.users.find(
                {"role": "admin", "automation_level": "auto"}, {"_id": 0}
            ).to_list(100)
            if admins_auto:
                actions = await run_operator_scan()
                auto_actions = [a for a in actions if a.get("auto_eligible")]
                if auto_actions:
                    for a in auto_actions:
                        await execute_action(a, triggered_by="system")
                    await _emit("operator:auto_run", {
                        "count": len(auto_actions),
                        "actions": [a["title"] for a in auto_actions],
                        "by": "scheduler",
                    }, role="admin")
                    logger.info(f"OPERATOR SCHEDULER: executed {len(auto_actions)} auto actions")
                # Wave 11 — run scaling engines (visibility/price shaping)
                if _scaling_engine is not None:
                    try:
                        result = await _scaling_engine.run_all_engines()
                        logger.info(
                            f"OPERATOR SCHEDULER: scaling auto-balance done "
                            f"({result.get('duration_ms', 0)}ms, "
                            f"stuck_touched={result.get('stuck', {}).get('touched', 0)})"
                        )
                    except Exception as e:
                        logger.error(f"OPERATOR SCHEDULER: scaling failed {e}")
        except asyncio.CancelledError:
            logger.info("OPERATOR SCHEDULER: cancelled")
            raise
        except Exception as e:
            logger.error(f"OPERATOR SCHEDULER: error {e}")
        await asyncio.sleep(300)


# ─────────────────────────────────────────────────────────────
# Router factory — deps injected from server.py
# ─────────────────────────────────────────────────────────────
class AutomationLevelIn(BaseModel):
    level: str  # manual | assisted | auto


def build_router(*, admin_dep: Callable, user_dep: Callable) -> APIRouter:
    """
    Build APIRouter with proper FastAPI Depends bound to server.py's
    require_role('admin') and get_current_user.
    """
    r = APIRouter(tags=["operator"])

    @r.get("/feed")
    async def feed(admin=Depends(admin_dep)):
        actions = await run_operator_scan()
        auto_count = len([a for a in actions if a.get("auto_eligible")])
        critical_count = len([a for a in actions if a.get("severity") == "critical"])
        # Pull automation_level from DB (not from Pydantic User which drops extras)
        uid = getattr(admin, "user_id", None)
        level = "manual"
        if uid:
            u = await _db.users.find_one({"user_id": uid}, {"_id": 0, "automation_level": 1})
            level = (u or {}).get("automation_level") or "manual"
        return {
            "actions": actions,
            "total": len(actions),
            "auto_eligible": auto_count,
            "critical": critical_count,
            "system_status": "critical" if critical_count > 0 else "attention" if len(actions) > 3 else "healthy",
            "automation_level": level,
        }

    @r.post("/execute/{action_id}")
    async def execute(action_id: str, admin=Depends(admin_dep)):
        actions = await run_operator_scan()
        action = next((a for a in actions if a["id"] == action_id), None)
        if not action:
            return {"ok": False, "message": "Action expired — re-scan needed"}
        result = await execute_action(action, triggered_by="user")
        return {"ok": True, "action": action["title"], **result}

    @r.post("/auto-run")
    async def auto_run(admin=Depends(admin_dep)):
        uid = getattr(admin, "user_id", None)
        level = "manual"
        if uid:
            u = await _db.users.find_one({"user_id": uid}, {"_id": 0, "automation_level": 1})
            level = (u or {}).get("automation_level") or "manual"
        if level == "manual":
            raise HTTPException(403, "Auto execution disabled — set automation_level to 'assisted' or 'auto'")
        actions = await run_operator_scan()
        auto_actions = [a for a in actions if a.get("auto_eligible")]
        executed: List[Dict[str, Any]] = []
        for a in auto_actions:
            res = await execute_action(a, triggered_by="user" if level == "assisted" else "system")
            if res.get("details") and res["details"] != "No-op":
                executed.append({"title": a["title"], "result": res["details"]})
        if executed:
            await _emit("operator:auto_run", {
                "count": len(executed),
                "actions": [e["title"] for e in executed],
                "by": "user",
            }, role="admin")
        return {"executed": executed, "count": len(executed), "skipped": len(auto_actions) - len(executed), "level": level}

    @r.get("/history")
    async def history(limit: int = 100, admin=Depends(admin_dep)):
        items = await _db.operator_history.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
        groups: Dict[str, List[Dict[str, Any]]] = {}
        by_trigger = {"system": 0, "user": 0}
        for it in items:
            day = (it.get("created_at") or "")[:10]
            groups.setdefault(day, []).append(it)
            key = it.get("triggered_by", "user")
            by_trigger[key] = by_trigger.get(key, 0) + 1
        grouped = [{"date": d, "items": groups[d]} for d in sorted(groups.keys(), reverse=True)]
        return {"total": len(items), "by_trigger": by_trigger, "groups": grouped}

    @r.get("/automation")
    async def automation_get(user=Depends(user_dep)):
        uid = getattr(user, "user_id", None)
        level = "manual"
        if uid:
            u = await _db.users.find_one({"user_id": uid}, {"_id": 0, "automation_level": 1})
            level = (u or {}).get("automation_level") or "manual"
        return {"level": level}

    @r.post("/automation")
    async def automation_set(body: AutomationLevelIn, admin=Depends(admin_dep)):
        if body.level not in ("manual", "assisted", "auto"):
            raise HTTPException(400, "level must be manual | assisted | auto")
        uid = getattr(admin, "user_id", None)
        if uid:
            await _db.users.update_one({"user_id": uid}, {"$set": {"automation_level": body.level}})
        await _emit("operator:automation_changed", {"user_id": uid, "level": body.level}, role="admin")
        return {"level": body.level}

    return r
