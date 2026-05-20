"""
Phase 8 — Market Bootstrapping
==============================

Creates *real* market conditions so `/api/system/truth` can stop returning
`empty_market` and start showing honest verdicts (`working` / `drifting`
/ `pretending` / `idle`).

Zero new engines. Zero domain changes.
Only creates seed documents in existing collections (users, modules, bids,
projects) + an optional soft-simulation asyncio task that periodically
inserts new bids through the same collections.

Endpoints (all admin-only):
  POST /api/bootstrap/seed          — create 7 devs + 12 modules + ~20 bids
  POST /api/bootstrap/simulate/start — start soft simulation (1–2 bids / 2–5 min)
  POST /api/bootstrap/simulate/stop  — stop soft simulation
  POST /api/bootstrap/shock          — mark 50% devs as ghost (stale last_active_at)
  POST /api/bootstrap/reset          — delete all bootstrap-tagged data
  GET  /api/bootstrap/status         — current bootstrap state
"""

from __future__ import annotations

import asyncio
import logging
import random
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends

logger = logging.getLogger("market_bootstrap")

# ─────────────────────────────────────────────────────────────
# Wiring
# ─────────────────────────────────────────────────────────────
_db = None
_hash_password = None
_sim_task: Optional[asyncio.Task] = None
_sim_running = False

BOOTSTRAP_TAG = "bootstrap_v1"


def wire(*, db, hash_password: Callable):
    global _db, _hash_password
    _db = db
    _hash_password = hash_password


def _now():
    return datetime.now(timezone.utc)


def _iso():
    return _now().isoformat()


# ─────────────────────────────────────────────────────────────
# Seed definitions
# ─────────────────────────────────────────────────────────────
DEV_PROFILES = [
    # 2 junior
    {"name": "Alex Chen",    "level": "junior", "rating": 4.2, "capacity": 3, "skills": ["frontend", "react"]},
    {"name": "Maya Park",    "level": "junior", "rating": 4.0, "capacity": 3, "skills": ["backend", "python"]},
    # 3 mid
    {"name": "Dmitri Volkov", "level": "middle", "rating": 4.6, "capacity": 4, "skills": ["backend", "api", "database"]},
    {"name": "Sara Okafor",   "level": "middle", "rating": 4.7, "capacity": 4, "skills": ["frontend", "react", "ui"]},
    {"name": "Ravi Gupta",    "level": "middle", "rating": 4.5, "capacity": 4, "skills": ["fullstack", "auth", "payments"]},
    # 2 strong
    {"name": "Elena Rossi",   "level": "senior", "rating": 4.9, "capacity": 6, "skills": ["architecture", "backend", "scaling"]},
    {"name": "Kai Nakamura",  "level": "senior", "rating": 4.85, "capacity": 6, "skills": ["integrations", "api", "payments"]},
]


MODULE_SPECS = [
    # Cheap — should attract multiple bids
    {"title": "Landing page hero section",    "template_type": "frontend", "price": 400, "hours": 6},
    {"title": "Email signup form + validation", "template_type": "frontend", "price": 450, "hours": 7},
    {"title": "User profile page",              "template_type": "frontend", "price": 550, "hours": 9},
    # Medium — 1-2 bids
    {"title": "Stripe payment integration",     "template_type": "payments", "price": 900, "hours": 14},
    {"title": "REST API for orders",            "template_type": "backend",  "price": 1100, "hours": 16},
    {"title": "Admin dashboard analytics",      "template_type": "dashboard","price": 1250, "hours": 18},
    {"title": "Auth with 2FA",                  "template_type": "auth",     "price": 1400, "hours": 20},
    {"title": "Real-time chat module",          "template_type": "realtime", "price": 1600, "hours": 22},
    # Expensive — few bids
    {"title": "Multi-tenant billing system",    "template_type": "payments", "price": 2200, "hours": 30},
    {"title": "Marketplace scoring engine",     "template_type": "backend",  "price": 2400, "hours": 34},
    {"title": "Enterprise SSO (SAML + OIDC)",   "template_type": "auth",     "price": 2500, "hours": 36},
    {"title": "Data warehouse ETL pipeline",    "template_type": "backend",  "price": 2500, "hours": 36},
]


# ─────────────────────────────────────────────────────────────
# Seed
# ─────────────────────────────────────────────────────────────
async def _create_bootstrap_project() -> str:
    """Create (or reuse) a single synthetic client + project for the seed."""
    client_email = "seed_client@bootstrap.devos.io"
    existing = await _db.users.find_one({"email": client_email}, {"_id": 0})
    if existing:
        client_id = existing["user_id"]
    else:
        client_id = f"user_{uuid.uuid4().hex[:12]}"
        await _db.users.insert_one({
            "user_id": client_id,
            "email": client_email,
            "name": "Seed Client",
            "role": "client",
            "roles": ["client"],
            "active_role": "client",
            "password_hash": _hash_password("seed123"),
            "created_at": _iso(),
            "bootstrap_tag": BOOTSTRAP_TAG,
        })
    project = await _db.projects.find_one({"client_id": client_id, "bootstrap_tag": BOOTSTRAP_TAG}, {"_id": 0})
    if project:
        return project["project_id"]
    project_id = f"proj_{uuid.uuid4().hex[:12]}"
    await _db.projects.insert_one({
        "project_id": project_id,
        "client_id": client_id,
        "name": "Bootstrap Marketplace Project",
        "current_stage": "development",
        "progress": 20,
        "status": "active",
        "created_at": _iso(),
        "bootstrap_tag": BOOTSTRAP_TAG,
    })
    return project_id


async def seed_market() -> Dict[str, Any]:
    """Idempotent seed: creates devs, modules and bids tagged with BOOTSTRAP_TAG."""
    if _db is None:
        return {"error": "not wired"}

    now = _now()

    # 1) Developers
    dev_ids = []
    for i, p in enumerate(DEV_PROFILES):
        email = f"seed_dev_{i+1}@bootstrap.devos.io"
        existing = await _db.users.find_one({"email": email}, {"_id": 0})
        if existing:
            dev_ids.append(existing["user_id"])
            continue
        uid = f"user_{uuid.uuid4().hex[:12]}"
        await _db.users.insert_one({
            "user_id": uid,
            "email": email,
            "name": p["name"],
            "role": "developer",
            "roles": ["developer"],
            "active_role": "developer",
            "level": p["level"],
            "rating": p["rating"],
            "skills": p["skills"],
            "capacity": p["capacity"],
            "active_load": 0,
            "active_modules": 0,
            "completed_tasks": random.randint(3, 25),
            "password_hash": _hash_password("seed123"),
            "last_active_at": (now - timedelta(minutes=random.randint(1, 30))).isoformat(),
            "created_at": (now - timedelta(days=random.randint(30, 120))).isoformat(),
            "bootstrap_tag": BOOTSTRAP_TAG,
        })
        dev_ids.append(uid)

    # 2) Client + project
    project_id = await _create_bootstrap_project()

    # 3) Modules
    module_ids = []
    existing_mods = await _db.modules.find(
        {"bootstrap_tag": BOOTSTRAP_TAG}, {"_id": 0, "module_id": 1}
    ).to_list(100)
    if existing_mods:
        module_ids = [m["module_id"] for m in existing_mods]
    else:
        for spec in MODULE_SPECS:
            mid = f"mod_{uuid.uuid4().hex[:12]}"
            # Stagger created_at 0–90 min ago so some look "fresh" and some "stuck"
            minutes_old = random.randint(5, 150)
            await _db.modules.insert_one({
                "module_id": mid,
                "project_id": project_id,
                "title": spec["title"],
                "description": f"Seed module: {spec['title']}",
                "scope": [f"Deliver {spec['title']}"],
                "deliverables": [f"Working {spec['title']} + docs"],
                "price": spec["price"],
                "base_price": spec["price"],
                "final_price": spec["price"],
                "estimated_hours": spec["hours"],
                "template_type": spec["template_type"],
                "status": "open",
                "assigned_to": None,
                "created_at": (now - timedelta(minutes=minutes_old)).isoformat(),
                "created_by": "bootstrap",
                "bootstrap_tag": BOOTSTRAP_TAG,
            })
            module_ids.append(mid)

    # 4) Bids — cheap → many bids, expensive → few
    bid_count = 0
    existing_bids = await _db.bids.count_documents({"bootstrap_tag": BOOTSTRAP_TAG})
    if existing_bids == 0:
        for mid in module_ids:
            mod = await _db.modules.find_one({"module_id": mid}, {"_id": 0})
            price = mod.get("price", 1000)
            if price < 700:
                n_bids = random.randint(2, 3)
            elif price < 1500:
                n_bids = random.randint(1, 2)
            else:
                n_bids = random.choice([0, 1])
            chosen = random.sample(dev_ids, min(n_bids, len(dev_ids)))
            for dev_id in chosen:
                bid_age_min = random.randint(1, 60)
                await _db.bids.insert_one({
                    "bid_id": f"bid_{uuid.uuid4().hex[:12]}",
                    "module_id": mid,
                    "developer_id": dev_id,
                    "amount": int(price * random.uniform(0.9, 1.1)),
                    "estimated_hours": mod.get("estimated_hours", 10) + random.randint(-2, 2),
                    "message": "Ready to start",
                    "status": "pending",
                    "created_at": (now - timedelta(minutes=bid_age_min)).isoformat(),
                    "bootstrap_tag": BOOTSTRAP_TAG,
                })
                bid_count += 1

    return {
        "ok": True,
        "developers_created": len(dev_ids),
        "modules_created": len(module_ids),
        "bids_created": bid_count,
        "project_id": project_id,
    }


# ─────────────────────────────────────────────────────────────
# Soft simulation — fake→real activity bridge
# ─────────────────────────────────────────────────────────────
async def _simulate_loop(interval_seconds: int):
    """Every 2–5 min: create 1–2 new bids on an open module, OR
    progress one module through its lifecycle."""
    global _sim_running
    _sim_running = True
    logger.info(f"BOOTSTRAP SIMULATION: started (interval ~{interval_seconds}s)")
    try:
        while _sim_running:
            try:
                await _tick_simulation()
            except Exception as e:
                logger.warning(f"sim tick error: {e}")
            sleep_for = random.randint(interval_seconds, interval_seconds + 60)
            await asyncio.sleep(sleep_for)
    finally:
        _sim_running = False
        logger.info("BOOTSTRAP SIMULATION: stopped")


async def _tick_simulation():
    """One unit of simulated market activity."""
    now = _now()
    # 70% of time — add new bids
    # 20% — assign a module (open → in_progress)
    # 10% — advance an assigned module (in_progress → qa_review)
    action = random.choices(["bid", "assign", "advance"], weights=[70, 20, 10])[0]
    devs = await _db.users.find(
        {"role": "developer", "bootstrap_tag": BOOTSTRAP_TAG},
        {"_id": 0, "user_id": 1},
    ).to_list(50)
    if not devs:
        return

    if action == "bid":
        open_mods = await _db.modules.find(
            {"status": {"$in": ["open", "open_for_bids"]}, "bootstrap_tag": BOOTSTRAP_TAG},
            {"_id": 0, "module_id": 1, "price": 1, "estimated_hours": 1},
        ).to_list(50)
        if not open_mods:
            return
        mod = random.choice(open_mods)
        dev = random.choice(devs)
        # Skip if dev already bid on this module
        exists = await _db.bids.find_one({"module_id": mod["module_id"], "developer_id": dev["user_id"]})
        if exists:
            return
        await _db.bids.insert_one({
            "bid_id": f"bid_{uuid.uuid4().hex[:12]}",
            "module_id": mod["module_id"],
            "developer_id": dev["user_id"],
            "amount": int((mod.get("price") or 1000) * random.uniform(0.9, 1.1)),
            "estimated_hours": (mod.get("estimated_hours") or 10) + random.randint(-2, 2),
            "message": "Live bid",
            "status": "pending",
            "created_at": now.isoformat(),
            "bootstrap_tag": BOOTSTRAP_TAG,
        })
        # Update dev last_active
        await _db.users.update_one({"user_id": dev["user_id"]}, {"$set": {"last_active_at": now.isoformat()}})
        logger.info(f"SIM: new bid {dev['user_id'][-6:]} → {mod['module_id'][-6:]}")
        return

    if action == "assign":
        # Find open module with at least one bid, assign to bidder
        pipeline = [
            {"$match": {"bootstrap_tag": BOOTSTRAP_TAG, "status": "pending"}},
            {"$sample": {"size": 1}},
        ]
        bid_docs = await _db.bids.aggregate(pipeline).to_list(1)
        if not bid_docs:
            return
        bid = bid_docs[0]
        mod = await _db.modules.find_one({"module_id": bid["module_id"]})
        if not mod or mod.get("status") not in ("open", "open_for_bids"):
            return
        await _db.modules.update_one(
            {"module_id": bid["module_id"]},
            {"$set": {
                "status": "in_progress",
                "assigned_to": bid["developer_id"],
                "accepted_at": now.isoformat(),
                "started_at": now.isoformat(),
                "last_activity_at": now.isoformat(),
            }},
        )
        await _db.bids.update_one({"bid_id": bid["bid_id"]}, {"$set": {"status": "accepted"}})
        await _db.users.update_one(
            {"user_id": bid["developer_id"]},
            {"$inc": {"active_modules": 1, "active_load": 1}, "$set": {"last_active_at": now.isoformat()}},
        )
        logger.info(f"SIM: assigned {bid['module_id'][-6:]} → {bid['developer_id'][-6:]}")
        return

    if action == "advance":
        in_prog = await _db.modules.find(
            {"bootstrap_tag": BOOTSTRAP_TAG, "status": "in_progress"},
            {"_id": 0, "module_id": 1, "assigned_to": 1},
        ).to_list(50)
        if not in_prog:
            return
        m = random.choice(in_prog)
        await _db.modules.update_one(
            {"module_id": m["module_id"]},
            {"$set": {
                "status": "qa_review",
                "submitted_at": now.isoformat(),
                "last_activity_at": now.isoformat(),
            }},
        )
        logger.info(f"SIM: advanced {m['module_id'][-6:]} → qa_review")


async def start_simulation(interval_seconds: int = 120) -> Dict[str, Any]:
    global _sim_task, _sim_running
    if _sim_running and _sim_task and not _sim_task.done():
        return {"ok": False, "already_running": True}
    _sim_task = asyncio.create_task(_simulate_loop(interval_seconds))
    await asyncio.sleep(0)
    return {"ok": True, "running": True, "interval_seconds": interval_seconds}


async def stop_simulation() -> Dict[str, Any]:
    global _sim_running, _sim_task
    _sim_running = False
    if _sim_task and not _sim_task.done():
        _sim_task.cancel()
        try:
            await _sim_task
        except asyncio.CancelledError:
            pass
    return {"ok": True, "running": False}


# ─────────────────────────────────────────────────────────────
# Shock test
# ─────────────────────────────────────────────────────────────
async def shock_test() -> Dict[str, Any]:
    """Mark 50% of seeded devs as ghosts (last_active_at = 30 days ago)."""
    devs = await _db.users.find(
        {"role": "developer", "bootstrap_tag": BOOTSTRAP_TAG},
        {"_id": 0, "user_id": 1},
    ).to_list(100)
    if not devs:
        return {"ok": False, "reason": "no seeded devs"}
    to_ghost = random.sample(devs, len(devs) // 2)
    stale = (_now() - timedelta(days=30)).isoformat()
    for d in to_ghost:
        await _db.users.update_one(
            {"user_id": d["user_id"]},
            {"$set": {"last_active_at": stale, "shocked": True}},
        )
    return {"ok": True, "devs_ghosted": len(to_ghost), "total_seed_devs": len(devs)}


# ─────────────────────────────────────────────────────────────
# Reset
# ─────────────────────────────────────────────────────────────
async def reset_bootstrap() -> Dict[str, Any]:
    await stop_simulation()
    deleted = {
        "users": (await _db.users.delete_many({"bootstrap_tag": BOOTSTRAP_TAG})).deleted_count,
        "projects": (await _db.projects.delete_many({"bootstrap_tag": BOOTSTRAP_TAG})).deleted_count,
        "modules": (await _db.modules.delete_many({"bootstrap_tag": BOOTSTRAP_TAG})).deleted_count,
        "bids": (await _db.bids.delete_many({"bootstrap_tag": BOOTSTRAP_TAG})).deleted_count,
    }
    return {"ok": True, "deleted": deleted}


async def status() -> Dict[str, Any]:
    devs = await _db.users.count_documents({"role": "developer", "bootstrap_tag": BOOTSTRAP_TAG})
    mods_open = await _db.modules.count_documents({"bootstrap_tag": BOOTSTRAP_TAG, "status": {"$in": ["open", "open_for_bids"]}})
    mods_in_progress = await _db.modules.count_documents({"bootstrap_tag": BOOTSTRAP_TAG, "status": "in_progress"})
    mods_qa = await _db.modules.count_documents({"bootstrap_tag": BOOTSTRAP_TAG, "status": {"$in": ["qa_review", "review", "in_review"]}})
    bids = await _db.bids.count_documents({"bootstrap_tag": BOOTSTRAP_TAG})
    ghosted = await _db.users.count_documents({"role": "developer", "bootstrap_tag": BOOTSTRAP_TAG, "shocked": True})
    return {
        "seeded_developers": devs,
        "ghosted_developers": ghosted,
        "modules": {"open": mods_open, "in_progress": mods_in_progress, "qa": mods_qa},
        "bids": bids,
        "simulation_running": _sim_running,
    }


# ─────────────────────────────────────────────────────────────
# Router
# ─────────────────────────────────────────────────────────────
def build_router(*, admin_dep: Callable) -> APIRouter:
    r = APIRouter(tags=["market-bootstrap"])

    @r.post("/bootstrap/seed")
    async def _seed(admin=Depends(admin_dep)):
        return await seed_market()

    @r.post("/bootstrap/simulate/start")
    async def _sim_start(admin=Depends(admin_dep), interval_seconds: int = 120):
        return await start_simulation(interval_seconds)

    @r.post("/bootstrap/simulate/stop")
    async def _sim_stop(admin=Depends(admin_dep)):
        return await stop_simulation()

    @r.post("/bootstrap/shock")
    async def _shock(admin=Depends(admin_dep)):
        return await shock_test()

    @r.post("/bootstrap/reset")
    async def _reset(admin=Depends(admin_dep)):
        return await reset_bootstrap()

    @r.get("/bootstrap/status")
    async def _status(admin=Depends(admin_dep)):
        return await status()

    return r
