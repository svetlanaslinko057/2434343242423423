"""
Wave 10 — Revenue Brain
=======================

Demand-side intelligence. Detects revenue opportunities per client and
proposes next logical step (expand / upgrade / renew / retain). NOT
"sell harder" — show the next move with explicit reasons.

Canonical collections (introduced by this layer):
  - expansion_opportunities
  - retainer_offers

Reads:
  users, invoices, projects, modules, deliverables, events

Never mutates existing web collections arbitrarily. Writes into invoices
and change_requests ONLY when client explicitly accepts an opportunity
(this is the defined contract: accept → generate invoice).

Public surface:
  build_router(user_dep, admin_dep, role_dep_factory) → APIRouter
  compute_client_brain(client_id)
  detect_revenue_actions() — for operator rules 7..10
  wire(db, realtime, event_engine=None)
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from revenue_brain_lib import (
    payment_velocity_score, approval_speed_score, expansion_readiness,
    retention_risk, classify_segment, adjacent_module_suggestions,
    speed_upgrade_offer, retainer_template,
)

logger = logging.getLogger("revenue_brain")

# ─────────────────────────────────────────────────────────────
# Runtime wiring
# ─────────────────────────────────────────────────────────────
_db = None
_realtime = None
_event_engine = None

# Statuses tolerated as "done" for a module (mobile used 'done'; ATLLAS uses 'completed'/'approved')
MODULE_DONE = ("done", "completed", "approved")
# Statuses tolerated as "pending payment" (mobile 'issued', 'pending_payment'; ATLLAS 'pending')
INVOICE_PENDING = ("issued", "pending", "pending_payment")
INVOICE_OVERDUE = ("overdue",)
INVOICE_PAID = ("paid",)


def wire(*, db, realtime, event_engine=None):
    global _db, _realtime, _event_engine
    _db = db
    _realtime = realtime
    _event_engine = event_engine


def _now():
    return datetime.now(timezone.utc)


def _now_iso():
    return _now().isoformat()


def _uid():
    return str(uuid.uuid4())


async def _emit_event(event_type: str, payload: Dict[str, Any], roles: List[str]):
    """Persist event via existing event_engine and fan out via Socket.IO."""
    try:
        if _event_engine and hasattr(_event_engine, "create_event"):
            ev = _event_engine.create_event(
                event_type=event_type,
                entity_type="revenue",
                entity_id=payload.get("opportunity_id") or payload.get("offer_id") or payload.get("project_id") or "system",
                severity="medium",
                title=event_type,
                message=payload.get("title") or event_type,
                project_id=payload.get("project_id"),
                meta=payload,
            )
            await _db.events.insert_one(ev)
    except Exception as e:
        logger.warning(f"revenue emit_event failed: {e}")
    try:
        if _realtime is not None:
            for role in roles:
                await _realtime.emit_to_role(role, event_type, payload)
    except Exception as e:
        logger.warning(f"revenue realtime emit failed: {e}")


# ─────────────────────────────────────────────────────────────
# Aggregator (read-only)
# ─────────────────────────────────────────────────────────────
async def compute_client_brain(client_id: str) -> Dict[str, Any]:
    client = await _db.users.find_one({"user_id": client_id, "role": "client"}, {"_id": 0})
    if not client:
        return {}

    invoices = await _db.invoices.find({"client_id": client_id}, {"_id": 0}).to_list(200)
    projects = await _db.projects.find({"client_id": client_id}, {"_id": 0}).to_list(50)
    project_ids = [p["project_id"] for p in projects]
    modules = await _db.modules.find({"project_id": {"$in": project_ids}}, {"_id": 0}).to_list(500) if project_ids else []
    deliverables = await _db.deliverables.find({"project_id": {"$in": project_ids}}, {"_id": 0}).to_list(200) if project_ids else []

    # Normalise module "done" status for the pure scorer (expects 'done')
    for m in modules:
        if m.get("status") in MODULE_DONE:
            m["status"] = "done"
    # Normalise invoice statuses used by payment_velocity_score
    for i in invoices:
        st = i.get("status")
        if st in INVOICE_PENDING: i["status"] = "issued"
        elif st in INVOICE_OVERDUE: i["status"] = "overdue"
        elif st in INVOICE_PAID: i["status"] = "paid"

    pv = payment_velocity_score(invoices)
    asp = approval_speed_score(deliverables)
    total = len(modules)
    done_ratio = (sum(1 for m in modules if m["status"] == "done") / total) if total else 0
    trust = max(0, min(100, int(client.get("rating") or 70)))

    week_ago = (_now() - timedelta(days=7)).isoformat()
    recent = await _db.events.count_documents({"meta.client_id": client_id, "created_at": {"$gte": week_ago}}) \
        if hasattr(_db, "events") else 0
    recent_engagement = min(100, recent * 15)

    exp_score = expansion_readiness(pv["score"], asp["score"], done_ratio, trust, recent_engagement)
    low_activity = 100 - recent_engagement
    ret_score = retention_risk(pv, low_activity, asp, 0)
    total_spend = sum(i.get("amount", 0) for i in invoices if i.get("status") == "paid")
    segment = classify_segment(exp_score, ret_score, pv["score"], total_spend)

    return {
        "client_id": client_id,
        "name": client.get("name"),
        "segment": segment,
        "payment_velocity_score": pv["score"],
        "payment_velocity_detail": pv,
        "approval_speed_score": asp["score"],
        "approval_speed_detail": asp,
        "expansion_readiness_score": exp_score,
        "retention_risk_score": ret_score,
        "total_spend": total_spend,
        "projects": projects,
        "modules_done": sum(1 for m in modules if m["status"] == "done"),
        "modules_total": total,
        "invoices_pending": [i for i in invoices if i.get("status") == "issued"],
        "invoices_overdue": [i for i in invoices if i.get("status") == "overdue"],
        "updated_at": _now_iso(),
    }


async def sum_open_opps(client_id: str) -> int:
    opps = await _db.expansion_opportunities.find(
        {"client_id": client_id, "status": "open"}, {"price": 1, "_id": 0},
    ).to_list(100)
    return sum(o.get("price", 0) for o in opps)


async def generate_opportunities_for_project(project: Dict[str, Any], brain: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Idempotent by (project_id, type, title). Safe to re-invoke."""
    mods = await _db.modules.find({"project_id": project["project_id"]}, {"_id": 0}).to_list(200)
    # Normalise
    for m in mods:
        if m.get("status") in MODULE_DONE:
            m["status"] = "done"
    done = [m for m in mods if m["status"] == "done"]
    segment = brain["segment"]
    exp_score = brain["expansion_readiness_score"]

    produced: List[Dict[str, Any]] = []

    if segment != "churn_risk" and exp_score >= 55:
        for s in adjacent_module_suggestions(done):
            priority = "high" if exp_score >= 75 else "medium"
            price = s["price"]
            if segment == "premium_ready":
                price = round(price * 0.92)
            produced.append({
                "opportunity_id": _uid(),
                "client_id": brain["client_id"],
                "project_id": project["project_id"],
                "type": s["type"],
                "title": s["title"],
                "description": s["reason"][0] if s["reason"] else "Logical next step",
                "price": price,
                "eta_days": s["eta_days"],
                "priority": priority,
                "reason": s["reason"],
                "expected_impact": s.get("expected_impact", {}),
                "status": "open",
                "created_at": _now_iso(),
            })

    if segment not in ("slow_payer", "churn_risk"):
        su = speed_upgrade_offer(project)
        if su:
            produced.append({
                "opportunity_id": _uid(),
                "client_id": brain["client_id"],
                "project_id": project["project_id"],
                "type": su["type"],
                "title": su["title"],
                "description": su["reason"][0] if su.get("reason") else "",
                "price": su["price"],
                "eta_days": su["eta_days"],
                "priority": "medium",
                "reason": su["reason"],
                "expected_impact": su.get("expected_impact", {}),
                "status": "open",
                "created_at": _now_iso(),
            })

    created: List[Dict[str, Any]] = []
    for o in produced:
        existing = await _db.expansion_opportunities.find_one(
            {"project_id": o["project_id"], "type": o["type"], "title": o["title"], "status": "open"},
            {"_id": 0},
        )
        if existing:
            continue
        await _db.expansion_opportunities.insert_one(o)
        await _emit_event("opportunity:created", {
            "opportunity_id": o["opportunity_id"], "client_id": o["client_id"],
            "project_id": o["project_id"], "title": o["title"], "price": o["price"],
        }, ["admin", "client"])
        o.pop("_id", None)
        created.append(o)
    return created


async def ensure_retainer_offer(project: Dict[str, Any], brain: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    progress = project.get("progress_percentage", 0) or 0
    # Fallback — derive progress if not stored
    if progress == 0:
        mods = await _db.modules.find({"project_id": project["project_id"]}, {"_id": 0}).to_list(200)
        if mods:
            done = sum(1 for m in mods if m.get("status") in MODULE_DONE)
            progress = int(done * 100 / len(mods))
    if progress < 80 or brain["segment"] in ("churn_risk", "slow_payer"):
        return None
    existing = await _db.retainer_offers.find_one(
        {"project_id": project["project_id"], "status": {"$in": ["draft", "offered"]}},
        {"_id": 0},
    )
    if existing:
        existing.pop("_id", None)
        return existing
    tpl = retainer_template(project, brain["total_spend"])
    offer = {
        "offer_id": _uid(),
        "client_id": brain["client_id"],
        "project_id": project["project_id"],
        "project_title": project.get("name") or project.get("title"),
        "type": tpl["type"],
        "monthly_price": tpl["monthly_price"],
        "included": tpl["included"],
        "reason": ["Project near completion", "Keep momentum and uptime", "Faster fixes, lower risk"],
        "status": "offered",
        "created_at": _now_iso(),
    }
    await _db.retainer_offers.insert_one(offer)
    await _emit_event("retainer:offered", {
        "offer_id": offer["offer_id"], "client_id": offer["client_id"],
        "monthly_price": offer["monthly_price"],
    }, ["admin", "client"])
    offer.pop("_id", None)
    return offer


# ─────────────────────────────────────────────────────────────
# Operator surface (Wave 10 rules 7..10)
# ─────────────────────────────────────────────────────────────
async def detect_revenue_actions() -> List[Dict[str, Any]]:
    """
    Surface 4 operator rules:
      - churn_risk             (priority 1)
      - expansion_ready        (priority 2)
      - retainer_ready         (priority 3)
      - premium_upgrade_ready  (priority 4)
    Returns action dicts compatible with operator_engine shape.
    """
    if _db is None:
        return []
    actions: List[Dict[str, Any]] = []
    clients = await _db.users.find({"role": "client"}, {"_id": 0}).to_list(500)
    for c in clients:
        brain = await compute_client_brain(c["user_id"])
        if not brain:
            continue
        seg = brain["segment"]
        exp = brain["expansion_readiness_score"]
        ret = brain["retention_risk_score"]
        name = brain.get("name") or "Client"

        # churn_risk — priority 1
        if seg == "churn_risk":
            actions.append({
                "id": f"churn_risk:{c['user_id']}",
                "type": "churn_risk",
                "severity": "critical",
                "auto_eligible": False,
                "title": f"{name} at churn risk",
                "project": "—", "project_id": None,
                "client_id": c["user_id"],
                "description": f"Retention score {ret}, payment velocity {brain['payment_velocity_score']}",
                "suggestion": "Personal check-in — offer support/discount",
                "expected_impact": {"retention": f"${brain['total_spend']}", "next_year_ltv": "significant"},
                "confidence": 74,
                "why": [f"Retention risk {ret}/100", "Low payment velocity", "Engagement dropping"],
            })
            continue  # do not surface others for the same client

        # expansion_ready — priority 2
        if seg == "expansion_ready" and exp >= 70:
            open_value = await sum_open_opps(c["user_id"])
            actions.append({
                "id": f"expansion_ready:{c['user_id']}",
                "type": "expansion_ready",
                "severity": "high",
                "auto_eligible": True,
                "auto_action": "generate_opportunities",
                "title": f"{name} ready to expand",
                "project": "—", "project_id": None,
                "client_id": c["user_id"],
                "description": f"Expansion score {exp}, open value ${open_value}",
                "suggestion": "Auto-generate opportunities across active projects",
                "expected_impact": {"potential_revenue": f"${open_value or 2000}+"},
                "confidence": 78,
                "why": [f"Expansion readiness {exp}", "Strong payment velocity", "Approvals moving fast"],
            })
            continue

        # premium_upgrade_ready — priority 4
        if seg == "premium_ready":
            actions.append({
                "id": f"premium_upgrade_ready:{c['user_id']}",
                "type": "premium_upgrade_ready",
                "severity": "medium",
                "auto_eligible": True,
                "auto_action": "generate_opportunities",
                "title": f"{name} fits premium upgrade path",
                "project": "—", "project_id": None,
                "client_id": c["user_id"],
                "description": f"High spend ${brain['total_spend']}, healthy signals",
                "suggestion": "Offer bundle discount on next module",
                "expected_impact": {"discount": "8%", "revenue_pull_forward": "likely"},
                "confidence": 65,
                "why": [f"Total spend ${brain['total_spend']}", "Premium cohort", "Expansion readiness ok"],
            })

        # retainer_ready — priority 3 (per project near completion)
        if seg not in ("churn_risk", "slow_payer"):
            for p in brain["projects"]:
                prog = p.get("progress_percentage") or 0
                if prog == 0:
                    mods = await _db.modules.find({"project_id": p["project_id"]}, {"_id": 0}).to_list(200)
                    if mods:
                        done = sum(1 for m in mods if m.get("status") in MODULE_DONE)
                        prog = int(done * 100 / len(mods))
                if prog < 80:
                    continue
                existing = await _db.retainer_offers.find_one(
                    {"project_id": p["project_id"], "status": {"$in": ["offered", "accepted"]}},
                    {"_id": 0},
                )
                if existing:
                    continue
                actions.append({
                    "id": f"retainer_ready:{c['user_id']}:{p['project_id']}",
                    "type": "retainer_ready",
                    "severity": "medium",
                    "auto_eligible": True,
                    "auto_action": "ensure_retainer_offer",
                    "title": f"Retainer opportunity on {p.get('name') or p.get('title')}",
                    "project": p.get("name") or p.get("title"), "project_id": p["project_id"],
                    "client_id": c["user_id"],
                    "description": f"Project {prog}% done; client {seg}",
                    "suggestion": "Create retainer offer",
                    "expected_impact": {"mrr": "+$X/mo", "retention": "strengthened"},
                    "confidence": 70,
                    "why": [f"Project {prog}% complete", f"Segment {seg}", "No active retainer"],
                })

    return actions


# ─────────────────────────────────────────────────────────────
# Router factory
# ─────────────────────────────────────────────────────────────
def build_router(*, client_dep: Callable, admin_dep: Callable, user_dep: Callable) -> APIRouter:
    r = APIRouter(tags=["revenue-brain"])

    # ─── CLIENT ENDPOINTS ───
    @r.get("/client/opportunities")
    async def client_opportunities(user=Depends(client_dep)):
        uid = getattr(user, "user_id", None)
        brain = await compute_client_brain(uid)
        if not brain:
            return {"opportunities": []}
        for p in brain["projects"]:
            await generate_opportunities_for_project(p, brain)
        opps = await _db.expansion_opportunities.find(
            {"client_id": uid, "status": "open"}, {"_id": 0},
        ).sort("created_at", -1).to_list(50)
        return {
            "opportunities": opps,
            "segment": brain["segment"],
            "expansion_readiness_score": brain["expansion_readiness_score"],
        }

    @r.get("/client/expansion-suggestions")
    async def expansion_suggestions(user=Depends(client_dep)):
        res = await client_opportunities(user=user)  # type: ignore
        return {"suggestions": [o for o in res["opportunities"] if o["type"] in ("upsell_module", "speed_upgrade")]}

    @r.get("/client/retainer-offer")
    async def client_retainer_offer(user=Depends(client_dep)):
        uid = getattr(user, "user_id", None)
        brain = await compute_client_brain(uid)
        if not brain:
            return {"offer": None}
        for p in brain["projects"]:
            await ensure_retainer_offer(p, brain)
        offer = await _db.retainer_offers.find_one(
            {"client_id": uid, "status": "offered"}, {"_id": 0},
            sort=[("created_at", -1)],
        )
        return {"offer": offer}

    @r.get("/client/revenue-timeline")
    async def client_revenue_timeline(user=Depends(client_dep)):
        uid = getattr(user, "user_id", None)
        brain = await compute_client_brain(uid)
        if not brain:
            return {}
        open_opps = await _db.expansion_opportunities.find(
            {"client_id": uid, "status": "open"}, {"_id": 0},
        ).to_list(50)
        retainer = await _db.retainer_offers.find_one(
            {"client_id": uid, "status": "offered"}, {"_id": 0},
            sort=[("created_at", -1)],
        )
        pending_invoices = brain["invoices_pending"] + brain["invoices_overdue"]
        next_payment = min(pending_invoices, key=lambda i: i.get("due_date") or "9999") if pending_invoices else None
        open_opps_value = sum(o.get("price", 0) for o in open_opps)
        ltv_estimate = brain["total_spend"] + open_opps_value + ((retainer["monthly_price"] * 12) if retainer else 0)
        return {
            "current_spend": brain["total_spend"],
            "next_expected_payment": next_payment["amount"] if next_payment else 0,
            "next_expected_date": next_payment.get("due_date") if next_payment else None,
            "next_expected_invoice_number": (next_payment or {}).get("invoice_number"),
            "open_opportunities_count": len(open_opps),
            "open_opportunities_value": open_opps_value,
            "retainer_offer_value": retainer["monthly_price"] if retainer else 0,
            "lifetime_value_estimate": ltv_estimate,
            "segment": brain["segment"],
        }

    @r.post("/client/opportunities/{opp_id}/accept")
    async def accept_opportunity(opp_id: str, user=Depends(client_dep)):
        uid = getattr(user, "user_id", None)
        opp = await _db.expansion_opportunities.find_one(
            {"opportunity_id": opp_id, "client_id": uid, "status": "open"}, {"_id": 0},
        )
        if not opp:
            raise HTTPException(404, "Opportunity not found")
        await _db.expansion_opportunities.update_one(
            {"opportunity_id": opp_id},
            {"$set": {"status": "accepted", "accepted_at": _now_iso()}},
        )

        created_entity = None
        if opp["type"] == "upsell_module":
            module = {
                "module_id": _uid(), "project_id": opp["project_id"], "title": opp["title"],
                "description": opp.get("description", ""), "type": "backend",
                "complexity": max(1, round(opp["price"] / 200)), "price": opp["price"],
                "tier_required": "any", "status": "open", "assigned_to": None,
                "revision_count": 0, "hours_spent": 0, "hours_estimated": opp["eta_days"] * 4,
                "deliverable_url": None, "created_at": _now_iso(), "started_at": None,
                "completed_at": None, "submission_notes": None,
                "origin": "opportunity", "origin_id": opp_id,
            }
            await _db.modules.insert_one(module)
            created_entity = {"kind": "module", "id": module["module_id"]}
            await _emit_event("module:created", {
                "module_id": module["module_id"], "project_id": opp["project_id"],
                "origin": "opportunity",
            }, ["admin", "developer"])
        elif opp["type"] == "speed_upgrade":
            cr = {
                "cr_id": _uid(), "project_id": opp["project_id"], "client_id": uid,
                "title": opp["title"], "description": "Accepted speed upgrade",
                "reason": "; ".join(opp.get("reason", [])), "status": "approved",
                "impact_price": opp["price"], "impact_time_hours": -20,
                "created_at": _now_iso(), "origin": "opportunity", "origin_id": opp_id,
            }
            await _db.change_requests.insert_one(cr)
            created_entity = {"kind": "change_request", "id": cr["cr_id"]}

        inv_num = f"INV-OPP-{_uid()[:6].upper()}"
        inv = {
            "invoice_id": _uid(), "project_id": opp["project_id"], "client_id": uid,
            "invoice_number": inv_num, "amount": opp["price"], "status": "pending",
            "line_items": [{"description": opp["title"], "amount": opp["price"]}],
            "due_date": (_now() + timedelta(days=14)).isoformat(),
            "paid_at": None, "created_at": _now_iso(), "origin": "opportunity",
        }
        await _db.invoices.insert_one(inv)
        await _emit_event("opportunity:accepted", {
            "opportunity_id": opp_id, "client_id": uid,
            "invoice_id": inv["invoice_id"], "amount": opp["price"],
        }, ["admin", "client"])
        return {"ok": True, "invoice_number": inv_num, "amount": opp["price"], "created_entity": created_entity}

    @r.post("/client/opportunities/{opp_id}/dismiss")
    async def dismiss_opportunity(opp_id: str, user=Depends(client_dep)):
        uid = getattr(user, "user_id", None)
        res = await _db.expansion_opportunities.update_one(
            {"opportunity_id": opp_id, "client_id": uid, "status": "open"},
            {"$set": {"status": "dismissed", "dismissed_at": _now_iso()}},
        )
        if res.matched_count == 0:
            raise HTTPException(404, "Opportunity not found")
        return {"ok": True}

    @r.post("/client/retainer/{offer_id}/accept")
    async def accept_retainer(offer_id: str, user=Depends(client_dep)):
        uid = getattr(user, "user_id", None)
        offer = await _db.retainer_offers.find_one(
            {"offer_id": offer_id, "client_id": uid, "status": "offered"}, {"_id": 0},
        )
        if not offer:
            raise HTTPException(404, "Offer not found")
        await _db.retainer_offers.update_one(
            {"offer_id": offer_id},
            {"$set": {"status": "accepted", "accepted_at": _now_iso()}},
        )
        inv_num = f"INV-RET-{_uid()[:6].upper()}"
        inv = {
            "invoice_id": _uid(), "project_id": offer["project_id"], "client_id": uid,
            "invoice_number": inv_num, "amount": offer["monthly_price"], "status": "pending",
            "line_items": [{"description": f"Monthly retainer — {offer['type']}", "amount": offer["monthly_price"]}],
            "due_date": (_now() + timedelta(days=14)).isoformat(),
            "paid_at": None, "created_at": _now_iso(), "origin": "retainer",
        }
        await _db.invoices.insert_one(inv)
        await _emit_event("retainer:accepted", {
            "offer_id": offer_id, "client_id": uid, "monthly_price": offer["monthly_price"],
        }, ["admin", "client"])
        return {"ok": True, "invoice_number": inv_num}

    # ─── ADMIN ENDPOINTS ───
    @r.get("/admin/segments")
    async def admin_segments(user=Depends(admin_dep)):
        clients = await _db.users.find({"role": "client"}, {"_id": 0}).to_list(500)
        buckets: Dict[str, List[Dict[str, Any]]] = {
            "expansion_ready": [], "premium_ready": [], "stable_core": [],
            "slow_payer": [], "churn_risk": [],
        }
        for c in clients:
            brain = await compute_client_brain(c["user_id"])
            if not brain:
                continue
            open_value = await sum_open_opps(c["user_id"])
            entry = {
                "client_id": brain["client_id"],
                "name": brain["name"],
                "segment": brain["segment"],
                "expansion_readiness_score": brain["expansion_readiness_score"],
                "retention_risk_score": brain["retention_risk_score"],
                "payment_velocity_score": brain["payment_velocity_score"],
                "total_spend": brain["total_spend"],
                "open_opportunities_value": open_value,
            }
            buckets.setdefault(brain["segment"], []).append(entry)
        return {"segments": buckets, "totals": {k: len(v) for k, v in buckets.items()}}

    @r.get("/admin/client-revenue-brain")
    async def admin_revenue_brain(user=Depends(admin_dep)):
        clients = await _db.users.find({"role": "client"}, {"_id": 0}).to_list(500)
        expansion_ready, premium_ready, churn_risk = [], [], []
        total_open_value = 0
        for c in clients:
            brain = await compute_client_brain(c["user_id"])
            if not brain:
                continue
            v = await sum_open_opps(c["user_id"])
            total_open_value += v
            row = {
                "client_id": c["user_id"], "name": brain["name"],
                "score": brain["expansion_readiness_score"], "open_value": v,
            }
            if brain["segment"] == "expansion_ready":
                expansion_ready.append(row)
            elif brain["segment"] == "premium_ready":
                premium_ready.append(row)
            elif brain["segment"] == "churn_risk":
                churn_risk.append({
                    "client_id": c["user_id"], "name": brain["name"],
                    "risk": brain["retention_risk_score"],
                })
        return {
            "expansion_ready": expansion_ready,
            "premium_ready": premium_ready,
            "churn_risk": churn_risk,
            "open_opportunities_value": total_open_value,
        }

    @r.post("/admin/opportunities/generate/{project_id}")
    async def admin_generate(project_id: str, user=Depends(admin_dep)):
        p = await _db.projects.find_one({"project_id": project_id}, {"_id": 0})
        if not p:
            raise HTTPException(404, "Project not found")
        brain = await compute_client_brain(p.get("client_id"))
        if not brain:
            raise HTTPException(400, "Client not found")
        created = await generate_opportunities_for_project(p, brain)
        retainer = await ensure_retainer_offer(p, brain)
        return {"created": created, "retainer": retainer}

    return r
