#!/usr/bin/env python3
"""
Daily observation snapshot — aggregates `competitor_url_events` + `funnel_events`
из MongoDB и пишет markdown-снэпшот.

Использование:
    python scripts/observation_snapshot.py             # last 24h
    python scripts/observation_snapshot.py --hours 72  # 72h window
    python scripts/observation_snapshot.py --since 2026-05-17T00:00:00Z

Цель: сравнивать snapshots между прогонами synthetic campaign, видеть drift в:
- error_kind distribution
- cache hit ratio
- p50/p95 latency
- narrative coverage (% errors с hint)
- funnel completion rates
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone

from pymongo import MongoClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
OUT_DIR = "/app/docs/observation_snapshots"


def _ratio(num: int, denom: int) -> str:
    if not denom:
        return "n/a"
    return f"{100 * num / denom:.1f}%"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=int, default=24)
    ap.add_argument("--since", type=str, default=None, help="ISO8601 timestamp, overrides --hours")
    args = ap.parse_args()

    now = datetime.now(timezone.utc)
    if args.since:
        since = datetime.fromisoformat(args.since.replace("Z", "+00:00"))
    else:
        since = now - timedelta(hours=args.hours)

    print(f"[snapshot] window: {since.isoformat()} → {now.isoformat()}")

    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]

    competitor = db["competitor_url_events"]
    funnel = db["funnel_events"]

    lines: list[str] = []
    lines.append(f"# Observation Snapshot — {now.isoformat()}")
    lines.append("")
    lines.append(f"**Window:** `{since.isoformat()}` → `{now.isoformat()}`  ")
    lines.append(f"**DB:** `{DB_NAME}`  ")
    lines.append("")

    # === competitor_url_events ===
    n_competitor = competitor.count_documents({"occurred_at": {"$gte": since}})
    lines.append("## /estimate/analyze-url events")
    lines.append("")
    lines.append(f"Total events in window: **{n_competitor}**")
    lines.append("")

    if n_competitor:
        # by event × surface × device
        pipeline = [
            {"$match": {"occurred_at": {"$gte": since}}},
            {"$group": {
                "_id": {"event": "$event", "surface": "$surface", "device": "$device"},
                "n": {"$sum": 1},
                "avg_ms": {"$avg": "$duration_ms"},
            }},
            {"$sort": {"n": -1}},
        ]
        rows = list(competitor.aggregate(pipeline))
        lines.append("### Event × surface × device × avg_latency")
        lines.append("")
        lines.append("| event | surface | device | n | avg_ms |")
        lines.append("|-------|---------|--------|---|-------:|")
        for r in rows:
            k = r["_id"]
            avg = f"{r['avg_ms']:.0f}" if r.get("avg_ms") is not None else "—"
            lines.append(f"| {k.get('event')} | {k.get('surface') or '—'} | {k.get('device') or '—'} | {r['n']} | {avg} |")
        lines.append("")

        # cache hit ratio
        cache_hits = competitor.count_documents({"event": "cache_hit", "occurred_at": {"$gte": since}})
        cache_misses = competitor.count_documents({"event": "cache_miss", "occurred_at": {"$gte": since}})
        lines.append("### Cache economics")
        lines.append("")
        lines.append(f"- cache hit: **{cache_hits}**")
        lines.append(f"- cache miss: **{cache_misses}**")
        lines.append(f"- hit ratio: **{_ratio(cache_hits, cache_hits + cache_misses)}**")
        lines.append("")

        # error distribution
        err_pipeline = [
            {"$match": {"event": "analyze_url_error", "occurred_at": {"$gte": since}}},
            {"$group": {"_id": "$error_kind", "n": {"$sum": 1}}},
            {"$sort": {"n": -1}},
        ]
        err_rows = list(competitor.aggregate(err_pipeline))
        lines.append("### Error-kind distribution")
        lines.append("")
        if err_rows:
            lines.append("| error_kind | n |")
            lines.append("|------------|---|")
            for r in err_rows:
                lines.append(f"| {r['_id'] or '—'} | {r['n']} |")
        else:
            lines.append("_no errors in window_")
        lines.append("")

        # funnel: started vs call vs completion
        started = competitor.count_documents({"event": "analyze_url_started", "occurred_at": {"$gte": since}})
        called = competitor.count_documents({"event": "analyze_url_call", "occurred_at": {"$gte": since}})
        errored = competitor.count_documents({"event": "analyze_url_error", "occurred_at": {"$gte": since}})
        completed = cache_hits + cache_misses
        lines.append("### Funnel integrity (analyze flow)")
        lines.append("")
        lines.append(f"- analyze_url_started: **{started}**")
        lines.append(f"- analyze_url_call: **{called}**")
        lines.append(f"- completed (hit + miss): **{completed}**")
        lines.append(f"- error: **{errored}**")
        if started:
            lines.append(f"- click → call: **{_ratio(called, started)}**")
        if called:
            lines.append(f"- call → success: **{_ratio(completed, called)}**")
        lines.append("")

        # admin reuse
        copy_n = competitor.count_documents({"event": "copy_click", "occurred_at": {"$gte": since}})
        insert_n = competitor.count_documents({"event": "insert_into_reply_click", "occurred_at": {"$gte": since}})
        admin_calls = competitor.count_documents({"event": "analyze_url_call", "surface": "admin", "occurred_at": {"$gte": since}})
        lines.append("### Admin reuse")
        lines.append("")
        lines.append(f"- admin analyze_url_call: **{admin_calls}**")
        lines.append(f"- copy_click: **{copy_n}**")
        lines.append(f"- insert_into_reply_click: **{insert_n}**")
        if admin_calls:
            lines.append(f"- reuse rate ((copy + insert) / call): **{_ratio(copy_n + insert_n, admin_calls)}**")
        lines.append("")

        # latency by event
        latency_pipeline = [
            {"$match": {"occurred_at": {"$gte": since}, "duration_ms": {"$exists": True, "$ne": None}}},
            {"$group": {
                "_id": "$event",
                "n": {"$sum": 1},
                "avg": {"$avg": "$duration_ms"},
                "min": {"$min": "$duration_ms"},
                "max": {"$max": "$duration_ms"},
            }},
            {"$sort": {"avg": -1}},
        ]
        lat_rows = list(competitor.aggregate(latency_pipeline))
        if lat_rows:
            lines.append("### Latency by event")
            lines.append("")
            lines.append("| event | n | avg_ms | min_ms | max_ms |")
            lines.append("|-------|---|-------:|-------:|-------:|")
            for r in lat_rows:
                lines.append(f"| {r['_id']} | {r['n']} | {r['avg']:.0f} | {r['min']} | {r['max']} |")
            lines.append("")
    else:
        lines.append("_no events in window_")
        lines.append("")

    # === funnel_events ===
    n_funnel = funnel.count_documents({"occurred_at": {"$gte": since}})
    lines.append("## funnel_events (visitor flow)")
    lines.append("")
    lines.append(f"Total events in window: **{n_funnel}**")
    lines.append("")
    if n_funnel:
        fpipe = [
            {"$match": {"occurred_at": {"$gte": since}}},
            {"$group": {"_id": {"event": "$event", "surface": "$surface"}, "n": {"$sum": 1}}},
            {"$sort": {"n": -1}},
        ]
        for r in funnel.aggregate(fpipe):
            k = r["_id"]
            lines.append(f"- `{k.get('event')}` (surface={k.get('surface') or '—'}): **{r['n']}**")

        opened = funnel.count_documents({"event": "describe_opened", "occurred_at": {"$gte": since}})
        completed_d = funnel.count_documents({"event": "describe_completed", "occurred_at": {"$gte": since}})
        est_gen = funnel.count_documents({"event": "estimate_generated", "occurred_at": {"$gte": since}})
        lines.append("")
        lines.append("### Describe → Estimate funnel")
        lines.append("")
        lines.append(f"- describe_opened: **{opened}**")
        lines.append(f"- describe_completed: **{completed_d}**")
        lines.append(f"- estimate_generated: **{est_gen}**")
        if opened:
            lines.append(f"- opened → completed: **{_ratio(completed_d, opened)}**")
        if completed_d:
            lines.append(f"- completed → estimate: **{_ratio(est_gen, completed_d)}**")
        lines.append("")
    else:
        lines.append("_no events in window_")
        lines.append("")

    os.makedirs(OUT_DIR, exist_ok=True)
    fname = f"snapshot_{now.strftime('%Y-%m-%d_%H%M%S')}.md"
    path = os.path.join(OUT_DIR, fname)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"[snapshot] wrote {path}")
    print(f"[snapshot] {n_competitor} competitor events, {n_funnel} funnel events in window")
    return 0


if __name__ == "__main__":
    sys.exit(main())
