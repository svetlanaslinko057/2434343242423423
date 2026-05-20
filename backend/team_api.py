"""
BLOCK 3 — TEAM API endpoints.
Mounted via fastapi_app.include_router(team_api.build_router(...)).
"""
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel, Field
from typing import Optional
import uuid
from datetime import datetime, timezone

import team_layer


# ========== REQUEST MODELS ==========

class TeamMemberSpec(BaseModel):
    developer_id: str
    role: str = Field(pattern="^(owner|executor)$")
    allocation: float = Field(gt=0, le=1)
    responsibility: float = Field(gt=0, le=1)


class AssignTeamRequest(BaseModel):
    members: list[TeamMemberSpec]


class DistributeTasksRequest(BaseModel):
    strategy: str = Field(default="by_responsibility")


class SuggestTeamQuery(BaseModel):
    size: int = 2


# ========== ROUTER FACTORY ==========

def build_router(db, get_current_user, require_role, emit_event_to_bus=None):
    """
    Build APIRouter wired to existing auth + event bus from server.py.
    `emit_event_to_bus(event_type, data) -> awaitable` — optional.
    """
    router = APIRouter(prefix="/api", tags=["team-layer"])

    async def _emit(event_type: str, data: dict):
        # Write to db.events bus if available
        try:
            await db.events.insert_one(
                {
                    "event_id": f"ev_{uuid.uuid4().hex[:12]}",
                    "type": event_type,
                    "data": data,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "source": "team_layer",
                }
            )
        except Exception:
            pass
        if emit_event_to_bus:
            try:
                await emit_event_to_bus(event_type, data)
            except Exception:
                pass

    # ---------- SUGGEST ----------
    @router.get("/modules/{module_id}/team/suggest")
    async def suggest(
        module_id: str,
        size: int = 2,
        user=Depends(require_role("admin")),
    ):
        return await team_layer.suggest_team(db, module_id, size=size)

    # ---------- ASSIGN ----------
    @router.post("/modules/{module_id}/team/assign")
    async def assign(
        module_id: str,
        req: AssignTeamRequest,
        user=Depends(require_role("admin")),
    ):
        try:
            members = [m.model_dump() for m in req.members]
            result = await team_layer.assign_team(
                db, module_id, members, assigned_by=user.user_id, emit_event=_emit
            )
            return result
        except team_layer.TeamInvariantError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # ---------- GET TEAM ----------
    @router.get("/modules/{module_id}/team")
    async def get_team(module_id: str, user=Depends(get_current_user)):
        # Any authenticated user can read team (client/dev/admin)
        return await team_layer.get_module_team(db, module_id)

    # ---------- REMOVE ASSIGNMENT ----------
    @router.post("/assignments/{assignment_id}/remove")
    async def remove(
        assignment_id: str, user=Depends(require_role("admin"))
    ):
        try:
            return await team_layer.remove_assignment(
                db, assignment_id, removed_by=user.user_id, emit_event=_emit
            )
        except team_layer.TeamInvariantError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # ---------- DISTRIBUTE TASKS ----------
    @router.post("/modules/{module_id}/team/distribute-tasks")
    async def distribute(
        module_id: str,
        req: DistributeTasksRequest = Body(default=DistributeTasksRequest()),
        user=Depends(require_role("admin")),
    ):
        try:
            return await team_layer.distribute_tasks(
                db, module_id, strategy=req.strategy, emit_event=_emit
            )
        except team_layer.TeamInvariantError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # ---------- DEV: my teams ----------
    @router.get("/developer/my-teams")
    async def my_teams(user=Depends(require_role("developer"))):
        return {"teams": await team_layer.get_dev_teams(db, user.user_id)}

    # ---------- EARNINGS ----------
    @router.get("/modules/{module_id}/team/earnings")
    async def team_earnings(module_id: str, user=Depends(get_current_user)):
        team = await team_layer.get_module_team(db, module_id)
        rows = []
        for m in team["team"]:
            e = await team_layer.compute_dev_earnings_for_module(
                db, module_id, m["developer_id"]
            )
            rows.append(
                {
                    "developer_id": m["developer_id"],
                    "name": m.get("developer", {}).get("name"),
                    "role": m["role"],
                    **e,
                }
            )
        total = sum(r["earned"] for r in rows)
        return {
            "module_id": module_id,
            "module_price": team.get("module_price", 0),
            "rows": rows,
            "total_distributed": round(total, 2),
        }

    # ---------- ADMIN: teams overview ----------
    @router.get("/admin/teams/overview")
    async def overview(user=Depends(require_role("admin"))):
        # All modules with active teams
        pipeline = [
            {"$match": {"status": "active"}},
            {
                "$group": {
                    "_id": "$module_id",
                    "members": {
                        "$push": {
                            "developer_id": "$developer_id",
                            "role": "$role",
                            "allocation": "$allocation",
                            "responsibility": "$responsibility",
                        }
                    },
                    "size": {"$sum": 1},
                    "total_allocation": {"$sum": "$allocation"},
                }
            },
        ]
        groups = await db.module_assignments.aggregate(pipeline).to_list(500)

        # Enrich with module info
        module_ids = [g["_id"] for g in groups]
        modules = {}
        if module_ids:
            async for m in db.modules.find(
                {"module_id": {"$in": module_ids}},
                {
                    "_id": 0,
                    "module_id": 1,
                    "title": 1,
                    "status": 1,
                    "final_price": 1,
                    "price": 1,
                },
            ):
                modules[m["module_id"]] = m

        # Collect dev load snapshot
        devs = {}
        async for d in db.users.find(
            {"role": "developer"},
            {"_id": 0, "user_id": 1, "name": 1, "capacity": 1},
        ):
            load = await team_layer.compute_dev_load(db, d["user_id"])
            cap = float(d.get("capacity", team_layer.DEFAULT_CAPACITY))
            devs[d["user_id"]] = {
                "user_id": d["user_id"],
                "name": d.get("name", "Unknown"),
                "load": load,
                "capacity": cap,
                "utilization": round(load / cap, 3) if cap else 0,
            }

        modules_out = []
        for g in groups:
            mod = modules.get(g["_id"], {})
            modules_out.append(
                {
                    "module_id": g["_id"],
                    "title": mod.get("title", "—"),
                    "status": mod.get("status"),
                    "price": mod.get("final_price") or mod.get("price") or 0,
                    "team_size": g["size"],
                    "total_allocation": round(float(g["total_allocation"]), 3),
                    "members": g["members"],
                }
            )

        return {
            "modules": modules_out,
            "developers": list(devs.values()),
            "summary": {
                "teamed_modules": len(modules_out),
                "overloaded_devs": sum(
                    1 for d in devs.values() if d["utilization"] > 1.0
                ),
                "idle_devs": sum(1 for d in devs.values() if d["load"] == 0),
                "total_devs": len(devs),
            },
        }

    return router
