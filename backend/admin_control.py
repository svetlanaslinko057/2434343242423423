"""
Block A4 — Admin Control Layer (WRITE, MINIMAL)

One endpoint: POST /api/admin/project/{project_id}/action

Principle (do not violate):
    System decides · Admin can override · Everything is logged

Body:
    { "action": "pause" | "resume" | "force_review" }

    No module_id. No extra params. No per-action config.
    If the admin needs to go finer than project-level, that's a
    different surface — not this one. Override is blunt by design.

Behaviour:
    pause         → every module with status != paused gets
                    status="paused", paused_by="admin",
                    prev_status preserved for resume
    resume        → every module with paused_by="admin" gets
                    its prev_status back (or "pending" if absent)
    force_review  → inserts one row in db.system_alerts with
                    type="admin_review_request", source="admin"

Audit (always):
    A row in db.auto_actions is written for EVERY invocation.
    - type:      "admin_pause" | "admin_resume" | "admin_force_review"
    - source:    "admin"
    - severity:  "warning" (admin intervention is always a signal)
    - confidence: 1.0
    - reason:    "Manual admin intervention"
    - admin_id:  who triggered it
    - project_id + affected module count

    This is what makes the admin override visible to A2 (Actions Feed)
    and A3 (Risk Map) without any extra wiring — they already read
    db.auto_actions.

Reads:     db.modules, db.projects (ownership of the project exists,
           but admins are unscoped).
Writes:    db.modules (state), db.system_alerts (force_review only),
           db.auto_actions (always).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api", tags=["admin-control"])


class AdminAction(BaseModel):
    action: str = Field(..., pattern="^(pause|resume|force_review)$")


def init_router(db, get_current_user_dep):

    async def _audit(project_id: str, admin_id: str, action: str, affected: int) -> str:
        action_id = f"admin_{uuid.uuid4().hex[:12]}"
        await db.auto_actions.insert_one({
            "action_id":  action_id,
            "type":       f"admin_{action}",
            "source":     "admin",
            "severity":   "warning",
            "project_id": project_id,
            "module_id":  None,
            "status":     "executed",
            "confidence": 1.0,
            "reason":     "Manual admin intervention",
            "impact":     f"Admin {action} — {affected} module(s) affected",
            "admin_id":   admin_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        return action_id

    @router.post("/admin/project/{project_id}/action")
    async def admin_project_action(project_id: str,
                                   body: AdminAction,
                                   user=Depends(get_current_user_dep)) -> Dict[str, Any]:
        role = user.role if hasattr(user, "role") else user.get("role")
        if role != "admin":
            raise HTTPException(status_code=403, detail="Admin only")
        admin_id = user.user_id if hasattr(user, "user_id") else user["user_id"]

        project = await db.projects.find_one({"project_id": project_id}, {"_id": 0})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        now = datetime.now(timezone.utc).isoformat()
        action = body.action
        affected = 0

        if action == "pause":
            # Pause every module that isn't already paused. Preserve prev_status
            # so resume knows where to go back to.
            modules = await db.modules.find(
                {"project_id": project_id, "status": {"$ne": "paused"}},
                {"_id": 0, "module_id": 1, "status": 1},
            ).to_list(2000)
            for m in modules:
                await db.modules.update_one(
                    {"module_id": m["module_id"]},
                    {"$set": {
                        "status":      "paused",
                        "paused_at":   now,
                        "paused_by":   "admin",
                        "prev_status": m.get("status") or "pending",
                    }},
                )
            affected = len(modules)

        elif action == "resume":
            # Resume ONLY modules the admin paused. Do not undo guardian/operator —
            # those decisions belong to the system.
            modules = await db.modules.find(
                {"project_id": project_id, "status": "paused", "paused_by": "admin"},
                {"_id": 0, "module_id": 1, "prev_status": 1},
            ).to_list(2000)
            for m in modules:
                await db.modules.update_one(
                    {"module_id": m["module_id"]},
                    {"$set":   {"status":     m.get("prev_status") or "pending",
                                "resumed_at": now,
                                "resumed_by": "admin"},
                     "$unset": {"paused_by": "", "paused_at": "", "prev_status": ""}},
                )
            affected = len(modules)

        elif action == "force_review":
            # Fire one alert. Does not modify module state.
            await db.system_alerts.insert_one({
                "alert_id":   f"alert_{uuid.uuid4().hex[:12]}",
                "type":       "admin_review_request",
                "source":     "admin",
                "project_id": project_id,
                "admin_id":   admin_id,
                "status":     "open",
                "message":    "Admin requested a manual review",
                "created_at": now,
            })
            affected = 1

        action_id = await _audit(project_id, admin_id, action, affected)

        return {
            "ok":         True,
            "action":     action,
            "project_id": project_id,
            "affected":   affected,
            "action_id":  action_id,
            "performed_at": now,
        }

    return router
