"""
BLOCK 5.1 — SAFE AUTONOMY.
System that WATCHES → RECOMMENDS → SOMETIMES ACTS → LOGS → CAN REVERT.

Only 2 auto-actions allowed:
  • auto_rebalance   — move 1 pending task from overloaded dev to idle teammate
  • auto_add_support — add 1 executor when module is silent / slow

EXPLICITLY FORBIDDEN:
  ✗ change_owner   (too impactful)
  ✗ finances / payouts
  ✗ assign new team (requires client decision)
  ✗ cancel module

Confidence formula:
  confidence =
      team_risk / 100       × 0.5   (strong signal from Block 4.3)
    + data_confidence       × 0.3   (Block 4.1/4.2: low=0.3, med=0.6, high=1.0)
    + stability             × 0.2   (1 - volatility in last team recomputes)

Gates:
  ≥ 0.80  → AUTO EXECUTE
  0.6..0.8 → RECOMMENDATION ONLY (status=pending)
  < 0.6    → ignored (not stored)

Cooldown:
  Same module may receive at most 1 auto-action every 10 minutes.
  Same action type on same module not repeated within 24h.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

# === Config ===
SAFE_ACTION_TYPES = ("auto_rebalance", "auto_add_support")
EXECUTE_THRESHOLD = 0.80
RECOMMEND_THRESHOLD = 0.60
MODULE_COOLDOWN_MINUTES = 10
SAME_ACTION_COOLDOWN_HOURS = 24

# Rebalance trigger thresholds
REBALANCE_MAX_LOAD = 0.7
REBALANCE_MIN_LOAD = 0.3
REBALANCE_MIN_TASKS = 2

# Add-support trigger thresholds
SUPPORT_MIN_COMBINED = 60
SUPPORT_MAX_LOAD = 0.5
SUPPORT_ALLOCATION = 0.2
SUPPORT_RESPONSIBILITY = 0.15
MAX_TEAM_SIZE = 3

CONFIDENCE_DATA_MAP = {"low": 0.3, "medium": 0.6, "high": 1.0}


def _now():
    return datetime.now(timezone.utc)


def _now_iso():
    return _now().isoformat()


def _parse(v):
    if not v:
        return None
    if isinstance(v, datetime):
        return v
    try:
        return datetime.fromisoformat(str(v))
    except (ValueError, TypeError):
        return None


# ========== CONFIDENCE ==========

async def _stability_score(db, module_id: str) -> float:
    """
    1 - volatility in last 3 team_scores snapshots.
    Returns 1.0 if no history yet (neutral).
    """
    snaps = await db.team_score_history.find(
        {"module_id": module_id},
        {"_id": 0, "team_risk": 1, "team_efficiency": 1},
    ).sort("updated_at", -1).limit(3).to_list(3)

    if len(snaps) < 2:
        return 1.0

    risks = [float(s.get("team_risk", 0)) for s in snaps]
    effs = [float(s.get("team_efficiency", 0)) for s in snaps]
    # Simple volatility: max-min / 100
    vol_risk = (max(risks) - min(risks)) / 100.0
    vol_eff = (max(effs) - min(effs)) / 100.0
    volatility = (vol_risk + vol_eff) / 2.0
    return max(0.0, min(1.0, 1.0 - volatility))


async def compute_confidence(db, team_score: dict) -> tuple[float, dict]:
    """Returns (confidence_0_1, breakdown)."""
    team_risk = float(team_score.get("team_risk", 0)) / 100.0

    # Data confidence from team members
    module_id = team_score["module_id"]
    assignments = await db.module_assignments.find(
        {"module_id": module_id, "status": "active"}, {"_id": 0}
    ).to_list(20)
    dev_confidences = []
    for a in assignments:
        sc = await db.developer_scores.find_one(
            {"developer_id": a["developer_id"]}, {"_id": 0, "confidence": 1}
        ) or {}
        dev_confidences.append(CONFIDENCE_DATA_MAP.get(sc.get("confidence", "low"), 0.3))
    data_conf = (sum(dev_confidences) / len(dev_confidences)) if dev_confidences else 0.3

    stability = await _stability_score(db, module_id)

    confidence = team_risk * 0.5 + data_conf * 0.3 + stability * 0.2
    confidence = round(max(0.0, min(1.0, confidence)), 3)

    return confidence, {
        "signal_strength": round(team_risk, 3),
        "data_confidence": round(data_conf, 3),
        "stability": round(stability, 3),
    }


# ========== COOLDOWN / IDEMPOTENCY ==========

async def _is_in_cooldown(db, module_id: str) -> bool:
    cutoff = (_now() - timedelta(minutes=MODULE_COOLDOWN_MINUTES)).isoformat()
    recent = await db.auto_actions.find_one(
        {
            "module_id": module_id,
            "status": "executed",
            "executed_at": {"$gte": cutoff},
        },
        {"_id": 0, "action_id": 1},
    )
    return recent is not None


async def _action_already_taken(db, module_id: str, action_type: str) -> bool:
    cutoff = (_now() - timedelta(hours=SAME_ACTION_COOLDOWN_HOURS)).isoformat()
    exists = await db.auto_actions.find_one(
        {
            "module_id": module_id,
            "type": action_type,
            "status": "executed",
            "executed_at": {"$gte": cutoff},
        },
        {"_id": 0, "action_id": 1},
    )
    return exists is not None


# ========== TRIGGER DETECTION ==========

async def _dev_load(db, dev_id: str) -> float:
    total = 0.0
    async for a in db.module_assignments.find(
        {"developer_id": dev_id, "status": "active"}, {"_id": 0, "allocation": 1}
    ):
        total += float(a.get("allocation", 0))
    return round(total, 3)


async def detect_rebalance(
    db, module_id: str, assignments: list[dict]
) -> Optional[dict]:
    """Returns payload with {from_dev, to_dev, task_id} or None."""
    if len(assignments) < 2:
        return None

    # Compute each member's global load
    loads = {}
    for a in assignments:
        loads[a["developer_id"]] = await _dev_load(db, a["developer_id"])

    max_dev = max(loads, key=lambda k: loads[k])
    min_dev = min(loads, key=lambda k: loads[k])

    if loads[max_dev] <= REBALANCE_MAX_LOAD or loads[min_dev] >= REBALANCE_MIN_LOAD:
        return None

    if max_dev == min_dev:
        return None

    # Must have ≥2 in_progress tasks in module
    in_progress = await db.work_units.count_documents(
        {"module_id": module_id, "status": "in_progress"}
    )
    if in_progress < REBALANCE_MIN_TASKS:
        return None

    # Find 1 PENDING (not in_progress) task currently assigned to max_dev
    moveable = await db.work_units.find_one(
        {
            "module_id": module_id,
            "assigned_to": max_dev,
            "status": {"$in": ["assigned", "pending"]},
        },
        {"_id": 0, "unit_id": 1, "title": 1},
    )
    if not moveable:
        return None

    # Don't touch owner's tasks if max_dev IS owner — only move if max_dev is executor
    # (for safety)
    owner_assignment = next(
        (a for a in assignments if a["role"] == "owner"), None
    )
    if owner_assignment and owner_assignment["developer_id"] == max_dev:
        # try executor-level overload only; skip owner moves to be extra safe
        return None

    return {
        "from_dev": max_dev,
        "to_dev": min_dev,
        "task_id": moveable["unit_id"],
        "task_title": moveable.get("title", "task"),
        "from_load": loads[max_dev],
        "to_load": loads[min_dev],
    }


async def detect_add_support(
    db, module_id: str, team_score: dict, assignments: list[dict]
) -> Optional[dict]:
    """Returns payload {candidate_dev_id} or None."""
    # Trigger: silence_risk high OR velocity very low
    silence = float(team_score.get("silence_risk", 0))
    velocity = float(team_score.get("progress_velocity", 1.0))

    if silence < 0.4 and velocity >= 0.15:
        return None

    if len(assignments) >= MAX_TEAM_SIZE:
        return None

    # Check current Σ allocation has room
    total_alloc = sum(float(a.get("allocation", 0)) for a in assignments)
    if total_alloc + SUPPORT_ALLOCATION > 1.0:
        return None

    existing_ids = {a["developer_id"] for a in assignments}

    # Find candidate: combined_score ≥ 60, load < 0.5, not on team
    candidates = []
    async for u in db.users.find(
        {
            "role": "developer",
            "user_id": {"$nin": list(existing_ids)},
        },
        {"_id": 0, "user_id": 1, "name": 1, "combined_score": 1},
    ):
        combined = float(u.get("combined_score") or 0)
        if combined < SUPPORT_MIN_COMBINED:
            continue
        load = await _dev_load(db, u["user_id"])
        if load >= SUPPORT_MAX_LOAD:
            continue
        candidates.append(
            {"user_id": u["user_id"], "name": u.get("name"),
             "combined": combined, "load": load}
        )

    if not candidates:
        return None
    # Pick highest combined, ties broken by lowest load
    candidates.sort(key=lambda c: (-c["combined"], c["load"]))
    pick = candidates[0]
    return {
        "candidate_dev_id": pick["user_id"],
        "candidate_name": pick["name"],
        "candidate_combined": pick["combined"],
        "candidate_load": pick["load"],
        "trigger_silence_risk": silence,
        "trigger_velocity": velocity,
    }


# ========== EXECUTION ==========

async def _execute_rebalance(db, payload: dict) -> dict:
    """Move task_id from from_dev to to_dev, record before state."""
    unit = await db.work_units.find_one(
        {"unit_id": payload["task_id"]}, {"_id": 0}
    )
    if not unit:
        raise RuntimeError(f"Task {payload['task_id']} disappeared")

    before = {
        "task_id": unit["unit_id"],
        "prev_assigned_to": unit.get("assigned_to"),
        "prev_status": unit.get("status"),
    }

    await db.work_units.update_one(
        {"unit_id": payload["task_id"]},
        {
            "$set": {
                "assigned_to": payload["to_dev"],
                "prev_assigned_to": payload["from_dev"],
                "reassigned_at": _now_iso(),
                "reassigned_by": "system_autonomy",
            }
        },
    )
    return before


async def _revert_rebalance(db, before: dict) -> None:
    await db.work_units.update_one(
        {"unit_id": before["task_id"]},
        {
            "$set": {
                "assigned_to": before["prev_assigned_to"],
                "status": before.get("prev_status", "pending"),
            },
            "$unset": {"prev_assigned_to": "", "reassigned_at": "",
                       "reassigned_by": ""},
        },
    )


async def _execute_add_support(
    db, module_id: str, payload: dict, assignments: list[dict]
) -> dict:
    """Add new executor; scale down others' responsibility proportionally."""
    new_assignment = {
        "assignment_id": f"tasn_{uuid.uuid4().hex[:12]}",
        "module_id": module_id,
        "developer_id": payload["candidate_dev_id"],
        "role": "executor",
        "allocation": SUPPORT_ALLOCATION,
        "responsibility": SUPPORT_RESPONSIBILITY,
        "status": "active",
        "joined_at": _now_iso(),
        "assigned_by": "system_autonomy",
    }
    before = {
        "added_assignment_id": new_assignment["assignment_id"],
        "prev_responsibilities": [
            {"assignment_id": a["assignment_id"],
             "responsibility": a["responsibility"]}
            for a in assignments
        ],
    }

    # Scale down existing responsibilities so total stays = 1.0
    # new dev takes SUPPORT_RESPONSIBILITY; scale existing by (1 - new) / old_total
    old_total = sum(float(a["responsibility"]) for a in assignments)
    if old_total > 0:
        target_existing = 1.0 - SUPPORT_RESPONSIBILITY
        factor = target_existing / old_total
        for a in assignments:
            new_r = round(float(a["responsibility"]) * factor, 3)
            await db.module_assignments.update_one(
                {"assignment_id": a["assignment_id"]},
                {"$set": {"responsibility": new_r}},
            )

    await db.module_assignments.insert_one(new_assignment)
    await db.modules.update_one(
        {"module_id": module_id},
        {
            "$set": {
                "team_size": len(assignments) + 1,
                "last_team_updated_at": _now_iso(),
            }
        },
    )
    return before


async def _revert_add_support(db, before: dict) -> None:
    # Remove added assignment, restore prior responsibilities
    await db.module_assignments.delete_one(
        {"assignment_id": before["added_assignment_id"]}
    )
    for p in before.get("prev_responsibilities") or []:
        await db.module_assignments.update_one(
            {"assignment_id": p["assignment_id"]},
            {"$set": {"responsibility": p["responsibility"]}},
        )


# ========== PUBLIC API ==========

async def evaluate_module(
    db, module_id: str, emit_event=None
) -> list[dict]:
    """
    Look at team_score for module, detect trigger, compute confidence,
    decide: auto-execute, store as recommendation, or ignore.
    Returns list of auto_action docs created (0, 1, or 2).
    """
    team_score = await db.team_scores.find_one(
        {"module_id": module_id}, {"_id": 0}
    )
    if not team_score:
        return []

    if await _is_in_cooldown(db, module_id):
        return []

    assignments = await db.module_assignments.find(
        {"module_id": module_id, "status": "active"}, {"_id": 0}
    ).to_list(20)
    if not assignments:
        return []

    confidence, conf_breakdown = await compute_confidence(db, team_score)

    actions = []

    # Try rebalance
    rb_payload = await detect_rebalance(db, module_id, assignments)
    if rb_payload and not await _action_already_taken(
        db, module_id, "auto_rebalance"
    ):
        actions.append(("auto_rebalance", rb_payload))

    # Try add_support
    sup_payload = await detect_add_support(
        db, module_id, team_score, assignments
    )
    if sup_payload and not await _action_already_taken(
        db, module_id, "auto_add_support"
    ):
        actions.append(("auto_add_support", sup_payload))

    created = []
    for action_type, payload in actions:
        doc = await _create_action(
            db, module_id, action_type, payload,
            confidence, conf_breakdown, team_score,
            emit_event=emit_event,
        )
        if doc:
            created.append(doc)
            # Only one action per module per cycle
            break

    return created


async def _create_action(
    db, module_id: str, action_type: str, payload: dict,
    confidence: float, conf_breakdown: dict, team_score: dict,
    emit_event=None,
) -> Optional[dict]:
    """Store auto_action; execute if confidence ≥ threshold and type is safe."""
    if confidence < RECOMMEND_THRESHOLD:
        return None

    doc = {
        "action_id": f"aa_{uuid.uuid4().hex[:12]}",
        "module_id": module_id,
        "module_title": team_score.get("module_title"),
        "type": action_type,
        "payload": payload,
        "confidence": confidence,
        "confidence_breakdown": conf_breakdown,
        "team_band_at_creation": team_score.get("team_band"),
        "team_efficiency": team_score.get("team_efficiency"),
        "team_risk": team_score.get("team_risk"),
        "status": "pending",
        "created_at": _now_iso(),
    }

    can_execute = (
        confidence >= EXECUTE_THRESHOLD
        and action_type in SAFE_ACTION_TYPES
    )

    if can_execute:
        try:
            if action_type == "auto_rebalance":
                before = await _execute_rebalance(db, payload)
            elif action_type == "auto_add_support":
                assignments = await db.module_assignments.find(
                    {"module_id": module_id, "status": "active"}, {"_id": 0}
                ).to_list(20)
                before = await _execute_add_support(
                    db, module_id, payload, assignments
                )
            else:
                return None
            doc["status"] = "executed"
            doc["executed_at"] = _now_iso()
            doc["executed_by"] = "system"
            doc["before_state"] = before
            doc["revert_available"] = True
        except Exception as e:
            doc["status"] = "failed"
            doc["failure_reason"] = str(e)

    await db.auto_actions.insert_one({**doc})

    if emit_event:
        ev_type = (
            "autonomy:action_executed" if doc["status"] == "executed"
            else "autonomy:action_recommended"
        )
        await emit_event(
            ev_type,
            {
                "action_id": doc["action_id"],
                "module_id": module_id,
                "type": action_type,
                "confidence": confidence,
                "status": doc["status"],
            },
        )

    return doc


async def revert_action(db, action_id: str, reverted_by: str, emit_event=None) -> dict:
    doc = await db.auto_actions.find_one({"action_id": action_id}, {"_id": 0})
    if not doc:
        raise ValueError("action not found")
    if doc.get("status") != "executed":
        raise ValueError(f"Only executed actions can be reverted (got {doc.get('status')})")
    if not doc.get("revert_available"):
        raise ValueError("revert not available for this action")

    before = doc.get("before_state") or {}
    if doc["type"] == "auto_rebalance":
        await _revert_rebalance(db, before)
    elif doc["type"] == "auto_add_support":
        await _revert_add_support(db, before)
    else:
        raise ValueError(f"unknown action type: {doc['type']}")

    await db.auto_actions.update_one(
        {"action_id": action_id},
        {
            "$set": {
                "status": "reverted",
                "reverted_at": _now_iso(),
                "reverted_by": reverted_by,
                "revert_available": False,
            }
        },
    )

    if emit_event:
        await emit_event(
            "autonomy:action_reverted",
            {"action_id": action_id, "module_id": doc["module_id"],
             "type": doc["type"]},
        )
    return {**doc, "status": "reverted", "reverted_at": _now_iso()}


async def list_actions(
    db, module_id: Optional[str] = None, limit: int = 50
) -> list[dict]:
    q = {"module_id": module_id} if module_id else {}
    rows = await db.auto_actions.find(q, {"_id": 0}).sort(
        "created_at", -1
    ).limit(limit).to_list(limit)
    # Enrich with dev names
    dev_ids = set()
    for r in rows:
        p = r.get("payload") or {}
        for k in ("from_dev", "to_dev", "candidate_dev_id"):
            if p.get(k):
                dev_ids.add(p[k])
    names = {}
    if dev_ids:
        async for u in db.users.find(
            {"user_id": {"$in": list(dev_ids)}},
            {"_id": 0, "user_id": 1, "name": 1},
        ):
            names[u["user_id"]] = u.get("name")
    for r in rows:
        p = r.get("payload") or {}
        r["enriched"] = {
            "from_dev_name": names.get(p.get("from_dev")),
            "to_dev_name": names.get(p.get("to_dev")),
            "candidate_name": names.get(p.get("candidate_dev_id"))
                              or p.get("candidate_name"),
        }
    return rows


async def scan_all_modules(db, emit_event=None) -> dict:
    """Scheduled scan: iterate every team_score and evaluate."""
    count_created = 0
    count_executed = 0
    module_ids = await db.team_scores.distinct("module_id")
    for mid in module_ids:
        try:
            created = await evaluate_module(db, mid, emit_event=emit_event)
            for c in created:
                count_created += 1
                if c.get("status") == "executed":
                    count_executed += 1
        except Exception:
            continue
    return {"evaluated": len(module_ids), "created": count_created,
            "executed": count_executed, "at": _now_iso()}


async def snapshot_team_score(db, team_score: dict) -> None:
    """Store snapshot for stability computation (Block 5.1)."""
    await db.team_score_history.insert_one({
        "module_id": team_score["module_id"],
        "team_risk": team_score.get("team_risk", 0),
        "team_efficiency": team_score.get("team_efficiency", 0),
        "team_band": team_score.get("team_band"),
        "updated_at": _now_iso(),
    })
    # Keep only last 10 snapshots per module
    old = await db.team_score_history.find(
        {"module_id": team_score["module_id"]},
        {"_id": 1},
    ).sort("updated_at", -1).skip(10).to_list(100)
    if old:
        await db.team_score_history.delete_many(
            {"_id": {"$in": [o["_id"] for o in old]}}
        )


async def ensure_indexes(db):
    await db.auto_actions.create_index("action_id", unique=True)
    await db.auto_actions.create_index([("module_id", 1), ("created_at", -1)])
    await db.auto_actions.create_index("status")
    await db.team_score_history.create_index(
        [("module_id", 1), ("updated_at", -1)]
    )
