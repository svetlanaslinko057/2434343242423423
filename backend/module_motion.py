"""
L0 — Module Motion Daemon.

Makes demo projects *move* so the user sees the system alive:
  pending → in_progress → review → done

Rules per tick (runs every ~15s for demo projects only):
  1. For each demo project (active status) with no in_progress module,
     promote the first `pending` module → `in_progress` (stamp started_at).
  2. Any `in_progress` module older than IN_PROGRESS_SECS → `review`.
  3. Any `review` module older than REVIEW_SECS → `done`. If that module
     has `assigned_to`, drop an `approved` payout so dev earnings grow.
  4. Recompute project.progress = done / total * 100.

Writes are idempotent: we only transition modules whose timestamps are old.
Production projects (is_demo != True) are never touched by this daemon.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict

logger = logging.getLogger(__name__)

TICK_INTERVAL_SECS = 15
IN_PROGRESS_SECS = 30  # how long a module stays in_progress before review
REVIEW_SECS = 20       # how long review lasts before done


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            s = value.replace("Z", "+00:00")
            return datetime.fromisoformat(s)
        except Exception:
            return None
    return None


async def _recompute_project_progress(db, project_id: str) -> None:
    mods = await db.modules.find(
        {"project_id": project_id},
        {"_id": 0, "status": 1},
    ).to_list(1000)
    if not mods:
        return
    total = len(mods)
    done = sum(1 for m in mods if m.get("status") == "done")
    pct = int(round(done / total * 100))
    await db.projects.update_one(
        {"project_id": project_id},
        {"$set": {"progress": pct, "updated_at": _now().isoformat()}},
    )


async def _emit_notification(db, *, user_id: str, type_: str, title: str, subtitle: str | None, project_id: str, module_id: str, severity: str = "info") -> None:
    """
    Push-нотификация для конкретного юзера. Живёт в отдельной коллекции
    `notifications` (не смешиваем с `events` — там warnings движка).
    Frontend поллит GET /api/notifications/my?unread=true и показывает toast.

    Phase 8: single врезка — после insert здесь мы автоматически шлём Expo
    push на все зарегистрированные устройства юзера. Каждый из шести
    вызовов `_emit_notification` по кодовой базе получает push «бесплатно»,
    без изменений в месте вызова.
    """
    await db.notifications.insert_one({
        "notification_id": f"ntf_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "type": type_,          # review_ready | module_done | review_required
        "severity": severity,   # info | success | warning
        "title": title,
        "subtitle": subtitle,
        "project_id": project_id,
        "module_id": module_id,
        "read": False,
        "created_at": _now().isoformat(),
    })

    # Silent types never leave the app (e.g. internal system heartbeats).
    if type_ and type_.startswith("silent"):
        return

    # Lazy-import so `module_motion` can still be imported in environments
    # where `push_sender` hasn't been wired (tests, one-off scripts).
    from push_sender import send_push_nowait
    send_push_nowait(
        db,
        user_id=user_id,
        title=title,
        body=subtitle or "",
        data={
            "type": type_,
            "project_id": project_id,
            "module_id": module_id,
            "severity": severity,
        },
    )


async def _advance_project(db, project: Dict[str, Any]) -> None:
    pid = project["project_id"]
    now = _now()

    # Gather modules once per project, classify by status.
    mods = await db.modules.find({"project_id": pid}, {"_id": 0}).to_list(500)
    by_status: Dict[str, list] = {"pending": [], "in_progress": [], "review": [], "done": []}
    for m in mods:
        by_status.setdefault(m.get("status") or "pending", []).append(m)

    # 3. review → done (oldest first)
    for mod in sorted(by_status.get("review", []), key=lambda x: x.get("review_at") or ""):
        ts = _parse_ts(mod.get("review_at"))
        if ts and (now - ts) < timedelta(seconds=REVIEW_SECS):
            continue
        # ─── MONEY GATE ───
        # If there's an invoice tied to this module and it's not paid yet,
        # the module stays in `review`. Money unblocks progress.
        inv = await db.invoices.find_one(
            {"module_id": mod["module_id"]},
            {"_id": 0, "status": 1},
        )
        if inv and inv.get("status") != "paid":
            continue
        # ──────────────────
        await db.modules.update_one(
            {"module_id": mod["module_id"]},
            {"$set": {
                "status": "done",
                "progress": 100,
                "completed_at": now.isoformat(),
                "updated_at": now.isoformat(),
            }},
        )
        # If this module had an assignee, credit them — through the CANONICAL
        # earnings path (`_credit_module_reward`) so wallet, log and audit all
        # stay in sync. NEVER write to db.payouts directly here — that creates
        # a parallel money source and desyncs /wallet from /dev/work.
        assignee = mod.get("assigned_to")
        if assignee:
            dev_share = 0.0
            try:
                # Lazy import — avoid circular deps at module load time.
                from server import _credit_module_reward  # type: ignore
                # Build a module dict shaped like _credit_module_reward expects
                _mod_for_credit = dict(mod)
                _mod_for_credit["status"] = "done"
                wallet_after = await _credit_module_reward(_mod_for_credit)
                if wallet_after is not None:
                    dev_share = float(mod.get("dev_reward") or 0)
            except Exception as e:
                logger.warning("MODULE MOTION: credit failed for %s: %s", mod.get("module_id"), e)

            # Этап 6.1.1 — module_motion ledger bridge. The auto-promotion
            # is the SAME canonical event as a manual client_approve_module —
            # we MUST emit the same ledger events so audit continuity is
            # not broken. All keyed by module_id → idempotent: if the
            # explicit handler later approves the same module, ledger
            # writes are deduped at the DB-unique-index level.
            try:
                import money_ledger
                import money_runtime
                # Ensure money_runtime has db wired (it normally is, but
                # this loop runs in a background task that might race the
                # wire() call on cold-start).
                if money_runtime._db is None:
                    money_runtime._db = db

                await money_ledger.record_event(
                    db,
                    event_type=money_ledger.EVENT_QA_APPROVED,
                    entity_id=mod["module_id"],
                    project_id=pid,
                    actor_id="module_motion",
                    idempotency_key=mod["module_id"],
                    payload={"source": "module_motion_auto"},
                )
                earn_log = await db.dev_earning_log.find_one(
                    {"module_id": mod["module_id"]}, {"_id": 0}
                )
                if earn_log:
                    await money_ledger.record_event(
                        db,
                        event_type=money_ledger.EVENT_EARNING_APPROVED,
                        entity_id=earn_log.get("log_id") or mod["module_id"],
                        project_id=pid,
                        actor_id="module_motion",
                        amount=float(earn_log.get("amount") or 0),
                        idempotency_key=mod["module_id"],
                        payload={
                            "developer_id": assignee,
                            "module_id": mod["module_id"],
                            "tier": earn_log.get("tier"),
                            "rate": earn_log.get("rate"),
                            "source": "module_motion_auto",
                        },
                    )
                # Escrow release — only fires if escrow is funded.
                chain = await money_runtime.on_module_done_chain(mod["module_id"])
                if chain and chain.get("payouts"):
                    esc = chain.get("escrow") or {}
                    await money_ledger.record_event(
                        db,
                        event_type=money_ledger.EVENT_ESCROW_RELEASED,
                        entity_id=esc.get("escrow_id") or mod["module_id"],
                        project_id=pid,
                        actor_id="module_motion",
                        amount=float(chain.get("release_total") or 0),
                        idempotency_key=esc.get("escrow_id") or f"release_{mod['module_id']}",
                        payload={
                            "module_id": mod["module_id"],
                            "payout_count": len(chain.get("payouts") or []),
                            "source": "module_motion_auto",
                        },
                    )
            except Exception as e:
                logger.warning(
                    "MODULE MOTION ledger bridge failed for %s: %s",
                    mod.get("module_id"), e,
                )
            # EVENT BRIDGE: dev узнаёт что модуль закрыт и он заработал.
            await _emit_notification(
                db,
                user_id=assignee,
                type_="module_done",
                severity="success",
                title=f"You earned ${dev_share:.0f}" if dev_share > 0 else "Module shipped",
                subtitle=f"{mod.get('title') or 'Module'} completed · paid out",
                project_id=pid,
                module_id=mod["module_id"],
            )
        # EVENT BRIDGE: клиент узнаёт что модуль доставлен.
        owner = project.get("owner_id") or project.get("client_id")
        if owner:
            await _emit_notification(
                db,
                user_id=owner,
                type_="module_done",
                severity="success",
                title=f"{mod.get('title') or 'Module'} shipped",
                subtitle="Your product grew by one module.",
                project_id=pid,
                module_id=mod["module_id"],
            )
        logger.info("MODULE MOTION: %s review→done (project=%s)", mod.get("title"), pid)

    # 2. in_progress → review
    for mod in sorted(by_status.get("in_progress", []), key=lambda x: x.get("started_at") or ""):
        ts = _parse_ts(mod.get("started_at"))
        if ts and (now - ts) < timedelta(seconds=IN_PROGRESS_SECS):
            continue
        await db.modules.update_one(
            {"module_id": mod["module_id"]},
            {"$set": {
                "status": "review",
                "progress": 80,
                "review_at": now.isoformat(),
                "updated_at": now.isoformat(),
            }},
        )
        # EVENT BRIDGE: клиенту — "требуется review"; dev — "ждёт апрува".
        owner = project.get("owner_id") or project.get("client_id")
        if owner:
            await _emit_notification(
                db,
                user_id=owner,
                type_="review_required",
                severity="warning",
                title=f"Review required: {mod.get('title') or 'Module'}",
                subtitle="Approve to ship · dev is waiting",
                project_id=pid,
                module_id=mod["module_id"],
            )
        assignee = mod.get("assigned_to")
        if assignee:
            price = float(mod.get("final_price") or mod.get("price") or 0)
            dev_share = round(price * 0.6, 2) if price > 0 else 0
            await _emit_notification(
                db,
                user_id=assignee,
                type_="review_ready",
                severity="info",
                title=f"Awaiting review: {mod.get('title') or 'Module'}",
                subtitle=f"${dev_share:.0f} pending · client is next" if dev_share > 0 else "Client is next · payout on approval",
                project_id=pid,
                module_id=mod["module_id"],
            )
        logger.info("MODULE MOTION: %s in_progress→review (project=%s)", mod.get("title"), pid)

    # 1. pending → in_progress (only if no in_progress currently)
    still_in_progress = await db.modules.count_documents(
        {"project_id": pid, "status": "in_progress"},
    )
    if still_in_progress == 0 and by_status.get("pending"):
        pick = sorted(by_status["pending"], key=lambda x: x.get("created_at") or "")[0]
        await db.modules.update_one(
            {"module_id": pick["module_id"]},
            {"$set": {
                "status": "in_progress",
                "progress": 20,
                "started_at": now.isoformat(),
                "updated_at": now.isoformat(),
            }},
        )
        logger.info("MODULE MOTION: %s pending→in_progress (project=%s)", pick.get("title"), pid)

    await _recompute_project_progress(db, pid)


async def module_motion_tick(db) -> Dict[str, Any]:
    """One pass across all demo projects."""
    projects = await db.projects.find(
        {"is_demo": True, "status": "active"}, {"_id": 0},
    ).to_list(500)
    for proj in projects:
        try:
            await _advance_project(db, proj)
        except Exception as e:
            logger.exception("MODULE MOTION failed for %s: %s", proj.get("project_id"), e)
    return {"scanned": len(projects), "at": _now().isoformat()}


async def module_motion_loop(db) -> None:
    """Forever loop. Spawn as asyncio.create_task at startup."""
    logger.info("MODULE MOTION: loop started (interval %ss)", TICK_INTERVAL_SECS)
    while True:
        try:
            await module_motion_tick(db)
        except Exception as e:
            logger.exception("MODULE MOTION tick crashed: %s", e)
        await asyncio.sleep(TICK_INTERVAL_SECS)
