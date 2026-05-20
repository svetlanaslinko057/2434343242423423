"""
BLOCK 6 — Escrow API + BLOCK 5.2 — Client Transparency.
"""
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel

import escrow_layer as el


HUMAN_ACTIONS = {
    "auto_rebalance": {
        "icon": "⚖️",
        "title": "Task rebalanced",
        "template": "Moved {task} from {from_name} → {to_name} to reduce overload",
        "impact": "Faster delivery expected",
    },
    "auto_add_support": {
        "icon": "➕",
        "title": "Support developer added",
        "template": "{candidate} joined the module to speed up progress",
        "impact": "Team capacity increased",
    },
}


def humanise_action(a: dict) -> dict:
    """Turn raw auto_action doc into client-facing view."""
    tpl = HUMAN_ACTIONS.get(a["type"], {"icon": "⚙️", "title": a["type"],
                                        "template": "", "impact": ""})
    p = a.get("payload") or {}
    e = a.get("enriched") or {}
    fmt = dict(
        task=p.get("task_title", "a task"),
        from_name=e.get("from_dev_name") or p.get("from_dev", "a developer"),
        to_name=e.get("to_dev_name") or p.get("to_dev", "teammate"),
        candidate=e.get("candidate_name") or p.get("candidate_name", "developer"),
    )
    try:
        desc = tpl["template"].format(**fmt)
    except KeyError:
        desc = tpl["template"]
    why = []
    cb = a.get("confidence_breakdown") or {}
    if cb.get("signal_strength", 0) > 0.3:
        why.append(f"High workload/risk signal ({cb['signal_strength']*100:.0f}%)")
    if cb.get("data_confidence", 0) > 0.6:
        why.append("Strong historical data")
    if cb.get("stability", 0) > 0.7:
        why.append("Stable team signals")
    return {
        "action_id": a["action_id"],
        "module_id": a["module_id"],
        "module_title": a.get("module_title"),
        "type": a["type"],
        "icon": tpl["icon"],
        "human_title": tpl["title"],
        "human_description": desc,
        "impact": tpl["impact"],
        "why": why,
        "confidence": a["confidence"],
        "confidence_colour": (
            "green" if a["confidence"] >= 0.8
            else "yellow" if a["confidence"] >= 0.6 else "grey"
        ),
        "status": a.get("status", "executed"),
        "created_at": a.get("created_at"),
        "executed_at": a.get("executed_at"),
        "revert_available": a.get("revert_available", False)
                            and a.get("status") == "executed",
    }


class CreateEscrowReq(BaseModel):
    module_id: str
    amount: float


class PartialRefundReq(BaseModel):
    completed_share: float = 0.0
    reason: str = "cancelled"


def build_router(db, get_current_user, require_role, emit_event_to_bus=None):
    router = APIRouter(prefix="/api", tags=["escrow-transparency"])

    async def _emit(ev, data):
        if emit_event_to_bus:
            try:
                await emit_event_to_bus(ev, data)
            except Exception:
                pass
        try:
            import uuid
            from datetime import datetime, timezone
            await db.events.insert_one({
                "event_id": f"ev_{uuid.uuid4().hex[:12]}",
                "type": ev, "data": data,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "source": "escrow_layer",
            })
        except Exception:
            pass

    # =============== ESCROW ===============

    @router.post("/escrow/create")
    async def create(req: CreateEscrowReq, user=Depends(get_current_user)):
        if user.role not in ("client", "admin"):
            raise HTTPException(status_code=403, detail="Client or admin only")
        # Client creates for self; admin may create for any project's client
        mod = await db.modules.find_one({"module_id": req.module_id}, {"_id": 0})
        if not mod:
            raise HTTPException(status_code=404, detail="Module not found")
        proj = await db.projects.find_one({"project_id": mod.get("project_id")}, {"_id": 0})
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")
        client_id = proj.get("client_id")
        if user.role == "client" and client_id != user.user_id:
            raise HTTPException(status_code=403, detail="Not your project")
        try:
            return await el.create_escrow(
                db, req.module_id, client_id, req.amount, emit_event=_emit
            )
        except el.EscrowError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @router.post("/escrow/{escrow_id}/fund")
    async def fund(escrow_id: str, user=Depends(get_current_user)):
        esc = await db.escrows.find_one({"escrow_id": escrow_id}, {"_id": 0})
        if not esc:
            raise HTTPException(status_code=404, detail="Escrow not found")
        if user.role == "client" and esc["client_id"] != user.user_id:
            raise HTTPException(status_code=403, detail="Not your escrow")
        if user.role not in ("client", "admin"):
            raise HTTPException(status_code=403, detail="Client or admin only")
        try:
            return await el.fund_escrow(
                db, escrow_id, funded_by=user.user_id, emit_event=_emit
            )
        except el.EscrowError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @router.get("/escrow/{escrow_id}")
    async def read(escrow_id: str, user=Depends(get_current_user)):
        esc = await el.get_escrow(db, escrow_id)
        if not esc:
            raise HTTPException(status_code=404, detail="Escrow not found")
        # Client sees only theirs; admin sees all; dev sees if they're on team
        if user.role == "client" and esc["client_id"] != user.user_id:
            raise HTTPException(status_code=403, detail="Forbidden")
        if user.role == "developer":
            on_team = await db.module_assignments.find_one(
                {"module_id": esc["module_id"], "developer_id": user.user_id,
                 "status": "active"}, {"_id": 0}
            )
            if not on_team:
                raise HTTPException(status_code=403, detail="Forbidden")
        return esc

    @router.get("/modules/{module_id}/escrow")
    async def by_module(module_id: str, user=Depends(get_current_user)):
        esc = await el.get_escrow_for_module(db, module_id)
        if not esc:
            return {}
        # same auth as /escrow/{id}
        if user.role == "client" and esc["client_id"] != user.user_id:
            raise HTTPException(status_code=403, detail="Forbidden")
        return esc

    @router.post("/escrow/{escrow_id}/release")
    async def release(
        escrow_id: str,
        completed_share: float = 1.0,
        user=Depends(require_role("admin")),
    ):
        try:
            return await el.release_escrow(
                db, escrow_id, completed_share=completed_share,
                triggered_by=f"admin:{user.user_id}", emit_event=_emit,
            )
        except el.EscrowError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @router.post("/escrow/{escrow_id}/refund")
    async def refund(
        escrow_id: str, req: PartialRefundReq = Body(default=PartialRefundReq()),
        user=Depends(require_role("admin")),
    ):
        try:
            return await el.refund_escrow(
                db, escrow_id, completed_share=req.completed_share,
                reason=req.reason, emit_event=_emit,
            )
        except el.EscrowError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @router.get("/admin/escrows/dashboard")
    async def admin_dash(user=Depends(require_role("admin"))):
        return await el.admin_dashboard(db)

    @router.get("/client/escrows")
    async def my_escrows(user=Depends(get_current_user)):
        if user.role != "client":
            raise HTTPException(status_code=403, detail="Client only")
        return {"escrows": await el.list_client_escrows(db, user.user_id)}

    @router.get("/developer/escrow-payouts")
    async def my_payouts(user=Depends(get_current_user)):
        if user.role != "developer":
            raise HTTPException(status_code=403, detail="Developer only")
        rows = await el.list_dev_payouts(db, user.user_id)
        total = round(sum(p["amount"] for p in rows), 2)
        return {"payouts": rows, "total_received": total, "count": len(rows)}

    # =============== BLOCK 5.2 — CLIENT TRANSPARENCY ===============

    @router.get("/client/system-actions")
    async def client_system_actions(
        limit: int = 10, user=Depends(get_current_user)
    ):
        """
        Humanised auto_actions feed for the client.
        Shows only actions for modules in client's projects.
        """
        # Find client's modules
        if user.role == "client":
            proj_ids = await db.projects.distinct(
                "project_id", {"client_id": user.user_id}
            )
            mod_ids = await db.modules.distinct(
                "module_id", {"project_id": {"$in": proj_ids}}
            )
            q = {"module_id": {"$in": mod_ids}}
        elif user.role == "developer":
            q = {"module_id": {
                "$in": await db.module_assignments.distinct(
                    "module_id",
                    {"developer_id": user.user_id, "status": "active"},
                )
            }}
        elif user.role == "admin":
            q = {}
        else:
            raise HTTPException(status_code=403, detail="Forbidden")

        rows = await db.auto_actions.find(q, {"_id": 0}).sort(
            "created_at", -1
        ).limit(limit).to_list(limit)

        # Enrich with dev names (reuse logic inline)
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

        return {
            "actions": [humanise_action(a) for a in rows],
            "count": len(rows),
        }

    return router
