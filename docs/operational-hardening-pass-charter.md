# Operational Hardening Pass Charter

> Created: 2026-05-18, after Classifier v2 Probe confirmed Hypothesis B.
>
> Companions: `SCOPE_REVIEWER_FINDINGS_2026-05-18.md`, `SCOPE_BENCHMARK_PHASE_A_FINDINGS_2026-05-18.md`,
> `CLASSIFIER_V2_PROBE_FINDINGS_2026-05-18.md`.

---

## The architectural axiom

> **Operational hardening is not a generation task. It is a review task.**

Empirically established across 4 corpus runs:

- Generator mode (with or without explicit prompt invitation) produces ZERO reliability or QA modules across 10 archetypes.
- Reviewer mode (separate sub-call with the same brief + checklist) produces 10/10 for both categories.
- Classifier v2 with 57 additional broad keywords confirms: the content is genuinely not there in generator output — it's not a vocabulary mismatch.

This axiom shapes the intervention: instead of forcing the generator to do something it doesn't do,
we **add a focused reviewer sub-call** that does what it's already proven to do well.

---

## What changed in production (this commit)

Two changes to `_ai_scope_from_idea` in `/app/backend/server.py`:

### 1. Token bump
```python
.with_params(max_tokens=2400)  # was 1800
```
Mechanical stability fix. The Phase A graft caused `stripe_for_x` to fall back to heuristic
because the longer JSON was truncated at char 1815. This bump gives 600 more tokens of headroom.
**This is unrelated to cognition. It's pure infrastructure.**

### 2. Operational hardening sub-call (focused Pass-2)
Added after the main scope is built, before return:
```python
if OPERATIONAL_HARDENING_ENABLED and modules:
    try:
        hardening_modules = await _ai_operational_hardening_pass(goal, modules, key, model)
        if hardening_modules:
            modules.extend(hardening_modules)
            hours = max(hours, sum(int(m.get("hours") or 0) for m in modules))
    except Exception as e:
        logger.info(f"operational hardening pass skipped: {e}")
```

Plus the new function `_ai_operational_hardening_pass` that:
- Receives brief + Pass-1 modules
- Makes a separate `LlmChat` call in **reviewer frame** (different cognitive mode)
- Asks for AT MOST 2 missing modules (1 reliability + 1 qa)
- Returns empty list if neither is needed for this archetype (model decides)
- Each module marked `_source: "operational_hardening_pass"` and `_category: "reliability"|"qa"`
- Module hours capped at 8–80 sanity bound
- On any failure (timeout, parse error, missing key): returns `[]` silently — never breaks the main estimate

### 3. Feature flag

```python
OPERATIONAL_HARDENING_ENABLED = True  # set False to revert to single-pass
```

---

## Why this design and not the alternatives

| Alternative | Why we didn't pick it |
|-------------|-----------------------|
| Universal Pass-2 reviewer on ALL 16 categories | +122% cost inflation predicted by Pass-2 corpus run. Most categories don't need it (they're saturated or recoverable). Premature commit to two-pass architecture. |
| Structured output schema with `reliability_module` + `qa_module` required fields | Locks ontology too early. Cognition-limit categories (ai_orchestration, notifications, integrations) still unresolved — schema becomes maintenance burden before its shape is stable. |
| Accept the trimodal split, do nothing | Reliability + QA are not cosmetic categories. They're production stability, failure handling, deployment survivability. Especially after MONEY_STATE_MACHINE work, leaving them blind is structurally wrong. |
| Bigger graft prompt | Already tried in Phase A. Reliability+QA stayed 0/10 even with explicit prompt invitation. Cognition limit confirmed. |

This focused Pass-2 is the smallest intervention that respects the proven cognitive split.

---

## What we expect to measure in Phase C benchmark

### Predicted

- `reliability_recovery` 0/10 → 8-10/10 (reviewer is 10/10 in reviewer probe; production sub-call may be slightly tighter since `required_for_archetype` discipline is enforced)
- `qa_edge_cases` 0/10 → 8-10/10 (same)
- Other categories: unchanged (sub-call is forbidden from suggesting non-reliability/QA modules)
- Hours: +10% to +25% per archetype (each module 8-80h capped, max 2 modules per archetype)
- Asymmetry: marginal further improvement (these categories are operator-audience)
- Duplication: should be near zero — sub-call explicitly told "DO NOT repeat existing scope"
- Hallucination: should be near zero — reviewer probe showed 0/160 hallucinations on the same prompt discipline

### Failure modes to watch for

- **Duplication**: sub-call adds a "Quality Assurance" module when generator already added "Testing Framework". Defense: title de-dup check is in the function; but semantic duplication (different words, same concept) is not caught yet.
- **Hours bloat**: sub-call emits very high `hours`. Defense: hard cap at 80 per module.
- **Stripe latency**: now we have 2 LLM calls per estimate. `/api/estimate` p95 may move from ~10s to ~15-20s.
- **Cascading failure**: main scope succeeds, hardening fails, we want to **continue with main scope** (not fail the whole estimate). Implemented as `try/except` with `[]` fallback.

---

## How to revert

Single line:

```python
# In /app/backend/server.py, near line ~23020:
OPERATIONAL_HARDENING_ENABLED = False
```

Restart backend. Old behavior restored. Token bump stays (it's independent and safe).

Or full revert: delete the hardening block, delete `_ai_operational_hardening_pass` function,
restore `max_tokens=1800`. All three changes are in a single contiguous edit, easy to undo.

---

## Phase C — how we measure success

After this commit lands and backend reloads:

```bash
# Archive Phase B baseline
mkdir -p /app/audit/run2_post_graft
cp /app/audit/scope-benchmark-corpus.json /app/audit/SCOPE_BENCHMARK_2026-05-18.md \
   /app/audit/SCOPE_BENCHMARK_PHASE_A_FINDINGS_2026-05-18.md /app/audit/run2_post_graft/

# Run Phase C
python3 /app/scripts/scope-benchmark-corpus.py
```

Then synthesize `SCOPE_BENCHMARK_PHASE_C_FINDINGS_2026-05-18.md` with comparisons against
both `run1_pre_graft/` (baseline) and `run2_post_graft/` (Phase A graft only).

Three primary metrics:
1. **Reliability + QA recognition rate** — must move from 0/10 to something meaningful
2. **No regression elsewhere** — other 14 categories must not drift
3. **Duplication/hallucination check** — manual scan of new modules

If reliability/QA hit 0 again, the sub-call is broken (not the axiom) — debug the call itself.
If they hit 8-10, the axiom is operationalized correctly and we ship.

---

## Discipline notes

- ❌ No simultaneous changes to pricing engine, multipliers, axes inference, or other LLM call sites.
- ❌ No tuning the hardening prompt between Phase C run and findings.
- ❌ No changes to the classifier or operational obligations catalog during Phase C.
- ✅ Phase C uses the same archetypes, same mode, same v1 classifier — apples to apples.
- ✅ If Phase C shows duplication or hallucination, we tune the hardening prompt in a follow-up,
   not in this commit.
