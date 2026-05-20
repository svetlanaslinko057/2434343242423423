"""
BLOCK 5.1 — SAFE AUTONOMY API endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException

import autonomy_layer as al


def build_router(db, get_current_user, require_role, emit_event_to_bus=None):
    router = APIRouter(prefix="/api", tags=["autonomy-layer"])

    async def _emit(ev, data):
        if emit_event_to_bus:
            try:
                await emit_event_to_bus(ev, data)
            except Exception:
                pass
        try:
            import uuid
            from datetime import datetime, timezone
            await db.events.insert_one(
                {
                    "event_id": f"ev_{uuid.uuid4().hex[:12]}",
                    "type": ev,
                    "data": data,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "source": "autonomy_layer",
                }
            )
        except Exception:
            pass

    @router.get("/auto-actions")
    async def list_all(
        module_id: str | None = None,
        limit: int = 50,
        user=Depends(get_current_user),
    ):
        # Any authenticated user may read; devs filtered to their modules
        rows = await al.list_actions(db, module_id=module_id, limit=limit)
        if user.role == "developer":
            # Filter to modules where dev is on active team
            dev_modules = await db.module_assignments.distinct(
                "module_id",
                {"developer_id": user.user_id, "status": "active"},
            )
            rows = [r for r in rows if r["module_id"] in dev_modules]
        return {"actions": rows, "count": len(rows)}

    @router.post("/auto-actions/scan")
    async def scan(
        module_id: str | None = None,
        user=Depends(require_role("admin")),
    ):
        """Manually trigger an autonomy scan (otherwise runs every 5 min)."""
        if module_id:
            created = await al.evaluate_module(
                db, module_id, emit_event=_emit
            )
            return {"evaluated": 1, "created": len(created), "actions": created}
        return await al.scan_all_modules(db, emit_event=_emit)

    @router.post("/auto-actions/{action_id}/revert")
    async def revert(action_id: str, user=Depends(require_role("admin"))):
        try:
            return await al.revert_action(
                db, action_id, reverted_by=user.user_id, emit_event=_emit
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    return router
