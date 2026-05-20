"""
BLOCK 4.1/4.2/4.3 — INTELLIGENCE API endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException

import intelligence_layer as il
import team_intelligence as ti


def build_router(db, get_current_user, require_role, emit_event_to_bus=None):
    router = APIRouter(prefix="/api", tags=["intelligence-layer"])

    async def _emit(ev, data):
        if emit_event_to_bus:
            try:
                await emit_event_to_bus(ev, data)
            except Exception:
                pass
        try:
            from datetime import datetime, timezone
            import uuid
            await db.events.insert_one(
                {
                    "event_id": f"ev_{uuid.uuid4().hex[:12]}",
                    "type": ev,
                    "data": data,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "source": "intelligence_layer",
                }
            )
        except Exception:
            pass

    # --- Dev self-view ---
    @router.get("/intelligence/me")
    async def me(user=Depends(get_current_user)):
        if user.role != "developer":
            raise HTTPException(status_code=403, detail="Developer only")
        doc = await il.get_developer_score(db, user.user_id)
        if not doc:
            doc = await il.recompute_developer_score(db, user.user_id, emit_event=_emit)
        return doc

    # --- Dev lookup (admin or self) ---
    @router.get("/intelligence/developers/{developer_id}")
    async def dev(developer_id: str, user=Depends(get_current_user)):
        if user.role != "admin" and user.user_id != developer_id:
            raise HTTPException(status_code=403, detail="Forbidden")
        doc = await il.get_developer_score(db, developer_id)
        if not doc:
            doc = await il.recompute_developer_score(db, developer_id, emit_event=_emit)
        return doc

    # --- Admin overview (dev bands) ---
    @router.get("/intelligence/admin/overview")
    async def overview(user=Depends(require_role("admin"))):
        return await il.admin_overview(db)

    # --- Force recompute (devs) ---
    @router.post("/intelligence/recalculate")
    async def recalculate(
        developer_id: str | None = None, user=Depends(require_role("admin"))
    ):
        if developer_id:
            return await il.recompute_developer_score(
                db, developer_id, emit_event=_emit
            )
        return await il.recompute_all(db, emit_event=_emit)

    # ============ BLOCK 4.3 — Team Intelligence ============

    @router.get("/intelligence/modules/{module_id}/team")
    async def team_intel(module_id: str, user=Depends(get_current_user)):
        # Any authenticated role can read team intelligence (read-only)
        doc = await db.team_scores.find_one({"module_id": module_id}, {"_id": 0})
        if not doc:
            # Lazy compute
            doc = await ti.recompute_team_score(db, module_id, emit_event=_emit)
        return doc

    @router.get("/intelligence/admin/teams")
    async def teams_overview(user=Depends(require_role("admin"))):
        return await ti.admin_teams_overview(db)

    @router.post("/intelligence/recalculate-team")
    async def recalc_team(
        module_id: str | None = None, user=Depends(require_role("admin"))
    ):
        if module_id:
            return await ti.recompute_team_score(db, module_id, emit_event=_emit)
        return await ti.recompute_all_teams(db, emit_event=_emit)

    return router
