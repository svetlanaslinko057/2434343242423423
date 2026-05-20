"""
Execution Intelligence — Read-only Surface (Stage P1, R1)
==========================================================

Surfaces the cognition that already happens inside EVA-X autonomous loops
(auto_guardian, module_motion, operator_engine, assignment_engine,
acceptance_layer, event_engine, team_balancer, intelligence_layer).

Nothing here CREATES decisions. Everything READS from artefacts those
loops already wrote:
  • db.system_actions_log    — every system action with mode/status/result
  • db.system_actions        — pending / awaiting_manual / blocked actions
  • db.modules               — assignment/QA/revision state
  • db.bids                  — current bidding velocity
  • db.events                — detection scan output (stuck/idle/overload)
  • db.notifications         — outcome-side signals
  • db.users                 — developer load + rating

Endpoints (all admin-only, all GET):

    GET /api/execution-intelligence/live-flow
    GET /api/execution-intelligence/why
    GET /api/execution-intelligence/conviction
    GET /api/execution-intelligence/memory

Honest empty states: when a signal has no data we return
`status: "forming"` with a clear reason — never fake data.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from collections import Counter
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Path


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ago(minutes: int) -> str:
    return (_now() - timedelta(minutes=minutes)).isoformat()


def _ago_hours(hours: int) -> str:
    return (_now() - timedelta(hours=hours)).isoformat()


# ─────────────────────────────────────────────────────────────────────────
# P3.1 Causation Propagation Minimum — institutional cause-effect chains
# ─────────────────────────────────────────────────────────────────────────
#
# A causation_id is a single string token that links cognition events
# belonging to the same institutional cause-effect chain. It is propagated
# ONLY into newly-written records — there is no historical backfill, by
# design. Existing records with `causation_id: null` stay that way; their
# chain is simply "forming" at read time, which is the honest answer.
#
# Chains are keyed by `entity_id` (currently module_id). When a phase
# writes a record for entity_id X and an OPEN chain already exists for X,
# that chain's id is reused. If no chain exists, a new one is opened with
# the supplied `root_type`. This means phase ordering does not need to be
# enforced — the FIRST phase to fire opens the chain, every subsequent
# phase for the same entity joins it.
#
# Hard rules:
#   • No prose generation — `interpretation` is rule-based and short.
#   • No global causation map. No force graph. No websocket.
#   • No retroactive backfill. Old data stays null.
#   • Status `forming` is the correct answer when chain has <2 phases.
async def ensure_causation_id(
    db,
    *,
    entity_id: str,
    root_type: str,
    source: Optional[str] = None,
) -> Optional[str]:
    """Idempotent: returns the open causation_id for `entity_id`, opening
    a new chain with `root_type` if none exists. Returns None when the
    arguments are unusable (no entity_id) — callers must skip propagation
    cleanly in that case rather than crash.
    """
    if not entity_id:
        return None
    try:
        existing = await db.causation_chains.find_one(
            {"entity_id": entity_id, "status": {"$ne": "closed"}},
            {"_id": 0, "causation_id": 1},
        )
        if existing:
            await db.causation_chains.update_one(
                {"causation_id": existing["causation_id"]},
                {"$set": {"last_event_at": _now().isoformat()}},
            )
            return existing["causation_id"]
        cid = f"cause_{uuid.uuid4().hex[:12]}"
        await db.causation_chains.insert_one({
            "causation_id":  cid,
            "entity_id":     entity_id,
            "entity_type":   "module",   # P3.1 scope — module-level only
            "root_type":     root_type,
            "source":        source,
            "status":        "forming",
            "participants":  [],         # P3.2 — multi-entity participants
            "created_at":    _now().isoformat(),
            "last_event_at": _now().isoformat(),
        })
        return cid
    except Exception:
        # Propagation is best-effort. If the causation collection is
        # unavailable, write paths must NOT fail — they just skip the id.
        return None


# ─────────────────────────────────────────────────────────────────────────
# P3.2 Multi-Entity Causation — trace augmentation, NOT system modeling.
#
# A chain can attach `participants` — organizational entities that share
# the same institutional cause-effect chain. Rules baked in:
#
#   • EXPLICIT propagation edges only. If the relationship cannot be
#     explained in one sentence, it must not be added.
#   • Allowed edge types in P3.2:
#       - module's project           → role: origin_pressure_source
#       - module's assignee          → role: assigned_developer
#       - module's skill cluster     → role: shared_skill_cluster
#       - override operator          → role: operator
#       - reassign_task displacement → role: displaced_assignee
#                                    → role: reassignment_recipient
#   • NO inference. NO recursive propagation. NO probabilistic edges.
#     NO cross-chain merging. NO "AI influence map".
#   • Participants are deduped by (type, id, role) at write time.
#   • Labels resolved at read time (one small batched query) so
#     organizational renames stay current.
async def add_participants(
    db,
    causation_id: Optional[str],
    new_participants: List[Dict[str, Any]],
) -> None:
    """Append participants to the chain, deduping by (type, id, role).
    Best-effort: failures never block primary writes."""
    if not causation_id or not new_participants:
        return
    try:
        chain = await db.causation_chains.find_one(
            {"causation_id": causation_id},
            {"_id": 0, "participants": 1},
        )
        if not chain:
            return
        existing = chain.get("participants") or []
        seen = {(p.get("type"), p.get("id"), p.get("role")) for p in existing}
        to_add = []
        for p in new_participants:
            key = (p.get("type"), p.get("id"), p.get("role"))
            if not p.get("type") or not p.get("id") or not p.get("role"):
                continue
            if key in seen:
                continue
            seen.add(key)
            to_add.append({
                "type": p["type"], "id": p["id"], "role": p["role"],
                "added_at": _now().isoformat(),
            })
        if to_add:
            await db.causation_chains.update_one(
                {"causation_id": causation_id},
                {"$push": {"participants": {"$each": to_add}},
                 "$set":  {"last_event_at": _now().isoformat()}},
            )
    except Exception:
        return


async def _module_participants(db, module_id: str) -> List[Dict[str, Any]]:
    """Resolve the explicit organizational participants for a module.
    Only the edges listed in the P3.2 guardrails — nothing inferred."""
    if not module_id:
        return []
    mod = await db.modules.find_one(
        {"module_id": module_id},
        {"_id": 0, "project_id": 1, "assigned_to": 1,
         "stack": 1, "required_skills": 1},
    )
    if not mod:
        return []
    out: List[Dict[str, Any]] = []
    if mod.get("project_id"):
        out.append({"type": "project", "id": mod["project_id"],
                    "role": "origin_pressure_source"})
    if mod.get("assigned_to"):
        out.append({"type": "developer", "id": mod["assigned_to"],
                    "role": "assigned_developer"})
    # Skill cluster — the module's primary stack identifier. P3.2 stays
    # simple: one cluster per module if the field is set, otherwise none.
    stack = mod.get("stack")
    if isinstance(stack, str) and stack.strip():
        out.append({"type": "skill_stack", "id": stack.strip(),
                    "role": "shared_skill_cluster"})
    elif isinstance(stack, list) and stack:
        first = next((s for s in stack if isinstance(s, str) and s.strip()),
                     None)
        if first:
            out.append({"type": "skill_stack", "id": first,
                        "role": "shared_skill_cluster"})
    return out


async def _resolve_participant_labels(
    db, participants: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """One batched lookup to attach human-readable labels at read time.
    Renames stay current because we don't snapshot labels at write time.
    """
    if not participants:
        return []
    ids_by_type: Dict[str, List[str]] = {}
    for p in participants:
        ids_by_type.setdefault(p["type"], []).append(p["id"])

    label_map: Dict[tuple, str] = {}
    if "project" in ids_by_type:
        rows = await db.projects.find(
            {"project_id": {"$in": ids_by_type["project"]}},
            {"_id": 0, "project_id": 1, "name": 1, "title": 1},
        ).to_list(200)
        for r in rows:
            label_map[("project", r["project_id"])] = (
                r.get("name") or r.get("title") or r["project_id"]
            )
    if "developer" in ids_by_type:
        rows = await db.users.find(
            {"user_id": {"$in": ids_by_type["developer"]}},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1},
        ).to_list(200)
        for r in rows:
            label_map[("developer", r["user_id"])] = (
                r.get("name") or r.get("email") or r["user_id"]
            )
    # skill_stack ids are their own labels (no lookup needed)

    out = []
    for p in participants:
        out.append({
            **p,
            "label": label_map.get((p["type"], p["id"]), p["id"]),
        })
    return out


# ─────────────────────────────────────────────────────────────────────────
# Live Flow — what is the cognition doing RIGHT NOW
# ─────────────────────────────────────────────────────────────────────────
async def _live_flow(db) -> Dict[str, Any]:
    """Aggregate the *current* state of orchestration across modules + bids
    + actions + events. Each bucket is a real signal, not a static count."""
    # 1. Modules in flight, by phase
    pipeline = await db.modules.aggregate([
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]).to_list(50)
    by_status = {p["_id"]: p["count"] for p in pipeline if p.get("_id")}

    # 2. Active bids in last 60 min (orchestration velocity)
    recent_bids = await db.bids.count_documents({
        "created_at": {"$gte": _ago(60)},
    })

    # 3. Pending system actions (awaiting_manual / blocked)
    pending = await db.system_actions.count_documents({
        "status": {"$in": ["awaiting_manual", "blocked_requires_manual"]},
    })

    # 4. Recent SUPPRESSIONS (blocked or logged-only critical actions)
    suppressed_24h = await db.system_actions_log.count_documents({
        "status": {"$in": ["blocked_requires_manual", "logged_only"]},
        "created_at": {"$gte": _ago_hours(24)},
    })

    # 5. Recent EXECUTIONS (auto-acted by the system)
    executed_24h = await db.system_actions_log.count_documents({
        "status": "executed",
        "created_at": {"$gte": _ago_hours(24)},
    })

    # 6. Open events (project_idle, dev_overloaded, qa_backlog) — these
    #    are why the system is currently *concerned*.
    open_events = await db.events.count_documents({
        "status": {"$in": ["open", "acknowledged"]},
    }) if "events" in await db.list_collection_names() else 0

    # 7. Live signal stream — last 12 actions, newest first
    raw = await db.system_actions_log.find(
        {}, {"_id": 0, "log_id": 1, "action_type": 1, "entity_type": 1,
             "entity_id": 1, "mode": 1, "status": 1, "result": 1,
             "created_at": 1},
    ).sort("created_at", -1).limit(12).to_list(12)

    return {
        "pipeline": {
            "open":         by_status.get("open", 0) + by_status.get("open_for_bids", 0),
            "evaluating":   recent_bids,
            "in_progress":  by_status.get("in_progress", 0),
            "review":       by_status.get("submitted", 0) + by_status.get("review", 0),
            "completed":    by_status.get("completed", 0) + by_status.get("done", 0),
            "failed":       by_status.get("failed", 0),
        },
        "velocity_60m": {
            "new_bids": recent_bids,
        },
        "decisions_24h": {
            "executed":   executed_24h,
            "suppressed": suppressed_24h,
            "pending_human": pending,
        },
        "open_events": open_events,
        "stream": raw,
        "generated_at": _now().isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────
# Why — rationale layer for the most recent decisions
# ─────────────────────────────────────────────────────────────────────────
async def _why(db, limit: int = 8) -> Dict[str, Any]:
    """Reconstruct WHY for recent suppression and execution decisions.
    Pulls structured reasons from acceptance_layer decline reasons,
    event_engine event reasons, and system_actions_log results."""

    # 1. Recent SUPPRESSIONS — system declined to auto-execute
    suppressions = await db.system_actions_log.find(
        {"status": {"$in": ["blocked_requires_manual", "logged_only"]},
         "created_at": {"$gte": _ago_hours(72)}},
        {"_id": 0},
    ).sort("created_at", -1).limit(limit).to_list(limit)

    suppressed_rationale = []
    for s in suppressions:
        action_type = s.get("action_type", "unknown")
        # Reasons by action type
        reasons = []
        if action_type in ("delete_project", "force_delete_user", "cancel_invoice", "payment_release"):
            reasons.append("Critical action — capital preservation rule blocks auto-execute")
            reasons.append("Requires explicit human confirmation by policy")
        if s.get("status") == "logged_only":
            reasons.append("System mode = manual — system observes, does not act")
        if not reasons:
            reasons.append(s.get("error") or "Suppressed by orchestration policy")
        suppressed_rationale.append({
            "log_id": s.get("log_id"),
            "action": action_type,
            "entity": f"{s.get('entity_type', '?')}:{s.get('entity_id', '?')}",
            "decided_at": s.get("created_at"),
            "reasons": reasons,
            "verdict": "SUPPRESSED",
        })

    # 2. Recent EXECUTIONS — system DID act
    executed = await db.system_actions_log.find(
        {"status": "executed",
         "created_at": {"$gte": _ago_hours(72)}},
        {"_id": 0},
    ).sort("created_at", -1).limit(limit).to_list(limit)

    executed_rationale = []
    for e in executed:
        action_type = e.get("action_type", "unknown")
        reasons = []
        if action_type == "reassign_task":
            reasons.append("Original developer overloaded or unresponsive")
            reasons.append("Replacement matched on capacity + skill profile")
        elif action_type == "boost_priority":
            reasons.append("Deadline asymmetry detected by event engine")
        elif action_type == "force_review":
            reasons.append("Auto-promoted from in_progress when motion idle ≥ 24h")
        elif action_type == "redistribute_load":
            reasons.append("Developer overload threshold crossed (>30 active hours)")
            reasons.append("Available developers selected from low-load pool")
        elif action_type == "escalate_project":
            reasons.append("Auto-escalated by guardian — pattern of stalls detected")
        else:
            reasons.append(e.get("result") or "Auto-executed under autonomy mode")
        executed_rationale.append({
            "log_id": e.get("log_id"),
            "action": action_type,
            "entity": f"{e.get('entity_type', '?')}:{e.get('entity_id', '?')}",
            "decided_at": e.get("created_at"),
            "reasons": reasons,
            "verdict": "EXECUTED",
        })

    if not suppressed_rationale and not executed_rationale:
        return {
            "status": "forming",
            "reason": "No autonomous decisions in the last 72 hours. "
                      "System is in observe mode or seed data is too thin.",
            "suppressed": [],
            "executed": [],
            "generated_at": _now().isoformat(),
        }

    return {
        "status": "active",
        "suppressed": suppressed_rationale,
        "executed": executed_rationale,
        "generated_at": _now().isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────
# Conviction — dynamic confidence in the system's orchestration
# ─────────────────────────────────────────────────────────────────────────
async def _conviction(db) -> Dict[str, Any]:
    """Composite conviction score derived from real signals.
    NOT a static number — moves with QA pass rate, suppression ratio,
    overload levels, and revision clustering."""

    # Signal 1: QA pass rate (last 100 decisions)
    qa_recent = await db.qa_decisions.find({}, {"_id": 0, "result": 1}) \
        .sort("created_at", -1).limit(100).to_list(100)
    qa_total = len(qa_recent)
    qa_passed = sum(1 for q in qa_recent if q.get("result") == "passed")
    qa_pass_rate = (qa_passed / qa_total * 100) if qa_total else None

    # Signal 2: Suppression ratio — system protecting itself
    last_24h_actions = await db.system_actions_log.count_documents({
        "created_at": {"$gte": _ago_hours(24)},
    })
    last_24h_suppressed = await db.system_actions_log.count_documents({
        "status": {"$in": ["blocked_requires_manual", "logged_only"]},
        "created_at": {"$gte": _ago_hours(24)},
    })
    suppression_ratio = (last_24h_suppressed / last_24h_actions * 100) \
        if last_24h_actions else None

    # Signal 3: Overload pressure — how many devs are overloaded
    overloaded = await db.users.count_documents({
        "role": "developer", "active_load": {"$gt": 30},
    })
    total_devs = await db.users.count_documents({"role": "developer"})
    overload_ratio = (overloaded / total_devs * 100) if total_devs else 0

    # Signal 4: Revision pressure — modules looping in revision
    revision_loops = await db.modules.count_documents({
        "revision_count": {"$gte": 1},
    })
    total_modules = await db.modules.count_documents({})
    revision_pressure = (revision_loops / total_modules * 100) \
        if total_modules else 0

    # Composite conviction (0-100). Each signal weighted.
    components = []
    score = 50.0
    if qa_pass_rate is not None:
        contribution = (qa_pass_rate - 50) * 0.4   # ±20
        score += contribution
        components.append({"label": "QA pass rate", "value": round(qa_pass_rate, 1),
                           "delta": round(contribution, 1)})
    if suppression_ratio is not None:
        # Some suppression is GOOD (system protecting). Optimal ~10-30%.
        if 5 < suppression_ratio < 40:
            contribution = 10.0
        elif suppression_ratio >= 40:
            contribution = -8.0
        else:
            contribution = -3.0
        score += contribution
        components.append({"label": "Suppression discipline",
                           "value": round(suppression_ratio, 1),
                           "delta": round(contribution, 1)})
    overload_delta = -min(overload_ratio * 0.3, 15)
    score += overload_delta
    components.append({"label": "Overload pressure",
                       "value": round(overload_ratio, 1),
                       "delta": round(overload_delta, 1)})
    revision_delta = -min(revision_pressure * 0.2, 10)
    score += revision_delta
    components.append({"label": "Revision pressure",
                       "value": round(revision_pressure, 1),
                       "delta": round(revision_delta, 1)})

    score = max(0, min(100, round(score)))

    # Trend: compare to score from 24h ago by re-running on actions older
    # than 24h. Cheap heuristic — direction matters, not exact delta.
    older_actions = await db.system_actions_log.count_documents({
        "created_at": {"$gte": _ago_hours(48), "$lt": _ago_hours(24)},
    })
    if last_24h_actions > older_actions and qa_pass_rate and qa_pass_rate > 70:
        trend = "building"
        trend_arrow = "up"
    elif overload_ratio > 50 or (revision_pressure or 0) > 40:
        trend = "collapsing"
        trend_arrow = "down"
    else:
        trend = "stable"
        trend_arrow = "flat"

    # ── Band — qualitative framing (no fake quant precision) ───────────
    # 0.0–0.25 → collapsing · 0.25–0.5 → weak · 0.5–0.7 → building · 0.7+ → strong
    if score < 25:
        band = "collapsing"
    elif score < 50:
        band = "weak"
    elif score < 70:
        band = "building"
    else:
        band = "strong"

    return {
        "score": score,
        "band": band,
        "trend": trend,
        "trend_arrow": trend_arrow,
        "components": components,
        "samples": {
            "qa_decisions_window": qa_total,
            "actions_24h": last_24h_actions,
            "developers": total_devs,
            "modules": total_modules,
        },
        "generated_at": _now().isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────
# Module-level WHY — structured drivers for ONE module's orchestration
# ─────────────────────────────────────────────────────────────────────────
async def _why_module(db, module_id: str) -> Dict[str, Any]:
    """Object-centered cognition for a specific module.

    Returns structured drivers (not prose), each shaped:
        {driver, label, value, impact, severity}

    impact:   numeric (-1..+1)  — signed contribution to assignment confidence
    severity: low | medium | high  — qualitative band, used by UI for color
    """
    module = await db.modules.find_one({"module_id": module_id}, {"_id": 0})
    if not module:
        return {
            "status": "not_found",
            "module_id": module_id,
            "drivers": [],
            "verdict": None,
            "generated_at": _now().isoformat(),
        }

    drivers: List[Dict[str, Any]] = []

    # ── Driver 1: assigned developer's overload risk ─────────────────────
    assignee_id = module.get("assigned_to") or module.get("developer_id")
    assignee = None
    if assignee_id:
        assignee = await db.users.find_one(
            {"$or": [{"user_id": assignee_id}, {"email": assignee_id}]},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1,
             "active_load": 1, "rating": 1, "level": 1, "skills": 1},
        )
    if assignee:
        load = float(assignee.get("active_load") or 0)
        if load > 35:
            drivers.append({"driver": "overload_risk", "label": "Developer overload",
                            "value": load, "impact": -0.34, "severity": "high"})
        elif load > 25:
            drivers.append({"driver": "overload_risk", "label": "Developer load elevated",
                            "value": load, "impact": -0.12, "severity": "medium"})
        else:
            drivers.append({"driver": "overload_risk", "label": "Developer capacity healthy",
                            "value": load, "impact": +0.08, "severity": "low"})

    # ── Driver 2: deadline asymmetry ────────────────────────────────────
    deadline = module.get("deadline") or module.get("target_completion_date")
    if deadline:
        try:
            dl = datetime.fromisoformat(str(deadline).replace("Z", "+00:00"))
            hours_left = (dl - _now()).total_seconds() / 3600
            est = float(module.get("estimated_hours") or module.get("hours") or 0)
            if est > 0 and hours_left < est * 1.2:
                drivers.append({"driver": "deadline_asymmetry",
                                "label": "Deadline tighter than effort estimate",
                                "value": round(hours_left, 1), "impact": -0.22,
                                "severity": "high" if hours_left < est else "medium"})
            elif hours_left < 24:
                drivers.append({"driver": "deadline_asymmetry",
                                "label": "Deadline within 24h",
                                "value": round(hours_left, 1), "impact": -0.18,
                                "severity": "high"})
        except Exception:
            pass

    # ── Driver 3: revision cluster ──────────────────────────────────────
    revision_count = int(module.get("revision_count") or 0)
    if revision_count >= 3:
        drivers.append({"driver": "revision_cluster", "label": "Revision loop detected",
                        "value": revision_count, "impact": -0.28, "severity": "high"})
    elif revision_count == 2:
        drivers.append({"driver": "revision_cluster", "label": "Two revisions on file",
                        "value": revision_count, "impact": -0.14, "severity": "medium"})

    # ── Driver 4: QA volatility (failure rate of similar modules) ───────
    project_id = module.get("project_id")
    if project_id:
        sibling_qa = await db.qa_decisions.find(
            {"project_id": project_id}, {"_id": 0, "result": 1},
        ).limit(20).to_list(20)
        if sibling_qa:
            failed = sum(1 for q in sibling_qa if q.get("result") in ("rejected", "failed"))
            failure_rate = failed / len(sibling_qa)
            if failure_rate > 0.3:
                drivers.append({"driver": "qa_volatility",
                                "label": "Project QA failure rate elevated",
                                "value": round(failure_rate * 100, 1),
                                "impact": -0.20, "severity": "high"})
            elif failure_rate > 0.15:
                drivers.append({"driver": "qa_volatility",
                                "label": "Project QA mixed signal",
                                "value": round(failure_rate * 100, 1),
                                "impact": -0.08, "severity": "medium"})

    # ── Driver 5: skill match (if we have required + assignee skills) ──
    required = [s.lower() for s in (module.get("required_skills") or
                                    module.get("stack") or [])]
    if assignee and required:
        dev_skills = {s.lower() for s in (assignee.get("skills") or [])}
        overlap = len(set(required) & dev_skills)
        ratio = overlap / max(len(required), 1)
        if ratio >= 0.7:
            drivers.append({"driver": "skill_match", "label": "Strong skill overlap",
                            "value": round(ratio * 100, 1), "impact": +0.20,
                            "severity": "low"})
        elif ratio >= 0.4:
            drivers.append({"driver": "skill_match", "label": "Partial skill overlap",
                            "value": round(ratio * 100, 1), "impact": +0.05,
                            "severity": "medium"})
        else:
            drivers.append({"driver": "skill_match", "label": "Weak skill overlap",
                            "value": round(ratio * 100, 1), "impact": -0.18,
                            "severity": "high"})

    # ── Driver 6: confidence collapse (assignee rating dropping) ────────
    if assignee:
        rating = float(assignee.get("rating") or 0)
        if rating and rating < 3.5:
            drivers.append({"driver": "confidence_collapse",
                            "label": "Assignee rating below threshold",
                            "value": rating, "impact": -0.16, "severity": "high"})

    # ── Verdict: ASSIGNED / SUPPRESSED / IN_FLIGHT / etc ────────────────
    status = module.get("status", "unknown")
    qa_status = module.get("qa_status")
    verdict = "ASSIGNED" if assignee_id else "OPEN"
    if status in ("on_hold", "blocked"):
        verdict = "SUPPRESSED"
    elif status in ("in_progress", "active"):
        verdict = "IN_FLIGHT"
    elif status in ("completed", "done", "approved"):
        verdict = "COMPLETED"
    elif qa_status == "rejected":
        verdict = "REJECTED"

    # ── Confidence aggregate (signed sum, clamped) → band ──────────────
    raw = sum(d.get("impact", 0) for d in drivers)
    score01 = max(0.0, min(1.0, 0.5 + raw))
    if score01 < 0.25:
        band = "collapsing"
    elif score01 < 0.5:
        band = "weak"
    elif score01 < 0.7:
        band = "building"
    else:
        band = "strong"

    return {
        "status": "active" if drivers else "forming",
        "module_id": module_id,
        "module_name": module.get("name") or module.get("title") or module_id,
        "module_status": status,
        "verdict": verdict,
        "assignee": (
            {"user_id": assignee.get("user_id"), "name": assignee.get("name"),
             "email": assignee.get("email"), "level": assignee.get("level"),
             "rating": assignee.get("rating"), "active_load": assignee.get("active_load")}
            if assignee else None
        ),
        "confidence_band": band,
        "drivers": drivers,
        "generated_at": _now().isoformat(),
    }


# Wrapper used by the route handler — pulls drivers, then lazily writes
# a `signal_collapse` cognition_event if the pattern matches. The pull
# return is unaffected; the side-effect populates the timeline.
async def _why_module_with_collapse_log(db, module_id: str) -> Dict[str, Any]:
    payload = await _why_module(db, module_id)
    try:
        await _detect_and_log_signal_collapse(
            db, module_id, payload.get("drivers") or [],
        )
    except Exception:
        pass
    return payload


# ─────────────────────────────────────────────────────────────────────────
# Parallel Universes — naive vs protected staffing for one module
# ─────────────────────────────────────────────────────────────────────────
async def _parallel_universes(db, module_id: str) -> Dict[str, Any]:
    """Compute two derived staffing paths from REAL assignment_engine signals.

    Universe A — naive: fastest available developer, no overload guard,
                        no QA-volatility filter, no revision-cluster check.
    Universe B — protected: same scoring, but with overload + QA + revision
                            penalties applied (the engine's real behaviour).
    """
    module = await db.modules.find_one({"module_id": module_id}, {"_id": 0})
    if not module:
        return {"status": "not_found", "module_id": module_id,
                "generated_at": _now().isoformat()}

    devs = await db.users.find(
        {"role": "developer"},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "skills": 1,
         "level": 1, "rating": 1, "active_load": 1, "completed_tasks": 1},
    ).to_list(200)

    if not devs:
        return {"status": "forming", "module_id": module_id,
                "reason": "No developers seeded yet — universes cannot be derived.",
                "generated_at": _now().isoformat()}

    required = [str(s).lower() for s in
                (module.get("required_skills") or module.get("stack") or [])]
    estimated_hours = float(module.get("estimated_hours") or module.get("hours") or 8)

    LEVEL_SCORE = {"junior": 0.5, "middle": 0.7, "senior": 0.9, "lead": 1.0, "elite": 1.0}

    def base_score(d: dict) -> tuple:
        skills = {str(s).lower() for s in (d.get("skills") or [])}
        skill_fit = (
            len(skills & set(required)) / max(len(required), 1) if required else 0.6
        )
        level_fit = LEVEL_SCORE.get(d.get("level") or "junior", 0.5)
        rating_fit = min(float(d.get("rating") or 0) / 5.0, 1.0)
        speed_fit = min(int(d.get("completed_tasks") or 0) / 50.0, 1.0)
        raw = (skill_fit * 0.40 + level_fit * 0.20 + rating_fit * 0.20 +
               speed_fit * 0.20)
        return raw, skill_fit, level_fit, rating_fit

    # ── Universe A — NAIVE: ignore load + QA volatility + revisions ────
    naive_ranked = []
    for d in devs:
        raw, s, l, r = base_score(d)
        naive_ranked.append((raw, s, l, r, d))
    naive_ranked.sort(key=lambda x: x[0], reverse=True)
    a_pick_score, a_skill, a_level, a_rating, a_pick = naive_ranked[0]
    a_eta = round(estimated_hours / max(a_level, 0.5), 1)

    # ── Universe B — PROTECTED: apply real engine penalties ────────────
    project_id = module.get("project_id")
    proj_qa_failure = 0.0
    if project_id:
        recent = await db.qa_decisions.find(
            {"project_id": project_id}, {"_id": 0, "result": 1},
        ).limit(20).to_list(20)
        if recent:
            proj_qa_failure = sum(
                1 for q in recent if q.get("result") in ("rejected", "failed")
            ) / len(recent)

    protected_ranked = []
    for d in devs:
        raw, s, l, r = base_score(d)
        load = float(d.get("active_load") or 0)
        # Overload penalty (assignment_engine LOAD_PENALTY logic, simplified)
        if load > 35:
            raw *= 0.5
        elif load > 25:
            raw *= 0.8
        # QA volatility penalty (project-wide)
        if proj_qa_failure > 0.3:
            raw *= 0.85
        # Junior dampener for risky modules
        if (d.get("level") or "junior") == "junior" and proj_qa_failure > 0.2:
            raw *= 0.9
        protected_ranked.append((raw, s, l, r, d))
    protected_ranked.sort(key=lambda x: x[0], reverse=True)
    b_pick_score, b_skill, b_level, b_rating, b_pick = protected_ranked[0]
    b_eta = round(estimated_hours / max(b_level, 0.5) * 1.15, 1)  # +15% safety margin

    # ── Risk labels ────────────────────────────────────────────────────
    a_load = float(a_pick.get("active_load") or 0)
    a_risks = []
    if a_load > 35:
        a_risks.append("overload — assignee already at >35h active load")
    if proj_qa_failure > 0.3:
        a_risks.append("project QA failure rate >30% — naive pick ignores this")
    if (a_pick.get("level") or "junior") == "junior" and proj_qa_failure > 0.2:
        a_risks.append("junior on volatile project — revision cluster likely")
    if not a_risks:
        a_risks.append("no protective filters applied — short-term throughput only")

    b_protections = []
    if a_pick.get("user_id") != b_pick.get("user_id"):
        b_protections.append("alternative developer selected to preserve deadline")
    if a_load > 25 and float(b_pick.get("active_load") or 0) <= 25:
        b_protections.append("overloaded developer skipped")
    if proj_qa_failure > 0.3:
        b_protections.append("QA-volatility penalty applied to all candidates")
    if not b_protections:
        b_protections.append("naive pick already passes protective gates")

    risk_label = "HIGH" if a_risks and len(a_risks) >= 2 else (
        "MEDIUM" if a_risks else "LOW"
    )

    return {
        "status": "active",
        "module_id": module_id,
        "module_name": module.get("name") or module.get("title") or module_id,
        "estimated_hours": estimated_hours,
        "universe_a": {
            "label": "Naive",
            "summary": "Best raw candidate — no load / QA / revision guards",
            "pick": {
                "user_id": a_pick.get("user_id"), "name": a_pick.get("name"),
                "level": a_pick.get("level"), "rating": a_pick.get("rating"),
                "active_load": a_pick.get("active_load"),
            },
            "estimated_completion_hours": a_eta,
            "risk": risk_label,
            "risks": a_risks,
            "raw_score": round(a_pick_score, 3),
        },
        "universe_b": {
            "label": "Protected",
            "summary": "Engine pick — overload, QA volatility & revision penalties applied",
            "pick": {
                "user_id": b_pick.get("user_id"), "name": b_pick.get("name"),
                "level": b_pick.get("level"), "rating": b_pick.get("rating"),
                "active_load": b_pick.get("active_load"),
            },
            "estimated_completion_hours": b_eta,
            "protections": b_protections,
            "raw_score": round(b_pick_score, 3),
        },
        "diverged": a_pick.get("user_id") != b_pick.get("user_id"),
        "generated_at": _now().isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────
# Suppressions feed — what AI intentionally refused to do (the moat)
# ─────────────────────────────────────────────────────────────────────────
async def _suppressions(db, limit: int = 20) -> Dict[str, Any]:
    """Recent suppressed decisions, with structured driver breakdown."""
    raw = await db.system_actions_log.find(
        {"status": {"$in": ["blocked_requires_manual", "logged_only"]},
         "created_at": {"$gte": _ago_hours(72)}},
        {"_id": 0},
    ).sort("created_at", -1).limit(limit).to_list(limit)

    items: List[Dict[str, Any]] = []
    for s in raw:
        action = s.get("action_type", "unknown")
        drivers: List[Dict[str, Any]] = []
        if action in ("delete_project", "force_delete_user", "cancel_invoice",
                      "payment_release"):
            drivers.append({"driver": "capital_preservation",
                            "label": "Critical irreversible action",
                            "severity": "high"})
        if s.get("status") == "logged_only":
            drivers.append({"driver": "manual_mode",
                            "label": "System in observe mode",
                            "severity": "medium"})
        if action in ("reassign_task", "redistribute_load"):
            drivers.append({"driver": "overload_risk",
                            "label": "Overload threshold guard",
                            "severity": "high"})
        if action in ("force_review", "escalate_project"):
            drivers.append({"driver": "qa_volatility",
                            "label": "Quality stability protection",
                            "severity": "medium"})
        if not drivers:
            drivers.append({"driver": "policy",
                            "label": s.get("error") or "Policy guard",
                            "severity": "low"})
        items.append({
            "log_id": s.get("log_id"),
            "action": action,
            "entity": f"{s.get('entity_type', '?')}:{s.get('entity_id', '?')}",
            "decided_at": s.get("created_at"),
            "drivers": drivers,
            "verdict": "SUPPRESSED",
        })

    if not items:
        return {"status": "forming",
                "reason": "No suppressed decisions in the last 72 hours.",
                "items": [],
                "generated_at": _now().isoformat()}

    return {"status": "active",
            "count": len(items),
            "items": items,
            "generated_at": _now().isoformat()}


# ─────────────────────────────────────────────────────────────────────────
# Memory — last decisions and their realised outcomes
# ─────────────────────────────────────────────────────────────────────────
async def _memory(db, limit: int = 12) -> Dict[str, Any]:
    """Past decisions traced to their real outcomes — accountability layer."""

    actions = await db.system_actions_log.find(
        {"status": {"$in": ["executed", "blocked_requires_manual",
                            "logged_only", "failed"]},
         "created_at": {"$gte": _ago_hours(168)}},  # 7 days
        {"_id": 0},
    ).sort("created_at", -1).limit(limit).to_list(limit)

    if not actions:
        return {
            "status": "forming",
            "reason": "No autonomous decision history yet (last 7 days).",
            "decisions": [],
            "generated_at": _now().isoformat(),
        }

    # For each, attempt to match an outcome notification or status change
    decisions = []
    for a in actions:
        entity_id = a.get("entity_id")
        outcome = "—"
        outcome_detail = None
        if a.get("status") == "executed":
            # Did the entity reach a terminal state since the decision?
            if a.get("entity_type") == "module" and entity_id:
                m = await db.modules.find_one({"module_id": entity_id},
                                              {"_id": 0, "status": 1, "qa_status": 1})
                if m:
                    if m.get("status") in ("done", "completed", "approved"):
                        outcome = "completed"
                        outcome_detail = f"qa_status={m.get('qa_status')}"
                    elif m.get("status") == "failed":
                        outcome = "failed"
                    else:
                        outcome = "in_flight"
                        outcome_detail = f"status={m.get('status')}"
            else:
                outcome = "executed"
        elif a.get("status") == "blocked_requires_manual":
            outcome = "suppressed"
            outcome_detail = "Awaited human; capital preservation"
        elif a.get("status") == "logged_only":
            outcome = "observed"
            outcome_detail = "Manual mode — no action taken"
        elif a.get("status") == "failed":
            outcome = "failed"
            outcome_detail = a.get("error", "")[:120]

        decisions.append({
            "log_id": a.get("log_id"),
            "action": a.get("action_type"),
            "entity": f"{a.get('entity_type', '?')}:{entity_id or '?'}",
            "decided_at": a.get("created_at"),
            "mode": a.get("mode"),
            "outcome": outcome,
            "outcome_detail": outcome_detail,
        })

    # Aggregate counters for the header
    counter = Counter(d["outcome"] for d in decisions)

    return {
        "status": "active",
        "summary": dict(counter),
        "decisions": decisions,
        "generated_at": _now().isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────
# Cognition Continuity (Stage P2.1) — temporal timeline for one module
# ─────────────────────────────────────────────────────────────────────────
#
# Hybrid derive + thin cognition_events writer.
#
# Derived from existing collections:
#   • db.modules         — created_at, status, qa_status, revision_count
#   • db.assignments     — assignment lifecycle
#   • db.qa_decisions    — review verdicts
#   • db.system_actions_log — suppressions, reassigns, escalations, executions
# Persisted thin layer:
#   • db.cognition_events — only `signal_collapse` events (the one phase
#                           that has no natural trigger in existing loops)
#
# Phase canonical set (ordered):
#   created → evaluating → assigned → in_flight → qa_review →
#   qa_passed | qa_rejected → revision (loops back) → signal_collapse →
#   suppressed → reassigned → escalated → completed | failed | rejected
#
# Empty state honesty: if module has no detectable phase transitions,
# return status="forming" — never invent events.
#
# Phase config drives ordering, colour, and band assignment in the UI.
PHASE_ORDER = [
    "created", "evaluating", "assigned", "in_flight",
    "qa_review", "qa_passed", "qa_rejected", "revision",
    "signal_collapse", "suppressed", "reassigned", "escalated",
    "completed", "failed", "rejected",
]
PHASE_BAND = {
    "created":         "building",
    "evaluating":      "building",
    "assigned":        "building",
    "in_flight":       "building",
    "qa_review":       "building",
    "qa_passed":       "strong",
    "qa_rejected":     "weak",
    "revision":        "weak",
    "signal_collapse": "collapsing",
    "suppressed":      "collapsing",
    "reassigned":      "weak",
    "escalated":       "collapsing",
    "completed":       "strong",
    "failed":          "collapsing",
    "rejected":        "collapsing",
}


def _band_for_phase(phase: str) -> str:
    return PHASE_BAND.get(phase, "forming")


def _ts(doc: dict, *keys: str) -> Optional[str]:
    """Pick the first present timestamp field from a doc."""
    for k in keys:
        v = doc.get(k)
        if v:
            return str(v)
    return None


async def _detect_and_log_signal_collapse(
    db, module_id: str, drivers: List[Dict[str, Any]],
) -> Optional[dict]:
    """Lazy thin writer: when ≥2 high-severity negative drivers are present
    and no collapse event was logged for this module in the last 60 minutes,
    write a single `signal_collapse` cognition_event. Idempotent by design —
    avoids spam by checking last-event timestamp.

    Returns the written event (or None if nothing was written).
    """
    high_neg = [
        d for d in drivers
        if d.get("severity") == "high" and (d.get("impact", 0) < 0)
    ]
    if len(high_neg) < 2:
        return None

    last = await db.cognition_events.find_one(
        {"module_id": module_id, "phase": "signal_collapse"},
        sort=[("created_at", -1)],
    )
    if last:
        try:
            last_at = datetime.fromisoformat(
                str(last["created_at"]).replace("Z", "+00:00")
            )
            if (_now() - last_at) < timedelta(minutes=60):
                return None
        except Exception:
            pass

    # Trigger label: pick the strongest negative driver as the proximate cause
    high_neg.sort(key=lambda d: d.get("impact", 0))
    trigger = high_neg[0].get("driver", "negative_driver_cluster")

    # P3.1 — open or join the institutional cause-effect chain for this
    # module. signal_collapse is a valid chain root_type. Best-effort:
    # if causation collection is unavailable we still write the event.
    causation_id = await ensure_causation_id(
        db, entity_id=module_id, root_type="signal_collapse",
        source="cognition.signal_collapse",
    )
    # P3.2 — attach the explicit organizational participants (project,
    # assigned developer, skill stack) at chain-open. Each edge is a
    # one-sentence relationship — no inference, no probabilities.
    if causation_id:
        await add_participants(
            db, causation_id, await _module_participants(db, module_id)
        )
    event = {
        "event_id": f"cev_{uuid.uuid4().hex[:12]}",
        "phase": "signal_collapse",
        "module_id": module_id,
        "trigger": trigger,
        "drivers": high_neg,
        "confidence": "collapsing",
        "source": "cognition_event",
        "causation_id": causation_id,
        "created_at": _now().isoformat(),
    }
    await db.cognition_events.insert_one(event)
    event.pop("_id", None)
    return event


async def _timeline(db, module_id: str) -> Dict[str, Any]:
    """Reconstruct a module's reasoning evolution from existing collections
    plus the thin `cognition_events` collection.

    Output:
        {
          status: "active" | "forming" | "not_found",
          module_id, module_name,
          current_phase: <last phase in timeline>,
          timeline: [{phase, at, drivers, confidence, source, trigger?, ref?}, ...]
        }
    """
    module = await db.modules.find_one({"module_id": module_id}, {"_id": 0})
    if not module:
        return {
            "status": "not_found", "module_id": module_id,
            "timeline": [], "generated_at": _now().isoformat(),
        }

    events: List[Dict[str, Any]] = []

    # 1) created
    created = _ts(module, "created_at", "createdAt")
    if created:
        events.append({
            "phase": "created", "at": created,
            "confidence": _band_for_phase("created"),
            "source": "derived", "drivers": [],
        })

    # 2) evaluating — heuristic: when first system action references it
    #    (assignment_engine started looking at it) OR module had open_for_bids
    #    status historically. Cheap proxy: created_at + epsilon if status
    #    progressed beyond "created"/"open".
    if module.get("status") not in ("created", "open"):
        eval_at = created  # close enough; refined when we have status_history
        if eval_at:
            events.append({
                "phase": "evaluating", "at": eval_at,
                "confidence": _band_for_phase("evaluating"),
                "source": "derived", "drivers": [],
            })

    # 3) assignments — assigned + reassignments
    assignments = await db.assignments.find(
        {"module_id": module_id}, {"_id": 0},
    ).sort("created_at", 1).to_list(50) if "assignments" in await db.list_collection_names() else []
    # Also look for assignments by unit_id == module_id (legacy field)
    if not assignments:
        assignments = await db.assignments.find(
            {"unit_id": module_id}, {"_id": 0},
        ).sort("created_at", 1).to_list(50) if "assignments" in await db.list_collection_names() else []

    for i, a in enumerate(assignments):
        at = _ts(a, "created_at")
        if not at:
            continue
        events.append({
            "phase": "reassigned" if i > 0 else "assigned",
            "at": at,
            "confidence": _band_for_phase("reassigned" if i > 0 else "assigned"),
            "source": "derived", "drivers": [],
            "ref": {"assignment_id": a.get("assignment_id"),
                    "developer_id": a.get("developer_id")},
        })

    # Fallback: if no assignments collection but module.assigned_to exists,
    # treat its presence as one assignment event timestamped at module.created_at.
    if not assignments and (module.get("assigned_to") or module.get("developer_id")):
        if created:
            events.append({
                "phase": "assigned", "at": created,
                "confidence": _band_for_phase("assigned"),
                "source": "derived", "drivers": [],
                "ref": {"developer_id": module.get("assigned_to") or module.get("developer_id")},
            })

    # 4) in_flight — when status moved into in_progress/active
    if module.get("status") in ("in_progress", "active", "completed",
                                "done", "approved", "submitted", "review"):
        # Best estimate: started_at if present, else created_at
        at = _ts(module, "started_at", "in_progress_at", "created_at")
        if at:
            events.append({
                "phase": "in_flight", "at": at,
                "confidence": _band_for_phase("in_flight"),
                "source": "derived", "drivers": [],
            })

    # 5) qa_review + qa_passed/qa_rejected — from qa_decisions
    qas = await db.qa_decisions.find(
        {"module_id": module_id}, {"_id": 0},
    ).sort("created_at", 1).to_list(50)
    for q in qas:
        at = _ts(q, "created_at")
        if not at:
            continue
        events.append({
            "phase": "qa_review", "at": at,
            "confidence": _band_for_phase("qa_review"),
            "source": "derived", "drivers": [],
            "ref": {"qa_id": q.get("qa_id")},
        })
        result = (q.get("result") or "").lower()
        if result in ("passed", "approved"):
            events.append({
                "phase": "qa_passed", "at": at,
                "confidence": _band_for_phase("qa_passed"),
                "source": "derived", "drivers": [],
                "ref": {"qa_id": q.get("qa_id")},
            })
        elif result in ("rejected", "failed"):
            events.append({
                "phase": "qa_rejected", "at": at,
                "confidence": _band_for_phase("qa_rejected"),
                "source": "derived", "drivers": [],
                "ref": {"qa_id": q.get("qa_id")},
            })

    # 6) revision loops — count from module.revision_count, anchored at last QA
    rev_count = int(module.get("revision_count") or 0)
    if rev_count > 0 and qas:
        last_qa_at = _ts(qas[-1], "created_at")
        for r in range(rev_count):
            events.append({
                "phase": "revision",
                "at": last_qa_at,  # best proxy when no per-revision timestamp
                "confidence": _band_for_phase("revision"),
                "source": "derived", "drivers": [],
                "ref": {"revision_index": r + 1},
            })

    # 7) suppressions / escalations / explicit actions from system_actions_log
    actions = await db.system_actions_log.find(
        {"$or": [
            {"entity_type": "module", "entity_id": module_id},
            {"entity_type": "project", "entity_id": module.get("project_id")},
        ]},
        {"_id": 0},
    ).sort("created_at", 1).to_list(100)
    for a in actions:
        at = _ts(a, "created_at")
        if not at:
            continue
        status = (a.get("status") or "").lower()
        action_type = a.get("action_type") or ""
        phase = None
        if status in ("blocked_requires_manual", "logged_only"):
            phase = "suppressed"
        elif action_type == "reassign_task":
            phase = "reassigned"
        elif action_type == "escalate_project":
            phase = "escalated"
        elif action_type == "force_review":
            phase = "qa_review"
        if not phase:
            continue
        events.append({
            "phase": phase, "at": at,
            "confidence": _band_for_phase(phase),
            "source": "derived", "drivers": [],
            "ref": {"log_id": a.get("log_id"), "action_type": action_type},
        })

    # 8) signal_collapse events from the thin cognition_events collection
    collapse_events = await db.cognition_events.find(
        {"module_id": module_id}, {"_id": 0},
    ).sort("created_at", 1).to_list(50) if (
        "cognition_events" in await db.list_collection_names()
    ) else []
    for ce in collapse_events:
        events.append({
            "phase": ce.get("phase", "signal_collapse"),
            "at": _ts(ce, "created_at"),
            "confidence": ce.get("confidence", "collapsing"),
            "source": "cognition_event",
            "trigger": ce.get("trigger"),
            "drivers": ce.get("drivers") or [],
        })

    # 9) terminal — completed/failed/rejected
    status = module.get("status") or ""
    qa_status = (module.get("qa_status") or "").lower()
    terminal_phase = None
    if status in ("completed", "done", "approved"):
        terminal_phase = "completed"
    elif status == "failed":
        terminal_phase = "failed"
    elif qa_status == "rejected":
        terminal_phase = "rejected"
    if terminal_phase:
        at = _ts(module, "completed_at", "done_at", "updated_at", "created_at")
        if at:
            events.append({
                "phase": terminal_phase, "at": at,
                "confidence": _band_for_phase(terminal_phase),
                "source": "derived", "drivers": [],
            })

    # Sort by timestamp, then by canonical phase order to break ties.
    def _sort_key(ev):
        try:
            ts = datetime.fromisoformat(str(ev.get("at")).replace("Z", "+00:00"))
        except Exception:
            ts = _now()
        order = PHASE_ORDER.index(ev["phase"]) if ev["phase"] in PHASE_ORDER else 99
        return (ts, order)
    events.sort(key=_sort_key)

    if not events:
        return {
            "status": "forming",
            "module_id": module_id,
            "module_name": module.get("name") or module.get("title") or module_id,
            "reason": "Insufficient phase signals — module has no recorded transitions yet.",
            "timeline": [],
            "generated_at": _now().isoformat(),
        }

    return {
        "status": "active",
        "module_id": module_id,
        "module_name": module.get("name") or module.get("title") or module_id,
        "current_phase": events[-1]["phase"],
        "timeline": events,
        "generated_at": _now().isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────
# Operator Override (Stage P2.2) — suppressions-only, mandatory reason,
# composite outcome via lazy delayed evaluator
# ─────────────────────────────────────────────────────────────────────────
#
# Override does NOT auto-execute the underlying suppressed action — it
# records the operator's intent + acknowledged risk. The composite outcome
# is observed on the target entity after the fact:
#   • verdict: "operator_was_correct" / "suppression_was_justified"
#              / "neutral" / "pending"
#   • signals: terminal status, revision delta, QA result, duration ratio
#
# Persisted in: db.cognition_overrides
# References:    db.system_actions / db.system_actions_log

OVERRIDE_REASON_MIN_LEN = 20


async def _override_create(
    db,
    action_id: str,
    operator: dict,
    reason: str,
    acknowledged_risk: bool,
) -> Dict[str, Any]:
    """Create an override record for a suppressed action.

    Validates the action exists and is currently suppressed
    (system_actions.status in {blocked_requires_manual, awaiting_manual}
    OR system_actions_log entry with that status referenced via log_id).
    """
    if not reason or len(reason.strip()) < OVERRIDE_REASON_MIN_LEN:
        raise HTTPException(
            status_code=422,
            detail=f"Reason required (min {OVERRIDE_REASON_MIN_LEN} chars)",
        )
    if not acknowledged_risk:
        raise HTTPException(status_code=422, detail="Risk acknowledgement required")

    # Try active system_actions first (preferred)
    target = await db.system_actions.find_one({"action_id": action_id}, {"_id": 0})
    target_kind = "system_action"
    if not target:
        # Fallback: a logged suppression from system_actions_log
        target = await db.system_actions_log.find_one(
            {"log_id": action_id}, {"_id": 0},
        )
        target_kind = "system_action_log"
    if not target:
        raise HTTPException(status_code=404, detail="Suppressed action not found")

    suppressed_statuses = {
        "blocked_requires_manual", "awaiting_manual",
        "awaiting_manual_execution", "logged_only",
    }
    if (target.get("status") or "") not in suppressed_statuses:
        raise HTTPException(
            status_code=409,
            detail=f"Action status '{target.get('status')}' is not suppressed",
        )

    # Snapshot current drivers for the target module (if action targets one),
    # so the audit trail captures what the system thought at override time.
    drivers_snapshot: List[Dict[str, Any]] = []
    if target.get("entity_type") == "module" and target.get("entity_id"):
        try:
            why = await _why_module(db, target["entity_id"])
            drivers_snapshot = why.get("drivers") or []
        except Exception:
            drivers_snapshot = []

    override_id = f"ovr_{uuid.uuid4().hex[:12]}"

    # P3.1 — join (or open) the institutional chain for this entity.
    # If a signal_collapse already opened a chain for this module, the
    # override slots into the same causation_id. If not, the override
    # itself becomes the chain root (root_type="operator_override").
    causation_id = await ensure_causation_id(
        db,
        entity_id=target.get("entity_id"),
        root_type="operator_override",
        source="cognition.override",
    )

    # P3.2 — explicit participants for this override:
    #   • the operator who acted (always)
    #   • the module's project + assigned developer + skill cluster
    #     (if the chain was just opened by this override and didn't
    #     inherit them from a prior signal_collapse)
    #   • reassign_task: prev assignee → displaced_assignee
    # All edges are one-sentence explanations — no inference, no
    # probabilistic links.
    if causation_id:
        prov: List[Dict[str, Any]] = []
        if (operator or {}).get("user_id"):
            prov.append({
                "type": "developer", "id": operator["user_id"],
                "role": "operator",
            })
        if target.get("entity_type") == "module" and target.get("entity_id"):
            prov.extend(await _module_participants(db, target["entity_id"]))
            if target.get("action_type") == "reassign_task":
                cur_mod = await db.modules.find_one(
                    {"module_id": target["entity_id"]},
                    {"_id": 0, "assigned_to": 1},
                )
                if cur_mod and cur_mod.get("assigned_to"):
                    prov.append({
                        "type": "developer", "id": cur_mod["assigned_to"],
                        "role": "displaced_assignee",
                    })
        await add_participants(db, causation_id, prov)

    doc = {
        "override_id": override_id,
        "action_id": action_id,
        "target_kind": target_kind,
        "target": {
            "action_type": target.get("action_type"),
            "entity_type": target.get("entity_type"),
            "entity_id":   target.get("entity_id"),
        },
        "operator": {
            "user_id": (operator or {}).get("user_id"),
            "email":   (operator or {}).get("email"),
            "name":    (operator or {}).get("name"),
        },
        "reason": reason.strip(),
        "acknowledged_risk": True,
        "drivers_at_override": drivers_snapshot,
        "outcome": {"verdict": "pending"},
        "outcome_evaluated_at": None,
        "causation_id": causation_id,
        "created_at": _now().isoformat(),
    }
    await db.cognition_overrides.insert_one(doc)
    doc.pop("_id", None)

    # Mark the original action as overridden so the suppressions feed
    # stops showing it as "active". The action record itself is preserved.
    if target_kind == "system_action":
        await db.system_actions.update_one(
            {"action_id": action_id},
            {"$set": {"status": "overridden_by_operator",
                      "override_id": override_id}},
        )
    # Always log to system_actions_log for audit continuity.
    # The log entry inherits the same causation_id so the chain stays
    # contiguous through the override side-effect.
    await db.system_actions_log.insert_one({
        "log_id": f"slog_{uuid.uuid4().hex[:12]}",
        "action_type": target.get("action_type"),
        "entity_type": target.get("entity_type"),
        "entity_id":   target.get("entity_id"),
        "mode": "operator_override",
        "status": "overridden_by_operator",
        "result": f"override_id={override_id}",
        "error": None,
        "causation_id": causation_id,
        "created_at": _now().isoformat(),
    })

    return doc


async def _override_outcome(db, override_id: str) -> Dict[str, Any]:
    """Lazy composite outcome evaluator.

    Fetches the override, inspects the current state of the target entity
    (module by default), and produces a composite verdict:

        operator_was_correct  — entity reached terminal success cleanly
        suppression_was_justified — entity failed / extra revisions / QA rejected
        neutral               — terminal but mixed signals
        pending               — entity still in flight (no terminal state)

    Persists the verdict on the override doc the first time it becomes
    terminal (so we don't recompute forever). Returns the freshest view.
    """
    ov = await db.cognition_overrides.find_one(
        {"override_id": override_id}, {"_id": 0},
    )
    if not ov:
        raise HTTPException(status_code=404, detail="Override not found")

    # Already evaluated and terminal — return as-is
    cached = ov.get("outcome") or {}
    if cached.get("verdict") and cached.get("verdict") != "pending":
        return ov

    target = ov.get("target") or {}
    if target.get("entity_type") != "module" or not target.get("entity_id"):
        # Non-module overrides not yet evaluable in P2 minimum
        return {**ov, "outcome": {"verdict": "pending",
                                  "reason": "Non-module overrides "
                                            "are not auto-evaluated in P2."}}

    module = await db.modules.find_one(
        {"module_id": target["entity_id"]}, {"_id": 0},
    )
    if not module:
        return {**ov, "outcome": {"verdict": "pending",
                                  "reason": "Target module not found."}}

    # Composite signals
    status = (module.get("status") or "").lower()
    qa_status = (module.get("qa_status") or "").lower()
    revision_count = int(module.get("revision_count") or 0)
    estimated = float(module.get("estimated_hours") or 0)
    actual = float(module.get("actual_hours") or 0)

    duration_ratio = (actual / estimated) if estimated else None

    # Re-collect QA history after override (post hoc)
    try:
        ovr_at = datetime.fromisoformat(
            str(ov.get("created_at")).replace("Z", "+00:00")
        )
    except Exception:
        ovr_at = _now() - timedelta(days=1)
    post_qa = await db.qa_decisions.find(
        {"module_id": target["entity_id"]}, {"_id": 0},
    ).sort("created_at", 1).to_list(50)
    post_qa = [q for q in post_qa
               if q.get("created_at") and
               datetime.fromisoformat(str(q["created_at"]).replace("Z", "+00:00")) >= ovr_at]
    post_qa_failed = sum(1 for q in post_qa
                         if (q.get("result") or "").lower() in ("rejected", "failed"))
    post_qa_passed = sum(1 for q in post_qa
                         if (q.get("result") or "").lower() in ("passed", "approved"))

    # Verdict logic
    is_terminal = status in ("completed", "done", "approved", "failed") or \
                  qa_status == "rejected"
    verdict = "pending"
    rationale: List[str] = []
    if is_terminal:
        clean_success = (
            status in ("completed", "done", "approved")
            and qa_status != "rejected"
            and post_qa_failed == 0
            and revision_count == 0
            and (duration_ratio is None or duration_ratio <= 1.2)
        )
        bad_outcome = (
            status == "failed"
            or qa_status == "rejected"
            or post_qa_failed > 0
            or revision_count >= 2
            or (duration_ratio is not None and duration_ratio > 1.5)
        )
        if clean_success:
            verdict = "operator_was_correct"
            rationale.append("Module completed without QA rejection or revisions.")
            if duration_ratio is not None:
                rationale.append(f"Delivered within {round(duration_ratio*100)}% of estimate.")
        elif bad_outcome:
            verdict = "suppression_was_justified"
            if status == "failed":
                rationale.append("Module ended in failed state.")
            if qa_status == "rejected":
                rationale.append("QA ultimately rejected the deliverable.")
            if post_qa_failed > 0:
                rationale.append(f"{post_qa_failed} QA failure(s) after override.")
            if revision_count >= 2:
                rationale.append(f"Required {revision_count} revisions.")
            if duration_ratio is not None and duration_ratio > 1.5:
                rationale.append(
                    f"Took {round(duration_ratio*100)}% of estimated duration."
                )
        else:
            verdict = "neutral"
            rationale.append("Module reached terminal state with mixed signals.")
    else:
        rationale.append("Target module is still in flight.")

    outcome = {
        "verdict": verdict,
        "rationale": rationale,
        "signals": {
            "terminal_status": status or None,
            "qa_status": qa_status or None,
            "revision_count": revision_count,
            "post_override_qa_passed": post_qa_passed,
            "post_override_qa_failed": post_qa_failed,
            "estimated_hours": estimated or None,
            "actual_hours": actual or None,
            "duration_ratio": (round(duration_ratio, 2)
                               if duration_ratio is not None else None),
        },
    }

    # Persist if terminal — so we don't recompute forever
    if is_terminal:
        await db.cognition_overrides.update_one(
            {"override_id": override_id},
            {"$set": {"outcome": outcome,
                      "outcome_evaluated_at": _now().isoformat()}},
        )
    return {**ov, "outcome": outcome,
            "outcome_evaluated_at": (_now().isoformat() if is_terminal else None)}


async def _override_list(db, limit: int = 20) -> Dict[str, Any]:
    """Recent overrides for the AI Memory panel attribution chain."""
    if "cognition_overrides" not in await db.list_collection_names():
        return {"status": "forming",
                "reason": "No overrides recorded yet.",
                "items": [],
                "generated_at": _now().isoformat()}
    raw = await db.cognition_overrides.find(
        {}, {"_id": 0},
    ).sort("created_at", -1).limit(limit).to_list(limit)
    if not raw:
        return {"status": "forming",
                "reason": "No overrides recorded yet.",
                "items": [],
                "generated_at": _now().isoformat()}
    # Refresh outcomes on read for those still pending
    items = []
    for ov in raw:
        if (ov.get("outcome") or {}).get("verdict") in (None, "pending"):
            try:
                ov = await _override_outcome(db, ov["override_id"])
            except Exception:
                pass
        items.append(ov)
    return {"status": "active", "count": len(items),
            "items": items, "generated_at": _now().isoformat()}


# ─────────────────────────────────────────────────────────────────────────
# Pattern Memory (Stage P2.3-lite) — cross-module organizational memory
# ─────────────────────────────────────────────────────────────────────────
#
# This is NOT analytics. NOT charts. NOT KPIs.
# It is institutional memory of recurring DECISION patterns:
#   • where AI keeps suppressing the same kind of action
#   • where QA keeps collapsing on the same project / skill cluster
#   • where revision loops keep reappearing
#   • where operators keep overriding the same suppression type
#   • where outcome attribution shows AI was right (or wrong) on a class of decisions
#
# Honesty rules baked into this layer:
#   1. Sort by DECISION PRESSURE, not by count. Contested patterns surface
#      first because that is where organizational cognition is unstable.
#   2. Attribution is shown as a BAND, not a percentage. The raw counts are
#      attached as secondary calibration data only.
#   3. Every pattern carries a temporal humility frame ("observed last 14d"
#      or "forming") — never reads like proven truth.
#   4. Drivers stay structured. NO prose summaries.
#   5. Threshold: ≥3 occurrences in window OR ≥1 with a resolved attribution.
#      Otherwise the pattern stays in `status: "forming"` and is not surfaced.
#
# Endpoint: GET /api/execution-intelligence/patterns
PATTERN_WINDOW_DAYS = 14
PATTERN_MIN_OCCURRENCES = 3
PATTERN_MIN_ATTRIBUTION_FOR_BAND = 5  # below this → "insufficient signal"
# Hard cap on surfaced patterns. Pattern Memory is institutional cognition,
# not a metrics feed — fewer, weightier signals beat many derived ones.
# Anything beyond the cap is counted as `suppressed_count` and shown by the
# UI as a single muted footer line (never expandable — that would re-create
# the dashboard mindset this layer exists to avoid).
MAX_SURFACED_PATTERNS = 7

PRESSURE_RANK = {  # smaller = surfaces higher
    "contested":         0,
    "operator_dominant": 1,
    "ai_dominant":       2,
    "insufficient":      3,
}


def _attribution_band(ai_right: int, op_right: int, total: int) -> str:
    """Decide the qualitative attribution band — never a percentage."""
    if total < PATTERN_MIN_ATTRIBUTION_FOR_BAND:
        return "insufficient"
    ai_share = ai_right / total
    op_share = op_right / total
    if ai_share >= 0.7:
        return "ai_dominant"
    if op_share >= 0.7:
        return "operator_dominant"
    if ai_share >= 0.3 and op_share >= 0.3:
        return "contested"
    return "insufficient"


def _confidence_for_pattern(occurrences: int, attributed: int) -> str:
    """Direction over precision — same band vocabulary as conviction."""
    if attributed >= 3 and occurrences >= 5:
        return "strong"
    if occurrences >= 5 or attributed >= 2:
        return "building"
    if occurrences >= PATTERN_MIN_OCCURRENCES:
        return "weak"
    return "forming"


def _passes_threshold(occurrences: int, attributed: int) -> bool:
    return occurrences >= PATTERN_MIN_OCCURRENCES or attributed >= 1


async def _attribution_for_action_type(db, action_type: str) -> Dict[str, int]:
    """Aggregate override outcome attribution for a single action_type."""
    if "cognition_overrides" not in await db.list_collection_names():
        return {"ai_was_right": 0, "operator_was_right": 0,
                "neutral": 0, "pending": 0, "total": 0}
    cur = db.cognition_overrides.find(
        {"target.action_type": action_type,
         "created_at": {"$gte": _ago_hours(PATTERN_WINDOW_DAYS * 24)}},
        {"_id": 0, "outcome.verdict": 1},
    )
    docs = await cur.to_list(500)
    counts = {"ai_was_right": 0, "operator_was_right": 0,
              "neutral": 0, "pending": 0, "total": 0}
    for d in docs:
        verdict = (d.get("outcome") or {}).get("verdict") or "pending"
        counts["total"] += 1
        if verdict == "operator_was_correct":
            counts["operator_was_right"] += 1
        elif verdict == "suppression_was_justified":
            counts["ai_was_right"] += 1
        elif verdict == "neutral":
            counts["neutral"] += 1
        else:
            counts["pending"] += 1
    return counts


def _shape_pattern(
    *, pattern_id: str, category: str, title: str, drivers: List[Dict[str, Any]],
    occurrences: int, attribution: Dict[str, int],
    scope: Dict[str, Any], representative_module_id: Optional[str],
    last_seen_at: Optional[str],
) -> Dict[str, Any]:
    band = _attribution_band(
        attribution.get("ai_was_right", 0),
        attribution.get("operator_was_right", 0),
        attribution.get("total", 0),
    )
    confidence = _confidence_for_pattern(
        occurrences, attribution.get("total", 0),
    )
    # Temporal humility frame — every pattern reads as a current signal,
    # never as a proven truth. Wording per-band so it never feels like
    # boilerplate; each band carries its own epistemic stance.
    total = attribution.get("total", 0)
    if total == 0:
        # No override-channel attribution available (QA / revision detectors).
        humility = f"observed across last {PATTERN_WINDOW_DAYS}d"
    elif band == "contested":
        humility = "organizational signal still contested"
    elif band == "operator_dominant":
        humility = "operators have been overriding consistently · interpretation pending"
    elif band == "ai_dominant":
        humility = "system suppression upheld so far · sample still small"
    else:  # insufficient (total>0 but below band threshold)
        humility = "awaiting more outcomes"
    return {
        "pattern_id": pattern_id,
        "category": category,
        "title": title,
        "drivers": drivers,
        "occurrences": occurrences,
        "window_days": PATTERN_WINDOW_DAYS,
        "confidence": confidence,
        "attribution": {
            "band": band,
            "ai_was_right": attribution.get("ai_was_right", 0),
            "operator_was_right": attribution.get("operator_was_right", 0),
            "neutral": attribution.get("neutral", 0),
            "pending": attribution.get("pending", 0),
            "total": attribution.get("total", 0),
        },
        "scope": scope,
        "representative_module_id": representative_module_id,
        "last_seen_at": last_seen_at,
        "humility": humility,
        "pressure_rank": PRESSURE_RANK.get(band, 3),
    }


async def _pattern_overload_suppression(db) -> List[Dict[str, Any]]:
    """Cluster: suppressed reassign / overload-related actions per
    developer cluster (or per assignee from the targeted modules).
    """
    raw = await db.system_actions_log.find(
        {"action_type": {"$in": ["reassign_task", "redistribute_load"]},
         "status": {"$in": ["blocked_requires_manual", "logged_only",
                            "awaiting_manual_execution"]},
         "created_at": {"$gte": _ago_hours(PATTERN_WINDOW_DAYS * 24)}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)

    if not raw:
        return []

    # Cluster across all such suppressions — a single pattern at the org level.
    occurrences = len(raw)
    last_seen = raw[0].get("created_at")
    affected_modules = list({
        s.get("entity_id") for s in raw
        if s.get("entity_type") == "module" and s.get("entity_id")
    })

    # Attribution merged across both action_types
    a_reassign = await _attribution_for_action_type(db, "reassign_task")
    a_redist   = await _attribution_for_action_type(db, "redistribute_load")
    attribution = {
        k: a_reassign.get(k, 0) + a_redist.get(k, 0)
        for k in ("ai_was_right", "operator_was_right",
                  "neutral", "pending", "total")
    }

    if not _passes_threshold(occurrences, attribution["total"]):
        return []

    return [_shape_pattern(
        pattern_id="overload_suppression_recurring",
        category="suppression",
        title="Overload suppressions recurring",
        drivers=[
            {"driver": "overload_risk", "severity": "high"},
            {"driver": "redistribute_load", "severity": "medium"},
        ],
        occurrences=occurrences,
        attribution=attribution,
        scope={"type": "action_type",
               "ids": ["reassign_task", "redistribute_load"],
               "primary_id": "reassign_task"},
        representative_module_id=affected_modules[0] if affected_modules else None,
        last_seen_at=last_seen,
    )]


async def _pattern_qa_collapse(db) -> List[Dict[str, Any]]:
    """Cluster: QA failures per project in the window."""
    raw = await db.qa_decisions.find(
        {"result": {"$in": ["rejected", "failed"]},
         "created_at": {"$gte": _ago_hours(PATTERN_WINDOW_DAYS * 24)}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    if not raw:
        return []

    by_project: Dict[str, List[dict]] = {}
    for q in raw:
        pid = q.get("project_id") or "unknown"
        by_project.setdefault(pid, []).append(q)

    out: List[Dict[str, Any]] = []
    for project_id, fails in by_project.items():
        occurrences = len(fails)
        last_seen = fails[0].get("created_at")
        affected_modules = list({q.get("module_id") for q in fails if q.get("module_id")})
        # No direct attribution channel for QA collapses (yet) — show as observed.
        attribution = {"ai_was_right": 0, "operator_was_right": 0,
                       "neutral": 0, "pending": 0, "total": 0}
        if not _passes_threshold(occurrences, 0):
            continue
        out.append(_shape_pattern(
            pattern_id=f"qa_collapse_{project_id}",
            category="qa",
            title="QA collapse cluster on project",
            drivers=[
                {"driver": "qa_volatility", "severity": "high"},
            ],
            occurrences=occurrences,
            attribution=attribution,
            scope={"type": "project", "ids": [project_id],
                   "primary_id": project_id},
            representative_module_id=affected_modules[0] if affected_modules else None,
            last_seen_at=last_seen,
        ))
    return out


async def _pattern_revision_cluster(db) -> List[Dict[str, Any]]:
    """Cluster: modules with ≥2 revisions in the window."""
    raw = await db.modules.find(
        {"revision_count": {"$gte": 2}},
        {"_id": 0, "module_id": 1, "name": 1, "title": 1, "stack": 1,
         "required_skills": 1, "revision_count": 1, "updated_at": 1,
         "created_at": 1, "project_id": 1},
    ).to_list(500)
    if not raw:
        return []

    occurrences = len(raw)
    last_seen = max(
        (str(m.get("updated_at") or m.get("created_at") or "") for m in raw),
        default=None,
    )
    # Aggregate stacks for a structured "where" hint, not prose.
    stack_counter: Counter = Counter()
    for m in raw:
        for s in (m.get("stack") or m.get("required_skills") or []):
            stack_counter[str(s).lower()] += 1
    top_stacks = [s for s, _ in stack_counter.most_common(3)]
    if not _passes_threshold(occurrences, 0):
        return []

    return [_shape_pattern(
        pattern_id="revision_cluster_recurring",
        category="revision",
        title="Revision loops recurring across modules",
        drivers=[
            {"driver": "revision_cluster", "severity": "high"},
        ],
        occurrences=occurrences,
        attribution={"ai_was_right": 0, "operator_was_right": 0,
                     "neutral": 0, "pending": 0, "total": 0},
        scope={"type": "skill_stack", "ids": top_stacks,
               "primary_id": top_stacks[0] if top_stacks else "unknown"},
        representative_module_id=raw[0].get("module_id"),
        last_seen_at=last_seen,
    )]


async def _pattern_operator_override(db) -> List[Dict[str, Any]]:
    """Cluster: overrides per target.action_type."""
    if "cognition_overrides" not in await db.list_collection_names():
        return []
    raw = await db.cognition_overrides.find(
        {"created_at": {"$gte": _ago_hours(PATTERN_WINDOW_DAYS * 24)}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    if not raw:
        return []
    by_action: Dict[str, List[dict]] = {}
    for ov in raw:
        at = (ov.get("target") or {}).get("action_type") or "unknown"
        by_action.setdefault(at, []).append(ov)

    out: List[Dict[str, Any]] = []
    for action_type, items in by_action.items():
        occurrences = len(items)
        last_seen = items[0].get("created_at")
        attribution = await _attribution_for_action_type(db, action_type)
        if not _passes_threshold(occurrences, attribution["total"]):
            continue
        # Pull representative module from any override whose target was a module.
        rep_mod = None
        for ov in items:
            t = ov.get("target") or {}
            if t.get("entity_type") == "module" and t.get("entity_id"):
                rep_mod = t["entity_id"]
                break
        # Wording is decision-pressure-aware: contested patterns describe the
        # disagreement directly (live institutional tension), the rest describe
        # the repeated act (mechanical pressure).
        _band_for_title = _attribution_band(
            attribution.get("ai_was_right", 0),
            attribution.get("operator_was_right", 0),
            attribution.get("total", 0),
        )
        if _band_for_title == "contested":
            _title = f"Operators and AI repeatedly disagree on {action_type}"
        else:
            _title = f"Operators override {action_type} repeatedly"
        out.append(_shape_pattern(
            pattern_id=f"override_repeat_{action_type}",
            category="override",
            title=_title,
            drivers=[
                {"driver": "policy", "severity": "medium"},
            ],
            occurrences=occurrences,
            attribution=attribution,
            scope={"type": "action_type", "ids": [action_type],
                   "primary_id": action_type},
            representative_module_id=rep_mod,
            last_seen_at=last_seen,
        ))
    return out


async def _patterns(db) -> Dict[str, Any]:
    """Aggregate all detectors and sort by DECISION PRESSURE, not count.

    Sort order:
        1. contested         (organizational cognition is unstable)
        2. operator_dominant (operators systematically disagreeing with AI)
        3. ai_dominant       (AI systematically being correct)
        4. insufficient      (signal forming)
    Within each pressure band: most recent first.

    After sort the list is hard-capped at MAX_SURFACED_PATTERNS. Anything
    beyond the cap surfaces as `suppressed_count` only — the UI renders
    this as a single muted line. Pattern Memory is institutional cognition,
    not analytics: fewer, weightier signals beat many derived metrics.
    """
    detectors = [
        _pattern_overload_suppression(db),
        _pattern_qa_collapse(db),
        _pattern_revision_cluster(db),
        _pattern_operator_override(db),
        # NOTE: `_pattern_ai_attribution` was intentionally removed.
        # Its signal (AI-vs-operator outcome attribution per action_type)
        # is already carried by `_pattern_operator_override` via the
        # `attribution.band` field on each card. A separate detector only
        # produced duplicate cards with no new organizational meaning —
        # which is exactly the analytics-creep this layer must resist.
    ]
    results: List[Dict[str, Any]] = []
    for batch in await _gather(detectors):
        results.extend(batch)

    if not results:
        return {
            "status": "forming",
            "reason": ("Pattern memory is forming — no recurring decision "
                       f"patterns yet across the last {PATTERN_WINDOW_DAYS} days."),
            "patterns": [],
            "suppressed_count": 0,
            "window_days": PATTERN_WINDOW_DAYS,
            "generated_at": _now().isoformat(),
        }

    # Sort by decision pressure, then by recency. NEVER by count.
    def _sort_key(p):
        try:
            ts = datetime.fromisoformat(
                str(p.get("last_seen_at") or "").replace("Z", "+00:00")
            ).timestamp()
        except Exception:
            ts = 0
        return (p.get("pressure_rank", 3), -ts)
    results.sort(key=_sort_key)

    total = len(results)
    surfaced = results[:MAX_SURFACED_PATTERNS]
    suppressed = max(0, total - len(surfaced))

    # Provenance — how much of recent cognition input is replayed tissue
    # vs organic. Surfaces a panel-level honesty ribbon in the UI when the
    # replayed share dominates. Failures are non-fatal (best-effort).
    provenance: Dict[str, Any] = {
        "real": 0, "replayed": 0, "total": 0,
        "replay_share": 0.0, "window_hours": PATTERN_WINDOW_DAYS * 24,
    }
    try:
        from seed_replay import provenance_share
        provenance = await provenance_share(
            db, hours=PATTERN_WINDOW_DAYS * 24)
    except Exception:
        pass

    return {
        "status": "active",
        "patterns": surfaced,
        "suppressed_count": suppressed,
        "window_days": PATTERN_WINDOW_DAYS,
        "provenance": provenance,
        "generated_at": _now().isoformat(),
    }


async def _gather(coros):
    """asyncio.gather wrapper local to this module so we don't pollute
    the global namespace at import time."""
    import asyncio
    return await asyncio.gather(*coros)


# ─────────────────────────────────────────────────────────────────────────
# P3.1 Causal Trace reader — assembles the chain from records that carry
# this causation_id. No prose, no AI explanation, no synthetic ordering.
# Returns `{status:"forming"}` honestly when there is <2 distinct phases.
# ─────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────
# P3.3 — Chain Closing Logic. Trace interpretation, NOT prediction.
#
# Closure is a STATE TRANSITION, not a moral judgment. Closure does NOT
# mean success. The 5 allowed terminal states describe HOW pressure ended,
# not whether the outcome was "good".
#
# Hard rules baked in:
#   • Closure requires a quiet window (no new entity activity for N hours).
#     This protects against premature closure on transient lulls.
#   • Unresolved is the dominant state by design. If most chains close,
#     the system is performing certainty theatre — that is the failure
#     mode this layer exists to prevent.
#   • No future predictions. No risk projection. No "likely destabilization".
#     No chain scoring. No recursive closure effects on other chains.
#   • Closure is LAZY — evaluated on read of /causal-trace, persisted
#     idempotently. No new background workers, no new write-sites
#     outside the lazy-read path.
#   • Attribution (who-was-right) is Pattern Memory's job. Closure must
#     never duplicate that judgment layer.
CHAIN_CLOSURE_STATES = (
    "stabilized_without_intervention",  # suppress without override, decay held
    "pressure_cycle_resolved",          # override + module reached terminal-completed
    "override_produced_instability",    # override followed by new suppressions/overrides
    "pressure_dissipated",              # collapse only, never escalated, faded out
    "outcome_unresolved",               # quiet but indeterminate — chain ended without signal
)
CHAIN_CLOSURE_QUIET_HOURS = 48          # No closure until this window of decay
# Decay descriptions surface as a single muted line, never as celebration.
_CLOSURE_LABELS = {
    "stabilized_without_intervention": "stabilized · suppression held without operator action",
    "pressure_cycle_resolved":         "pressure cycle resolved · module reached terminal state after intervention",
    "override_produced_instability":   "override followed by downstream instability",
    "pressure_dissipated":             "pressure dissipated · cognition collapse never escalated",
    "outcome_unresolved":              "outcome unresolved · chain quieted without a clear signal",
}


async def _entity_activity_after(
    db, entity_id: Optional[str], after_iso: Optional[str],
    exclude_causation_id: Optional[str] = None,
) -> int:
    """Count institution-visible activity on `entity_id` since `after_iso`,
    EXCLUDING events that belong to the chain being evaluated (so the
    chain's own writes don't falsely register as 'new noise').

    Reads from system_actions_log + cognition_overrides + cognition_events.
    Any positive count means the chain is NOT quiet — closure must abort.
    """
    if not entity_id or not after_iso:
        return 0
    exclusion = {}
    if exclude_causation_id:
        exclusion = {"causation_id": {"$ne": exclude_causation_id}}
    try:
        sl = await db.system_actions_log.count_documents({
            "entity_id": entity_id, "created_at": {"$gt": after_iso},
            **exclusion,
        })
        ov = await db.cognition_overrides.count_documents({
            "target.entity_id": entity_id, "created_at": {"$gt": after_iso},
            **exclusion,
        })
        ce = await db.cognition_events.count_documents({
            "module_id": entity_id, "created_at": {"$gt": after_iso},
            **exclusion,
        })
        return sl + ov + ce
    except Exception:
        # On any read failure we treat as "noisy" — refuse to close. That
        # is the conservative direction: silence must be PROVEN, never assumed.
        return 1


async def _evaluate_chain_closure(
    db, chain_doc: Dict[str, Any], phases: List[str],
    override_rows: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Return a closure dict `{state, closed_at, decided_because}` when
    the chain qualifies for terminal state transition, else None.

    Closure is intentionally rare. Most chains will return None and remain
    open — that is the honest organizational answer.
    """
    if chain_doc.get("status") == "closed":
        return None
    last_event = chain_doc.get("last_event_at")
    if not last_event:
        return None
    try:
        last_dt = datetime.fromisoformat(last_event.replace("Z", "+00:00"))
    except Exception:
        return None
    quiet_threshold = _now() - timedelta(hours=CHAIN_CLOSURE_QUIET_HOURS)
    if last_dt > quiet_threshold:
        # Decay window not reached — chain stays open. No closure.
        return None
    entity_id = chain_doc.get("entity_id")

    # Any institution-visible activity inside the quiet window invalidates
    # closure. The chain remains open — silence must be proven, not assumed.
    # We exclude events that already belong to this chain (those ARE the
    # chain, not "new noise").
    if await _entity_activity_after(
        db, entity_id, last_event,
        exclude_causation_id=chain_doc.get("causation_id"),
    ) > 0:
        return None

    phase_set = set(phases)
    has_collapse = "signal_collapse" in phase_set
    has_suppress = "suppressed" in phase_set
    has_override = "operator_override" in phase_set

    # If there's an override but its outcome is still pending, we do not
    # close. Outcome attribution must settle first (that's Pattern Memory /
    # _override_outcome's job, not this layer's).
    if has_override:
        latest_ov = override_rows[-1] if override_rows else None
        verdict = (latest_ov or {}).get("outcome", {}).get("verdict")
        if verdict in (None, "pending"):
            return None

        # Instability check: did a new signal_collapse or suppressed phase
        # fire on the SAME chain AFTER the override? If so, the override
        # didn't quiet the entity — pressure re-entered the chain.
        # We use phase ordering (already sorted by time) — no extra queries,
        # no out-of-chain inference.
        post_override = False
        seen_override = False
        for ph in phases:
            if ph == "operator_override":
                seen_override = True
                continue
            if seen_override and ph in ("signal_collapse", "suppressed"):
                post_override = True
                break

        if post_override:
            state = "override_produced_instability"
            because = ("a new cognition signal or suppression entered the "
                       "chain after the operator override")
        else:
            # Did the module reach a terminal completed state?
            mod = None
            if entity_id:
                try:
                    mod = await db.modules.find_one(
                        {"module_id": entity_id},
                        {"_id": 0, "status": 1, "qa_status": 1},
                    )
                except Exception:
                    mod = None
            mod_status = (mod or {}).get("status") or ""
            qa_status = ((mod or {}).get("qa_status") or "").lower()
            if mod_status in ("completed", "done", "approved") and qa_status not in ("rejected",):
                state = "pressure_cycle_resolved"
                because = "module reached terminal state after operator override"
            else:
                state = "outcome_unresolved"
                because = "override outcome settled but module never reached a terminal state"
    elif has_collapse and has_suppress:
        # Suppression held, no operator intervention, quiet window decayed.
        state = "stabilized_without_intervention"
        because = (f"no new suppressions, overrides, or cognition events "
                   f"in {CHAIN_CLOSURE_QUIET_HOURS}h")
    elif has_collapse and not has_suppress:
        # A collapse fired but the system never escalated. Pressure faded.
        state = "pressure_dissipated"
        because = "cognition collapse logged but never escalated to suppression or override"
    else:
        # Any other shape — chain ended without a clear institutional signal.
        state = "outcome_unresolved"
        because = "chain quieted without reaching a recognisable closure shape"

    return {
        "state": state,
        "closed_at": _now().isoformat(),
        "decided_because": because,
    }


def _interpret_chain(phases: List[str]) -> str:
    """Rule-based short interpretation. NO generated prose, NO AI calls.

    Returns a single short institutional sentence describing the shape
    of the chain, or an empty string when the shape is not yet meaningful.
    """
    s = set(phases)
    has_collapse = "signal_collapse" in s
    has_suppress = "suppressed" in s
    has_override = "operator_override" in s
    outcome = next((p for p in phases if p.startswith("outcome_")), None)

    if has_collapse and has_suppress and has_override:
        if outcome == "outcome_pending" or outcome is None:
            return ("operator challenged a system suppression following "
                    "cognition collapse; outcome unresolved")
        if outcome == "outcome_ai_was_right":
            return ("operator overrode a system suppression; "
                    "suppression was later upheld")
        if outcome == "outcome_operator_was_right":
            return ("operator overrode a system suppression; "
                    "operator judgement was vindicated")
        if outcome == "outcome_neutral":
            return ("operator overrode a system suppression; "
                    "outcome was mixed")
    if has_collapse and has_suppress and not has_override:
        return "system suppression following cognition collapse — no operator intervention"
    if has_override and not has_collapse:
        return "operator override with no upstream system signal"
    if has_collapse and not has_suppress:
        return "cognition collapse detected — no downstream action yet"
    return ""


async def _causal_trace(db, causation_id: str) -> Dict[str, Any]:
    """Assemble the chain referenced by `causation_id`. Reads from
    cognition_events, cognition_overrides, system_actions_log only.
    No backfill, no inference of missing phases.
    """
    chain_doc = await db.causation_chains.find_one(
        {"causation_id": causation_id}, {"_id": 0},
    )
    if not chain_doc:
        return {
            "causation_id": causation_id,
            "status": "forming",
            "reason": "no chain with this id — propagation begins with new events",
            "chain": [],
        }

    entity_id = chain_doc.get("entity_id")
    events: List[Dict[str, Any]] = []

    # 1) cognition_events with this causation_id (signal_collapse phase)
    ce_rows = await db.cognition_events.find(
        {"causation_id": causation_id},
        {"_id": 0, "phase": 1, "trigger": 1, "drivers": 1, "created_at": 1},
    ).to_list(50)
    for r in ce_rows:
        events.append({
            "phase": r.get("phase", "cognition_event"),
            "at":    r.get("created_at"),
            "drivers": [
                {"driver": d.get("driver"), "severity": d.get("severity")}
                for d in (r.get("drivers") or [])
            ],
            "trigger": r.get("trigger"),
            "source":  "cognition_event",
        })

    # 2) system_actions_log entries with this causation_id (suppressions /
    # override side-effects). Phase derived from status (no invention).
    sl_rows = await db.system_actions_log.find(
        {"causation_id": causation_id},
        {"_id": 0, "action_type": 1, "status": 1, "mode": 1, "created_at": 1},
    ).to_list(50)
    for r in sl_rows:
        status = r.get("status") or ""
        if status in ("blocked_requires_manual", "awaiting_manual_execution"):
            phase = "suppressed"
        elif status == "overridden_by_operator":
            # Side-effect log of the override itself — represented by the
            # override phase below, not duplicated here.
            continue
        else:
            phase = (r.get("action_type") or "system_action")
        events.append({
            "phase": phase,
            "at":    r.get("created_at"),
            "action_type": r.get("action_type"),
            "source": "system_actions_log",
        })

    # 3) cognition_overrides with this causation_id (operator phase +
    # terminal outcome if evaluated).
    ov_rows = await db.cognition_overrides.find(
        {"causation_id": causation_id},
        {"_id": 0, "override_id": 1, "reason": 1, "created_at": 1,
         "outcome": 1, "outcome_evaluated_at": 1},
    ).to_list(50)
    for r in ov_rows:
        events.append({
            "phase": "operator_override",
            "at":    r.get("created_at"),
            "reason": r.get("reason"),
            "source": "cognition_overrides",
            "ref": {"override_id": r.get("override_id")},
        })
        outcome = r.get("outcome") or {}
        verdict = outcome.get("verdict")
        if verdict and verdict != "pending":
            events.append({
                "phase": "outcome_" + str(verdict),
                "at":    r.get("outcome_evaluated_at") or r.get("created_at"),
                "source": "cognition_overrides",
            })
        elif verdict == "pending":
            events.append({
                "phase": "outcome_pending",
                "at":    r.get("outcome_evaluated_at") or r.get("created_at"),
                "source": "cognition_overrides",
            })

    # Temporal sort — single key, no synthetic ordering.
    events.sort(key=lambda e: str(e.get("at") or ""))

    distinct_phases = {e["phase"] for e in events}
    # P3.2 — resolve participants with current labels (one batched query).
    participants = await _resolve_participant_labels(
        db, chain_doc.get("participants") or []
    )

    # P3.3 — Lazy chain closure evaluation. If the chain has already been
    # closed (status == "closed"), surface the persisted closure verbatim.
    # Otherwise check whether the decay window has been reached AND there
    # has been no entity-side activity since last_event_at. Most chains
    # will NOT close here — that is the honest organizational answer.
    closure = chain_doc.get("closure")
    if chain_doc.get("status") != "closed":
        verdict = await _evaluate_chain_closure(
            db, chain_doc, [e["phase"] for e in events], ov_rows,
        )
        if verdict:
            closure = verdict
            try:
                await db.causation_chains.update_one(
                    {"causation_id": causation_id},
                    {"$set": {
                        "status":  "closed",
                        "closure": closure,
                        "closed_at": closure["closed_at"],
                    }},
                )
            except Exception:
                # Best-effort persistence — closure already returned in
                # this response; next read will re-evaluate.
                pass

    if len(distinct_phases) < 2:
        out = {
            "causation_id": causation_id,
            "status": "forming",
            "reason": ("chain has only one phase so far — propagation "
                       "continues as new events fire"),
            "root": {"type": chain_doc.get("root_type"),
                     "entity_id": entity_id},
            "chain": events,
            "participants": participants,
        }
        if closure:
            out["closure"] = closure
            out["status"] = "closed"
        return out

    out = {
        "causation_id": causation_id,
        "status": "closed" if closure else "active",
        "root": {"type": chain_doc.get("root_type"), "entity_id": entity_id},
        "chain": events,
        "participants": participants,
        "interpretation": _interpret_chain([e["phase"] for e in events]),
    }
    if closure:
        out["closure"] = closure
    return out


async def _causal_trace_by_module(db, module_id: str) -> Dict[str, Any]:
    """Convenience reader — returns the most recent open chain for a
    module, or `{status:"forming"}` if none exists yet."""
    chain = await db.causation_chains.find_one(
        {"entity_id": module_id, "status": {"$ne": "closed"}},
        {"_id": 0, "causation_id": 1},
        sort=[("last_event_at", -1)],
    )
    if not chain:
        return {
            "status": "forming",
            "reason": ("no causation chain for this module yet — chains "
                       "open when a new cognition event fires"),
            "chain": [],
        }
    return await _causal_trace(db, chain["causation_id"])


# ─────────────────────────────────────────────────────────────────────────
# Pressure Topology (Stage P2.4) — spatial projection of organizational pressure
# ─────────────────────────────────────────────────────────────────────────
#
# NOT a monitoring dashboard. NOT a heatmap. NOT a graph visualization.
#
# Topology is a spatial container that answers ONE question:
#
#     where is unresolved organizational pressure accumulating?
#
# Hard rules baked into this layer:
#
# 1. Band-first, never numbers-first. Bands carry the meaning. Numbers
#    are tooltip-grade calibration, never headline.
# 2. Sparse > dense. If pressure is low, the topology is mostly empty.
#    We never fill empty space with synthetic clustering. Empty IS the
#    institutional signal.
# 3. One projection axis at a time. The four axes (`projects`,
#    `skill_stacks`, `developers`, `action_types`) are independent
#    cognition geographies — they NEVER merge into one mixed map.
# 4. Topology shows ACCUMULATION, not events. A node burns because
#    "cognition repeatedly struggles here", not because "many events
#    happened here".
# 5. No auto-recommendations. No "Suggested action". Topology surfaces
#    pressure; operators decide what to do with it.
# 6. Honest provenance — the response carries the same `replay_share`
#    shape as Pattern Memory, so the UI can surface a tiny "pressure
#    partially derived from replayed cognition traces" subline.
TOPOLOGY_WINDOW_DAYS = 14
TOPOLOGY_AXIS_DEFAULT = "projects"
TOPOLOGY_AXES = ("projects", "skill_stacks", "developers", "action_types")

# Driver severity → numeric weight used internally to pick `dominant_driver`
# and to compute the qualitative pressure band. Never surfaced to UI as a number.
_DRIVER_SEVERITY_WEIGHT = {"high": 3, "medium": 2, "low": 1}

# Band thresholds derived from contributing-driver structure:
#   - high      → ≥2 high-severity drivers OR (1 high + ≥1 medium)
#   - elevated  → 1 high-severity OR ≥2 medium-severity
#   - forming   → exactly 1 medium-severity OR several low signals
#   - quiet     → no contributing pressure


def _topology_band(drivers: List[Dict[str, Any]]) -> str:
    if not drivers:
        return "quiet"
    sev_counts = Counter(d.get("severity") for d in drivers)
    hi = sev_counts.get("high", 0)
    md = sev_counts.get("medium", 0)
    lo = sev_counts.get("low", 0)
    if hi >= 2 or (hi >= 1 and md >= 1):
        return "high"
    if hi >= 1 or md >= 2:
        return "elevated"
    if md >= 1 or lo >= 2:
        return "forming"
    return "quiet"


def _dominant_driver(drivers: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not drivers:
        return None
    return max(
        drivers,
        key=lambda d: (_DRIVER_SEVERITY_WEIGHT.get(d.get("severity"), 0),
                       d.get("occurrences", 0)),
    )


async def _project_pressure_signals(db) -> Dict[str, List[Dict[str, Any]]]:
    """Compute structured pressure drivers per project across the window.

    Returns a {project_id: [drivers]} mapping. Each driver is
    {driver, severity, label, occurrences}. `occurrences` is kept for
    tooltip/calibration only — the UI never displays it as a headline.
    """
    cutoff_iso = _ago_hours(TOPOLOGY_WINDOW_DAYS * 24)

    # 1) Load every module → project map (so we can attribute module-level
    # signals back to their project).
    modules = await db.modules.find(
        {},
        {"_id": 0, "module_id": 1, "project_id": 1,
         "revision_count": 1, "stack": 1, "required_skills": 1},
    ).to_list(2000)
    mod_to_proj = {m["module_id"]: m.get("project_id")
                   for m in modules if m.get("module_id")}

    drivers_by_proj: Dict[str, List[Dict[str, Any]]] = {}

    def _push(pid: Optional[str], driver: Dict[str, Any]):
        if not pid:
            return
        drivers_by_proj.setdefault(pid, []).append(driver)

    # 2) qa_volatility — rejected QA decisions per project in window.
    qa_rows = await db.qa_decisions.find(
        {"result": {"$in": ["rejected", "failed"]},
         "created_at": {"$gte": cutoff_iso}},
        {"_id": 0, "project_id": 1, "module_id": 1},
    ).to_list(2000)
    qa_by_proj: Counter = Counter()
    for r in qa_rows:
        pid = r.get("project_id") or mod_to_proj.get(r.get("module_id"))
        if pid:
            qa_by_proj[pid] += 1
    for pid, n in qa_by_proj.items():
        sev = "high" if n >= 10 else "medium" if n >= 6 else "low" if n >= 3 else None
        if sev:
            _push(pid, {"driver": "qa_volatility", "severity": sev,
                        "label": "QA volatility", "occurrences": n})

    # 3) revision_cluster — modules with revision_count ≥ 2 per project.
    rev_by_proj: Counter = Counter()
    for m in modules:
        if (m.get("revision_count") or 0) >= 2 and m.get("project_id"):
            rev_by_proj[m["project_id"]] += 1
    for pid, n in rev_by_proj.items():
        sev = "high" if n >= 4 else "medium" if n >= 2 else "low" if n >= 1 else None
        if sev:
            _push(pid, {"driver": "revision_cluster", "severity": sev,
                        "label": "Revision cluster", "occurrences": n})

    # 4) override_friction — cognition_overrides whose target is a module
    # in this project, in window. Counts ALL overrides regardless of
    # outcome — friction is the signal here, not who-was-right.
    ov_rows: List[Dict[str, Any]] = []
    try:
        ov_rows = await db.cognition_overrides.find(
            {"created_at": {"$gte": cutoff_iso}},
            {"_id": 0, "target": 1},
        ).to_list(2000)
    except Exception:
        pass
    ov_by_proj: Counter = Counter()
    for r in ov_rows:
        t = r.get("target") or {}
        if t.get("entity_type") == "module":
            pid = mod_to_proj.get(t.get("entity_id"))
            if pid:
                ov_by_proj[pid] += 1
        elif t.get("entity_type") == "project":
            pid = t.get("entity_id")
            if pid:
                ov_by_proj[pid] += 1
    for pid, n in ov_by_proj.items():
        sev = "high" if n >= 10 else "medium" if n >= 6 else "low" if n >= 3 else None
        if sev:
            _push(pid, {"driver": "override_friction", "severity": sev,
                        "label": "Override friction", "occurrences": n})

    # 5) suppression_load — system_actions_log entries blocked/awaiting
    # for modules/projects in window. Schema-mixed entries handled.
    sl_rows = await db.system_actions_log.find(
        {"status": {"$in": ["blocked_requires_manual",
                            "awaiting_manual_execution",
                            "logged_only"]},
         "created_at": {"$gte": cutoff_iso}},
        {"_id": 0, "entity_type": 1, "entity_id": 1, "action_type": 1},
    ).to_list(5000)
    sup_by_proj: Counter = Counter()
    overload_by_proj: Counter = Counter()
    for r in sl_rows:
        if r.get("entity_type") == "module":
            pid = mod_to_proj.get(r.get("entity_id"))
        elif r.get("entity_type") == "project":
            pid = r.get("entity_id")
        else:
            pid = None  # developer-level events don't project to project axis
        if not pid:
            continue
        sup_by_proj[pid] += 1
        if r.get("action_type") in ("redistribute_load", "reassign_task"):
            overload_by_proj[pid] += 1
    for pid, n in sup_by_proj.items():
        sev = "high" if n >= 12 else "medium" if n >= 7 else "low" if n >= 4 else None
        if sev:
            _push(pid, {"driver": "suppression_load", "severity": sev,
                        "label": "Suppression load", "occurrences": n})
    for pid, n in overload_by_proj.items():
        sev = "high" if n >= 8 else "medium" if n >= 5 else "low" if n >= 3 else None
        if sev:
            _push(pid, {"driver": "overload_risk", "severity": sev,
                        "label": "Overload risk", "occurrences": n})

    return drivers_by_proj


async def _topology_projects(db) -> Dict[str, Any]:
    """Build the projects-axis topology — the institutional default."""
    projects = await db.projects.find(
        {}, {"_id": 0, "project_id": 1, "name": 1, "title": 1},
    ).to_list(500)
    if not projects:
        return {
            "status": "forming",
            "axis": "projects",
            "swimlanes": [],
            "reason": "No projects yet — topology will form as projects accumulate.",
        }

    drivers_by_proj = await _project_pressure_signals(db)

    # Build one node per project, even when pressure is zero — quiet
    # projects belong in the topology so admins can see them as
    # institutionally calm, not invisible.
    nodes: List[Dict[str, Any]] = []
    for p in projects:
        pid = p.get("project_id")
        if not pid:
            continue
        drivers = drivers_by_proj.get(pid, [])
        band = _topology_band(drivers)
        dom = _dominant_driver(drivers)
        nodes.append({
            "node_id": pid,
            "label": p.get("name") or p.get("title") or pid,
            "band": band,
            "dominant_driver": (
                {"driver": dom["driver"], "label": dom["label"],
                 "severity": dom["severity"]} if dom else None
            ),
            "drivers": [
                {"driver": d["driver"], "label": d["label"],
                 "severity": d["severity"], "occurrences": d["occurrences"]}
                for d in drivers
            ],
            # Honest deep-link target — pick any module in the project as
            # representative so the UI can route into cognition console.
            "representative_module_id": None,
        })

    # Backfill representative_module_id (one query for the lot).
    mods_for_link = await db.modules.find(
        {"project_id": {"$in": [n["node_id"] for n in nodes]}},
        {"_id": 0, "module_id": 1, "project_id": 1},
    ).to_list(2000)
    by_proj_mod: Dict[str, str] = {}
    for m in mods_for_link:
        pid = m.get("project_id")
        if pid and pid not in by_proj_mod and m.get("module_id"):
            by_proj_mod[pid] = m["module_id"]
    for n in nodes:
        n["representative_module_id"] = by_proj_mod.get(n["node_id"])

    # Group into swimlanes by band. Within each lane: sort alphabetically
    # by label (institutional calm, not "biggest first").
    swim_order = [("high",     "HIGH PRESSURE"),
                  ("elevated", "ELEVATED"),
                  ("forming",  "FORMING"),
                  ("quiet",    "QUIET")]
    lanes: List[Dict[str, Any]] = []
    for band, label in swim_order:
        lane_nodes = sorted(
            [n for n in nodes if n["band"] == band],
            key=lambda x: (x["label"] or "").lower(),
        )
        lanes.append({"band": band, "label": label,
                      "count": len(lane_nodes), "nodes": lane_nodes})

    return {
        "status": "active",
        "axis": "projects",
        "swimlanes": lanes,
        "total_nodes": len(nodes),
    }


async def _topology(db, axis: str) -> Dict[str, Any]:
    """Public entrypoint. Only `projects` is institutionally active in
    P2.4. The other three axes are reachable (so the UI can show their
    affordance) but return a `forming` payload until their pressure
    signals are properly aggregated — same epistemic stance Pattern
    Memory uses for unresolved bands.
    """
    axis = axis if axis in TOPOLOGY_AXES else TOPOLOGY_AXIS_DEFAULT

    if axis == "projects":
        out = await _topology_projects(db)
    else:
        out = {
            "status": "forming",
            "axis": axis,
            "swimlanes": [],
            "reason": (
                "Axis forming — the projects projection is the institutional "
                "default. This axis will activate when organizational signal "
                "accumulates enough cross-{} structure.".format(axis)
            ),
        }

    # Provenance — same shape as Pattern Memory. UI surfaces it as a tiny
    # subline, never as a banner.
    provenance: Dict[str, Any] = {
        "real": 0, "replayed": 0, "total": 0,
        "replay_share": 0.0, "window_hours": TOPOLOGY_WINDOW_DAYS * 24,
    }
    try:
        from seed_replay import provenance_share
        provenance = await provenance_share(
            db, hours=TOPOLOGY_WINDOW_DAYS * 24)
    except Exception:
        pass

    out.update({
        "available_axes": list(TOPOLOGY_AXES),
        "window_days": TOPOLOGY_WINDOW_DAYS,
        "provenance": provenance,
        "generated_at": _now().isoformat(),
    })
    return out


# ─────────────────────────────────────────────────────────────────────────
# Router factory
# ─────────────────────────────────────────────────────────────────────────
def init_router(db, get_current_user_dep, require_admin_dep):
    router = APIRouter(prefix="/api/execution-intelligence",
                       tags=["execution-intelligence"])

    @router.get("/live-flow")
    async def live_flow(_admin=Depends(require_admin_dep)):
        return await _live_flow(db)

    @router.get("/why")
    async def why(_admin=Depends(require_admin_dep)):
        return await _why(db)

    @router.get("/why/{module_id}")
    async def why_module(module_id: str, _admin=Depends(require_admin_dep)):
        # Wrapper variant — also lazily logs signal_collapse cognition_event
        # when ≥2 high-severity negative drivers are present.
        return await _why_module_with_collapse_log(db, module_id)

    @router.get("/parallel-universes/{module_id}")
    async def parallel_universes(module_id: str, _admin=Depends(require_admin_dep)):
        return await _parallel_universes(db, module_id)

    @router.get("/suppressions")
    async def suppressions(_admin=Depends(require_admin_dep)):
        return await _suppressions(db)

    @router.get("/conviction")
    async def conviction(_admin=Depends(require_admin_dep)):
        return await _conviction(db)

    @router.get("/memory")
    async def memory(_admin=Depends(require_admin_dep)):
        return await _memory(db)

    # ── P2.1 Cognition Continuity ───────────────────────────────────────
    @router.get("/timeline/{module_id}")
    async def timeline(module_id: str, _admin=Depends(require_admin_dep)):
        return await _timeline(db, module_id)

    # ── P2.2 Operator Override ──────────────────────────────────────────
    @router.post("/override/{action_id}")
    async def override_create(
        action_id: str = Path(...),
        body: dict = Body(...),
        operator=Depends(get_current_user_dep),
        _admin=Depends(require_admin_dep),
    ):
        # `operator` is the FastAPI dep result; coerce to plain dict.
        op_dict: Dict[str, Any] = {}
        if operator is not None:
            for attr in ("user_id", "email", "name"):
                v = getattr(operator, attr, None)
                if v is None and isinstance(operator, dict):
                    v = operator.get(attr)
                if v is not None:
                    op_dict[attr] = v
        return await _override_create(
            db, action_id,
            operator=op_dict,
            reason=str(body.get("reason") or ""),
            acknowledged_risk=bool(body.get("acknowledged_risk")),
        )

    @router.get("/override/{override_id}/outcome")
    async def override_outcome(override_id: str, _admin=Depends(require_admin_dep)):
        return await _override_outcome(db, override_id)

    @router.get("/overrides")
    async def overrides_list(_admin=Depends(require_admin_dep)):
        return await _override_list(db)

    # ── P2.3-lite Pattern Memory ────────────────────────────────────────
    @router.get("/patterns")
    async def patterns(_admin=Depends(require_admin_dep)):
        return await _patterns(db)

    # ── P2.4 Pressure Topology ──────────────────────────────────────────
    @router.get("/topology")
    async def topology(
        axis: str = TOPOLOGY_AXIS_DEFAULT,
        _admin=Depends(require_admin_dep),
    ):
        return await _topology(db, axis)

    # ── P3.1 Causal Trace ───────────────────────────────────────────────
    # Two reads:
    #   • by causation_id  — the canonical chain reader
    #   • by module_id     — convenience for the cognition console panel,
    #                        returns the most recent open chain
    @router.get("/causal-trace/{causation_id}")
    async def causal_trace(
        causation_id: str, _admin=Depends(require_admin_dep),
    ):
        return await _causal_trace(db, causation_id)

    @router.get("/causal-trace/by-module/{module_id}")
    async def causal_trace_by_module(
        module_id: str, _admin=Depends(require_admin_dep),
    ):
        return await _causal_trace_by_module(db, module_id)

    # ── Seed-replay control surface (transitional cognition tissue) ─────
    # NOT a simulation engine — see seed_replay.py docstring. Replay is
    # explicit and admin-only; every record carries provenance so admins
    # can always tell which patterns rest on replayed vs organic tissue.
    @router.get("/replay/provenance")
    async def replay_provenance(
        hours: int = 14 * 24, _admin=Depends(require_admin_dep)):
        from seed_replay import provenance_share
        return await provenance_share(db, hours=max(1, min(hours, 14 * 24 * 4)))

    @router.post("/replay/run")
    async def replay_run(
        body: dict = Body(default={}), _admin=Depends(require_admin_dep)):
        from seed_replay import run_replay
        return await run_replay(
            db,
            days=int(body.get("days", 14)),
            intensity=str(body.get("intensity", "medium")),
            label=str(body.get("label", "manual_replay_" + _now().strftime("%Y%m%d%H%M"))),
        )

    @router.post("/replay/wipe")
    async def replay_wipe(
        body: dict = Body(...), _admin=Depends(require_admin_dep)):
        from seed_replay import wipe_replay
        label = str(body.get("label") or "")
        if not label:
            return {"status": "noop", "reason": "label is required"}
        return await wipe_replay(db, label=label)

    # ── Calibration thermometer (Stage P3.C) ────────────────────────────
    # A thermometer that does not heal. Read-only, admin-only, no UI, no
    # polling surface, no trend theatre. Returns RAW structural counts so
    # operators can periodically check whether cognition is drifting into
    # certainty theatre — closure too eager, patterns too repetitive,
    # silence shrinking.
    #
    # Strict guardrails baked into this endpoint:
    #   • NO composite scores. No `cognition_health: 0.73`. No bands.
    #   • NO auto-threshold actions. Observations are plain-language
    #     strings, never severity-coded, never written anywhere, never
    #     emitting events / logs / suppressions.
    #   • NO trend deltas. Single-window snapshot only. No comparisons
    #     across runs — that path is monitoring, not calibration.
    #   • Calibration must never accidentally become governance.
    @router.get("/calibration")
    async def calibration(
        window_days: int = 30,
        _admin=Depends(require_admin_dep),
    ):
        window_days = max(1, min(int(window_days), 90))
        since = (_now() - timedelta(days=window_days)).isoformat()

        # ── Closure distribution ─────────────────────────────────────────
        # Raw counts only. No ratio band. No "healthy" / "alarming".
        chains_total = await db.causation_chains.count_documents(
            {"created_at": {"$gte": since}},
        )
        chains_closed = await db.causation_chains.count_documents(
            {"created_at": {"$gte": since}, "status": "closed"},
        )
        chains_open = chains_total - chains_closed
        by_state: Dict[str, int] = {s: 0 for s in CHAIN_CLOSURE_STATES}
        closed_rows = await db.causation_chains.find(
            {"created_at": {"$gte": since}, "status": "closed"},
            {"_id": 0, "closure": 1},
        ).to_list(5000)
        for r in closed_rows:
            st = ((r.get("closure") or {}).get("state") or "")
            if st in by_state:
                by_state[st] += 1

        # ── Pattern repetition signal ────────────────────────────────────
        # Not pattern memory — just the rawest possible question: which
        # action_types dominate the suppressed/overridden surface? Used to
        # spot template-style repetition without running the full pattern
        # detector loop.
        suppressed_rows = await db.system_actions_log.find(
            {"created_at": {"$gte": since},
             "status": {"$in": [
                 "blocked_requires_manual", "awaiting_manual_execution",
             ]}},
            {"_id": 0, "action_type": 1},
        ).to_list(5000)
        sup_counter = Counter(
            r.get("action_type") or "unknown" for r in suppressed_rows
        )
        sup_top = sup_counter.most_common(1)
        override_count = await db.cognition_overrides.count_documents(
            {"created_at": {"$gte": since}},
        )

        # ── Silence health ───────────────────────────────────────────────
        # Modules with NO cognition signal in window. Sparse cognition is
        # the calm state. If this number shrinks, the system is seeing
        # signal everywhere.
        modules_total = await db.modules.count_documents({})
        # Set of module_ids that had ANY institution-visible event in window
        active_ids: set = set()
        async for r in db.system_actions_log.find(
            {"entity_type": "module", "created_at": {"$gte": since}},
            {"_id": 0, "entity_id": 1},
        ):
            if r.get("entity_id"):
                active_ids.add(r["entity_id"])
        async for r in db.cognition_overrides.find(
            {"target.entity_type": "module", "created_at": {"$gte": since}},
            {"_id": 0, "target.entity_id": 1},
        ):
            eid = (r.get("target") or {}).get("entity_id")
            if eid:
                active_ids.add(eid)
        async for r in db.cognition_events.find(
            {"created_at": {"$gte": since}},
            {"_id": 0, "module_id": 1},
        ):
            if r.get("module_id"):
                active_ids.add(r["module_id"])
        modules_silent = max(0, modules_total - len(active_ids))

        # ── Observations ─────────────────────────────────────────────────
        # Plain-language strings. No severity. No action. The operator
        # reads them and decides whether to look closer — the system
        # itself does NOTHING with these strings.
        observations: List[str] = []
        if chains_total > 0:
            closed_ratio = chains_closed / chains_total
            if closed_ratio > 0.2:
                observations.append(
                    "closure density above calibration expectation")
            # If the dominant closure state is pressure_dissipated, the
            # decay logic may be too eager — or the system is over-firing
            # signal_collapse without follow-through. Either way: a
            # honest observation, not a verdict.
            if by_state.get("pressure_dissipated", 0) > 0:
                total_closed_with_state = sum(by_state.values())
                if total_closed_with_state > 0 and (
                    by_state["pressure_dissipated"] / total_closed_with_state
                    > 0.6
                ):
                    observations.append(
                        "pressure_dissipated dominates closure distribution")
            # If override_produced_instability never appears across a
            # non-trivial window, override attribution may be too weak.
            if chains_closed >= 10 and by_state.get(
                    "override_produced_instability", 0) == 0:
                observations.append(
                    "no override_produced_instability instances in window")
        if modules_total > 0:
            silence_ratio = modules_silent / modules_total
            if silence_ratio < 0.3:
                observations.append(
                    "silence baseline diminished — cognition signal density rising")
        if sup_top and len(sup_top) > 0 and sup_top[0][1] >= 10:
            observations.append(
                f"action_type '{sup_top[0][0]}' dominates suppression surface")

        return {
            "window_days": window_days,
            "closure": {
                "total_chains": chains_total,
                "open": chains_open,
                "closed": chains_closed,
                "by_state": by_state,
            },
            "patterns_raw": {
                "suppressed_total": len(suppressed_rows),
                "suppressed_top_action_type": (
                    {"action_type": sup_top[0][0],
                     "occurrences": sup_top[0][1]}
                    if sup_top else None
                ),
                "overrides_total": override_count,
            },
            "silence": {
                "modules_total": modules_total,
                "modules_with_cognition_signal_in_window": len(active_ids),
                "modules_silent_in_window": modules_silent,
            },
            "observations": observations,
            "generated_at": _now().isoformat(),
        }

    return router
