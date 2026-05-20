"""
Block A5 — Admin Team View (READ-ONLY, CLASSIFICATION ONLY)

One endpoint: GET /api/admin/team

Purpose:
    "What's happening with the people?"

    A5 is strictly READ.
    - no reassignment
    - no task management
    - no recommendations
    - no "swap developer" hints

    It classifies each developer into ONE of four buckets using a fixed,
    deterministic rule. This is not scoring — scoring already happens in
    db.developer_scores (owned by the intelligence engine). A5 only
    projects that existing score + the live module count into a view.

Sources (no new collections):
    db.users            — developer roster + display name
    db.developer_scores — combined / quality / reliability (truth)
    db.modules          — count active assignments per dev

Classification (fixed, no tunable thresholds on the UI side):
    load >= 0.8          → overloaded
    combined_score >= 0.8 → top
    combined_score <= 0.6 → unstable
    otherwise            → normal

    A developer can only be in ONE bucket at a time. Priority is:
    overloaded > top > unstable > normal. Overload wins because a burning
    person should not be celebrated for being fast.

Load (pure ratio, not a new formula):
    load = min(active_modules / CAP, 1.0)
    CAP = 3   (deterministic, not model-driven)
    active_modules is counted LIVE from db.modules — not from a
    potentially-stale users.active_load counter, so the truth can't drift.

No new formulas. No "intelligence". No writes.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException

router = APIRouter(prefix="/api", tags=["admin-team"])

_CAP = 3  # active-modules cap for load ratio — fixed, documented.

# Score fields in db.developer_scores can arrive either on a 0..1 scale
# or a 0..100 scale depending on which path wrote them. Normalise once.
def _norm(v: Any) -> float:
    try:
        x = float(v or 0)
    except (TypeError, ValueError):
        return 0.0
    if x > 1.0:
        x = x / 100.0
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


def _status(load: float, combined: float) -> str:
    if load >= 0.8:
        return "overloaded"
    if combined >= 0.8:
        return "top"
    if combined <= 0.6:
        return "unstable"
    return "normal"


def _note(status: str, active: int, load: float, combined: float) -> str:
    if status == "overloaded":
        return f"High load — {active} active module(s)"
    if status == "top":
        return f"Top performer — score {int(combined * 100)}"
    if status == "unstable":
        return f"Score below threshold — {int(combined * 100)}"
    return f"Stable — {active} active"


def init_router(db, get_current_user_dep):

    @router.get("/admin/team")
    async def admin_team(user=Depends(get_current_user_dep)) -> Dict[str, Any]:
        role = user.role if hasattr(user, "role") else user.get("role")
        if role != "admin":
            raise HTTPException(status_code=403, detail="Admin only")

        # 1. Developers (batched).
        devs = await db.users.find(
            {"role": "developer"},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1},
        ).to_list(5000)

        dev_ids = [d["user_id"] for d in devs if d.get("user_id")]
        if not dev_ids:
            return {
                "summary":     {"total": 0, "top_performers": 0, "unstable": 0, "overloaded": 0, "normal": 0},
                "developers":  [],
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

        # 2. Scores (batched).
        scores_raw = await db.developer_scores.find(
            {"developer_id": {"$in": dev_ids}},
            {"_id": 0},
        ).to_list(len(dev_ids))
        score_by_id = {s["developer_id"]: s for s in scores_raw}

        # 3. Live active-module counts (batched aggregation).
        pipeline = [
            {"$match": {
                "assigned_to": {"$in": dev_ids},
                "status": {"$in": ["pending", "in_progress", "review"]},
            }},
            {"$group": {"_id": "$assigned_to", "n": {"$sum": 1}}},
        ]
        active_counts = {r["_id"]: int(r["n"]) async for r in db.modules.aggregate(pipeline)}

        # 4. Classify.
        developers: List[Dict[str, Any]] = []
        summary = {"total": 0, "top_performers": 0, "unstable": 0, "overloaded": 0, "normal": 0}

        for d in devs:
            did = d["user_id"]
            s = score_by_id.get(did) or {}
            combined   = _norm(s.get("combined_score"))
            quality    = _norm(s.get("quality_score"))
            reliability = _norm(s.get("reliability_score"))

            active = active_counts.get(did, 0)
            load = min(active / _CAP, 1.0) if _CAP > 0 else 0.0

            status = _status(load, combined)
            note   = _note(status, active, load, combined)

            developers.append({
                "developer_id":     did,
                "name":             d.get("name") or d.get("email") or "Developer",
                "combined_score":   round(combined, 2),
                "quality_score":    round(quality, 2),
                "reliability_score": round(reliability, 2),
                "active_modules":   active,
                "load":             round(load, 2),
                "status":           status,
                "note":             note,
            })

            summary["total"] += 1
            if status == "top":        summary["top_performers"] += 1
            elif status == "unstable": summary["unstable"] += 1
            elif status == "overloaded": summary["overloaded"] += 1
            else:                      summary["normal"] += 1

        # 5. Stable ordering: overloaded → unstable → top → normal;
        #    inside each bucket, by combined_score desc.
        BUCKET_ORDER = {"overloaded": 0, "unstable": 1, "top": 2, "normal": 3}
        developers.sort(key=lambda x: (
            BUCKET_ORDER.get(x["status"], 99),
            -x["combined_score"],
        ))

        return {
            "summary":      summary,
            "developers":   developers,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    return router
