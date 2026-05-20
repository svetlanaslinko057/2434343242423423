"""
Phase 11 — Work Execution Layer
================================

PROJECT → MODULE → TASK → ACTION

The layer where contracts become real work. Builds on existing `modules` /
`bids` / `users` collections without refactoring them.

New collections (tagged implicitly by shape, no migration needed):
  - tasks            — decomposition of modules into executable units
  - qa_reviews       — per-task review records (pass/fail + issues)
  - decisions        — client-side decisions (approve_task, request_changes)
  - task_events      — immutable audit log (start/complete/approve/fail)

Formulas enforced here:
  module.progress = Σ(task.done) / total_tasks
  dev.earned     = module.price × (completed_tasks_by_dev / total_tasks)
  efficiency     = estimated_hours / actual_hours
  qa_score       = passed_reviews / total_reviews

Constraints (MVP):
  - 1 active task per developer (no concurrent work)
  - On module assign → auto-create 4 default tasks keyed by template_type
  - task.complete → qa_review created in `pending` state
  - qa pass → task done; qa fail → task returns to todo + issues logged
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("work_execution")

_db = None
_get_current_user = None


def wire(*, db, get_current_user: Callable):
    global _db, _get_current_user
    _db = db
    _get_current_user = get_current_user


def _now():
    return datetime.now(timezone.utc)


def _iso():
    return _now().isoformat()


# ─────────────────────────────────────────────────────────────
# Task templates — 4 default tasks per module, keyed by template_type
# ─────────────────────────────────────────────────────────────
TASK_TEMPLATES = {
    "frontend": [
        ("Setup & scaffolding", "Create component structure, routing, styles", 0.15),
        ("Core UI implementation", "Build primary screens and interactions", 0.45),
        ("Responsive polish & states", "Loading / empty / error states + breakpoints", 0.20),
        ("QA & delivery", "Testing, bugfixes, handover", 0.20),
    ],
    "backend": [
        ("Setup & schema", "Project scaffold, models, migrations", 0.15),
        ("Core API implementation", "Endpoints, business logic, validation", 0.45),
        ("Tests & integration", "Unit/integration tests, CI", 0.20),
        ("Delivery & docs", "Deploy, API docs, handover", 0.20),
    ],
    "payments": [
        ("Environment & keys", "Sandbox setup, API keys, webhook configuration", 0.15),
        ("Payment flow integration", "Charges, refunds, webhooks", 0.50),
        ("Edge cases & retries", "Failed payments, retries, idempotency", 0.20),
        ("Testing & delivery", "E2E tests, deploy to prod", 0.15),
    ],
    "auth": [
        ("Setup providers", "OAuth/JWT provider configuration", 0.15),
        ("Auth flow implementation", "Login, register, session mgmt", 0.45),
        ("Security hardening", "Rate limits, 2FA, audit log", 0.25),
        ("Testing & delivery", "Security tests + handover", 0.15),
    ],
    "dashboard": [
        ("Data pipeline", "Queries, aggregations, caching", 0.30),
        ("Charts & visualization", "Graphs, filters, drill-down", 0.40),
        ("Realtime updates", "WebSocket/polling for live data", 0.15),
        ("QA & delivery", "Testing + docs", 0.15),
    ],
}

DEFAULT_TEMPLATE = [
    ("Setup project", "Initial configuration and scaffolding", 0.15),
    ("Core implementation", "Main feature development", 0.50),
    ("Testing", "Unit, integration, manual QA", 0.20),
    ("Final delivery", "Polish, docs, handover", 0.15),
]


async def auto_create_tasks_for_module(module_id: str) -> int:
    """Called from assign_module hook. Idempotent — skips if tasks exist."""
    existing = await _db.tasks.count_documents({"module_id": module_id})
    if existing > 0:
        return 0
    module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
    if not module:
        return 0
    dev_id = module.get("assigned_to")
    total_hours = int(module.get("estimated_hours") or 16)
    template_type = (module.get("template_type") or "").lower()
    template = TASK_TEMPLATES.get(template_type, DEFAULT_TEMPLATE)
    now_iso = _iso()
    created = 0
    for i, (title, description, share) in enumerate(template):
        await _db.tasks.insert_one({
            "task_id": f"task_{uuid.uuid4().hex[:12]}",
            "module_id": module_id,
            "project_id": module.get("project_id"),
            "assigned_to": dev_id,
            "title": title,
            "description": description,
            "status": "todo",
            "priority": "medium" if i in (1,) else "low",
            "order": i,
            "share": share,  # fraction of module price
            "estimated_hours": max(1, int(round(total_hours * share))),
            "spent_hours": 0,
            "started_at": None,
            "completed_at": None,
            "created_at": now_iso,
            "updated_at": now_iso,
        })
        created += 1
    logger.info(f"TASKS auto-created: {created} for module {module_id[-6:]} (template={template_type or 'default'})")
    return created


# ─────────────────────────────────────────────────────────────
# Formulas
# ─────────────────────────────────────────────────────────────
async def compute_module_progress(module_id: str) -> Dict:
    tasks = await _db.tasks.find({"module_id": module_id}, {"_id": 0}).to_list(200)
    if not tasks:
        return {"progress": 0.0, "total": 0, "done": 0, "in_progress": 0, "review": 0, "todo": 0}
    by_status = {"todo": 0, "in_progress": 0, "review": 0, "done": 0}
    for t in tasks:
        by_status[t.get("status", "todo")] = by_status.get(t.get("status", "todo"), 0) + 1
    total = len(tasks)
    progress = by_status["done"] / total if total else 0.0
    return {
        "progress": round(progress, 3),
        "total": total,
        **by_status,
    }


async def compute_dev_earned(dev_id: str, module_id: str) -> float:
    module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
    if not module:
        return 0.0
    price = float(module.get("accepted_price") or module.get("final_price") or module.get("price") or 0)
    tasks = await _db.tasks.find({"module_id": module_id, "assigned_to": dev_id}, {"_id": 0}).to_list(200)
    total = await _db.tasks.count_documents({"module_id": module_id})
    if not tasks or total == 0:
        return 0.0
    # Weighted by task.share (more accurate than equal split)
    done_share = sum(t.get("share", 1.0/total) for t in tasks if t.get("status") == "done")
    return round(price * done_share, 2)


# ─────────────────────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────────────────────
class TaskCompleteRequest(BaseModel):
    spent_hours: Optional[float] = None
    message: Optional[str] = ""


class QAPassRequest(BaseModel):
    feedback: Optional[str] = ""


class QAFailRequest(BaseModel):
    feedback: str
    issues: Optional[List[str]] = []
    severity: Optional[str] = "medium"


class ChangeRequestCreate(BaseModel):
    type: str  # scope | price | deadline
    title: str
    description: Optional[str] = ""
    price_delta: Optional[float] = 0
    time_delta_days: Optional[int] = 0


# ─────────────────────────────────────────────────────────────
# Router
# ─────────────────────────────────────────────────────────────
def build_router() -> APIRouter:
    r = APIRouter(tags=["work-execution"])

    # ─────────── DEVELOPER WORKSPACE ───────────
    # ⚠️ LEGACY — DO NOT USE IN NEW UI
    # Canonical developer aggregator is GET /api/dev/work (backend/dev_work.py).
    # Kept only for backward compatibility with pre-Block-10 screens.
    # Any new UI (web or mobile) MUST consume /api/dev/work.
    @r.get("/dev/workspace", deprecated=True)
    async def dev_workspace(user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        logger.warning("LEGACY ENDPOINT CALLED: /api/dev/workspace (user=%s) — use /api/dev/work", uid)
        # Active modules assigned to dev
        active_modules = await _db.modules.find(
            {"assigned_to": uid, "status": {"$in": ["in_progress", "review", "qa_review"]}},
            {"_id": 0, "module_id": 1, "title": 1, "status": 1, "accepted_price": 1, "final_price": 1, "price": 1, "estimated_hours": 1, "project_id": 1, "started_at": 1},
        ).to_list(50)

        # Enrich with progress + earned per module
        enriched = []
        total_earned_week = 0.0
        for m in active_modules:
            prog = await compute_module_progress(m["module_id"])
            earned = await compute_dev_earned(uid, m["module_id"])
            price = float(m.get("accepted_price") or m.get("final_price") or m.get("price") or 0)
            enriched.append({
                **m,
                "price": price,
                "progress": prog["progress"],
                "tasks_total": prog["total"],
                "tasks_done": prog["done"],
                "tasks_in_progress": prog["in_progress"],
                "tasks_review": prog["review"],
                "earned": earned,
                "pending": round(price - earned, 2),
            })
            total_earned_week += earned

        # Current active task (1-active-task constraint)
        active_task = await _db.tasks.find_one(
            {"assigned_to": uid, "status": "in_progress"}, {"_id": 0}
        )
        # Load (capacity)
        user_doc = await _db.users.find_one({"user_id": uid}, {"_id": 0}) or {}
        capacity_max = int(user_doc.get("capacity") or 5)
        load_state = "idle" if len(active_modules) == 0 else ("overloaded" if len(active_modules) > capacity_max else "balanced")

        # Recent activity
        events = await _db.task_events.find(
            {"actor_id": uid}, {"_id": 0}
        ).sort("created_at", -1).to_list(10)

        # Payouts summary (closed modules — real money)
        payouts = await _db.payouts.find(
            {"developer_id": uid}, {"_id": 0}
        ).sort("created_at", -1).to_list(50)
        payouts_totals = {
            "pending": round(sum(p["amount"] for p in payouts if p["status"] == "pending"), 2),
            "approved": round(sum(p["amount"] for p in payouts if p["status"] == "approved"), 2),
            "paid": round(sum(p["amount"] for p in payouts if p["status"] == "paid"), 2),
        }

        return {
            "active_modules": enriched,
            "active_modules_count": len(enriched),
            "active_task": active_task,
            "load": {
                "active": len(enriched),
                "max": capacity_max,
                "state": load_state,
            },
            "earnings": {
                "current_pending": round(total_earned_week, 2),
                "this_week": round(total_earned_week, 2),  # MVP — same bucket
            },
            "payouts": payouts[:5],
            "payouts_totals": payouts_totals,
            "recent_activity": events,
        }

    @r.get("/dev/tasks")
    async def dev_tasks(module_id: Optional[str] = None, user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        query: Dict = {"assigned_to": uid}
        if module_id:
            query["module_id"] = module_id
        items = await _db.tasks.find(query, {"_id": 0}).sort([("module_id", 1), ("order", 1)]).to_list(500)
        return {"tasks": items, "count": len(items)}

    @r.post("/dev/tasks/{task_id}/start")
    async def start_task(task_id: str, user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        task = await _db.tasks.find_one({"task_id": task_id}, {"_id": 0})
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        if task["assigned_to"] != uid:
            raise HTTPException(status_code=403, detail="Not your task")
        if task["status"] != "todo":
            raise HTTPException(status_code=409, detail=f"Task already {task['status']}")

        # Enforce 1 active task
        other = await _db.tasks.find_one({"assigned_to": uid, "status": "in_progress"}, {"_id": 0})
        if other:
            raise HTTPException(
                status_code=409,
                detail=f"Finish active task first: '{other['title']}' ({other['task_id']})",
            )

        now = _now()
        await _db.tasks.update_one(
            {"task_id": task_id},
            {"$set": {"status": "in_progress", "started_at": now.isoformat(), "updated_at": now.isoformat()}},
        )
        await _db.task_events.insert_one({
            "event_id": f"evt_{uuid.uuid4().hex[:12]}",
            "task_id": task_id,
            "module_id": task["module_id"],
            "actor_id": uid,
            "event_type": "task.started",
            "created_at": now.isoformat(),
        })
        logger.info(f"TASK start: {task_id[-6:]} by {uid[-6:]}")
        return {"ok": True, "task_id": task_id, "status": "in_progress"}

    @r.post("/dev/tasks/{task_id}/complete")
    async def complete_task(task_id: str, req: TaskCompleteRequest, user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        task = await _db.tasks.find_one({"task_id": task_id}, {"_id": 0})
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        if task["assigned_to"] != uid:
            raise HTTPException(status_code=403, detail="Not your task")
        if task["status"] != "in_progress":
            raise HTTPException(status_code=409, detail=f"Task must be in_progress (now: {task['status']})")

        now = _now()
        # Compute spent_hours if not provided
        spent = req.spent_hours
        if spent is None and task.get("started_at"):
            try:
                started = datetime.fromisoformat(task["started_at"])
                if started.tzinfo is None:
                    started = started.replace(tzinfo=timezone.utc)
                spent = round((now - started).total_seconds() / 3600.0, 2)
            except Exception:
                spent = 0

        await _db.tasks.update_one(
            {"task_id": task_id},
            {"$set": {
                "status": "review",
                "completed_at": now.isoformat(),
                "updated_at": now.isoformat(),
                "spent_hours": spent or 0,
                "completion_message": req.message or "",
            }},
        )
        # Create QA review record
        module = await _db.modules.find_one({"module_id": task["module_id"]}, {"_id": 0})
        project = await _db.projects.find_one({"project_id": task.get("project_id")}, {"_id": 0}) if task.get("project_id") else None
        client_id = (project or {}).get("client_id")
        qa_id = f"qa_{uuid.uuid4().hex[:12]}"
        await _db.qa_reviews.insert_one({
            "qa_review_id": qa_id,
            "task_id": task_id,
            "module_id": task["module_id"],
            "project_id": task.get("project_id"),
            "client_id": client_id,
            "developer_id": uid,
            "status": "pending",
            "feedback": "",
            "issues": [],
            "created_at": now.isoformat(),
        })
        await _db.task_events.insert_one({
            "event_id": f"evt_{uuid.uuid4().hex[:12]}",
            "task_id": task_id,
            "module_id": task["module_id"],
            "actor_id": uid,
            "event_type": "task.completed",
            "created_at": now.isoformat(),
        })
        logger.info(f"TASK complete: {task_id[-6:]} → review (qa {qa_id[-6:]}) by {uid[-6:]} spent={spent}h")
        return {"ok": True, "task_id": task_id, "status": "review", "qa_review_id": qa_id, "spent_hours": spent}

    # ─────────── QA REVIEWS (client / admin) ───────────
    @r.get("/qa/reviews")
    async def qa_reviews_list(scope: str = "mine", user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        role = user.role if hasattr(user, "role") else user.get("role")
        query: Dict = {"status": "pending"}
        if scope == "mine":
            if role == "client":
                query["client_id"] = uid
            # admin sees all
        items = await _db.qa_reviews.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
        # Enrich with task + module info
        for it in items:
            t = await _db.tasks.find_one({"task_id": it["task_id"]}, {"_id": 0, "title": 1, "description": 1, "spent_hours": 1, "estimated_hours": 1, "completion_message": 1})
            m = await _db.modules.find_one({"module_id": it["module_id"]}, {"_id": 0, "title": 1, "accepted_price": 1, "price": 1})
            d = await _db.users.find_one({"user_id": it["developer_id"]}, {"_id": 0, "name": 1, "rating": 1})
            it["task"] = t or {}
            it["module"] = m or {}
            it["developer"] = d or {}
        return {"reviews": items, "count": len(items)}

    @r.post("/qa/reviews/{qa_review_id}/pass")
    async def qa_pass(qa_review_id: str, req: QAPassRequest, user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        role = user.role if hasattr(user, "role") else user.get("role")
        qa = await _db.qa_reviews.find_one({"qa_review_id": qa_review_id}, {"_id": 0})
        if not qa:
            raise HTTPException(status_code=404, detail="QA review not found")
        if role != "admin" and qa.get("client_id") != uid:
            raise HTTPException(status_code=403, detail="Not your review")
        if qa["status"] != "pending":
            raise HTTPException(status_code=409, detail=f"Already {qa['status']}")
        now = _now()
        await _db.qa_reviews.update_one(
            {"qa_review_id": qa_review_id},
            {"$set": {"status": "passed", "feedback": req.feedback or "", "reviewer_id": uid, "resolved_at": now.isoformat()}},
        )
        await _db.tasks.update_one(
            {"task_id": qa["task_id"]},
            {"$set": {"status": "done", "updated_at": now.isoformat()}},
        )
        await _db.task_events.insert_one({
            "event_id": f"evt_{uuid.uuid4().hex[:12]}",
            "task_id": qa["task_id"],
            "module_id": qa["module_id"],
            "actor_id": uid,
            "event_type": "task.approved",
            "created_at": now.isoformat(),
        })
        # Check module completion
        prog = await compute_module_progress(qa["module_id"])
        payout_id = None
        if prog["total"] > 0 and prog["done"] == prog["total"]:
            module = await _db.modules.find_one({"module_id": qa["module_id"]}, {"_id": 0})
            await _db.modules.update_one(
                {"module_id": qa["module_id"]},
                {"$set": {"status": "done", "completed_at": now.isoformat()}},
            )
            # ✨ PAYOUT — module fully done, settle money owed to dev
            module_price = float((module or {}).get("accepted_price") or (module or {}).get("final_price") or (module or {}).get("price") or 0)
            earned_total = await compute_dev_earned(qa["developer_id"], qa["module_id"])
            payout_id = f"pay_{uuid.uuid4().hex[:12]}"
            await _db.payouts.insert_one({
                "payout_id": payout_id,
                "developer_id": qa["developer_id"],
                "module_id": qa["module_id"],
                "project_id": qa.get("project_id"),
                "client_id": qa.get("client_id"),
                "amount": round(earned_total, 2),
                "module_price": round(module_price, 2),
                "status": "pending",
                "created_at": now.isoformat(),
                "approved_at": None,
                "paid_at": None,
                "approved_by": None,
                "paid_by": None,
            })
            await _db.task_events.insert_one({
                "event_id": f"evt_{uuid.uuid4().hex[:12]}",
                "task_id": qa["task_id"],
                "module_id": qa["module_id"],
                "actor_id": uid,
                "event_type": "module.completed",
                "metadata": {"payout_id": payout_id, "amount": earned_total},
                "created_at": now.isoformat(),
            })
            logger.info(f"MODULE done: {qa['module_id'][-6:]} → PAYOUT {payout_id[-6:]} ${earned_total}")
        earned = await compute_dev_earned(qa["developer_id"], qa["module_id"])
        logger.info(f"QA pass: {qa_review_id[-6:]} → task done, earned={earned}")
        return {"ok": True, "status": "passed", "module_progress": prog, "dev_earned": earned, "payout_id": payout_id}

    @r.post("/qa/reviews/{qa_review_id}/fail")
    async def qa_fail(qa_review_id: str, req: QAFailRequest, user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        role = user.role if hasattr(user, "role") else user.get("role")
        qa = await _db.qa_reviews.find_one({"qa_review_id": qa_review_id}, {"_id": 0})
        if not qa:
            raise HTTPException(status_code=404, detail="QA review not found")
        if role != "admin" and qa.get("client_id") != uid:
            raise HTTPException(status_code=403, detail="Not your review")
        if qa["status"] != "pending":
            raise HTTPException(status_code=409, detail=f"Already {qa['status']}")
        now = _now()
        issues = [
            {"issue_id": f"iss_{uuid.uuid4().hex[:8]}", "title": t, "severity": req.severity or "medium", "status": "open"}
            for t in (req.issues or [])
        ]
        await _db.qa_reviews.update_one(
            {"qa_review_id": qa_review_id},
            {"$set": {
                "status": "failed",
                "feedback": req.feedback,
                "issues": issues,
                "reviewer_id": uid,
                "resolved_at": now.isoformat(),
            }},
        )
        # Task back to todo
        await _db.tasks.update_one(
            {"task_id": qa["task_id"]},
            {"$set": {"status": "todo", "updated_at": now.isoformat(), "last_review_feedback": req.feedback}},
        )
        await _db.task_events.insert_one({
            "event_id": f"evt_{uuid.uuid4().hex[:12]}",
            "task_id": qa["task_id"],
            "module_id": qa["module_id"],
            "actor_id": uid,
            "event_type": "task.rejected",
            "metadata": {"issues": len(issues), "severity": req.severity},
            "created_at": now.isoformat(),
        })
        logger.info(f"QA fail: {qa_review_id[-6:]} → task back to todo, {len(issues)} issues")
        return {"ok": True, "status": "failed", "issues_count": len(issues)}

    # ─────────── Quick module view (for dev workspace) ───────────
    @r.get("/modules/{module_id}/tasks")
    async def module_tasks(module_id: str, user=Depends(_get_current_user)):
        tasks = await _db.tasks.find({"module_id": module_id}, {"_id": 0}).sort("order", 1).to_list(200)
        prog = await compute_module_progress(module_id)
        return {"tasks": tasks, "progress": prog}

    # ─────────── PAYOUTS (module.done → settlement) ───────────
    @r.get("/dev/payouts")
    async def dev_payouts(user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        items = await _db.payouts.find(
            {"developer_id": uid}, {"_id": 0}
        ).sort("created_at", -1).to_list(200)
        # Enrich with module title
        for p in items:
            m = await _db.modules.find_one({"module_id": p["module_id"]}, {"_id": 0, "title": 1})
            p["module_title"] = (m or {}).get("title") or p["module_id"]
        totals = {
            "pending": sum(p["amount"] for p in items if p["status"] == "pending"),
            "approved": sum(p["amount"] for p in items if p["status"] == "approved"),
            "paid": sum(p["amount"] for p in items if p["status"] == "paid"),
        }
        return {"payouts": items, "count": len(items), "totals": totals}

    @r.get("/admin/payouts")
    async def admin_payouts(status: Optional[str] = None, user=Depends(_get_current_user)):
        role = user.role if hasattr(user, "role") else user.get("role")
        if role != "admin":
            raise HTTPException(status_code=403, detail="Admin only")
        query: Dict = {}
        if status:
            query["status"] = status
        items = await _db.payouts.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
        for p in items:
            m = await _db.modules.find_one({"module_id": p["module_id"]}, {"_id": 0, "title": 1})
            d = await _db.users.find_one({"user_id": p["developer_id"]}, {"_id": 0, "name": 1, "email": 1})
            p["module_title"] = (m or {}).get("title")
            p["developer"] = d or {}
        return {"payouts": items, "count": len(items)}

    @r.post("/admin/payouts/{payout_id}/approve")
    async def payout_approve(payout_id: str, user=Depends(_get_current_user)):
        role = user.role if hasattr(user, "role") else user.get("role")
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        if role != "admin":
            raise HTTPException(status_code=403, detail="Admin only")
        p = await _db.payouts.find_one({"payout_id": payout_id}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Payout not found")
        if p["status"] != "pending":
            raise HTTPException(status_code=409, detail=f"Already {p['status']}")

        # 🛡️ Block 7.0 — Profit protection: server-side over-budget lock
        # If approving this payout would push (earned + this payout) beyond the
        # module's planned cost, refuse. Pause or rebalance first.
        module = await _db.modules.find_one({"module_id": p["module_id"]}, {"_id": 0})
        if module:
            # 🛡️ Block 8.1 — Project-level lock: if ANY module in the same
            # project is over budget, the whole project is locked.
            # Same rule as /api/client/operator computes `risk_state == blocked`.
            pid = module.get("project_id")
            if pid:
                sibling_mods = await _db.modules.find(
                    {"project_id": pid}, {"_id": 0, "module_id": 1, "status": 1,
                                          "base_price": 1, "final_price": 1, "price": 1, "paused_by": 1},
                ).to_list(500)
                sib_ids = [m["module_id"] for m in sibling_mods]
                sib_payouts = await _db.payouts.find(
                    {"module_id": {"$in": sib_ids},
                     "status": {"$in": ["approved", "paid"]}},
                    {"_id": 0, "module_id": 1, "amount": 1},
                ).to_list(5000)
                earned_per_mod: Dict[str, float] = {}
                for po in sib_payouts:
                    mid = po.get("module_id")
                    earned_per_mod[mid] = earned_per_mod.get(mid, 0.0) + float(po.get("amount") or 0)
                project_over = False
                project_paused_by_system = False
                for sm in sibling_mods:
                    cap = float(sm.get("base_price") or sm.get("final_price") or sm.get("price") or 0)
                    if cap > 0 and earned_per_mod.get(sm["module_id"], 0.0) > cap:
                        project_over = True
                    if sm.get("status") == "paused" and sm.get("paused_by") == "guardian":
                        project_paused_by_system = True
                if project_over or project_paused_by_system:
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "ok": False,
                            "error": "PROJECT_LOCK",
                            "message": "Project-level lock active — other modules are over budget or paused by system",
                            "project_id": pid,
                            "project_over_budget": project_over,
                            "project_paused_by_system": project_paused_by_system,
                        },
                    )

            cost_cap = float(module.get("base_price") or module.get("final_price")
                              or module.get("price") or 0)
            if cost_cap > 0:
                agg = await _db.payouts.find(
                    {"module_id": p["module_id"],
                     "status": {"$in": ["approved", "paid"]}},
                    {"_id": 0, "amount": 1},
                ).to_list(5000)
                earned = sum(float(a.get("amount") or 0) for a in agg)
                would_be = earned + float(p.get("amount") or 0)
                if earned > cost_cap or would_be > cost_cap:
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "ok": False,
                            "error": "OVER_BUDGET_LOCK",
                            "message": "Payout approval is blocked to protect profit",
                            "module_id": p["module_id"],
                            "cost_cap": round(cost_cap, 2),
                            "earned": round(earned, 2),
                            "this_payout": round(float(p.get("amount") or 0), 2),
                        },
                    )
            # Also block if module is paused
            if module.get("status") == "paused":
                raise HTTPException(
                    status_code=409,
                    detail={
                        "ok": False,
                        "error": "MODULE_PAUSED",
                        "message": "Module is paused — unpause before approving payouts",
                        "module_id": p["module_id"],
                    },
                )

        now = _now()
        await _db.payouts.update_one(
            {"payout_id": payout_id},
            {"$set": {"status": "approved", "approved_at": now.isoformat(), "approved_by": uid}},
        )
        logger.info(f"PAYOUT approve: {payout_id[-6:]} ${p['amount']}")
        return {"ok": True, "status": "approved"}

    @r.post("/admin/payouts/{payout_id}/mark-paid")
    async def payout_mark_paid(payout_id: str, user=Depends(_get_current_user)):
        role = user.role if hasattr(user, "role") else user.get("role")
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        if role != "admin":
            raise HTTPException(status_code=403, detail="Admin only")
        p = await _db.payouts.find_one({"payout_id": payout_id}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Payout not found")
        if p["status"] not in ("pending", "approved"):
            raise HTTPException(status_code=409, detail=f"Already {p['status']}")
        now = _now()
        await _db.payouts.update_one(
            {"payout_id": payout_id},
            {"$set": {"status": "paid", "paid_at": now.isoformat(), "paid_by": uid,
                      **({"approved_at": now.isoformat(), "approved_by": uid} if p["status"] == "pending" else {})}},
        )
        # Mirror into earnings collection for truth/compat
        await _db.earnings.insert_one({
            "earning_id": f"earn_{uuid.uuid4().hex[:12]}",
            "developer_id": p["developer_id"],
            "module_id": p["module_id"],
            "payout_id": payout_id,
            "amount": p["amount"],
            "status": "paid",
            "created_at": now.isoformat(),
        })
        logger.info(f"PAYOUT paid: {payout_id[-6:]} ${p['amount']} → dev {p['developer_id'][-6:]}")
        return {"ok": True, "status": "paid"}

    # ═══════════════════════════════════════════════════════════
    # BLOCK 2 — CLIENT CONTROL LAYER
    # ═══════════════════════════════════════════════════════════

    # ─────────── Client unified workspace (the control screen) ───────────
    # ⚠️ LEGACY — DO NOT USE IN NEW UI
    # Canonical client aggregator is GET /api/client/project/{project_id}/workspace
    # (backend/client_workspace.py). It is project-scoped, single source of truth,
    # and is what both the Web Platform and the Expo mobile app must consume.
    # Kept only for backward compatibility with pre-Block-9 screens.
    @r.get("/client/workspace", deprecated=True)
    async def client_workspace(user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        logger.warning("LEGACY ENDPOINT CALLED: /api/client/workspace (user=%s) — use /api/client/project/{id}/workspace", uid)

        # A. Active modules (owned projects only)
        projects = await _db.projects.find({"client_id": uid}, {"_id": 0, "project_id": 1, "name": 1}).to_list(200)
        project_ids = [p["project_id"] for p in projects]
        active_modules = await _db.modules.find(
            {"project_id": {"$in": project_ids}, "status": {"$in": ["in_progress", "review", "qa_review", "paused"]}},
            {"_id": 0},
        ).to_list(200)
        for m in active_modules:
            prog = await compute_module_progress(m["module_id"])
            m["progress"] = prog["progress"]
            m["tasks_done"] = prog["done"]
            m["tasks_total"] = prog["total"]
            dev = await _db.users.find_one({"user_id": m.get("assigned_to")}, {"_id": 0, "name": 1}) if m.get("assigned_to") else None
            m["dev_name"] = (dev or {}).get("name")

        # B. Pending decisions (unified feed)
        qa_pending = await _db.qa_reviews.find({"client_id": uid, "status": "pending"}, {"_id": 0}).to_list(100)
        for q in qa_pending:
            t = await _db.tasks.find_one({"task_id": q["task_id"]}, {"_id": 0, "title": 1, "spent_hours": 1})
            mod = await _db.modules.find_one({"module_id": q["module_id"]}, {"_id": 0, "title": 1})
            dev = await _db.users.find_one({"user_id": q["developer_id"]}, {"_id": 0, "name": 1})
            q["task"] = t or {}
            q["module_title"] = (mod or {}).get("title")
            q["developer_name"] = (dev or {}).get("name")

        assign_recs = await _db.recommended_decisions.find({"client_id": uid, "status": "pending"}, {"_id": 0}).to_list(100)
        for a in assign_recs:
            mod = await _db.modules.find_one({"module_id": a["module_id"]}, {"_id": 0, "title": 1})
            a["module_title"] = (mod or {}).get("title")

        change_reqs = await _db.change_requests.find(
            {"client_id": uid, "status": "pending"}, {"_id": 0}
        ).to_list(100)
        for c in change_reqs:
            mod = await _db.modules.find_one({"module_id": c["module_id"]}, {"_id": 0, "title": 1})
            c["module_title"] = (mod or {}).get("title")

        decisions: List[Dict] = []
        for q in qa_pending:
            decisions.append({
                "decision_type": "qa_review",
                "id": q["qa_review_id"],
                "module_id": q["module_id"],
                "module_title": q.get("module_title"),
                "title": f"Approve: {q['task'].get('title', 'Task')}",
                "subtitle": f"Submitted by {q.get('developer_name') or 'developer'}",
                "created_at": q.get("created_at"),
                "primary_cta": "Approve",
                "secondary_cta": "Reject",
            })
        for a in assign_recs:
            decisions.append({
                "decision_type": "assignment",
                "id": a["recommendation_id"],
                "module_id": a["module_id"],
                "module_title": a.get("module_title"),
                "title": f"Assign: {a.get('suggested_developer_name') or 'developer'}",
                "subtitle": f"${a.get('suggested_price')} · {a.get('suggested_days','?')}d · {a.get('rationale','')}",
                "created_at": a.get("created_at"),
                "primary_cta": "Accept",
                "secondary_cta": "Dismiss",
            })
        for c in change_reqs:
            decisions.append({
                "decision_type": "change_request",
                "id": c["change_request_id"],
                "module_id": c["module_id"],
                "module_title": c.get("module_title"),
                "title": f"{c.get('type','scope').upper()} change: {c.get('title')}",
                "subtitle": f"{'+$' + str(c.get('price_delta') or 0) if (c.get('price_delta') or 0) else ''}{' · +' + str(c.get('time_delta_days') or 0) + 'd' if (c.get('time_delta_days') or 0) else ''} · by dev",
                "created_at": c.get("created_at"),
                "primary_cta": "Accept",
                "secondary_cta": "Reject",
            })
        # Sort newest first
        decisions.sort(key=lambda d: d.get("created_at") or "", reverse=True)

        # C. Financial snapshot
        paid_cur = _db.payouts.aggregate([
            {"$match": {"client_id": uid, "status": {"$in": ["paid", "approved"]}}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
        ])
        paid_list = await paid_cur.to_list(1)
        total_paid = float(paid_list[0]["total"]) if paid_list else 0.0
        committed = sum(
            float(m.get("accepted_price") or m.get("final_price") or m.get("price") or 0)
            for m in active_modules
        )
        active_spend = committed

        # D. Recent activity (events on client's modules)
        module_ids = [m["module_id"] for m in active_modules]
        events = await _db.task_events.find(
            {"module_id": {"$in": module_ids}}, {"_id": 0}
        ).sort("created_at", -1).to_list(15)

        return {
            "active_modules": active_modules,
            "active_modules_count": len(active_modules),
            "pending_decisions": decisions,
            "pending_decisions_count": len(decisions),
            "financial": {
                "total_committed": round(committed, 2),
                "total_paid": round(total_paid, 2),
                "active_spend": round(active_spend, 2),
            },
            "recent_activity": events,
        }

    # ─────────── Change Requests ───────────
    @r.post("/modules/{module_id}/change-request")
    async def create_change_request(module_id: str, req: ChangeRequestCreate, user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not module:
            raise HTTPException(status_code=404, detail="Module not found")
        project = await _db.projects.find_one({"project_id": module.get("project_id")}, {"_id": 0})
        client_id = (project or {}).get("client_id")
        cr_id = f"cr_{uuid.uuid4().hex[:12]}"
        now = _now()
        doc = {
            "change_request_id": cr_id,
            "module_id": module_id,
            "project_id": module.get("project_id"),
            "client_id": client_id,
            "created_by": uid,
            "type": req.type if req.type in ("scope", "price", "deadline") else "scope",
            "title": req.title,
            "description": req.description or "",
            "price_delta": float(req.price_delta or 0),
            "time_delta_days": int(req.time_delta_days or 0),
            "status": "pending",
            "created_at": now.isoformat(),
        }
        await _db.change_requests.insert_one(doc)
        logger.info(f"CR created: {cr_id[-6:]} module={module_id[-6:]} type={doc['type']} +${doc['price_delta']} +{doc['time_delta_days']}d")
        return {"ok": True, "change_request_id": cr_id, "status": "pending"}

    @r.get("/modules/{module_id}/change-requests")
    async def list_change_requests(module_id: str, user=Depends(_get_current_user)):
        items = await _db.change_requests.find(
            {"module_id": module_id}, {"_id": 0}
        ).sort("created_at", -1).to_list(100)
        return {"change_requests": items, "count": len(items)}

    @r.post("/change-requests/{cr_id}/accept")
    async def accept_change_request(cr_id: str, user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        role = user.role if hasattr(user, "role") else user.get("role")
        cr = await _db.change_requests.find_one({"change_request_id": cr_id}, {"_id": 0})
        if not cr:
            raise HTTPException(status_code=404, detail="Change request not found")
        if cr["status"] != "pending":
            raise HTTPException(status_code=409, detail=f"Already {cr['status']}")
        # Either dev (assigned_to) or client can accept; typically dev accepts, client may too for scope
        module = await _db.modules.find_one({"module_id": cr["module_id"]}, {"_id": 0})
        if not module:
            raise HTTPException(status_code=404, detail="Module not found")
        if role != "admin" and uid not in (module.get("assigned_to"), cr.get("client_id")):
            raise HTTPException(status_code=403, detail="Not authorized")
        now = _now()
        new_price = float(module.get("accepted_price") or module.get("final_price") or module.get("price") or 0) + float(cr.get("price_delta") or 0)
        new_hours = int(module.get("estimated_hours") or 0) + int((cr.get("time_delta_days") or 0)) * 8
        await _db.modules.update_one(
            {"module_id": cr["module_id"]},
            {"$set": {
                "accepted_price": new_price,
                "final_price": new_price,
                "estimated_hours": new_hours,
                "last_change_at": now.isoformat(),
            }},
        )
        await _db.change_requests.update_one(
            {"change_request_id": cr_id},
            {"$set": {"status": "accepted", "resolved_at": now.isoformat(), "resolved_by": uid}},
        )
        await _db.task_events.insert_one({
            "event_id": f"evt_{uuid.uuid4().hex[:12]}",
            "module_id": cr["module_id"],
            "actor_id": uid,
            "event_type": "change_request.accepted",
            "metadata": {"change_request_id": cr_id, "price_delta": cr.get("price_delta"), "time_delta_days": cr.get("time_delta_days")},
            "created_at": now.isoformat(),
        })
        logger.info(f"CR accepted: {cr_id[-6:]} → module price={new_price}, hours={new_hours}")
        return {"ok": True, "status": "accepted", "new_price": new_price, "new_hours": new_hours}

    @r.post("/change-requests/{cr_id}/reject")
    async def reject_change_request(cr_id: str, user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        cr = await _db.change_requests.find_one({"change_request_id": cr_id}, {"_id": 0})
        if not cr:
            raise HTTPException(status_code=404, detail="Change request not found")
        if cr["status"] != "pending":
            raise HTTPException(status_code=409, detail=f"Already {cr['status']}")
        await _db.change_requests.update_one(
            {"change_request_id": cr_id},
            {"$set": {"status": "rejected", "resolved_at": _iso(), "resolved_by": uid}},
        )
        logger.info(f"CR rejected: {cr_id[-6:]}")
        return {"ok": True, "status": "rejected"}

    # ─────────── Kill / Pause ───────────
    @r.post("/modules/{module_id}/pause")
    async def pause_module(module_id: str, user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        role = user.role if hasattr(user, "role") else user.get("role")
        module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not module:
            raise HTTPException(status_code=404, detail="Module not found")
        project = await _db.projects.find_one({"project_id": module.get("project_id")}, {"_id": 0})
        if role != "admin" and (project or {}).get("client_id") != uid:
            raise HTTPException(status_code=403, detail="Only project client or admin")
        if module["status"] not in ("in_progress", "review", "qa_review"):
            raise HTTPException(status_code=409, detail=f"Cannot pause status={module['status']}")
        now = _now()
        await _db.modules.update_one(
            {"module_id": module_id},
            {"$set": {"status": "paused", "paused_at": now.isoformat(), "paused_by": uid, "prev_status": module["status"]}},
        )
        await _db.task_events.insert_one({
            "event_id": f"evt_{uuid.uuid4().hex[:12]}",
            "module_id": module_id,
            "actor_id": uid,
            "event_type": "module.paused",
            "created_at": now.isoformat(),
        })
        logger.info(f"MODULE paused: {module_id[-6:]}")
        return {"ok": True, "status": "paused"}

    @r.post("/modules/{module_id}/cancel")
    async def cancel_module(module_id: str, user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        role = user.role if hasattr(user, "role") else user.get("role")
        module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not module:
            raise HTTPException(status_code=404, detail="Module not found")
        project = await _db.projects.find_one({"project_id": module.get("project_id")}, {"_id": 0})
        if role != "admin" and (project or {}).get("client_id") != uid:
            raise HTTPException(status_code=403, detail="Only project client or admin")
        if module["status"] in ("done", "cancelled"):
            raise HTTPException(status_code=409, detail=f"Already {module['status']}")
        now = _now()
        await _db.modules.update_one(
            {"module_id": module_id},
            {"$set": {"status": "cancelled", "cancelled_at": now.isoformat(), "cancelled_by": uid, "prev_status": module["status"]}},
        )
        # Create partial payout for completed work (if any)
        partial_payout_id = None
        if module.get("assigned_to"):
            earned = await compute_dev_earned(module["assigned_to"], module_id)
            if earned > 0:
                # check no payout exists
                existing = await _db.payouts.find_one({"module_id": module_id}, {"_id": 0})
                if not existing:
                    partial_payout_id = f"pay_{uuid.uuid4().hex[:12]}"
                    await _db.payouts.insert_one({
                        "payout_id": partial_payout_id,
                        "developer_id": module["assigned_to"],
                        "module_id": module_id,
                        "project_id": module.get("project_id"),
                        "client_id": (project or {}).get("client_id"),
                        "amount": round(earned, 2),
                        "module_price": float(module.get("accepted_price") or module.get("final_price") or module.get("price") or 0),
                        "status": "pending",
                        "reason": "partial_on_cancel",
                        "created_at": now.isoformat(),
                    })
        await _db.task_events.insert_one({
            "event_id": f"evt_{uuid.uuid4().hex[:12]}",
            "module_id": module_id,
            "actor_id": uid,
            "event_type": "module.cancelled",
            "metadata": {"partial_payout_id": partial_payout_id},
            "created_at": now.isoformat(),
        })
        logger.info(f"MODULE cancelled: {module_id[-6:]} partial_payout={partial_payout_id}")
        return {"ok": True, "status": "cancelled", "partial_payout_id": partial_payout_id}

    @r.post("/modules/{module_id}/resume")
    async def resume_module(module_id: str, user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        role = user.role if hasattr(user, "role") else user.get("role")
        module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not module or module["status"] != "paused":
            raise HTTPException(status_code=409, detail="Not paused")
        project = await _db.projects.find_one({"project_id": module.get("project_id")}, {"_id": 0})
        if role != "admin" and (project or {}).get("client_id") != uid:
            raise HTTPException(status_code=403, detail="Only project client or admin")
        prev = module.get("prev_status") or "in_progress"
        await _db.modules.update_one(
            {"module_id": module_id},
            {"$set": {"status": prev, "resumed_at": _iso()}},
        )
        return {"ok": True, "status": prev}

    return r
