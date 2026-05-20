# ATLAS DevOS — Substrate Contract

**Frozen operational law. Not narrative. Not aesthetic framework.**

This document encodes invariants that govern operational substrate — contracts,
lifecycles, endpoint authority, mutation discipline, state provenance.

Anything visual, atmospheric, or perception-layer is **explicitly out of scope**.
`PERCEPTION_TONE ∉ SUBSTRATE_CONTRACT`. See §0.

---

## 0. Scope & non-scope

| In scope (operational substrate) | Out of scope (separate doctrines) |
|---|---|
| Endpoint contracts, families, sunset paths | Visual tokens, palette, chroma hierarchy |
| Lifecycle semantics (enums, transitions) | Atmosphere / theming DSL |
| Mutation discipline (POST → refresh) | Landing / marketing / art-direction |
| State provenance (server truth vs. derivation) | Typography rhythm, spacing tokens |
| Backend additive discipline | Animation / motion vocabulary |
| Cross-surface (web ↔ mobile) parity rules | Iconography, glow, shadow tiers |
| Boundary-layer integration discipline | Copy tone, microcopy |

Doctrine documents for the out-of-scope layers, when created, MUST NOT inherit
from this file. Operational rules and perception rules live separately by design.

---

## 1. Invariants (frozen)

### I-01 — UI renders JSON

UI **MUST NOT**:
- aggregate (no `.reduce` for totals, counts, sums in page scope)
- synthesize lifecycle (no client-built timelines, no manual event append)
- compute business truth (no derivations of status, eligibility, priority)
- authorize actions (no `if (role === ...)` gates that the backend already evaluated)

UI **renders only what the server returned**.
If a field is missing → not "compute it on the client" but "the backend must
return it" (subject to I-06).

---

### I-02 — No convenience state

The following symbols (or any close variant) are **forbidden** in
`web/src/pages/` and `frontend/app/`:

- `computedOverview`
- `changeSummary` (when client-synthesized)
- `syntheticTimeline`
- `derivedDisplayState`
- `localMergedState`
- Any state-holder whose name matches `*Synthetic*`, `*Computed*`, `*Merged*`,
  `*Local*` and holds server-shaped data.

If the value is needed → backend owns the field, or the value is **bounded
carve-out** documented in `PHASE1_SUBSTRATE_CLOSEOUT.md`.

Convenience state is the primary mechanism by which UI silently becomes a
partial business runtime. This invariant exists to prevent that.

---

### I-03 — Canonical endpoint family

For each concept, **exactly one** endpoint family is canonical. All others are
compat-only. The full registry lives in `ENDPOINT_FAMILY_REGISTRY.md`.

Rules:
- No new consumer may be wired to a non-canonical family.
- Migration of existing consumers happens **per slice**, not big-bang.
- Family demotion (canonical → compat-only → sunset-candidate → deprecated)
  follows the promotion/demotion process defined in the registry.

Current high-priority resolution (slice #1):

| Concept | Canonical | Legacy (compat-only, no new consumers) |
|---|---|---|
| Deliverables | `/api/client/deliverables/*` | `/api/deliverables/*` (sunset-candidate) |

---

### I-04 — Forbidden frontend grammar

Distinguish **render iteration** from **business derivation**:

| Allowed in page scope | Forbidden in page scope |
|---|---|
| `.map(item => <Card .../>)` (rendering) | `.filter(x => x.status === ...)` (hiding rows) |
| `fmtMoney(n)`, `labelForType(t)` (cosmetics) | `.reduce(...)` (totals, counts) |
| Structural conditionals on backend-provided flags | `.sort(...)` (re-ordering) |
| Form-controlled-input local state | `useMemo(() => computeX(...))` (derivation cache) |
| Modal open/close booleans, input drafts | `Math.max` / `Math.min` (heuristics) |

**Grep contract** (each non-zero count outside documented exceptions = violation):

```bash
# Business derivation in page scope
grep -RE "\.reduce\("   /app/web/src/pages /app/frontend/app
grep -RE "\.filter\("   /app/web/src/pages /app/frontend/app
grep -RE "\.sort\("     /app/web/src/pages /app/frontend/app
grep -RE "useMemo\(\s*\(\)"  /app/web/src/pages /app/frontend/app
grep -RE "Math\.(max|min)\(" /app/web/src/pages /app/frontend/app
```

Documented exceptions are listed in `PHASE1_SUBSTRATE_CLOSEOUT.md → carve-outs`.

---

### I-05 — POST semantics

After every mutating call (POST / PUT / PATCH / DELETE):

- MUST refetch authoritative GETs (`triggerRefresh()` / `loadAll()`)
- MUST NOT mutate cached response shape locally
- MUST NOT append synthetic timeline events
- MUST NOT override status locally
- MUST NOT merge optimistic delta into displayed state

**Server response replaces state. Period.**

Forbidden patterns:
```js
setX(prev => ({ ...prev, status: 'approved' }))   // optimistic — forbidden
setItems([...items, syntheticEntry])              // local append — forbidden
setState({ ...response.data, computedExtra: ... })  // post-merge — forbidden
```

Required pattern:
```js
await axios.post(`/api/client/deliverables/${id}/approve`)
triggerRefresh()   // re-runs the page's independent GETs
```

---

### I-06 — Backend additive discipline

Additive fields are allowed **only as documented responses to proven substrate
gaps**.

| Promotion criterion | Rule |
|---|---|
| Proven | ≥2 independent surfaces require the same shape, OR an explicit business contract change |
| Documented | Entry exists in `PHASE1_SUBSTRATE_CLOSEOUT.md → backend gaps` BEFORE the backend handler is touched |
| Additive | New field added; existing fields' shape and semantics unchanged |
| Mid-pass shape refactor | **Forbidden** |

Not allowed:
- Introducing `change_summary` because **one** page needs it cosmetically.
- Introducing `can_approve` flag because **one** button used `status === 'pending'`.
- Inline shape refactors of existing responses inside a slice.

If a candidate field has only one consumer, it stays in **non-goals** until a
second surface independently requires it. See `PHASE1_SUBSTRATE_CLOSEOUT.md`.

---

### I-07 — L1 > L2 (assignment authority)

Pre-existing invariant from `backend/CONTRACTS.md`. Restated here for
substrate completeness:

- `users.source ∈ {core, external}`, default `external`
- `modules.assignment_mode ∈ {manual, auto}`, default `auto`
- System agents (`auto_guardian`, `operator_engine`) MUST skip
  `assignment_mode == manual` modules — no auto_pause, no auto_rebalance,
  no auto_reassign, no system-driven status flip on those modules.
- The assignment-mode flip endpoint is admin-only and emits
  `type: "admin_assignment_mode_change"` into `auto_actions`.

---

### I-08 — Vendor isolation (boundary layer)

Business logic MUST NOT type vendor names. Only contract fields cross the
boundary:

| Allowed in business logic | Forbidden in business logic |
|---|---|
| `payment_url`, `provider`, `provider_ref`, `mode` | `stripe_session_id`, `wfp_order_ref` |
| `MailMessage`, `AvailabilityMode` | `resend_message_id`, `cloudinary_public_id` |
| `CheckoutRequest`, capability `.health()` | direct `stripe.Checkout.Session.create(...)` |

Vendor blobs live in `*_raw` debug-only fields. Live adapters
(`integrations/live_adapters.py`) are the only place where vendor types appear.

---

### I-09 — Independent GET composition

One page → N independent `axios.get` → N independent `setState`.

```js
// CORRECT — each response is a standalone truth
useEffect(() => {
  Promise.all([
    axios.get('/api/admin/production'),
    axios.get('/api/admin/risk'),
    axios.get('/api/admin/actions'),
  ]).then(([p, r, a]) => {
    setProduction(p.data);
    setRisk(r.data);
    setActions(a.data);
  });
}, [bump]);

// WRONG — fabricating a fourth "truth" with no owner
const merged = { ...production, ...risk, counts: computeCounts(actions) };
```

Pages compose visual layout. They do not compose data.

---

### I-10 — Loading / Error / Empty separated structurally

Even before Phase 2 unified primitives, every surface MUST render three
**syntactically distinct** branches:

| State | Required form |
|---|---|
| Loading | Explicit render branch (not absence of data) |
| Error | Explicit render branch with surfaced cause (not `console.error + alert`) |
| Empty | Explicit render branch (not silent falsy ternary) |

Phase 2 will extract these into scale-based primitives (`PageLoading`,
`InlineLoading`, etc.). The extraction is mechanical only if the structural
separation already exists.

---

## 2. Forbidden grammar — grep contract

Reference command set. Each match outside documented exceptions is a
violation. Run before any slice merge.

```bash
# === Business derivation in page scope ===
grep -RnE "\.reduce\("       /app/web/src/pages /app/frontend/app
grep -RnE "\.filter\("       /app/web/src/pages /app/frontend/app
grep -RnE "\.sort\("         /app/web/src/pages /app/frontend/app
grep -RnE "useMemo\(\s*\(\)" /app/web/src/pages /app/frontend/app
grep -RnE "Math\.(max|min)\(" /app/web/src/pages /app/frontend/app

# === Optimistic mutation ===
grep -RnE "set[A-Z]\w+\(prev => \(\{ \.\.\.prev," /app/web/src/pages /app/frontend/app
grep -RnE "setState.*\.\.\.prev.*status"          /app/web/src/pages /app/frontend/app

# === Convenience state symbols ===
grep -RnE "(computedOverview|changeSummary|syntheticTimeline|derivedDisplayState|localMergedState)" \
     /app/web/src/pages /app/frontend/app

# === Legacy endpoint leakage (per registry) ===
grep -RnE "/api/deliverables/[^c]" /app/web/src /app/frontend
# canonical is /api/client/deliverables/...
```

Documented exceptions live in `PHASE1_SUBSTRATE_CLOSEOUT.md`.

---

## 3. Semantic ladder — canonical enums

### Deliverable lifecycle

```
draft → pending_approval → approved | rejected
```

| Legacy value | UI mapping | Write status |
|---|---|---|
| `pending` | render as `pending_approval` | no new writes |
| `revision_requested` | render as `rejected` | no new writes |

### Module lifecycle

```
available → reserved → in_progress → review → done | failed
```

QA sub-states: `pending | passed | revision | failed` (separate field
`qa_status`, not status enum extension).

### Invoice lifecycle

```
draft → pending_payment → paid | failed | cancelled
```

### System mode

```
manual | assisted | auto
```

With `CRITICAL_ACTIONS` bypass: even in `auto`, actions in the critical set
require manual confirmation.

---

## 4. Accepted bounded debt

Items frozen with no new propagation. Each has a defined sunset trigger.

| # | Item | Scope | Sunset trigger |
|---|---|---|---|
| BD-01 | `/api/deliverables/*` endpoint family | compat-only | last consumer migrates to `/api/client/deliverables/*` |
| BD-02 | `revision_requested` enum value | read-side mapping to `rejected` | last writer migrated |
| BD-03 | `pending` enum value on deliverables | read-side mapping to `pending_approval` | last writer migrated |
| BD-04 | `useMemo` filter at `app/client/projects/[id].tsx:182` | until ClientCabinet slice | resolved in slice #3 |
| BD-05 | ESLint TS rules not loading in web build (`DISABLE_ESLINT_PLUGIN=true` in build) | dev-only | Phase 2/3 config fix |
| BD-09 | `web/.env` was not committed in the repo — caused `REACT_APP_BACKEND_URL=undefined` deployed artefact until 2026-05-12 | infrastructure | resolved 2026-05-12 (file created, build pipeline now produces functional bundle) |
| BD-06 | `chat.tsx` inline approve/reject quick-actions | parallel surface concept | re-evaluate after Phase 1 |
| BD-07 | `web/src/pages/ClientDeliverable.js` (singular, 323 lines) — duplicate legacy deliverable surface using `/api/deliverables/*` | ~~locked, owned by slice #1~~ **SUNSET** (file deleted, App.js import removed, 2026-05-12 during slice #1) | — |
| BD-08 | `web/src/pages/ClientProjectPage.js` mixed-family: legacy approve/reject (lines 465, 505) + canonical pay (line 481) | locked, owned by slice #3 (ClientCabinet) | resolved when project-page deliverable actions move to canonical family |

Bounded debt is **not failure** — it is acknowledged, scoped, and tracked.
Failure is **unbounded** debt.

---

## 5. Non-goals — do NOT introduce yet

Each requires evidence of ≥2 independent surfaces + entry in
`PHASE1_SUBSTRATE_CLOSEOUT.md → backend gaps` before promotion to additive:

| # | Candidate | Current evidence | Status |
|---|---|---|---|
| NG-01 | `change_summary` field on deliverable | 1 call-site (web page, currently synthesizes) | locked — not substrate-justified |
| NG-02 | `can_approve` / `can_reject` action-authorization flags | 1 call-site web; mobile counterpart not yet created | re-evaluate after mobile slice creation |
| NG-03 | Dynamic `next_steps` on DeliverablePage | shared with ClientCabinet | carved out to slice #3 |
| NG-04 | Unified state primitives (PageLoading etc.) | Phase 2 | not yet |
| NG-05 | Token system expansion | Phase 3 | not yet |
| NG-06 | Landing / atmosphere doctrine | separate document | parallel track |
| NG-07 | Live integration rollout (Stripe / Resend / OAuth / LLM) | orthogonal | parallel track, key-gated |
| NG-08 | Broad endpoint refactors / response-shape rewrites | violates I-06 | forbidden mid-pass |

Non-goal does not mean rejected forever. It means **not justifiable today on
available evidence**.

---

## 6. Sequencing rationale

Why doctrine before implementation:

- Substrate has stabilized enough that genuine architectural fractures are now
  visible (e.g. dual deliverable endpoint families). Without frozen rules,
  every observed fracture risks being patched aesthetically rather than
  structurally.
- Without I-06, the next backend addition becomes a precedent for the next ten.
- Without I-04 grep contract, drift returns silently between PRs.

Why parity slices (concept-by-concept), not platform-by-platform:

- Drift originates at concept boundary, not at platform boundary.
- Cheaper to hold parity than to rebuild it after the fact.
- Semantic context stays fresh inside one concept boundary.

Why no live integrations or token work in parallel:

- Integration rollout depends on stable contract surface. SUBSTRATE_CONTRACT
  defines that surface.
- Token / perception work is a different doctrine; mixing them produces
  aesthetic framework instead of operational law.

---

## 7. Regression anchors

Captured at doctrine freeze. To be re-measured after each slice in
`PHASE1_SUBSTRATE_CLOSEOUT.md → regression anchors`.

| Anchor | Measurement method | Initial snapshot |
|---|---|---|
| Forbidden grammar count per surface | `grep -c` against rules in §2 | to be snapshotted by Phase 0.5 testing walkthrough |
| Canonical endpoint adoption % | call-site count canonical / total per concept | to be snapshotted |
| Legacy enum leakage | grep `revision_requested\|"pending"` in pages | to be snapshotted |
| Optimistic mutation count | grep §2 patterns | to be snapshotted |
| Web/mobile parity gap | concept count with no counterpart screen | to be snapshotted |
| Convenience state symbol count | grep §2 patterns | should equal 0 |

---

## 8. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-12 | initial freeze | Revision 1.0 — invariants I-01..I-10 frozen, bounded debt BD-01..BD-06 recorded, non-goals NG-01..NG-08 declared. |
| 2026-05-12 | Phase 0.5a snapshot | BD-07 (`ClientDeliverable.js` singular legacy surface) and BD-08 (`ClientProjectPage.js` mixed-family consumer) added to §4 after static-grep discovery. No invariants changed; no non-goals promoted. |

---

## 9. Amendment rules

This document is operational law. Amendments require:

1. Evidence (≥2 surfaces) — same standard as I-06 promotion
2. New entry under §1 (invariants) OR §4 (bounded debt) OR §5 (non-goals)
3. Change log entry with date and rationale
4. No silent retraction of existing invariants — only explicit supersession

Anything not encoded here is not law. Anything encoded here is.
