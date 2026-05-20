"""
Phase 7 — Mobile Compatibility Layer
====================================

Thin adapter at `/api/mobile/*` that translates between the web backend's
existing contracts and what the Expo mobile app expects.

Zero core rewrites. Zero new engines. Zero business logic.
Every endpoint here is either:
  (a) a shape-adapter over an existing collection / endpoint, OR
  (b) a pass-through that just wraps payloads in the expected envelope.

One file. One router. Mounted once in server.py.
"""

from __future__ import annotations

import asyncio
import logging
import random
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from middleware.compat_observability import compat_decorator

logger = logging.getLogger("mobile_adapter")

# ─────────────────────────────────────────────────────────────
# Wiring (injected from server.py)
# ─────────────────────────────────────────────────────────────
_db = None
_hash_password = None
_verify_password = None
_get_current_user = None


def wire(*, db, hash_password: Callable, verify_password: Callable, get_current_user: Callable):
    global _db, _hash_password, _verify_password, _get_current_user
    _db = db
    _hash_password = hash_password
    _verify_password = verify_password
    _get_current_user = get_current_user


def _now():
    return datetime.now(timezone.utc)


def _now_iso():
    return _now().isoformat()


# ─────────────────────────────────────────────────────────────
# Shape adapter: web-user doc → mobile-user shape
# ─────────────────────────────────────────────────────────────
def _to_mobile_user(u: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize backend user doc into the shape the mobile app expects:
      { user_id, email, name, roles[], active_role, tier, strikes, capacity, active_modules, ... }
    """
    if not u:
        return None
    roles = u.get("roles")
    if not roles:
        role = u.get("role", "client")
        roles = [role] if role else ["client"]
    active_role = u.get("active_role") or roles[0]
    # `states` (multi-role enablement) + `active_context` (currently-selected
    # cabinet) are required by the Expo `resolve-entry` router. Fall back to
    # `roles` / `active_role` when the user doc was created before the
    # multi-context migration. Keeping both old + new keys keeps backward
    # compatibility for existing client/developer/admin accounts.
    states = u.get("states") or list(roles)
    active_context = u.get("active_context") or active_role
    return {
        "user_id": u.get("user_id"),
        "email": u.get("email"),
        "name": u.get("name"),
        "picture": u.get("picture"),
        "roles": roles,
        "active_role": active_role,
        "role": active_role,  # backward-compat
        "states": states,
        "active_context": active_context,
        "tier": u.get("tier") or u.get("subscription") or "starter",
        "strikes": int(u.get("strikes") or 0),
        "capacity": int(u.get("capacity") or 5),
        "active_modules": int(u.get("active_modules") or u.get("active_load") or 0),
        "level": u.get("level") or "junior",
        "rating": u.get("rating") or 5.0,
        "skills": u.get("skills") or [],
        "is_demo": bool(u.get("is_demo") or False),
    }


async def _create_session(user_id: str) -> str:
    token = f"sess_{uuid.uuid4().hex}"
    expires_at = _now() + timedelta(days=7)
    await _db.user_sessions.insert_one({
        "session_id": str(uuid.uuid4()),
        "user_id": user_id,
        "session_token": token,
        "expires_at": expires_at.isoformat(),
        "created_at": _now_iso(),
    })
    return token


# ─────────────────────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────────────────────
class MobileLoginRequest(BaseModel):
    email: str
    password: str
    device_fingerprint: Optional[str] = None


class MobileRegisterRequest(BaseModel):
    email: str
    password: str
    name: str
    roles: Optional[List[str]] = None
    role: Optional[str] = "client"


class MobileDemoRequest(BaseModel):
    role: Optional[str] = "client"


class MobileSwitchRoleRequest(BaseModel):
    role: str


# ─────────────────────────────────────────────────────────────
# Router factory
# ─────────────────────────────────────────────────────────────
def build_router() -> APIRouter:
    r = APIRouter(tags=["mobile-compat"])

    # ─────────── AUTH ───────────
    @r.post("/auth/login")
    async def mobile_login(req: MobileLoginRequest, response: Response):
        email = req.email.strip().lower()
        user = await _db.users.find_one({"email": email}, {"_id": 0})
        if not user or not user.get("password_hash"):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        if not _verify_password(req.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid credentials")

        # 2FA gate: password was correct but the account requires a second
        # factor. We DO NOT issue a session — instead, mint a short-lived
        # challenge token. Client POSTs it back with a TOTP/recovery code to
        # /mobile/auth/2fa/verify which produces the real session.
        # Trusted-device short-circuit: if the client included a known
        # device_fingerprint (issued via "Trust this device for 30 days"
        # on a previous 2FA challenge), skip the challenge entirely.
        if user.get("two_factor_enabled"):
            try:
                import two_factor as _tf
                if req.device_fingerprint and await _tf.is_device_trusted(user["user_id"], req.device_fingerprint):
                    pass  # fall through to session issuance below
                else:
                    challenge_token = await _tf.issue_challenge(user["user_id"])
                    return {
                        "requires_2fa": True,
                        "challenge_token": challenge_token,
                        "method": "totp",
                        "ttl_seconds": _tf.CHALLENGE_TTL_SECONDS,
                    }
            except HTTPException:
                raise
            except Exception as e:
                # Defence: if the 2FA module is somehow not wired, fail closed
                # rather than silently bypassing the second factor.
                raise HTTPException(status_code=500, detail=f"2FA gate failure: {e}")

        token = await _create_session(user["user_id"])
        response.set_cookie(
            key="session_token", value=token, httponly=True, secure=True, samesite="none", path="/",
            max_age=7 * 24 * 60 * 60,
        )
        return {"token": token, "user": _to_mobile_user(user)}

    @r.post("/auth/register")
    async def mobile_register(req: MobileRegisterRequest, response: Response):
        email = req.email.strip().lower()
        if await _db.users.find_one({"email": email}):
            raise HTTPException(status_code=400, detail="Email already registered")

        roles = req.roles or ([req.role] if req.role else ["client"])
        primary_role = roles[0]
        if primary_role not in ("client", "developer", "tester", "admin"):
            raise HTTPException(status_code=400, detail="Invalid role")

        user_id = f"user_{uuid.uuid4().hex[:12]}"
        doc = {
            "user_id": user_id,
            "email": email,
            "password_hash": _hash_password(req.password),
            "name": req.name.strip(),
            "picture": None,
            "role": primary_role,
            "roles": roles,
            "active_role": primary_role,
            "skills": [],
            "level": "junior",
            "rating": 5.0,
            "completed_tasks": 0,
            "active_load": 0,
            "capacity": 5,
            "created_at": _now_iso(),
        }
        await _db.users.insert_one(doc)

        token = await _create_session(user_id)
        response.set_cookie(
            key="session_token", value=token, httponly=True, secure=True, samesite="none", path="/",
            max_age=7 * 24 * 60 * 60,
        )
        doc.pop("password_hash", None)
        return {"token": token, "user": _to_mobile_user(doc)}

    @r.post("/auth/demo")
    async def mobile_demo(req: MobileDemoRequest, response: Response):
        role = req.role if req.role in ("client", "developer", "tester", "admin") else "client"
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        email = f"demo_{uuid.uuid4().hex[:8]}@demo.devos.io"

        # Demo project for client demos — includes pricing + seeded modules so
        # Analytics Dashboard lands with real work breakdown (not "0 modules").
        project_id = None
        if role == "client":
            from decomposition_engine import decompose_project
            project_id = f"proj_{uuid.uuid4().hex[:12]}"
            demo_goal = "Analytics dashboard for a SaaS product with auth, charts, CSV export and team roles"
            demo_pricing = {
                "mode": "hybrid",
                "base_estimate": 2000.0,
                "price_multiplier": 0.75,
                "final_price": 1500.0,
                "speed_multiplier": 0.8,
                "quality_band": "enhanced",
            }
            project_doc = {
                "project_id": project_id,
                "client_id": user_id,
                "name": "Analytics Dashboard",
                "goal": demo_goal,
                "production_mode": "hybrid",
                "pricing": demo_pricing,
                "current_stage": "development",
                "progress": 35,
                "status": "active",
                "is_demo": True,
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
            }
            await _db.projects.insert_one(project_doc)
            # L4 decomposition: goal → modules with budget split.
            modules = decompose_project(demo_goal, project_doc)
            # Make the demo feel alive: mark 1st module done, 2nd in progress,
            # rest pending. Mirrors what a 35% project looks like in reality.
            _seed_now = datetime.now(timezone.utc)
            if modules:
                if len(modules) >= 1:
                    modules[0]["status"] = "done"
                    modules[0]["progress"] = 100
                    modules[0]["completed_at"] = _seed_now.isoformat()
                if len(modules) >= 2:
                    modules[1]["status"] = "in_progress"
                    modules[1]["progress"] = 50
                    # Stamp so module_motion knows when it started — otherwise
                    # it would flip to review on the very first tick.
                    modules[1]["started_at"] = _seed_now.isoformat()
                await _db.modules.insert_many(modules)

        # Realistic demo identity — not "Demo Client", which feels like a
        # debug screen. Names flip per role so two demo sessions look distinct.
        demo_names = {
            "client": "Jordan Lee",
            "developer": "Alex Chen",
            "admin": "Morgan Vale",
            "tester": "Riley Sato",
        }
        display_name = demo_names.get(role, role.title())

        doc = {
            "user_id": user_id,
            "email": email,
            "name": display_name,
            "picture": None,
            "role": role,
            "roles": [role],
            "active_role": role,
            # L0: demo user must start with the state that matches its role so
            # Smart Home renders the right section immediately (a demo client
            # already has a seeded project, a demo dev should see work sections).
            "states": [role] if role in ("client", "developer", "admin") else [],
            "active_context": role if role in ("client", "developer", "admin") else None,
            "is_demo": True,
            "skills": [],
            "level": "middle",
            "rating": 5.0,
            "completed_tasks": 0,
            "active_load": 0,
            "capacity": 5,
            "created_at": _now_iso(),
        }
        await _db.users.insert_one(doc)

        # Demo developer seeding: create a phantom client + project + assigned
        # modules so Dev Home immediately shows active work, QA queue and
        # earnings. Without this, DevSection is a dead page ("0 active 0 QA").
        if role == "developer":
            from decomposition_engine import decompose_project
            phantom_client_id = f"user_demo_client_{uuid.uuid4().hex[:8]}"
            dev_project_id = f"proj_{uuid.uuid4().hex[:12]}"
            dev_goal = "Marketing landing page with CMS blocks, lead form and analytics"
            dev_pricing = {
                "mode": "hybrid",
                "base_estimate": 1500.0,
                "price_multiplier": 0.75,
                "final_price": 1125.0,
                "speed_multiplier": 0.8,
                "quality_band": "enhanced",
            }
            dev_project_doc = {
                "project_id": dev_project_id,
                "client_id": phantom_client_id,
                "name": "Marketing Landing",
                "goal": dev_goal,
                "production_mode": "hybrid",
                "pricing": dev_pricing,
                "current_stage": "development",
                "progress": 25,
                "status": "active",
                "is_demo": True,
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
            }
            await _db.projects.insert_one(dev_project_doc)
            dev_mods = decompose_project(dev_goal, dev_project_doc)
            _now_dt = datetime.now(timezone.utc)
            if dev_mods:
                # Module 0 — actively worked on by this dev
                if len(dev_mods) >= 1:
                    dev_mods[0]["status"] = "in_progress"
                    dev_mods[0]["progress"] = 35
                    dev_mods[0]["assigned_to"] = user_id
                    dev_mods[0]["started_at"] = _now_dt.isoformat()
                # Module 1 — in QA waiting for review
                if len(dev_mods) >= 2:
                    dev_mods[1]["status"] = "review"
                    dev_mods[1]["progress"] = 80
                    dev_mods[1]["assigned_to"] = user_id
                    dev_mods[1]["review_at"] = _now_dt.isoformat()
                # Module 2 — already done + approved payout (dev earned something)
                if len(dev_mods) >= 3:
                    dev_mods[2]["status"] = "done"
                    dev_mods[2]["progress"] = 100
                    dev_mods[2]["assigned_to"] = user_id
                    dev_mods[2]["completed_at"] = _now_dt.isoformat()
                await _db.modules.insert_many(dev_mods)
                # Approved payout for the completed module so Earnings > 0.
                if len(dev_mods) >= 3:
                    paid_price = float(dev_mods[2].get("final_price") or dev_mods[2].get("price") or 300)
                    await _db.payouts.insert_one({
                        "payout_id": f"pay_{uuid.uuid4().hex[:12]}",
                        "module_id": dev_mods[2]["module_id"],
                        "project_id": dev_project_id,
                        "developer_id": user_id,
                        "amount": round(paid_price * 0.6, 2),
                        "status": "approved",
                        "created_at": _now_iso(),
                    })

        token = await _create_session(user_id)
        response.set_cookie(
            key="session_token", value=token, httponly=True, secure=True, samesite="none", path="/",
            max_age=7 * 24 * 60 * 60,
        )
        return {"token": token, "user": _to_mobile_user(doc), "project_id": project_id}

    @r.post("/auth/google")
    async def mobile_google(req: dict, response: Response):
        """Mobile-side Google Sign-In.

        Expects `{ credential: <google_id_token> }` (also accepts `id_token`
        alias for native SDKs that name it differently). Verifies the JWT
        with Google, find-or-creates the user, and returns the bearer-token
        shape the Expo app expects: `{ token, user }`.

        REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT
        URLS, THIS BREAKS THE AUTH.
        """
        import os as _os
        from google.oauth2 import id_token as _gid_token
        from google.auth.transport import requests as _g_req

        client_id = _os.environ.get("GOOGLE_CLIENT_ID", "").strip()
        if not client_id:
            raise HTTPException(status_code=503, detail="Google Sign-In not configured")

        token_jwt = (req.get("credential") or req.get("id_token") or "").strip()
        if not token_jwt:
            raise HTTPException(status_code=400, detail="Missing Google ID token")

        try:
            claims = _gid_token.verify_oauth2_token(
                token_jwt, _g_req.Request(), client_id, clock_skew_in_seconds=10,
            )
        except ValueError as e:
            raise HTTPException(status_code=401, detail=f"Google token invalid: {e}")

        google_sub = claims.get("sub")
        email = (claims.get("email") or "").strip().lower()
        if not google_sub or not email or not claims.get("email_verified"):
            raise HTTPException(status_code=401, detail="Google token missing verified email/sub")
        name = claims.get("name") or claims.get("given_name") or email.split("@")[0]
        picture = claims.get("picture")

        # Find by google_sub first (immutable), else by email (merge existing account).
        user = await _db.users.find_one({"google_sub": google_sub}, {"_id": 0}) \
            or await _db.users.find_one({"email": email}, {"_id": 0})

        if user:
            await _db.users.update_one(
                {"user_id": user["user_id"]},
                {"$set": {
                    "google_sub": google_sub,
                    "picture": user.get("picture") or picture,
                    "last_login_at": _now_iso(),
                    "auth_provider": "google",
                }},
            )
            user = await _db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
        else:
            user_id = f"user_{uuid.uuid4().hex[:12]}"
            user = {
                "user_id": user_id,
                "email": email,
                "name": name,
                "picture": picture,
                "role": "client",
                "roles": ["client"],
                "active_role": "client",
                "states": ["client"],
                "active_context": "client",
                "level": "junior",
                "skills": [],
                "capacity": 5,
                "tier": "starter",
                "rating": 5.0,
                "source": "google",
                "auth_provider": "google",
                "google_sub": google_sub,
                "completed_tasks": 0,
                "active_load": 0,
                "active_modules": 0,
                "created_at": _now_iso(),
                "last_login_at": _now_iso(),
            }
            await _db.users.insert_one(user)
            user = await _db.users.find_one({"user_id": user_id}, {"_id": 0})

        token = await _create_session(user["user_id"])
        response.set_cookie(
            key="session_token", value=token, httponly=True, secure=True, samesite="none", path="/",
            max_age=7 * 24 * 60 * 60,
        )
        return {"token": token, "user": _to_mobile_user(user)}

    @r.get("/auth/me")
    async def mobile_me(user=Depends(_get_current_user)):
        # Read raw doc — Pydantic User model drops roles[] / active_role / tier.
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        raw = await _db.users.find_one({"user_id": uid}, {"_id": 0})
        return {"user": _to_mobile_user(raw or {})}

    @r.post("/auth/logout")
    async def mobile_logout(request: Request, response: Response):
        token = request.cookies.get("session_token")
        if not token:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]
        if token:
            await _db.user_sessions.delete_one({"session_token": token})
        response.delete_cookie(key="session_token", path="/")
        return {"ok": True}

    @r.post("/auth/switch-role")
    async def mobile_switch_role(req: MobileSwitchRoleRequest, user=Depends(_get_current_user)):
        user_id = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        role = req.role
        existing = await _db.users.find_one({"user_id": user_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")
        roles = existing.get("roles") or [existing.get("role")]
        if role not in roles and existing.get("role") != role:
            # Allow admin to switch to anything; otherwise require role in roles[]
            if existing.get("role") != "admin":
                raise HTTPException(status_code=403, detail=f"Role '{role}' not available")
        await _db.users.update_one(
            {"user_id": user_id},
            {"$set": {"active_role": role, "role": role}},
        )
        updated = await _db.users.find_one({"user_id": user_id}, {"_id": 0})
        return {"user": _to_mobile_user(updated)}

    # ─────────── DEVELOPER ───────────
    @r.get("/developer/home")
    async def mobile_developer_home(user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        # Active modules
        active = await _db.modules.find(
            {"assigned_to": uid, "status": {"$in": ["in_progress", "reserved", "qa_review", "review"]}},
            {"_id": 0, "module_id": 1, "title": 1, "status": 1, "price": 1, "final_price": 1, "estimated_hours": 1},
        ).to_list(50)
        # Marketplace opportunities
        open_mods = await _db.modules.find(
            {"status": {"$in": ["open", "open_for_bids"]}},
            {"_id": 0, "module_id": 1, "title": 1, "price": 1, "final_price": 1, "estimated_hours": 1, "template_type": 1},
        ).to_list(20)
        # Earnings summary
        earned = await _db.earnings.aggregate([
            {"$match": {"developer_id": uid, "status": {"$in": ["paid", "pending"]}}},
            {"$group": {"_id": "$status", "total": {"$sum": "$amount"}}},
        ]).to_list(10) if True else []
        paid = sum(e["total"] for e in earned if e["_id"] == "paid")
        pending = sum(e["total"] for e in earned if e["_id"] == "pending")
        return {
            "active_modules": active,
            "active_count": len(active),
            "opportunities": open_mods,
            "opportunities_count": len(open_mods),
            "earnings": {"paid": paid, "pending": pending, "total": paid + pending},
            "generated_at": _now_iso(),
        }

    # ─────────── CLIENT ───────────
    # IS-5 cleanup (Stage 3.5/C): the previous handlers for
    #   GET /client/opportunities
    #   GET /client/revenue-timeline
    # were registered here but **always shadowed** by the canonical handlers
    # in `revenue_brain.py:407,443` because `revenue_brain.build_router()` is
    # mounted before `mobile_adapter.build_router()` in server.py
    # (~lines 24211 vs 24243). They were unreachable dead code and confused
    # heatmap retirement logic. Removed in Stage 3.5/C — no behaviour change
    # (revenue_brain handlers continue to serve all traffic).

    # ─────────── FLOW ───────────
    @r.get("/flow/recommendations")
    async def mobile_flow_recommendations(user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        role = user.role if hasattr(user, "role") else user.get("role")
        # Developer → list of recommended modules
        if role == "developer":
            mods = await _db.modules.find(
                {"status": {"$in": ["open", "open_for_bids"]}},
                {"_id": 0, "module_id": 1, "title": 1, "description": 1, "price": 1,
                 "final_price": 1, "estimated_hours": 1, "template_type": 1},
            ).to_list(20)
            # score is a simple stub for mobile surface
            for i, m in enumerate(mods):
                m["fit"] = "good" if i < 3 else "fair"
                m["score"] = max(50, 90 - i * 5)
            return {"recommendations": mods, "count": len(mods)}
        # Client → aggregated opportunities + recommended actions
        if role == "client":
            opps = await _db.client_opportunities.find(
                {"client_id": uid, "status": {"$in": ["pending", "open"]}},
                {"_id": 0},
            ).to_list(20)
            return {"recommendations": opps, "count": len(opps)}
        # Admin → empty (admin uses operator feed)
        return {"recommendations": [], "count": 0}

    return r


class BidRequest(BaseModel):
    proposed_price: float
    delivery_days: int
    message: Optional[str] = ""


class AssignRequest(BaseModel):
    bid_id: Optional[str] = None
    developer_id: Optional[str] = None
    recommendation_id: Optional[str] = None


# ─────────────────────────────────────────────────────────────
# Phase 10.5 — Market Magic
# Three triggers that make the system PROVOKE actions, not just react.
# All fire asynchronously after a real bid lands — no blocking HTTP paths.
# ─────────────────────────────────────────────────────────────
async def _magic_counter_move(module_id: str, triggering_dev_id: str):
    """Trigger 1 — Immediate Counter-Move.
    After 20–40s, pick another seeded dev (who hasn't bid yet) and create
    a competing bid. Also create an operator invite for visibility.
    """
    await asyncio.sleep(random.randint(20, 40))
    try:
        module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not module or module.get("status") not in ("open", "open_for_bids"):
            return
        existing_bidders = {
            b["developer_id"] async for b in _db.bids.find(
                {"module_id": module_id}, {"_id": 0, "developer_id": 1}
            )
        }
        candidates = await _db.users.find(
            {"role": "developer", "bootstrap_tag": "bootstrap_v1"},
            {"_id": 0, "user_id": 1, "name": 1, "rating": 1},
        ).to_list(50)
        candidates = [d for d in candidates if d["user_id"] not in existing_bidders]
        if not candidates:
            return
        # Prefer higher-rated dev to create credible competition
        candidates.sort(key=lambda d: -(d.get("rating") or 0))
        picked = candidates[0]
        base_price = module.get("price") or 1000
        bid_amount = int(base_price * random.uniform(0.88, 1.05))
        now = _now()
        await _db.bids.insert_one({
            "bid_id": f"bid_{uuid.uuid4().hex[:12]}",
            "module_id": module_id,
            "developer_id": picked["user_id"],
            "amount": bid_amount,
            "estimated_hours": (module.get("estimated_hours") or 10) + random.randint(-2, 2),
            "delivery_days": max(1, (module.get("estimated_hours") or 10) // 8),
            "message": "Auto-competing bid",
            "status": "pending",
            "created_at": now.isoformat(),
            "source": "magic_counter_move",
            "triggered_by_bid": {"module_id": module_id, "triggering_dev": triggering_dev_id},
        })
        await _db.users.update_one(
            {"user_id": picked["user_id"]},
            {"$set": {"last_active_at": now.isoformat()}},
        )
        # Operator invite record (non-blocking — existing collection or new)
        await _db.module_invitations.insert_one({
            "invitation_id": f"inv_{uuid.uuid4().hex[:12]}",
            "module_id": module_id,
            "developer_id": picked["user_id"],
            "invited_by": "operator_magic",
            "reason": "counter_move",
            "created_at": now.isoformat(),
            "status": "active",
        })
        logger.info(
            f"MAGIC counter_move: {picked.get('name','?')} → module {module_id[-6:]} "
            f"(${bid_amount})  [triggered by bid from {triggering_dev_id[-6:]}]"
        )
    except Exception as e:
        logger.warning(f"magic counter_move failed: {e}")


async def _magic_client_pull(module_id: str):
    """Trigger 2 — Client Pull.
    If a module accumulates ≥2 bids, create a client-side notification
    ('You have N offers waiting') so the client feels pulled in.
    """
    try:
        bid_count = await _db.bids.count_documents({"module_id": module_id})
        if bid_count < 2:
            return
        module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not module:
            return
        project_id = module.get("project_id")
        project = await _db.projects.find_one({"project_id": project_id}, {"_id": 0}) if project_id else None
        client_id = (project or {}).get("client_id")
        if not client_id:
            return
        # Idempotent upsert — one pending notification per module
        await _db.client_notifications.update_one(
            {"client_id": client_id, "module_id": module_id, "status": "pending"},
            {"$set": {
                "client_id": client_id,
                "module_id": module_id,
                "project_id": project_id,
                "bid_count": bid_count,
                "title": f"{bid_count} developers competing for your module",
                "message": f"'{module.get('title', 'Module')}' — review offers to pick the best fit.",
                "cta_label": "Review offers",
                "cta_route": f"/workspace/{project_id}",
                "status": "pending",
                "priority": "high" if bid_count >= 3 else "medium",
                "updated_at": _now_iso(),
            },
             "$setOnInsert": {
                "notification_id": f"notif_{uuid.uuid4().hex[:12]}",
                "created_at": _now_iso(),
                "source": "magic_client_pull",
             }},
            upsert=True,
        )
        # Also mirror into client_opportunities (existing surface)
        await _db.client_opportunities.update_one(
            {"client_id": client_id, "module_id": module_id, "type": "offers_ready"},
            {"$set": {
                "client_id": client_id,
                "module_id": module_id,
                "project_id": project_id,
                "type": "offers_ready",
                "title": f"{bid_count} offers ready to review",
                "bid_count": bid_count,
                "status": "pending",
                "updated_at": _now_iso(),
            },
             "$setOnInsert": {
                "opportunity_id": f"opp_{uuid.uuid4().hex[:12]}",
                "created_at": _now_iso(),
             }},
            upsert=True,
        )
        logger.info(f"MAGIC client_pull: client {client_id[-6:]} ← module {module_id[-6:]} ({bid_count} offers)")
    except Exception as e:
        logger.warning(f"magic client_pull failed: {e}")


async def auto_progress_scan() -> Dict[str, Any]:
    """Trigger 3 — Auto-Progress.
    Scan modules that have ≥2 bids but the client hasn't acted for 2–5 min.
    Create a `recommended_decision` row so UI can show 'Suggested: Assign X'.
    Returns summary of actions.
    """
    if _db is None:
        return {"ok": False}
    now = _now()
    cutoff = now - timedelta(minutes=2)
    recommendations = 0
    # Find modules with 2+ bids, still open, whose latest bid is ≥2 min old
    pipeline = [
        {"$match": {"status": "pending"}},
        {"$group": {
            "_id": "$module_id",
            "count": {"$sum": 1},
            "latest_at": {"$max": "$created_at"},
        }},
        {"$match": {"count": {"$gte": 2}}},
    ]
    agg = await _db.bids.aggregate(pipeline).to_list(200)
    for row in agg:
        try:
            latest_at = datetime.fromisoformat(row["latest_at"]) if isinstance(row["latest_at"], str) else row["latest_at"]
            # ensure tz-aware
            if latest_at.tzinfo is None:
                latest_at = latest_at.replace(tzinfo=timezone.utc)
            if latest_at > cutoff:
                continue  # too fresh
        except Exception:
            continue
        mod_id = row["_id"]
        module = await _db.modules.find_one({"module_id": mod_id}, {"_id": 0})
        if not module or module.get("status") not in ("open", "open_for_bids"):
            continue
        # Skip if recommendation already made
        already = await _db.recommended_decisions.find_one(
            {"module_id": mod_id, "status": "pending"}, {"_id": 0}
        )
        if already:
            continue
        # Pick top bid (best price/time ratio)
        bids = await _db.bids.find(
            {"module_id": mod_id, "status": "pending"}, {"_id": 0}
        ).to_list(20)
        if len(bids) < 2:
            continue
        # Score: lower price + faster delivery = better
        for b in bids:
            days = b.get("delivery_days") or max(1, (b.get("estimated_hours") or 10) // 8)
            b["_score"] = 1.0 / (float(b["amount"]) * max(1, days))
        bids.sort(key=lambda b: -b["_score"])
        winner = bids[0]
        dev = await _db.users.find_one({"user_id": winner["developer_id"]}, {"_id": 0})
        project_id = module.get("project_id")
        project = await _db.projects.find_one({"project_id": project_id}, {"_id": 0}) if project_id else None
        client_id = (project or {}).get("client_id")
        await _db.recommended_decisions.insert_one({
            "recommendation_id": f"rec_{uuid.uuid4().hex[:12]}",
            "module_id": mod_id,
            "project_id": project_id,
            "client_id": client_id,
            "type": "assign_developer",
            "suggested_developer_id": winner["developer_id"],
            "suggested_developer_name": (dev or {}).get("name"),
            "suggested_price": winner["amount"],
            "suggested_days": winner.get("delivery_days", 3),
            "rationale": f"Best price/time from {len(bids)} offers",
            "status": "pending",
            "created_at": now.isoformat(),
            "source": "magic_auto_progress",
        })
        recommendations += 1
        logger.info(
            f"MAGIC auto_progress: module {mod_id[-6:]} → suggest {winner['developer_id'][-6:]} "
            f"(${winner['amount']}, {winner.get('delivery_days','?')}d) from {len(bids)} bids"
        )
    return {"ok": True, "recommendations_created": recommendations, "scanned": len(agg)}


def _schedule_magic(module_id: str, triggering_dev_id: str):
    """Fire all triggers in background — no blocking HTTP."""
    asyncio.create_task(_magic_counter_move(module_id, triggering_dev_id))
    asyncio.create_task(_magic_client_pull(module_id))


# ─────────────────────────────────────────────────────────────
# Phase 10 Layer 1 — Canonical (non-/mobile) aliases for legacy frontend paths
# These are mounted directly under /api/* to match paths the existing UI calls.
# ─────────────────────────────────────────────────────────────
def build_legacy_aliases() -> APIRouter:
    r = APIRouter(tags=["mobile-compat-aliases"])

    # COMPAT: legacy /marketplace/feed → canonical /api/marketplace/modules
    @r.get("/marketplace/feed")
    @compat_decorator(canonical="/api/marketplace/modules")
    async def marketplace_feed(request: Request, user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        dev = await _db.users.find_one({"user_id": uid}, {"_id": 0})
        capacity_max = int((dev or {}).get("capacity") or 5)
        used = int((dev or {}).get("active_load") or (dev or {}).get("active_modules") or 0)
        open_mods = await _db.modules.find(
            {"status": {"$in": ["open", "open_for_bids"]}},
            {"_id": 0, "module_id": 1, "title": 1, "description": 1,
             "price": 1, "final_price": 1, "base_price": 1,
             "estimated_hours": 1, "template_type": 1, "status": 1,
             "project_id": 1, "created_at": 1},
        ).to_list(100)
        # Count bids per module (cheap; OK at seed scale)
        enriched = []
        for m in open_mods:
            n = await _db.bids.count_documents({"module_id": m["module_id"]})
            # Did I already bid?
            mine = await _db.bids.find_one({"module_id": m["module_id"], "developer_id": uid})
            m["bid_count"] = n
            m["already_bid"] = bool(mine)
            enriched.append(m)
        return {
            "modules": enriched,
            "capacity": {"used": used, "max": capacity_max},
            "total": len(enriched),
        }

    # COMPAT: legacy /developer/rank → canonical /api/developer/intelligence/rank
    # Stage 3.2.5: legacy now forwards to the shared `compute_developer_rank`
    # helper in developer_intelligence.py — single source of truth, byte-identical
    # response shape with the canonical endpoint.
    @r.get("/developer/rank")
    @compat_decorator(canonical="/api/developer/intelligence/rank")
    async def developer_rank(request: Request, user=Depends(_get_current_user)):
        from developer_intelligence import compute_developer_rank
        return await compute_developer_rank(_db, user)

    # NOTE: /modules/{id}/bid is currently the ONLY implementation. Stage 3.2
    # heatmap labeled `/api/marketplace/modules/{id}/bid` as the canonical, but
    # that endpoint does not exist. Stage 3.2.5 (parity creation) DEFERRED for
    # this surface — the canonical needs to be created before instrumentation
    # can point at a real path. Until then, this route IS the canonical and
    # carries no compat headers (per IS-6: aspirational labels removed).
    @r.post("/modules/{module_id}/bid")
    async def submit_bid(module_id: str, req: BidRequest = Body(...), user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not module:
            raise HTTPException(status_code=404, detail="Module not found")
        if module.get("status") not in ("open", "open_for_bids"):
            raise HTTPException(status_code=400, detail=f"Module not open (status: {module.get('status')})")
        # Prevent duplicate bid from same developer
        existing = await _db.bids.find_one({"module_id": module_id, "developer_id": uid})
        if existing:
            raise HTTPException(status_code=409, detail="You already bid on this module")
        bid_id = f"bid_{uuid.uuid4().hex[:12]}"
        now = _now()
        await _db.bids.insert_one({
            "bid_id": bid_id,
            "module_id": module_id,
            "developer_id": uid,
            "amount": float(req.proposed_price),
            "estimated_hours": int(req.delivery_days) * 8,
            "delivery_days": int(req.delivery_days),
            "message": req.message or "",
            "status": "pending",
            "created_at": now.isoformat(),
            "source": "real_user_bid",
        })
        # Update dev last_active_at (real activity signal)
        await _db.users.update_one(
            {"user_id": uid},
            {"$set": {"last_active_at": now.isoformat()}},
        )
        # ✨ MAGIC — triggers that make the system provoke more action
        _schedule_magic(module_id, uid)
        return {"ok": True, "bid_id": bid_id, "module_id": module_id, "amount": req.proposed_price}

    # ─────────── MAGIC surface ───────────
    @r.get("/magic/status")
    async def magic_status(user=Depends(_get_current_user)):
        """Snapshot of everything magic has produced."""
        counter_moves = await _db.bids.count_documents({"source": "magic_counter_move"})
        client_notifs = await _db.client_notifications.count_documents({"source": "magic_client_pull"})
        recs_pending = await _db.recommended_decisions.count_documents({"source": "magic_auto_progress", "status": "pending"})
        recs_total = await _db.recommended_decisions.count_documents({"source": "magic_auto_progress"})
        real_bids = await _db.bids.count_documents({"source": "real_user_bid"})
        recent_counter = await _db.bids.find(
            {"source": "magic_counter_move"}, {"_id": 0, "bid_id": 1, "module_id": 1, "amount": 1, "created_at": 1}
        ).sort("created_at", -1).to_list(5)
        recent_recs = await _db.recommended_decisions.find(
            {"source": "magic_auto_progress"}, {"_id": 0}
        ).sort("created_at", -1).to_list(5)
        return {
            "real_user_bids": real_bids,
            "counter_moves": counter_moves,
            "client_notifications": client_notifs,
            "recommendations_pending": recs_pending,
            "recommendations_total": recs_total,
            "recent_counter_moves": recent_counter,
            "recent_recommendations": recent_recs,
        }

    @r.post("/magic/auto-progress-scan")
    async def magic_auto_progress(user=Depends(_get_current_user)):
        """Manual trigger for auto-progress (normally runs on schedule)."""
        return await auto_progress_scan()

    # CANONICAL: /client/notifications IS the canonical path for the
    # `client_notifications` domain (Magic Client Pull). It reads from the
    # `client_notifications` collection — semantically distinct from
    # `/api/notifications/my` which reads the general `notifications`
    # collection. The two are NOT migrations of each other.
    # Stage 3.2.5: removed the aspirational @compat_decorator that previously
    # labeled this as an alias to /api/notifications/my.
    @r.get("/client/notifications")
    async def client_notifications(request: Request, user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        items = await _db.client_notifications.find(
            {"client_id": uid, "status": "pending"}, {"_id": 0}
        ).sort("created_at", -1).to_list(50)
        return {"notifications": items, "count": len(items)}

    @r.get("/client/recommendations")
    async def client_recommendations(user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        items = await _db.recommended_decisions.find(
            {"client_id": uid, "status": "pending"}, {"_id": 0}
        ).sort("created_at", -1).to_list(50)
        return {"recommendations": items, "count": len(items)}

    # ─────────── CLOSE THE LOOP ───────────
    # POST /api/modules/{id}/assign
    # The one endpoint that turns magic into actual work.
    # Accepts any of: bid_id | developer_id | recommendation_id
    # Transitions: module → in_progress, chosen bid → accepted, other bids → rejected
    # NOTE: /modules/{id}/assign — sole implementation. Stage 3.2 heatmap labeled
    # `/api/admin/modules/{id}/assign` as the canonical, but no such endpoint
    # exists. Stage 3.2.5 (parity creation) DEFERRED here — same reasoning as
    # /bid above (IS-6: aspirational labels removed).
    @r.post("/modules/{module_id}/assign")
    async def assign_module(module_id: str, req: AssignRequest = Body(...), user=Depends(_get_current_user)):
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        role = user.role if hasattr(user, "role") else user.get("role")

        module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not module:
            raise HTTPException(status_code=404, detail="Module not found")
        if module.get("status") not in ("open", "open_for_bids"):
            raise HTTPException(status_code=409, detail=f"Module already {module.get('status')}")

        # Authorization: only project's client or admin may assign
        project = await _db.projects.find_one({"project_id": module.get("project_id")}, {"_id": 0})
        project_client = (project or {}).get("client_id")
        if role != "admin" and project_client and project_client != uid:
            raise HTTPException(status_code=403, detail="Only the project client or admin can assign")

        # Resolve the target bid
        rec = None
        if req.recommendation_id:
            rec = await _db.recommended_decisions.find_one(
                {"recommendation_id": req.recommendation_id, "module_id": module_id, "status": "pending"},
                {"_id": 0},
            )
            if not rec:
                raise HTTPException(status_code=404, detail="Recommendation not found or not pending")

        chosen_bid = None
        if req.bid_id:
            chosen_bid = await _db.bids.find_one({"bid_id": req.bid_id, "module_id": module_id}, {"_id": 0})
        elif rec and rec.get("suggested_developer_id"):
            chosen_bid = await _db.bids.find_one(
                {"module_id": module_id, "developer_id": rec["suggested_developer_id"], "status": "pending"},
                {"_id": 0},
            )
        elif req.developer_id:
            chosen_bid = await _db.bids.find_one(
                {"module_id": module_id, "developer_id": req.developer_id, "status": "pending"},
                {"_id": 0},
            )
        else:
            # No target given — pick best by price/time
            all_bids = await _db.bids.find(
                {"module_id": module_id, "status": "pending"}, {"_id": 0}
            ).to_list(50)
            if not all_bids:
                raise HTTPException(status_code=400, detail="No pending bids to assign")
            for b in all_bids:
                days = b.get("delivery_days") or max(1, (b.get("estimated_hours") or 10) // 8)
                b["_score"] = 1.0 / (float(b["amount"]) * max(1, days))
            all_bids.sort(key=lambda b: -b["_score"])
            chosen_bid = all_bids[0]

        if not chosen_bid:
            raise HTTPException(status_code=404, detail="No matching bid")
        if chosen_bid.get("status") not in ("pending", None):
            raise HTTPException(status_code=409, detail=f"Bid already {chosen_bid.get('status')}")

        dev_id = chosen_bid["developer_id"]
        dev = await _db.users.find_one({"user_id": dev_id}, {"_id": 0})
        now = _now()

        # ATOMIC-ish transitions (Mongo single-document only, but order matters)
        # 1) module → in_progress
        await _db.modules.update_one(
            {"module_id": module_id, "status": {"$in": ["open", "open_for_bids"]}},
            {"$set": {
                "status": "in_progress",
                "assigned_to": dev_id,
                "assigned_bid_id": chosen_bid["bid_id"],
                "accepted_price": chosen_bid["amount"],
                "final_price": chosen_bid["amount"],
                "accepted_at": now.isoformat(),
                "started_at": now.isoformat(),
                "last_activity_at": now.isoformat(),
            }},
        )
        # 2) chosen bid → accepted; other pending bids → rejected
        await _db.bids.update_one(
            {"bid_id": chosen_bid["bid_id"]},
            {"$set": {"status": "accepted", "accepted_at": now.isoformat(), "assigned_by": uid}},
        )
        await _db.bids.update_many(
            {"module_id": module_id, "status": "pending", "bid_id": {"$ne": chosen_bid["bid_id"]}},
            {"$set": {"status": "rejected", "rejected_at": now.isoformat()}},
        )
        # 3) dev capacity bookkeeping
        await _db.users.update_one(
            {"user_id": dev_id},
            {"$inc": {"active_modules": 1, "active_load": 1},
             "$set": {"last_active_at": now.isoformat()}},
        )
        # 4) Mark recommendation + client notification as resolved (if applicable)
        await _db.recommended_decisions.update_many(
            {"module_id": module_id, "status": "pending"},
            {"$set": {"status": "accepted", "resolved_at": now.isoformat(), "resolved_by": uid}},
        )
        await _db.client_notifications.update_many(
            {"module_id": module_id, "status": "pending"},
            {"$set": {"status": "resolved", "resolved_at": now.isoformat()}},
        )
        # 5) Event log — feeds system_truth / operator
        await _db.system_events.insert_one({
            "event_id": f"evt_{uuid.uuid4().hex[:12]}",
            "event_type": "module.assigned",
            "module_id": module_id,
            "project_id": module.get("project_id"),
            "developer_id": dev_id,
            "developer_name": (dev or {}).get("name"),
            "bid_id": chosen_bid["bid_id"],
            "amount": chosen_bid["amount"],
            "assigned_by": uid,
            "source": "magic_assign_loop_close" if req.recommendation_id else "manual_assign",
            "created_at": now.isoformat(),
        })
        logger.info(
            f"LOOP CLOSED: module {module_id[-6:]} → {(dev or {}).get('name','?')} "
            f"(${chosen_bid['amount']}, bid {chosen_bid['bid_id'][-6:]}) by {role} {uid[-6:]}"
        )

        # ✨ WORK EXECUTION — auto-create tasks so dev has something to execute
        tasks_created = 0
        try:
            import work_execution as _we  # local import to avoid circular
            tasks_created = await _we.auto_create_tasks_for_module(module_id)
        except Exception as e:
            logger.warning(f"auto_create_tasks failed: {e}")

        return {
            "ok": True,
            "module_id": module_id,
            "status": "in_progress",
            "assigned_developer": {
                "user_id": dev_id,
                "name": (dev or {}).get("name"),
                "level": (dev or {}).get("level"),
            },
            "accepted_bid": {
                "bid_id": chosen_bid["bid_id"],
                "amount": chosen_bid["amount"],
            },
            "rejected_bids": (await _db.bids.count_documents(
                {"module_id": module_id, "status": "rejected"}
            )),
            "tasks_created": tasks_created,
            "event_emitted": "module.assigned",
        }

    return r
