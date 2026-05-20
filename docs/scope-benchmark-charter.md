# Scope Benchmark Charter — operational cognition benchmarking

> Created: 2026-05-18 (Iteration 4 pre-flight)
>
> Companion to: `pricing-reality-layer-iteration-3-charter.md` (governance of multipliers) and
> `PRICING_REVIEW_2026-05-18.md` (Reality Layer elasticity validation).

---

## What this benchmark IS

**A diagnostic instrument that measures how the LLM scope generator perceives operational reality.**

For each canonical archetype, we feed `/api/estimate` a natural-language brief, capture the produced
scope (`modules_detailed`, `tech_stack`, `reality_layer`, `implementation_price`), and score the response
against a checklist of **operational obligations** — not features.

The output is a **map of operational blindness**: which classes of responsibility the model
naturally surfaces, which it systematically misses, which it acknowledges-but-trivializes
("false simplicity"), and where it shows **operational asymmetry** (rich user-facing scope,
absent operator-facing scope).

---

## What this benchmark is NOT

- ❌ Not a "correctness check". There is no canonical scope. There is no ground-truth hours estimate.
- ❌ Not an LLM-as-judge (no second LLM rates the first). Classifier is **deterministic and inspectable**.
- ❌ Not a retry-until-good loop. We do **one** call per archetype, take it as-is.
- ❌ Not a prompt-tuning tool. The system message in `_ai_scope_from_idea` is **not touched**.
- ❌ Not an evaluation of pricing math. Reality Layer was already validated in `PRICING_REVIEW_2026-05-18`.
- ❌ Not a hours estimator. We capture hours when LLM emits them but do not compare to any "expected" value.

---

## Why "operational obligations" not "features"

> *features are implementation artifacts*
> *operations are cost drivers*

A feature checklist ("does the brief produce a Stripe module?") rewards the model for naming things.
An obligations checklist asks whether the model recognized that **a class of responsibility exists**
for this product — payments lifecycle, audit trails, recovery semantics, admin surfaces, observability.

This is what makes the brief production-real instead of demo-real.

---

## The 16 operational obligation categories (v1)

| Category                       | What it covers                                                                   | Audience  |
|--------------------------------|----------------------------------------------------------------------------------|-----------|
| `authentication_identity`      | login, session, account recovery, social auth, password policy                   | both      |
| `authorization_rbac`           | roles, permissions, admin boundaries, scoped access                              | both      |
| `data_persistence`             | state consistency, storage, migrations, schema evolution                          | operator  |
| `admin_operations`             | backoffice, manual intervention, moderation tooling                              | operator  |
| `observability_monitoring`     | logs, metrics, error tracking, alerting, auditability                            | operator  |
| `deployment_infrastructure`    | environments, CI/CD, hosting, scaling, infrastructure-as-code                    | operator  |
| `payments_billing`             | subscriptions, invoices, refunds, webhooks, dunning                              | both      |
| `realtime_synchronization`     | websocket, presence, live state, conflict resolution                              | user      |
| `integrations_external`        | third-party APIs, webhook handling, retry policies, vendor failures               | operator  |
| `ai_orchestration`             | prompt engineering, context windows, rate limits, model fallbacks                | operator  |
| `reliability_recovery`         | retries, idempotency, backups, failure states, circuit breakers                  | operator  |
| `compliance_security`          | privacy, GDPR/HIPAA/etc., audit trails, encryption, access logs                  | operator  |
| `collaboration_multiplayer`    | shared editing, comments, concurrency control, optimistic locking                | user      |
| `notifications_delivery`       | email, push, in-app, delivery guarantees, opt-out                                | both      |
| `analytics_reporting`          | dashboards, exports, business metrics, BI integrations                            | both      |
| `qa_edge_cases`                | validation, race conditions, error handling, malformed input                      | operator  |

**Audience field** drives the **operational asymmetry detector** (Section 4 below).

---

## How the deterministic classifier works

For each archetype response, we collect text from:
- `modules_detailed[*].title`
- `modules_detailed[*].description`
- `tech_stack[]`
- `reality_layer.narrative_chips`

For each category, a curated keyword/phrase set is matched against this concatenated text (case-insensitive,
word-boundary aware). A category is **recognized** iff at least one keyword from its set is matched.

Keywords are tuned to be **conservative** — generic phrases like "user management" do **not** count for
`authorization_rbac`; we require role/permission/admin-boundary language. This deliberately undercounts
rather than overcounts to make missing categories meaningful.

---

## The three detector layers

### 1. Coverage matrix (primary)

Per archetype × category → `present | absent`. Aggregate across corpus: **recognition rate per category**.
This is the headline finding: which categories does the LLM see at archetype scale?

### 2. False simplicity detector (per user request #6)

When a category **is** recognized, we check the matched phrase context for trivializing modifiers:
`simple`, `basic`, `minimal`, `lightweight`, `straightforward`, `easy`, `quick`, `just`.

A category flagged as **"false simplicity"** means: the model named the responsibility but framed it as
trivial. For domains where it isn't (escrow payments, multi-tenant auth, realtime sync), this is a
**complexity collapse** signal — more dangerous than outright missing because it pretends to be handled.

### 3. Operational asymmetry detector (per user request #7)

Two scores per archetype:
- `user_side_coverage` = recognized count over categories with audience ∈ {user, both}
- `operator_side_coverage` = recognized count over categories with audience ∈ {operator, both}

**Asymmetry ratio** = `user_side_coverage / max(operator_side_coverage, 0.01)`.

Ratios > 1.5 indicate user-facing richness with operator blindness — a classic "builder, not operator"
cognition pattern. Ratios < 0.7 indicate operator over-weight (rare; would still be worth surfacing).

---

## What we do NOT measure (deliberately)

- ❌ `expected_hours`. Hours are downstream. First we need to know if the model perceived the responsibility class.
- ❌ Architectural correctness. We don't check "should this be microservices vs monolith".
- ❌ Tech stack appropriateness. The model can pick React or Vue — both work. We only check whether
  e.g. observability/deployment surfaces are mentioned at all.
- ❌ Narrative quality (subjective). We capture `reality_layer.narrative_chips` verbatim but don't score them.
- ❌ Pricing accuracy. Already validated in `PRICING_REVIEW_2026-05-18.md`.

---

## Why no `--baseline=5000 / 8000` sweep in v1

The PRICING_REVIEW corpus was a **synthetic engine elasticity test**: it fed `apply_reality_layer(base, axes)`
three different `base` values to map how multipliers amplified across the spectrum.

On the live `/api/estimate` endpoint, `base_hourly_rate` is the only configurable knob between "LLM output"
and "blended_price". It enters as `ai_hours × base_hourly × mode_mult` — i.e. it's a **linear scaler on
downstream pricing math, with zero influence on what the LLM emits**. The LLM never sees the rate.

So sweeping rate to measure **scope perception** would produce identical coverage matrices at different
rate levels — no information gain. The PRICING_REVIEW already covered the orthogonal axis (engine
elasticity to base price); this benchmark covers scope perception at fixed config.

**If a future iteration wants rate sweep for cross-validation** (e.g. checking that confidence doesn't
correlate with rate), we'll add `--rate-sweep` as an optional flag with admin auth + restore-after.
Not in v1.

---

## What "good output" of the benchmark looks like

The benchmark is **successful** if it produces a coverage matrix where:
- At least one category is recognized **<50%** across the 10 archetypes → we have a teachable signal.
- At least one archetype shows asymmetry > 2.0 → there's a clear "builder-not-operator" case.
- At least one false-simplicity flag fires → there's a complexity-collapse case.

If all three signals appear, we have what was promised: a **map of operational blindness**, not a
verdict. The map then informs the **next** decision: where to invest (system prompt refinement,
structured output schema, separate operational-pass call, human-in-the-loop checkpoint).

If **none** of those signals appear — the LLM already perceives operational complexity well at archetype
scale, and the cognition ceiling is elsewhere (probably edge briefs or weird domain mixes).

Either outcome is information. Neither outcome is a fix.

---

## Repro

```bash
cd /app
python3 scripts/scope-benchmark-corpus.py            # default: full corpus, current config
python3 scripts/scope-benchmark-corpus.py --archetypes slack,linear  # subset
python3 scripts/scope-benchmark-corpus.py --json-only  # skip markdown render
```

Artifacts:
- `/app/audit/scope-benchmark-corpus.json` — raw per-archetype responses + classifier output
- `/app/audit/SCOPE_BENCHMARK_2026-05-18.md` — human-readable report

---

## The framing rule

> **The benchmark evaluates perception, not correctness.**

This is the load-bearing constraint of the whole exercise. The moment we start grading the LLM
against an "ideal" scope, we've created an oracle that doesn't exist and stopped learning what the
model naturally does.
