"""
Block A3 — Admin Risk Map (READ-ONLY, AGGREGATION ONLY)

One endpoint: GET /api/admin/risk

Purpose:
    "Where does it hurt right now?"

    A3 is NOT:
      - a scoring system (no risk_score, no formulas)
      - a recommendation engine
      - a second source of truth for severity/status

    A3 is ONLY:
      - portfolio breakdown per project risk state
        (reuses _risk_state from client_operator — single source of truth)
      - counts of auto_actions by severity and by type
        (pure passthrough — never recomputes severity)
      - top problem spots (deduped event streams sorted by
        severity → count → recency)
      - a fixed static mapping from action.type → human headline
        (NOT generation, NOT AI, just a dict lookup)

    If the severity is wrong in the DB, it's wrong here — by design.
    The event engine is the source of truth; A3 only projects it.

    No new collections. Reads db.modules, db.payouts (for _cost_status),
    db.projects, db.auto_actions.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException

from client_operator import _cost_status, _risk_state

router = APIRouter(prefix="/api", tags=["admin-risk"])

# Same caps as A2 — consistent operator-journal window.
_MAX_SCAN = 500
_TOP_N    = 10

# Fixed dict. Never generated. If a new action.type appears, it falls
# back to the generic headline until we add a line here.
_HEADLINES: Dict[str, str] = {
    "auto_project_pause": "Repeated project pauses — system cannot stabilize delivery",
    "auto_pause":         "Module repeatedly paused — cost or performance issue",
    "auto_rebalance":     "Team unstable — frequent rebalancing detected",
    "auto_review_flag":   "Flagged for QA review repeatedly",
    "auto_add_support":   "System repeatedly adding support — bottleneck detected",
    "auto_escalate":      "Escalations detected — needs attention",
}

# Sort priority. Lower wins.
_SEVERITY_ORDER: Dict[str, int] = {"critical": 0, "warning": 1, "info": 2}


def init_router(db, get_current_user_dep):

    @router.get("/admin/risk")
    async def admin_risk(user=Depends(get_current_user_dep)) -> Dict[str, Any]:
        # Admin-only surface.
        role = user.role if hasattr(user, "role") else user.get("role")
        if role != "admin":
            raise HTTPException(status_code=403, detail="Admin only")

        # ── 1. PORTFOLIO ──────────────────────────────────────────────────
        # Reuses _risk_state from client_operator — same helper used by
        # admin_production and client_workspace. If that helper changes,
        # all three surfaces see the same reality.
        modules = await db.modules.find({}, {"_id": 0}).to_list(20000)
        module_ids = [m["module_id"] for m in modules if m.get("module_id")]

        # Batched payouts lookup → earned per module (same rule as Operator/Costs)
        earned_by_mod: Dict[str, float] = {}
        if module_ids:
            pos = await db.payouts.find(
                {"module_id": {"$in": module_ids},
                 "status": {"$in": ["approved", "paid"]}},
                {"_id": 0, "module_id": 1, "amount": 1},
            ).to_list(100000)
            for p in pos:
                mid = p.get("module_id")
                if mid:
                    earned_by_mod[mid] = earned_by_mod.get(mid, 0.0) + float(p.get("amount") or 0)

        by_project: Dict[str, List[Dict[str, Any]]] = {}
        for m in modules:
            pid = m.get("project_id")
            if not pid:
                continue
            revenue = float(m.get("final_price") or m.get("price") or 0)
            cost    = float(m.get("base_price")  or revenue)
            earned  = earned_by_mod.get(m.get("module_id") or "", 0.0)
            by_project.setdefault(pid, []).append({
                "status":      m.get("status") or "pending",
                "paused_by":   m.get("paused_by"),
                "cost_status": _cost_status(earned, cost),
            })

        portfolio = {"healthy": 0, "watch": 0, "at_risk": 0, "blocked": 0}
        for _pid, mods in by_project.items():
            state = _risk_state(mods)
            portfolio[state] = portfolio.get(state, 0) + 1

        # ── 2. ACTIONS: BY SEVERITY / BY TYPE + TOP RISKS ────────────────
        # Same dedupe key as A2. Same passthrough. NO recomputation.
        raw = await db.auto_actions.find({}, {"_id": 0}) \
            .sort("created_at", -1) \
            .to_list(_MAX_SCAN)

        # Aggregate event streams (same algorithm as A2).
        groups: Dict[tuple, Dict[str, Any]] = {}
        for a in raw:   # newest-first
            mid = a.get("module_id")
            pid = a.get("project_id")
            t   = a.get("type") or "unknown"
            key = (mid if mid else f"_project:{pid or 'none'}", t)

            g = groups.get(key)
            if g is None:
                groups[key] = {
                    "project_id":    pid,
                    "module_id":     mid,
                    "type":          t,
                    "severity":      a.get("severity") or "info",  # PASSTHROUGH
                    "source":        a.get("source")   or "unknown",
                    "count":         1,
                    "first_seen_at": a.get("created_at"),
                    "last_seen_at":  a.get("created_at"),
                }
            else:
                g["count"] += 1
                g["first_seen_at"] = a.get("created_at") or g["first_seen_at"]

        # Faithful counts.
        by_severity: Dict[str, int] = {}
        by_type:     Dict[str, int] = {}
        for g in groups.values():
            sev = g["severity"]
            typ = g["type"]
            by_severity[sev] = by_severity.get(sev, 0) + 1
            by_type[typ]     = by_type.get(typ, 0) + 1

        # ── 3. TOP RISKS ─────────────────────────────────────────────────
        # Priority: severity (critical→info) → count desc → last_seen_at desc.
        # NO risk_score. NO composite. Python's stable sort + two passes:
        #   1. By last_seen_at desc (tertiary, applied first)
        #   2. By (severity, -count) (primary+secondary, applied last)
        # Stability keeps tertiary order inside equal primary+secondary buckets.
        ordered = sorted(
            groups.values(),
            key=lambda g: str(g.get("last_seen_at") or ""),
            reverse=True,
        )
        ordered.sort(key=lambda g: (
            _SEVERITY_ORDER.get(g["severity"], 99),
            -int(g["count"]),
        ))

        top = ordered[:_TOP_N]

        # Batched title enrichment (no N+1).
        top_pids = list({g["project_id"] for g in top if g.get("project_id")})
        title_by_pid: Dict[str, str] = {}
        if top_pids:
            prjs = await db.projects.find(
                {"project_id": {"$in": top_pids}},
                {"_id": 0, "project_id": 1, "name": 1, "title": 1},
            ).to_list(len(top_pids))
            title_by_pid = {p["project_id"]: (p.get("name") or p.get("title") or "")
                            for p in prjs}

        top_risks: List[Dict[str, Any]] = []
        for g in top:
            top_risks.append({
                "project_id":    g.get("project_id"),
                "project_title": title_by_pid.get(g.get("project_id") or "", ""),
                "severity":      g["severity"],
                "type":          g["type"],
                "count":         g["count"],
                "last_seen_at":  g["last_seen_at"],
                "headline":      _HEADLINES.get(g["type"], "System detected repeated issues"),
            })

        return {
            "portfolio":   portfolio,
            "by_severity": by_severity,
            "by_type":     by_type,
            "top_risks":   top_risks,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    return router
