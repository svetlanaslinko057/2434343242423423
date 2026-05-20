"""
Block 6.1 — Client Escrow Transparency (READ-ONLY)

One endpoint. Shows the client WHERE their money is.
Reuses existing escrows collection fields — NO new schema, NO new logic, NO writes.

Fields on db.escrows (from escrow_layer.py):
  total_amount, locked_amount, released_amount, refunded_amount, status, module_id, client_id

Summary math:
  total_committed = Σ total_amount
  in_escrow       = Σ (locked_amount - released_amount)      # money locked right now
  paid_out        = Σ released_amount                         # money already out the door
  available       = Σ refunded_amount                         # money returned to client

Module math:
  price      = total_amount
  in_escrow  = max(0, locked_amount - released_amount)
  released   = released_amount
  remaining  = max(0, total_amount - released_amount - refunded_amount)
  progress   = released_amount / total_amount
  escrow_status: funded | partial | empty | released
  next_action:    fund   | release | wait
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from typing import Any, Dict, List

router = APIRouter(prefix="/api", tags=["client-escrow"])


_STATUS_MAP = {
    "pending": "empty",
    "funded": "funded",
    "partially_released": "partial",
    "completed": "released",
    "refunded": "empty",
}


def _next_action(esc_status: str, in_escrow: float, released: float) -> str:
    # empty escrow → client must fund
    if esc_status in ("pending", "refunded"):
        return "fund"
    # fully released → nothing to do
    if esc_status == "completed":
        return "wait"
    # partial → release more on milestones, otherwise wait
    if esc_status == "partially_released":
        return "release" if in_escrow > 0 else "wait"
    # funded, work in progress
    return "wait"


def init_router(db, get_current_user_dep):
    """Wires handler to runtime db + auth."""

    @router.get("/client/escrow")
    async def client_escrow(user=Depends(get_current_user_dep)) -> Dict[str, Any]:
        client_id = user.user_id if hasattr(user, "user_id") else user["user_id"]

        # 1. All escrows for this client
        escrows = await db.escrows.find(
            {"client_id": client_id}, {"_id": 0},
        ).sort("created_at", -1).to_list(500)

        # 2. Resolve module + project titles in bulk (no business logic)
        module_ids = [e.get("module_id") for e in escrows if e.get("module_id")]
        modules_map: Dict[str, Dict[str, Any]] = {}
        project_ids: List[str] = []
        if module_ids:
            mods = await db.modules.find(
                {"module_id": {"$in": module_ids}}, {"_id": 0},
            ).to_list(len(module_ids))
            for m in mods:
                modules_map[m["module_id"]] = m
                pid = m.get("project_id")
                if pid:
                    project_ids.append(pid)

        projects_map: Dict[str, str] = {}
        if project_ids:
            projs = await db.projects.find(
                {"project_id": {"$in": list(set(project_ids))}}, {"_id": 0},
            ).to_list(len(project_ids))
            for p in projs:
                projects_map[p["project_id"]] = p.get("name") or p.get("title") or ""

        # 3. Summary
        total_committed = 0.0
        in_escrow_total = 0.0
        paid_out = 0.0
        available = 0.0

        module_rows: List[Dict[str, Any]] = []

        for e in escrows:
            total = float(e.get("total_amount") or 0)
            locked = float(e.get("locked_amount") or 0)
            released = float(e.get("released_amount") or 0)
            refunded = float(e.get("refunded_amount") or 0)
            raw_status = e.get("status") or "pending"

            in_esc = max(0.0, locked - released)
            remaining = max(0.0, total - released - refunded)
            progress = (released / total) if total > 0 else 0.0

            total_committed += total
            in_escrow_total += in_esc
            paid_out += released
            available += refunded

            esc_status = _STATUS_MAP.get(raw_status, "empty")
            module_id = e.get("module_id")
            mod = modules_map.get(module_id or "", {})
            project_title = projects_map.get(mod.get("project_id") or "", "")

            module_rows.append({
                "module_id": module_id,
                "escrow_id": e.get("escrow_id"),
                "project_title": project_title,
                "module_title": mod.get("title") or "",
                "price": round(total, 2),
                "escrow_status": esc_status,
                "in_escrow": round(in_esc, 2),
                "released": round(released, 2),
                "remaining": round(remaining, 2),
                "progress": round(progress, 2),
                "next_action": _next_action(raw_status, in_esc, released),
            })

        return {
            "summary": {
                "total_committed": round(total_committed, 2),
                "in_escrow": round(in_escrow_total, 2),
                "available": round(available, 2),
                "paid_out": round(paid_out, 2),
            },
            "modules": module_rows,
        }

    return router
