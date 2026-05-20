"""
Admin System — Identity Layer (roles management).

Endpoints under /api/admin/system/*. Single source of truth for:
 - granting/revoking roles on users (roles[] — what user CAN be)
 - keeping states[] in sync (what user HAS activated as UI context)
 - keeping the legacy primary `role` field in sync so existing
   require_role("admin") / require_role("developer") guards keep working
   without touching 95+ admin endpoints.

Principle: ONE USER, MANY ROLES. No separate admin login, no separate auth.
Every mutation is audited to db.system_actions_log (shared bus, per CONTRACTS.md)
and broadcast on the role:admin realtime channel.
"""
from fastapi import APIRouter, HTTPException, Depends, Body
from datetime import datetime, timezone
from typing import Optional
import uuid
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

# Highest privilege wins when we pick the primary `role` field.
ROLE_PRIORITY = {"admin": 4, "developer": 3, "tester": 2, "client": 1}
VALID_ROLES = {"admin", "developer", "tester", "client"}


def _pick_primary_role(roles: list) -> str:
    """Return the highest-privilege role from the list (for the legacy
    single `role` field)."""
    if not roles:
        return "client"
    return max(roles, key=lambda r: ROLE_PRIORITY.get(r, 0))


def build_router(db, require_role_dep, realtime):
    """Factory that binds the router to the app's db, auth and realtime
    services. Called once from server.py."""

    async def _audit(action: str, target_email: str, role: str, by_user: dict,
                     extras: Optional[dict] = None) -> None:
        log = {
            "log_id": f"slog_{uuid.uuid4().hex[:12]}",
            "action": action,               # role_assigned | role_removed
            "entity_type": "user",
            "entity_id": target_email,
            "role": role,
            "admin_id": by_user.get("user_id"),
            "admin_email": by_user.get("email"),
            "source": "admin_system",
            "status": "executed",
            "payload": extras or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.system_actions_log.insert_one(log)

    @router.post("/admin/system/roles/assign")
    async def assign_role(
        payload: dict = Body(...),
        user: dict = Depends(require_role_dep("admin")),
    ):
        """Grant a role to a user. Adds to roles[] and states[] and promotes
        the legacy `role` field if the new role is higher priority."""
        email = (payload.get("email") or "").strip().lower()
        role = payload.get("role")

        if not email:
            raise HTTPException(400, "email required")
        if role not in VALID_ROLES:
            raise HTTPException(400, f"role must be one of {sorted(VALID_ROLES)}")

        target = await db.users.find_one({"email": email}, {"_id": 0})
        if not target:
            raise HTTPException(404, f"user not found: {email}")

        current_roles = set(target.get("roles") or [])
        if role in current_roles:
            return {
                "ok": True,
                "already_had": True,
                "email": email,
                "role": role,
                "roles": sorted(current_roles),
            }

        new_roles = sorted(current_roles | {role})
        new_primary = _pick_primary_role(new_roles)

        update = {
            "$addToSet": {"roles": role, "states": role},
        }
        # Only promote the primary role field if strictly higher priority.
        if ROLE_PRIORITY.get(new_primary, 0) > ROLE_PRIORITY.get(target.get("role", "client"), 0):
            update["$set"] = {"role": new_primary}

        await db.users.update_one({"email": email}, update)

        # Force-logout of any stale sessions isn't needed — the next
        # /api/auth/me call returns the new roles[] and states[], and the
        # gateway picks the new routing on next mount.

        user_email = user.email if hasattr(user, "email") else user.get("email")
        user_id = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        await _audit(
            "role_assigned", email, role,
            {"user_id": user_id, "email": user_email},
            extras={
                "previous_roles": sorted(current_roles),
                "new_roles": new_roles,
                "primary_role": new_primary,
            },
        )

        await realtime.emit_to_role("admin", "admin.role_assigned", {
            "email": email,
            "role": role,
            "roles": new_roles,
            "by": user_email,
        })

        logger.info(f"ADMIN_SYSTEM: role_assigned email={email} role={role} "
                    f"by={user_email} new_roles={new_roles}")

        return {
            "ok": True,
            "email": email,
            "role": role,
            "roles": new_roles,
            "primary_role": new_primary,
        }

    @router.post("/admin/system/roles/remove")
    async def remove_role(
        payload: dict = Body(...),
        user: dict = Depends(require_role_dep("admin")),
    ):
        """Revoke a role. Pulls from roles[] and states[] and demotes the
        legacy `role` field to the highest remaining role."""
        email = (payload.get("email") or "").strip().lower()
        role = payload.get("role")

        if not email:
            raise HTTPException(400, "email required")
        if role not in VALID_ROLES:
            raise HTTPException(400, f"role must be one of {sorted(VALID_ROLES)}")

        target = await db.users.find_one({"email": email}, {"_id": 0})
        if not target:
            raise HTTPException(404, f"user not found: {email}")

        current_roles = set(target.get("roles") or [])
        if role not in current_roles:
            return {
                "ok": True,
                "already_gone": True,
                "email": email,
                "role": role,
                "roles": sorted(current_roles),
            }

        # Safety: never strip the last admin in the whole system — otherwise
        # you lock yourself out. Anyone can remove their OWN last non-admin
        # role, but the pool of admins must never reach zero.
        if role == "admin":
            admin_count = await db.users.count_documents({"roles": "admin"})
            if admin_count <= 1:
                raise HTTPException(
                    409,
                    "cannot_remove_last_admin — assign admin to another user first",
                )

        new_roles = sorted(current_roles - {role})
        new_primary = _pick_primary_role(new_roles) if new_roles else "client"

        update = {
            "$pull": {"roles": role, "states": role},
            "$set": {"role": new_primary},
        }
        # If the user's active_context was exactly this role, clear it — the
        # gateway will re-prompt on next login.
        if target.get("active_context") == role:
            update["$set"]["active_context"] = None

        await db.users.update_one({"email": email}, update)

        user_email = user.email if hasattr(user, "email") else user.get("email")
        user_id = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        await _audit(
            "role_removed", email, role,
            {"user_id": user_id, "email": user_email},
            extras={
                "previous_roles": sorted(current_roles),
                "new_roles": new_roles,
                "primary_role": new_primary,
            },
        )

        await realtime.emit_to_role("admin", "admin.role_removed", {
            "email": email,
            "role": role,
            "roles": new_roles,
            "by": user_email,
        })

        logger.info(f"ADMIN_SYSTEM: role_removed email={email} role={role} "
                    f"by={user_email} new_roles={new_roles}")

        return {
            "ok": True,
            "email": email,
            "role": role,
            "roles": new_roles,
            "primary_role": new_primary,
        }

    @router.get("/admin/system/users")
    async def list_users(
        user: dict = Depends(require_role_dep("admin")),
    ):
        """List every user with their roles[] and primary role.
        Used by the /admin/system → Users tab."""
        projection = {
            "_id": 0,
            "user_id": 1,
            "email": 1,
            "name": 1,
            "role": 1,
            "roles": 1,
            "states": 1,
            "active_context": 1,
            "status": 1,
            "created_at": 1,
            "source": 1,
        }
        rows = await db.users.find({"is_deleted": {"$ne": True}}, projection) \
            .sort("created_at", -1).to_list(500)

        # Normalise so the UI never has to guess: every row has roles[]
        # and states[].
        for r in rows:
            if not r.get("roles"):
                r["roles"] = [r.get("role", "client")]
            if not r.get("states"):
                r["states"] = []
            # Serialise datetimes if any
            ca = r.get("created_at")
            if isinstance(ca, datetime):
                r["created_at"] = ca.isoformat()

        return {
            "items": rows,
            "count": len(rows),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    return router


async def backfill_roles(db) -> dict:
    """One-shot migration: ensure every user has roles[] populated.
    Uses states[] if available, else falls back to [role]. Idempotent."""
    fixed = 0
    async for u in db.users.find({"roles": {"$exists": False}}):
        roles = u.get("states") or ([u["role"]] if u.get("role") else ["client"])
        await db.users.update_one(
            {"_id": u["_id"]},
            {"$set": {"roles": roles}},
        )
        fixed += 1
    if fixed:
        logger.info(f"ADMIN_SYSTEM backfill: set roles[] on {fixed} user(s)")
    return {"fixed": fixed}
