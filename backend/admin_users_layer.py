"""
Admin → Users — Phase 1 Step B (Identity Control Panel).

Mounted under /api. Every endpoint requires an authenticated user with
role == "admin".

Endpoints:
  GET    /admin/users-v2              enriched list (status, projects_count,
                                      total_spent, referrals_count, 2fa flag,
                                      last_login_at, search, role/status filters)
  GET    /admin/users-v2/{id}         full detail (profile + sessions + projects
                                      + referrals + recent activity)
  POST   /admin/users-v2/{id}/block       set status=blocked
  POST   /admin/users-v2/{id}/unblock     set status=active
  POST   /admin/users-v2/{id}/role        change role
  POST   /admin/users-v2/{id}/logout-all  drop every session of the user
  DELETE /admin/users-v2/{id}             soft delete (is_deleted=true, sessions purged)
  GET    /admin/audit-log                 recent admin actions (limit/offset)

Why /admin/users-v2 instead of /admin/users:
  The existing /admin/users (server.py:3412) returns a plain List[User] and is
  consumed by other admin pages. We add a richer namespace so we don't break
  callers that depend on the typed response. The frontend new page uses v2.

Audit:
  Every mutating call writes to db.admin_audit_log with admin_id, admin_email,
  target_user_id, action, payload, timestamp.

Self-protection rules:
  * An admin cannot block / demote / delete *themselves*.
  * The last remaining admin cannot be demoted or deleted.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional, Literal

from fastapi import APIRouter, HTTPException, Depends, Query, Request
from pydantic import BaseModel, Field

logger = logging.getLogger("admin_users_layer")

_db = None
_get_current_user = None
_require_role = None

VALID_ROLES = ("client", "developer", "admin", "tester")


def wire(*, db, get_current_user, require_role):
    global _db, _get_current_user, _require_role
    _db = db
    _get_current_user = get_current_user
    _require_role = require_role


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _audit(admin, target_user_id: str, action: str, payload: Optional[dict] = None):
    await _db.admin_audit_log.insert_one({
        "type": "admin_action",
        "action": action,
        "admin_id": admin.user_id,
        "admin_email": admin.email,
        "target_user_id": target_user_id,
        "payload": payload or {},
        "timestamp": _now_iso(),
    })


def _user_card(u: dict, *, projects_count: int = 0, total_spent: float = 0.0,
               referrals_count: int = 0, sessions_count: int = 0) -> dict:
    """Public-safe user card for admin lists."""
    return {
        "user_id": u.get("user_id"),
        "email": u.get("email"),
        "name": u.get("name"),
        "avatar_url": u.get("avatar_url") or u.get("picture"),
        "role": u.get("active_role") or u.get("role") or "client",
        "roles": u.get("roles") or [u.get("role") or "client"],
        "status": u.get("status") or ("blocked" if u.get("is_deleted") else "active"),
        "is_deleted": bool(u.get("is_deleted")),
        "two_factor_enabled": bool(u.get("two_factor_enabled")),
        "subscription": u.get("subscription") or "starter",
        "phone": u.get("phone"),
        "company": u.get("company"),
        "timezone": u.get("timezone"),
        "created_at": u.get("created_at"),
        "last_login_at": u.get("last_login_at"),
        "projects_count": projects_count,
        "total_spent": float(total_spent),
        "referrals_count": referrals_count,
        "sessions_count": sessions_count,
    }


# ─── Pydantic ───

class RoleChange(BaseModel):
    role: Literal["client", "developer", "admin", "tester"]


class BlockReason(BaseModel):
    reason: Optional[str] = Field(None, max_length=240)


# ─── Router ───

def build_router() -> APIRouter:
    r = APIRouter(tags=["admin-users"])
    require_admin = _require_role("admin")

    @r.get("/admin/users-v2")
    async def list_users_v2(
        admin=Depends(require_admin),
        q: Optional[str] = Query(None, description="search email/name"),
        role: Optional[str] = Query(None, description=f"one of {VALID_ROLES}"),
        status: Optional[str] = Query(None, description="active|blocked|deleted"),
        limit: int = Query(100, ge=1, le=500),
        offset: int = Query(0, ge=0),
    ):
        match: dict = {}
        if q:
            match["$or"] = [
                {"email": {"$regex": q, "$options": "i"}},
                {"name": {"$regex": q, "$options": "i"}},
            ]
        if role:
            if role not in VALID_ROLES:
                raise HTTPException(status_code=400, detail="Invalid role filter")
            match["$or" if "$or" not in match else "$and"] = (
                [{"role": role}, {"active_role": role}]
                if "$or" not in match else
                [{"$or": match.pop("$or")}, {"$or": [{"role": role}, {"active_role": role}]}]
            )
        if status == "blocked":
            match["status"] = "blocked"
        elif status == "deleted":
            match["is_deleted"] = True
        elif status == "active":
            match["$nor"] = [{"status": "blocked"}, {"is_deleted": True}]

        total = await _db.users.count_documents(match)
        users = await _db.users.find(match, {"_id": 0, "password_hash": 0}) \
            .sort("created_at", -1).skip(offset).limit(limit).to_list(limit)

        # Bulk enrich (avoid N+1)
        user_ids = [u.get("user_id") for u in users if u.get("user_id")]

        # projects_count + total_spent — read invoices.paid grouped by client_id
        projects_map: dict = {uid: 0 for uid in user_ids}
        spent_map: dict = {uid: 0.0 for uid in user_ids}
        if user_ids:
            proj_pipeline = [
                {"$match": {"client_id": {"$in": user_ids}}},
                {"$group": {"_id": "$client_id", "n": {"$sum": 1}}},
            ]
            async for row in _db.projects.aggregate(proj_pipeline):
                projects_map[row["_id"]] = row["n"]

            inv_pipeline = [
                {"$match": {"client_id": {"$in": user_ids}, "status": "paid"}},
                {"$group": {"_id": "$client_id", "total": {"$sum": "$amount"}}},
            ]
            async for row in _db.invoices.aggregate(inv_pipeline):
                spent_map[row["_id"]] = float(row["total"] or 0)

        # referrals_count — db.referral_clicks grouped by referrer_user_id
        ref_map: dict = {uid: 0 for uid in user_ids}
        if user_ids:
            ref_pipeline = [
                {"$match": {"referrer_user_id": {"$in": user_ids}}},
                {"$group": {"_id": "$referrer_user_id", "n": {"$sum": 1}}},
            ]
            async for row in _db.referral_clicks.aggregate(ref_pipeline):
                ref_map[row["_id"]] = row["n"]

        # sessions_count
        sess_map: dict = {uid: 0 for uid in user_ids}
        if user_ids:
            sess_pipeline = [
                {"$match": {"user_id": {"$in": user_ids}}},
                {"$group": {"_id": "$user_id", "n": {"$sum": 1}}},
            ]
            async for row in _db.user_sessions.aggregate(sess_pipeline):
                sess_map[row["_id"]] = row["n"]

        cards = [
            _user_card(
                u,
                projects_count=projects_map.get(u.get("user_id"), 0),
                total_spent=spent_map.get(u.get("user_id"), 0.0),
                referrals_count=ref_map.get(u.get("user_id"), 0),
                sessions_count=sess_map.get(u.get("user_id"), 0),
            )
            for u in users
        ]

        return {"users": cards, "total": total, "limit": limit, "offset": offset}

    @r.get("/admin/users-v2/{user_id}")
    async def get_user_detail(user_id: str, admin=Depends(require_admin)):
        u = await _db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")

        # Projects (top 20 most recent)
        projects = await _db.projects.find(
            {"client_id": user_id}, {"_id": 0}
        ).sort("created_at", -1).to_list(20)

        # Sessions
        sessions = await _db.user_sessions.find(
            {"user_id": user_id},
            {"_id": 0, "session_id": 1, "session_token": 1, "created_at": 1, "expires_at": 1},
        ).sort("created_at", -1).to_list(50)
        sess_view = [{
            "session_id": s.get("session_id"),
            "token_preview": (s.get("session_token", "")[:8] + "…" + s.get("session_token", "")[-4:])
                if len(s.get("session_token", "")) > 12 else s.get("session_token", ""),
            "created_at": s.get("created_at"),
            "expires_at": s.get("expires_at"),
        } for s in sessions]

        # Referrals dashboard data (best-effort)
        referrer_link = await _db.referral_links.find_one(
            {"user_id": user_id}, {"_id": 0}
        )
        referrals_count = await _db.referral_clicks.count_documents({"referrer_user_id": user_id})

        # Recent activity (admin audit + project events)
        activity = []
        async for ev in _db.admin_audit_log.find(
            {"target_user_id": user_id}, {"_id": 0}
        ).sort("timestamp", -1).limit(20):
            activity.append(ev)

        # Aggregate spent
        agg = await _db.invoices.aggregate([
            {"$match": {"client_id": user_id, "status": "paid"}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
        ]).to_list(1)
        total_spent = float(agg[0]["total"]) if agg else 0.0

        return {
            "user": _user_card(
                u,
                projects_count=len(projects),
                total_spent=total_spent,
                referrals_count=referrals_count,
                sessions_count=len(sessions),
            ),
            "projects": projects,
            "sessions": sess_view,
            "referrals": {
                "code": referrer_link.get("code") if referrer_link else None,
                "tier": referrer_link.get("tier") if referrer_link else None,
                "clicks": referrals_count,
            },
            "activity": activity,
        }

    # ── Mutations ────────────────────────────────────────────────

    async def _ensure_not_self(admin, user_id: str, action: str):
        if admin.user_id == user_id:
            raise HTTPException(status_code=400, detail=f"Cannot {action} yourself")

    async def _ensure_not_last_admin(user_id: str):
        target = await _db.users.find_one({"user_id": user_id}, {"_id": 0, "role": 1})
        if not target or target.get("role") != "admin":
            return
        admins = await _db.users.count_documents({
            "role": "admin",
            "$nor": [{"is_deleted": True}, {"status": "blocked"}],
        })
        if admins <= 1:
            raise HTTPException(status_code=400, detail="Cannot remove the last admin")

    @r.post("/admin/users-v2/{user_id}/block")
    async def block_user(user_id: str, body: BlockReason, admin=Depends(require_admin)):
        await _ensure_not_self(admin, user_id, "block")
        await _ensure_not_last_admin(user_id)
        target = await _db.users.find_one({"user_id": user_id}, {"_id": 0, "user_id": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await _db.users.update_one(
            {"user_id": user_id},
            {"$set": {
                "status": "blocked",
                "blocked_at": _now_iso(),
                "blocked_reason": body.reason,
                "blocked_by": admin.user_id,
            }},
        )
        # Drop every active session for the blocked user.
        await _db.user_sessions.delete_many({"user_id": user_id})
        await _audit(admin, user_id, "block_user", {"reason": body.reason})
        return {"ok": True, "status": "blocked"}

    @r.post("/admin/users-v2/{user_id}/unblock")
    async def unblock_user(user_id: str, admin=Depends(require_admin)):
        target = await _db.users.find_one({"user_id": user_id}, {"_id": 0, "user_id": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await _db.users.update_one(
            {"user_id": user_id},
            {"$set": {"status": "active", "unblocked_at": _now_iso(), "unblocked_by": admin.user_id},
             "$unset": {"blocked_reason": "", "blocked_at": "", "blocked_by": ""}},
        )
        await _audit(admin, user_id, "unblock_user")
        return {"ok": True, "status": "active"}

    @r.post("/admin/users-v2/{user_id}/role")
    async def change_role(user_id: str, body: RoleChange, admin=Depends(require_admin)):
        await _ensure_not_self(admin, user_id, "demote")
        if body.role != "admin":
            await _ensure_not_last_admin(user_id)
        target = await _db.users.find_one({"user_id": user_id}, {"_id": 0, "user_id": 1, "role": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        old_role = target.get("role")
        await _db.users.update_one(
            {"user_id": user_id},
            {"$set": {"role": body.role, "active_role": body.role, "role_changed_at": _now_iso()}},
        )
        await _audit(admin, user_id, "change_role", {"from": old_role, "to": body.role})
        return {"ok": True, "role": body.role}

    @r.post("/admin/users-v2/{user_id}/logout-all")
    async def logout_all(user_id: str, admin=Depends(require_admin)):
        result = await _db.user_sessions.delete_many({"user_id": user_id})
        await _audit(admin, user_id, "logout_all", {"revoked": result.deleted_count})
        return {"ok": True, "revoked": result.deleted_count}

    @r.delete("/admin/users-v2/{user_id}")
    async def soft_delete(user_id: str, admin=Depends(require_admin)):
        await _ensure_not_self(admin, user_id, "delete")
        await _ensure_not_last_admin(user_id)
        target = await _db.users.find_one({"user_id": user_id}, {"_id": 0, "user_id": 1, "email": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        scrambled = f"deleted+{user_id}@atlas.dev"
        await _db.users.update_one(
            {"user_id": user_id},
            {"$set": {
                "is_deleted": True,
                "deleted_at": _now_iso(),
                "deleted_by": admin.user_id,
                "email": scrambled,
                "name": "Deleted user",
                "avatar_url": None,
                "avatar_public_id": None,
                "two_factor_enabled": False,
                "status": "blocked",
            }},
        )
        await _db.user_sessions.delete_many({"user_id": user_id})
        await _audit(admin, user_id, "delete_user", {"original_email": target.get("email")})
        return {"ok": True}

    # ── Audit log read ──────────────────────────────────────────

    @r.get("/admin/audit-log")
    async def audit_log(
        admin=Depends(require_admin),
        limit: int = Query(50, ge=1, le=500),
        offset: int = Query(0, ge=0),
        target_user_id: Optional[str] = Query(None),
        action: Optional[str] = Query(None),
    ):
        q: dict = {}
        if target_user_id:
            q["target_user_id"] = target_user_id
        if action:
            q["action"] = action
        total = await _db.admin_audit_log.count_documents(q)
        rows = await _db.admin_audit_log.find(q, {"_id": 0}) \
            .sort("timestamp", -1).skip(offset).limit(limit).to_list(limit)
        return {"entries": rows, "total": total, "limit": limit, "offset": offset}

    return r


async def _get_current_user_request():
    """Stub kept only because we cleared and rebuilt routes above; never used."""
    raise NotImplementedError
