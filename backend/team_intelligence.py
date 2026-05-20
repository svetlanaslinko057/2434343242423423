"""
BLOCK 4.3 — TEAM INTELLIGENCE.
Not "is this dev strong?" but "is this SPECIFIC team good for THIS module?"

team_efficiency (0..100) =
  progress_velocity × 40       # done_7d / active_tasks
+ avg_quality × 25             # weighted by responsibility
+ load_balance × 20            # 1 - coefficient_of_variation(allocations)
+ collaboration_stability × 15 # 1 - team_reassign_rate

team_risk (0..100, HIGHER = WORSE) =
  overload_risk × 30
+ qa_risk × 25
+ silence_risk × 20
+ reassignment_risk × 15
+ role_fit_risk × 10

Bands:
  efficiency ≥ 75 AND risk < 35 → STRONG
  efficiency ≥ 60 AND risk < 50 → STABLE
  efficiency ≥ 40 AND risk < 70 → FRAGILE
  else                          → FAILING
"""
from __future__ import annotations
import uuid
import math
from datetime import datetime, timezone, timedelta
from typing import Optional


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def team_band(efficiency: float, risk: float) -> str:
    if efficiency >= 75 and risk < 35:
        return "strong"
    if efficiency >= 60 and risk < 50:
        return "stable"
    if efficiency >= 40 and risk < 70:
        return "fragile"
    return "failing"


def _parse_dt(v) -> Optional[datetime]:
    if not v:
        return None
    if isinstance(v, datetime):
        return v
    try:
        return datetime.fromisoformat(str(v))
    except (ValueError, TypeError):
        return None


# ========== EFFICIENCY COMPONENTS ==========

async def _progress_velocity(db, module_id: str) -> tuple[float, int, int]:
    """done in last 7 days / active_tasks."""
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=7)).isoformat()
    active = await db.work_units.count_documents(
        {
            "module_id": module_id,
            "status": {"$nin": ["cancelled", "archived"]},
        }
    )
    if active == 0:
        return (0.0, 0, 0)
    done_7d = await db.work_units.count_documents(
        {
            "module_id": module_id,
            "status": {"$in": ["completed", "done", "submitted"]},
            "completed_at": {"$gte": cutoff},
        }
    )
    return (min(1.0, done_7d / active), done_7d, active)


async def _avg_team_quality(db, assignments: list[dict]) -> tuple[float, float]:
    """Weighted by responsibility. Returns (0..1 normalised, raw_avg_100)."""
    if not assignments:
        return (0.0, 0.0)
    dev_ids = [a["developer_id"] for a in assignments]
    scores = {}
    async for s in db.developer_scores.find(
        {"developer_id": {"$in": dev_ids}},
        {"_id": 0, "developer_id": 1, "quality_score": 1, "reliability_score": 1},
    ):
        scores[s["developer_id"]] = s

    total_w = 0.0
    weighted_q = 0.0
    for a in assignments:
        sc = scores.get(a["developer_id"], {})
        q = float(sc.get("quality_score") or 50.0)
        # Combined so we reflect both dims
        r = float(sc.get("reliability_score") or 50.0)
        blended = q * 0.6 + r * 0.4
        w = float(a.get("responsibility", 0))
        weighted_q += blended * w
        total_w += w
    raw = (weighted_q / total_w) if total_w > 0 else 0.0
    return (max(0.0, min(1.0, raw / 100.0)), round(raw, 2))


def _load_balance(assignments: list[dict]) -> float:
    """
    1 - coefficient_of_variation(allocations).
    Perfect balance → 1.0, very skewed → ≈ 0.
    Single-member team returns 1.0 (no imbalance possible).
    """
    if len(assignments) < 2:
        return 1.0
    allocs = [float(a.get("allocation", 0)) for a in assignments]
    mean = sum(allocs) / len(allocs)
    if mean <= 0:
        return 0.0
    variance = sum((x - mean) ** 2 for x in allocs) / len(allocs)
    stdev = math.sqrt(variance)
    cv = stdev / mean
    return max(0.0, min(1.0, 1.0 - cv))


async def _collaboration_stability(
    db, module_id: str
) -> tuple[float, int, int]:
    """1 - (team_reassignments / total_tasks_for_module)."""
    total_tasks = await db.work_units.count_documents({"module_id": module_id})
    if total_tasks == 0:
        return (1.0, 0, 0)
    # Reassignments = work_units where prev_assigned_to is set
    reassigns = await db.work_units.count_documents(
        {"module_id": module_id, "prev_assigned_to": {"$exists": True, "$ne": None}}
    )
    # Also count module_assignments that were removed (not replaced)
    removed_members = await db.module_assignments.count_documents(
        {
            "module_id": module_id,
            "status": "removed",
            "removed_reason": {"$ne": "team_replaced"},
        }
    )
    rate = (reassigns + removed_members) / max(total_tasks, 1)
    return (max(0.0, 1.0 - rate), reassigns, removed_members)


# ========== RISK COMPONENTS ==========

async def _overload_risk(db, assignments: list[dict]) -> tuple[float, list[str]]:
    """
    Max over team of max(0, load - capacity) / capacity.
    Returns (risk 0..1, list of overloaded dev_ids).
    """
    if not assignments:
        return (0.0, [])
    overloaded = []
    max_ratio = 0.0
    for a in assignments:
        dev_id = a["developer_id"]
        # sum across ALL active assignments for this dev
        total = 0.0
        async for x in db.module_assignments.find(
            {"developer_id": dev_id, "status": "active"},
            {"_id": 0, "allocation": 1},
        ):
            total += float(x.get("allocation", 0))
        user = await db.users.find_one({"user_id": dev_id}, {"_id": 0, "capacity": 1})
        cap = float((user or {}).get("capacity", 1.0))
        over = max(0.0, (total - cap) / cap)
        if over > 0:
            overloaded.append(dev_id)
        if over > max_ratio:
            max_ratio = over
    # Cap ratio at 1.0 (anything ≥100% overload is full risk)
    return (min(1.0, max_ratio), overloaded)


async def _qa_risk_for_module(db, module_id: str) -> tuple[float, int, int]:
    """failed_reviews / total_reviews for work_units inside module."""
    unit_ids = await db.work_units.distinct("unit_id", {"module_id": module_id})
    if not unit_ids:
        return (0.0, 0, 0)
    sub_ids = await db.submissions.distinct(
        "submission_id", {"unit_id": {"$in": unit_ids}}
    )
    if not sub_ids:
        return (0.0, 0, 0)
    total = await db.reviews.count_documents({"submission_id": {"$in": sub_ids}})
    if total == 0:
        return (0.0, 0, 0)
    failed = await db.reviews.count_documents(
        {"submission_id": {"$in": sub_ids}, "result": "rejected"}
    )
    return (failed / total, failed, total)


async def _silence_risk(db, module_id: str) -> tuple[float, int]:
    """
    1.0 if ≥1 in_progress task has no activity >24h.
    Partial risk scaled by ratio of silent tasks.
    """
    tasks = await db.work_units.find(
        {"module_id": module_id, "status": {"$in": ["in_progress", "assigned"]}},
        {
            "_id": 0, "unit_id": 1, "updated_at": 1, "started_at": 1,
            "timer_started_at": 1, "assigned_at": 1,
        },
    ).to_list(200)
    if not tasks:
        return (0.0, 0)
    now = datetime.now(timezone.utc)
    silent = 0
    for t in tasks:
        last_ts = None
        for f in ("updated_at", "timer_started_at", "started_at", "assigned_at"):
            dt = _parse_dt(t.get(f))
            if dt and (last_ts is None or dt > last_ts):
                last_ts = dt
        if last_ts is None:
            silent += 1
            continue
        if (now - last_ts) > timedelta(hours=24):
            silent += 1
    return (min(1.0, silent / max(len(tasks), 1)), silent)


async def _reassignment_risk(db, module_id: str) -> tuple[float, int]:
    """reassignments / max(1, total_tasks)."""
    total = await db.work_units.count_documents({"module_id": module_id})
    if total == 0:
        return (0.0, 0)
    re_tasks = await db.work_units.count_documents(
        {"module_id": module_id, "prev_assigned_to": {"$exists": True, "$ne": None}}
    )
    return (min(1.0, re_tasks / total), re_tasks)


async def _role_fit_risk(db, assignments: list[dict]) -> tuple[float, Optional[str]]:
    """1.0 if owner fails Q≥70 or R≥65 gate, else 0. Returns (risk, reason)."""
    owner = next(
        (a for a in assignments if a.get("role") == "owner"), None
    )
    if not owner:
        return (1.0, "no_owner")
    sc = await db.developer_scores.find_one(
        {"developer_id": owner["developer_id"]}, {"_id": 0}
    )
    if not sc:
        return (0.0, None)  # no data → neutral
    q = float(sc.get("quality_score") or 50)
    r = float(sc.get("reliability_score") or 50)
    if q < 70 and r < 65:
        return (1.0, f"owner Q={q:.0f}, R={r:.0f}: both gates fail")
    if q < 70:
        return (0.5, f"owner quality {q:.0f} < 70")
    if r < 65:
        return (0.5, f"owner reliability {r:.0f} < 65")
    return (0.0, None)


# ========== COMPUTE TEAM SCORE ==========

async def compute_team_score(db, module_id: str) -> dict:
    module = await db.modules.find_one({"module_id": module_id}, {"_id": 0})
    if not module:
        return {"module_id": module_id, "error": "module_not_found"}

    assignments = await db.module_assignments.find(
        {"module_id": module_id, "status": "active"}, {"_id": 0}
    ).to_list(50)

    if not assignments:
        return {
            "module_id": module_id,
            "module_title": module.get("title"),
            "team_size": 0,
            "team_efficiency": 0.0,
            "team_risk": 0.0,
            "team_band": "failing",
            "reason": "no_team",
        }

    # Efficiency
    vel, done_7d, active = await _progress_velocity(db, module_id)
    q_norm, q_raw = await _avg_team_quality(db, assignments)
    balance = _load_balance(assignments)
    coll, reass_tasks, removed_members = await _collaboration_stability(
        db, module_id
    )

    efficiency = vel * 40 + q_norm * 25 + balance * 20 + coll * 15

    # Risk
    overload, overloaded_ids = await _overload_risk(db, assignments)
    qa, qa_fail, qa_total = await _qa_risk_for_module(db, module_id)
    silence, silent_count = await _silence_risk(db, module_id)
    reass_r, reass_total_tasks = await _reassignment_risk(db, module_id)
    role_fit, role_fit_reason = await _role_fit_risk(db, assignments)

    risk = overload * 30 + qa * 25 + silence * 20 + reass_r * 15 + role_fit * 10

    efficiency = round(max(0.0, min(100.0, efficiency)), 2)
    risk = round(max(0.0, min(100.0, risk)), 2)
    band_ = team_band(efficiency, risk)

    return {
        "module_id": module_id,
        "module_title": module.get("title"),
        "team_size": len(assignments),
        "team_efficiency": efficiency,
        "team_risk": risk,
        "team_band": band_,
        "progress_velocity": round(vel, 3),
        "avg_quality": q_raw,
        "load_balance": round(balance, 3),
        "collaboration_stability": round(coll, 3),
        "overload_risk": round(overload, 3),
        "qa_risk": round(qa, 3),
        "silence_risk": round(silence, 3),
        "reassignment_risk": round(reass_r, 3),
        "role_fit_risk": round(role_fit, 3),
        "raw": {
            "done_7d": done_7d,
            "active_tasks": active,
            "reassigned_tasks": reass_tasks,
            "removed_members": removed_members,
            "overloaded_devs": overloaded_ids,
            "qa_failed": qa_fail,
            "qa_total": qa_total,
            "silent_tasks": silent_count,
            "role_fit_reason": role_fit_reason,
        },
        "updated_at": _now_iso(),
    }


# ========== RECOMMENDATIONS ==========

async def compute_recommendations(db, score: dict) -> list[dict]:
    """
    Generates: rebalance · change_owner · add_support · escalate_qa.
    Rules are MVP-level thresholds; each recommendation has title + detail + severity.
    """
    recs = []
    if score.get("team_size", 0) == 0:
        return recs

    mod_id = score["module_id"]
    raw = score.get("raw", {})

    # 1. Overload → rebalance
    if score["overload_risk"] > 0.2 or score["load_balance"] < 0.5:
        overloaded = raw.get("overloaded_devs", [])
        if overloaded:
            # Find least-loaded teammate
            assignments = await db.module_assignments.find(
                {"module_id": mod_id, "status": "active"}, {"_id": 0}
            ).to_list(50)
            by_alloc = sorted(
                assignments, key=lambda a: float(a.get("allocation", 0))
            )
            lightest = by_alloc[0] if by_alloc else None
            recs.append(
                {
                    "type": "rebalance",
                    "severity": "high" if score["overload_risk"] > 0.4 else "medium",
                    "title": "Rebalance team load",
                    "detail": (
                        f"{len(overloaded)} dev(s) overloaded; "
                        f"consider moving tasks "
                        + (f"to {lightest.get('developer_id')}" if lightest else "")
                    ),
                    "from_devs": overloaded,
                    "to_dev": lightest.get("developer_id") if lightest else None,
                }
            )
        else:
            recs.append(
                {
                    "type": "rebalance",
                    "severity": "medium",
                    "title": "Balance allocations",
                    "detail": (
                        f"Load imbalance ({score['load_balance']:.2f}); "
                        "consider evening out task shares"
                    ),
                }
            )

    # 2. Weak owner → change_owner
    if score["role_fit_risk"] > 0.5:
        # Find strongest executor
        assignments = await db.module_assignments.find(
            {"module_id": mod_id, "status": "active"}, {"_id": 0}
        ).to_list(50)
        execs = [a for a in assignments if a.get("role") == "executor"]
        best = None
        for e in execs:
            sc = await db.developer_scores.find_one(
                {"developer_id": e["developer_id"]}, {"_id": 0}
            ) or {}
            e_combined = float(sc.get("combined_score") or 50)
            if not best or e_combined > best["combined"]:
                best = {**e, "combined": e_combined}
        recs.append(
            {
                "type": "change_owner",
                "severity": "high",
                "title": "Owner underqualified for this module",
                "detail": (
                    f"{raw.get('role_fit_reason') or 'Owner fails Q/R gate'}. "
                    + (
                        f"Consider promoting executor "
                        f"{best.get('developer_id')}"
                        if best else "No executor available as replacement."
                    )
                ),
                "new_owner_candidate": best.get("developer_id") if best else None,
            }
        )

    # 3. QA failing → escalate
    if score["qa_risk"] > 0.35:
        recs.append(
            {
                "type": "escalate_qa",
                "severity": "high" if score["qa_risk"] > 0.5 else "medium",
                "title": "Escalate QA attention",
                "detail": (
                    f"{raw.get('qa_failed', 0)}/{raw.get('qa_total', 0)} reviews "
                    f"failed ({score['qa_risk']*100:.0f}%). "
                    "Request senior review or pair-programming session."
                ),
            }
        )

    # 4. Silence + low velocity → add support
    if score["silence_risk"] > 0.4 or (
        score["progress_velocity"] < 0.15 and score.get("team_size", 0) < 3
    ):
        recs.append(
            {
                "type": "add_support",
                "severity": "medium",
                "title": "Add executor for support",
                "detail": (
                    f"Velocity low ({score['progress_velocity']*100:.0f}%) "
                    f"or team silent ({raw.get('silent_tasks', 0)} silent tasks). "
                    "Adding an executor could unblock progress."
                ),
            }
        )

    # Tag band
    for r in recs:
        r["module_id"] = mod_id
    return recs


async def recompute_team_score(
    db, module_id: str, emit_event=None
) -> dict:
    """Compute + persist + optionally notify."""
    score = await compute_team_score(db, module_id)
    if "error" in score:
        return score

    recs = await compute_recommendations(db, score)
    score["recommendations"] = recs
    score["recommendation_count"] = len(recs)

    await db.team_scores.update_one(
        {"module_id": module_id},
        {"$set": score},
        upsert=True,
    )

    if emit_event:
        prev = await db.team_scores.find_one(
            {"module_id": module_id}, {"_id": 0, "team_band": 1}
        ) or {}
        if prev.get("team_band") != score["team_band"]:
            await emit_event(
                "intelligence:team_band_changed",
                {
                    "module_id": module_id,
                    "previous_band": prev.get("team_band"),
                    "new_band": score["team_band"],
                    "efficiency": score["team_efficiency"],
                    "risk": score["team_risk"],
                },
            )

    return score


async def recompute_all_teams(db, emit_event=None) -> dict:
    module_ids = await db.module_assignments.distinct(
        "module_id", {"status": "active"}
    )
    count = 0
    for mid in module_ids:
        try:
            await recompute_team_score(db, mid, emit_event=emit_event)
            count += 1
        except Exception:
            continue
    return {"recomputed": count, "at": _now_iso()}


async def admin_teams_overview(db) -> dict:
    scores = await db.team_scores.find({}, {"_id": 0}).to_list(500)
    strong = [s for s in scores if s.get("team_band") == "strong"]
    stable = [s for s in scores if s.get("team_band") == "stable"]
    fragile = [s for s in scores if s.get("team_band") == "fragile"]
    failing = [s for s in scores if s.get("team_band") == "failing"]

    # Collect all recommendations flat
    all_recs = []
    for s in scores:
        for r in s.get("recommendations") or []:
            all_recs.append({**r, "module_title": s.get("module_title")})

    return {
        "counts": {
            "strong": len(strong), "stable": len(stable),
            "fragile": len(fragile), "failing": len(failing),
            "total": len(scores),
        },
        "strong": strong[:5],
        "fragile": fragile[:10],
        "failing": failing[:10],
        "recommendations": all_recs[:50],
    }


async def ensure_indexes(db):
    await db.team_scores.create_index("module_id", unique=True)
    await db.team_scores.create_index("team_band")
