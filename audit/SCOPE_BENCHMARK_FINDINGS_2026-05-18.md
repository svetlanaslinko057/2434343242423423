# Scope Benchmark — Findings synthesis (run 1, 2026-05-18)

> Companion analysis to the auto-generated report `/app/audit/SCOPE_BENCHMARK_2026-05-18.md`.
> Charter: `/app/docs/scope-benchmark-charter.md`.
>
> **The benchmark evaluates perception, not correctness.** This document interprets the first run's
> output and translates it into a *map of operational blindness*.

---

## Run context

- **Endpoint**: `POST /api/estimate` (mode `hybrid`, `infer_axes=true`)
- **Archetypes**: 10 canonical product types (Slack/Linear/Stripe-for-X/B2B CRM/AI copilot/Infra observability/Marketplace/Multiplayer/Banking dashboard/Enterprise ERP)
- **Categories**: 16 operational obligations
- **Classifier**: deterministic keyword matcher (no LLM-as-judge)
- **LLM**: GPT-4o-mini via EMERGENT_LLM_KEY (provider=emergent, source=env)
- **AI generation success**: 10/10 (`ai_generated=True`)

---

## TL;DR — the map of operational blindness

```
            BLIND (0/10 recognized)                  PARTIAL (1–5)                       SEEN (6–8)
  ┌────────────────────────────────────┐  ┌────────────────────────────┐  ┌──────────────────────────────┐
  │ ai_orchestration         0/10  ▮▮▮  │  │ data_persistence       1/10 │  │ admin_operations       6/10  │
  │ integrations_external    0/10  ▮▮▮  │  │ compliance_security    1/10 │  │ realtime_synchronization 6/10│
  │ reliability_recovery     0/10  ▮▮▮  │  │ collaboration_multipl. 1/10 │  │ authentication_identity 8/10 │
  │ notifications_delivery   0/10  ▮▮▮  │  │ deployment_infra       3/10 │  │ analytics_reporting    8/10  │
  │ qa_edge_cases            0/10  ▮▮▮  │  │ authorization_rbac     3/10 │  │                              │
  │                                     │  │ payments_billing       3/10 │  │                              │
  │                                     │  │ observability_monit    4/10 │  │                              │
  └────────────────────────────────────┘  └────────────────────────────┘  └──────────────────────────────┘
```

5 of 16 categories are **completely invisible** to the LLM scope generator across the entire corpus. This is the strongest finding.

---

## Five categories of total blindness

| Category                       | What it means in practice                                                                                              |
|--------------------------------|-----------------------------------------------------------------------------------------------------------------------|
| `ai_orchestration`            | LLM has NO module for prompt engineering / context window / model fallback / rate limits — even in the **AI copilot** archetype (the one product where this *is* the product). The model writes "AI assistant integration" but doesn't surface that the integration *is* the entire engineering surface. |
| `integrations_external`       | Webhook handling, third-party API retry, vendor failure modes — invisible. Stripe-for-X archetype names "chargebacks" but doesn't decompose webhook reliability. Marketplace archetype names "payments held in escrow" but doesn't model webhook→ledger reconciliation. |
| `reliability_recovery`        | Idempotency, retries, backups, failure states — zero. Banking dashboard (regulated, money flow) does not surface retry semantics. Infra observability (the *literal* reliability product) does not surface its own reliability. |
| `notifications_delivery`      | Email/push/in-app delivery — completely missing. Slack & Linear (chat & issue tracker — products that *are* notification pipelines) don't surface notification delivery as a module. |
| `qa_edge_cases`               | Validation, race conditions, error handling, test coverage — zero across all 10 archetypes. The model treats QA as already-done. |

These five blind spots are **exactly the operational surfaces that scale failure**:
- AI copilot without orchestration → unbounded LLM cost / hallucination / latency
- Payments without webhook reliability → silent revenue loss
- Money flow without idempotency → double-charge / lost transactions
- Notification systems without delivery guarantees → user trust collapse
- QA-as-already-done → production firefighting

They're also exactly the surfaces that **add real hours to projects**. The LLM systematically under-scopes by omitting them.

---

## The two extreme asymmetric archetypes (ratio = 3.00)

**Marketplace** and **Realtime multiplayer** both hit asymmetry ratio = 3.00 — the highest in the corpus.

| Archetype | User-side recognized | Operator-side recognized |
|-----------|---------------------|--------------------------|
| `marketplace` | 3/7 (43%) | 2/14 (14%) |
| `multiplayer` | 3/7 (43%) | 2/14 (14%) |

These are both **inherently operator-heavy products**:
- Marketplace: dispute resolution, payout reconciliation, fraud detection, vendor onboarding — all operator surfaces.
- Multiplayer: conflict resolution, presence accuracy, server scaling, abuse moderation — all operator surfaces.

The LLM produces modules for "buyer dashboards" and "live cursors" (user-facing) but doesn't surface the operator complexity that actually *runs* the marketplace or the realtime infrastructure.

This is the literal "builder, not operator" pattern.

---

## The two **inverted** archetypes (asymmetry < 1.0)

**AI copilot** and **infra observability** both came back with ratio 0.80 — operator-side coverage was *higher* than user-side.

This isn't because the LLM suddenly developed operational consciousness. It's because **the user-facing surface in these products is thin** (one chat window, one dashboard) while the operator-facing surface is the entire product. Even partial operator coverage (5/14) beats partial user coverage (2/7) in ratio terms.

But absolute coverage is still poor: 5/14 = 36% of operator categories. The model still missed AI orchestration even when AI orchestration **was the product**.

---

## False simplicity — the early signal

Only **one** flag fired in this run: `enterprise_erp` → `authorization_rbac` matched `"basic hr module … access control"`.

This is the *complexity collapse* signal the charter predicted: ERP's RBAC is the hardest part of the product (Fortune 500 audits, segregation-of-duties, sub-tenant scoping), and the model framed adjacent context with "basic". One flag is a small sample, but it lands exactly where the user predicted: in a domain where "simple" is structurally wrong.

Future iterations of the classifier should expand `FALSE_SIMPLICITY_TRIGGERS` to catch more cases — likely candidates: "standard", "typical", "out of the box", "off the shelf", "simple integration".

---

## What the implementation prices reveal (cross-check with PRICING_REVIEW)

From PRICING_REVIEW 2026-05-18: predicted that at "$5–8k base implementation price" the engine would land most archetypes inside the consultancy market band. This run shows live `/api/estimate` produces:

| Archetype             | Implementation price (live) | Within $5–8k? | Band check (final price) |
|-----------------------|------------------------------|----------------|---------------------------|
| slack                 | $11,430                      | ❌ over        | $111k — top of $30–80k market band, slightly over |
| linear                | $11,113                      | ❌ over        | $108k — top of $25–60k, over |
| stripe_for_x          | $32,344                      | ❌ way over    | $314k — inside $80–200k or above |
| b2b_crm               | $13,648                      | ❌ over        | $85k — at top of $40–100k |
| ai_copilot            | $33,294                      | ❌ way over    | $252k — over $30–80k band |
| infra_observability   | $23,788                      | ❌ way over    | $197k — at top of $100–300k |
| marketplace           | $13,014                      | ❌ over        | $98k — at top of $50–150k |
| multiplayer           | $12,381                      | ❌ over        | $120k — at top of $50–150k |
| banking_dashboard     | $16,183                      | ❌ over        | $157k — top of $80–200k |
| enterprise_erp        | $24,739                      | ❌ way over    | $134k — under $200k+ band |

**Plot twist.** PRICING_REVIEW (synthetic) said base $5k–$8k was the sweet spot. Live `/api/estimate` produces base $11k–$33k — **2x to 4x higher** than the synthetic sweep predicted. Implementation prices are tracking the upper end of LLM hour estimates, and the Reality Layer amplification is pushing final prices to top-of-band or above.

This means:
1. **The "base implementation price too low" theory from PRICING_REVIEW does not hold against live data.** Live LLM is in a different regime than the synthetic stabilization sweep used.
2. **The implementation layer is paradoxically optimistic about hours** (5/16 blind categories not factored in) **but also generates large hour totals** (300–1000h per archetype). The model is verbose in module surface area while still missing whole categories — it over-extends what it perceives instead of widening what it perceives.
3. **Final prices are already on or above consultancy band.** The "under-pricing" diagnosis from synthetic sweep doesn't reproduce — engine ships at-band or over-band live.

This is the bigger surprise of this run. The synthetic and live regimes differ enough that PRICING_REVIEW's conclusion needs revisiting.

---

## What this run does NOT tell us

- ❌ Whether the missing categories *should* be there. Some archetypes legitimately don't need every category (e.g. Linear arguably doesn't need `payments_billing`). The benchmark just maps what's mentioned — interpretation is human judgment.
- ❌ Whether the LLM *could* produce the missing categories with a different prompt. We deliberately did not retry. The signal is "the natural production tendency", not "the model's ceiling".
- ❌ Whether hour estimates are *correct*. We only checked operational category presence.
- ❌ Whether the keyword classifier missed real mentions. Likely some false negatives exist (e.g. a module called "Reliability layer" might not match `reliability_recovery` keywords). v1 errs toward false negatives by design.

---

## What this run DOES enable (next-step menu, not a plan)

If you want to act on this — and we shouldn't act yet, just lay out the option space:

| Lever                                             | Pros                                                  | Cons                                                            |
|---------------------------------------------------|-------------------------------------------------------|-----------------------------------------------------------------|
| **System prompt expansion** (add operational-obligations checklist to `_ai_scope_from_idea`) | One-shot fix, low risk to revert | LLM may surface modules cosmetically without depth (corpus runner can re-measure but can't tell quality) |
| **Two-pass call** (first pass: user-facing scope; second pass: operational obligations review) | Cleaner separation of cognition modes | 2x cost, 2x latency per estimate |
| **Structured output schema** (force JSON shape with `operational_obligations[]`) | Tightest control | Loses naturalness; LLM may stub-fill required fields |
| **Human-in-the-loop checkpoint** (admin sees scope, can add operator modules before commit) | Trust + transparency | Slows down funnel; requires admin availability |
| **Re-architect: scope generator → reviewer** (LLM-1 generates, LLM-2 audits against fixed obligation list) | Closest to charter discipline (perception measurement + perception coaching) | Most complex; tied to corpus health |

All of these are downstream decisions. The benchmark is the **diagnostic substrate**. Re-run it after any intervention to measure perception delta.

---

## Re-run hygiene

The benchmark is reproducible: `python3 /app/scripts/scope-benchmark-corpus.py`. Each run overwrites:
- `/app/audit/scope-benchmark-corpus.json` (raw)
- `/app/audit/SCOPE_BENCHMARK_<date>.md` (auto-generated report)

This synthesis document is **not** overwritten — it's analysis frozen at run-1.

Future runs should produce a new synthesis document (`SCOPE_BENCHMARK_FINDINGS_<date>.md`) so we can compare perception drift over time (especially after any prompt/structure intervention).

---

## Final note — what we honored

We did exactly what the charter said:
- ✅ Read-only, no engine mutation
- ✅ No retries, no prompt mutation, no auto-fix
- ✅ Deterministic classifier (no LLM-as-judge)
- ✅ Perception not correctness
- ✅ One run, take the result as-is

And we got what was promised: a map of operational blindness with three layered signals (coverage, false simplicity, asymmetry) that points clearly at next-question territory — not a fix, but a sharp enough diagnostic that the next decision (whether to intervene and how) can be made on evidence.
