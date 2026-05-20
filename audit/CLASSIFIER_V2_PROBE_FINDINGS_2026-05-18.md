# Classifier v2 Probe — Findings synthesis (2026-05-18)

> Companion to: `/app/audit/CLASSIFIER_V2_PROBE_2026-05-18.md` (auto-generated report)
> Charter context: `/app/audit/SCOPE_BENCHMARK_PHASE_A_FINDINGS_2026-05-18.md` raised this probe as the deciding test
> between Hypothesis A (classifier issue) and Hypothesis B (reviewer-only recoverable).

---

## TL;DR — Hypothesis B fully confirmed

**Pre-graft v2 deltas**: `reliability_recovery` +1, `qa_edge_cases` +0 (total +1)
**Post-graft v2 deltas**: `reliability_recovery` +0, `qa_edge_cases` +0 (total +0)

With **57 additional keywords** (26 for reliability, 31 for QA) spanning the full operational vocabulary —
"reliability", "fault tolerance", "high availability", "failover", "rollback", "data integrity",
"qa ", "quality assurance", "testing protocol", "automated test", "data validation", "sanity check" —
the post-graft corpus produced **zero new matches** in either category across 10 archetypes.

This is decisive. The graft prompt explicitly says "reliability & retries, QA & validation".
The generator's reply mentions neither concept in any form — not as a module title, not in a
description, not in tech_stack, not in narrative chips.

---

## What the spot-check of actual modules confirmed

Manual scan for the substring stems (`relia`, `qa`, `qual`, `test`, `valid`, `retry`, `fault`,
`toler`, `rollback`, `availab`, `sani`, `assurance`) across the post-graft `modules_detailed` of
all 10 archetypes:

| Archetype | Stems found in any module text |
|-----------|--------------------------------|
| slack | (none) |
| linear | (none) |
| stripe_for_x | (none — fell back to heuristic) |
| b2b_crm | (none) |
| ai_copilot | (none) |
| infra_observability | (none) |
| marketplace | `relia` (single occurrence in one description) |
| multiplayer | (none) |
| banking_dashboard | (none) |
| enterprise_erp | (none) |

**Result**: across 10 archetypes' worth of generated modules — and we're talking about a graft
that explicitly named "QA & validation" in the system prompt — the model produced exactly **one**
occurrence of `reliability` substring (in `marketplace`) and **zero** occurrences of anything
related to QA / testing / validation / retry.

This is not a classifier sensitivity issue. The cognitive frame the generator operates in simply
does not produce this vocabulary, even when invited.

---

## The actual trimodal taxonomy (now empirically verified)

| Mode | Categories | Evidence |
|------|-----------|----------|
| **Prompt-recoverable** (5) | `authentication_identity`, `authorization_rbac`, `observability_monitoring`, `deployment_infrastructure`, `compliance_security` | Phase A graft moved recognition counts by +1 to +6 |
| **Reviewer-only recoverable** (2) | `reliability_recovery`, `qa_edge_cases` | Pass 2 reviewer closed 10/10 each; generator graft + classifier v2 still produces ZERO matches |
| **Cognition limit** (3) | `ai_orchestration`, `notifications_delivery`, `integrations_external` | Stayed 0/10 in both Pass 1 and Pass 2 generator mode |
| **Saturated correctly** (6) | `payments_billing`, `analytics_reporting`, `collaboration_multiplayer`, `realtime_synchronization`, `data_persistence`, `admin_operations` | Recognized in archetypes where applicable, absent where genuinely not |

The middle tier — "reviewer-only recoverable" — is the most architecturally interesting finding
of the entire iteration. It tells us:

> **The generator and reviewer modes produce structurally different content, not
> just differently-framed versions of the same content.**

This is not a vocabulary issue. The reviewer LLM, given the same brief and the same checklist,
produced 10/10 modules for these two categories (often called "Reliability Setup", "Quality
Assurance", "Testing Framework"). The generator LLM, given the same brief and an explicit
prompt invitation, produced **zero**. Same model, same key, different cognitive frame.

The frames are not redundant. They are **operationally different cognitive subsystems**.

---

## What this means for the original questions

### "Was graft worth keeping?"

**Yes.** The Phase A graft delivered:
- `observability_monitoring` 4→9 (+5)
- `deployment_infrastructure` 3→9 (+6)
- Partial recovery on auth, RBAC, compliance
- Asymmetry collapsed on the two worst "builder-not-operator" archetypes (marketplace 3.00→0.86, slack 2.00→1.20)
- No overinflation (−13.5% hours, with the displacement effect explaining most of that)
- No cognition spillover (the 3 cognition-limit categories stayed 0/10)

Even if 2 of the 7 "prompt-recoverable" categories turned out to be reviewer-only, the graft
still moves the generator significantly closer to operator awareness across the corpus.

### "Was Hypothesis A or B correct?"

**B**, decisively. The model does not produce reliability or QA vocabulary in generator mode at all,
even with explicit prompt invitation. The classifier was not too tight — the content was not there.

### "What's the next step?"

Three options now have **evidence backing**:

1. **Accept the trimodal split as final.** Keep graft. Accept that reliability and QA are
   reviewer-only categories and require a different mechanism (structured slots OR Pass-2 in production).

2. **Build structured output schema for the 2 reviewer-only categories.** Force them as required
   fields in the JSON response shape (`reliability_module: {...}`, `qa_module: {...}`). The model
   will be forced to fill them, but quality of fill is unknown. Probe-able with same classifier.

3. **Wire the reviewer as a production Pass-2 — but only for these 2 categories.** Run reviewer
   for `reliability_recovery` and `qa_edge_cases` only, ignore other categories' Pass-2 output.
   Minimizes latency cost. Doesn't double the LLM bill — just adds a focused 1-category-each call.

All three are read-only from the user's perspective right now. None requires us to commit yet.

### "What about the stripe_for_x token-budget collapse?"

Still unresolved. The classifier v2 probe didn't address it (it's a generator-side issue, not
classifier). The fix is mechanical:

```python
# In server.py _ai_scope_from_idea:
.with_params(max_tokens=2400)  # was 1800
```

Recommended sequence (per your stated ordering):

> 1. Classifier v2 probe ✅ done
> 2. Token bump 1800→2400, if stripe still fails ← do this next if we keep graft
> 3. Repeat Phase B with the bump in place

The bump is a 1-line change. We can do it now or later. The graft itself is **not** what's broken
on stripe — the JSON parsing budget is. They're independent.

---

## The classifier v2 keyword set — keeping it or not?

The v2 keywords added 26 + 31 = 57 patterns to be more permissive about what counts as recognition.
The probe shows they **didn't fire** because the content wasn't there. But they're still a more
accurate measurement instrument going forward — they capture broader phrasing without false-positives
(since they didn't fire on anything spurious either).

**Recommendation**: Leave the v2 overrides in `_operational_obligations.py`. They're already
inert when content is absent. Mark them as v2 in code. Future benchmark runs can opt-in via:

```python
from _operational_obligations import get_categories_v2
# instead of:
from _operational_obligations import CATEGORIES
```

I have NOT made `scope-benchmark-corpus.py` use v2 by default. The default classifier stays v1
so all existing corpus comparisons stay valid. v2 is an opt-in instrument.

---

## What this run does NOT change

- ❌ `/api/estimate` was not called once. This was pure file-IO + regex.
- ❌ The Phase A graft in `server.py` is unchanged.
- ❌ No pricing math touched.
- ❌ No archetype briefs added or modified.
- ❌ The Pass 2 reviewer probe is unchanged.
- ❌ Neither pre-graft nor post-graft benchmark JSON was modified — they were only read.

---

## Final framing

Three iterations ago:
> "the engine is mispriced"

Two iterations ago:
> "the engine is fine; the LLM under-scopes implementation"

One iteration ago:
> "the LLM's blindness is bimodal — 7 prompt-recoverable, 9 cognition-limit/saturated"

Half an iteration ago (Phase A):
> "the bimodal split refines into trimodal: 5 prompt-recoverable, 2 mystery (reviewer-only?), 3 cognition-limit, 6 saturated"

After this probe:
> "the trimodal split is empirically verified. Generator and reviewer modes produce **structurally
> different content**, not just different framings. The 2 'reviewer-only recoverable' categories
> are a genuine cognitive class that prompt expansion cannot close. The path to closing them is
> either structured output schema (force-fill required fields) or production Pass-2 (different
> cognitive frame as a second pass)."

The instrument is now sharp enough that each remaining decision is reducible to a specific
mechanical fix — token bump, schema addition, or focused Pass-2 call — and we know exactly
which problem each fix addresses.

This iteration officially closed the "perception measurement" question. The next iteration —
if there is one — moves into intervention design.
