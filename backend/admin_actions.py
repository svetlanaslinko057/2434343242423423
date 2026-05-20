"""
Block A2 — Admin Actions Feed (READ-ONLY, AGGREGATION ONLY)

One endpoint: GET /api/admin/actions

Purpose:
    Operational journal — "what is the system doing across the whole platform?"
    NOT for clients (they have /client/operator), NOT for devs. For the operator
    of the system.

    Faithful passthrough of db.auto_actions:
      - newest first (sort applied in DB BEFORE scan limit — no lost freshness)
      - deduped by (module_id or f"_project:{project_id}", type)
      - project-level actions supported (module_id is null → is_project_level)
      - severity / confidence / reason / impact passed through as-is
      - project_title / module_title enriched with BATCHED $in lookups
        (one round-trip per collection, never N+1)

    Dedupe keeps the SIGNAL OF FREQUENCY (this was a real risk):
      - each returned row = one (entity, type) event stream
      - carries count / first_seen_at / last_seen_at
      - last_action field is the newest occurrence (source of truth for
        confidence/reason/impact — we never average across occurrences)

    Filters:
      - ?source=guardian|operator|...
      - ?type=auto_pause|rebalance|...
      - ?project_id=...
    Response also returns counts by_source and by_type over the deduped slice
    so the UI can render filter chips without a second request.

    No new business logic. No new formulas. Never recomputes confidence/reason.
    Reads db.auto_actions, db.modules, db.projects.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

router = APIRouter(prefix="/api", tags=["admin-actions"])

# Hard caps. sort(created_at DESC) is applied in Mongo BEFORE limit,
# so even at saturation we always keep the FRESHEST window.
_MAX_SCAN   = 500   # raw rows pulled per request
_MAX_RETURN = 100   # deduped rows returned per request


def init_router(db, get_current_user_dep):

    @router.get("/admin/actions")
    async def admin_actions(
        user=Depends(get_current_user_dep),
        source: Optional[str] = Query(None),
        type:   Optional[str] = Query(None),
        project_id: Optional[str] = Query(None),
    ) -> Dict[str, Any]:
        # Admin-only surface.
        role = user.role if hasattr(user, "role") else user.get("role")
        if role != "admin":
            raise HTTPException(status_code=403, detail="Admin only")

        # 1. Query — apply the three optional server-side filters.
        q: Dict[str, Any] = {}
        if source:     q["source"]     = source
        if type:       q["type"]       = type
        if project_id: q["project_id"] = project_id

        # Sort is applied in Mongo BEFORE the scan limit. Freshest events
        # always win even if the journal grows beyond _MAX_SCAN.
        raw = await db.auto_actions.find(q, {"_id": 0}) \
            .sort("created_at", -1) \
            .to_list(_MAX_SCAN)

        # 2. Aggregate by signal key. Each unique (entity, type) pair becomes
        #    ONE output row, but carries the full frequency signal:
        #    count / first_seen_at / last_seen_at / last_action.
        #
        #    Key = module_id if present, else f"_project:{project_id}".
        #    This deduplicates EVENTS, not records — if the system paused the
        #    same project 5 times, the admin sees 1 row showing "5 times".
        groups: Dict[tuple, Dict[str, Any]] = {}
        for a in raw:  # already newest-first
            mid = a.get("module_id")
            pid = a.get("project_id")
            t   = a.get("type") or "unknown"
            key = (mid if mid else f"_project:{pid or 'none'}", t)

            g = groups.get(key)
            if g is None:
                groups[key] = {
                    "key":           key,
                    "count":         1,
                    "first_seen_at": a.get("created_at"),
                    "last_seen_at":  a.get("created_at"),
                    "last_action":   a,     # raw doc; enriched below
                }
            else:
                g["count"] += 1
                # raw is sorted desc → iteration gives newest first,
                # so `last_action` is already correct. We only extend
                # the `first_seen_at` backwards.
                g["first_seen_at"] = a.get("created_at") or g["first_seen_at"]

        # Order output by last_seen_at DESC (freshest event stream first).
        deduped = sorted(
            groups.values(),
            key=lambda g: str(g.get("last_seen_at") or ""),
            reverse=True,
        )[:_MAX_RETURN]

        # 3. Batched enrichment. Collect ALL project / module ids first,
        #    then one $in query per collection. O(1) round-trips, never N+1.
        pids: List[str] = []
        mids: List[str] = []
        for g in deduped:
            la = g["last_action"]
            if la.get("project_id"): pids.append(la["project_id"])
            if la.get("module_id"):  mids.append(la["module_id"])
        pids = list(set(pids))
        mids = list(set(mids))

        title_by_pid: Dict[str, str] = {}
        if pids:
            prjs = await db.projects.find(
                {"project_id": {"$in": pids}},
                {"_id": 0, "project_id": 1, "name": 1, "title": 1},
            ).to_list(len(pids))
            title_by_pid = {p["project_id"]: (p.get("name") or p.get("title") or "")
                            for p in prjs}

        title_by_mid: Dict[str, str] = {}
        if mids:
            mods = await db.modules.find(
                {"module_id": {"$in": mids}},
                {"_id": 0, "module_id": 1, "title": 1},
            ).to_list(len(mids))
            title_by_mid = {m["module_id"]: (m.get("title") or "") for m in mods}

        # 4. Shape output. Pure passthrough — NEVER recompute confidence/reason/
        #    impact/severity. We only carry what was written at decision time.
        actions: List[Dict[str, Any]] = []
        by_source: Dict[str, int] = {}
        by_type:   Dict[str, int] = {}
        by_severity: Dict[str, int] = {}

        for g in deduped:
            la  = g["last_action"]
            mid = la.get("module_id")
            pid = la.get("project_id")
            src = la.get("source")   or "unknown"
            typ = la.get("type")     or "unknown"
            sev = la.get("severity") or "info"   # passthrough — default only if DB omitted it

            actions.append({
                "id":               la.get("action_id") or la.get("id"),
                "type":             typ,
                "source":           src,
                "severity":         sev,
                "project_id":       pid,
                "project_title":    title_by_pid.get(pid or "", ""),
                "module_id":        mid,
                "module_title":     title_by_mid.get(mid or "", ""),
                "status":           la.get("status") or "executed",
                "confidence":       la.get("confidence"),
                "reason":           la.get("reason"),
                "impact":           la.get("impact"),
                "created_at":       la.get("last_seen_at") or la.get("created_at"),
                "is_project_level": mid is None,

                # Frequency signal — preserved through dedupe.
                "count":         g["count"],
                "first_seen_at": g["first_seen_at"],
                "last_seen_at":  g["last_seen_at"],
            })
            by_source[src] = by_source.get(src, 0) + 1
            by_type[typ]   = by_type.get(typ, 0) + 1
            by_severity[sev] = by_severity.get(sev, 0) + 1

        return {
            "actions": actions,
            "filters": {
                "by_source":   by_source,
                "by_type":     by_type,
                "by_severity": by_severity,
            },
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    return router
