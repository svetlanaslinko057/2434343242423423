"""
BLOCK 3 — TEAM LAYER
--------------------
Module → N developers with roles (owner / executor).
Pure business logic + DB ops. No HTTP.

Invariants (enforced on every mutation):
  • Σ allocation     ≤ 1.0        (module can't be overloaded)
  • Σ responsibility = 1.0        (money fully distributed, ±0.001 tolerance)
  • exactly 1 owner  per active module
  • dev.active_load  ≤ dev.capacity (typically 1.0)

Shape of `module_assignments` document:
  {
    assignment_id, module_id, developer_id,
    role: "owner" | "executor",
    allocation: float (0..1),
    responsibility: float (0..1),
    status: "active" | "removed",
    joined_at, removed_at, assigned_by
  }
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Any

ROLE_OWNER = "owner"
ROLE_EXECUTOR = "executor"
VALID_ROLES = (ROLE_OWNER, ROLE_EXECUTOR)

DEFAULT_CAPACITY = 1.0
RESP_TOLERANCE = 0.001


# ========== INVARIANTS ==========

class TeamInvariantError(Exception):
    pass


def validate_team_spec(members: list[dict]) -> None:
    """
    members: [{developer_id, role, allocation, responsibility}, ...]
    Raises TeamInvariantError on any violation.
    """
    if not members:
        raise TeamInvariantError("Team must have at least 1 member")

    owners = [m for m in members if m.get("role") == ROLE_OWNER]
    if len(owners) != 1:
        raise TeamInvariantError(
            f"Team must have exactly 1 owner, got {len(owners)}"
        )

    seen = set()
    total_alloc = 0.0
    total_resp = 0.0
    for m in members:
        dev_id = m.get("developer_id")
        if not dev_id:
            raise TeamInvariantError("developer_id required for every member")
        if dev_id in seen:
            raise TeamInvariantError(f"Duplicate developer_id: {dev_id}")
        seen.add(dev_id)
        if m.get("role") not in VALID_ROLES:
            raise TeamInvariantError(f"Invalid role: {m.get('role')}")
        a = float(m.get("allocation", 0))
        r = float(m.get("responsibility", 0))
        if a <= 0 or a > 1:
            raise TeamInvariantError(
                f"allocation must be in (0, 1], got {a} for {dev_id}"
            )
        if r <= 0 or r > 1:
            raise TeamInvariantError(
                f"responsibility must be in (0, 1], got {r} for {dev_id}"
            )
        total_alloc += a
        total_resp += r

    if total_alloc > 1.0 + RESP_TOLERANCE:
        raise TeamInvariantError(
            f"Σ allocation must be ≤ 1.0, got {total_alloc:.3f}"
        )
    if abs(total_resp - 1.0) > RESP_TOLERANCE:
        raise TeamInvariantError(
            f"Σ responsibility must equal 1.0, got {total_resp:.3f}"
        )


# ========== DEV LOAD ==========

async def compute_dev_load(db, developer_id: str) -> float:
    """Sum of allocations across all active assignments for dev."""
    total = 0.0
    async for a in db.module_assignments.find(
        {"developer_id": developer_id, "status": "active"}, {"_id": 0}
    ):
        total += float(a.get("allocation", 0))
    return round(total, 3)


async def can_accept_allocation(
    db, developer_id: str, extra_allocation: float
) -> tuple[bool, float, float]:
    """Returns (ok, current_load, capacity)."""
    dev = await db.users.find_one({"user_id": developer_id}, {"_id": 0})
    if not dev:
        return (False, 0.0, 0.0)
    capacity = float(dev.get("capacity", DEFAULT_CAPACITY))
    current = await compute_dev_load(db, developer_id)
    return (
        current + extra_allocation <= capacity + RESP_TOLERANCE,
        current,
        capacity,
    )


async def refresh_dev_load_field(db, developer_id: str) -> float:
    """Recompute dev.active_load and persist (fractional version)."""
    load = await compute_dev_load(db, developer_id)
    await db.users.update_one(
        {"user_id": developer_id},
        {"$set": {"team_load": load}},
    )
    return load


# ========== ASSIGN TEAM ==========

async def assign_team(
    db,
    module_id: str,
    members: list[dict],
    assigned_by: str,
    emit_event=None,
) -> dict:
    """
    Create team for module. Replaces any pre-existing active assignments.
    Returns {module_id, team: [...]}.
    """
    module = await db.modules.find_one({"module_id": module_id}, {"_id": 0})
    if not module:
        raise TeamInvariantError(f"Module not found: {module_id}")

    validate_team_spec(members)

    # Capacity check (sum of EXISTING load + new allocation for each dev)
    for m in members:
        ok, current, cap = await can_accept_allocation(
            db, m["developer_id"], float(m["allocation"])
        )
        if not ok:
            raise TeamInvariantError(
                f"Developer {m['developer_id']} over capacity "
                f"(current={current:.2f}, cap={cap:.2f}, "
                f"adding={m['allocation']})"
            )

    # Remove any existing active assignments for this module (replace)
    prev = await db.module_assignments.find(
        {"module_id": module_id, "status": "active"}, {"_id": 0}
    ).to_list(100)
    prev_dev_ids = [p["developer_id"] for p in prev]
    if prev:
        await db.module_assignments.update_many(
            {"module_id": module_id, "status": "active"},
            {
                "$set": {
                    "status": "removed",
                    "removed_at": _now_iso(),
                    "removed_reason": "team_replaced",
                }
            },
        )

    # Insert new assignments
    now = _now_iso()
    docs = []
    owner_id = None
    for m in members:
        doc = {
            "assignment_id": f"tasn_{uuid.uuid4().hex[:12]}",
            "module_id": module_id,
            "developer_id": m["developer_id"],
            "role": m["role"],
            "allocation": round(float(m["allocation"]), 3),
            "responsibility": round(float(m["responsibility"]), 3),
            "status": "active",
            "joined_at": now,
            "assigned_by": assigned_by,
        }
        if m["role"] == ROLE_OWNER:
            owner_id = m["developer_id"]
        docs.append(doc)
    await db.module_assignments.insert_many([{**d} for d in docs])

    # Mirror owner on module (backward compat with assigned_to)
    await db.modules.update_one(
        {"module_id": module_id},
        {
            "$set": {
                "assigned_to": owner_id,
                "team_size": len(docs),
                "last_team_updated_at": now,
            }
        },
    )

    # Refresh loads for all affected devs
    affected = set(prev_dev_ids) | {m["developer_id"] for m in members}
    for dev_id in affected:
        await refresh_dev_load_field(db, dev_id)

    if emit_event:
        await emit_event(
            "team:assigned",
            {
                "module_id": module_id,
                "team_size": len(docs),
                "owner_id": owner_id,
                "assigned_by": assigned_by,
            },
        )

    return {"module_id": module_id, "team": [_clean(d) for d in docs]}


async def remove_assignment(
    db,
    assignment_id: str,
    removed_by: str,
    emit_event=None,
) -> dict:
    """
    Remove one team member. If owner removed, auto-promote executor with
    highest responsibility.
    """
    a = await db.module_assignments.find_one(
        {"assignment_id": assignment_id, "status": "active"}, {"_id": 0}
    )
    if not a:
        raise TeamInvariantError("Assignment not found or not active")

    module_id = a["module_id"]
    was_owner = a["role"] == ROLE_OWNER
    dev_id = a["developer_id"]

    await db.module_assignments.update_one(
        {"assignment_id": assignment_id},
        {
            "$set": {
                "status": "removed",
                "removed_at": _now_iso(),
                "removed_by": removed_by,
            }
        },
    )

    new_owner_id = None
    if was_owner:
        # Promote executor with highest responsibility
        remaining = await db.module_assignments.find(
            {"module_id": module_id, "status": "active"}, {"_id": 0}
        ).sort("responsibility", -1).to_list(100)
        if remaining:
            new_owner = remaining[0]
            await db.module_assignments.update_one(
                {"assignment_id": new_owner["assignment_id"]},
                {"$set": {"role": ROLE_OWNER}},
            )
            new_owner_id = new_owner["developer_id"]
            await db.modules.update_one(
                {"module_id": module_id}, {"$set": {"assigned_to": new_owner_id}}
            )
        else:
            # No one left
            await db.modules.update_one(
                {"module_id": module_id},
                {"$set": {"assigned_to": None, "team_size": 0}},
            )

    # Update team_size
    still_active = await db.module_assignments.count_documents(
        {"module_id": module_id, "status": "active"}
    )
    await db.modules.update_one(
        {"module_id": module_id}, {"$set": {"team_size": still_active}}
    )

    # Refresh dev load
    await refresh_dev_load_field(db, dev_id)

    if emit_event:
        await emit_event(
            "team:member_removed",
            {
                "module_id": module_id,
                "developer_id": dev_id,
                "was_owner": was_owner,
                "new_owner_id": new_owner_id,
                "removed_by": removed_by,
            },
        )
        if new_owner_id:
            await emit_event(
                "team:owner_changed",
                {
                    "module_id": module_id,
                    "previous_owner_id": dev_id,
                    "new_owner_id": new_owner_id,
                },
            )

    return {
        "assignment_id": assignment_id,
        "module_id": module_id,
        "new_owner_id": new_owner_id,
    }


# ========== READ ==========

async def get_module_team(db, module_id: str) -> dict:
    """Return active assignments enriched with dev info."""
    module = await db.modules.find_one({"module_id": module_id}, {"_id": 0})
    if not module:
        return {"module_id": module_id, "team": [], "module": None}

    assignments = await db.module_assignments.find(
        {"module_id": module_id, "status": "active"}, {"_id": 0}
    ).to_list(100)

    dev_ids = list({a["developer_id"] for a in assignments})
    devs = {}
    if dev_ids:
        async for u in db.users.find(
            {"user_id": {"$in": dev_ids}},
            {
                "_id": 0,
                "user_id": 1,
                "name": 1,
                "email": 1,
                "level": 1,
                "rating": 1,
                "skills": 1,
            },
        ):
            devs[u["user_id"]] = u

    team = []
    for a in assignments:
        dev = devs.get(a["developer_id"], {})
        team.append(
            {
                **a,
                "developer": {
                    "user_id": dev.get("user_id"),
                    "name": dev.get("name"),
                    "level": dev.get("level"),
                    "rating": dev.get("rating"),
                    "skills": dev.get("skills", []),
                },
            }
        )

    # Put owner first
    team.sort(key=lambda x: (x["role"] != ROLE_OWNER, -float(x.get("responsibility", 0))))

    total_alloc = round(sum(float(a.get("allocation", 0)) for a in assignments), 3)
    total_resp = round(sum(float(a.get("responsibility", 0)) for a in assignments), 3)

    return {
        "module_id": module_id,
        "module_title": module.get("title"),
        "module_status": module.get("status"),
        "module_price": module.get("final_price") or module.get("price") or 0,
        "team": team,
        "team_size": len(team),
        "total_allocation": total_alloc,
        "total_responsibility": total_resp,
        "has_owner": any(a["role"] == ROLE_OWNER for a in assignments),
    }


async def get_dev_teams(db, developer_id: str) -> list[dict]:
    """All modules where dev is on the team."""
    assignments = await db.module_assignments.find(
        {"developer_id": developer_id, "status": "active"}, {"_id": 0}
    ).to_list(100)
    if not assignments:
        return []

    module_ids = [a["module_id"] for a in assignments]
    modules = {}
    async for m in db.modules.find(
        {"module_id": {"$in": module_ids}},
        {
            "_id": 0,
            "module_id": 1,
            "title": 1,
            "status": 1,
            "final_price": 1,
            "price": 1,
            "project_id": 1,
        },
    ):
        modules[m["module_id"]] = m

    # Co-members for each module
    result = []
    for a in assignments:
        mod = modules.get(a["module_id"], {})
        co_members = await db.module_assignments.find(
            {
                "module_id": a["module_id"],
                "status": "active",
                "developer_id": {"$ne": developer_id},
            },
            {"_id": 0, "developer_id": 1, "role": 1, "responsibility": 1},
        ).to_list(100)
        co_dev_ids = [c["developer_id"] for c in co_members]
        co_devs = {}
        if co_dev_ids:
            async for u in db.users.find(
                {"user_id": {"$in": co_dev_ids}},
                {"_id": 0, "user_id": 1, "name": 1},
            ):
                co_devs[u["user_id"]] = u.get("name", "Unknown")
        co_members_out = [
            {
                "developer_id": c["developer_id"],
                "name": co_devs.get(c["developer_id"], "Unknown"),
                "role": c["role"],
            }
            for c in co_members
        ]
        price = mod.get("final_price") or mod.get("price") or 0
        result.append(
            {
                "module_id": a["module_id"],
                "module_title": mod.get("title"),
                "module_status": mod.get("status"),
                "project_id": mod.get("project_id"),
                "module_price": price,
                "my_role": a["role"],
                "my_allocation": a["allocation"],
                "my_responsibility": a["responsibility"],
                "my_potential_earnings": round(
                    float(price) * float(a["responsibility"]), 2
                ),
                "co_members": co_members_out,
            }
        )
    return result


# ========== EARNINGS ==========

async def compute_dev_earnings_for_module(
    db, module_id: str, developer_id: str
) -> dict:
    """
    dev.earned = module.price × Σ(task.share) × assignment.responsibility

    task.share = completed_tasks_for_dev / total_tasks_in_module
    (if no tasks linked, fall back to 1.0 so dev gets full responsibility share)
    """
    a = await db.module_assignments.find_one(
        {"module_id": module_id, "developer_id": developer_id, "status": "active"},
        {"_id": 0},
    )
    if not a:
        return {
            "module_id": module_id,
            "developer_id": developer_id,
            "earned": 0.0,
            "reason": "not_on_team",
        }

    mod = await db.modules.find_one({"module_id": module_id}, {"_id": 0})
    if not mod:
        return {
            "module_id": module_id,
            "developer_id": developer_id,
            "earned": 0.0,
            "reason": "module_not_found",
        }

    price = float(mod.get("final_price") or mod.get("price") or 0)
    responsibility = float(a.get("responsibility", 0))

    # Count tasks
    all_tasks = await db.work_units.count_documents({"module_id": module_id})
    if all_tasks == 0:
        task_share = 1.0
        completed_by_dev = 0
    else:
        completed_by_dev = await db.work_units.count_documents(
            {
                "module_id": module_id,
                "assigned_to": developer_id,
                "status": {"$in": ["completed", "done", "submitted"]},
            }
        )
        task_share = completed_by_dev / all_tasks if all_tasks else 1.0

    earned = round(price * task_share * responsibility, 2)
    return {
        "module_id": module_id,
        "developer_id": developer_id,
        "module_price": price,
        "responsibility": responsibility,
        "task_share": round(task_share, 3),
        "completed_tasks": completed_by_dev,
        "total_tasks": all_tasks,
        "earned": earned,
    }


# ========== TEAM SUGGESTION ==========

async def suggest_team(db, module_id: str, size: int = 2) -> dict:
    """
    Build default team suggestion. Uses Intelligence Layer Quality (4.1) +
    Reliability (4.2) combined score (quality×0.6 + reliability×0.4).

    Gating:
      owner    → quality ≥ 70  AND reliability ≥ 65
      executor → quality ≥ 40  AND reliability ≥ 40
      exclude  → quality < 30  OR  reliability < 30   (high/medium confidence only)
    """
    size = max(1, min(int(size or 2), 5))

    # Pull devs with spare capacity + IL signals
    devs = await db.users.find(
        {"role": "developer"},
        {
            "_id": 0, "user_id": 1, "name": 1, "rating": 1, "level": 1,
            "skills": 1, "quality_score": 1, "quality_band": 1,
            "quality_confidence": 1, "reliability_score": 1,
            "reliability_band": 1, "combined_score": 1,
        },
    ).to_list(200)

    enriched = []
    for d in devs:
        load = await compute_dev_load(db, d["user_id"])
        cap = float(d.get("capacity", DEFAULT_CAPACITY))
        spare = cap - load
        if spare <= 0.05:
            continue

        quality = float(d.get("quality_score") or 50.0)
        reliability = float(d.get("reliability_score") or 50.0)
        confidence = d.get("quality_confidence") or "low"

        # Exclusion (only when confident)
        if confidence != "low":
            if quality < 30 or reliability < 30:
                continue

        # Combined score for ranking (always)
        combined = (
            d.get("combined_score")
            if d.get("combined_score") is not None
            else quality * 0.6 + reliability * 0.4
        )

        enriched.append(
            {
                **d,
                "current_load": load,
                "spare_capacity": round(spare, 3),
                "quality": quality,
                "reliability": reliability,
                "combined": combined,
                "confidence": confidence,
                # Ranking uses combined always; spare breaks ties
                "score": combined + spare * 5.0,
            }
        )

    enriched.sort(key=lambda x: x["score"], reverse=True)

    # Owner selection: must pass both gates when confident; else give-benefit-of-doubt
    owner_candidate = None
    for e in enriched:
        if e["confidence"] == "low":
            owner_candidate = e
            break
        if e["quality"] >= 70 and e["reliability"] >= 65:
            owner_candidate = e
            break
    if not owner_candidate and enriched:
        owner_candidate = enriched[0]

    pick = [owner_candidate] if owner_candidate else []
    for e in enriched:
        if len(pick) >= size:
            break
        if e is owner_candidate:
            continue
        # Executor gate
        if e["confidence"] != "low":
            if e["quality"] < 40 or e["reliability"] < 40:
                continue
        pick.append(e)

    if not pick:
        return {"module_id": module_id, "members": [], "reason": "no_eligible_devs"}

    # Responsibility distribution: owner 60% / rest split
    n = len(pick)
    if n == 1:
        resp_dist = [1.0]
        alloc_dist = [min(pick[0]["spare_capacity"], 0.75)]
    else:
        owner_resp = 0.60
        rest = (1.0 - owner_resp) / (n - 1)
        resp_dist = [owner_resp] + [rest] * (n - 1)
        alloc_dist = []
        for p, r in zip(pick, resp_dist):
            target = round(r * 0.75, 3)
            alloc_dist.append(min(target, p["spare_capacity"]))

    members = []
    for idx, (dev, resp, alloc) in enumerate(zip(pick, resp_dist, alloc_dist)):
        role = ROLE_OWNER if idx == 0 else ROLE_EXECUTOR
        q = dev["quality"]
        r_s = dev["reliability"]
        conf = dev["confidence"]
        if conf == "low":
            fit = f"Rating {dev.get('rating', 5.0)} · Q:new · R:new"
        else:
            q_band = (
                "strong" if q >= 80 else "stable" if q >= 60
                else "weak" if q >= 40 else "risk"
            )
            r_band = (
                "reliable" if r_s >= 80 else "normal" if r_s >= 60
                else "unstable" if r_s >= 40 else "unreliable"
            )
            fit = f"Q{q:.0f} ({q_band}) · R{r_s:.0f} ({r_band})"
        members.append(
            {
                "developer_id": dev["user_id"],
                "name": dev.get("name", "Unknown"),
                "level": dev.get("level"),
                "rating": dev.get("rating"),
                "quality_score": round(q, 1),
                "reliability_score": round(r_s, 1),
                "combined_score": round(dev["combined"], 1),
                "quality_confidence": conf,
                "current_load": dev["current_load"],
                "role": role,
                "allocation": round(alloc, 3),
                "responsibility": round(resp, 3),
                "fit_reason": fit,
            }
        )

    total_r = sum(m["responsibility"] for m in members)
    if abs(total_r - 1.0) > RESP_TOLERANCE and members:
        diff = 1.0 - total_r
        members[0]["responsibility"] = round(members[0]["responsibility"] + diff, 3)

    return {"module_id": module_id, "members": members}


# ========== TASK DISTRIBUTION ==========

async def distribute_tasks(
    db,
    module_id: str,
    strategy: str = "by_responsibility",
    emit_event=None,
) -> dict:
    """
    Assign existing unassigned work_units inside module to team members.
    Strategies:
      • round_robin       — even distribution
      • by_responsibility — proportional to responsibility share
    """
    assignments = await db.module_assignments.find(
        {"module_id": module_id, "status": "active"}, {"_id": 0}
    ).to_list(100)
    if not assignments:
        raise TeamInvariantError("No active team for this module")

    units = await db.work_units.find(
        {
            "module_id": module_id,
            "$or": [{"assigned_to": None}, {"assigned_to": {"$exists": False}}],
        },
        {"_id": 0},
    ).to_list(500)

    if not units:
        return {"module_id": module_id, "distributed": 0, "strategy": strategy}

    # Build slot list based on strategy
    slots = []
    if strategy == "round_robin":
        while len(slots) < len(units):
            for a in assignments:
                slots.append(a["developer_id"])
                if len(slots) >= len(units):
                    break
    else:
        # Proportional: count slots per dev = round(responsibility * total)
        total = len(units)
        counts = {}
        accum = 0
        for a in assignments[:-1]:
            c = int(round(a["responsibility"] * total))
            counts[a["developer_id"]] = c
            accum += c
        counts[assignments[-1]["developer_id"]] = max(0, total - accum)
        for dev_id, cnt in counts.items():
            slots.extend([dev_id] * cnt)
        # Pad if short
        while len(slots) < len(units):
            slots.append(assignments[0]["developer_id"])

    distributed = 0
    for unit, dev_id in zip(units, slots):
        await db.work_units.update_one(
            {"unit_id": unit["unit_id"]},
            {
                "$set": {
                    "assigned_to": dev_id,
                    "status": "assigned",
                    "assigned_at": _now_iso(),
                }
            },
        )
        distributed += 1

    if emit_event:
        await emit_event(
            "team:tasks_distributed",
            {
                "module_id": module_id,
                "count": distributed,
                "strategy": strategy,
            },
        )

    return {
        "module_id": module_id,
        "distributed": distributed,
        "strategy": strategy,
    }


# ========== HELPERS ==========

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(doc: dict) -> dict:
    """Strip Mongo internals for safe JSON response."""
    out = {k: v for k, v in doc.items() if k != "_id"}
    return out


async def ensure_indexes(db) -> None:
    """Idempotent index setup."""
    await db.module_assignments.create_index(
        [("module_id", 1), ("status", 1)]
    )
    await db.module_assignments.create_index(
        [("developer_id", 1), ("status", 1)]
    )
    await db.module_assignments.create_index("assignment_id", unique=True)
