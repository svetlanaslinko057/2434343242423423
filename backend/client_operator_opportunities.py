"""
Block 8.2 — Profit Opportunities (READ-ONLY, SUGGESTIONS ONLY)

One endpoint: GET /api/client/operator/opportunities

Four opportunity types, all computed on the fly from existing collections.
NO new writes. NO auto-actions. NO new scores. NO writes to auto_actions.
Rules are deterministic, bounded, and each has a stated `confidence`.

Sources (existing):
  - db.modules                   (cost, revenue, status, progress-implied, assigned_to)
  - db.payouts                   (earned — same rule as /client/costs)
  - db.developer_scores          (combined_score, band, quality_score, reliability_score)
  - db.projects                  (client scoping)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

router = APIRouter(prefix="/api", tags=["client-operator-opportunities"])

# ─── Tunables (kept tiny on purpose) ───────────────────────────────────────
WEAK_DEV_THRESHOLD       = 0.60   # combined_score at or below is "weak / expensive for quality"
STRONG_DEV_THRESHOLD     = 0.80   # combined_score at or above is "strong"
STALE_DAYS_SLOW          = 7      # module in_progress for >7d with low progress
BOTTLENECK_MIN_MODULES   = 2      # same dev holding 2+ active modules
MIN_PROFIT_IMPACT_USD    = 25     # below this we don't even surface it


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _days_since(iso: Optional[str]) -> float:
    dt = _parse_iso(iso)
    if not dt:
        return 0.0
    return max(0.0, (datetime.now(timezone.utc) - dt).total_seconds() / 86400)


def _safety_level(opp_type: str, confidence: float) -> str:
    """
    Whether it's safe to auto-apply this suggestion.

    safe    — confidence high enough AND type has well-bounded impact
    caution — meaningful signal but touches team composition
    risky   — weak signal or effect too coupled to other actors
    """
    # overpaying = direct $ leak — we trust it the most when confidence is high
    if opp_type == "overpaying" and confidence >= 0.85:
        return "safe"
    # underutilized / bottleneck are structural → always caution minimum
    if opp_type == "overpaying" and confidence >= 0.70:
        return "caution"
    if opp_type in ("underutilized", "bottleneck", "slow_delivery") and confidence >= 0.80:
        return "caution"
    return "risky"


def _is_auto_applicable(safety: str, opp_type: str) -> bool:
    """
    Auto-apply gate. Intentionally conservative:
    only 'safe' + overpaying is ever eligible. Everything else stays human-in-the-loop.
    """
    return safety == "safe" and opp_type == "overpaying"


def init_router(db, get_current_user_dep):

    async def _gather_client_modules(client_id: str) -> List[Dict[str, Any]]:
        projects = await db.projects.find(
            {"client_id": client_id}, {"_id": 0},
        ).to_list(200)
        pid_set = [p["project_id"] for p in projects]
        if not pid_set:
            return []
        title_by_pid = {p["project_id"]: (p.get("name") or p.get("title") or "") for p in projects}
        mods = await db.modules.find(
            {"project_id": {"$in": pid_set}}, {"_id": 0},
        ).to_list(2000)
        for m in mods:
            m["_project_title"] = title_by_pid.get(m.get("project_id"), "")
        return mods

    async def _earned_map(module_ids: List[str]) -> Dict[str, float]:
        if not module_ids:
            return {}
        pos = await db.payouts.find(
            {"module_id": {"$in": module_ids},
             "status": {"$in": ["approved", "paid"]}},
            {"_id": 0, "module_id": 1, "amount": 1},
        ).to_list(5000)
        out: Dict[str, float] = {}
        for p in pos:
            mid = p["module_id"]
            out[mid] = out.get(mid, 0.0) + float(p.get("amount") or 0)
        return out

    async def _scores_map(dev_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        if not dev_ids:
            return {}
        items = await db.developer_scores.find(
            {"developer_id": {"$in": dev_ids}}, {"_id": 0},
        ).to_list(500)
        out: Dict[str, Dict[str, Any]] = {}
        for x in items:
            # Normalize: engine stores 0-100; our thresholds are 0-1.
            for k in ("combined_score", "quality_score", "reliability_score"):
                v = x.get(k)
                if isinstance(v, (int, float)) and v > 1.0:
                    x[k] = v / 100.0
            out[x["developer_id"]] = x
        return out

    @router.get("/client/operator/opportunities")
    async def opportunities(user=Depends(get_current_user_dep)) -> Dict[str, Any]:
        client_id = user.user_id if hasattr(user, "user_id") else user["user_id"]
        modules = await _gather_client_modules(client_id)
        active = [m for m in modules if m.get("status") in ("pending", "in_progress", "review")]
        module_ids = [m["module_id"] for m in active]

        earned_by_mod = await _earned_map(module_ids)

        # Gather dev IDs from active modules
        dev_ids: List[str] = list({m["assigned_to"] for m in active if m.get("assigned_to")})
        score_by_dev = await _scores_map(dev_ids)

        # How many active modules each developer is on (for bottleneck)
        dev_load: Dict[str, int] = {}
        for m in active:
            dev = m.get("assigned_to")
            if dev:
                dev_load[dev] = dev_load.get(dev, 0) + 1

        opportunities_out: List[Dict[str, Any]] = []

        for m in active:
            mid = m["module_id"]
            title = m.get("title") or ""
            revenue = float(m.get("final_price") or m.get("price") or 0)
            cost = float(m.get("base_price") or revenue)
            earned = earned_by_mod.get(mid, 0.0)
            progress = (earned / cost) if cost > 0 else 0.0
            dev = m.get("assigned_to")
            score = score_by_dev.get(dev or "")
            combined = float((score or {}).get("combined_score") or 0)
            quality = float((score or {}).get("quality_score") or 0)
            days_active = _days_since(m.get("created_at"))

            # Only surface over-planned-cost candidates for "overpaying"
            cost_status = (
                "over_budget" if earned > cost
                else "warning" if (cost > 0 and earned > cost * 0.8)
                else "under_control"
            )

            # ─── RULE 1 · OVERPAYING ─────────────────────────────────────
            # earned already >50% of cost AND progress is visibly behind
            # AND the assigned dev is not a strong performer
            # → we're paying above what quality justifies.
            if (cost_status != "over_budget"
                    and cost > 0
                    and earned >= cost * 0.5
                    and progress < 0.7
                    and dev
                    and combined > 0 and combined <= WEAK_DEV_THRESHOLD):
                saving = round((cost - earned) * 0.15, 0)
                if saving >= MIN_PROFIT_IMPACT_USD:
                    opportunities_out.append({
                        "type": "overpaying",
                        "module_id": mid,
                        "module_title": title,
                        "project_id": m.get("project_id"),
                        "project_title": m.get("_project_title", ""),
                        "impact": f"+${int(saving)} potential profit",
                        "impact_value": saving,
                        "reason": (f"High cost vs team efficiency — {int(combined*100)}% "
                                   f"combined performance, {int(progress*100)}% progress."),
                        "confidence": 0.88,
                        "suggested_action": "Reduce allocation or swap executor",
                    })

            # ─── RULE 2 · UNDERUTILIZED TEAM ─────────────────────────────
            # Strong dev sitting on a module making little progress
            if (dev and combined >= STRONG_DEV_THRESHOLD
                    and progress < 0.3 and days_active >= 3):
                opportunities_out.append({
                    "type": "underutilized",
                    "module_id": mid,
                    "module_title": title,
                    "project_id": m.get("project_id"),
                    "project_title": m.get("_project_title", ""),
                    "impact": "Faster delivery unlocks earlier invoicing",
                    "impact_value": 0,
                    "reason": (f"Strong performer ({int(combined*100)}%) on a module at "
                               f"{int(progress*100)}% after {int(days_active)}d."),
                    "confidence": 0.75,
                    "suggested_action": "Remove blockers or check scope clarity",
                })

            # ─── RULE 3 · SLOW DELIVERY ──────────────────────────────────
            # Regardless of who's assigned — calendar is slipping
            if (m.get("status") == "in_progress"
                    and days_active >= STALE_DAYS_SLOW and progress < 0.5):
                opportunities_out.append({
                    "type": "slow_delivery",
                    "module_id": mid,
                    "module_title": title,
                    "project_id": m.get("project_id"),
                    "project_title": m.get("_project_title", ""),
                    "impact": f"~{int(days_active)}d elapsed, client time at risk",
                    "impact_value": 0,
                    "reason": f"{int(days_active)}d in progress but only {int(progress*100)}% progress.",
                    "confidence": 0.70,
                    "suggested_action": "Add a support developer to unblock",
                })

        # ─── RULE 4 · HIGH PERFORMER BOTTLENECK ──────────────────────────
        # Not per-module — per-developer aggregation
        for dev_id, load in dev_load.items():
            if load < BOTTLENECK_MIN_MODULES:
                continue
            sc = score_by_dev.get(dev_id)
            combined = float((sc or {}).get("combined_score") or 0)
            if combined < STRONG_DEV_THRESHOLD:
                continue
            owned_titles = [m.get("title") for m in active if m.get("assigned_to") == dev_id][:3]
            opportunities_out.append({
                "type": "bottleneck",
                "module_id": None,
                "module_title": None,
                "developer_id": dev_id,
                "impact": "Single point of failure — future delay risk",
                "impact_value": 0,
                "reason": (f"Top performer ({int(combined*100)}%) holds {load} active modules: "
                           f"{', '.join(owned_titles[:2])}{'…' if len(owned_titles) > 2 else ''}."),
                "confidence": 0.78,
                "suggested_action": "Distribute load or hire support",
            })


        # 🛡️ 8.2.1 — enrich every opportunity with safety metadata.
        # We do it here, after all rules, so individual rules stay simple.
        for _o in opportunities_out:
            _conf = float(_o.get("confidence") or 0)
            _safety = _safety_level(_o.get("type", ""), _conf)
            _o["safety_level"] = _safety
            _o["auto_applicable"] = _is_auto_applicable(_safety, _o.get("type", ""))
            # weighted_score blends impact and confidence — used for ranking
            _o["weighted_score"] = round(float(_o.get("impact_value") or 0) * _conf, 2)

        # Sort by weighted_score (impact × confidence), then safety (safe > caution > risky)
        _safety_rank = {"safe": 3, "caution": 2, "risky": 1}

        # Sort: weighted_score desc, then safer first
        opportunities_out.sort(
            key=lambda x: (
                x.get("weighted_score") or 0,
                _safety_rank.get(x.get("safety_level"), 0),
                x.get("confidence") or 0,
            ),
            reverse=True,
        )

        # Summary
        total_potential = round(sum(o.get("impact_value") or 0 for o in opportunities_out), 0)
        by_type: Dict[str, int] = {}
        by_safety: Dict[str, int] = {"safe": 0, "caution": 0, "risky": 0}
        auto_applicable_count = 0
        for o in opportunities_out:
            by_type[o["type"]] = by_type.get(o["type"], 0) + 1
            by_safety[o.get("safety_level", "risky")] = by_safety.get(o.get("safety_level", "risky"), 0) + 1
            if o.get("auto_applicable"):
                auto_applicable_count += 1

        return {
            "opportunities": opportunities_out,
            "summary": {
                "total": len(opportunities_out),
                "total_potential_profit": total_potential,
                "by_type": by_type,
                "by_safety": by_safety,
                "auto_applicable_count": auto_applicable_count,
            },
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    return router
