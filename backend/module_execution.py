"""
L5 — Module Execution Layer

Canonical module lifecycle:
    pending → in_progress → review → done

Rules:
  • Transitions are EXPLICIT. No auto-magic here.
  • `transition_module` is the single place status is mutated.
  • Every transition writes to db.auto_actions (unified audit bus).
  • Manual-mode modules require the actor to be the assignee (or admin)
    — guardian/operator already skip them, so this covers user actions.

Downstream:
  • Client Workspace reads module.status for progress.
  • Dev Work picks up in_progress / review modules.
  • Admin sees movement via db.auto_actions.
  • Guardian can later react to stuck states.
"""

from datetime import datetime, timezone
from typing import Optional
import uuid


STATUSES = ["pending", "in_progress", "review", "done"]

ALLOWED_TRANSITIONS = {
    "pending": ["in_progress"],
    "in_progress": ["review"],
    "review": ["done", "in_progress"],  # reviewer can bounce back for rework
    "done": [],
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class TransitionError(Exception):
    """Raised when a requested transition is not allowed."""


async def transition_module(
    module_id: str,
    to_status: str,
    actor: dict,
    db,
) -> dict:
    """
    Move a module between canonical statuses.

    actor = {"user_id": "...", "source": "user"|"system"|"admin", "role": "...?"}
    """
    if to_status not in STATUSES:
        raise TransitionError(f"unknown status: {to_status}")

    module = await db.modules.find_one({"module_id": module_id}, {"_id": 0})
    if not module:
        raise TransitionError("module not found")

    current = module.get("status") or "pending"
    if to_status not in ALLOWED_TRANSITIONS.get(current, []):
        raise TransitionError(f"invalid transition {current} → {to_status}")

    # Minimal authorisation for manual (CORE) modules.
    # Guardian/Operator already skip manual modules; this protects the user path.
    if module.get("assignment_mode") == "manual":
        actor_role = (actor or {}).get("role")
        actor_uid = (actor or {}).get("user_id")
        assignee = module.get("assigned_to")
        if actor_role != "admin" and assignee and assignee != actor_uid:
            raise TransitionError("not allowed: manual module owned by another user")

    now = _now_iso()
    update: dict = {"status": to_status, "updated_at": now}
    if to_status == "in_progress" and not module.get("started_at"):
        update["started_at"] = now
    if to_status == "review":
        update["review_requested_at"] = now
    if to_status == "done":
        update["completed_at"] = now
        update["progress"] = 100

    await db.modules.update_one({"module_id": module_id}, {"$set": update})

    # Audit event on the unified bus.
    await db.auto_actions.insert_one({
        "action_id": f"auto_{uuid.uuid4().hex[:10]}",
        "type": "module_status_changed",
        "module_id": module_id,
        "project_id": module.get("project_id"),
        "from_status": current,
        "to_status": to_status,
        "source": (actor or {}).get("source", "user"),
        "actor_id": (actor or {}).get("user_id"),
        "created_at": now,
        "status": "executed",
    })

    return {
        "ok": True,
        "module_id": module_id,
        "project_id": module.get("project_id"),
        "from": current,
        "to": to_status,
        "updated_at": now,
    }


def next_allowed(status: Optional[str]) -> list:
    """Helper: UI can show only the next legal actions."""
    return list(ALLOWED_TRANSITIONS.get(status or "pending", []))
