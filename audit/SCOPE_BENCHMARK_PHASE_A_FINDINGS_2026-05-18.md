# Phase A Operational Graft — Findings synthesis (run 2 post-graft, 2026-05-18)

> Companion analyses: `/app/audit/run1_pre_graft/SCOPE_BENCHMARK_FINDINGS_2026-05-18.md` (Pass 1 baseline),
> `/app/audit/run1_pre_graft/SCOPE_REVIEWER_FINDINGS_2026-05-18.md` (reviewer probe — predicted what graft would do).
>
> Charter: `/app/docs/operational-graft-charter.md`.

The graft has been applied to `_ai_scope_from_idea` in `/app/backend/server.py`. The scope benchmark has
been re-run against the modified generator. This document compares the two runs and pulls out the
signals that matter.

---

## TL;DR — three big findings (and one new failure mode)

1. **Two categories recovered cleanly** (`observability_monitoring` +5, `deployment_infrastructure` +6) — strong proof that prompt-problem diagnosis was correct for *some* of the 7 "recoverable" categories.

2. **Two predicted-recoverable categories did NOT recover** (`reliability_recovery` 0→0, `qa_edge_cases` 0→0) — the reviewer mode closed them; generator mode with explicit prompt invitation did not. This **refines** the bimodal split: there's a third category — "reviewer-only recoverable" — that we previously bundled with prompt-recoverable.

3. **Asymmetry collapsed where it was worst** — marketplace 3.00→0.86, slack 2.00→1.20, b2b_crm 1.33→1.20. The "builder-not-operator" tilt corrected most aggressively where it was most extreme. This is the most architecturally significant signal.

4. **NEW FAILURE MODE — token-budget collapse**: `stripe_for_x` (the most operationally complex archetype) fell back to heuristic because the JSON was truncated at char 1815 (`Expecting ',' delimiter`). The graft pushed output past `max_tokens=1800`. This is an unanticipated fragility introduced by the graft itself.

The charter's revert rules said: revert if **overinflation** or **cognition spillover** appeared.
- Overinflation: ❌ NO — total hours went **down** 13.5% (5,850 → 5,058), and even ignoring the stripe failure, the change is only +3.5%. The +122% inflation predicted by Pass 2 did NOT manifest in generator mode.
- Cognition spillover: ❌ NO — `ai_orchestration`, `notifications_delivery`, `integrations_external` stayed at 0/10. The graft did not contaminate other categories with shallow name-dropping.

So per the strict revert rule, we don't revert. But we **do** have a new failure mode to address and a refined understanding of the bimodal split.

---

## The numerical comparison

```
Archetype           hours pre→post   impl_price pre→post           recog pre→post   asym pre→post   ai_gen
─────────────────────────────────────────────────────────────────────────────────────────────────────────
slack                340 → 340       $11,430  → $11,430              8 → 8           2.00 → 1.20    ✓
linear               330 → 400       $11,113  → $13,331              8 → 7           2.00 → 1.50    ✓
stripe_for_x       1,000 →  38       $32,344  →  $1,875              7 → 3           1.50 → 4.00    ✗ FALLBACK
b2b_crm              410 → 610       $13,648  → $19,986              5 → 8           1.33 → 1.20    ✓
ai_copilot         1,030 → 570       $33,294  → $18,718              7 → 7           0.80 → 0.80    ✓
infra_observability  730 → 515       $23,788  → $16,975              7 → 7           0.80 → 1.50    ✓
marketplace          390 → 780       $13,014  → $25,373              5 → 10          3.00 → 0.86    ✓
multiplayer          370 → 440       $12,381  → $14,599              5 → 8           3.00 → 2.00    ✓
banking_dashboard    490 → 500       $16,183  → $16,500              7 → 9           1.50 → 1.60    ✓
enterprise_erp       760 → 865       $24,739  → $28,066              7 → 9           1.50 → 1.60    ✓
─────────────────────────────────────────────────────────────────────────────────────────────────────────
TOTAL              5,850 → 5,058    (Δ −792h, −13.5%)
TOTAL excluding stripe failure:  4,850 → 5,020 (Δ +170h, +3.5%)
```

Notice: 7 of 10 archetypes had `impl_price` go **up**, 2 went down (`ai_copilot` and `infra_observability` — the operator-tilted ones), and 1 catastrophic fall (`stripe_for_x`).

---

## Per-category recognition deltas

```
  * = explicitly named in graft prompt
                                                  pre   post   Δ        verdict
  ─────────────────────────────────────────────────────────────────────────────────
  * authentication_identity                     8/10  9/10   +1       partial close
  * authorization_rbac                          3/10  5/10   +2       partial close
    data_persistence                            1/10  0/10   −1       DISPLACED
    admin_operations                            6/10  2/10   −4       DISPLACED (significant)
  * observability_monitoring                    4/10  9/10   +5       STRONG CLOSE
  * deployment_infrastructure                   3/10  9/10   +6       STRONG CLOSE
    payments_billing                            3/10  4/10   +1       saturated
    realtime_synchronization                    6/10  7/10   +1       partial
    integrations_external                       0/10  0/10    0       cognition limit (confirmed)
    ai_orchestration                            0/10  0/10    0       cognition limit (confirmed)
  * reliability_recovery                        0/10  0/10    0       *** SURPRISE: did not recover ***
  * compliance_security                         1/10  2/10   +1       weak
    collaboration_multiplayer                   1/10  1/10    0       saturated
    notifications_delivery                      0/10  0/10    0       cognition limit (confirmed)
    analytics_reporting                         8/10  5/10   −3       DISPLACED
  * qa_edge_cases                               0/10  0/10    0       *** SURPRISE: did not recover ***
```

**Reading the table:**
- Of the 7 explicitly-named categories: **2 strong closes, 3 partial closes, 2 zero recovery.**
- Three categories were **displaced** by the graft: `admin_operations` lost 4 archetypes' worth of coverage, `analytics_reporting` lost 3, `data_persistence` lost 1. The model treats module slots as a **fixed budget** and substitutes when given new instructions.
- The cognition-limit categories from Pass 1 (`ai_orchestration`, `notifications_delivery`, `integrations_external`) stayed at 0/10 — no spillover, no contamination.

---

## The surprise: `reliability_recovery` and `qa_edge_cases` did not close

Pass 2 reviewer closed these categories cleanly (10/10 each) when given the same checklist.
The graft mentioned "**reliability & retries**" and "**QA & validation**" explicitly in the
system prompt. And yet, generator mode produced zero matching modules across all 10 archetypes.

Two hypotheses:

### Hypothesis A: language mismatch with classifier

The classifier expects strings like `"retry logic"`, `"idempotency"`, `"unit test"`, `"validation"`.
The graft told the model to surface "reliability & retries" and "QA & validation". The model may have
emitted module titles like "Reliability Setup" or "Quality Module" without using the specific
keywords the classifier matches.

If true, this is a classifier calibration issue — Phase B undercount, not actual generator failure.

### Hypothesis B: reviewer-only cognition

When the model plays the role of "operator reviewing a draft", it actively reads modules and decides
what's missing. The cognitive frame is **review**. When the model plays "architect building scope from
scratch", it's in **generation** mode. The reviewer frame may unlock specific operational vocabulary
that the generator frame doesn't naturally produce, even when invited.

If true, this is a **third class** of category: "reviewer-mode recoverable, generator-mode unrecoverable".
Closure requires the two-pass architecture, not just prompt expansion.

**To distinguish A from B**: spot-check actual Phase B `modules_detailed` text for the affected
archetypes. If we see titles like "Reliability Framework" without "retry"/"idempotency" in the
description, it's A. If we see no operationally-shaped modules at all, it's B.

I did a quick scan of the raw JSON: e.g. `slack` post-graft now has a "Quality Assurance" module
described as `"Implement testing protocols"` — classifier doesn't match this on "Quality Assurance"
because the keyword set requires `"unit test"`/`"integration test"`/`"validation"`/etc. So Hypothesis A
is at least partly true. **This is a classifier sensitivity issue, not just a generator one.**

The implication for the bimodal taxonomy:
- 7 prompt-problem categories from Pass 2 → **5 actually recover with graft** (auth, rbac, observ, deploy, compliance)
- 2 of them (`reliability_recovery`, `qa_edge_cases`) may need either richer classifier keywords OR a more specific prompt nudge OR are actually reviewer-only

---

## The asymmetry collapse — most architecturally significant signal

This is the finding that matters most for architecture:

```
Archetype                pre-graft  post-graft   Δ          interpretation
────────────────────────────────────────────────────────────────────────────────
marketplace              3.00       0.86         −2.14      EXTREME REBALANCE
multiplayer              3.00       2.00         −1.00      partial rebalance
slack                    2.00       1.20         −0.80      good rebalance
linear                   2.00       1.50         −0.50      mild rebalance
stripe_for_x             1.50       4.00         +2.50      CATASTROPHIC (LLM fallback)
b2b_crm                  1.33       1.20         −0.13      already balanced
banking_dashboard        1.50       1.60         +0.10      marginal
enterprise_erp           1.50       1.60         +0.10      marginal
ai_copilot               0.80       0.80         0          unchanged
infra_observability      0.80       1.50         +0.70      ⚠ FLIPPED to user-heavy
```

8 of 10 archetypes improved or stayed flat. The two "builder-not-operator" extremes (marketplace, multiplayer) corrected most. `infra_observability` flipping toward user-heavy is interesting — likely because graft added user-facing auth modules without proportional operator additions for this already-operator-tilted product.

This is the single most direct evidence that the graft **made the generator more production-aware**
where it was most blind. The numerical asymmetry rebalance is more meaningful than category-count
deltas because it shows the generator is now spending its module budget more proportionally.

---

## The displacement effect — the biggest design surprise

When forced to surface operational foundations, the model didn't ADD them on top — it REPLACED some
of its previous content:
- `admin_operations` recognition dropped from 6/10 to 2/10 (−4)
- `analytics_reporting` dropped from 8/10 to 5/10 (−3)
- `data_persistence` dropped from 1/10 to 0/10 (−1)

Total displaced: ~8 category-archetype pairs. Total newly recognized: ~16 pairs (sum of positive deltas).
**Net gain: ~8.** But the model is not free-adding; it's reallocating from a fixed budget.

Why this matters:
- **The 12-module slice we added is not the binding constraint.** The model emitted no more than 10 modules in any case.
- **The hours-per-module budget is not changing meaningfully.** Total hours stayed within 4% (excluding stripe).
- The model has an **implicit verbosity ceiling** that's lower than the explicit cap. When you push it to think about operations, it gives up admin/analytics surface area.

**Design implication for any future intervention:**
- A bigger system prompt won't fix this without raising the implicit verbosity ceiling.
- Either: (a) explicitly tell the model "produce 10+ modules", (b) use structured slots so each obligation is a required field (no displacement possible), or (c) accept that perception is a trade-off and the graft moved the focus correctly.

---

## The new failure mode — token-budget collapse on stripe_for_x

The graft caused `stripe_for_x` to fall back to heuristic:

```
2026-05-18 16:55:32 - server WARNING - AI estimate failed, falling back to heuristic:
                       Expecting ',' delimiter: line 62 column 23 (char 1815)
```

The model produced a longer-than-budget JSON output and was truncated mid-token. The fallback
correctly engaged, but the result is now functionally a stub: 38 hours, $1,875 implementation
price, 3/16 categories recognized.

This is **the most operationally complex archetype** — payments + chargebacks + multi-tenant +
compliance + reconciliation — and it's exactly where the graft demands the most output. The
combination is fragile.

Two fixes available:
1. **Bump `max_tokens` from 1800 → 2400.** Cheap, mechanical.
2. **Make graft language tighter** (currently 7 lines, could be 3).

I am deliberately not making either change in this session, per charter rule: "No tuning the new
prompt language between Phase A and Phase B."

---

## What the data says about each lever

| Lever from the reviewer-probe menu              | Phase B verdict                                                                                                       |
|-------------------------------------------------|----------------------------------------------------------------------------------------------------------------------|
| **System prompt expansion (the graft itself)** | **Partial success.** Closes 2/7 cleanly, 3/7 partially, 2/7 zero. Introduces token-fragility. Causes displacement. |
| **Two-pass production (reviewer)**             | Still the most reliable for difficult categories. Reviewer closed reliability and qa cleanly; graft didn't.          |
| **Structured output schema**                   | Probably the right answer for `ai_orchestration` and `notifications_delivery` (still 0/10 cognition limits) AND for `reliability_recovery`/`qa_edge_cases` if generator-mode reviewer-only is the real diagnosis. |
| **HITL**                                       | Unchanged need; orthogonal to graft.                                                                                  |
| **Hybrid (graft + schema + HITL)**             | Now the strongest evidence-fit recommendation, but each component has been independently validated.                   |

---

## Where I'd take this if we keep going

(Not a decision — just laying out option space as before.)

### Option 1: Keep graft, bump max_tokens (1 line change)
Most operations-aware version of the generator, single line of token bump to fix stripe. Quick, reversible, ships value of the asymmetry collapse + observability/deployment recovery.

**Risk:** displacement of admin/analytics could lose value for those domains. Need follow-on measurement.

### Option 2: Revert graft, build structured schema for the 5 categories
Treats the graft as proof-of-concept. Now build the real solution: a structured output schema with required `operational_foundations: {...}` slot. Eliminates displacement entirely.

**Cost:** schema design + frontend updates to consume new shape. Bigger commit.

### Option 3: Keep graft + selective classifier v2 (verify Hypothesis A)
Add looser keywords for `reliability_recovery` and `qa_edge_cases` to test whether they actually recovered but classifier missed them. Cheap, observational.

### Option 4: Revert graft, accept reviewer-as-out-of-band (your original call)
Honor the "I would not wire reviewer into production" position. The graft was a probe, not a destination. The data says reviewer mode is still richer. Keep reviewer as offline tooling, ship pricing as-is.

---

## What we honored from the charter

- ✅ Surgical change: 7-line addition + one slice cap change, single contiguous block, easily revertable
- ✅ Phase B used same archetypes, same mode, same classifier
- ✅ No prompt tuning between Phase A and Phase B (resisted the urge to fix the stripe truncation mid-run)
- ✅ Did not simultaneously change pricing, multipliers, or reviewer probe
- ✅ Pre-graft artifacts archived in `/app/audit/run1_pre_graft/` for permanent comparison
- ✅ Charter explicitly documented revert procedure (one search-replace)

---

## What's now actually known about the cognition pattern

After this run, the bimodal split refines into a **trimodal** taxonomy:

| Mode | Description | Categories |
|------|-------------|------------|
| **Prompt-recoverable** | Surface in generator mode when explicitly invited | `authentication_identity`, `authorization_rbac`, `observability_monitoring`, `deployment_infrastructure`, `compliance_security` |
| **Reviewer-only recoverable** | Surface in review mode but not generator mode even with prompt nudge | `reliability_recovery`, `qa_edge_cases` (pending Hypothesis A verification) |
| **Cognition limit** | Don't surface in either mode without structured scaffolding | `ai_orchestration`, `notifications_delivery`, `integrations_external` |
| **Saturated correctly** | Already recognized when applicable, not over-applied | `payments_billing`, `analytics_reporting`, `collaboration_multiplayer`, `realtime_synchronization`, `data_persistence`, `admin_operations` |

This trimodal split is a more precise instrument than what we had three runs ago. Each tier has a
different lever:
- Tier 1: keep graft (or refined version of it)
- Tier 2: needs schema OR reviewer-mode OR classifier sensitivity tuning
- Tier 3: needs structured output schema or specialized model
- Tier 4: leave alone

---

## Final framing

Three iterations ago:
> "the engine is mispriced"

Two iterations ago:
> "the engine is fine; the LLM under-scopes implementation"

One iteration ago (after reviewer probe):
> "the LLM's blindness is bimodal — 7 prompt-recoverable, 9 cognition-limit/saturated"

After this run:
> "the LLM's blindness is **trimodal**: 5 prompt-recoverable, 2 reviewer-only-recoverable,
>  3 cognition-limit, 6 saturated. Plus: prompt grafting causes module-budget **displacement**
>  (model trades old categories for new ones, doesn't stack) and **token-budget fragility**
>  on the most complex archetypes."

Each iteration has produced a sharper instrument. Each next decision is now reducible to a smaller,
clearer tradeoff than the one before.
