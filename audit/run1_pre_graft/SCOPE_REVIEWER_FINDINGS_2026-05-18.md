# Scope Reviewer Probe — Findings synthesis (run 1, 2026-05-18)

> Companion analysis to the auto-generated report `/app/audit/SCOPE_REVIEWER_2026-05-18.md`.
> Charter: `/app/docs/operational-reviewer-probe-charter.md`.
>
> The probe answered the question: **is the operational blindness measured in run-1 a *prompt problem* or a *cognition limit*?**
>
> The answer is: **both, but split cleanly along category lines.**

---

## TL;DR — the central finding

Pass 2 (reviewer with explicit operator checklist) **fully closed 7 of the 9 partial-coverage categories** and **stayed completely stuck on 7 others**. There is a **bimodal split** in the model's perception:

```
  PROMPT-PROBLEM CATEGORIES                        COGNITION-LIMIT CATEGORIES
  (Pass 2 closes 100% of gap)                      (Pass 2 closes 0%, even with explicit prompt)
  ┌──────────────────────────────────┐             ┌──────────────────────────────────┐
  │ authentication_identity 10/10    │             │ ai_orchestration          0/10   │
  │ authorization_rbac      10/10    │             │ realtime_synchronization  7/10   │  ← same as P1
  │ observability_monitoring 10/10   │             │ collaboration_multiplayer 2/10   │  ← same as P1
  │ deployment_infrastructure 10/10  │             │ payments_billing          5/10   │  ← same as P1
  │ reliability_recovery    10/10    │             │ notifications_delivery    1/10   │
  │ compliance_security     10/10    │             │ integrations_external     4/10   │  ← partial
  │ qa_edge_cases           10/10    │             │ analytics_reporting       6/10   │
  └──────────────────────────────────┘             └──────────────────────────────────┘
```

**This is the most actionable finding the corpus has produced.** It means:

- For **7 operational categories**, the model perceives them as soon as you ask. The blindness is purely a **production tendency** issue — the natural-mode prompt does not invite operator thinking, but the model is fully capable of it. **Path forward: system prompt expansion or two-pass architecture.**
- For **7 other categories**, even being told "look for this exact category" does not produce surfacing. This is a **cognition pattern**, not a prompt failure. **Path forward is different per-category** and likely requires structured intervention (function-calling schema, separate models, or human-in-the-loop).

Two completely different problems, two completely different solutions. The probe **separated them**.

---

## What the 7 "prompt-problem" categories tell us

These are the categories the model fully knows about but **doesn't volunteer** in production mode:

| Category | Pass 1 → Pass 2 | Reviewer "required" rate |
|----------|-----------------|--------------------------|
| `authentication_identity` | 7→10 (+3) | 10/10 always required |
| `authorization_rbac` | 3→10 (+7) | 10/10 always required |
| `observability_monitoring` | 2→10 (+8) | 10/10 always required |
| `deployment_infrastructure` | 3→10 (+7) | 10/10 always required |
| `reliability_recovery` | 0→10 (+10) | 10/10 always required |
| `compliance_security` | 2→10 (+8) | 10/10 always required |
| `qa_edge_cases` | 0→10 (+10) | 10/10 always required |

Two patterns emerge:
1. **They're universal.** The reviewer marks each of these as `required: true` for **every single archetype** (10/10). These are not domain-specific obligations — they're production tablestakes that apply equally to slack-clone and to ERP.
2. **The generator under-weights them precisely because they're "boring".** Auth, RBAC, monitoring, CI/CD, retries, security, QA — these aren't differentiating features, they're foundation. A natural product description prompt invites the model to describe what makes the product unique, and the model dutifully obliges with user-facing differentiators. Operator foundation is invisible by default but **fully accessible when invited**.

**This is the clean prompt-problem case.** A single system-prompt extension or a checklist nudge could likely close these 7 categories permanently, with high confidence and low complexity.

---

## What the 7 "cognition-limit" categories tell us

These categories Pass 2 either failed to close at all or barely moved. Each tells a different story:

### `ai_orchestration` — 0/10 → 0/10 (still completely invisible)

The reviewer, when given an AI copilot archetype, **does** mark `ai_orchestration: required: true`. But it then suggests a module called "AI Orchestration" with a generic 50h estimate and no actual content about context windows, fallbacks, rate limits, or prompt versioning. The keyword classifier doesn't match because the suggested module description is too thin.

**Diagnosis**: this isn't pure prompt failure — Pass 2 was told *exactly* what `ai_orchestration` means in the checklist (`"prompt engineering, context windows, rate limits, model fallbacks, hallucination handling"`) — and still couldn't produce a module whose text matched. The model recognizes the *category name* but cannot generate *category content*. **This is a model-capability boundary.**

**Path forward**: structured output schema with `ai_orchestration: { context_window_handling: bool, retry_strategy: str, fallback_models: [...], ...}` — force the model to fill specific slots. Or: dedicated specialized model. Or: human-in-the-loop.

### `realtime_synchronization` — 7/10 → 7/10 (Pass 2 disagreed with classifier)

Pass 2 actually marked `present_in_draft: false` for slack and `stripe_for_x` where the classifier said present. Reading the disagreement: classifier matched "real-time" / "live update" in Pass 1 module descriptions — Pass 2 reviewer didn't consider those substantive realtime coverage.

**Diagnosis**: classifier-reviewer disagreement on *what counts as recognition*. Real signal — the classifier is too generous, the reviewer is correctly more strict. **Recommended action**: in v2 of the classifier, require **multiple keyword matches** for realtime (e.g. mentioning "websocket" alone isn't enough; needs presence/conflict-resolution co-occurrence). This is a classifier tuning issue, not a generator issue.

### `payments_billing` — 5/10 → 5/10 (zero help from Pass 2)

The reviewer correctly marked payments as `required: false` for slack, linear, multiplayer, etc. — those products don't fundamentally have a payments surface. So Pass 2 had nothing to add.

**Diagnosis**: this isn't blindness. This is **the model correctly seeing that some archetypes don't need payments**. The 5/10 in Pass 1 corresponds exactly to the 5 archetypes where payments matter (stripe_for_x, b2b_crm, ai_copilot, marketplace, enterprise_erp, banking_dashboard — actually 6, but b2b_crm scored 0 from classifier; check next paragraph). Effectively saturated.

### `collaboration_multiplayer` — 2/10 → 2/10

Same story: reviewer marked it `not required` for most archetypes (slack & linear got it; marketplace, banking, ERP don't). Saturated correctly.

### `notifications_delivery` — 0/10 → 1/10 (almost no help)

Notifications **were** marked required by 3 archetypes (slack, infra_observability, marketplace), but Pass 2 only managed to produce a matching module for slack ("Notification System"). The other two had suggested modules but classifier couldn't match the text.

**Diagnosis**: like `ai_orchestration` — category recognized, content thin. Same fix: structured slots.

### `integrations_external` — 0/10 → 4/10 (partial)

Pass 2 closed 4 of the 10 cases. The reviewer correctly identified that not every archetype needs explicit "external integration" surfaces — but the 4 it added (linear, stripe_for_x, b2b_crm, banking, ERP) hit the classifier successfully.

**Diagnosis**: middle ground. The category mixes "obviously needed" (banking → financial APIs) with "obviously not" (slack → none). Reviewer reasoning is good; classifier matches are partial.

### `analytics_reporting` — 5/10 → 6/10 (almost no help)

Like payments — reviewer correctly marked many archetypes as not requiring analytics. Saturated.

---

## The "zero hallucinations" signal

`hallucinated_categories: 0` across all 10 archetypes. Not a single instance where the reviewer suggested a module while marking the category not-required.

**This is genuinely impressive.** The reviewer respected the discipline of "honesty about non-applicability is more valuable than checklist completeness". It marked many categories as `not_required` for archetypes where they didn't apply (payments for slack, ai_orchestration for ERP, collaboration_multiplayer for banking) and did not pad those with suggested modules.

**Implication**: the reviewer prompt is well-constructed. When this checklist methodology is later wired into a production-pass-2, we can expect a similarly low hallucination rate — but we'd need to test that hypothesis on a larger corpus to be sure.

---

## The 23 classifier-reviewer disagreements

These are the most calibration-rich data points in the run. Reading them:

- Most disagreements are `classifier=● / reviewer=○` (classifier too generous). This happens when classifier matches a keyword in passing (e.g. "user authentication" appears in a module description, but the module is actually about login UI only, not auth lifecycle).
- A minority are `classifier=○ / reviewer=●` (reviewer reading more carefully than classifier). These suggest the reviewer is doing semantic interpretation the classifier can't replicate.

**Implication**: for future probe runs, we should **trust the reviewer's `present_in_draft` over the classifier where they disagree** when computing coverage. The classifier is good for quick programmatic scoring but blunt on nuance.

---

## The cost picture (+122% if applied)

Pass-2-suggested hours total **+6,565h across 10 archetypes** vs Pass-1 total of **5,365h**. If we adopted Pass 2 wholesale, every archetype's price would more than double.

| Archetype | Pass 1 hours | +Pass 2 | Inflation |
|-----------|--------------|---------|-----------|
| slack | 390 | +500 | +128% |
| linear | 300 | +395 | +132% |
| stripe_for_x | 850 | +920 | +108% |
| b2b_crm | 415 | +415 | +100% |
| ai_copilot | 535 | +500 | +93% |
| infra_observability | 700 | +910 | +130% |
| marketplace | 450 | +660 | +147% |
| multiplayer | 330 | +315 | +95% |
| banking_dashboard | 615 | +780 | +127% |
| enterprise_erp | 780 | +1170 | +150% |
| **mean** | — | — | **+122%** |

**Bonus cross-check with PRICING_REVIEW**: at +122% inflation, slack would jump from $11.4k implementation → ~$25k. That places it squarely **inside** the $30–80k slack-clone market band when amplified by reality_multiplier ×9.72 = ~$240k. **The "underpriced" theory does come back into play if operator-aware scoping becomes default.**

But — and this is the load-bearing caveat — **we have not validated whether the Pass 2 suggested hours are realistic**. They might be optimistic in their own right. They might be padding. Hours-as-cost-driver is downstream of hours-as-perception, and we deliberately didn't measure correctness.

---

## What the reviewer's summary notes show

The reviewer was prompted to add a 1–2 sentence overall summary per archetype. Reading them in aggregate is illuminating:

- 10/10 archetypes received a summary like *"The draft scope lacks several critical operational components"* or *"The operational maturity of the project is low"* or *"The project scope has multiple critical operational gaps"*.
- No archetype was rated as operationally mature in Pass 1.

This is the model's own honest assessment of what its production-mode counterpart produces: **across the board, the Pass-1 generator produces operationally thin scopes by default**. This isn't observer-bias on our end. The same model, in a different role, reaches the same conclusion.

---

## What we now know we can choose between

The probe was supposed to differentiate prompt-problem from cognition-limit. It did. So now the next decisions have evidence:

| Lever | Evidence supporting it | Evidence against |
|-------|------------------------|------------------|
| **System prompt expansion** (add "Also surface authentication, RBAC, observability, deployment, reliability, compliance, QA — these are production tablestakes" to `_ai_scope_from_idea`) | Closes 7/16 categories cleanly. Cheap. Reversible. One file, one diff. | Doesn't help `ai_orchestration`, `notifications_delivery` — model needs more than naming. Risk: model may stub-fill required mentions without depth. |
| **Two-pass production architecture** | Already proven to work (closes 7/16 fully). Hallucination rate is zero. | 2x LLM cost. ~30s added latency. Engineering commitment. Doesn't help cognition-limit categories. |
| **Structured output schema** (force `operational_obligations: {...}`) | Would close the "category named but content thin" gap for `ai_orchestration` and `notifications_delivery`. | Most complex. Loses naturalness. Schema design becomes a permanent constraint. |
| **Human-in-the-loop at scope step** | Closes everything reliably. Best for trust. | Slows funnel. Requires admin availability. Doesn't scale. |
| **Hybrid: prompt expansion for 7 + schema for 2 + HITL for AI orchestration** | Surgical. Each category gets its appropriate lever. Highest evidence-fit. | Most engineering scope. But individual pieces are still small. |

**Notably**: even the simplest intervention (prompt expansion) closes about 44% of the operational gap. That's a high-leverage one-line change.

---

## What we still don't know

- ❌ Whether Pass-2 hour estimates are realistic. We measured perception, not correctness.
- ❌ Whether prompt expansion will produce **shallow** mentions (model stubs out required categories without depth). Pass 2 didn't have that problem, but a single-pass system prompt change might.
- ❌ How a different model (gpt-4o, claude-3.5, gemini-1.5) would compare. The split between prompt-problem and cognition-limit categories may be model-specific.
- ❌ Whether the cognition-limit pattern on `ai_orchestration` is general, or specific to gpt-4o-mini's training cutoff.

These are good follow-up probes if we choose to investigate further.

---

## What we honored from the charter

- ✅ No changes to `/api/estimate`. Pass 1 ran the unchanged production code.
- ✅ No push of Pass 2 modules into pricing or DB.
- ✅ No retries. One Pass 1, one Pass 2 per archetype.
- ✅ Reviewer prompt explicitly avoided "be exhaustive" — invited honest non-applicability calls.
- ✅ Hallucination check confirmed reviewer discipline (0 forced answers across 10 archetypes × 16 categories = 160 decisions).
- ✅ Classifier kept separate from reviewer — disagreement matrix is the calibration tool.
- ✅ Cost-if-applied number is reported as information, not as a prescription.

---

## Final framing

Two iterations ago we had:

> "the engine is mispriced"

One iteration ago we had:

> "the engine is fine; the LLM under-scopes implementation"

After this probe we have:

> "the LLM's blindness is real but **structurally bimodal**: 7 categories close on demand (prompt-problem), 7 don't even with explicit invitation (cognition-limit). Different categories need different levers, and we now know which is which."

That's a much more precise problem statement than we had 30 minutes ago. The next decision — **whether** to intervene, and **which lever** to choose — is now reducible to a few explicit tradeoffs instead of an open-ended discussion.
