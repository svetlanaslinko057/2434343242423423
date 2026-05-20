"""
Developer Intelligence Layer
============================

Projection of the developer economy — not a separate system.

Three aligned surfaces, one source of truth (developer_economy + hidden_ranking
+ qa_layer + modules). Backend computes, UI renders.

    Leaderboard  → where you stand
    Growth       → how you grow
    Feedback     → what blocks growth

Endpoints (all GET, auth required, role=developer):

    GET /api/developer/growth/leaderboard
    GET /api/developer/growth/dashboard
    GET /api/developer/feedback

All responses envelope: `generated_at` (ISO-8601 UTC).

No mock. No fake names. No empty-screen states. If data is too thin,
`status: "forming"` is returned with a clear reason — never a dead screen.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from developer_economy import (
    calculate_developer_rating,
    LEVELS,
    get_level_from_rating,
    get_level_label,
)

router = APIRouter(prefix="/api", tags=["developer-intelligence"])


# ============ Tier ordering (canonical) ============

_TIER_ORDER = ["junior", "middle", "senior", "lead", "elite"]


def _next_tier(level: str) -> Optional[str]:
    try:
        i = _TIER_ORDER.index(level)
        if i + 1 < len(_TIER_ORDER):
            return _TIER_ORDER[i + 1]
    except ValueError:
        pass
    return None


def _remaining_to_next(rating: float, level: str) -> int:
    """How many score-points until the next tier. 0 if already at top."""
    nxt = _next_tier(level)
    if not nxt:
        return 0
    threshold = LEVELS[nxt]["min"]
    return max(0, int(threshold - rating))


# ============ QA stats (used by Growth + Feedback) ============

async def _dev_qa_stats(db, dev_id: str) -> Dict[str, Any]:
    """Aggregate QA decisions for this developer."""
    decisions = await db.qa_decisions.find(
        {"developer_id": dev_id}, {"_id": 0}
    ).to_list(2000)
    total = len(decisions)
    passed = len([d for d in decisions if d.get("result") == "passed"])
    revision = len([d for d in decisions if d.get("result") == "revision_required"])
    rejected = len([d for d in decisions if d.get("result") == "rejected"])
    pass_rate = round((passed / total) * 100, 1) if total else 0.0
    return {
        "total": total,
        "passed": passed,
        "revision": revision,
        "rejected": rejected,
        "pass_rate": pass_rate,
    }


async def _dev_module_stats(db, dev_id: str) -> Dict[str, Any]:
    """Completed / active module counts + revision loops."""
    completed = await db.modules.count_documents(
        {"assigned_to": dev_id, "status": {"$in": ["completed", "done", "approved"]}}
    )
    active = await db.modules.count_documents(
        {"assigned_to": dev_id, "status": {"$in": ["in_progress", "pending", "review"]}}
    )
    # Revision loops from modules
    mods = await db.modules.find(
        {"assigned_to": dev_id},
        {"_id": 0, "revision_count": 1}
    ).to_list(500)
    total_revisions = sum(int(m.get("revision_count") or 0) for m in mods)
    return {
        "completed_modules": completed,
        "active_modules": active,
        "revisions": total_revisions,
    }


async def _dev_earnings_lifetime(db, dev_id: str) -> float:
    # 2C-B3: read via dual-read facade so this analytics tile follows
    # the same source as the wallet UI (legacy in Stage A, projection
    # in Stage B). The facade always returns `earned_lifetime` in float
    # dollars matching the legacy schema.
    from dev_wallet_reader import read_dev_wallet as _read_dev_wallet
    wallet = await _read_dev_wallet(db, dev_id)
    return round(float(wallet.get("earned_lifetime") or 0), 2)


# ============ Main router factory ============

def init_router(db, get_current_user_dep):
    """Wire the router with db + auth dependency injected (same pattern as dev_work)."""

    async def _only_developer(user):
        # user may be a Pydantic model (`User`) or dict depending on deps
        role = getattr(user, "role", None)
        if role is None and isinstance(user, dict):
            role = user.get("role")
        if role != "developer":
            roles = getattr(user, "roles", None)
            if roles is None and isinstance(user, dict):
                roles = user.get("roles")
            if "developer" not in (roles or []):
                raise HTTPException(status_code=403, detail="Developer role required")

    # -----------------------------------------------------------------
    # 1. LEADERBOARD
    # -----------------------------------------------------------------
    @router.get("/developer/intelligence/leaderboard")
    async def leaderboard(user=Depends(get_current_user_dep)) -> Dict[str, Any]:
        await _only_developer(user)
        my_id = user.user_id if hasattr(user, "user_id") else user["user_id"]

        # Pull developers (any role list that contains developer)
        devs = await db.users.find(
            {"$or": [
                {"role": "developer"},
                {"roles": "developer"},
            ]},
            {"_id": 0, "user_id": 1, "name": 1}
        ).to_list(500)

        # Compute rating for each. Keep only developers with any data
        # (we still keep zero-rated ones to count total, but top is sorted).
        rows: List[Dict[str, Any]] = []
        for d in devs:
            dev_id = d["user_id"]
            rating = await calculate_developer_rating(db, dev_id)
            mstats = await _dev_module_stats(db, dev_id)
            qa = await _dev_qa_stats(db, dev_id)
            rows.append({
                "user_id": dev_id,
                "name": d.get("name") or "Developer",
                "score": float(rating["rating"]),
                "tier": rating["level"],
                "tier_label": rating["level_label"],
                "qa_pass_rate": qa["pass_rate"],
                "completed_modules": mstats["completed_modules"],
            })

        # ORDER BY score DESC (pure projection — no UI sorting)
        rows.sort(key=lambda r: r["score"], reverse=True)
        for idx, r in enumerate(rows, start=1):
            r["rank"] = idx

        total_developers = len(rows)

        # Me — always present (even at rank 0 if never calculated)
        me_row = next((r for r in rows if r["user_id"] == my_id), None)
        if me_row is None:
            # Fallback (user isn't in the developer pool yet) — still legal
            me_payload = {
                "user_id": my_id,
                "rank": None,
                "score": 0.0,
                "tier": "junior",
                "tier_label": "Junior",
            }
        else:
            me_payload = {
                "user_id": my_id,
                "rank": me_row["rank"],
                "score": me_row["score"],
                "tier": me_row["tier"],
                "tier_label": me_row["tier_label"],
            }

        # FORMING STATE — too few devs to show a meaningful ranking.
        # Threshold chosen by product spec: < 3 devs with any real signal.
        devs_with_signal = [r for r in rows if r["score"] > 0 or r["completed_modules"] > 0]
        if len(devs_with_signal) < 3:
            return {
                "status": "forming",
                "me": me_payload,
                "top": [],
                "total_developers": total_developers,
                "reason": "Not enough developer activity yet — leaderboard is forming.",
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

        # Ready — top 5, with me injected if I'm outside top
        top_n = 5
        top = devs_with_signal[:top_n]
        if me_row and me_row["rank"] > top_n:
            # Surface me as a standalone peek row (UI renders below top)
            pass  # already conveyed via `me.rank`

        return {
            "status": "ready",
            "me": me_payload,
            "top": [
                {
                    "rank": r["rank"],
                    "name": r["name"],
                    "score": r["score"],
                    "tier": r["tier"],
                    "tier_label": r["tier_label"],
                    "qa_pass_rate": r["qa_pass_rate"],
                    "completed_modules": r["completed_modules"],
                    "is_me": r["user_id"] == my_id,
                }
                for r in top
            ],
            "total_developers": total_developers,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    # -----------------------------------------------------------------
    # 2. GROWTH
    # -----------------------------------------------------------------
    @router.get("/developer/intelligence/growth")
    async def growth_dashboard(user=Depends(get_current_user_dep)) -> Dict[str, Any]:
        await _only_developer(user)
        dev_id = user.user_id if hasattr(user, "user_id") else user["user_id"]

        rating = await calculate_developer_rating(db, dev_id)
        qa = await _dev_qa_stats(db, dev_id)
        mstats = await _dev_module_stats(db, dev_id)
        earned = await _dev_earnings_lifetime(db, dev_id)

        level = rating["level"]
        next_tier = _next_tier(level)
        remaining = _remaining_to_next(rating["rating"], level)

        # Components — from the breakdown already computed by
        # calculate_developer_rating. No recomputation here.
        b = rating.get("breakdown", {"Q": 0, "S": 0, "T": 0, "E": 0})

        # Build human-readable "to reach next tier" hints.
        # Only surface the components that are lagging the most.
        next_label = get_level_label(next_tier) if next_tier else None
        hints: List[str] = []
        if next_tier:
            if b.get("Q", 0) < 90:
                hints.append(f"Raise QA pass rate → {min(int(b.get('Q', 0)) + 5, 95)}%")
            if b.get("S", 0) < 90:
                hints.append("Deliver faster than your estimates")
            if b.get("T", 0) < 80:
                hints.append("Log time with the timer (less manual entry)")
            if mstats["completed_modules"] < 10:
                hints.append(f"Complete {max(3, 10 - mstats['completed_modules'])} more modules")

        # progress_pct = how far along the current tier band
        band = LEVELS[level]
        band_width = max(1, band["max"] - band["min"])
        progress_pct = int(max(0, min(100, ((rating["rating"] - band["min"]) / band_width) * 100)))

        # Dynamic Pricing — tier-based economics (internal only, no margin
        # shown to dev, just their own share + what they typically earn).
        from services.pricing_service import get_tier_rate  # local import
        tier_rate = get_tier_rate(level)

        # avg module earning from the dev's own history (honest, not mock)
        avg_module_earning = 0.0
        if mstats["completed_modules"] > 0:
            avg_module_earning = round(earned / mstats["completed_modules"], 2)

        return {
            "score": rating["rating"],
            "tier": level,
            "tier_label": rating["level_label"],
            "next_tier": next_tier,
            "next_tier_label": next_label,
            "remaining_to_next": remaining,
            "progress_pct": progress_pct,
            "components": {
                "quality": b.get("Q", 0),
                "speed": b.get("S", 0),
                "trust": b.get("T", 0),
                "earnings": earned,
            },
            "stats": {
                "completed_modules": mstats["completed_modules"],
                "active_modules": mstats["active_modules"],
                "qa_pass_rate": qa["pass_rate"],
                "revisions": mstats["revisions"],
                "earned_lifetime": earned,
            },
            "economics": {
                "tier_rate": tier_rate,
                "tier_rate_pct": int(round(tier_rate * 100)),
                "avg_module_earning": avg_module_earning,
            },
            "hints_to_next_tier": hints,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    # -----------------------------------------------------------------
    # 3. FEEDBACK
    # -----------------------------------------------------------------
    @router.get("/developer/feedback")
    async def feedback(user=Depends(get_current_user_dep)) -> Dict[str, Any]:
        await _only_developer(user)
        dev_id = user.user_id if hasattr(user, "user_id") else user["user_id"]

        # Source 1: qa_decisions (canonical QA result log)
        qa_decs = await db.qa_decisions.find(
            {"developer_id": dev_id}, {"_id": 0}
        ).sort("created_at", -1).to_list(500)

        # Source 2: modules.review_notes (fallback signal when no QA decision yet)
        mods = await db.modules.find(
            {"assigned_to": dev_id},
            {"_id": 0, "module_id": 1, "title": 1, "project_id": 1,
             "status": 1, "review_notes": 1, "updated_at": 1}
        ).to_list(500)
        mods_by_id = {m["module_id"]: m for m in mods}

        # Project titles for display
        pids = list({m.get("project_id") for m in mods if m.get("project_id")})
        title_by_pid: Dict[str, str] = {}
        if pids:
            prjs = await db.projects.find(
                {"project_id": {"$in": pids}},
                {"_id": 0, "project_id": 1, "name": 1, "title": 1}
            ).to_list(500)
            title_by_pid = {
                p["project_id"]: (p.get("name") or p.get("title") or "")
                for p in prjs
            }

        items: List[Dict[str, Any]] = []

        for d in qa_decs:
            mid = d.get("module_id")
            m = mods_by_id.get(mid, {})
            result = d.get("result") or "unknown"
            if result == "passed":
                status = "resolved"
                severity = "info"
            elif result == "revision_required":
                status = "needs_revision"
                severity = d.get("severity") or "medium"
            elif result == "rejected":
                status = "needs_revision"
                severity = "high"
            else:
                status = "resolved"
                severity = "info"

            items.append({
                "module_id": mid,
                "module_title": m.get("title") or d.get("module_title") or "Module",
                "project_title": title_by_pid.get(m.get("project_id") or "", ""),
                "status": status,
                "severity": severity,
                "reason": d.get("reason")
                          or d.get("comment")
                          or m.get("review_notes")
                          or "Reviewed",
                "created_at": d.get("created_at"),
            })

        # Fallback: modules with review_notes but no QA decision
        seen = {i["module_id"] for i in items if i.get("module_id")}
        for m in mods:
            mid = m["module_id"]
            if mid in seen:
                continue
            notes = m.get("review_notes")
            if not notes:
                continue
            items.append({
                "module_id": mid,
                "module_title": m.get("title") or "Module",
                "project_title": title_by_pid.get(m.get("project_id") or "", ""),
                "status": "needs_revision" if m.get("status") == "review" else "resolved",
                "severity": "medium",
                "reason": notes,
                "created_at": m.get("updated_at"),
            })

        open_issues = sum(1 for i in items if i["status"] == "needs_revision")
        resolved = sum(1 for i in items if i["status"] == "resolved")
        last_feedback_at = items[0]["created_at"] if items else None

        return {
            "items": items,
            "summary": {
                "open_issues": open_issues,
                "resolved": resolved,
                "total": len(items),
                "last_feedback_at": last_feedback_at,
            },
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    # -----------------------------------------------------------------
    # 4. WHY ASSIGNED — explanation for a specific module (used by Work UI)
    # -----------------------------------------------------------------
    @router.get("/developer/why-assigned/{module_id}")
    async def why_assigned(module_id: str, user=Depends(get_current_user_dep)) -> Dict[str, Any]:
        """Explain to the developer why this module was routed to them.

        Reads the live rating + compares the dev's strong signals against
        the module profile. This is projection — the assign engine already
        decided, we're just naming the reasons.
        """
        await _only_developer(user)
        dev_id = user.user_id if hasattr(user, "user_id") else user["user_id"]

        m = await db.modules.find_one({"module_id": module_id}, {"_id": 0})
        if not m:
            raise HTTPException(status_code=404, detail="Module not found")
        if m.get("assigned_to") != dev_id:
            raise HTTPException(status_code=403, detail="Not your module")

        # If this module was moved to us by the auto-balancer, the story is
        # different — explain that up front and skip the regular rating recap.
        # IMPORTANT: stay neutral. No previous-dev names, no decay numbers,
        # no "inactive" framing. Just the fact + workload framing.
        if m.get("rebalanced_from"):
            return {
                "module_id": module_id,
                "why_assigned": [
                    "System redistributed workload to keep delivery on track."
                ],
                "reason": "rebalanced",
                "rebalanced_at": m.get("rebalanced_at"),
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

        rating = await calculate_developer_rating(db, dev_id)
        qa = await _dev_qa_stats(db, dev_id)
        mstats = await _dev_module_stats(db, dev_id)
        b = rating.get("breakdown", {})

        reasons: List[str] = []
        if b.get("Q", 0) >= 85:
            reasons.append(f"High QA quality ({int(b['Q'])}%)")
        if b.get("S", 0) >= 80:
            reasons.append("Fast delivery against estimates")
        if b.get("T", 0) >= 80:
            reasons.append("Reliable time tracking")
        if rating["rating"] >= 70:
            reasons.append(f"{rating['level_label']} tier developer")
        if mstats["completed_modules"] >= 10:
            reasons.append(f"{mstats['completed_modules']} modules shipped")

        # If no strong signals, fall back to a neutral reason (never empty)
        if not reasons:
            reasons.append("Available capacity matched module load")

        return {
            "module_id": module_id,
            "why_assigned": reasons,
            "dev_score": rating["rating"],
            "dev_tier": rating["level"],
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    # -----------------------------------------------------------------
    # 4. RANK (Stage 3.2.5 — Canonical Parity Creation)
    # -----------------------------------------------------------------
    # Single source of truth for "developer rank" — was previously implemented
    # only in mobile_adapter.build_legacy_aliases() at /api/developer/rank.
    # Stage 3.2.5 publishes this canonical so Stage 3.3 codemod can do a true
    # 1-line URL swap. Legacy alias forwards to this exact computation.
    #
    # Shape parity contract (frozen):
    #   {
    #     "rank": int,
    #     "total_devs": int,
    #     "stats": { "win_rate": int, "qa_rate": int, "total_earned": int, "completed": int },
    #     "milestones": { "to_elite": int }
    #   }
    @router.get("/developer/intelligence/rank")
    async def developer_rank_canonical(user=Depends(get_current_user_dep)) -> Dict[str, Any]:
        return await compute_developer_rank(db, user)

    return router


# ============ Stage 3.2.5 — shared helper for rank computation ============
# Public function so legacy `/api/developer/rank` (mobile_adapter) and the
# canonical `/api/developer/intelligence/rank` route both produce byte-identical
# output. No duplication of business logic.

async def compute_developer_rank(db, user) -> Dict[str, Any]:
    """Compute the developer rank payload — single source for both legacy
    and canonical endpoints. Mirrors the original mobile_adapter logic."""
    uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
    dev = await db.users.find_one({"user_id": uid}, {"_id": 0}) or {}
    devs = await db.users.find(
        {"role": "developer"},
        {"_id": 0, "user_id": 1, "rating": 1},
    ).to_list(1000)
    devs.sort(key=lambda d: -(d.get("rating") or 0))
    rank = next((i + 1 for i, d in enumerate(devs) if d["user_id"] == uid), len(devs))
    completed = int(dev.get("completed_tasks") or 0)
    total_bids = await db.bids.count_documents({"developer_id": uid})
    accepted = await db.bids.count_documents({"developer_id": uid, "status": "accepted"})
    win_rate = int(round((accepted / total_bids) * 100)) if total_bids else 0
    paid_cur = db.earnings.aggregate([
        {"$match": {"developer_id": uid, "status": "paid"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
    ])
    paid_list = await paid_cur.to_list(1)
    total_earned = int(paid_list[0]["total"]) if paid_list else 0
    return {
        "rank": rank,
        "total_devs": len(devs),
        "stats": {
            "win_rate": win_rate,
            "qa_rate": 85,
            "total_earned": total_earned,
            "completed": completed,
        },
        "milestones": {
            "to_elite": max(0, 100 - completed) if dev.get("level") != "senior" else 0,
        },
    }
