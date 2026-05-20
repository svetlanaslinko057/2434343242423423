# Pricing Reality Layer — Stabilization Window Report
**Date:** 2026-05-18
**Charter reference:** `/app/docs/pricing-reality-layer-iteration-3-charter.md`
**Iteration:** post-3, pre-4 (deliberate)

> Per the post-Iteration-3 review: *"calibration of judgment, not calibration of code."*
> Before going to Iteration 4 (evidence extraction), we ran a stabilization sweep
> on the math we already shipped to verify the engine is **judgment-calibrated**.

---

## How to reproduce

```bash
cd /app/backend
python ../scripts/pricing-stabilization-sweep.py --full
```

Exit code is non-zero iff any invariant fails. No production data is touched.
No `pricing_config` is mutated. No LLM credits are burned.

---

## What was tested (7 invariants)

| #  | Invariant | Scope | Result |
|----|-----------|-------|--------|
| 1  | **Determinism** — same input → same output, bit-for-bit | 50 random samples | ✅ |
| 2  | **Monotonicity** — within each axis, higher entropy level → higher price (all else held) | All 5 axes × all 4 levels | ✅ |
| 3  | **Order invariance** — dict key insertion order has no effect on price | 30 samples × shuffled | ✅ |
| 4  | **No pathological prices** — no NaN, no $0, no negative | Exhaustive 1024 / 1024 combos | ✅ |
| 5  | **Chip-axis pairing** — every chip ⇔ a non-baseline axis level (no orphans, no missing) | 100 random samples | ✅ |
| 6  | **Psychological sanity** — five iconic projects sorted in expected complexity order | Eyeball + monotonicity assert | ✅ |
| 7  | **Calibration probe** — live `/api/admin/pricing/calibration-suggestions` returns observation-only invariant at every threshold | Live HTTP probe, 3 thresholds | ✅ |

**Verdict:** *All invariants hold. Engine is judgment-calibrated.*

---

## Price space at base = $1,500

Across the full 1024-combo space:

```
min   $1,500    (all axes at baseline — legacy projects price unchanged)
max   $65,340   (every axis at top level — Scaled production + OS scope + Research + Realtime + Infrastructure)
spread ×43.6
```

The spread feels right: a generic MVP and an OS-grade research platform
should differ by ~40×, not ~3× (price collapse) and not ~400× (price drift).

---

## Psychological sanity table (eyeball results)

Hand-curated five "iconic" projects, priced at base `$1,500`:

| Final price | Multiplier | Project archetype | Narrative chips |
|---:|---:|:---|:---|
| **$1,500** | ×1.00 | Solo MVP — to-do list clone | MVP · Isolated app |
| **$4,036** | ×2.69 | Startup product — beta, modest realtime, growing | Beta · Connected system · Discovery work |
| **$11,340** | ×7.56 | SMB SaaS — production with collaboration | Production-grade · Platform complexity · Discovery work · Collaboration · Long-term product |
| **$18,662** | ×12.44 | Realtime trading dashboard — high stakes | Production-grade · Platform complexity · High uncertainty · Realtime · Long-term product |
| **$65,340** | ×43.56 | Infrastructure platform — research-grade, 5-yr horizon | Scaled production · Operating-system scope · Research-grade · Realtime · Infrastructure |

These read sane to me:

- **$1,500 → $4k** is the right jump when you go from "I'm hacking a prototype" to "real customers will use this".
- **$4k → $11k** captures the transition to platform thinking + collaboration.
- **$11k → $19k** is realtime + uncertainty — i.e. you can't just "throw frontend at it".
- **$19k → $65k** is the infrastructure cliff — research-grade unknowns + OS-scope + 5-year horizon. This is where consultancies normally charge $100k+, so the engine actually *under*-prices the high end. Worth a future review when we have real data.

---

## What this report deliberately does NOT do

- ❌ It does NOT recommend changing any multiplier. Per charter Rule 1
  (calibration NEVER mutates), tuning is a separate manual decision in
  `/admin/finance/pricing`.
- ❌ It does NOT run on real production projects. Only synthetic combos +
  a live read-only API probe.
- ❌ It does NOT touch the LLM. `infer_axes_via_llm()` is non-deterministic
  by design and is not part of the engine's mathematical contract.

---

## Pre-Iteration-4 readiness checklist

| Item | Status |
|------|:------:|
| Pricing math invariants hold | ✅ |
| Iconic projects price plausibly | ✅ |
| Multipliers fall in psychologically defensible ranges | ✅ |
| Calibration endpoint is read-only by construction | ✅ |
| Engine survives 1024 axis combinations without NaN / $0 | ✅ |
| Narrative chips never leak multiplier numbers | ✅ |
| First real completed project exists with logged hours | ⏳ |
| Calibration table has ≥ 5 samples on any axis | ⏳ (`projects_analyzed=1`, need ~5 more cold-start completions) |

The last two are time-gated (need real-world completed projects). **Iteration 4
remains parked until they fill in** — that's exactly what the post-Iteration-3
review prescribed: "погонять 20–50 synthetic projects, посмотреть calibration
suggestions, calibration of judgment".

---

## Next observable triggers (NOT actions)

When any of these become true, re-open this report:

1. `projects_analyzed >= 5` for any single axis → calibration starts being
   informative. Re-run the probe + read the suggestion(s) on the audit log
   before acting in the cockpit.
2. A real client renegotiates the price → re-price flow exercises the
   `pricing_history` audit chain for real. Inspect the chain integrity.
3. `legacy_estimate_hits.last_hit_at` is older than 7 days → safe to start
   physical removal of `/api/ai/estimate`.
4. Spread between cheapest and most-expensive iconic project widens
   meaningfully (×43 → ×60+) without a deliberate config change → red flag,
   re-run sweep, investigate which axis drifted.
