"""
Developer Support Tickets — mirrors client_support endpoints under /api/developer/*.

Identical shape and persistence as the client flow (collections
`support_tickets` + `ticket_responses`) so the admin queue treats both
audiences uniformly. The only marker is `audience='developer'`.

Updated to match the client side:
  - `ticket_type` is FREE-FORM (any short string). No enum check — the user
    is the best judge of what category their issue belongs to.
  - `respond` accepts `attachment_url` (data URL / link) so the chat behaves
    like a real chat (text + image), and re-opens resolved/closed tickets.
  - `last_reply_at` / `last_reply_role` are stamped so admin queues
    sort/badge correctly.
"""
from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException

router = APIRouter(prefix="/api", tags=["developer-support"])
logger = logging.getLogger(__name__)

VALID_PRIORITIES = {"low", "medium", "high"}


def init_router(db, get_current_user_dep):

    @router.get("/developer/support-tickets")
    async def list_tickets(user=Depends(get_current_user_dep)):
        cursor = db.support_tickets.find(
            {"user_id": user.user_id},
            {"_id": 0},
        ).sort("created_at", -1)
        tickets = await cursor.to_list(100)

        # Attach last response preview for the list-row tease.
        for t in tickets:
            last = await db.ticket_responses.find_one(
                {"ticket_id": t["ticket_id"]},
                {"_id": 0, "message": 1, "created_at": 1, "user_role": 1,
                 "attachment_url": 1},
                sort=[("created_at", -1)],
            )
            if last:
                preview = (last.get("message") or "").strip()
                if not preview and last.get("attachment_url"):
                    preview = "[attachment]"
                t["last_response"] = {
                    "preview": preview[:80],
                    "from": last.get("user_role") or "user",
                    "at": last.get("created_at"),
                }
        return {"tickets": tickets}

    @router.post("/developer/support-tickets")
    async def create_ticket(
        title: str = Body(...),
        description: str = Body(""),
        ticket_type: str = Body("question"),
        priority: str = Body("medium"),
        module_id: Optional[str] = Body(None),
        attachment_url: Optional[str] = Body(None),
        user=Depends(get_current_user_dep),
    ):
        if not (title or "").strip():
            raise HTTPException(status_code=400, detail="Subject is required")

        t_type = (ticket_type or "question").strip()
        if len(t_type) > 40:
            t_type = t_type[:40]
        if not t_type:
            t_type = "question"

        if priority not in VALID_PRIORITIES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid priority. Must be one of: {sorted(VALID_PRIORITIES)}",
            )

        ticket = {
            "ticket_id": f"tkt_{uuid.uuid4().hex[:12]}",
            "user_id": user.user_id,
            "audience": "developer",
            "module_id": module_id,
            "title": title.strip(),
            "description": (description or "").strip(),
            "ticket_type": t_type,
            "priority": priority,
            "attachment_url": attachment_url,
            "status": "open",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.support_tickets.insert_one(ticket)
        logger.info(
            f"DEV TICKET CREATED: {ticket['ticket_id']} by {user.user_id} ({t_type}/{priority})"
        )
        ticket.pop("_id", None)
        return ticket

    @router.get("/developer/support-tickets/{ticket_id}")
    async def get_ticket(ticket_id: str, user=Depends(get_current_user_dep)):
        ticket = await db.support_tickets.find_one(
            {"ticket_id": ticket_id, "user_id": user.user_id},
            {"_id": 0},
        )
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")
        responses = await db.ticket_responses.find(
            {"ticket_id": ticket_id},
            {"_id": 0},
        ).sort("created_at", 1).to_list(200)
        ticket["responses"] = responses
        return ticket

    @router.post("/developer/support-tickets/{ticket_id}/respond")
    async def respond(
        ticket_id: str,
        message: str = Body(""),
        attachment_url: Optional[str] = Body(None),
        user=Depends(get_current_user_dep),
    ):
        text = (message or "").strip()
        if not text and not attachment_url:
            raise HTTPException(status_code=400, detail="Empty message")
        ticket = await db.support_tickets.find_one(
            {"ticket_id": ticket_id, "user_id": user.user_id},
            {"_id": 0},
        )
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")
        now_iso = datetime.now(timezone.utc).isoformat()
        response = {
            "response_id": f"resp_{uuid.uuid4().hex[:12]}",
            "ticket_id": ticket_id,
            "user_id": user.user_id,
            "user_role": getattr(user, "role", None) or "developer",
            "message": text,
            "attachment_url": attachment_url,
            "created_at": now_iso,
        }
        await db.ticket_responses.insert_one(response)
        # Re-open if resolved + stamp last reply
        new_status = ticket.get("status") or "open"
        if new_status in ("resolved", "closed"):
            new_status = "open"
        await db.support_tickets.update_one(
            {"ticket_id": ticket_id},
            {"$set": {
                "status": new_status,
                "last_reply_at": now_iso,
                "last_reply_role": response["user_role"],
                "reopened_at": now_iso if ticket.get("status") in ("resolved", "closed") else ticket.get("reopened_at"),
            }},
        )
        response.pop("_id", None)
        return response

    return router
