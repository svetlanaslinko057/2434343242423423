"""
Block 5.2++ — Client Transparency Layer

Aggregates auto_actions + system_alerts → client-facing feed.
Explains WHAT the system did, WHY (with names + numbers), HOW sure it was,
and WHERE it happened (project / module).

NO new logic. NO writes. Pure read + presentation over existing collections:
  db.auto_actions, db.system_alerts, db.projects, db.modules, db.users,
  db.work_units (only for alert-scoping)

Exposes a SINGLE endpoint: GET /api/client/transparency
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timezone, timedelta

router = APIRouter(prefix="/api", tags=["client-transparency"])


def init_router(db, get_current_user_dep):
    """Wires router handlers to runtime db and auth dependency."""

    _ACTION_META = {
        "auto_rebalance":   {"icon": "⚖️", "label": "Task reassigned"},
        "auto_add_support": {"icon": "➕", "label": "Developer added"},
        "auto_review_flag": {"icon": "🔍", "label": "Review flagged"},
        "auto_escalate":    {"icon": "🚨", "label": "Module escalated"},
        "auto_pause":       {"icon": "⏸",  "label": "Module auto-paused"},
    }

    _ALERT_META = {
        "stuck":            {"icon": "⏱", "label": "Task stuck"},
        "overload":         {"icon": "🔥", "label": "Developer overloaded"},
        "revision_loop":    {"icon": "🔁", "label": "Revision loop"},
        "tester_accuracy":  {"icon": "🧪", "label": "Tester accuracy low"},
        "project_risk":     {"icon": "⚠️", "label": "Project at risk"},
        "team_risk":        {"icon": "⚠️", "label": "Team delivery at risk"},
        "team_delivery_risk": {"icon": "⚠️", "label": "Team delivery at risk"},
        "qa_backlog_high":  {"icon": "🧪", "label": "QA backlog growing"},
        "qa_issues_rising": {"icon": "🧪", "label": "QA issues rising"},
        "developer_overloaded": {"icon": "🔥", "label": "Developer overloaded"},
        "project_idle":     {"icon": "💤", "label": "Project idle"},
        "module_deadline_risk": {"icon": "⏳", "label": "Module deadline at risk"},
    }

    _IMPACT_TYPE = {
        "auto_rebalance":   "positive",
        "auto_add_support": "positive",
        "auto_review_flag": "warning",
        "auto_escalate":    "warning",
        "auto_pause":       "warning",
    }

    def _impact_type(action_type: str, status: str) -> str:
        if status == "reverted":
            return "neutral"
        if status == "failed":
            return "warning"
        return _IMPACT_TYPE.get(action_type, "neutral")

    # --------------------------------------------------------------------- #
    # CONFIDENCE: label + reason from existing confidence_breakdown
    # breakdown is produced by autonomy_layer.compute_confidence:
    # { signal_strength, data_confidence, stability } each 0..1
    # --------------------------------------------------------------------- #
    def _confidence_label(conf: float) -> str:
        if conf >= 0.85: return "High"
        if conf >= 0.70: return "Good"
        if conf >= 0.60: return "Medium"
        return "Low"

    def _confidence_reason(breakdown: Dict[str, Any]) -> str:
        if not breakdown:
            return "based on current team signals"
        parts: List[str] = []

        ss = breakdown.get("signal_strength")
        if ss is not None:
            pct = round(float(ss) * 100)
            if pct >= 70:   parts.append(f"strong team-risk signal ({pct}%)")
            elif pct >= 40: parts.append(f"moderate team-risk signal ({pct}%)")
            else:           parts.append(f"weak team-risk signal ({pct}%)")

        dc = breakdown.get("data_confidence")
        if dc is not None:
            pct = round(float(dc) * 100)
            if pct >= 80:   parts.append("high-quality developer data")
            elif pct >= 50: parts.append("medium-quality developer data")
            else:           parts.append("limited developer history")

        st = breakdown.get("stability")
        if st is not None:
            pct = round(float(st) * 100)
            if pct >= 85:   parts.append("stable metrics")
            elif pct >= 60: parts.append("slightly volatile metrics")
            else:           parts.append("volatile metrics")

        return ", ".join(parts) if parts else "based on current team signals"

    # --------------------------------------------------------------------- #
    # Helpers
    # --------------------------------------------------------------------- #
    def _pct(v: Any) -> Optional[int]:
        try:
            return round(float(v) * 100)
        except (TypeError, ValueError):
            return None

    def _name(users_map: Dict[str, str], dev_id: Optional[str]) -> str:
        if not dev_id:
            return "someone"
        return users_map.get(dev_id) or dev_id[:8]

    # --------------------------------------------------------------------- #
    # REASON / IMPACT — concrete, built from existing payload/team_score
    # --------------------------------------------------------------------- #
    def _reason(doc: Dict[str, Any], users_map: Dict[str, str]) -> str:
        t = doc.get("type")
        pl = doc.get("payload") or {}

        if t == "auto_rebalance":
            from_name = _name(users_map, pl.get("from_dev"))
            to_name   = _name(users_map, pl.get("to_dev"))
            from_pct  = _pct(pl.get("from_load"))
            to_pct    = _pct(pl.get("to_load"))
            left  = f"{from_name} overloaded ({from_pct}% load)" if from_pct is not None \
                    else f"{from_name} overloaded"
            right = f"{to_name} has capacity ({to_pct}% load)" if to_pct is not None \
                    else f"{to_name} has capacity"
            return f"{left}, {right}"

        if t == "auto_add_support":
            cand = _name(users_map, pl.get("candidate_dev_id")) \
                   or pl.get("candidate_name") or "new developer"
            trig_sil = _pct(pl.get("trigger_silence_risk"))
            trig_vel = _pct(pl.get("trigger_velocity"))
            cand_skill = pl.get("candidate_combined")
            cand_load  = _pct(pl.get("candidate_load"))
            team_band  = doc.get("team_band_at_creation")

            bits: List[str] = []
            # WHY the trigger fired
            if trig_sil is not None and trig_sil >= 40:
                bits.append(f"silence risk {trig_sil}%")
            if trig_vel is not None and trig_vel < 20:
                bits.append(f"velocity only {trig_vel}%")
            if not bits and team_band:
                bits.append(f"team in {team_band} zone")
            if not bits:
                bits.append("low team velocity")

            # WHY this candidate
            who_bits: List[str] = []
            if cand_skill is not None:
                who_bits.append(f"skill {round(float(cand_skill))}")
            if cand_load is not None:
                who_bits.append(f"load {cand_load}%")
            who = f"{cand} ({', '.join(who_bits)})" if who_bits else cand

            return f"{', '.join(bits)}; {who} has capacity"

        if t == "auto_review_flag":
            unit_title = pl.get("task_title") or pl.get("unit_title") or "Work unit"
            reason = pl.get("flag_reason") or "quality signals below threshold"
            return f'"{unit_title}" — {reason}'

        # fallback for any unknown future type — at least say where
        return f"autonomous adjustment ({t})"

    def _impact(doc: Dict[str, Any], users_map: Dict[str, str]) -> str:
        t = doc.get("type")
        pl = doc.get("payload") or {}

        if t == "auto_rebalance":
            from_name = _name(users_map, pl.get("from_dev"))
            to_name   = _name(users_map, pl.get("to_dev"))
            task = pl.get("task_title") or "task"
            return f'"{task}" moved {from_name} → {to_name}'

        if t == "auto_add_support":
            cand = _name(users_map, pl.get("candidate_dev_id")) \
                   or pl.get("candidate_name") or "New developer"
            alloc = pl.get("allocation")
            if alloc is not None:
                return f"{cand} joined as support ({_pct(alloc)}% allocation)"
            return f"{cand} joined the module as support executor"

        if t == "auto_review_flag":
            return "Module queued for additional QA review"

        return "Delivery flow optimised"

    # --------------------------------------------------------------------- #
    # ALERT rendering — use existing details{} OR message to build text
    # --------------------------------------------------------------------- #
    def _alert_text(alert: Dict[str, Any]) -> Tuple[str, str, str]:
        """Return (label, message, recommended_action) from alert data."""
        t = alert.get("type") or alert.get("alert_type") or "notice"
        details = alert.get("details") or {}
        raw_msg = alert.get("message") or alert.get("summary")
        meta = _ALERT_META.get(t, {"icon": "🤖", "label": t.replace("_", " ").title()})

        if t == "stuck":
            title = details.get("unit_title") or "Work unit"
            hours = details.get("hours_stuck")
            status = details.get("status") or "its current status"
            msg = (f'"{title}" stuck in {status} for {int(hours)}h'
                   if hours is not None
                   else (raw_msg or f'"{title}" is not progressing'))
            return meta["label"], msg, "Ping the assigned developer or reassign"

        if t in ("overload", "developer_overloaded"):
            name = details.get("developer_name") or "A developer"
            load = details.get("load_percent")
            msg = (f"{name} at {int(load)}% capacity"
                   if load is not None
                   else (raw_msg or f"{name} is overloaded"))
            return meta["label"], msg, "Rebalance module load or add support executor"

        if t == "revision_loop":
            title = details.get("unit_title") or "Work unit"
            rc = details.get("revision_count")
            msg = (f'"{title}" sent back {rc}×'
                   if rc is not None
                   else (raw_msg or f'"{title}" bouncing between QA and dev'))
            return meta["label"], msg, "Review acceptance criteria with the team"

        if t == "tester_accuracy":
            name = details.get("tester_name") or "Tester"
            rate = details.get("fail_rate")
            msg = (f"{name} fail-rate {int(rate)}%"
                   if rate is not None
                   else (raw_msg or f"{name} accuracy trending low"))
            return meta["label"], msg, "Audit recent QA decisions for over-strict rulings"

        if t == "project_risk":
            pname = details.get("project_name") or "Project"
            days = details.get("days_remaining")
            progress = details.get("progress")
            parts: List[str] = []
            if days is not None: parts.append(f"{days}d left")
            if progress is not None: parts.append(f"{progress}% done")
            msg = (f"{pname}: {', '.join(parts)}"
                   if parts else (raw_msg or f"{pname} at risk"))
            return meta["label"], msg, "Consider adding support or extending scope"

        if t in ("team_risk", "team_delivery_risk"):
            return meta["label"], \
                   (raw_msg or "Team delivery risk is elevated"), \
                   "Add a support developer"

        if t in ("qa_backlog_high", "qa_issues_rising"):
            return meta["label"], \
                   (raw_msg or "QA queue is growing faster than it clears"), \
                   "Review recent QA feedback"

        if t == "project_idle":
            return meta["label"], \
                   (raw_msg or "No activity on this project recently"), \
                   "Ping assigned developers or escalate"

        if t == "module_deadline_risk":
            return meta["label"], \
                   (raw_msg or "Module likely to miss its deadline"), \
                   "Consider extending scope or adding support"

        return (meta["label"],
                raw_msg or meta["label"],
                "Review system activity")

    # --------------------------------------------------------------------- #
    # Data fetchers — batched (no N+1)
    # --------------------------------------------------------------------- #
    async def _client_project_ids(client_id: str) -> List[str]:
        rows = await db.projects.find(
            {"client_id": client_id}, {"_id": 0, "project_id": 1}
        ).to_list(500)
        return [r["project_id"] for r in rows if r.get("project_id")]

    async def _project_name_map(project_ids: List[str]) -> Dict[str, str]:
        if not project_ids:
            return {}
        rows = await db.projects.find(
            {"project_id": {"$in": project_ids}},
            {"_id": 0, "project_id": 1, "name": 1, "title": 1},
        ).to_list(500)
        return {
            r["project_id"]: (r.get("name") or r.get("title") or "Project")
            for r in rows
        }

    async def _module_index(
        project_ids: List[str],
    ) -> Tuple[List[str], Dict[str, str], Dict[str, str]]:
        """Return (module_ids, module_id→project_id, module_id→module_title)."""
        if not project_ids:
            return [], {}, {}
        rows = await db.modules.find(
            {"project_id": {"$in": project_ids}},
            {"_id": 0, "module_id": 1, "project_id": 1, "title": 1, "name": 1},
        ).to_list(5000)
        ids: List[str] = []
        m2p: Dict[str, str] = {}
        m2t: Dict[str, str] = {}
        for r in rows:
            mid = r.get("module_id")
            if mid:
                ids.append(mid)
                m2p[mid] = r.get("project_id")
                m2t[mid] = r.get("title") or r.get("name") or "Module"
        return ids, m2p, m2t

    async def _work_unit_module_map(module_ids: List[str]) -> Dict[str, str]:
        """unit_id → module_id for scoping work_unit alerts."""
        if not module_ids:
            return {}
        rows = await db.work_units.find(
            {"module_id": {"$in": module_ids}},
            {"_id": 0, "unit_id": 1, "module_id": 1},
        ).to_list(10000)
        return {r["unit_id"]: r["module_id"] for r in rows if r.get("unit_id")}

    async def _user_name_map(user_ids: List[str]) -> Dict[str, str]:
        ids = [u for u in user_ids if u]
        if not ids:
            return {}
        rows = await db.users.find(
            {"user_id": {"$in": ids}},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1},
        ).to_list(500)
        out: Dict[str, str] = {}
        for r in rows:
            uid = r.get("user_id")
            nm = r.get("name")
            if not nm:
                email = r.get("email", "")
                nm = email.split("@")[0] if email else (uid or "")[:8]
            out[uid] = nm
        return out

    # --------------------------------------------------------------------- #
    # GET /api/client/transparency
    # --------------------------------------------------------------------- #
    @router.get("/client/transparency")
    async def client_transparency(
        since_days: int = Query(14, ge=1, le=90),
        limit_actions: int = Query(30, ge=1, le=100),
        limit_alerts: int = Query(15, ge=1, le=50),
        user=Depends(get_current_user_dep),
    ):
        uid = getattr(user, "user_id", None) or (
            user.get("user_id") if isinstance(user, dict) else None
        )
        if not uid:
            raise HTTPException(401, "No user")

        # 1. Scope: this client's projects & modules
        project_ids = await _client_project_ids(uid)
        module_ids, m2p, m2t = await _module_index(project_ids)
        project_names = await _project_name_map(project_ids)

        since = (datetime.now(timezone.utc) - timedelta(days=since_days)).isoformat()

        # 2. Pull auto_actions scoped to client's modules
        raw_actions: List[Dict[str, Any]] = []
        if module_ids:
            raw_actions = await (
                db.auto_actions.find(
                    {
                        "module_id": {"$in": module_ids},
                        "created_at": {"$gte": since},
                    },
                    {"_id": 0},
                )
                .sort("created_at", -1)
                .limit(limit_actions)
                .to_list(limit_actions)
            )
            # Dedupe: within each module + type, keep only the newest action.
            # Feed is already newest-first, so skipping on repeat is correct.
            _seen: set = set()
            _deduped: List[Dict[str, Any]] = []
            for a in raw_actions:
                key = (a.get("module_id") or "", a.get("type") or "")
                if key in _seen:
                    continue
                _seen.add(key)
                _deduped.append(a)
            raw_actions = _deduped

        # 3. Pull system_alerts scoped — support BOTH schemas:
        #    A) entity_type + entity_id (produced by alert_engine in server.py)
        #    B) project_id / module_id (produced by older seeds / engines)
        raw_alerts: List[Dict[str, Any]] = []
        unit2mod = await _work_unit_module_map(module_ids)
        alert_or: List[Dict[str, Any]] = []
        if project_ids:
            alert_or.append({"entity_type": "project",
                             "entity_id": {"$in": project_ids}})
            alert_or.append({"project_id": {"$in": project_ids}})
        if module_ids:
            alert_or.append({"module_id": {"$in": module_ids}})
        if unit2mod:
            alert_or.append({"entity_type": "work_unit",
                             "entity_id": {"$in": list(unit2mod.keys())}})
        if alert_or:
            raw_alerts = await (
                db.system_alerts.find(
                    {
                        "$or": alert_or,
                        "created_at": {"$gte": since},
                        "resolved": {"$ne": True},
                    },
                    {"_id": 0},
                )
                .sort("created_at", -1)
                .limit(limit_alerts)
                .to_list(limit_alerts)
            )

        # 4. Batch-resolve dev names referenced in actions
        dev_ids = set()
        for a in raw_actions:
            pl = a.get("payload") or {}
            for k in ("from_dev", "to_dev", "candidate_dev_id"):
                v = pl.get(k)
                if v: dev_ids.add(v)
        users_map = await _user_name_map(list(dev_ids))

        # 5. Render actions
        actions: List[Dict[str, Any]] = []
        for a in raw_actions:
            t = a.get("type") or "unknown"
            meta = _ACTION_META.get(
                t, {"icon": "🤖", "label": t.replace("_", " ").title()}
            )
            mid = a.get("module_id")
            pid = m2p.get(mid)
            confidence = float(a.get("confidence") or 0)
            actions.append({
                "id": a.get("action_id"),
                "type": t,
                "icon": meta["icon"],
                "label": meta["label"],
                # WHERE:
                "project_id": pid,
                "project_title": project_names.get(pid) or "Project",
                "module_id": mid,
                "module_title": a.get("module_title") or m2t.get(mid) or "—",
                # STATUS:
                "status": a.get("status", "pending"),
                # CONFIDENCE (label + concrete reason):
                "confidence": round(confidence, 2),
                "confidence_label": _confidence_label(confidence),
                "confidence_reason": _confidence_reason(
                    a.get("confidence_breakdown") or {}
                ),
                # EXPLAIN (concrete names and numbers):
                "reason": _reason(a, users_map),
                "impact": _impact(a, users_map),
                "impact_type": _impact_type(t, a.get("status", "pending")),
                # TIMELINE:
                "created_at": a.get("created_at"),
                "executed_at": a.get("executed_at"),
                "reverted_at": a.get("reverted_at"),
                "revert_available": bool(a.get("revert_available")),
            })

        # 6. Render alerts
        alerts: List[Dict[str, Any]] = []
        for s in raw_alerts:
            at = s.get("type") or s.get("alert_type") or "notice"
            sev = s.get("severity") or "warning"
            meta = _ALERT_META.get(
                at, {"icon": "🤖", "label": at.replace("_", " ").title()}
            )

            # Resolve project/module for alert — support BOTH schemas
            pid: Optional[str] = s.get("project_id")
            mid: Optional[str] = s.get("module_id")
            mod_title: Optional[str] = s.get("module_title")

            et = s.get("entity_type")
            eid = s.get("entity_id")
            if not pid and et == "project":
                pid = eid
            if not mid and et == "work_unit":
                mid = unit2mod.get(eid)
            if mid and not pid:
                pid = m2p.get(mid)
            if mid and not mod_title:
                mod_title = m2t.get(mid)

            label, msg, rec = _alert_text(s)
            alerts.append({
                "id": s.get("alert_id") or s.get("event_id"),
                "type": at,
                "icon": meta["icon"],
                "label": label,
                "severity": sev,
                "project_id": pid,
                "project_title": project_names.get(pid) if pid else None,
                "module_id": mid,
                "module_title": mod_title,
                "message": msg,
                "recommended_action": rec,
                "created_at": s.get("created_at"),
            })

        executed = sum(1 for a in actions if a["status"] == "executed")
        reverted = sum(1 for a in actions if a["status"] == "reverted")
        high_sev = sum(1 for s in alerts if s["severity"] in ("critical", "high"))

        return {
            "window_days": since_days,
            "summary": {
                "actions_total": len(actions),
                "actions_executed": executed,
                "actions_reverted": reverted,
                "alerts_total": len(alerts),
                "alerts_high_severity": high_sev,
            },
            "auto_actions": actions,
            "system_alerts": alerts,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    return router
