"""
Team Balancer — v1 (self-regulating team load).

CORE RULE:
    System does NOT give everything to the strongest.
    System does NOT starve the weaker.

APPROACH (soft, not aggressive):
    1. Detect overloaded devs (count + share-of-total > thresholds).
    2. Apply load_penalty in assignment_engine scoring (already wired).
    3. Rebalance only NOT-STARTED modules (never touch active work).
    4. Reassign to LOWER-TIER candidates (not idle dev — fair spread).
    5. Audit + realtime emit every action (source="auto_balancer").

WHAT IT DOES NOT DO:
    - Ban top devs.
    - Touch in_progress / review / completed modules.
    - Force assignment without a viable candidate.
    - ML, predictions, complex scoring.

INTEGRATION:
    - GET  /api/admin/team/overloaded        (list + reasons + suggestions)
    - POST /api/admin/team/rebalance/{dev}   (manual trigger for one dev)
    - POST /api/admin/team/auto-rebalance    (manual trigger for all)
    - Periodic auto-rebalance from operator loop (every 10 min, 2 moves/hour/dev cap).
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

# Decay signal — single source of truth, do not reimplement here.
try:
    from reputation_decay import apply_decay
except Exception:  # pragma: no cover — decay module is always present in prod
    def apply_decay(_last_active, now=None):  # type: ignore
        return 0

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["team-balancer"])

# ============================================================================
# THRESHOLDS — overridable via env, but sane defaults enforce soft touch
# ============================================================================
OVERLOAD_THRESHOLD_MODULES = int(os.environ.get("OVERLOAD_THRESHOLD_MODULES", "4"))
OVERLOAD_THRESHOLD_SHARE = float(os.environ.get("OVERLOAD_THRESHOLD_SHARE", "0.5"))
MAX_AUTO_REASSIGNS_PER_DEV_PER_HOUR = int(
    os.environ.get("MAX_AUTO_REASSIGNS_PER_DEV_PER_HOUR", "2")
)
REBALANCE_SAFE_STATUSES = {"pending", "not_started", "queued"}  # NEVER in_progress/review

# Tier rank used when selecting a lower-tier candidate (smaller = junior)
TIER_RANK = {"junior": 1, "middle": 2, "senior": 3, "lead": 4, "elite": 5}

# ---------------------------------------------------------------------------
# DECAY-AWARE REBALANCE (soft correcting layer on top of existing balancer)
# ---------------------------------------------------------------------------
# Rule of thumb:
#   busy senior    → NOT a candidate  (decay_penalty == 0)
#   lazy overloaded → IS  a candidate (high load + high decay)
#
# Thresholds are intentionally loose so we move at most 1-2 modules per cycle,
# never optimize — only nudge the system back toward fairness.
PRESSURE_OVERLOAD_THRESHOLD = float(
    os.environ.get("PRESSURE_OVERLOAD_THRESHOLD", "1.2")
)
PRESSURE_DECAY_THRESHOLD = int(
    os.environ.get("PRESSURE_DECAY_THRESHOLD", "3")
)
# From reputation_decay: penalty is in 0..15 range.
DECAY_MAX = 15


def calculate_dev_pressure(active_tasks: int, avg_tasks: float, decay_penalty: int) -> float:
    """Soft signal combining workload and decay.

    workload_ratio = how many tasks this dev has vs. team average
    decay_share    = how deep into the decay curve they are (0..1)

    pressure = 0.6 * workload_ratio + 0.4 * decay_share

    A busy senior who is ALSO active (decay=0) will score under the threshold.
    An overloaded dev who is going inactive will score well above it.
    """
    baseline = avg_tasks if avg_tasks and avg_tasks > 0 else 1.0
    overload_ratio = float(active_tasks) / baseline
    decay_share = min(float(decay_penalty), DECAY_MAX) / DECAY_MAX
    return round(overload_ratio * 0.6 + decay_share * 0.4, 3)


def is_rebalance_candidate(active_tasks: int, decay_penalty: int, pressure: float) -> bool:
    """Gatekeeper — only devs who are BOTH overloaded AND decaying qualify.

    This is the whole point: we don't touch healthy busy devs. We only
    intervene when a dev is holding work AND not moving it.
    """
    return (
        pressure > PRESSURE_OVERLOAD_THRESHOLD
        and decay_penalty >= PRESSURE_DECAY_THRESHOLD
        and active_tasks > 1  # never strip a dev with 0-1 tasks
    )


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_id_of(user) -> Optional[str]:
    if user is None:
        return None
    if isinstance(user, dict):
        return user.get("user_id")
    return getattr(user, "user_id", None)


# ============================================================================
# DETECTION
# ============================================================================
async def count_active_modules(db) -> int:
    """Total active modules across the system (used for share calculation)."""
    return await db.modules.count_documents({
        "status": {"$in": ["in_progress", "review", "qa_pending", "pending", "not_started"]},
        "assigned_to": {"$ne": None},
    })


async def dev_active_count(db, dev_id: str) -> int:
    return await db.modules.count_documents({
        "assigned_to": dev_id,
        "status": {"$in": ["in_progress", "review", "qa_pending", "pending", "not_started"]},
    })


async def detect_overloaded(db) -> List[Dict[str, Any]]:
    """Find devs whose load is above threshold AND whose activity is decaying.

    Returns list with active_count, share, reasons, suggestion_count,
    decay_penalty, pressure_score, and `priority_rebalance` flag — the
    candidate filter consumers (rebalance loop) must honor.

    Design:
      - Raw load (count+share) produces a "watchlist" of loaded devs.
      - Decay penalty + pressure score split that watchlist into:
          * busy senior (healthy, active)     → NOT a rebalance candidate
          * lazy overloaded (decaying dev)    → IS a rebalance candidate
      - `priority_rebalance` is the flag the rebalancer uses. Everything
        else is only surfaced for admin UI transparency.
    """
    total = await count_active_modules(db)
    pipeline = [
        {"$match": {
            "status": {"$in": ["in_progress", "review", "qa_pending", "pending", "not_started"]},
            "assigned_to": {"$ne": None},
        }},
        {"$group": {"_id": "$assigned_to", "n": {"$sum": 1}}},
    ]
    rows = await db.modules.aggregate(pipeline).to_list(1000)

    # Average active modules per loaded dev — used as baseline for pressure.
    counts = [int(r.get("n") or 0) for r in rows if r.get("n")]
    avg_active = (sum(counts) / len(counts)) if counts else 0.0

    overloaded: List[Dict[str, Any]] = []
    for r in rows:
        dev_id = r.get("_id")
        if not dev_id:
            continue
        n = int(r.get("n") or 0)
        share = (n / total) if total else 0.0

        reasons = []
        if n > OVERLOAD_THRESHOLD_MODULES:
            reasons.append(f"active_modules={n} (threshold {OVERLOAD_THRESHOLD_MODULES})")
        if share > OVERLOAD_THRESHOLD_SHARE:
            reasons.append(f"share={share:.0%} (threshold {OVERLOAD_THRESHOLD_SHARE:.0%})")
        if not reasons:
            continue

        # How many of dev's modules are safe to rebalance (not started)?
        safe_count = await db.modules.count_documents({
            "assigned_to": dev_id,
            "status": {"$in": list(REBALANCE_SAFE_STATUSES)},
        })

        dev = await db.users.find_one(
            {"user_id": dev_id},
            {"_id": 0, "name": 1, "email": 1, "level": 1, "last_active_at": 1},
        )
        decay_penalty = apply_decay((dev or {}).get("last_active_at"))
        pressure = calculate_dev_pressure(n, avg_active, decay_penalty)
        priority = is_rebalance_candidate(n, decay_penalty, pressure)
        if priority:
            reasons.append(f"pressure={pressure} decay={decay_penalty}")

        overloaded.append({
            "developer_id": dev_id,
            "developer_name": (dev or {}).get("name") or "Developer",
            "developer_tier": (dev or {}).get("level") or "junior",
            "active_modules": n,
            "share": round(share, 3),
            "reasons": reasons,
            "rebalanceable_count": safe_count,
            "decay_penalty": decay_penalty,
            "pressure_score": pressure,
            "avg_active_per_dev": round(avg_active, 2),
            "priority_rebalance": priority,
        })

    # Priority rebalance candidates first, then by share.
    overloaded.sort(key=lambda x: (not x["priority_rebalance"], -x["share"]))
    return overloaded


# ============================================================================
# REBALANCE
# ============================================================================
async def _recent_auto_reassign_count(db, dev_id: str, hours: int = 1) -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    return await db.system_actions_log.count_documents({
        "source": "auto_balancer",
        "action": "auto_reassign",
        "payload.from_dev": dev_id,
        "created_at": {"$gte": cutoff},
    })


async def _find_candidate(db, module: Dict[str, Any], from_dev_tier: str) -> Optional[Dict[str, Any]]:
    """Find a replacement developer.

    Scoring (higher is better):
      0.6 * inverse_load  +  0.4 * (1 - decay_share)

    - inverse_load favors devs with fewer active modules
    - decay_share penalizes devs who are also going inactive
    - anti-monopoly: skip tiers strictly above the overloaded dev's
      tier — we rebalance SIDEWAYS or DOWN, never up, so we don't
      feed every module to the "one best dev".

    Returns the candidate user dict or None.
    """
    from_rank = TIER_RANK.get(from_dev_tier or "junior", 1)
    devs = await db.users.find(
        {"$or": [{"role": "developer"}, {"roles": "developer"}],
         "status": {"$ne": "inactive"}},
        {"_id": 0, "user_id": 1, "name": 1, "level": 1, "skills": 1,
         "status": 1, "last_active_at": 1},
    ).to_list(500)

    scored: List[tuple] = []
    for d in devs:
        did = d.get("user_id")
        if not did or did == module.get("assigned_to"):
            continue
        d_rank = TIER_RANK.get(d.get("level") or "junior", 1)
        if d_rank > from_rank:
            continue  # anti-monopoly: don't feed up
        cnt = await dev_active_count(db, did)
        if cnt >= OVERLOAD_THRESHOLD_MODULES:
            continue
        d_decay = apply_decay(d.get("last_active_at"))
        # Never hand work to a dev who is ALSO decaying — we'd just
        # shift the problem. Target must be active enough.
        if d_decay >= PRESSURE_DECAY_THRESHOLD:
            continue
        inverse_load = 1.0 / (cnt + 1)
        decay_health = 1.0 - (min(d_decay, DECAY_MAX) / DECAY_MAX)
        score = round(inverse_load * 0.6 + decay_health * 0.4, 4)
        scored.append((score, cnt, d))

    if not scored:
        return None
    # Highest score wins; break ties by lower active count.
    scored.sort(key=lambda x: (-x[0], x[1]))
    return scored[0][2]


async def rebalance_one_dev(db, dev_id: str, admin_id: Optional[str],
                            realtime=None, max_moves: int = 2) -> Dict[str, Any]:
    """Soft rebalance: move up to `max_moves` NOT-STARTED modules from dev_id
    to lower-tier candidates with spare capacity.

    Returns summary dict: {moves, from_dev, new_active_count, details[]}.
    """
    dev = await db.users.find_one({"user_id": dev_id}, {"_id": 0})
    if not dev:
        raise HTTPException(404, detail="Developer not found")

    before_count = await dev_active_count(db, dev_id)
    from_decay = apply_decay(dev.get("last_active_at"))

    # Only not-started / pending modules qualify
    movable = await db.modules.find(
        {"assigned_to": dev_id,
         "status": {"$in": list(REBALANCE_SAFE_STATUSES)}},
        {"_id": 0, "module_id": 1, "title": 1, "status": 1, "project_id": 1, "priority": 1},
    ).sort("priority", 1).limit(10).to_list(10)

    moves = []
    for mod in movable:
        if len(moves) >= max_moves:
            break
        cand = await _find_candidate(db, mod, dev.get("level"))
        if not cand:
            continue
        mid = mod["module_id"]
        to_dev = cand["user_id"]
        now_iso = _iso_now()

        await db.modules.update_one(
            {"module_id": mid},
            {"$set": {
                "assigned_to": to_dev,
                # New decay-aware fields (read by why_assigned + admin UI).
                "rebalanced_from": dev_id,
                "rebalanced_at": now_iso,
                "rebalanced_reason": "decay+overload" if from_decay >= PRESSURE_DECAY_THRESHOLD else "load_rebalance",
                "rebalanced_from_decay": from_decay,
                # Keep legacy fields for backward compatibility with older consumers.
                "reassigned_at": now_iso,
                "reassigned_by": admin_id or "auto_balancer",
                "reassigned_reason": "load_rebalance",
                "reassigned_from": dev_id,
            }},
        )

        log_id = f"slog_{uuid.uuid4().hex[:12]}"
        await db.system_actions_log.insert_one({
            "log_id": log_id,
            "admin_id": admin_id,
            "action": "auto_reassign",
            "entity_type": "module",
            "entity_id": mid,
            "payload": {
                "from_dev": dev_id,
                "from_dev_name": dev.get("name"),
                "from_dev_decay": from_decay,
                "to_dev": to_dev,
                "to_dev_name": cand.get("name"),
                "reason": "decay+overload" if from_decay >= PRESSURE_DECAY_THRESHOLD else "load_rebalance",
                "module_title": mod.get("title"),
                "module_status": mod.get("status"),
            },
            "source": "auto_balancer",
            "status": "executed",
            "created_at": now_iso,
        })

        if realtime is not None:
            try:
                await realtime.emit_to_role("admin", "admin.auto_rebalanced", {
                    "module_id": mid,
                    "module_title": mod.get("title"),
                    "from_dev": dev_id,
                    "from_dev_name": dev.get("name"),
                    "to_dev": to_dev,
                    "to_dev_name": cand.get("name"),
                    "decay": from_decay,
                    "reason": "decay+overload" if from_decay >= PRESSURE_DECAY_THRESHOLD else "load_rebalance",
                    "by": admin_id or "auto",
                    "at": now_iso,
                    "timestamp": now_iso,
                })
            except Exception as e:
                logger.warning(f"realtime_emit_failed event=admin.auto_rebalanced err={e}")

        moves.append({
            "module_id": mid,
            "module_title": mod.get("title"),
            "to_dev": to_dev,
            "to_dev_name": cand.get("name"),
            "to_dev_tier": cand.get("level"),
        })

    after_count = await dev_active_count(db, dev_id)
    reason_tag = "decay+overload" if from_decay >= PRESSURE_DECAY_THRESHOLD else "overload"
    logger.info(
        f"AUTO_BALANCER: rebalanced dev={dev_id} moves={len(moves)} "
        f"before={before_count} after={after_count} decay={from_decay} reason={reason_tag}"
    )

    return {
        "from_dev": dev_id,
        "from_dev_name": dev.get("name"),
        "before_active": before_count,
        "after_active": after_count,
        "moves": moves,
        "moves_count": len(moves),
    }


async def auto_rebalance_all(db, realtime=None) -> Dict[str, Any]:
    """Periodic auto-rebalance. Respects per-dev rate limit.
    Called from operator loop.

    Gatekeeping rules (decay-aware v2):
      1. Only devs whose load + decay fail `is_rebalance_candidate` are touched.
         A busy senior with no decay is NEVER rebalanced.
      2. Hard cap: at most 2 total moves per cycle (system-wide), not per dev.
         Balancer NUDGES, never optimizes.
      3. Per-dev rate limit from env still applies.
    """
    overloaded = await detect_overloaded(db)
    # Only priority (decay+overload) devs trigger rebalance.
    priority_pool = [x for x in overloaded if x.get("priority_rebalance")]

    total_moves = 0
    per_dev: List[Dict[str, Any]] = []
    CYCLE_CAP = 2  # hard ceiling per cycle — see design note above

    for od in priority_pool:
        if total_moves >= CYCLE_CAP:
            per_dev.append({
                "developer_id": od["developer_id"],
                "skipped": True,
                "reason": f"cycle_cap_reached ({CYCLE_CAP} moves already)",
            })
            continue
        dev_id = od["developer_id"]
        recent = await _recent_auto_reassign_count(db, dev_id)
        if recent >= MAX_AUTO_REASSIGNS_PER_DEV_PER_HOUR:
            per_dev.append({
                "developer_id": dev_id,
                "skipped": True,
                "reason": f"rate_limit {recent}/{MAX_AUTO_REASSIGNS_PER_DEV_PER_HOUR} last hour",
            })
            continue
        budget = min(
            MAX_AUTO_REASSIGNS_PER_DEV_PER_HOUR - recent,
            CYCLE_CAP - total_moves,
        )
        summary = await rebalance_one_dev(db, dev_id, admin_id=None,
                                           realtime=realtime, max_moves=budget)
        total_moves += summary["moves_count"]
        per_dev.append({
            "developer_id": dev_id,
            "decay_penalty": od.get("decay_penalty"),
            "pressure_score": od.get("pressure_score"),
            **summary,
        })

    logger.info(
        f"AUTO_BALANCER: cycle complete — overloaded={len(overloaded)} "
        f"priority={len(priority_pool)} moves={total_moves} "
        f"reason=decay+overload"
    )
    return {
        "checked_overloaded": len(overloaded),
        "priority_candidates": len(priority_pool),
        "total_moves": total_moves,
        "per_developer": per_dev,
        "at": _iso_now(),
    }


# ============================================================================
# ROUTER
# ============================================================================
def init_router(db, get_current_user_dep, require_role_dep, realtime=None):
    require_admin = require_role_dep("admin")

    @router.get("/admin/team/overloaded")
    async def overloaded_list(user=Depends(require_admin)) -> Dict[str, Any]:
        items = await detect_overloaded(db)
        return {
            "items": [{
                "id": x["developer_id"],
                "title": x["developer_name"],
                "subtitle": f"{x['active_modules']} modules · {int(x['share']*100)}% share · tier {x['developer_tier']}",
                "status": "overloaded",
                "meta": {
                    "active_modules": x["active_modules"],
                    "share": x["share"],
                    "tier": x["developer_tier"],
                    "reasons": x["reasons"],
                    "rebalanceable_count": x["rebalanceable_count"],
                },
                "primary_action": "rebalance",
                "actions": ["rebalance"] if x["rebalanceable_count"] > 0 else [],
            } for x in items],
            "summary": {
                "overloaded_count": len(items),
                "thresholds": {
                    "modules": OVERLOAD_THRESHOLD_MODULES,
                    "share": OVERLOAD_THRESHOLD_SHARE,
                },
            },
            "generated_at": _iso_now(),
        }

    @router.post("/admin/team/rebalance/{dev_id}")
    async def rebalance_dev(dev_id: str, user=Depends(require_admin)) -> Dict[str, Any]:
        admin_id = _user_id_of(user)
        summary = await rebalance_one_dev(db, dev_id, admin_id=admin_id,
                                           realtime=realtime,
                                           max_moves=MAX_AUTO_REASSIGNS_PER_DEV_PER_HOUR)
        return summary

    @router.post("/admin/team/auto-rebalance")
    async def trigger_auto(user=Depends(require_admin)) -> Dict[str, Any]:
        admin_id = _user_id_of(user)
        overloaded = await detect_overloaded(db)
        total_moves = 0
        details: List[Dict[str, Any]] = []
        for od in overloaded:
            s = await rebalance_one_dev(
                db, od["developer_id"], admin_id=admin_id,
                realtime=realtime,
                max_moves=MAX_AUTO_REASSIGNS_PER_DEV_PER_HOUR,
            )
            total_moves += s["moves_count"]
            details.append(s)
        return {"total_moves": total_moves, "details": details, "at": _iso_now()}

    return router
