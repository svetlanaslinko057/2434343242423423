"""
Phase 6.5 — System Truth Layer
==============================

Observability ONLY. Zero writes to core domain. Zero new engines.
Answers one question:

    "Does the system actually work, or is it just pretending?"

Aggregates 6 read-only views:
  1. pressure       — how stressed the system is right now
  2. flow           — liquidity / time-to-first-bid
  3. developers     — idle / overloaded / balanced / ghosts
  4. revenue        — blocked projects, churn, expansion
  5. drift          — "scaling is firing but symptoms are worsening"
  6. real_activity  — anti-fake signal (real bids vs. auto-actions)

One endpoint:
  GET /api/system/truth       (admin only)

One side-effect (audit only):
  system_truth_snapshots — stores last 24h of snapshots for drift detection.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends

logger = logging.getLogger("system_truth")

# ─────────────────────────────────────────────────────────────
# Runtime wiring
# ─────────────────────────────────────────────────────────────
_db = None
_scaling_engine = None
_revenue_brain = None


def wire(*, db, scaling_engine=None, revenue_brain=None):
    global _db, _scaling_engine, _revenue_brain
    _db = db
    _scaling_engine = scaling_engine
    _revenue_brain = revenue_brain


def _now():
    return datetime.now(timezone.utc)


def _now_iso():
    return _now().isoformat()


def _parse(ts: Any) -> Optional[datetime]:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


async def _count_bids(filter_: Dict[str, Any]) -> int:
    """Tolerant: bids collection if present, else proposals (ATLLAS)."""
    try:
        n = await _db.bids.count_documents(filter_)
        if n:
            return n
    except Exception:
        pass
    try:
        return await _db.proposals.count_documents(filter_)
    except Exception:
        return 0


async def _find_bids(filter_: Dict[str, Any], projection: Dict[str, Any], limit: int = 2000) -> List[Dict[str, Any]]:
    try:
        docs = await _db.bids.find(filter_, projection).to_list(limit)
        if docs:
            return docs
    except Exception:
        pass
    try:
        return await _db.proposals.find(filter_, projection).to_list(limit)
    except Exception:
        return []


# ─────────────────────────────────────────────────────────────
# 1. PRESSURE
# ─────────────────────────────────────────────────────────────
async def _pressure(open_mods: List[Dict[str, Any]], stuck_count: int, avg_bids: float) -> Dict[str, Any]:
    # Score each factor 0..1
    stuck_ratio = min(1.0, stuck_count / max(1, len(open_mods) or 1))
    demand_gap = 0.0 if avg_bids >= 3 else (3 - avg_bids) / 3.0  # low liquidity → higher score

    # Load pressure derived from exposure cache (via scaling engine, if wired)
    load_score = 0.0
    if _scaling_engine is not None:
        try:
            cache = getattr(_scaling_engine, "_exposure_cache", {}) or {}
            if cache:
                overloaded = sum(1 for v in cache.values() if (v or {}).get("score", 1) <= 0.3)
                load_score = min(1.0, overloaded / max(1, len(cache)))
        except Exception:
            load_score = 0.0

    factors = {"stuck": stuck_ratio, "demand": demand_gap, "load": load_score}
    dominant = max(factors, key=factors.get)
    max_val = factors[dominant]

    if max_val >= 0.6:
        level = "high"
    elif max_val >= 0.3:
        level = "medium"
    else:
        level = "low"

    reason_parts = []
    if stuck_count > 0:
        reason_parts.append(f"{stuck_count} stuck modules")
    if avg_bids < 2:
        reason_parts.append(f"low liquidity (avg {round(avg_bids, 1)} bids)")
    if load_score >= 0.4:
        reason_parts.append("developers overloaded")
    main_reason = ", ".join(reason_parts) if reason_parts else "system idle/healthy"

    return {
        "level": level,
        "main_reason": main_reason,
        "dominant_factor": dominant,
        "factors": {k: round(v, 2) for k, v in factors.items()},
    }


# ─────────────────────────────────────────────────────────────
# 2. FLOW HEALTH
# ─────────────────────────────────────────────────────────────
async def _flow_health(open_mods: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not open_mods:
        return {
            "avg_time_to_first_bid_hours": None,
            "modules_without_bids": 0,
            "modules_with_1_bid": 0,
            "modules_with_3plus_bids": 0,
            "open_modules": 0,
        }

    module_ids = [m["module_id"] for m in open_mods]
    bids = await _find_bids(
        {"module_id": {"$in": module_ids}},
        {"_id": 0, "module_id": 1, "created_at": 1},
        limit=5000,
    )

    # group bids by module_id
    by_mod: Dict[str, List[Dict[str, Any]]] = {}
    for b in bids:
        by_mod.setdefault(b.get("module_id"), []).append(b)

    without_bids = 0
    with_1 = 0
    with_3plus = 0
    first_bid_deltas_hours: List[float] = []

    for m in open_mods:
        ms = by_mod.get(m["module_id"], [])
        n = len(ms)
        if n == 0:
            without_bids += 1
        elif n == 1:
            with_1 += 1
        elif n >= 3:
            with_3plus += 1

        if ms:
            created = _parse(m.get("created_at"))
            if created:
                first_ts = min((_parse(b.get("created_at")) for b in ms if _parse(b.get("created_at"))), default=None)
                if first_ts:
                    first_bid_deltas_hours.append((first_ts - created).total_seconds() / 3600)

    avg_ttfb = round(sum(first_bid_deltas_hours) / len(first_bid_deltas_hours), 2) if first_bid_deltas_hours else None

    return {
        "avg_time_to_first_bid_hours": avg_ttfb,
        "modules_without_bids": without_bids,
        "modules_with_1_bid": with_1,
        "modules_with_3plus_bids": with_3plus,
        "open_modules": len(open_mods),
    }


# ─────────────────────────────────────────────────────────────
# 3. DEVELOPER REALITY (incl. ghosts)
# ─────────────────────────────────────────────────────────────
async def _developer_reality() -> Dict[str, Any]:
    devs = await _db.users.find({"role": "developer"}, {"_id": 0, "user_id": 1, "last_active_at": 1}).to_list(1000)

    idle = overloaded = balanced = ghosts = 0
    ghost_threshold = _now() - timedelta(days=14)

    # Use exposure cache from scaling_engine if available (no recompute)
    cache: Dict[str, Dict[str, float]] = {}
    if _scaling_engine is not None:
        cache = getattr(_scaling_engine, "_exposure_cache", {}) or {}

    for d in devs:
        uid = d.get("user_id")
        if not uid:
            continue
        # Ghost: no last_active_at OR very stale
        last_active = _parse(d.get("last_active_at"))
        if not last_active or last_active < ghost_threshold:
            # Still also check: did they ever bid?
            ever_bid = await _count_bids({"developer_id": uid}) > 0
            if not ever_bid:
                ghosts += 1
                continue

        score = (cache.get(uid) or {}).get("score")
        if score is None:
            # Compute lightweight: active/capacity
            user = await _db.users.find_one({"user_id": uid}, {"_id": 0, "capacity": 1})
            cap = int((user or {}).get("capacity") or 0)
            active = await _db.modules.count_documents({
                "assigned_to": uid,
                "status": {"$in": ["in_progress", "reserved", "qa_review", "review"]},
            })
            if cap <= 0:
                score = 1.0
            else:
                ratio = active / cap
                if ratio >= 1.0: score = 0.3
                elif ratio >= 0.5: score = 0.9
                elif ratio >= 0.2: score = 1.2
                else: score = 1.7

        if score <= 0.3:
            overloaded += 1
        elif score >= 1.7:
            idle += 1
        else:
            balanced += 1

    return {
        "idle": idle,
        "overloaded": overloaded,
        "balanced": balanced,
        "ghosts": ghosts,
        "total": len(devs),
    }


# ─────────────────────────────────────────────────────────────
# 4. MONEY SIGNAL
# ─────────────────────────────────────────────────────────────
async def _money_signal() -> Dict[str, Any]:
    # blocked_projects: active projects not completed, not moving
    all_projects = await _db.projects.find(
        {"status": {"$nin": ["completed", "cancelled"]}},
        {"_id": 0, "project_id": 1, "status": 1, "updated_at": 1, "created_at": 1},
    ).to_list(1000)

    stale_threshold = _now() - timedelta(days=7)
    blocked = 0
    for p in all_projects:
        ts = _parse(p.get("updated_at")) or _parse(p.get("created_at"))
        if ts and ts < stale_threshold:
            blocked += 1
        elif p.get("status") in ("blocked", "paused", "on_hold", "stuck"):
            blocked += 1

    churn_risk = 0
    expansion_ready = 0
    clients_ready_to_pay = 0

    if _revenue_brain is not None:
        try:
            actions = await _revenue_brain.detect_revenue_actions()
            for a in actions:
                t = a.get("type")
                if t == "churn_risk":
                    churn_risk += 1
                elif t in ("expansion_ready", "upsell_ready"):
                    expansion_ready += 1
                elif t in ("retainer_ready", "premium_ready", "invoice_due"):
                    clients_ready_to_pay += 1
        except Exception as e:
            logger.warning(f"revenue_brain unavailable: {e}")

    return {
        "blocked_projects": blocked,
        "clients_ready_to_pay": clients_ready_to_pay,
        "churn_risk": churn_risk,
        "expansion_ready": expansion_ready,
    }


# ─────────────────────────────────────────────────────────────
# 5. DRIFT DETECTION
# ─────────────────────────────────────────────────────────────
async def _drift(current: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compare current vitals to a snapshot ~20–30 min ago.
    If stuck ↑ AND avg_bids ↓ AND multiplier ↑ → scaling is firing but NOT healing.
    """
    window_start = (_now() - timedelta(minutes=30)).isoformat()
    window_end = (_now() - timedelta(minutes=20)).isoformat()

    prev = await _db.system_truth_snapshots.find_one(
        {"created_at": {"$gte": window_start, "$lte": window_end}},
        sort=[("created_at", -1)],
    )
    if not prev:
        return {"detected": False, "type": None, "since_minutes": None, "reason": "no baseline snapshot yet"}

    prev_stuck = int((prev.get("pressure") or {}).get("stuck_count", 0))
    prev_avg = float((prev.get("flow") or {}).get("_avg_bids_raw") or 0.0)
    prev_mult = float(prev.get("multiplier") or 1.0)

    cur_stuck = current["_stuck_count"]
    cur_avg = current["_avg_bids"]
    cur_mult = current["_multiplier"]

    stuck_rising = cur_stuck > prev_stuck
    bids_falling = cur_avg < prev_avg - 0.1
    mult_rising = cur_mult > prev_mult + 0.01

    if stuck_rising and bids_falling and mult_rising:
        since_min = int((_now() - _parse(prev.get("created_at")) or _now()).total_seconds() / 60) if _parse(prev.get("created_at")) else None
        return {
            "detected": True,
            "type": "liquidity_failure",
            "since_minutes": since_min,
            "reason": f"stuck {prev_stuck}→{cur_stuck}, bids {round(prev_avg,2)}→{round(cur_avg,2)}, mult {round(prev_mult,2)}→{round(cur_mult,2)}",
        }

    return {"detected": False, "type": None, "since_minutes": None}


# ─────────────────────────────────────────────────────────────
# 6. ANTI-FAKE REAL ACTIVITY
# ─────────────────────────────────────────────────────────────
async def _real_activity() -> Dict[str, Any]:
    now = _now()
    ten_ago = (now - timedelta(minutes=10)).isoformat()
    hour_ago = (now - timedelta(hours=1)).isoformat()

    real_bids_10m = await _count_bids({"created_at": {"$gte": ten_ago}})
    fake_pressure_actions = 0
    try:
        fake_pressure_actions = await _db.system_actions_log.count_documents({
            "created_at": {"$gte": hour_ago},
            "engine": {"$in": ["stuck_engine", "demand_engine", "auto_balance"]},
        })
    except Exception:
        pass

    # Signal quality: scaling is acting hard but market isn't responding
    if fake_pressure_actions >= 3 and real_bids_10m == 0:
        quality = "low"
    elif fake_pressure_actions >= 1 and real_bids_10m >= 1:
        quality = "high"
    elif fake_pressure_actions == 0:
        quality = "neutral"
    else:
        quality = "medium"

    return {
        "real_bids_last_10m": real_bids_10m,
        "fake_pressure_actions": fake_pressure_actions,
        "signal_quality": quality,
    }


# ─────────────────────────────────────────────────────────────
# Aggregator
# ─────────────────────────────────────────────────────────────
async def compute_truth() -> Dict[str, Any]:
    if _db is None:
        return {"error": "not wired"}

    now = _now()

    # Shared pulls
    open_mods = await _db.modules.find(
        {"status": {"$in": ["open", "open_for_bids"]}},
        {"_id": 0, "module_id": 1, "created_at": 1},
    ).to_list(2000)

    all_active_mods = await _db.modules.find({
        "status": {"$in": ["open", "open_for_bids", "in_progress", "qa_review", "review", "in_review"]},
    }, {"_id": 0, "status": 1, "created_at": 1, "started_at": 1, "submitted_at": 1}).to_list(2000)

    # stuck count
    stuck_count = 0
    for m in all_active_mods:
        status = m.get("status")
        ts = m.get("started_at") if status == "in_progress" else (
            m.get("submitted_at") if status in ("qa_review", "review", "in_review") else m.get("created_at")
        )
        dt = _parse(ts)
        if not dt:
            continue
        hrs = (now - dt).total_seconds() / 3600
        if (status in ("open", "open_for_bids") and hrs > 2) or \
           (status == "in_progress" and hrs > 12) or \
           (status in ("qa_review", "review", "in_review") and hrs > 24):
            stuck_count += 1

    # avg_bids on open modules
    total_bids = 0
    if open_mods:
        total_bids = await _count_bids({"module_id": {"$in": [m["module_id"] for m in open_mods]}})
    avg_bids = (total_bids / len(open_mods)) if open_mods else 0.0

    # global multiplier
    cfg = await _db.system_settings.find_one({"key": "global_price_multiplier"}, {"_id": 0})
    multiplier = float((cfg or {}).get("value") or 1.0)

    # Sections
    pressure = await _pressure(open_mods, stuck_count, avg_bids)
    pressure["stuck_count"] = stuck_count  # exposed for drift baseline

    flow = await _flow_health(open_mods)
    flow["_avg_bids_raw"] = round(avg_bids, 3)  # hidden, for drift

    developers = await _developer_reality()
    revenue = await _money_signal()
    real_activity = await _real_activity()

    # Drift needs prior snapshot
    drift = await _drift({
        "_stuck_count": stuck_count,
        "_avg_bids": avg_bids,
        "_multiplier": multiplier,
    })

    # System verdict (honest)
    verdict = "working"
    total_devs = developers.get("total", 0)
    active_devs = developers.get("idle", 0) + developers.get("overloaded", 0) + developers.get("balanced", 0)
    open_count = flow.get("open_modules", 0)
    if active_devs == 0 and (open_count == 0 or (real_activity["real_bids_last_10m"] == 0 and avg_bids == 0)):
        verdict = "empty_market"
    elif drift.get("detected"):
        verdict = "drifting"
    elif real_activity["signal_quality"] == "low" and pressure["level"] == "high":
        verdict = "pretending"
    elif pressure["level"] == "low" and real_activity["real_bids_last_10m"] == 0 and total_devs == 0:
        verdict = "idle"

    truth = {
        "verdict": verdict,
        "pressure": pressure,
        "flow": flow,
        "developers": developers,
        "revenue": revenue,
        "drift": drift,
        "real_activity": real_activity,
        "multiplier": multiplier,
        "generated_at": _now_iso(),
    }

    # Persist snapshot (audit only, no writes to core)
    try:
        await _db.system_truth_snapshots.insert_one({
            "created_at": _now_iso(),
            "verdict": verdict,
            "pressure": pressure,
            "flow": flow,
            "multiplier": multiplier,
            "_stuck_count_raw": stuck_count,
        })
        # retention: keep last 24h
        cutoff = (_now() - timedelta(hours=24)).isoformat()
        await _db.system_truth_snapshots.delete_many({"created_at": {"$lt": cutoff}})
    except Exception as e:
        logger.warning(f"truth snapshot save failed: {e}")

    return truth


# ─────────────────────────────────────────────────────────────
# Router
# ─────────────────────────────────────────────────────────────
def build_router(*, admin_dep: Callable) -> APIRouter:
    r = APIRouter(tags=["system-truth"])

    @r.get("/system/truth")
    async def system_truth(admin=Depends(admin_dep)):
        return await compute_truth()

    return r
