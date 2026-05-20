#!/usr/bin/env python3
"""
LLM Scope Benchmark — feed the 10 canonical archetypes from the pricing
review corpus through live `/api/estimate` (LLM-scope-driven) and capture:

  • the implementation_price the LLM scope generator produced,
  • the inferred hours / module count,
  • the inferred Reality Layer axes (LLM's recommendation),
  • how that compares to the Iteration 3 reviewer's hand-picked axes.

Hypothesis (per post-corpus user review):
  The Reality Layer math is calibrated. What may not be is the upstream
  implementation scope. Three failure modes to look for:
    1. Under-scoping architecture (no auth / no admin / no observability / no infra)
    2. Demo-app mode (treats Slack-clone like a hello-world chat)
    3. Integration trivialization (treats payments / realtime / sync as free)

This script reads-only. No `pricing_config` changes. No DB writes other
than what `/api/estimate` does internally (none — it's a pure preview).

Usage:
    python /app/scripts/llm-scope-probe.py
"""
from __future__ import annotations
import json
import os
import sys
import time
from typing import Dict, List
import urllib.request
import urllib.error


GREEN = "\033[32m"; RED = "\033[31m"; YELLOW = "\033[33m"
DIM = "\033[2m"; BOLD = "\033[1m"; RST = "\033[0m"


BASE = "http://localhost:8001"

# Archetype briefs (real prose, not axis lists — this is what a founder would
# actually paste into /describe). The hand-picked axes from the review corpus
# are kept in `expected_axes` for side-by-side comparison.
ARCHETYPES = [
    {
        "name": "Slack clone",
        "brief": (
            "Build a team chat application like Slack. We need real-time messaging "
            "across channels and DMs, threaded replies, file sharing, search, "
            "user presence and typing indicators, multi-workspace support, "
            "admin controls, and SSO. Production-grade, multi-tenant, "
            "we expect to ship this to paying B2B customers."
        ),
        "expected_axes": {
            "product_maturity": "production", "system_coupling": "platform",
            "unknowns": "medium", "realtime_pressure": "critical",
            "longevity": "long_term",
        },
        "market_band_usd": (30_000, 80_000),
    },
    {
        "name": "Linear clone",
        "brief": (
            "Build a fast issue tracker similar to Linear: projects, cycles, "
            "issues with statuses and priorities, keyboard-first UI, real-time "
            "collaboration with presence, GitHub and Slack integrations, "
            "admin permissions, and a public API. Production product for "
            "engineering teams."
        ),
        "expected_axes": {
            "product_maturity": "production", "system_coupling": "connected",
            "unknowns": "medium", "realtime_pressure": "collaborative",
            "longevity": "long_term",
        },
        "market_band_usd": (25_000, 60_000),
    },
    {
        "name": "Stripe-for-X",
        "brief": (
            "Build a vertical payments platform for the events industry: merchant "
            "onboarding with KYC, payment processing with refunds and chargebacks, "
            "payout scheduling, reconciliation reports, tax compliance, webhook "
            "infrastructure, fraud detection, audit logs that regulators can read, "
            "and a developer dashboard with API keys. Long-term infrastructure."
        ),
        "expected_axes": {
            "product_maturity": "production", "system_coupling": "platform",
            "unknowns": "high", "realtime_pressure": "async",
            "longevity": "infrastructure",
        },
        "market_band_usd": (80_000, 200_000),
    },
    {
        "name": "B2B CRM",
        "brief": (
            "Build a B2B sales CRM: leads, contacts, accounts, opportunities, "
            "pipelines with kanban view, email/calendar sync, activity timelines, "
            "reporting dashboards, role-based permissions, custom fields, "
            "and import/export. Production product for SMB sales teams."
        ),
        "expected_axes": {
            "product_maturity": "production", "system_coupling": "connected",
            "unknowns": "medium", "realtime_pressure": "async",
            "longevity": "long_term",
        },
        "market_band_usd": (20_000, 50_000),
    },
    {
        "name": "AI copilot",
        "brief": (
            "Build a production AI copilot for software engineers: streaming "
            "chat with code-aware retrieval over the user's repo, multi-turn "
            "conversation memory, prompt history, billing with per-token "
            "metering, admin controls, prompt safety filters, evaluation "
            "harness for prompt regressions, and a usage dashboard. Long-term "
            "SaaS product."
        ),
        "expected_axes": {
            "product_maturity": "production", "system_coupling": "platform",
            "unknowns": "high", "realtime_pressure": "critical",
            "longevity": "long_term",
        },
        "market_band_usd": (30_000, 80_000),
    },
    {
        "name": "Infra observability",
        "brief": (
            "Build a Datadog-lite observability platform: log ingestion at scale, "
            "metric aggregation, distributed tracing, real-time dashboards, "
            "alerting with on-call rotation, anomaly detection, query language, "
            "multi-tenant isolation, and S3-tier cold storage. Infrastructure-grade "
            "product that customer ops teams will trust for years."
        ),
        "expected_axes": {
            "product_maturity": "production", "system_coupling": "platform",
            "unknowns": "high", "realtime_pressure": "critical",
            "longevity": "infrastructure",
        },
        "market_band_usd": (60_000, 150_000),
    },
    {
        "name": "Marketplace",
        "brief": (
            "Build a two-sided marketplace like Etsy: seller onboarding, product "
            "listings with media, search and filters, cart and checkout with "
            "payments, order management, reviews and ratings, messaging between "
            "buyer and seller, trust and safety system, and admin moderation. "
            "Production B2C product."
        ),
        "expected_axes": {
            "product_maturity": "production", "system_coupling": "platform",
            "unknowns": "medium", "realtime_pressure": "async",
            "longevity": "long_term",
        },
        "market_band_usd": (30_000, 80_000),
    },
    {
        "name": "Realtime multiplayer",
        "brief": (
            "Build a realtime multiplayer backend for a competitive online game: "
            "lobby and matchmaking, authoritative game state with rollback, "
            "sub-100ms input latency budgets, anti-cheat, persistent player "
            "stats and progression, friends and parties, leaderboards, and "
            "regional server selection. Production product that supports "
            "thousands of concurrent matches."
        ),
        "expected_axes": {
            "product_maturity": "production", "system_coupling": "platform",
            "unknowns": "high", "realtime_pressure": "critical",
            "longevity": "long_term",
        },
        "market_band_usd": (40_000, 100_000),
    },
    {
        "name": "Banking dashboard",
        "brief": (
            "Build an internal banking operations dashboard: account search, "
            "transaction review and flagging, reconciliation queues, "
            "role-based access with four-eyes approvals, regulator audit "
            "trails that retain seven years, multi-currency support, "
            "real-time fraud alerts, and an export pipeline for compliance. "
            "Infrastructure-grade — regulators read this."
        ),
        "expected_axes": {
            "product_maturity": "production", "system_coupling": "platform",
            "unknowns": "high", "realtime_pressure": "collaborative",
            "longevity": "infrastructure",
        },
        "market_band_usd": (50_000, 120_000),
    },
    {
        "name": "Enterprise ERP",
        "brief": (
            "Build an enterprise ERP for a mid-market manufacturer: finance with "
            "GL and AR/AP, procurement with multi-step approvals, inventory "
            "across warehouses, production planning, HR with payroll, "
            "configurable workflows per company, role hierarchies twelve levels "
            "deep, audit and SOX compliance, integration with the customer's "
            "existing systems, and a five-year maintenance horizon."
        ),
        "expected_axes": {
            "product_maturity": "scaled", "system_coupling": "operating_system",
            "unknowns": "research", "realtime_pressure": "collaborative",
            "longevity": "infrastructure",
        },
        "market_band_usd": (200_000, 2_000_000),
    },
]


def login_cookie() -> str:
    req = urllib.request.Request(
        f"{BASE}/api/auth/login",
        data=json.dumps({"email": "admin@atlas.dev", "password": "admin123"}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        sc = resp.headers.get("set-cookie") or ""
    return sc.split(";", 1)[0].strip() if sc else ""


def call_estimate(goal: str, cookie: str, mode: str = "hybrid") -> dict:
    req = urllib.request.Request(
        f"{BASE}/api/estimate",
        data=json.dumps({"goal": goal, "mode": mode}).encode(),
        headers={"Content-Type": "application/json", "Cookie": cookie},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def classify(implementation_price: float, band: tuple) -> tuple:
    """Classify the LLM-derived base against the expected $5–8k band."""
    if implementation_price < 1500:
        return "demo-mode", RED
    if 1500 <= implementation_price < 4500:
        return "under-scoping", YELLOW
    if 4500 <= implementation_price <= 9000:
        return "calibrated", GREEN
    if implementation_price > 9000:
        return "over-scoping", DIM
    return "?", DIM


def main() -> int:
    print(f"{BOLD}LLM Scope Benchmark — 10 archetypes through live /api/estimate{RST}")
    print(DIM + "─" * 64 + RST)
    print(f"{DIM}Calibration target band for base implementation_price: $5,000 – $8,000{RST}")
    print(f"{DIM}From pricing-review-corpus: 80–90% archetypes land in market band IF base is in this zone.{RST}\n")

    try:
        cookie = login_cookie()
        if not cookie:
            print(f"{RED}Login failed — no session cookie returned{RST}")
            return 1
    except Exception as e:
        print(f"{RED}Login error: {e}{RST}")
        return 1

    print(
        f"  {BOLD}{'Impl $':>9}  {'Hours':>5}  {'Mods':>4}  "
        f"{'Final $':>9}  {'×Mult':>6}  {'Verdict':>14}  Archetype{RST}"
    )
    print("  " + DIM + "─" * 100 + RST)

    rows = []
    tally = {"calibrated": 0, "under-scoping": 0, "demo-mode": 0, "over-scoping": 0, "?": 0}
    for arch in ARCHETYPES:
        t0 = time.time()
        try:
            r = call_estimate(arch["brief"], cookie)
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode()[:200]
            except Exception:
                pass
            print(f"  {RED}HTTP {e.code}{RST}  {arch['name']}  · {body}")
            continue
        except Exception as e:
            print(f"  {RED}error{RST}  {arch['name']}  · {e}")
            continue
        dt = time.time() - t0

        est = (r.get("estimate") or {})
        pricing = est.get("pricing") or {}
        impl = float(pricing.get("implementation_price") or pricing.get("price") or 0)
        final = float(pricing.get("final_price") or 0)
        mult = float(pricing.get("reality_multiplier") or 1.0)
        hours = est.get("total_hours") or est.get("hours") or "?"
        modules = len(est.get("modules") or est.get("modules_preview") or [])
        axes = (pricing.get("axes") or est.get("axes") or {})

        verdict, color = classify(impl, arch["market_band_usd"])
        tally[verdict] = tally.get(verdict, 0) + 1

        print(
            f"  ${impl:>8,.0f}  {str(hours):>5}  {modules:>4}  "
            f"${final:>8,.0f}  ×{mult:>5.2f}  {color}{verdict:>14}{RST}  "
            f"{arch['name']}  {DIM}({dt:.1f}s){RST}"
        )
        # Show axes-disagreement on a second line
        diffs = []
        for axis, expected in arch["expected_axes"].items():
            actual = axes.get(axis, "?")
            if actual != expected:
                diffs.append(f"{axis}: LLM={actual} vs reviewer={expected}")
        if diffs:
            print(f"  {DIM}{'':>9}  {'':>5}  {'':>4}  {'':>9}  {'':>6}  {'':>14}  axes-Δ: {'; '.join(diffs)}{RST}")
        rows.append({
            "archetype": arch["name"],
            "implementation_price": impl,
            "final_price": final,
            "reality_multiplier": mult,
            "hours": hours,
            "modules": modules,
            "llm_axes": axes,
            "reviewer_axes": arch["expected_axes"],
            "axes_disagreements": diffs,
            "verdict": verdict,
            "market_band": list(arch["market_band_usd"]),
            "latency_sec": round(dt, 2),
        })

    print()
    total = sum(tally.values()) or 1
    for verdict in ["calibrated", "under-scoping", "demo-mode", "over-scoping", "?"]:
        n = tally.get(verdict, 0)
        if n == 0: continue
        bar = ("█" * n) + ("░" * (10 - n))
        pct = n * 100 // total
        print(f"  {verdict:>14}  {bar}  {n}/{total}  ({pct}%)")

    # Persist
    out = os.path.join(os.path.dirname(__file__), "..", "audit", "llm-scope-probe.json")
    import datetime as _dt
    with open(out, "w") as f:
        json.dump({
            "generated_at": _dt.datetime.utcnow().isoformat() + "Z",
            "tally": tally,
            "rows": rows,
        }, f, indent=2)
    print(f"\n{DIM}saved → {os.path.relpath(out, os.getcwd())}{RST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
