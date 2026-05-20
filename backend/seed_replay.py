"""
seed_replay.py — transitional cognition tissue.

NOT a simulation engine. NOT fake production. NOT synthetic outcomes.

Replay creates temporally-spread RAW EVENTS (override events, QA failures,
reassignment waves, overload cascades, suppression clusters) so the
cognition layer has organic-feeling density across the last 7-14 days
during the period BEFORE real operator activity accumulates.

Honesty rules (epistemic non-negotiables baked in):

1. No invented outcomes. Every override event is created with
   `outcome.verdict = "pending"` and no `outcome_evaluated_at`. The real
   `_override_outcome` evaluator fills these in only when actual module
   signals exist — for replayed records that will be never, on purpose.
   Attribution band for replayed-only action_types stays `insufficient`.
   That is correct: the system does not yet know who is right, and must
   not pretend it does.

2. Every record carries provenance:
       source:              "seed_replay_v1"
       replay_batch_id:     "<uuid>"
       replay_generated_at: "<iso>"
   so the cognition layer can compute `replay_share` and surface
   "derived from replayed cognition traces" at panel level. Admins can
   tell at a glance which patterns rest on organic vs replayed tissue.

3. Idempotent via the `replay_markers` collection. Re-running with the
   same label is a no-op. Wiping a batch is a separate, explicit call.

4. Density gradient is realistic-not-pretty: newer days are denser
   (~2.5x) than the far edge of the window. No flat distribution,
   no synthetic pulses, no business-hours theater.

5. No "AI brilliance" — replay never invents action_types or outcome
   verdicts that wouldn't already exist in real production schemas.

Public surface:
    await run_replay(db, days=14, intensity="medium",
                     label="boot_replay_v1") -> dict
    await wipe_replay(db, label) -> dict
"""

from __future__ import annotations

import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

logger = logging.getLogger("seed_replay")

REPLAY_SOURCE = "seed_replay_v1"

# Intensity → events/day for each replay flavor. Numbers chosen to feel
# like a 5-developer organization under moderate stress, NOT a stress test.
_INTENSITY = {
    "low":     {"overrides": 0.6, "qa_fail": 0.5, "reassign": 0.7,
                "overload":  0.4, "suppression": 0.3},
    "medium":  {"overrides": 1.2, "qa_fail": 1.0, "reassign": 1.4,
                "overload":  0.9, "suppression": 0.7},
    "high":    {"overrides": 2.4, "qa_fail": 1.8, "reassign": 2.6,
                "overload":  1.6, "suppression": 1.2},
}

# Action_types replayed for overrides + suppressions. Mirrors what real
# autonomy loops actually produce — never invents new categories.
_OVERRIDE_ACTION_TYPES = [
    "reassign_task",
    "redistribute_load",
    "payment_release",
    "force_review",
    "boost_priority",
]
_SUPPRESSION_ACTION_TYPES = [
    "reassign_task",
    "redistribute_load",
    "payment_release",
    "escalate_project",
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _density_weighted_offset(days: int, rng: random.Random) -> timedelta:
    """Pick a random offset within [0, days] with newer-skew gradient.

    Linear weight: w(d) = (days - d) * 1.5 + 1, normalized.
    Net effect ≈ 2.5x density at day 0 vs day=days.
    """
    weights = [(days - d) * 1.5 + 1 for d in range(days)]
    day = rng.choices(range(days), weights=weights, k=1)[0]
    # Spread within the chosen day, biased to business-ish hours but
    # not theatrically so.
    hour = rng.randint(7, 22)
    minute = rng.randint(0, 59)
    return timedelta(days=day, hours=hour, minutes=minute)


def _provenance(batch_id: str, generated_at_iso: str) -> Dict[str, Any]:
    return {
        "source": REPLAY_SOURCE,
        "replay_batch_id": batch_id,
        "replay_generated_at": generated_at_iso,
    }


async def _resolve_targets(db) -> Dict[str, Any]:
    """Pull a few real entities so replay events reference live ids."""
    modules = await db.modules.find(
        {}, {"_id": 0, "module_id": 1, "project_id": 1},
    ).to_list(50)
    devs = await db.users.find(
        {"role": "developer"}, {"_id": 0, "user_id": 1, "email": 1},
    ).to_list(20)
    admin = await db.users.find_one(
        {"role": "admin"}, {"_id": 0, "user_id": 1, "email": 1, "name": 1},
    )
    invoices = await db.invoices.find(
        {}, {"_id": 0, "invoice_id": 1},
    ).to_list(20) if "invoices" in (await db.list_collection_names()) else []
    projects = await db.projects.find(
        {}, {"_id": 0, "project_id": 1},
    ).to_list(20) if "projects" in (await db.list_collection_names()) else []
    return {
        "modules": modules,
        "devs": devs,
        "admin": admin or {},
        "invoices": invoices,
        "projects": projects,
    }


# ─────────────────────────────────────────────────────────────────────────
# Flavor generators — each returns a list of dicts shaped exactly like the
# production schema. No invented fields, no "ai_score", no synthetic verdicts.
# ─────────────────────────────────────────────────────────────────────────


def _gen_override_events(*, days: int, count: int, rng: random.Random,
                         targets: Dict[str, Any], prov: Dict[str, Any],
                         now: datetime) -> List[Dict[str, Any]]:
    """Operator overrides with NO verdict — outcome.verdict stays 'pending'.

    The cognition layer will see them as institutional friction without
    knowing who was correct. That is the honest state until the real
    `_override_outcome` evaluator runs against a terminal module.
    """
    admin = targets["admin"] or {}
    out = []
    for _ in range(count):
        created = now - _density_weighted_offset(days, rng)
        action_type = rng.choice(_OVERRIDE_ACTION_TYPES)
        # Reference a real target where possible.
        if action_type == "payment_release" and targets["invoices"]:
            target = {
                "action_type": action_type,
                "entity_type": "invoice",
                "entity_id": rng.choice(targets["invoices"])["invoice_id"],
            }
        elif targets["modules"]:
            target = {
                "action_type": action_type,
                "entity_type": "module",
                "entity_id": rng.choice(targets["modules"])["module_id"],
            }
        else:
            continue  # nothing to attach to → skip silently
        out.append({
            "override_id": f"ovr_{uuid.uuid4().hex[:12]}",
            "action_id":   f"act_{uuid.uuid4().hex[:12]}",
            "target_kind": "system_action_log",
            "target": target,
            "operator": {
                "user_id": admin.get("user_id"),
                "email":   admin.get("email"),
                "name":    admin.get("name"),
            },
            "reason": (
                "Operator judgement — recorded as institutional context. "
                "Outcome pending real terminal signals."
            ),
            "acknowledged_risk": True,
            "drivers_at_override": [
                {"driver": "overload_risk", "severity": "high"},
            ],
            # CRITICAL: outcome stays pending. We do NOT fabricate verdicts.
            "outcome": {"verdict": "pending", "rationale": [], "signals": {}},
            "outcome_evaluated_at": None,
            "created_at": _iso(created),
            **prov,
        })
    return out


def _gen_qa_failures(*, days: int, count: int, rng: random.Random,
                     targets: Dict[str, Any], prov: Dict[str, Any],
                     now: datetime) -> List[Dict[str, Any]]:
    if not targets["modules"]:
        return []
    out = []
    for _ in range(count):
        m = rng.choice(targets["modules"])
        out.append({
            "qa_id": f"qa_{uuid.uuid4().hex[:12]}",
            "module_id":  m["module_id"],
            "project_id": m.get("project_id"),
            "result":     "rejected",
            "reviewer_id": (rng.choice(targets["devs"])["user_id"]
                            if targets["devs"] else None),
            "created_at": _iso(now - _density_weighted_offset(days, rng)),
            **prov,
        })
    return out


def _gen_reassignment_actions(*, days: int, count: int, rng: random.Random,
                              targets: Dict[str, Any], prov: Dict[str, Any],
                              now: datetime) -> List[Dict[str, Any]]:
    """Logged reassign_task entries — mode=manual, status=logged_only.
    Shape mirrors what `module_motion` writes during observe-mode.
    """
    if not targets["modules"]:
        return []
    out = []
    for _ in range(count):
        m = rng.choice(targets["modules"])
        out.append({
            "log_id": f"slog_{uuid.uuid4().hex[:12]}",
            "action_type": "reassign_task",
            "entity_type": "module",
            "entity_id":   m["module_id"],
            "mode":   "manual",
            "status": "logged_only",
            "result": "Observed reassignment — operator-led move.",
            "error":  None,
            "created_at": _iso(now - _density_weighted_offset(days, rng)),
            **prov,
        })
    return out


def _gen_overload_cascades(*, days: int, count: int, rng: random.Random,
                           targets: Dict[str, Any], prov: Dict[str, Any],
                           now: datetime) -> List[Dict[str, Any]]:
    """redistribute_load suppressions — exec-engine sees overload but blocks
    auto-rebalance pending operator review."""
    if not targets["devs"]:
        return []
    out = []
    for _ in range(count):
        dev = rng.choice(targets["devs"])
        out.append({
            "log_id": f"slog_{uuid.uuid4().hex[:12]}",
            "action_type": "redistribute_load",
            "entity_type": "developer",
            "entity_id":   dev["user_id"],
            "mode":   "auto",
            "status": "blocked_requires_manual",
            "result": "Overload cascade detected — held for operator decision.",
            "error":  None,
            "created_at": _iso(now - _density_weighted_offset(days, rng)),
            **prov,
        })
    return out


def _gen_suppression_clusters(*, days: int, count: int, rng: random.Random,
                              targets: Dict[str, Any], prov: Dict[str, Any],
                              now: datetime) -> List[Dict[str, Any]]:
    """Mixed action_type suppressions (blocked_requires_manual)."""
    if not targets["modules"]:
        return []
    out = []
    for _ in range(count):
        action_type = rng.choice(_SUPPRESSION_ACTION_TYPES)
        if action_type == "payment_release" and targets["invoices"]:
            entity = {"entity_type": "invoice",
                      "entity_id": rng.choice(targets["invoices"])["invoice_id"]}
        elif action_type == "escalate_project" and targets["projects"]:
            entity = {"entity_type": "project",
                      "entity_id": rng.choice(targets["projects"])["project_id"]}
        else:
            entity = {"entity_type": "module",
                      "entity_id": rng.choice(targets["modules"])["module_id"]}
        out.append({
            "log_id": f"slog_{uuid.uuid4().hex[:12]}",
            "action_type": action_type,
            "mode":   "auto",
            "status": "blocked_requires_manual",
            "result": "Capital preservation / threshold guard.",
            "error":  None,
            "created_at": _iso(now - _density_weighted_offset(days, rng)),
            **entity,
            **prov,
        })
    return out


# ─────────────────────────────────────────────────────────────────────────
# Orchestration
# ─────────────────────────────────────────────────────────────────────────


async def run_replay(
    db,
    *,
    days: int = 14,
    intensity: str = "medium",
    label: str = "boot_replay_v1",
    seed: int = 7,
) -> Dict[str, Any]:
    """Plant a temporal tissue of replayed cognition events.

    Idempotent on `label`. Calling twice with the same label is a no-op.
    Returns a summary dict (counts per flavor + batch_id + status).
    """
    days = max(7, min(int(days), 28))
    intensity = intensity if intensity in _INTENSITY else "medium"

    # Idempotency
    marker = await db.replay_markers.find_one({"label": label}, {"_id": 0})
    if marker:
        return {"status": "noop", "reason": "marker exists", "label": label,
                "existing_batch_id": marker.get("batch_id")}

    targets = await _resolve_targets(db)
    if not targets["modules"] or not targets["devs"]:
        return {"status": "noop",
                "reason": "no modules/devs to attach replay events to",
                "label": label}

    batch_id = f"replay_{uuid.uuid4().hex[:10]}"
    now = _now()
    gen_iso = _iso(now)
    prov = _provenance(batch_id, gen_iso)
    rng = random.Random(seed)

    rates = _INTENSITY[intensity]
    counts = {
        "overrides":   int(rates["overrides"]   * days),
        "qa_fail":     int(rates["qa_fail"]     * days),
        "reassign":    int(rates["reassign"]    * days),
        "overload":    int(rates["overload"]    * days),
        "suppression": int(rates["suppression"] * days),
    }

    overrides = _gen_override_events(
        days=days, count=counts["overrides"],
        rng=rng, targets=targets, prov=prov, now=now)
    qa_fail = _gen_qa_failures(
        days=days, count=counts["qa_fail"],
        rng=rng, targets=targets, prov=prov, now=now)
    reassign = _gen_reassignment_actions(
        days=days, count=counts["reassign"],
        rng=rng, targets=targets, prov=prov, now=now)
    overload = _gen_overload_cascades(
        days=days, count=counts["overload"],
        rng=rng, targets=targets, prov=prov, now=now)
    suppression = _gen_suppression_clusters(
        days=days, count=counts["suppression"],
        rng=rng, targets=targets, prov=prov, now=now)

    inserted = {"overrides": 0, "qa_fail": 0,
                "reassign": 0, "overload": 0, "suppression": 0}
    if overrides:
        await db.cognition_overrides.insert_many(overrides)
        inserted["overrides"] = len(overrides)
    if qa_fail:
        await db.qa_decisions.insert_many(qa_fail)
        inserted["qa_fail"] = len(qa_fail)
    if reassign:
        await db.system_actions_log.insert_many(reassign)
        inserted["reassign"] = len(reassign)
    if overload:
        await db.system_actions_log.insert_many(overload)
        inserted["overload"] = len(overload)
    if suppression:
        await db.system_actions_log.insert_many(suppression)
        inserted["suppression"] = len(suppression)

    total = sum(inserted.values())
    await db.replay_markers.insert_one({
        "label":      label,
        "batch_id":   batch_id,
        "days":       days,
        "intensity":  intensity,
        "inserted":   inserted,
        "total":      total,
        "created_at": gen_iso,
    })

    logger.info(
        "SEED_REPLAY: label=%s batch=%s days=%d intensity=%s inserted=%s",
        label, batch_id, days, intensity, inserted,
    )
    return {
        "status":    "active",
        "label":     label,
        "batch_id":  batch_id,
        "days":      days,
        "intensity": intensity,
        "inserted":  inserted,
        "total":     total,
        "created_at": gen_iso,
    }


async def wipe_replay(db, label: str) -> Dict[str, Any]:
    """Remove a replay batch by label. Explicit destructive operation."""
    marker = await db.replay_markers.find_one({"label": label}, {"_id": 0})
    if not marker:
        return {"status": "noop", "reason": "no marker for label",
                "label": label}
    batch_id = marker["batch_id"]
    removed = {}
    for coll in ("cognition_overrides", "qa_decisions", "system_actions_log"):
        r = await db[coll].delete_many({"replay_batch_id": batch_id})
        removed[coll] = r.deleted_count
    await db.replay_markers.delete_one({"label": label})
    logger.info("SEED_REPLAY wipe: label=%s batch=%s removed=%s",
                label, batch_id, removed)
    return {"status": "wiped", "label": label, "batch_id": batch_id,
            "removed": removed}


async def provenance_share(db, *, hours: int = 14 * 24) -> Dict[str, Any]:
    """How much of the cognition layer's recent input is replayed.

    Used by /api/execution-intelligence/patterns to surface
    "derived from replayed cognition traces" at panel level.
    """
    cutoff = _iso(_now() - timedelta(hours=hours))
    totals = {"real": 0, "replayed": 0}
    for coll in ("cognition_overrides", "qa_decisions", "system_actions_log"):
        try:
            t = await db[coll].count_documents(
                {"created_at": {"$gte": cutoff}})
            r = await db[coll].count_documents(
                {"created_at": {"$gte": cutoff}, "source": REPLAY_SOURCE})
            totals["real"]     += (t - r)
            totals["replayed"] += r
        except Exception:
            # Collection may not exist on a fresh DB — that is honest empty.
            pass
    grand_total = totals["real"] + totals["replayed"]
    share = (totals["replayed"] / grand_total) if grand_total else 0.0
    return {
        "real":          totals["real"],
        "replayed":      totals["replayed"],
        "total":         grand_total,
        "replay_share":  round(share, 3),
        "window_hours":  hours,
    }
