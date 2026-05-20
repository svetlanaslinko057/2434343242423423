"""
Block 7.1 — Controlled Autonomy (Auto-Guardian)

Two rules, both scoped to MONEY PROTECTION only.
The guardian NEVER touches ownership, approvals, or payouts themselves.

Rule R1 — AUTO REBALANCE (high confidence)
  If:
    - a module is over_budget
    - there's a rebalance/add-support suggestion in the last 60 min
    - that suggestion's confidence >= 0.85
    - no auto_rebalance has been executed for that module in the last 30 min
  Then:
    - create + execute an auto_rebalance action (ledger only — no owner change)
    - record reason/impact so it shows up in Block 5.2 transparency

Rule R2 — AUTO PAUSE (hard protection)
  If:
    - earned > cost * 1.2 (over budget by 20%+)
    - no system action for this module in the last 30 min
    - module is not already paused
  Then:
    - set modules.status = "paused"
    - log an auto_pause action (type in Block 5.2 is added below)

Everything else is off-limits.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

logger = logging.getLogger("auto_guardian")

REBALANCE_CONFIDENCE_THRESHOLD = 0.85
OVER_BUDGET_HARD_RATIO = 1.20
RECENT_ACTION_WINDOW_MIN = 30
SUGGESTION_WINDOW_MIN = 60
TICK_INTERVAL_SEC = 120  # 2 min


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


async def _module_earned(db, module_id: str) -> float:
    items = await db.payouts.find(
        {"module_id": module_id, "status": {"$in": ["approved", "paid"]}},
        {"_id": 0, "amount": 1},
    ).to_list(5000)
    return sum(float(x.get("amount") or 0) for x in items)


def _module_cost(m: Dict[str, Any]) -> float:
    return float(m.get("base_price") or m.get("final_price") or m.get("price") or 0)


async def _recent_action(db, module_id: str, types: List[str], window_min: int):
    since = _iso(_now() - timedelta(minutes=window_min))
    return await db.auto_actions.find_one(
        {"module_id": module_id, "type": {"$in": types}, "created_at": {"$gte": since}},
        {"_id": 0},
        sort=[("created_at", -1)],
    )


async def _create_auto_action(db, *, module_id: str, action_type: str,
                              confidence: float, reason: str, impact: str,
                              payload: Dict[str, Any]) -> Dict[str, Any]:
    now = _now()
    action_id = f"auto_{uuid.uuid4().hex[:12]}"
    doc = {
        "action_id": action_id,
        "module_id": module_id,
        "type": action_type,
        "status": "executed",
        "confidence": round(confidence, 2),
        "confidence_breakdown": {
            "signal_strength": round(min(1.0, confidence + 0.05), 2),
            "data_confidence": round(confidence, 2),
            "stability": round(max(0.5, confidence - 0.05), 2),
        },
        "reason": reason,
        "impact": impact,
        "payload": payload,
        "source": "guardian",  # so we can tell human vs guardian later
        "created_at": _iso(now),
        "executed_at": _iso(now),
    }
    await db.auto_actions.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _apply_rebalance(db, module: Dict[str, Any], suggestion: Dict[str, Any]) -> Dict[str, Any]:
    """R1: create+execute an auto_rebalance. Ledger-only — DOES NOT change ownership.
    (Real reassignment lives in Block 8.0. Here we only register the decision.)"""
    mid = module["module_id"]
    confidence = float(suggestion.get("confidence") or 0.85)
    earned = await _module_earned(db, mid)
    cost_cap = _module_cost(module)
    over = max(0.0, earned - cost_cap)
    return await _create_auto_action(
        db,
        module_id=mid,
        action_type="auto_rebalance",
        confidence=confidence,
        reason=(
            f"Over budget by ${over:.0f}. Existing rebalance suggestion "
            f"({int(confidence*100)}% confidence) within threshold."
        ),
        impact=f"Team reshuffled to absorb ${over:.0f} overage on \"{module.get('title','module')}\"",
        payload={"trigger": "over_budget", "over_amount": round(over, 2), "cost_cap": round(cost_cap, 2),
                  "earned": round(earned, 2), "source_suggestion": suggestion.get("action_id")},
    )


async def _apply_pause(db, module: Dict[str, Any]) -> Dict[str, Any]:
    """R2: hard-stop. Actually pauses the module."""
    mid = module["module_id"]
    earned = await _module_earned(db, mid)
    cost_cap = _module_cost(module)
    ratio = (earned / cost_cap) if cost_cap > 0 else 0.0
    await db.modules.update_one(
        {"module_id": mid},
        {"$set": {"status": "paused", "paused_at": _iso(_now()), "paused_by": "guardian"}},
    )
    return await _create_auto_action(
        db,
        module_id=mid,
        action_type="auto_pause",
        confidence=0.95,
        reason=(
            f"Over budget by {int((ratio-1)*100)}% (${earned:.0f} earned vs ${cost_cap:.0f} planned)."
            " No active system response."
        ),
        impact=f"Module paused automatically to stop further earnings on \"{module.get('title','module')}\"",
        payload={"trigger": "hard_over_budget", "ratio": round(ratio, 2),
                  "cost_cap": round(cost_cap, 2), "earned": round(earned, 2)},
    )


async def _project_auto_pause_if_blocked(db) -> int:
    """R3 — Project-level hard protection.
    If a project is 'blocked' (has modules paused by guardian) AND there are still
    active modules AND we haven't run this project-level action recently →
    pause all remaining active modules in that project.

    Emits a single auto_pause-project action with source='operator'.
    """
    # Find projects with at least one module paused by guardian
    paused_by_guardian = await db.modules.find(
        {"status": "paused", "paused_by": "guardian"},
        {"_id": 0, "project_id": 1},
    ).to_list(500)
    project_ids = list({m["project_id"] for m in paused_by_guardian if m.get("project_id")})
    if not project_ids:
        return 0

    triggered = 0
    for pid in project_ids:
        # Don't refire within the cooldown window
        since = _iso(_now() - timedelta(minutes=RECENT_ACTION_WINDOW_MIN))
        recent = await db.auto_actions.find_one(
            {"project_id": pid, "type": "auto_project_pause",
             "created_at": {"$gte": since}},
            {"_id": 0},
        )
        if recent:
            continue

        # Find still-active modules in this project
        active = await db.modules.find(
            {"project_id": pid, "status": {"$in": ["pending", "in_progress", "review"]}},
            {"_id": 0, "module_id": 1, "title": 1, "status": 1},
        ).to_list(500)
        if not active:
            continue

        paused_now = 0
        for m in active:
            await db.modules.update_one(
                {"module_id": m["module_id"]},
                {"$set": {"status": "paused",
                          "paused_at": _iso(_now()),
                          "paused_by": "operator",
                          "prev_status": m.get("status")}},
            )
            paused_now += 1

        # Log a SINGLE project-scope action with source='operator'
        now = _now()
        await db.auto_actions.insert_one({
            "action_id": f"auto_{uuid.uuid4().hex[:12]}",
            "project_id": pid,
            "module_id": None,   # project-scoped
            "type": "auto_project_pause",
            "status": "executed",
            "confidence": 0.95,
            "confidence_breakdown": {
                "signal_strength": 0.95, "data_confidence": 0.92, "stability": 0.90,
            },
            "reason": "Project is blocked — modules paused by system, no user response",
            "impact": f"Operator paused {paused_now} remaining active module(s) to stop project drift",
            "payload": {"paused_count": paused_now},
            "source": "operator",
            "created_at": _iso(now),
            "executed_at": _iso(now),
        })
        logger.info(f"OPERATOR auto_project_pause project={pid[-8:]} paused={paused_now}")
        triggered += 1

    return triggered


async def tick(db) -> Dict[str, Any]:
    """One pass of the guardian. Safe to call often."""
    result = {"scanned": 0, "rebalanced": 0, "paused": 0, "project_paused": 0,
               "skipped": 0, "skipped_manual": 0, "skipped_dev_mode": 0,
               "at": _iso(_now())}

    # Only look at modules that could be running
    modules = await db.modules.find(
        {"status": {"$in": ["pending", "in_progress", "review", "paused"]}},
        {"_id": 0},
    ).to_list(2000)

    # ── PRODUCTION MODE INVARIANT ──────────────────────────────────────
    # Resolve production_mode per project once, cache in memory. Rule:
    #   dev    → guardian skips ALL modules (human-only production)
    #   ai     → full autonomy (standard)
    #   hybrid → module-level assignment_mode decides (standard path)
    # Unknown/missing → treat as "hybrid" (no extra restriction).
    project_ids = {m.get("project_id") for m in modules if m.get("project_id")}
    dev_mode_projects: set = set()
    if project_ids:
        async for p in db.projects.find(
            {"project_id": {"$in": list(project_ids)}, "production_mode": "dev"},
            {"_id": 0, "project_id": 1},
        ):
            dev_mode_projects.add(p["project_id"])

    for m in modules:
        result["scanned"] += 1
        mid = m.get("module_id")
        if not mid:
            continue
        # Production-mode: dev = human-only, no guardian
        if m.get("project_id") in dev_mode_projects:
            result["skipped_dev_mode"] += 1
            continue
        # ── L1 INVARIANT: manual > auto ─────────────────────────────────
        # Modules marked manual are owned by the core team. Guardian MUST NOT
        # auto-pause, auto-rebalance, or touch them in any way. This is the
        # single boundary that keeps Layer 1 (manual) from being overridden
        # by Layer 2 (auto).
        if m.get("assignment_mode") == "manual":
            result["skipped_manual"] += 1
            continue
        cost_cap = _module_cost(m)
        if cost_cap <= 0:
            continue
        earned = await _module_earned(db, mid)
        if earned <= cost_cap:
            continue  # not over budget — guardian stays silent

        ratio = earned / cost_cap

        # ── R2: hard pause ───────────────────────────────────────────────
        if ratio > OVER_BUDGET_HARD_RATIO and m.get("status") != "paused":
            recent = await _recent_action(
                db, mid,
                ["auto_pause", "auto_rebalance", "auto_add_support"],
                RECENT_ACTION_WINDOW_MIN,
            )
            if not recent:
                await _apply_pause(db, m)
                result["paused"] += 1
                logger.info(f"GUARDIAN auto_pause module={mid[-8:]} ratio={ratio:.2f}")
                continue

        # ── R1: auto rebalance (soft protection) ─────────────────────────
        if m.get("status") != "paused":
            # look for a fresh rebalance / add_support suggestion
            since = _iso(_now() - timedelta(minutes=SUGGESTION_WINDOW_MIN))
            suggestion = await db.auto_actions.find_one(
                {"module_id": mid,
                 "type": {"$in": ["auto_rebalance", "auto_add_support"]},
                 "created_at": {"$gte": since},
                 "source": {"$ne": "guardian"}},  # don't compound our own
                {"_id": 0},
                sort=[("created_at", -1)],
            )
            if suggestion and float(suggestion.get("confidence") or 0) >= REBALANCE_CONFIDENCE_THRESHOLD:
                # don't re-fire if we already rebalanced recently
                recent = await _recent_action(db, mid, ["auto_rebalance"], RECENT_ACTION_WINDOW_MIN)
                if not recent:
                    await _apply_rebalance(db, m, suggestion)
                    result["rebalanced"] += 1
                    logger.info(f"GUARDIAN auto_rebalance module={mid[-8:]} conf={suggestion.get('confidence')}")
                    continue

        result["skipped"] += 1

    # R3: project-level escalation — runs AFTER module rules.
    try:
        result["project_paused"] = await _project_auto_pause_if_blocked(db)
    except Exception as e:
        logger.exception(f"R3 project escalation failed: {e}")

    return result


async def guardian_loop(db):
    """Fire-and-forget loop. Started from server.py on startup."""
    logger.info(f"GUARDIAN: loop started (interval {TICK_INTERVAL_SEC}s)")
    # small warm-up so it doesn't race with seeds
    await asyncio.sleep(30)
    while True:
        try:
            out = await tick(db)
            if out["rebalanced"] or out["paused"]:
                logger.info(f"GUARDIAN tick → {out}")
        except Exception as e:  # never die silently
            logger.exception(f"GUARDIAN tick failed: {e}")
        await asyncio.sleep(TICK_INTERVAL_SEC)
