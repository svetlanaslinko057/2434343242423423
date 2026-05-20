"""
BLOCK 4.1 — INTELLIGENCE LAYER: Developer Quality Score.
BLOCK 4.2 — + Reliability Score (behavioural predictability).

Quality (0..100):
  qa_pass_rate × 40 + on_time_rate × 25
  + completion_rate × 20 + issue_penalty × 15

Reliability (0..100):
  consistency × 35 + stability × 25
  + reassignment_penalty × 20 + responsiveness × 20

Combined score used by team_layer.suggest_team:
  final = quality × 0.6 + reliability × 0.4

Smoothing: new = 0.7·old + 0.3·recalculated (applied per-metric)
Confidence: low (<3 reviews) / medium (3..9) / high (≥10)

Bands:
  80..100 → STRONG / RELIABLE
  60..79  → STABLE / NORMAL
  40..59  → WEAK   / UNSTABLE
  0..39   → RISK   / UNRELIABLE

Thresholds:
  OWNER:    quality ≥ 70 AND reliability ≥ 65
  EXECUTOR: quality ≥ 40 AND reliability ≥ 40
  EXCLUDE:  quality < 30 OR reliability < 30   (medium+ confidence only)
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

DEFAULT_SCORE = 50.0
SMOOTHING_ALPHA_OLD = 0.7
SMOOTHING_ALPHA_NEW = 0.3
MIN_REVIEWS_FOR_HIGH_CONFIDENCE = 10
MIN_REVIEWS_FOR_MEDIUM_CONFIDENCE = 3

# Quality thresholds
OWNER_MIN = 70
EXECUTOR_MIN = 40
EXCLUDE_BELOW = 30

# Reliability thresholds
RELIABILITY_OWNER_MIN = 65
RELIABILITY_EXECUTOR_MIN = 40
RELIABILITY_EXCLUDE_BELOW = 30

# Combined score weights (used by team_layer.suggest_team)
QUALITY_WEIGHT = 0.6
RELIABILITY_WEIGHT = 0.4

# Reliability observation window
RELIABILITY_WINDOW_DAYS = 14

SEVERITY_WEIGHTS = {
    "low": 0.2,
    "medium": 0.5,
    "high": 0.8,
    "critical": 1.0,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def band(score: float) -> str:
    if score >= 80:
        return "strong"
    if score >= 60:
        return "stable"
    if score >= 40:
        return "weak"
    return "risk"


def reliability_band(score: float) -> str:
    if score >= 80:
        return "reliable"
    if score >= 60:
        return "normal"
    if score >= 40:
        return "unstable"
    return "unreliable"


def confidence_level(total_reviews: int) -> str:
    if total_reviews < MIN_REVIEWS_FOR_MEDIUM_CONFIDENCE:
        return "low"
    if total_reviews < MIN_REVIEWS_FOR_HIGH_CONFIDENCE:
        return "medium"
    return "high"


# ========== RELIABILITY COMPUTATIONS ==========

def _parse_dt(v) -> Optional[datetime]:
    if not v:
        return None
    if isinstance(v, datetime):
        return v
    try:
        return datetime.fromisoformat(str(v))
    except (ValueError, TypeError):
        return None


async def _collect_activity_days(
    db, developer_id: str, window_days: int = RELIABILITY_WINDOW_DAYS
) -> tuple[set, int]:
    """
    Returns (set of distinct YYYY-MM-DD strings of activity, total_events).
    Activity = any timestamp on work_units / submissions / reviews in window.
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=window_days)
    cutoff_iso = cutoff.isoformat()
    days = set()
    events = 0

    # work_units (multiple timestamp fields)
    async for u in db.work_units.find(
        {"assigned_to": developer_id},
        {
            "_id": 0, "assigned_at": 1, "started_at": 1, "timer_started_at": 1,
            "completed_at": 1, "submitted_at": 1, "updated_at": 1,
        },
    ):
        for f in ("assigned_at", "started_at", "timer_started_at",
                  "completed_at", "submitted_at", "updated_at"):
            dt = _parse_dt(u.get(f))
            if dt and dt >= cutoff:
                days.add(dt.date().isoformat())
                events += 1

    # submissions
    async for s in db.submissions.find(
        {"developer_id": developer_id, "created_at": {"$gte": cutoff_iso}},
        {"_id": 0, "created_at": 1},
    ):
        dt = _parse_dt(s.get("created_at"))
        if dt:
            days.add(dt.date().isoformat())
            events += 1

    return days, events


async def _consistency_score(db, developer_id: str) -> tuple[float, int, int]:
    """Active days in window / window. Returns (rate, active_days, events)."""
    days, events = await _collect_activity_days(db, developer_id)
    window = RELIABILITY_WINDOW_DAYS
    return (len(days) / window if window else 0.0, len(days), events)


async def _stability_score(
    db, developer_id: str
) -> tuple[float, int]:
    """
    1 - (idle_days_with_pending_tasks / window).
    idle_day_with_pending = day with no activity but dev has active work units.
    Simplified: if dev has no pending tasks at all, returns 1.0.
    """
    now = datetime.now(timezone.utc)
    window = RELIABILITY_WINDOW_DAYS
    start = (now - timedelta(days=window)).date()

    # Had any active work in window?
    had_active = await db.work_units.count_documents(
        {
            "assigned_to": developer_id,
            "status": {"$in": ["in_progress", "assigned", "revision_needed"]},
        }
    )
    if not had_active:
        return (1.0, 0)

    activity_days, _ = await _collect_activity_days(db, developer_id)
    # Count days in window with NO activity
    all_days = set()
    for i in range(window):
        all_days.add((start + timedelta(days=i)).isoformat())
    idle_days = len(all_days - activity_days)
    # Long-idle = >24h gap on days with pending tasks
    # Simplification: clip at window
    rate = 1.0 - (idle_days / window)
    return (max(0.0, rate), idle_days)


async def _reassignment_penalty(
    db, developer_id: str
) -> tuple[float, int, int]:
    """
    1 - (reassigned / assigned).
    Counts module_assignments where status='removed' & removed_reason not
    'team_replaced' (= actual dev-level removal) vs all assignments for dev.
    Falls back to work_units with prev_assigned_to history if present.
    """
    total_assigns = await db.module_assignments.count_documents(
        {"developer_id": developer_id}
    )
    if total_assigns == 0:
        # Fall back to work_units reassignment
        wu_total = await db.work_units.count_documents(
            {"assigned_to": developer_id}
        )
        if wu_total == 0:
            return (1.0, 0, 0)
        wu_re = await db.work_units.count_documents(
            {"prev_assigned_to": developer_id}
        )
        rate = wu_re / wu_total if wu_total else 0
        return (1.0 - rate, wu_re, wu_total)

    removed = await db.module_assignments.count_documents(
        {
            "developer_id": developer_id,
            "status": "removed",
            "removed_reason": {"$ne": "team_replaced"},
        }
    )
    rate = removed / total_assigns
    return (max(0.0, 1.0 - rate), removed, total_assigns)


async def _responsiveness_score(
    db, developer_id: str
) -> tuple[float, float, int]:
    """
    avg(started_at - assigned_at) in hours → normalized.
      ≤1h → 1.0, ≤6h → 0.8, ≤24h → 0.5, >24h → 0.2
    Returns (normalized_score, avg_hours, sample_count).
    """
    samples = []
    async for u in db.work_units.find(
        {
            "assigned_to": developer_id,
            "assigned_at": {"$exists": True},
        },
        {"_id": 0, "assigned_at": 1, "started_at": 1, "timer_started_at": 1},
    ).limit(100):
        assigned = _parse_dt(u.get("assigned_at"))
        started = _parse_dt(u.get("started_at") or u.get("timer_started_at"))
        if assigned and started and started >= assigned:
            delta_h = (started - assigned).total_seconds() / 3600.0
            samples.append(delta_h)

    if not samples:
        return (0.5, -1, 0)  # neutral default

    avg_h = sum(samples) / len(samples)
    if avg_h <= 1:
        norm = 1.0
    elif avg_h <= 6:
        norm = 0.8
    elif avg_h <= 24:
        norm = 0.5
    else:
        norm = 0.2
    return (norm, round(avg_h, 2), len(samples))


async def compute_reliability_raw(db, developer_id: str) -> dict:
    """Returns reliability components and final weighted score (no smoothing)."""
    cons, active_days, events = await _consistency_score(db, developer_id)
    stab, idle_days = await _stability_score(db, developer_id)
    reass, reass_count, assigns_count = await _reassignment_penalty(
        db, developer_id
    )
    resp, avg_resp_h, resp_samples = await _responsiveness_score(
        db, developer_id
    )

    has_data = (events > 0) or (assigns_count > 0) or (resp_samples > 0)

    if not has_data:
        return {
            "reliability_score": DEFAULT_SCORE,
            "raw_reliability_score": DEFAULT_SCORE,
            "consistency_score": 0.0,
            "stability_score": 1.0,
            "reassignment_penalty": 1.0,
            "responsiveness_score": 0.5,
            "active_days": 0,
            "idle_days": 0,
            "reassigned_count": 0,
            "assignments_count": 0,
            "avg_response_hours": None,
            "response_samples": 0,
            "reliability_reason": "no_data",
        }

    raw = (
        cons * 35 + stab * 25 + reass * 20 + resp * 20
    )
    return {
        "reliability_score": round(raw, 2),
        "raw_reliability_score": round(raw, 2),
        "consistency_score": round(cons, 3),
        "stability_score": round(stab, 3),
        "reassignment_penalty": round(reass, 3),
        "responsiveness_score": round(resp, 3),
        "active_days": active_days,
        "idle_days": idle_days,
        "reassigned_count": reass_count,
        "assignments_count": assigns_count,
        "avg_response_hours": avg_resp_h if avg_resp_h >= 0 else None,
        "response_samples": resp_samples,
    }


# ========== COMPONENT COMPUTATIONS ==========

async def _qa_pass_rate(db, developer_id: str) -> tuple[float, int]:
    """Returns (rate 0..1, total_reviews). Looks at reviews + module qa_decisions."""
    # Use reviews collection (work-unit level) first
    total = await db.reviews.count_documents({
        "reviewer_id": {"$exists": True},
        "submission_id": {"$exists": True},
    })
    if total == 0:
        return (0.0, 0)

    # Find reviews where submission was by this dev
    dev_submissions = await db.submissions.distinct(
        "submission_id", {"developer_id": developer_id}
    )
    if not dev_submissions:
        return (0.0, 0)

    dev_reviews = await db.reviews.find(
        {"submission_id": {"$in": dev_submissions}}, {"_id": 0, "result": 1}
    ).to_list(500)

    if not dev_reviews:
        return (0.0, 0)

    passed = sum(1 for r in dev_reviews if r.get("result") == "approved")
    return (passed / len(dev_reviews), len(dev_reviews))


async def _on_time_rate(db, developer_id: str) -> tuple[float, int]:
    """Tasks completed on time / tasks completed total."""
    completed = await db.work_units.find(
        {
            "assigned_to": developer_id,
            "status": {"$in": ["completed", "done", "submitted"]},
        },
        {"_id": 0},
    ).to_list(500)

    if not completed:
        return (0.0, 0)

    on_time = 0
    for u in completed:
        assigned_at = u.get("assigned_at") or u.get("created_at")
        estimated_hours = u.get("estimated_hours", 0) or 8
        completed_at = (
            u.get("completed_at") or u.get("submitted_at") or u.get("updated_at")
        )
        if not (assigned_at and completed_at):
            continue
        try:
            if isinstance(assigned_at, str):
                assigned_at = datetime.fromisoformat(assigned_at)
            if isinstance(completed_at, str):
                completed_at = datetime.fromisoformat(completed_at)
            deadline = assigned_at + timedelta(hours=estimated_hours * 1.2)
            if completed_at <= deadline:
                on_time += 1
        except (ValueError, TypeError):
            continue
    return (on_time / len(completed), len(completed))


async def _completion_rate(db, developer_id: str) -> tuple[float, int]:
    """done_tasks / assigned_tasks (all time)."""
    assigned = await db.work_units.count_documents({"assigned_to": developer_id})
    if assigned == 0:
        return (0.0, 0)
    done = await db.work_units.count_documents(
        {
            "assigned_to": developer_id,
            "status": {"$in": ["completed", "done", "submitted"]},
        }
    )
    return (done / assigned, assigned)


async def _issue_penalty(db, developer_id: str) -> tuple[float, int]:
    """
    issue_penalty = 1 - severity_weighted_avg
    Looks at validation_issues for work_units owned by dev.
    """
    # Find work units owned by dev
    unit_ids = await db.work_units.distinct("unit_id", {"assigned_to": developer_id})
    if not unit_ids:
        return (1.0, 0)  # no issues, full penalty inverse = 1

    # Find validation tasks for these units
    validation_ids = await db.validation_tasks.distinct(
        "validation_id", {"work_unit_id": {"$in": unit_ids}}
    )
    # Also support older schema: unit_id
    if not validation_ids:
        validation_ids = await db.validation_tasks.distinct(
            "validation_id", {"unit_id": {"$in": unit_ids}}
        )

    if not validation_ids:
        return (1.0, 0)

    # Collect issues embedded in validation_tasks OR in validation_issues collection
    all_issues = []
    async for vt in db.validation_tasks.find(
        {"validation_id": {"$in": validation_ids}}, {"_id": 0, "issues": 1}
    ):
        for iss in vt.get("issues") or []:
            if isinstance(iss, dict):
                all_issues.append(iss.get("severity", "medium"))
            elif isinstance(iss, str):
                all_issues.append("medium")

    async for iss in db.validation_issues.find(
        {"validation_id": {"$in": validation_ids}}, {"_id": 0, "severity": 1}
    ):
        all_issues.append(iss.get("severity", "medium"))

    if not all_issues:
        return (1.0, 0)

    weighted = [SEVERITY_WEIGHTS.get(sev, 0.5) for sev in all_issues]
    avg = sum(weighted) / len(weighted)
    return (max(0.0, 1.0 - avg), len(all_issues))


# ========== CORE SCORE ==========

async def compute_quality_raw(db, developer_id: str) -> dict:
    """Returns raw components and final weighted score (no smoothing yet)."""
    qa_rate, qa_n = await _qa_pass_rate(db, developer_id)
    ot_rate, ot_n = await _on_time_rate(db, developer_id)
    comp_rate, comp_n = await _completion_rate(db, developer_id)
    issue_pen, issue_n = await _issue_penalty(db, developer_id)

    total_reviews = qa_n
    has_any_data = (qa_n + ot_n + comp_n + issue_n) > 0

    if not has_any_data:
        # Brand new dev — default score, low confidence
        return {
            "developer_id": developer_id,
            "quality_score": DEFAULT_SCORE,
            "raw_score": DEFAULT_SCORE,
            "qa_pass_rate": 0.0,
            "on_time_rate": 0.0,
            "completion_rate": 0.0,
            "issue_penalty": 1.0,
            "qa_reviews_count": 0,
            "tasks_completed": 0,
            "tasks_assigned": 0,
            "issues_count": 0,
            "confidence": "low",
            "reason": "no_data",
        }

    raw = (
        qa_rate * 40
        + ot_rate * 25
        + comp_rate * 20
        + issue_pen * 15
    )
    # If dev has zero reviews, cap the 'qa' contribution with default 0.5 pretend-rate
    if qa_n == 0:
        raw = 0.5 * 40 + ot_rate * 25 + comp_rate * 20 + issue_pen * 15

    return {
        "developer_id": developer_id,
        "quality_score": round(raw, 2),
        "raw_score": round(raw, 2),
        "qa_pass_rate": round(qa_rate, 3),
        "on_time_rate": round(ot_rate, 3),
        "completion_rate": round(comp_rate, 3),
        "issue_penalty": round(issue_pen, 3),
        "qa_reviews_count": qa_n,
        "tasks_completed": comp_n and int(comp_rate * comp_n),
        "tasks_assigned": comp_n,
        "issues_count": issue_n,
        "confidence": confidence_level(total_reviews),
    }


async def recompute_developer_score(
    db, developer_id: str, emit_event=None
) -> dict:
    """
    Compute raw quality + reliability, smooth each against stored value,
    persist combined document.
    """
    raw = await compute_quality_raw(db, developer_id)
    rel = await compute_reliability_raw(db, developer_id)

    existing = await db.developer_scores.find_one(
        {"developer_id": developer_id}, {"_id": 0}
    )
    previous_q = float(existing["quality_score"]) if existing else None
    previous_r = (
        float(existing.get("reliability_score", DEFAULT_SCORE))
        if existing else None
    )

    # Smooth quality
    if previous_q is None:
        smoothed_q = raw["quality_score"]
    else:
        smoothed_q = (
            SMOOTHING_ALPHA_OLD * previous_q
            + SMOOTHING_ALPHA_NEW * raw["quality_score"]
        )
    smoothed_q = round(max(0.0, min(100.0, smoothed_q)), 2)

    # Smooth reliability
    if previous_r is None:
        smoothed_r = rel["reliability_score"]
    else:
        smoothed_r = (
            SMOOTHING_ALPHA_OLD * previous_r
            + SMOOTHING_ALPHA_NEW * rel["reliability_score"]
        )
    smoothed_r = round(max(0.0, min(100.0, smoothed_r)), 2)

    combined = round(
        smoothed_q * QUALITY_WEIGHT + smoothed_r * RELIABILITY_WEIGHT, 2
    )

    doc = {
        **raw,
        **rel,
        "developer_id": developer_id,
        "quality_score": smoothed_q,
        "reliability_score": smoothed_r,
        "combined_score": combined,
        "previous_score": previous_q,
        "previous_reliability_score": previous_r,
        "band": band(smoothed_q),
        "reliability_band": reliability_band(smoothed_r),
        "updated_at": _now_iso(),
    }

    await db.developer_scores.update_one(
        {"developer_id": developer_id},
        {"$set": doc},
        upsert=True,
    )

    # Mirror on user for fast filtering
    await db.users.update_one(
        {"user_id": developer_id},
        {
            "$set": {
                "quality_score": smoothed_q,
                "quality_band": doc["band"],
                "quality_confidence": doc["confidence"],
                "reliability_score": smoothed_r,
                "reliability_band": doc["reliability_band"],
                "combined_score": combined,
            }
        },
    )

    if emit_event:
        if previous_q is not None and abs(smoothed_q - previous_q) >= 5:
            await emit_event(
                "intelligence:quality_changed",
                {
                    "developer_id": developer_id,
                    "previous_score": previous_q,
                    "new_score": smoothed_q,
                    "band": doc["band"],
                },
            )
        if previous_r is not None and abs(smoothed_r - previous_r) >= 5:
            await emit_event(
                "intelligence:reliability_changed",
                {
                    "developer_id": developer_id,
                    "previous_score": previous_r,
                    "new_score": smoothed_r,
                    "band": doc["reliability_band"],
                },
            )

    return doc


async def recompute_all(db, emit_event=None) -> dict:
    count = 0
    async for u in db.users.find({"role": "developer"}, {"_id": 0, "user_id": 1}):
        await recompute_developer_score(db, u["user_id"], emit_event=emit_event)
        count += 1
    return {"recomputed": count, "at": _now_iso()}


async def get_developer_score(db, developer_id: str) -> Optional[dict]:
    doc = await db.developer_scores.find_one(
        {"developer_id": developer_id}, {"_id": 0}
    )
    if not doc:
        return None
    return doc


async def list_scores(db, sort: str = "desc", limit: int = 100) -> list[dict]:
    direction = -1 if sort == "desc" else 1
    scores = await db.developer_scores.find(
        {}, {"_id": 0}
    ).sort("quality_score", direction).to_list(limit)
    # Enrich with dev name
    dev_ids = [s["developer_id"] for s in scores]
    names = {}
    async for u in db.users.find(
        {"user_id": {"$in": dev_ids}}, {"_id": 0, "user_id": 1, "name": 1, "level": 1}
    ):
        names[u["user_id"]] = {"name": u.get("name"), "level": u.get("level")}
    for s in scores:
        info = names.get(s["developer_id"], {})
        s["name"] = info.get("name", "Unknown")
        s["level"] = info.get("level")
    return scores


async def is_eligible_as_owner(db, developer_id: str) -> tuple[bool, Optional[dict]]:
    doc = await get_developer_score(db, developer_id)
    if not doc:
        return (True, None)  # no score → give benefit of doubt
    return (
        doc.get("quality_score", DEFAULT_SCORE) >= OWNER_MIN
        and doc.get("reliability_score", DEFAULT_SCORE) >= RELIABILITY_OWNER_MIN,
        doc,
    )


async def is_excluded(db, developer_id: str) -> bool:
    doc = await get_developer_score(db, developer_id)
    if not doc:
        return False
    # Only exclude with high/medium confidence AND fails either gate
    if doc.get("confidence") == "low":
        return False
    q = doc.get("quality_score", DEFAULT_SCORE)
    r = doc.get("reliability_score", DEFAULT_SCORE)
    return q < EXCLUDE_BELOW or r < RELIABILITY_EXCLUDE_BELOW


# ========== ADMIN OVERVIEW ==========

async def admin_overview(db) -> dict:
    all_scores = await list_scores(db, sort="desc", limit=500)
    strong = [s for s in all_scores if s.get("band") == "strong"]
    stable = [s for s in all_scores if s.get("band") == "stable"]
    weak = [s for s in all_scores if s.get("band") == "weak"]
    risk = [s for s in all_scores if s.get("band") == "risk"]

    reliable = [s for s in all_scores if s.get("reliability_band") == "reliable"]
    normal = [s for s in all_scores if s.get("reliability_band") == "normal"]
    unstable = [s for s in all_scores if s.get("reliability_band") == "unstable"]
    unreliable = [s for s in all_scores if s.get("reliability_band") == "unreliable"]

    # Top combined
    top_combined = sorted(
        all_scores,
        key=lambda s: s.get("combined_score", 0),
        reverse=True,
    )[:5]

    return {
        "counts": {
            "strong": len(strong), "stable": len(stable),
            "weak": len(weak), "risk": len(risk),
            "total": len(all_scores),
        },
        "reliability_counts": {
            "reliable": len(reliable), "normal": len(normal),
            "unstable": len(unstable), "unreliable": len(unreliable),
        },
        "top": strong[:5],
        "weak": weak[:10],
        "at_risk": risk[:10],
        "top_reliable": reliable[:5],
        "unstable": unstable[:10],
        "unreliable": unreliable[:10],
        "top_combined": top_combined,
    }


async def ensure_indexes(db):
    await db.developer_scores.create_index("developer_id", unique=True)
    await db.developer_scores.create_index("quality_score")
