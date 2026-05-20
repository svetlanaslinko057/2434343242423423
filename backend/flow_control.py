"""
Wave 9 — Flow Control (Intelligence Layer)
==========================================

Ranks, recommends, invites. DOES NOT assign. Lives above the
assignment_engine (execution layer). Marketplace, bidding and
assignments logic is untouched.

Design invariants:
- Reads from: users, modules, qa_decisions, assignments (read-only)
- Writes to:  module_invitations only
- Emits on:   Socket.IO via existing realtime service
- Operator hook: flow.invite_developers(...) callable from operator_engine

Public surface:
- build_router(deps): returns APIRouter (mounted at /api/flow)
- invite_developers(module_id, developer_ids, invited_by) — callable
- recommend_top(module_id, limit=3) — callable
- wire(db, realtime)
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("flow_control")

# ─────────────────────────────────────────────────────────────
# Runtime wiring (injected by server.py)
# ─────────────────────────────────────────────────────────────
_db = None
_realtime = None
_scaling_engine = None  # Wave 11 hook — optional


def wire(*, db, realtime):
    global _db, _realtime
    _db = db
    _realtime = realtime


def set_scaling_engine(scaling_engine_module):
    """Optional: wire Wave 11 so scoring uses exposure × market_boost multipliers."""
    global _scaling_engine
    _scaling_engine = scaling_engine_module


def _now():
    return datetime.now(timezone.utc)


def _uid():
    return str(uuid.uuid4())


# ─────────────────────────────────────────────────────────────
# Pure scoring (no DB access — reusable in scheduler / tests)
# ─────────────────────────────────────────────────────────────
def _skill_match_score(dev_skills: List[str], module_type: str) -> int:
    if not dev_skills:
        return 30
    if module_type in dev_skills:
        return 100
    adjacency = {
        "backend": ["frontend"],
        "frontend": ["backend", "design"],
        "design": ["frontend"],
        "qa": [],
    }
    if any(s in dev_skills for s in adjacency.get(module_type, [])):
        return 60
    return 20


def _availability_score(active: int, cap: int) -> int:
    if cap <= 0:
        return 0
    u = active / cap
    if u >= 1.0: return 0
    if u >= 0.8: return 30
    if u >= 0.5: return 60
    return 100


def _recent_activity_score(last_iso: Optional[str]) -> int:
    if not last_iso:
        return 50
    try:
        la = datetime.fromisoformat(str(last_iso).replace("Z", "+00:00"))
        if la.tzinfo is None:
            la = la.replace(tzinfo=timezone.utc)
        hrs = (_now() - la).total_seconds() / 3600
        if hrs < 6:   return 100
        if hrs < 24:  return 80
        if hrs < 48:  return 50
        if hrs < 120: return 25
        return 0
    except Exception:
        return 50


def score_developer_for_module(
    dev: Dict[str, Any],
    module: Dict[str, Any],
    qa_pass_rate: int = 75,
    avg_delivery_days: float = 0.0,
) -> Dict[str, Any]:
    """
    score = 0.30*skill + 0.20*qa + 0.15*speed + 0.20*avail + 0.05*stab + 0.10*recent
            - overload_penalty - strike_penalty
    """
    reasons: List[str] = []
    penalties: List[str] = []

    skill = _skill_match_score(dev.get("skills") or [], module.get("type") or "backend")
    if skill >= 80: reasons.append("Strong skill match")
    elif skill >= 50: reasons.append("Adjacent skill match")

    qa = max(0, min(100, int(qa_pass_rate or 0)))
    if qa >= 90: reasons.append(f"High QA pass rate ({qa}%)")
    elif qa >= 70: reasons.append(f"Solid QA ({qa}%)")

    if avg_delivery_days <= 0:
        speed = 60
    elif avg_delivery_days <= 2: speed = 100
    elif avg_delivery_days <= 4: speed = 75
    elif avg_delivery_days <= 7: speed = 50
    else: speed = 25
    if speed >= 75: reasons.append("Fast delivery")

    # ATLLAS uses active_load; mobile used active_modules — support both
    active = int(dev.get("active_modules") or dev.get("active_load") or 0)
    cap = int(dev.get("capacity") or 0)
    avail = _availability_score(active, cap)
    if avail >= 100: reasons.append("Available now")
    elif avail == 0 and cap > 0:
        penalties.append(f"At capacity ({active}/{cap})")

    stab = max(0, min(100, int((dev.get("rating") or 0) * 20)))  # rating 0..5 → 0..100
    recent = _recent_activity_score(dev.get("last_active_at"))
    if recent >= 80: reasons.append("Recently active")
    elif recent <= 25:
        penalties.append("Low recent activity")

    strikes = int(dev.get("strikes") or 0)
    strike_pen = strikes * 10
    if strikes >= 1:
        penalties.append(f"{strikes} strike(s)")

    overload_pen = 25 if cap > 0 and active >= cap else 0

    raw = (
        0.30 * skill + 0.20 * qa + 0.15 * speed + 0.20 * avail
        + 0.05 * stab + 0.10 * recent
    )
    score = max(0, round(raw - overload_pen - strike_pen))

    if score >= 85:   fit = "strong"
    elif score >= 70: fit = "good"
    elif score >= 50: fit = "fair"
    else:             fit = "weak"

    return {
        "developer_id": dev.get("user_id"),
        "name": dev.get("name"),
        "tier": dev.get("tier") or dev.get("subscription") or "public",
        "score": score,
        "fit": fit,
        "qa_pass_rate": qa,
        "avg_delivery_days": round(avg_delivery_days, 1) if avg_delivery_days else None,
        "active": active,
        "capacity": cap,
        "skills": dev.get("skills") or [],
        "reasons": reasons[:4],
        "penalties": penalties,
    }


# ─────────────────────────────────────────────────────────────
# DB-backed helpers
# ─────────────────────────────────────────────────────────────
async def _qa_pass_rate_for(dev_id: str) -> int:
    """% of approved QA decisions for this developer. Default 75% if no history."""
    try:
        total = await _db.qa_decisions.count_documents({"developer_id": dev_id})
        if total == 0:
            return 75
        approved = await _db.qa_decisions.count_documents(
            {"developer_id": dev_id, "decision": {"$in": ["approved", "pass", "passed"]}}
        )
        return int(round(approved * 100 / total))
    except Exception:
        return 75


async def recommend_top(module_id: str, limit: int = 3) -> List[Dict[str, Any]]:
    """Core recommendation call. Returns top-N developer fits for the module.

    Wave 11: final_score = base_score * exposure * market_boost
    (if scaling_engine is wired; otherwise falls back to base_score).
    """
    if _db is None:
        return []
    module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
    if not module:
        return []
    devs = await _db.users.find({"role": "developer"}, {"_id": 0}).to_list(500)
    scored: List[Dict[str, Any]] = []
    for d in devs:
        qa = await _qa_pass_rate_for(d.get("user_id", ""))
        s = score_developer_for_module(d, module, qa_pass_rate=qa)
        # Wave 11 — apply scaling multiplier (exposure × market_boost)
        if _scaling_engine is not None:
            try:
                mult = await _scaling_engine.score_multiplier(s["developer_id"], module_id)
                s["base_score"] = s["score"]
                s["exposure"] = mult.get("exposure", 1.0)
                s["market_boost"] = mult.get("market_boost", 1.0)
                s["score"] = int(round(s["score"] * mult.get("combined", 1.0)))
            except Exception as e:
                logger.warning(f"scaling multiplier failed for {s.get('developer_id')}: {e}")
        scored.append(s)
    scored.sort(key=lambda x: -x["score"])
    return scored[: max(1, limit)]


async def invite_developers(
    module_id: str,
    developer_ids: List[str],
    invited_by: str = "system",
) -> Dict[str, Any]:
    """
    Create module_invitations records (upsert per pair, avoid duplicates).
    Returns summary. Does NOT touch assignments/marketplace.
    """
    if _db is None:
        return {"invited": [], "count": 0}
    module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
    if not module:
        raise ValueError(f"module {module_id} not found")
    invited: List[str] = []
    for dev_id in developer_ids:
        existing = await _db.module_invitations.find_one(
            {"module_id": module_id, "developer_id": dev_id},
            {"_id": 0},
        )
        if existing and existing.get("status") in ("sent", "accepted"):
            continue
        doc = {
            "invitation_id": _uid(),
            "module_id": module_id,
            "project_id": module.get("project_id"),
            "developer_id": dev_id,
            "invited_by": invited_by,
            "status": "sent",
            "invited_at": _now().isoformat(),
        }
        await _db.module_invitations.update_one(
            {"module_id": module_id, "developer_id": dev_id},
            {"$set": doc},
            upsert=True,
        )
        invited.append(dev_id)

    # Socket emits
    try:
        if _realtime is not None and invited:
            await _realtime.emit_to_role("admin", "module.invited", {
                "module_id": module_id, "developers": invited, "by": invited_by,
            })
            for d in invited:
                await _realtime.emit_to_user(d, "module.invited", {
                    "module_id": module_id,
                    "module_title": module.get("title"),
                    "project_id": module.get("project_id"),
                })
    except Exception as e:
        logger.warning(f"invite_developers emit failed: {e}")

    return {
        "module_id": module_id,
        "invited": invited,
        "count": len(invited),
    }


# ─────────────────────────────────────────────────────────────
# Router factory
# ─────────────────────────────────────────────────────────────
class InviteIn(BaseModel):
    module_id: str
    developer_ids: List[str]


def build_router(*, admin_dep: Callable, user_dep: Callable) -> APIRouter:
    r = APIRouter(tags=["flow-control"])

    @r.get("/recommended-developers/{module_id}")
    async def recommended(module_id: str, limit: int = 3, admin=Depends(admin_dep)):
        """Admin-facing: top-N developer fits for a module."""
        module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not module:
            raise HTTPException(404, "Module not found")
        top = await recommend_top(module_id, limit=limit)
        # Mark already-invited
        inv = await _db.module_invitations.find(
            {"module_id": module_id, "status": "sent"}, {"_id": 0, "developer_id": 1}
        ).to_list(500)
        invited_ids = {i["developer_id"] for i in inv}
        for t in top:
            t["already_invited"] = t["developer_id"] in invited_ids
        try:
            if _realtime is not None:
                await _realtime.emit_to_role(
                    "admin", "flow.recommendation.updated",
                    {"module_id": module_id, "top": [t["developer_id"] for t in top]},
                )
        except Exception:
            pass
        return {"module_id": module_id, "top": top, "count": len(top)}

    @r.post("/invite-developers")
    async def invite(body: InviteIn, admin=Depends(admin_dep)):
        """Admin-triggered invite. Writes module_invitations, no assignment."""
        try:
            res = await invite_developers(
                body.module_id, body.developer_ids,
                invited_by=getattr(admin, "user_id", "admin"),
            )
        except ValueError as e:
            raise HTTPException(404, str(e))
        return res

    @r.post("/reopen-bidding/{module_id}")
    async def reopen(module_id: str, admin=Depends(admin_dep)):
        """Reset module to open. Does NOT touch assignment/reassign."""
        module = await _db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not module:
            raise HTTPException(404, "Module not found")
        prev_assignee = module.get("assigned_to")
        await _db.modules.update_one(
            {"module_id": module_id},
            {"$set": {
                "status": "open",
                "assigned_to": None,
                "started_at": None,
            }, "$inc": {"reopened_count": 1}},
        )
        try:
            if _realtime is not None:
                await _realtime.emit_to_role("admin", "module.reopened", {
                    "module_id": module_id,
                    "title": module.get("title"),
                    "previous_assignee": prev_assignee,
                })
                await _realtime.emit_to_role("developer", "module.reopened", {
                    "module_id": module_id,
                    "title": module.get("title"),
                })
        except Exception as e:
            logger.warning(f"reopen emit failed: {e}")
        return {
            "ok": True,
            "module_id": module_id,
            "previous_assignee": prev_assignee,
        }

    @r.get("/developer-recommendations")
    async def dev_recs(user=Depends(user_dep)):
        """Developer-facing: modules invited to me + open modules ranked for me."""
        uid = getattr(user, "user_id", None)
        if not uid:
            return {"invitations": [], "recommended": []}

        invitations = await _db.module_invitations.find(
            {"developer_id": uid, "status": "sent"}, {"_id": 0}
        ).sort("invited_at", -1).to_list(50)
        # Enrich with module/project
        for inv in invitations:
            m = await _db.modules.find_one({"module_id": inv["module_id"]}, {"_id": 0})
            if m:
                inv["title"] = m.get("title")
                inv["price"] = m.get("price")
                inv["type"] = m.get("type")
                inv["module_status"] = m.get("status")

        # Top open modules fit for this developer (read-only, does not hide marketplace)
        dev = await _db.users.find_one({"user_id": uid}, {"_id": 0})
        open_mods = await _db.modules.find(
            {"status": {"$in": ["open", "open_for_bids"]}}, {"_id": 0}
        ).to_list(200)
        ranked: List[Dict[str, Any]] = []
        for m in open_mods:
            # simple reverse-score — reuse developer-scoring on (dev, m)
            fit = score_developer_for_module(dev or {}, m, qa_pass_rate=75)
            if fit["score"] >= 50:
                ranked.append({
                    "module_id": m.get("module_id"),
                    "title": m.get("title"),
                    "type": m.get("type"),
                    "price": m.get("price"),
                    "project_id": m.get("project_id"),
                    "score": fit["score"],
                    "fit": fit["fit"],
                    "why": fit["reasons"],
                })
        ranked.sort(key=lambda x: -x["score"])

        return {
            "invitations": invitations,
            "recommended": ranked[:10],
        }

    return r
