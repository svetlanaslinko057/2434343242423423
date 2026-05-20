# Phase A — Minimal Operational Graft Charter

> Created: 2026-05-18, post-Scope-Reviewer-Probe
>
> Companions: `/app/docs/operational-reviewer-probe-charter.md`, `/app/audit/SCOPE_REVIEWER_FINDINGS_2026-05-18.md`

---

## What this graft is

A **surgical, reversible production change** to the generator system prompt in
`_ai_scope_from_idea` (`/app/backend/server.py`). The change adds a 6-line
operator-tablestakes check covering **only the 7 proven prompt-problem categories**
identified by the Reviewer Probe (run 1):

1. `authentication_identity`
2. `authorization_rbac`
3. `observability_monitoring`
4. `deployment_infrastructure`
5. `reliability_recovery`
6. `compliance_security`
7. `qa_edge_cases`

Categories deliberately **excluded** from the graft (because they are cognition-limit
or saturated, not prompt-suppression):

- `ai_orchestration` — cognition limit, needs structured schema not prompt
- `notifications_delivery` — recognition without depth
- `integrations_external` — middle ground, premature to graft
- `payments_billing`, `realtime_synchronization`, `collaboration_multiplayer`, `analytics_reporting` — already saturated correctly

---

## Why this is the right next step (and not the wrong one)

The Reviewer Probe **proved** these 7 categories are recoverable when the model
is explicitly invited into operator mode. The graft tests whether the recovery
happens **in generator mode too**, or whether the suppression was actually
stabilizing behavior the reviewer-only path didn't capture.

Three possible outcomes — all informative:

| Outcome | What it means | Next decision |
|---------|---------------|---------------|
| **Clean recovery** — categories close in Phase B benchmark, inflation < +50%, no duplication | Generator can do operator mode; reviewer was just one valid implementation | Keep graft, retire reviewer plan |
| **Overinflation** — categories close BUT inflation > +100% with duplication ("Auth module" AND "User Authentication" both appear) | Suppression was stabilizing — generator can't self-regulate when invited | Revert graft, return to reviewer-as-second-pass design |
| **Partial recovery + cognition spill** — 7 graft categories close, but model also starts naming `ai_orchestration` etc. with shallow content | Prompt is contagious — invitation in one area triggers shallow-name-dropping in others | Revert and try more constrained intervention (structured slots) |

---

## The exact change

The system message in `_ai_scope_from_idea` previously read:

> *"You are a senior product architect. Given a client's product idea, return a realistic, buildable project plan as STRICT JSON. Break the product into the smallest set of independently shippable parts (3–7 modules)..."*

The graft adds, after the module-breakdown sentence and before the JSON-shape spec:

> *"Before finalizing modules, explicitly evaluate whether this product requires operator-side production foundations. These are usually invisible in user-facing descriptions but mandatory for production: **authentication & sessions**, **roles & permissions**, **observability & logging**, **deployment & CI/CD**, **reliability & retries**, **security & compliance audit trails**, **QA & validation**. If a foundation is genuinely required for this product, include it as one of the modules. If a foundation is genuinely not required (e.g. a single-user prototype doesn't need RBAC), skip it. Module count may exceed 7 if foundations are required."*

The maximum module count was also lifted from 7 to 12 in the post-parse `raw_modules[:8]` slice so foundation modules aren't truncated.

---

## How to revert

```bash
# In /app/backend/server.py, in _ai_scope_from_idea function:
# 1. Remove the "Before finalizing modules" paragraph from system_message
# 2. Restore the raw_modules[:8] slice (was changed to [:12])
# 3. supervisorctl restart backend
```

Both changes are in a contiguous ~10-line block, easy to revert with one search-replace.

The git commit for this graft is intentionally small and self-contained.

---

## Phase B — what we re-measure after the graft

Re-run the scope benchmark (NOT the reviewer probe — just the deterministic classifier):

```bash
python3 /app/scripts/scope-benchmark-corpus.py
```

The output overwrites `/app/audit/SCOPE_BENCHMARK_<date>.md` and `scope-benchmark-corpus.json`.
Before re-running, the previous artifacts have been **archived** to
`/app/audit/run1_pre_graft/` so we can do a side-by-side comparison.

We measure:

1. **Recognition delta**: how much the 7 graft categories closed.
2. **Cognition-limit spillover**: did the 9 non-graft categories drift?
3. **Inflation**: did `implementation_price` and `estimated_hours` go up, and by how much?
4. **Duplication**: are there modules with overlapping titles? (manual scan)
5. **False simplicity**: did the modifiers-around-recognized-keyword count rise?
6. **Asymmetry**: did user-vs-operator ratio rebalance (target: < 1.5 across corpus)?

---

## Discipline rules during Phase A

- ❌ No simultaneous changes to pricing engine, multipliers, or `infer_axes_via_llm`.
- ❌ No additions to the reviewer probe in the same session — Phase A is generator-only.
- ❌ No tuning the new prompt language between Phase A and Phase B. We measure what the first cut produces.
- ✅ Both Phase B and any subsequent comparison run use the same archetypes, mode, classifier.
- ✅ If Phase B shows overinflation OR cognition spillover, we revert without negotiation. The data dictates.
