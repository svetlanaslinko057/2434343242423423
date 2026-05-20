"""
Wave 11 — Scaling Engine
========================

Does NOT decide. Shapes the environment:
  - visibility (exposure_score on the fly)
  - price     (module.market_boost + global multiplier)
  - pressure  (stuck recovery, demand balancing)
  - attention (final scoring weights for flow_control)

4 engines, run in sequence by auto-balance (or operator scheduler):
  StuckEngine  · LoadEngine · DemandEngine · FlowEngine

Canonical writes (very limited):
  - modules.market_boost (+0.15, cap 1.5)  — for stuck modules
  - modules.price        (×1.15, one-shot) — for stuck modules
  - system_settings.global_price_multiplier
  - system_actions_log  — audit only

NEVER writes to users.
NEVER touches assignment_engine / bidding.
Provides score_multiplier(dev, module) for flow_control to read.

Public:
  build_router(admin_dep) → APIRouter
  wire(db, realtime, event_engine=None, revenue_brain=None)
  run_all_engines() — callable (operator/auto-balance/scheduler)
  exposure_score_for(db, dev_id) → float
  score_multiplier(dev_id, module_id) → float
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends

logger = logging.getLogger("scaling_engine")

# ─────────────────────────────────────────────────────────────
# Runtime wiring
# ─────────────────────────────────────────────────────────────
_db = None
_realtime = None
_event_engine = None
_revenue_brain = None

# Small in-memory cache (no user schema mutation)
_exposure_cache: Dict[str, Dict[str, float]] = {}  # dev_id → {score, ts}
_EXPOSURE_TTL = 60  # seconds


def wire(*, db, realtime, event_engine=None, revenue_brain=None):
    global _db, _realtime, _event_engine, _revenue_brain
    _db = db
    _realtime = realtime
    _event_engine = event_engine
    _revenue_brain = revenue_brain


def _now():
    return datetime.now(timezone.utc)


def _now_iso():
    return _now().isoformat()


async def _emit(event: str, payload: Dict[str, Any], role: str = "admin"):
    try:
        if _realtime is not None:
            await _realtime.emit_to_role(role, event, payload)
    except Exception as e:
        logger.warning(f"scaling emit failed: {e}")


async def _record_event(event_type: str, payload: Dict[str, Any]):
    try:
        if _event_engine and hasattr(_event_engine, "create_event"):
            ev = _event_engine.create_event(
                event_type=event_type,
                entity_type="scaling",
                entity_id=payload.get("module_id") or payload.get("dev_id") or "system",
                severity="low",
                title=event_type,
                message=payload.get("detail") or event_type,
                meta=payload,
            )
            await _db.events.insert_one(ev)
    except Exception as e:
        logger.warning(f"scaling record_event failed: {e}")


async def _log_action(engine: str, payload: Dict[str, Any]):
    await _db.system_actions_log.insert_one({
        "engine": engine,
        "payload": payload,
        "created_at": _now_iso(),
    })


# ─────────────────────────────────────────────────────────────
# Churn-risk set (cache per-run, so we can skip pressure on them)
# ─────────────────────────────────────────────────────────────
async def _churn_risk_client_ids() -> set:
    if _revenue_brain is None:
        return set()
    try:
        actions = await _revenue_brain.detect_revenue_actions()
        return {a.get("client_id") for a in actions if a.get("type") == "churn_risk" and a.get("client_id")}
    except Exception:
        return set()


async def _project_at_risk(project_id: str, churn_ids: set) -> bool:
    if not project_id or not churn_ids:
        return False
    p = await _db.projects.find_one({"project_id": project_id}, {"_id": 0, "client_id": 1})
    return bool(p and p.get("client_id") in churn_ids)


# ─────────────────────────────────────────────────────────────
# 1. StuckEngine
# ─────────────────────────────────────────────────────────────
async def run_stuck_engine() -> Dict[str, Any]:
    """Surface stuck modules and nudge visibility/price (no assignment changes)."""
    now = _now()
    touched: List[Dict[str, Any]] = []
    churn_ids = await _churn_risk_client_ids()

    mods = await _db.modules.find({
        "status": {"$in": ["open", "open_for_bids", "in_progress", "qa_review", "review", "in_review"]},
    }, {"_id": 0}).to_list(2000)

    for m in mods:
        status = m.get("status")
        ts_field = "created_at" if status in ("open", "open_for_bids") else (
            "started_at" if status == "in_progress" else "submitted_at"
        )
        ts = m.get(ts_field) or m.get("created_at")
        if not ts:
            continue
        try:
            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            age_h = (now - dt).total_seconds() / 3600
        except Exception:
            continue

        stuck = (
            (status in ("open", "open_for_bids") and age_h > 2) or
            (status == "in_progress" and age_h > 12) or
            (status in ("qa_review", "review", "in_review") and age_h > 24)
        )
        if not stuck:
            continue

        # Skip pressure on churn-risk client projects
        if await _project_at_risk(m.get("project_id"), churn_ids):
            continue

        # Price & visibility nudge (one-shot per scaling run, with cap)
        current_boost = float(m.get("market_boost") or 1.0)
        new_boost = min(1.5, round(current_boost + 0.15, 3))
        current_price = float(m.get("price") or 0)
        new_price = round(current_price * 1.15) if status in ("open", "open_for_bids") else current_price

        updates: Dict[str, Any] = {"market_boost": new_boost}
        if new_price != current_price:
            updates["price"] = new_price

        await _db.modules.update_one({"module_id": m["module_id"]}, {"$set": updates})

        touched.append({
            "module_id": m["module_id"],
            "status": status,
            "age_hours": round(age_h, 1),
            "boost": new_boost,
            "price_before": current_price,
            "price_after": new_price,
        })
        await _record_event("scaling:stuck_recovered", {
            "module_id": m["module_id"], "status": status,
            "age_hours": round(age_h, 1), "detail": f"stuck {status} {round(age_h)}h",
        })

    if touched:
        await _emit("scaling:stuck_recovered", {"count": len(touched), "modules": [t["module_id"] for t in touched]})
        await _log_action("stuck_engine", {"count": len(touched)})
    return {"engine": "stuck", "touched": len(touched), "modules": touched}


# ─────────────────────────────────────────────────────────────
# 2. LoadEngine — exposure_score on the fly (no user mutation)
# ─────────────────────────────────────────────────────────────
async def _compute_exposure_live(dev_id: str) -> float:
    user = await _db.users.find_one({"user_id": dev_id}, {"_id": 0, "capacity": 1})
    cap = int((user or {}).get("capacity") or 0)
    active = await _db.modules.count_documents({
        "assigned_to": dev_id,
        "status": {"$in": ["in_progress", "reserved", "qa_review", "review"]},
    })
    if cap <= 0:
        return 1.0  # neutral when capacity unknown
    ratio = active / cap
    if ratio >= 1.0: return 0.3   # overloaded
    if ratio >= 0.5: return 0.9   # balanced
    if ratio >= 0.2: return 1.2   # under-utilised
    return 1.7                    # idle — boost visibility


async def exposure_score_for(db, dev_id: str) -> float:
    """Read-only helper for flow_control (cached 60s)."""
    cached = _exposure_cache.get(dev_id)
    if cached and time.time() - cached["ts"] < _EXPOSURE_TTL:
        return cached["score"]
    score = await _compute_exposure_live(dev_id)
    _exposure_cache[dev_id] = {"score": score, "ts": time.time()}
    return score


async def run_load_engine() -> Dict[str, Any]:
    """Walk developers, refresh exposure cache, bucketize."""
    devs = await _db.users.find({"role": "developer"}, {"_id": 0, "user_id": 1, "capacity": 1}).to_list(500)
    buckets = {"overloaded": 0, "balanced": 0, "under": 0, "idle": 0}
    for d in devs:
        uid = d.get("user_id")
        if not uid:
            continue
        score = await _compute_exposure_live(uid)
        _exposure_cache[uid] = {"score": score, "ts": time.time()}
        if score <= 0.3: buckets["overloaded"] += 1
        elif score <= 0.9: buckets["balanced"] += 1
        elif score <= 1.2: buckets["under"] += 1
        else: buckets["idle"] += 1
    await _log_action("load_engine", buckets)
    await _emit("scaling:load_snapshot", buckets)
    return {"engine": "load", **buckets, "total_devs": len(devs)}


# ─────────────────────────────────────────────────────────────
# 3. DemandEngine — global_price_multiplier
# ─────────────────────────────────────────────────────────────
async def run_demand_engine() -> Dict[str, Any]:
    open_mods = await _db.modules.find(
        {"status": {"$in": ["open", "open_for_bids"]}}, {"_id": 0, "module_id": 1},
    ).to_list(500)
    module_ids = [m["module_id"] for m in open_mods]
    total_bids = 0
    if module_ids:
        # Use db.bids if exists, else db.proposals (ATLLAS) — tolerant
        try:
            total_bids = await _db.bids.count_documents({"module_id": {"$in": module_ids}})
        except Exception:
            total_bids = 0
        if not total_bids:
            try:
                total_bids = await _db.proposals.count_documents({"module_id": {"$in": module_ids}})
            except Exception:
                total_bids = 0

    avg_bids = (total_bids / len(module_ids)) if module_ids else 0.0

    cfg = await _db.system_settings.find_one({"key": "global_price_multiplier"}, {"_id": 0})
    current = float((cfg or {}).get("value") or 1.0)

    delta = 0.0
    if avg_bids < 2:    delta = 0.10   # low liquidity → raise price
    elif avg_bids > 5:  delta = -0.05  # hot market → ease prices

    new_multiplier = max(0.7, min(1.5, round(current + delta, 3)))

    if abs(new_multiplier - current) > 0.001:
        await _db.system_settings.update_one(
            {"key": "global_price_multiplier"},
            {"$set": {"key": "global_price_multiplier", "value": new_multiplier, "updated_at": _now_iso()}},
            upsert=True,
        )
        await _record_event("scaling:price_multiplier_changed", {
            "before": current, "after": new_multiplier, "avg_bids": round(avg_bids, 2),
            "detail": f"avg_bids={round(avg_bids,2)}",
        })
        await _emit("scaling:multiplier_changed", {"before": current, "after": new_multiplier})

    await _log_action("demand_engine", {
        "avg_bids": round(avg_bids, 3), "multiplier_before": current, "multiplier_after": new_multiplier,
    })
    return {
        "engine": "demand",
        "open_modules": len(module_ids),
        "total_bids": total_bids,
        "avg_bids": round(avg_bids, 2),
        "multiplier_before": current,
        "multiplier_after": new_multiplier,
    }


# ─────────────────────────────────────────────────────────────
# 4. FlowEngine — the integration point for flow_control
# ─────────────────────────────────────────────────────────────
async def score_multiplier(dev_id: str, module_id: str) -> Dict[str, float]:
    """
    Returns {'exposure': x, 'market_boost': y, 'combined': x*y}.
    Called by flow_control.recommend_top (read-only).
    """
    exposure = await exposure_score_for(_db, dev_id) if dev_id else 1.0
    mod = await _db.modules.find_one({"module_id": module_id}, {"_id": 0, "market_boost": 1}) if module_id else {}
    boost = float((mod or {}).get("market_boost") or 1.0)
    return {"exposure": exposure, "market_boost": boost, "combined": round(exposure * boost, 3)}


async def run_flow_engine() -> Dict[str, Any]:
    """
    Stateless — scoring math lives in score_multiplier. This "engine" just
    records the current state snapshot for observability.
    """
    mods_boosted = await _db.modules.count_documents({"market_boost": {"$gt": 1.0}})
    return {"engine": "flow", "boosted_modules": mods_boosted}


# ─────────────────────────────────────────────────────────────
# Orchestrator
# ─────────────────────────────────────────────────────────────
async def run_all_engines() -> Dict[str, Any]:
    """Run 4 engines in order. Used by auto-balance + scheduler."""
    if _db is None:
        return {"error": "not wired"}
    results: Dict[str, Any] = {}
    t0 = time.time()
    try:
        results["stuck"] = await run_stuck_engine()
    except Exception as e:
        logger.error(f"stuck_engine failed: {e}")
        results["stuck"] = {"error": str(e)}
    try:
        results["load"] = await run_load_engine()
    except Exception as e:
        logger.error(f"load_engine failed: {e}")
        results["load"] = {"error": str(e)}
    try:
        results["demand"] = await run_demand_engine()
    except Exception as e:
        logger.error(f"demand_engine failed: {e}")
        results["demand"] = {"error": str(e)}
    try:
        results["flow"] = await run_flow_engine()
    except Exception as e:
        logger.error(f"flow_engine failed: {e}")
        results["flow"] = {"error": str(e)}

    results["duration_ms"] = int((time.time() - t0) * 1000)
    results["timestamp"] = _now_iso()
    await _log_action("auto_balance", {
        "duration_ms": results["duration_ms"],
        "stuck": results["stuck"].get("touched", 0) if isinstance(results["stuck"], dict) else 0,
    })
    await _emit("scaling:auto_balance.complete", {
        "duration_ms": results["duration_ms"],
        "stuck": results["stuck"].get("touched") if isinstance(results["stuck"], dict) else None,
    })
    return results


# ─────────────────────────────────────────────────────────────
# /system/health/deep aggregator
# ─────────────────────────────────────────────────────────────
async def system_health_deep() -> Dict[str, Any]:
    # Developers breakdown
    devs = await _db.users.find({"role": "developer"}, {"_id": 0, "user_id": 1, "capacity": 1}).to_list(500)
    overloaded = idle = balanced = 0
    for d in devs:
        uid = d.get("user_id")
        score = _exposure_cache.get(uid, {}).get("score")
        if score is None:
            score = await _compute_exposure_live(uid)
            _exposure_cache[uid] = {"score": score, "ts": time.time()}
        if score <= 0.3: overloaded += 1
        elif score >= 1.7: idle += 1
        else: balanced += 1

    # Stuck modules (fast estimate)
    now = _now()
    stuck_count = 0
    mods = await _db.modules.find({
        "status": {"$in": ["open", "open_for_bids", "in_progress", "qa_review", "review", "in_review"]},
    }, {"_id": 0, "status": 1, "created_at": 1, "started_at": 1, "submitted_at": 1}).to_list(2000)
    for m in mods:
        status = m.get("status")
        ts = m.get("started_at") if status == "in_progress" else (
            m.get("submitted_at") if status in ("qa_review", "review", "in_review") else m.get("created_at")
        )
        if not ts:
            continue
        try:
            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            hrs = (now - dt).total_seconds() / 3600
            if (status in ("open", "open_for_bids") and hrs > 2) or \
               (status == "in_progress" and hrs > 12) or \
               (status in ("qa_review", "review", "in_review") and hrs > 24):
                stuck_count += 1
        except Exception:
            pass

    # avg_bids + liquidity
    open_ids = [m.get("module_id") for m in mods if m.get("status") in ("open", "open_for_bids")]
    total_bids = 0
    if open_ids:
        try:
            total_bids = await _db.bids.count_documents({"module_id": {"$in": open_ids}})
        except Exception:
            total_bids = 0
    avg_bids = (total_bids / len(open_ids)) if open_ids else 0.0
    liquidity = "high" if avg_bids >= 3 else "medium" if avg_bids >= 1.5 else "low"

    cfg = await _db.system_settings.find_one({"key": "global_price_multiplier"}, {"_id": 0})
    multiplier = float((cfg or {}).get("value") or 1.0)

    # Efficiency: fraction of modules not stuck
    total_active = len(mods) or 1
    efficiency = int(round((total_active - stuck_count) * 100 / total_active))

    # Load balance: 100 - |overloaded-idle|*20 (clamped)
    load_balance = max(0, 100 - abs(overloaded - idle) * 20)

    # Auto actions in last hour
    hour_ago = (now - timedelta(hours=1)).isoformat()
    auto_actions_1h = await _db.system_actions_log.count_documents({"created_at": {"$gte": hour_ago}})

    status_label = "balanced"
    if stuck_count > 5 or overloaded > balanced:
        status_label = "under_pressure"
    elif overloaded > 0 or stuck_count > 0:
        status_label = "imbalanced"

    return {
        "status": status_label,
        "overloaded": overloaded,
        "idle": idle,
        "balanced": balanced,
        "stuck": stuck_count,
        "avg_bids": round(avg_bids, 2),
        "liquidity": liquidity,
        "multiplier": multiplier,
        "efficiency": efficiency,
        "load_balance": load_balance,
        "auto_actions_1h": auto_actions_1h,
        "generated_at": _now_iso(),
    }


# ─────────────────────────────────────────────────────────────
# Router
# ─────────────────────────────────────────────────────────────
def build_router(*, admin_dep: Callable) -> APIRouter:
    r = APIRouter(tags=["scaling-engine"])

    @r.get("/system/health/deep")
    async def health_deep(admin=Depends(admin_dep)):
        return await system_health_deep()

    @r.post("/operator/auto-balance")
    async def auto_balance(admin=Depends(admin_dep)):
        return await run_all_engines()

    return r
