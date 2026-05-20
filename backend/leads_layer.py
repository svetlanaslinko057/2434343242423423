"""
Visitor → Lead → Client bridge.

Flow:
    Visitor (no account)
        ↓ POST /api/leads/intake  (email + saved estimate)
    Lead (locked, read-only)
        ↓ logs in with same email
    Client (real cabinet, workspace with modules)

Purpose: never lose the estimate. A visitor who typed a real product
description and saw a price should be able to come back (or sign in)
and find their product plan waiting — not start over.
"""

from fastapi import APIRouter, HTTPException, Depends, Body
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Any, Dict, List
from datetime import datetime, timezone
import uuid
import logging

logger = logging.getLogger(__name__)


# Injected on wire()
_db = None
_get_current_user = None


def wire(db, get_current_user):
    global _db, _get_current_user
    _db = db
    _get_current_user = get_current_user


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_email(email: str) -> str:
    return (email or "").strip().lower()


class LeadIntake(BaseModel):
    email: EmailStr
    goal: str = Field(..., min_length=10, max_length=4000)
    mode: str = "hybrid"
    estimate: Optional[Dict[str, Any]] = None  # whole estimate payload we computed client-side


class LeadOut(BaseModel):
    lead_id: str
    email: str
    goal: str
    mode: str
    estimate: Optional[Dict[str, Any]] = None
    state: str
    locked: bool
    created_at: str
    claimed_at: Optional[str] = None
    claimed_project_id: Optional[str] = None


def build_router() -> APIRouter:
    """Mounted at /api/leads/* in server.py."""
    router = APIRouter(prefix="/leads", tags=["leads"])

    @router.post("/intake")
    async def lead_intake(body: LeadIntake):
        """
        Save a visitor's estimate as a `lead`. No auth required.

        Returns a lead_id. The client stores this in AsyncStorage so after
        login/registration we can attach the lead to the new user.
        """
        email = _clean_email(body.email)
        if body.mode not in ("ai", "hybrid", "dev"):
            raise HTTPException(status_code=400, detail="mode must be ai | hybrid | dev")

        # If a user already exists with this email, we still accept the lead
        # so the visitor gets a lead workspace. The "Sign in" CTA will then
        # drop them straight into the real client cabinet after auth.
        user = await _db.users.find_one({"email": email}, {"_id": 0, "user_id": 1}) or None
        lead_doc = {
            "lead_id": f"lead_{uuid.uuid4().hex[:12]}",
            "email": email,
            "goal": body.goal.strip(),
            "mode": body.mode,
            "estimate": body.estimate or None,
            "state": "lead",
            "locked": True,
            "has_account": bool(user),
            "created_at": _now_iso(),
            "claimed_at": None,
            "claimed_project_id": None,
        }
        await _db.leads.insert_one(lead_doc)
        logger.info(f"LEAD INTAKE: {lead_doc['lead_id']} for {email} (has_account={bool(user)})")
        # Strip _id before returning (Mongo-safe)
        lead_doc.pop("_id", None)
        return lead_doc

    @router.get("/{lead_id}")
    async def lead_get(lead_id: str):
        """Public read of a lead. Anyone with the lead_id can view it."""
        lead = await _db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
        if not lead:
            raise HTTPException(status_code=404, detail="Lead not found")
        return lead

    @router.post("/{lead_id}/claim")
    async def lead_claim(lead_id: str, user=Depends(_get_current_user)):
        """
        Convert a lead into a real client project for the authenticated user.

        Rules:
          • The authenticated user's email must equal the lead email
            (we don't let anyone steal someone else's lead).
          • Already-claimed leads are idempotent: return the same project_id.
          • Creates a project using the same logic as L0 /projects.
        """
        lead = await _db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
        if not lead:
            raise HTTPException(status_code=404, detail="Lead not found")

        # Idempotent: if lead already claimed by this user, return existing project.
        if lead.get("claimed_project_id"):
            return {
                "project_id": lead["claimed_project_id"],
                "already_claimed": True,
                "redirect": f"/workspace/{lead['claimed_project_id']}",
            }

        user_email = _clean_email(getattr(user, "email", "") or "")
        if user_email and _clean_email(lead["email"]) != user_email:
            raise HTTPException(
                status_code=403,
                detail="This lead belongs to a different email. Sign in with that email to claim it.",
            )

        # Create a project using the shared pricing + decomposition engines.
        from pricing_engine import estimate_base_price, calculate_project_pricing, get_pricing_config
        from decomposition_engine import decompose_project

        goal = lead.get("goal") or ""
        mode = lead.get("mode") or "hybrid"
        title = (goal[:80] or "New product").strip()

        pricing_cfg = await get_pricing_config(_db)
        base_estimate = estimate_base_price(goal, pricing_cfg)
        pricing = calculate_project_pricing(base_estimate, mode, pricing_cfg)
        pid = f"proj_{uuid.uuid4().hex[:12]}"
        now_iso = _now_iso()
        project_doc = {
            "project_id": pid,
            "client_id": user.user_id,
            "name": title,
            "goal": goal,
            "production_mode": mode,
            "pricing": pricing,
            "current_stage": "intake",
            "progress": 0,
            "status": "active",
            "from_lead_id": lead_id,  # provenance
            "created_at": now_iso,
        }
        modules = decompose_project(goal, project_doc)
        await _db.projects.insert_one(project_doc)
        if modules:
            await _db.modules.insert_many(modules)

        # Flip the user into client state + set active_context
        try:
            from server import _add_state  # lazy import to avoid circular
            await _add_state(user.user_id, "client", set_active=True)
        except Exception as e:
            logger.warning(f"LEAD CLAIM: _add_state failed: {e}")

        # Mark lead as claimed (keep row for analytics)
        await _db.leads.update_one(
            {"lead_id": lead_id},
            {"$set": {
                "state": "claimed",
                "locked": False,
                "claimed_at": now_iso,
                "claimed_project_id": pid,
                "claimed_by": user.user_id,
            }},
        )

        logger.info(
            f"LEAD CLAIM: {lead_id} → {pid} by {user.user_id[-8:]} "
            f"mode={mode} price={pricing['final_price']} modules={len(modules)}"
        )
        return {
            "project_id": pid,
            "pricing": pricing,
            "modules_created": len(modules),
            "redirect": f"/workspace/{pid}",
        }

    @router.get("/by-email/pending")
    async def leads_pending_for_me(user=Depends(_get_current_user)):
        """
        After login: list unclaimed leads for this user's email.

        The frontend calls this to surface: "We found 1 saved product plan
        under your email — open it" before dumping the user into the cabinet.
        """
        user_email = _clean_email(getattr(user, "email", "") or "")
        if not user_email:
            return {"leads": []}
        rows: List[Dict[str, Any]] = await _db.leads.find(
            {"email": user_email, "state": "lead", "claimed_project_id": None},
            {"_id": 0},
        ).sort("created_at", -1).to_list(length=20)
        return {"leads": rows}

    return router
