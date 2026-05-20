#!/usr/bin/env python3
"""
Pricing Reality Layer — Stabilization Sweep
============================================

Per the post-Iteration-3 charter conversation: before doing Iteration 4
(evidence extraction / pricing inference), we run a *stabilization window* on
the math we already shipped.

Goal — verify that the engine is **judgment-calibrated**, not just code-correct:

  1. Determinism      same inputs → same outputs
  2. Monotonicity     within each axis, higher level → higher final price
                      (all else held constant)
  3. Order invariance the final_price doesn't depend on Python dict-key order
                      (it shouldn't — REALITY_AXIS_ORDER is canonical)
  4. No-NaN / no-zero no axis combination produces $0, NaN, or negative
  5. Chip-axis pairing every narrative chip in the output corresponds to a
                      non-baseline axis level — no orphans, no missing
  6. Psychological    five hand-crafted "iconic" projects priced and dumped
     sanity           for human eyeballing ("does $X for Y feel right?")
  7. Calibration      probe `/api/admin/pricing/calibration-suggestions` and
     probe            see what it currently emits given the synthetic corpus
                      (read-only, doesn't write anything)

This script touches NO production data and NO pricing_config. It imports
pricing_engine directly and computes prices in-process. The only network
call is the calibration suggestions probe at the end (optional, --probe-api).

Usage:
    cd /app/backend
    python ../scripts/pricing-stabilization-sweep.py                    # core invariants
    python ../scripts/pricing-stabilization-sweep.py --psychological     # + iconic projects
    python ../scripts/pricing-stabilization-sweep.py --probe-api         # + live API probe
    python ../scripts/pricing-stabilization-sweep.py --full              # everything

Exit code is non-zero iff an invariant fails.
"""
from __future__ import annotations

import argparse
import itertools
import json
import os
import random
import sys
from typing import Iterable

# Make backend importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from pricing_engine import (  # type: ignore
    DEFAULT_REALITY_LAYER,
    REALITY_AXIS_ORDER,
    apply_reality_layer,
    default_axes_snapshot,
)


GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
DIM = "\033[2m"
BOLD = "\033[1m"
RST = "\033[0m"


def ok(msg: str) -> None:
    print(f"{GREEN}✓{RST} {msg}")


def fail(msg: str) -> None:
    print(f"{RED}✗ {msg}{RST}")


def info(msg: str) -> None:
    print(f"{DIM}· {msg}{RST}")


def section(msg: str) -> None:
    print(f"\n{BOLD}{msg}{RST}")
    print(BOLD + "─" * len(msg) + RST)


# Pure synthetic config — mirrors DEFAULT_REALITY_LAYER so we don't need the DB.
SYN_CONFIG = {"reality_layer": DEFAULT_REALITY_LAYER}
BASE_PRICE = 1500.0  # arbitrary canonical base for all tests


def all_axis_combinations() -> Iterable[dict]:
    """Cartesian product of every level on every axis.
    4 levels × 5 axes = 4^5 = 1024 combos — fast and exhaustive.
    """
    axis_levels = [
        (axis, list(cfg["levels"].keys()))
        for axis, cfg in DEFAULT_REALITY_LAYER.items()
    ]
    keys = [k for k, _ in axis_levels]
    for combo in itertools.product(*[lv for _, lv in axis_levels]):
        yield dict(zip(keys, combo))


# -----------------------------------------------------------------------------
# 1. Determinism
# -----------------------------------------------------------------------------
def test_determinism(samples: int = 50) -> int:
    section("1. Determinism — same input → same output")
    failures = 0
    all_combos = list(all_axis_combinations())
    sample = random.Random(42).sample(all_combos, min(samples, len(all_combos)))
    for axes in sample:
        r1 = apply_reality_layer(BASE_PRICE, axes, SYN_CONFIG)
        r2 = apply_reality_layer(BASE_PRICE, axes, SYN_CONFIG)
        if r1 != r2:
            fail(f"Non-deterministic at axes={axes}: {r1['final_price']} vs {r2['final_price']}")
            failures += 1
    if failures == 0:
        ok(f"{len(sample)} samples are bit-for-bit deterministic")
    return failures


# -----------------------------------------------------------------------------
# 2. Monotonicity — higher entropy level → higher price (per axis)
# -----------------------------------------------------------------------------
def test_monotonicity() -> int:
    section("2. Monotonicity — higher axis level → higher price")
    failures = 0
    for axis_name, axis_cfg in DEFAULT_REALITY_LAYER.items():
        baseline = default_axes_snapshot()
        levels_in_order = list(axis_cfg["levels"].keys())
        prev_price = None
        for level in levels_in_order:
            axes = dict(baseline)
            axes[axis_name] = level
            result = apply_reality_layer(BASE_PRICE, axes, SYN_CONFIG)
            price = result["final_price"]
            if prev_price is not None and price < prev_price:
                fail(
                    f"Axis '{axis_name}' regresses at level '{level}': "
                    f"{prev_price} → {price}"
                )
                failures += 1
            prev_price = price
        if failures == 0:
            top_mult = axis_cfg["levels"][levels_in_order[-1]]["multiplier"]
            info(f"axis={axis_name}: monotonic, max ×{top_mult}")
    if failures == 0:
        ok("All 5 axes monotonically non-decreasing — economic logic preserved")
    return failures


# -----------------------------------------------------------------------------
# 3. Order invariance — dict key insertion order must NOT affect price
# -----------------------------------------------------------------------------
def test_order_invariance(samples: int = 30) -> int:
    section("3. Order invariance — dict key order must not change price")
    failures = 0
    all_combos = list(all_axis_combinations())
    sample = random.Random(7).sample(all_combos, min(samples, len(all_combos)))
    for axes in sample:
        items = list(axes.items())
        shuffled_items = items.copy()
        random.Random(11).shuffle(shuffled_items)
        shuffled = dict(shuffled_items)
        r1 = apply_reality_layer(BASE_PRICE, axes, SYN_CONFIG)
        r2 = apply_reality_layer(BASE_PRICE, shuffled, SYN_CONFIG)
        if r1["final_price"] != r2["final_price"]:
            fail(
                f"Order-dependent: {axes} → {r1['final_price']} "
                f"but {shuffled} → {r2['final_price']}"
            )
            failures += 1
    if failures == 0:
        ok(f"{len(sample)} samples — price invariant under dict-key reordering")
    return failures


# -----------------------------------------------------------------------------
# 4. No-NaN / no-zero / no-negative across the full 1024-combo space
# -----------------------------------------------------------------------------
def test_no_pathological_prices() -> int:
    section("4. No pathological prices (NaN / zero / negative) — exhaustive 1024")
    failures = 0
    minp, maxp = float("inf"), float("-inf")
    for axes in all_axis_combinations():
        r = apply_reality_layer(BASE_PRICE, axes, SYN_CONFIG)
        p = r["final_price"]
        if p != p:  # NaN
            fail(f"NaN at axes={axes}")
            failures += 1
        elif p <= 0:
            fail(f"Non-positive price ${p} at axes={axes}")
            failures += 1
        else:
            minp = min(minp, p)
            maxp = max(maxp, p)
    if failures == 0:
        ok(
            f"All 1024 combos priced — range ${minp:,.0f} → ${maxp:,.0f} "
            f"(spread ×{maxp/minp:.1f})"
        )
    return failures


# -----------------------------------------------------------------------------
# 5. Chip-axis pairing — chips only for non-baseline levels, and *every*
#    non-baseline level with a narrative MUST surface a chip.
# -----------------------------------------------------------------------------
def test_chip_axis_pairing(samples: int = 100) -> int:
    section("5. Chip-axis pairing — chips ⇔ non-baseline narratives")
    failures = 0
    all_combos = list(all_axis_combinations())
    sample = random.Random(3).sample(all_combos, min(samples, len(all_combos)))
    for axes in sample:
        result = apply_reality_layer(BASE_PRICE, axes, SYN_CONFIG)
        actual_chips = set(result["narrative_chips"])
        expected_chips = set()
        for axis_name, level in axes.items():
            level_cfg = (
                DEFAULT_REALITY_LAYER[axis_name]["levels"].get(level) or {}
            )
            narr = (level_cfg.get("narrative") or "").strip()
            if narr:
                expected_chips.add(narr)
        if actual_chips != expected_chips:
            fail(
                f"Chip mismatch at {axes}\n"
                f"   expected: {sorted(expected_chips)}\n"
                f"   actual:   {sorted(actual_chips)}"
            )
            failures += 1
    if failures == 0:
        ok(f"{len(sample)} samples — chip set exactly matches non-baseline narratives")
    return failures


# -----------------------------------------------------------------------------
# Pricing review corpus — 10 canonical archetypes for human-vs-engine review.
#
# Per post-stabilization session: axes are MY human-judgment first pass.
# `market_band_usd` is a rough Toptal/consultancy quote range for an MVP-grade
# build of the archetype (NOT a full Slack / NOT full Stripe — first product
# version that real founders would commission). Not a hard truth — a sanity
# bracket. Where engine output sits OUTSIDE the band → disagreement zone.
# -----------------------------------------------------------------------------
REVIEW_CORPUS = [
    {
        "archetype": "Slack clone (team chat MVP)",
        "axes": {
            "product_maturity": "production", "system_coupling": "platform",
            "unknowns": "medium", "realtime_pressure": "critical",
            "longevity": "long_term",
        },
        "market_band_usd": (30_000, 80_000),
        "judgment_notes": "Realtime is non-negotiable (critical, not collab). Multi-tenant from day one → platform. Chat is well-understood domain → medium unknowns, not high.",
    },
    {
        "archetype": "Linear clone (issue tracker)",
        "axes": {
            "product_maturity": "production", "system_coupling": "connected",
            "unknowns": "medium", "realtime_pressure": "collaborative",
            "longevity": "long_term",
        },
        "market_band_usd": (25_000, 60_000),
        "judgment_notes": "Realtime is collab (presence, optimistic updates) — not critical. Coupling is connected (Slack/GitHub webhooks) — not full platform.",
    },
    {
        "archetype": "Stripe-for-X (vertical payments)",
        "axes": {
            "product_maturity": "production", "system_coupling": "platform",
            "unknowns": "high", "realtime_pressure": "async",
            "longevity": "infrastructure",
        },
        "market_band_usd": (80_000, 200_000),
        "judgment_notes": "Compliance + chargebacks + reconciliation = high unknowns. Infrastructure-grade longevity (multi-year audit horizon). Realtime is async — webhooks not WebSockets.",
    },
    {
        "archetype": "B2B CRM (sales pipeline MVP)",
        "axes": {
            "product_maturity": "production", "system_coupling": "connected",
            "unknowns": "medium", "realtime_pressure": "async",
            "longevity": "long_term",
        },
        "market_band_usd": (20_000, 50_000),
        "judgment_notes": "Well-trodden domain. Connected (email/calendar integrations). No realtime requirements.",
    },
    {
        "archetype": "AI copilot (LLM-powered assistant)",
        "axes": {
            "product_maturity": "production", "system_coupling": "platform",
            "unknowns": "high", "realtime_pressure": "critical",
            "longevity": "long_term",
        },
        "market_band_usd": (30_000, 80_000),
        "judgment_notes": "LLM behaviour = high unknowns. Streaming responses → realtime critical. Platform (auth + billing + history + retrieval).",
    },
    {
        "archetype": "Infra observability tool (Datadog-lite)",
        "axes": {
            "product_maturity": "production", "system_coupling": "platform",
            "unknowns": "high", "realtime_pressure": "critical",
            "longevity": "infrastructure",
        },
        "market_band_usd": (60_000, 150_000),
        "judgment_notes": "Time-series + query perf at scale = high unknowns. Realtime alerting critical. Infrastructure longevity (clients trust this for years).",
    },
    {
        "archetype": "Marketplace (Etsy/Airbnb MVP)",
        "axes": {
            "product_maturity": "production", "system_coupling": "platform",
            "unknowns": "medium", "realtime_pressure": "async",
            "longevity": "long_term",
        },
        "market_band_usd": (30_000, 80_000),
        "judgment_notes": "Two-sided platform. Search + payments + trust system. Async realtime (notifications). Domain is well-understood.",
    },
    {
        "archetype": "Realtime multiplayer backend",
        "axes": {
            "product_maturity": "production", "system_coupling": "platform",
            "unknowns": "high", "realtime_pressure": "critical",
            "longevity": "long_term",
        },
        "market_band_usd": (40_000, 100_000),
        "judgment_notes": "State sync + latency budgets + anti-cheat = high unknowns. Realtime is THE product. Platform.",
    },
    {
        "archetype": "Banking dashboard",
        "axes": {
            "product_maturity": "production", "system_coupling": "platform",
            "unknowns": "high", "realtime_pressure": "collaborative",
            "longevity": "infrastructure",
        },
        "market_band_usd": (50_000, 120_000),
        "judgment_notes": "Compliance + audit + role hierarchies = high unknowns. Collab (multi-user reconcile). Infrastructure (regulator-readable for years).",
    },
    {
        "archetype": "Enterprise ERP (SAP-lite)",
        "axes": {
            "product_maturity": "scaled", "system_coupling": "operating_system",
            "unknowns": "research", "realtime_pressure": "collaborative",
            "longevity": "infrastructure",
        },
        "market_band_usd": (200_000, 2_000_000),
        "judgment_notes": "Becomes the company's operating-system. Org-specific = research unknowns. Multi-year horizons. Engine almost certainly under-prices here — that's expected; this archetype lives outside our engagement model.",
    },
]


def test_pricing_review_corpus() -> int:
    section(f"Pricing review corpus — {len(REVIEW_CORPUS)} canonical archetypes")
    # Three base scenarios — Reality Layer doesn't set base implementation price,
    # `/api/estimate` does (LLM-derived hours × hourly rate). We sweep three
    # plausible LLM-output bases to find the elasticity zone where the engine
    # lands inside the consultancy market band.
    bases = [1_500, 5_000, 8_000]
    summary_per_base = {}
    rows_for_report = []
    for base in bases:
        print()
        print(f"  {BOLD}base implementation price = ${base:,.0f}{RST}")
        print(
            f"  {BOLD}{'Engine':>10}  {'×Mult':>6}  "
            f"{'Market band':>18}  {'Verdict':>11}  Archetype{RST}"
        )
        print("  " + DIM + "─" * 100 + RST)
        over = under = within = 0
        for proj in REVIEW_CORPUS:
            r = apply_reality_layer(float(base), proj["axes"], SYN_CONFIG)
            engine_price = r["final_price"]
            mult = r["reality_multiplier"]
            lo, hi = proj["market_band_usd"]
            if engine_price < lo:
                verdict = "under"; color = YELLOW; under += 1
            elif engine_price > hi:
                verdict = "over"; color = RED; over += 1
            else:
                verdict = "within"; color = GREEN; within += 1
            band_str = f"${lo/1000:.0f}k–${hi/1000:.0f}k"
            print(
                f"  ${engine_price:>9,.0f}  ×{mult:>5.2f}  "
                f"{band_str:>18}  {color}{verdict:>11}{RST}  {proj['archetype']}"
            )
            rows_for_report.append({
                "base_price": base,
                "archetype": proj["archetype"],
                "axes": proj["axes"],
                "engine_price": engine_price,
                "multiplier": mult,
                "market_band": [lo, hi],
                "verdict": verdict,
                "chips": r["narrative_chips"],
                "judgment_notes": proj["judgment_notes"],
            })
        summary_per_base[base] = {"within": within, "under": under, "over": over}
        print()
        info(
            f"  base ${base:,}:   within={within}/10   under={under}/10   over={over}/10"
        )
    # Final interpretation table
    print()
    print(f"  {BOLD}Elasticity summary — share of archetypes inside market band{RST}")
    for base in bases:
        s = summary_per_base[base]
        within_pct = s["within"] * 10
        bar = ("█" * s["within"]) + ("░" * (10 - s["within"]))
        print(f"  base ${base:>5,}  {bar}  {within_pct}% within band")
    # Persist
    out = os.path.join(os.path.dirname(__file__), "..", "audit", "pricing-review-corpus.json")
    try:
        with open(out, "w") as f:
            json.dump({
                "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
                "bases_swept": bases,
                "rows": rows_for_report,
                "summary_per_base": {str(b): s for b, s in summary_per_base.items()},
            }, f, indent=2)
        info(f"saved → {os.path.relpath(out, os.getcwd())}")
    except Exception as e:
        info(f"could not persist json: {e}")
    return 0


# -----------------------------------------------------------------------------
# 6. Psychological sanity — five iconic projects priced for human eyeballing
# -----------------------------------------------------------------------------
ICONIC = [
    {
        "name": "Solo MVP — to-do list clone",
        "axes": {
            "product_maturity": "mvp",
            "system_coupling": "isolated",
            "unknowns": "low",
            "realtime_pressure": "none",
            "longevity": "prototype",
        },
    },
    {
        "name": "Startup product — beta, modest realtime, growing",
        "axes": {
            "product_maturity": "beta",
            "system_coupling": "connected",
            "unknowns": "medium",
            "realtime_pressure": "async",
            "longevity": "startup_mvp",
        },
    },
    {
        "name": "SMB SaaS — production with collaboration",
        "axes": {
            "product_maturity": "production",
            "system_coupling": "platform",
            "unknowns": "medium",
            "realtime_pressure": "collaborative",
            "longevity": "long_term",
        },
    },
    {
        "name": "Realtime trading dashboard — high stakes",
        "axes": {
            "product_maturity": "production",
            "system_coupling": "platform",
            "unknowns": "high",
            "realtime_pressure": "critical",
            "longevity": "long_term",
        },
    },
    {
        "name": "Infrastructure platform — research-grade, 5-yr horizon",
        "axes": {
            "product_maturity": "scaled",
            "system_coupling": "operating_system",
            "unknowns": "research",
            "realtime_pressure": "critical",
            "longevity": "infrastructure",
        },
    },
]


def test_psychological_sanity() -> int:
    section("6. Psychological sanity — five iconic projects (eyeball, do not assert)")
    print(
        f"\n{DIM}Base implementation price held at ${BASE_PRICE:,.0f}. "
        f"Final price = base × ∏(axis multipliers).{RST}\n"
    )
    rows = []
    for proj in ICONIC:
        r = apply_reality_layer(BASE_PRICE, proj["axes"], SYN_CONFIG)
        rows.append(
            {
                "name": proj["name"],
                "final": r["final_price"],
                "mult": r["reality_multiplier"],
                "chips": r["narrative_chips"],
            }
        )
    # Verify ordering (each level "more entropic" than the previous in our list).
    prev = None
    ordering_ok = True
    for row in rows:
        if prev is not None and row["final"] < prev["final"]:
            ordering_ok = False
        prev = row
    # Print table
    for row in rows:
        print(
            f"  {YELLOW}${row['final']:>10,.0f}{RST}  ×{row['mult']:>5.2f}   "
            f"{row['name']}"
        )
        chips_str = " · ".join(row["chips"]) if row["chips"] else f"{DIM}(no chips){RST}"
        print(f"  {DIM}{'':>11}{'':>9}   {chips_str}{RST}")
    print("")
    if ordering_ok:
        ok("Iconic projects sorted in expected complexity order (low → high)")
    else:
        fail("Iconic projects NOT monotonic — review axis multipliers")
    # Sanity bracket
    cheapest = rows[0]["final"]
    most_expensive = rows[-1]["final"]
    info(
        f"Cheapest (MVP) ${cheapest:,.0f}  →  Most complex "
        f"${most_expensive:,.0f}  →  spread ×{most_expensive/cheapest:.1f}"
    )
    return 0 if ordering_ok else 1


# -----------------------------------------------------------------------------
# 7. Calibration probe (optional, --probe-api)
# -----------------------------------------------------------------------------
def test_calibration_probe() -> int:
    section("7. Calibration probe — live read-only API")
    try:
        import urllib.request
        import urllib.error

        # Login → grab raw Set-Cookie header (the cookie is marked `Secure`
        # so urllib's CookieJar refuses to send it over plain HTTP localhost;
        # we ferry the session_token by hand instead).
        login_req = urllib.request.Request(
            "http://localhost:8001/api/auth/login",
            data=json.dumps({"email": "admin@atlas.dev", "password": "admin123"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(login_req, timeout=5) as resp:
            set_cookie = resp.headers.get("set-cookie") or ""
        cookie_value = set_cookie.split(";", 1)[0].strip() if set_cookie else ""
        if not cookie_value:
            fail("No session cookie returned by /api/auth/login")
            return 1

        for min_sample in (1, 3, 10):
            cal_req = urllib.request.Request(
                f"http://localhost:8001/api/admin/pricing/calibration-suggestions?min_sample={min_sample}",
                headers={"Cookie": cookie_value},
            )
            with urllib.request.urlopen(cal_req, timeout=5) as resp:
                payload = json.loads(resp.read())
            n = len(payload.get("suggestions") or [])
            projects = payload.get("projects_analyzed")
            invariant = payload.get("invariant")
            info(
                f"min_sample={min_sample:<2}  →  {n} suggestion(s), "
                f"{projects} projects analyzed, invariant='{invariant}'"
            )
            if not invariant or "observation-only" not in invariant:
                fail(f"Calibration endpoint missing observation-only invariant: {invariant!r}")
                return 1
        ok("Calibration endpoint live, asserts observation-only invariant at every threshold")
        return 0
    except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
        fail(f"Could not reach API: {e}")
        return 1


# -----------------------------------------------------------------------------
# main
# -----------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--psychological", action="store_true",
                        help="run iconic-project sanity check")
    parser.add_argument("--corpus", action="store_true",
                        help="run 10-archetype pricing review corpus")
    parser.add_argument("--probe-api", action="store_true",
                        help="probe live calibration endpoint")
    parser.add_argument("--full", action="store_true",
                        help="run everything")
    args = parser.parse_args()

    print(f"{BOLD}Pricing Reality Layer · Stabilization Sweep{RST}")
    print(DIM + "─" * 48 + RST)
    print(f"{DIM}5 axes · {sum(len(c['levels']) for c in DEFAULT_REALITY_LAYER.values())} levels · "
          f"{1024} unique combinations · base ${BASE_PRICE:,.0f}{RST}")

    failures = 0
    failures += test_determinism()
    failures += test_monotonicity()
    failures += test_order_invariance()
    failures += test_no_pathological_prices()
    failures += test_chip_axis_pairing()

    if args.psychological or args.full:
        failures += test_psychological_sanity()
    if args.corpus or args.full:
        failures += test_pricing_review_corpus()
    if args.probe_api or args.full:
        failures += test_calibration_probe()

    print()
    if failures == 0:
        print(f"{GREEN}{BOLD}All invariants hold. Engine is judgment-calibrated.{RST}\n")
        return 0
    print(f"{RED}{BOLD}{failures} invariant failure(s). Engine is NOT safe to ship as-is.{RST}\n")
    return 1


if __name__ == "__main__":
    sys.exit(main())
