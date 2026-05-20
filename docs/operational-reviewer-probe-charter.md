# Operational Reviewer Probe Charter

> Created: 2026-05-18 (Iteration 4 micro-probe, post-Scope-Benchmark)
>
> Companion to: `/app/docs/scope-benchmark-charter.md` and `/app/audit/SCOPE_BENCHMARK_FINDINGS_2026-05-18.md`.

---

## The question this probe answers

> **Is the operational blindness measured in run-1 a *prompt problem* or a *cognition limit*?**

The scope benchmark established that the LLM scope generator, in its current form, fails to perceive
5 of 16 operational obligation categories across all 10 archetypes. The natural next question is
whether those blind spots are:

- **(a) prompt problem** — the model *can* perceive them when explicitly forced into operator mode, it just doesn't volunteer them in its natural production tendency, OR
- **(b) cognition limit** — the model genuinely cannot perceive them even when explicitly prompted with the checklist.

The mechanism to test this is a `generator → reviewer` two-pass probe, modelled on code review:

| Pass | What it does | Touched by probe? |
|------|--------------|-------------------|
| 1    | Live `/api/estimate` produces scope normally (UNCHANGED) | ❌ read-only |
| 2    | Out-of-band LLM call: "review the scope ONLY for missing operational obligations against this 16-item checklist" | new, observational |

The probe **does not push** Pass 2 output into pricing. It **does not modify** the generator. It does
not change routing, prompts, or any production behavior. Pass 2 is a **second observer** of the same
brief — a different cognitive mode, same model, same key, separate call.

---

## What "good Pass 2 behavior" looks like

The reviewer is **not** asked to be exhaustive. It's asked to honestly answer two questions per
obligation:

1. `present_in_draft: bool` — did the scope draft already cover this category, in your reading?
2. `required_for_archetype: bool` — is this category genuinely required for THIS product?

And if `present_in_draft == false` and `required_for_archetype == true`, the reviewer suggests a
module: `{title, description, hours}` — same shape as Pass 1 modules.

Critically, the reviewer is told:

> *Do not add modules for categories that are genuinely not relevant. Honesty about "not applicable"
> is more valuable than checklist completeness.*

This gives us two signals:
- **Coverage delta** — what Pass 2 surfaces that Pass 1 missed
- **Hallucination check** — if Pass 2 marks a category `required: false` but suggests a module anyway, that's a forced compliance answer, not real perception

---

## The three things the probe measures

### 1. Perception ceiling (the headline question)

Per category, across the corpus: how many archetypes did Pass 2 close that Pass 1 had open?
This is the **perception ceiling delta**.

- If the ceiling closes most blind categories → the model **can** perceive them, the issue is **prompt** (path forward: structured prompt extension)
- If the ceiling barely moves → it's **cognition** (path forward: harder — different model, decomposed pipeline, or human-in-the-loop)
- If the ceiling closes *some* categories but not others → the distinction is per-category (path forward: targeted interventions per category)

### 2. Required-vs-applicable discipline

Per archetype × category: did the reviewer mark `required_for_archetype` honestly?

We can spot-check this manually. For example, Pass 2 marking `ai_orchestration: required: true` for
an enterprise ERP would be a forced answer (most ERPs don't have AI inside; if they do it's a
narrow feature). Pass 2 marking `compliance_security: required: true` for the banking dashboard
is genuine.

The ratio `required_true / total_archetypes` per category is also informative. Categories with
near-universal required-true mean the model recognizes them as production tablestakes (`auth`,
`reliability`, `observability`). Categories with patchy required-true reveal which obligations
are domain-specific (`ai_orchestration`, `payments_billing`).

### 3. Cost of operator-awareness (informational only)

Sum the suggested-module hours across the corpus. Apply `× $65/h` for a back-of-envelope price
delta. **This is not pushed into the pricing engine.** It's a number we report so we can talk
about it.

If "becoming operator-aware" adds 30% to project hours, the engineering economic story changes.
If it adds 5%, it's free margin. Either is information.

---

## What this probe does NOT do

- ❌ Doesn't change `/api/estimate`. Production scope generator is untouched.
- ❌ Doesn't push Pass 2 modules into project records, pricing, or any DB write.
- ❌ Doesn't retry. Each archetype gets one Pass 1 + one Pass 2 call. We take the result.
- ❌ Doesn't measure correctness. There is no canonical operator scope.
- ❌ Doesn't grade the Pass 1 generator. It maps the gap between Pass 1 and Pass 2 perception.
- ❌ Doesn't decide policy. The probe outputs evidence; the next decision is human judgment.

---

## Why we keep this read-only and out-of-band

The temptation will be strong to say "Pass 2 looks great, let's wire it in." That temptation is
what we're deliberately resisting.

If we wire Pass 2 in before understanding it, we:
- Double LLM cost on every estimate, silently.
- Cement an architecture decision (two-pass) before knowing the failure modes.
- Lose the clean failure topology from run-1.

So: probe first, decide later. The charter for "wire it in" — if and when we go there — will be
a separate charter.

---

## Three success criteria for the probe

The probe is **successful** (regardless of the actual finding) if it produces:

1. A coverage delta matrix that lets us tell **prompt-problem from cognition-limit** per category.
2. At least one **hallucination flag** (Pass 2 added a module while marking the category not required) — proves the discipline check is working.
3. A **disagreement matrix**: where Pass 2 says "present_in_draft=true" but classifier says no, or vice versa. This calibrates how much we should trust the classifier vs the reviewer.

If we get all three signals, we have a sharp enough diagnostic to choose between system prompt
expansion, two-pass architecture, structured output schema, or HITL — on evidence, not intuition.

---

## Repro

```bash
cd /app
python3 scripts/scope-reviewer-probe.py
python3 scripts/scope-reviewer-probe.py --archetypes slack,linear
```

Artifacts:
- `/app/audit/scope-reviewer-corpus.json` — raw Pass 1 + Pass 2 per archetype + classifier output
- `/app/audit/SCOPE_REVIEWER_<date>.md` — auto-generated report
- `/app/audit/SCOPE_REVIEWER_FINDINGS_<date>.md` — frozen synthesis (manual)
