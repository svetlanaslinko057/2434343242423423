"""
Wave 9.5 — Developer Brain (Perception Layer)
=============================================

Aggregator only. Reads from:
  - developer_economy  (tier / rating / earnings / elite status)
  - flow_control       (recommendations / invites)
  - hidden_ranking     (invisible perf weight)
  - modules / qa_decisions / users (read-only stats)

NEVER writes to the database. NEVER mutates users. All motivation /
rank / capacity / missed-opportunity fields are computed on the fly.

Public surface:
  build_router(user_dep, admin_dep) → APIRouter
  detect_missed_opportunities(db, dev_id, threshold) → list  (callable from operator)
  wire(db, realtime, flow_control_module)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends

import hidden_ranking as _hr
import developer_economy as _economy

logger = logging.getLogger("developer_brain")

# ─────────────────────────────────────────────────────────────
# Runtime wiring
# ─────────────────────────────────────────────────────────────
_db = None
_realtime = None
_flow = None  # flow_control module


def wire(*, db, realtime, flow_control_module=None):
    global _db, _realtime, _flow
    _db = db
    _realtime = realtime
    _flow = flow_control_module


def _now():
    return datetime.now(timezone.utc)


# ─────────────────────────────────────────────────────────────
# Pure helpers
# ─────────────────────────────────────────────────────────────
async def _compute_hidden_rank_for(dev_id: str) -> Dict[str, Any]:
    """
    Collect stats from existing collections (no writes) and feed to
    hidden_ranking.compute_hidden_rank. Returns {rank, tier}.
    """
    now = _now()
    # qa_pass_rate from qa_decisions
    total_qa = await _db.qa_decisions.count_documents({"developer_id": dev_id})
    approved_qa = await _db.qa_decisions.count_documents({
        "developer_id": dev_id,
        "decision": {"$in": ["approved", "pass", "passed"]},
    }) if total_qa else 0
    qa_pass = int(round(approved_qa * 100 / total_qa)) if total_qa else 90  # seed default

    # completed_count
    completed = await _db.modules.count_documents({
        "assigned_to": dev_id,
        "status": {"$in": ["completed", "approved"]},
    })

    # idle_days — since last completed module
    last_done = await _db.modules.find(
        {"assigned_to": dev_id, "status": {"$in": ["completed", "approved"]}},
        {"_id": 0, "completed_at": 1, "approved_at": 1},
    ).sort("created_at", -1).to_list(1)
    idle_days = 0
    if last_done:
        ts = last_done[0].get("completed_at") or last_done[0].get("approved_at")
        if ts:
            try:
                dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                idle_days = max(0, (now - dt).days)
            except Exception:
                idle_days = 0

    # avg_delivery_days — avg of (completed_at - started_at) for completed
    pipeline = [
        {"$match": {"assigned_to": dev_id, "status": {"$in": ["completed", "approved"]},
                    "started_at": {"$exists": True, "$ne": None},
                    "completed_at": {"$exists": True, "$ne": None}}},
        {"$limit": 50},
    ]
    mods = await _db.modules.aggregate(pipeline).to_list(50)
    deltas: List[float] = []
    for m in mods:
        try:
            s = datetime.fromisoformat(str(m["started_at"]).replace("Z", "+00:00"))
            c = datetime.fromisoformat(str(m["completed_at"]).replace("Z", "+00:00"))
            if s.tzinfo is None: s = s.replace(tzinfo=timezone.utc)
            if c.tzinfo is None: c = c.replace(tzinfo=timezone.utc)
            deltas.append((c - s).total_seconds() / 86400)
        except Exception:
            pass
    avg_delivery = sum(deltas) / len(deltas) if deltas else 0

    stats = {
        "qa_pass_rate": qa_pass,
        "avg_delivery_days": avg_delivery,
        "completed_count": completed,
        "revision_count_avg": 0,
        "idle_days": idle_days,
        "accepted_bid_ratio": 0.7,
    }
    rank = _hr.compute_hidden_rank(stats)
    return {"rank": rank, "tier": _hr.perf_tier(rank), "stats": stats}


async def _streak_last_7_days(dev_id: str) -> Dict[str, Any]:
    """Completed modules in last 7 days (read-only)."""
    since = _now() - timedelta(days=7)
    done = await _db.modules.count_documents({
        "assigned_to": dev_id,
        "status": {"$in": ["completed", "approved"]},
        "completed_at": {"$gte": since.isoformat()},
    })
    return {"completed_last_7d": done, "is_hot": done >= 3}


async def _capacity_snapshot(dev_id: str) -> Dict[str, Any]:
    """Live capacity from modules collection (no writes)."""
    active = await _db.modules.count_documents({
        "assigned_to": dev_id,
        "status": {"$in": ["in_progress", "reserved", "qa_review", "review"]},
    })
    user = await _db.users.find_one({"user_id": dev_id}, {"_id": 0})
    cap = int((user or {}).get("capacity") or 0)
    return {
        "active_modules": active,
        "capacity": cap,
        "utilization_pct": int(round(active * 100 / cap)) if cap > 0 else 0,
        "overloaded": cap > 0 and active > cap,
    }


async def _active_invites(dev_id: str) -> List[Dict[str, Any]]:
    invs = await _db.module_invitations.find(
        {"developer_id": dev_id, "status": "sent"}, {"_id": 0},
    ).sort("invited_at", -1).to_list(20)
    for inv in invs:
        m = await _db.modules.find_one({"module_id": inv["module_id"]}, {"_id": 0})
        if m:
            inv["title"] = m.get("title")
            inv["price"] = m.get("price")
            inv["type"] = m.get("type")
            inv["module_status"] = m.get("status")
    return invs


async def detect_missed_opportunities(
    db, dev_id: str, threshold: int = 3, min_price: int = 500
) -> List[Dict[str, Any]]:
    """
    Return modules this developer WAS recommended but passed on.
    A "miss" = module currently in_progress / completed by someone else,
              where this dev appeared in recommended-top and did not bid/accept.
    Lives here (not in flow_control) because "perception" is developer_brain's job.
    """
    if _flow is None:
        return []
    # Find recent modules no longer open (someone took them) and priced >= threshold
    recent_taken = await db.modules.find({
        "status": {"$in": ["in_progress", "reserved", "qa_review", "review", "completed", "approved"]},
        "price": {"$gte": min_price},
        "assigned_to": {"$ne": dev_id},
    }, {"_id": 0}).sort("created_at", -1).to_list(50)

    missed: List[Dict[str, Any]] = []
    for m in recent_taken[:20]:  # limit scan window
        try:
            top = await _flow.recommend_top(m.get("module_id", ""), limit=5)
        except Exception:
            continue
        if any(t.get("developer_id") == dev_id for t in top):
            missed.append({
                "module_id": m.get("module_id"),
                "title": m.get("title"),
                "type": m.get("type"),
                "price": m.get("price"),
                "project_id": m.get("project_id"),
                "taken_by": m.get("assigned_to"),
                "status": m.get("status"),
            })
        if len(missed) >= threshold * 2:  # enough to show
            break
    return missed


# ─────────────────────────────────────────────────────────────
# Core aggregator
# ─────────────────────────────────────────────────────────────
async def build_motivation(dev_id: str) -> Dict[str, Any]:
    """
    Aggregate tier/rating/earnings/streak/capacity/rank for a developer.
    Reads only — no DB writes. No mutation of user document.
    """
    # 1. Economy (source of truth for tier/rating)
    rating = await _economy.calculate_developer_rating(_db, dev_id, period_days=30)
    elite = await _economy.get_weekly_elite_status(_db, dev_id)
    earnings_7d = await _economy.calculate_earnings_this_week(_db, dev_id)
    try:
        elite_rank = await _economy.get_elite_rank(_db, dev_id)
    except Exception:
        elite_rank = None
    try:
        distance_elite = await _economy.calculate_distance_to_elite(_db, dev_id)
    except Exception:
        distance_elite = None

    # 2. Hidden ranking (invisible)
    hr = await _compute_hidden_rank_for(dev_id)

    # 3. Streak & capacity
    streak = await _streak_last_7_days(dev_id)
    cap = await _capacity_snapshot(dev_id)

    # 4. Growth opportunities (from economy, not duplicated)
    try:
        growth = await _economy.calculate_growth_opportunities(_db, dev_id)
    except Exception:
        growth = []

    return {
        "developer_id": dev_id,
        # Visible
        "tier": rating.get("level") or rating.get("tier") or "public",
        "tier_label": rating.get("level_label") or rating.get("tier_label"),
        "rating": rating.get("rating") or rating.get("avg_rating") or 0,
        "elite": {
            "is_elite": bool((elite or {}).get("is_elite")),
            "rank": elite_rank,
            "distance": distance_elite,
        },
        "earnings_7d": earnings_7d,
        "streak": streak,
        "capacity": cap,
        "growth": growth[:4] if isinstance(growth, list) else [],
        # Hidden (internal only — admin can see, developer sees consequences)
        "_hidden": {
            "rank": hr["rank"],
            "perf_tier": hr["tier"],
        },
    }


# ─────────────────────────────────────────────────────────────
# Router factory
# ─────────────────────────────────────────────────────────────
def build_router(*, user_dep: Callable, admin_dep: Callable) -> APIRouter:
    r = APIRouter(tags=["developer-brain"])

    @r.get("/motivation")
    async def motivation(user=Depends(user_dep)):
        dev_id = getattr(user, "user_id", None)
        if not dev_id:
            return {"error": "not_authenticated"}
        data = await build_motivation(dev_id)
        # Hide _hidden from developer response (they see consequences only)
        public = {k: v for k, v in data.items() if k != "_hidden"}
        try:
            if _realtime is not None:
                await _realtime.emit_to_user(dev_id, "developer.motivation.updated", {
                    "tier": public.get("tier"),
                    "earnings_7d": public.get("earnings_7d"),
                    "streak": public.get("streak"),
                })
        except Exception as e:
            logger.warning(f"motivation emit failed: {e}")
        return public

    @r.get("/home")
    async def home(user=Depends(user_dep)):
        """
        Developer home feed — aggregation of:
          motivation + recommended modules (flow) + invites + missed
        Marketplace untouched.
        """
        dev_id = getattr(user, "user_id", None)
        if not dev_id:
            return {"error": "not_authenticated"}

        # Parallel-ish (Motor is async-friendly; keep sequential for clarity)
        mot = await build_motivation(dev_id)
        mot_public = {k: v for k, v in mot.items() if k != "_hidden"}

        # flow_control: invites + developer-recommended modules
        invites = await _active_invites(dev_id)
        recommended: List[Dict[str, Any]] = []
        if _flow is not None:
            # Use the same scoring as flow_control dev-facing endpoint
            try:
                dev = await _db.users.find_one({"user_id": dev_id}, {"_id": 0})
                open_mods = await _db.modules.find(
                    {"status": {"$in": ["open", "open_for_bids"]}}, {"_id": 0},
                ).to_list(200)
                hidden = mot.get("_hidden", {}).get("rank", 50)
                for m in open_mods:
                    fit = _flow.score_developer_for_module(dev or {}, m, qa_pass_rate=75)
                    if fit["score"] < 50:
                        continue
                    # Apply hidden rank weight for high-value modules
                    price = int(m.get("price") or 0)
                    weight = _hr.rank_weight_for_module(hidden, price)
                    weighted = max(0, min(100, round(fit["score"] * weight)))
                    recommended.append({
                        "module_id": m.get("module_id"),
                        "title": m.get("title"),
                        "type": m.get("type"),
                        "price": price,
                        "project_id": m.get("project_id"),
                        "score": weighted,
                        "fit": fit["fit"],
                        "why": fit["reasons"],
                    })
                recommended.sort(key=lambda x: -x["score"])
                recommended = recommended[:10]
            except Exception as e:
                logger.warning(f"home recommended failed: {e}")

        # Missed opportunities
        missed: List[Dict[str, Any]] = []
        try:
            missed = await detect_missed_opportunities(_db, dev_id, threshold=3, min_price=500)
        except Exception as e:
            logger.warning(f"home missed failed: {e}")

        return {
            "motivation": mot_public,
            "invites": invites,
            "recommended_modules": recommended,
            "missed": missed[:5],
        }

    @r.get("/recommended-modules")
    async def recommended_modules(user=Depends(user_dep)):
        """
        Compact list of modules recommended for this dev — for mobile Home
        feed `dev-recommended-modules.tsx`. Same scoring as /home but
        without motivation / invites / missed bundles.
        """
        dev_id = getattr(user, "user_id", None)
        if not dev_id:
            return {"modules": []}
        if _flow is None or _db is None:
            return {"modules": []}
        try:
            mot = await build_motivation(dev_id)
            dev = await _db.users.find_one({"user_id": dev_id}, {"_id": 0})
            open_mods = await _db.modules.find(
                {"status": {"$in": ["open", "open_for_bids", "pending"]},
                 "assigned_to": None},
                {"_id": 0},
            ).to_list(200)
            hidden = mot.get("_hidden", {}).get("rank", 50)
            out: List[Dict[str, Any]] = []
            for m in open_mods:
                fit = _flow.score_developer_for_module(dev or {}, m, qa_pass_rate=75)
                if fit["score"] < 50:
                    continue
                price = int(m.get("dev_reward") or m.get("price") or 0)
                weight = _hr.rank_weight_for_module(hidden, price)
                weighted = max(0, min(100, round(fit["score"] * weight)))
                out.append({
                    "module_id": m.get("module_id"),
                    "title": m.get("title"),
                    "type": m.get("type"),
                    "price": price,
                    "project_id": m.get("project_id"),
                    "score": weighted,
                    "fit": fit["fit"],
                    "why": fit["reasons"],
                })
            out.sort(key=lambda x: -x["score"])
            return {"modules": out[:10]}
        except Exception as e:
            logger.warning(f"recommended-modules failed: {e}")
            return {"modules": []}

    return r
