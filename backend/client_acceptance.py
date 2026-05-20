"""
Client Acceptance Layer
=======================

Closes the last logical gap in the review loop:

    dev submits ─► module: review ─► CLIENT approves ─► module: done + payout

The stock `module_execution.transition_module` refuses manual modules unless
the actor is the assignee or an admin — that's correct *for developers*, but
blocks the client-review flow entirely. This layer adds a **client-side**
entry point that:

  1. Verifies the caller actually owns the parent project.
  2. Verifies the module is currently in `review`.
  3. Performs the `review → done` transition via the canonical engine
     (`transition_module`), using `actor.role="admin"` to bypass the
     assignee check — we've already done the stronger check (ownership).
  4. Creates a dev payout (60 % share) — same formula as `module_motion.py`
     uses when the motion engine auto-closes a module.
  5. Emits a `module_done` notification to the developer.
  6. Writes a `client_approve` row to `db.auto_actions` for the audit bus.

For *"Request changes"* we expose the symmetric client-side move
`review → in_progress`, no payout, just a notification to the dev.

Contract:

    POST /api/client/modules/{module_id}/approve
    POST /api/client/modules/{module_id}/request-changes   (body: {reason?})

Both return the transition result from `transition_module` so the frontend
can trust the shape it's already reading.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from module_execution import transition_module, TransitionError
from module_motion import _emit_notification


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class RequestChangesBody(BaseModel):
    reason: Optional[str] = None


def init_router(db, get_current_user_dep):
    """Standard init pattern used by every other aggregator in this codebase."""
    router = APIRouter(prefix="/api", tags=["client-acceptance"])

    async def _load_and_authorize(module_id: str, user) -> dict:
        """Shared guard: returns the module or raises HTTPException."""
        module = await db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not module:
            raise HTTPException(status_code=404, detail="Module not found")
        project = await db.projects.find_one(
            {"project_id": module.get("project_id")}, {"_id": 0}
        )
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        # Admin can always act; otherwise caller must be the project owner.
        if user.role != "admin" and project.get("client_id") != user.user_id:
            raise HTTPException(status_code=403, detail="Not your project")
        return module

    @router.post("/client/modules/{module_id}/approve")
    async def approve_module(module_id: str, user=Depends(get_current_user_dep)):
        module = await _load_and_authorize(module_id, user)

        if module.get("status") != "review":
            # Idempotent: if it's already done we don't blow up — the client
            # just gets a clean "no-op" signal and the UI reconciles on next poll.
            if module.get("status") == "done":
                return {
                    "ok": True,
                    "module_id": module_id,
                    "project_id": module.get("project_id"),
                    "from": "done",
                    "to": "done",
                    "noop": True,
                }
            raise HTTPException(
                status_code=400,
                detail=f"Module is in '{module.get('status')}', not 'review' — cannot approve",
            )

        # Trusted path: we've already verified project ownership, so tell
        # the engine to act as "admin" (bypasses the manual-assignee guard)
        # but keep the true source for audit.
        try:
            result = await transition_module(
                module_id,
                "done",
                {"user_id": user.user_id, "role": "admin", "source": "client_approve"},
                db,
            )
        except TransitionError as e:
            raise HTTPException(status_code=400, detail=str(e))

        # Re-fetch to get the freshly-set completed_at / progress for payout.
        module = await db.modules.find_one({"module_id": module_id}, {"_id": 0}) or module

        # Dev payout — mirrors module_motion.py logic (60/40 split).
        assignee = module.get("assigned_to")
        dev_share = 0.0
        if assignee:
            price = float(module.get("final_price") or module.get("price") or 0)
            if price > 0:
                dev_share = round(price * 0.6, 2)
                await db.payouts.insert_one({
                    "payout_id": f"pay_{uuid.uuid4().hex[:12]}",
                    "module_id": module_id,
                    "project_id": module.get("project_id"),
                    "developer_id": assignee,
                    "amount": dev_share,
                    "status": "approved",
                    "source": "client_approve",
                    "approved_by": user.user_id,
                    "created_at": _now_iso(),
                })
            await _emit_notification(
                db,
                user_id=assignee,
                type_="module_done",
                severity="success",
                title=(f"You earned ${dev_share:.0f}" if dev_share > 0 else "Module shipped"),
                subtitle=f"{module.get('title') or 'Module'} approved by client",
                project_id=module.get("project_id"),
                module_id=module_id,
            )

        # Client-visible audit row so admins see who approved what from the UI.
        await db.auto_actions.insert_one({
            "action_id": f"auto_{uuid.uuid4().hex[:10]}",
            "type": "client_approve",
            "module_id": module_id,
            "project_id": module.get("project_id"),
            "actor_id": user.user_id,
            "source": "client",
            "dev_share": dev_share,
            "created_at": _now_iso(),
            "status": "executed",
        })

        return {**result, "dev_share": dev_share}

    @router.post("/client/modules/{module_id}/request-changes")
    async def request_changes(
        module_id: str,
        body: RequestChangesBody,
        user=Depends(get_current_user_dep),
    ):
        module = await _load_and_authorize(module_id, user)
        if module.get("status") != "review":
            raise HTTPException(
                status_code=400,
                detail=f"Module is in '{module.get('status')}', not 'review' — nothing to bounce back",
            )

        try:
            result = await transition_module(
                module_id,
                "in_progress",
                {"user_id": user.user_id, "role": "admin", "source": "client_request_changes"},
                db,
            )
        except TransitionError as e:
            raise HTTPException(status_code=400, detail=str(e))

        assignee = module.get("assigned_to")
        if assignee:
            reason = (body.reason or "Client requested changes").strip()[:280]
            await _emit_notification(
                db,
                user_id=assignee,
                type_="revision_requested",
                severity="warning",
                title="Changes requested",
                subtitle=f"{module.get('title') or 'Module'} — {reason}",
                project_id=module.get("project_id"),
                module_id=module_id,
            )

        await db.auto_actions.insert_one({
            "action_id": f"auto_{uuid.uuid4().hex[:10]}",
            "type": "client_request_changes",
            "module_id": module_id,
            "project_id": module.get("project_id"),
            "actor_id": user.user_id,
            "source": "client",
            "reason": (body.reason or "").strip()[:500],
            "created_at": _now_iso(),
            "status": "executed",
        })

        return result

    return router
