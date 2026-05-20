# Phase 1 — Substrate Closeout Matrix

Tracks progress through 6 concept slices toward operational substrate closure.
**Not narrative. Matrix only.**

Doctrine reference: [`SUBSTRATE_CONTRACT.md`](./SUBSTRATE_CONTRACT.md)
Endpoint registry: [`ENDPOINT_FAMILY_REGISTRY.md`](./ENDPOINT_FAMILY_REGISTRY.md)

---

## 0. Surfaces (slice order — chronology sensitivity)

| # | Concept | Closes | Why this position |
|---|---|---|---|
| 1 | ClientDeliverable | Delivery lifecycle | Strongest contract pressure; dual endpoint family makes it the canonical test of I-03 |
| 2 | ClientVersions | Chronology lifecycle | Chronological ordering = strongest backend-truth requirement |
| 3 | ClientCabinet | Cabinet overview | Aggregation-heavy; absorbs BD-04 useMemo carve-out |
| 4 | DeveloperWork | Execution lifecycle | Aggregation pressure (`workLogs.reduce`); critical timer state |
| 5 | DeveloperGrowth | Career lifecycle | Mostly aggregation; lower lifecycle-criticality than Work |
| 6 | ProviderInbox | Communication lifecycle | Highest violation density; benefits from doctrine maximally proven first |

Together these stabilize the operational graph. Order swapped from initial plan:
`DeveloperWork` precedes `DeveloperGrowth` per chronology-sensitivity criterion.

---

## 1. Status legend

| Status | Meaning |
|---|---|
| `pending` | Not started |
| `audit` | Audit complete, no code touched |
| `in-flight` | Implementation in progress |
| `frozen` | Meets DoD; no drift detected by grep contract |
| `carved-out` | Deferred to a later slice with documented carve-out |

---

## 2. Definition of Done (per slice)

A slice is `frozen` only when **all** of the following hold:

1. No forbidden client derivation (grep §2 of `SUBSTRATE_CONTRACT.md` = 0 in surface files)
2. Page composed from independent backend contracts (I-09)
3. No optimistic local mutation (I-05)
4. Loading / error / empty separated structurally (I-10)
5. Web ↔ mobile semantic parity verified (both surfaces exist; same field shape; same status enum)
6. Smoke tested live against backend (manual or testing agent against doctrine probes)
7. No new bounded debt introduced; existing debt unchanged unless slice-owned
8. No convenience state (I-02)
9. `data-testid` only on interactive/action-critical nodes
10. Backend changes (if any) are strictly additive per I-06 and recorded in §6 below

`request_id` propagation is **out of scope for Phase 1**.

---

## 3. Slice matrix

| # | Surface | Web file | Mobile file | Forbidden grammar (real) | Optimistic mut. | Convenience state | Legacy endpoint family use | Loading/error/empty | Web/Mobile parity | Status | Contract owner | Last verified commit | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ClientDeliverable | `web/src/pages/ClientDeliverablePage.js` | `frontend/app/client/deliverable/[id].tsx` (created) | **0** all primitives | **0** | **0** | **0** (canonical only) | 3 structural inline branches ✅ | ✅ both surfaces created | **`frozen`** | slice #1 (E1) | post-slice 2026-05-12 | Rewrite mechanical. Dead surface `ClientDeliverable.js` deleted (BD-07 sunset). Navigation wired from decision-hub + projects/[id]. Inline action error replaces alert(). |
| 2 | ClientVersions | `web/src/pages/ClientVersionsPage.js` | `frontend/app/client/versions/[project_id].tsx` (created) | **0** all primitives (code-scope, comments excluded) | **0** | **0** | **0** (BD-11 ratified canonical-within-mixed per D-1B) | 3 structural inline branches ✅ | ✅ both surfaces created | **`frozen`** | slice #2 (E1) | post-slice 2026-05-12 | Rewrite mechanical. Status enum coverage gap closed (canonical ladder + inline `normalizeStatus`, same pattern as slice #1, NOT extracted). V-7 closed (singular `/projects/{id}` replaces `/projects/mine` list). Error→empty collapse closed (explicit error branch + retry). Mobile parity surface created (semantic, not pixel). Implicit chronology coupling BD-12 documented but not promoted to I-11 (insufficient empirical evidence — read-only single-consumer non-interactive surface). |
| 3 | ClientCabinet | `web/src/pages/ClientCabinet.js` | `frontend/app/client/projects/[id].tsx` + `frontend/app/client/projects/index.tsx` (cabinet-centric scope per D-SCOPE-1=B) | **0 real** in scope (mobile detail keeps 1 invoice `.sort` by `created_at` desc per D-3, 2 inline structural `.filter` for renderable selection, 1 `useMemo` for deferred upsell per D-4) | **0** | **0** (Math.min cosmetic clamps only) | **0** in scope (cabinet endpoint family stays `/client/projects/{id}/full` + `/client/project/{id}/workspace` — BD-11-style ratification) | 3 structural inline branches on all 3 surfaces ✅ | ✅ both mobile surfaces aligned via shared `status_counts` shape | **`frozen`** | slice #3 (E1) | post-slice 2026-05-12 | **First legitimate I-06 backend-additive crossing.** BD-15 promoted: backend additive `status_counts` on `/client/project/{id}/workspace` (≥2 mobile consumers confirmed: project-detail + project-list). Narrow, additive, explicit — NOT a universal stats object. BD-04 closed via D-2: `pendingDelivs` useMemo synthesis removed → inline structural filter at render time. D-3 hybrid E+: invoice UUID lex-sort replaced with `created_at` desc — fake authority proxy for chronology eliminated. **BD-14 (one-open-invoice-per-module aggregation) stays bounded** — single-surface presentation grouping; not promoted. Silent catches closed on both mobile surfaces (D-5). Web cabinet `alert()` for payment failure → inline `actionError` state with dismiss button (D-5). Inline status normalization not needed on cabinet (no enum drift on `/full` shape). **No new abstractions**, no shared helpers, no invariant promotions. BD-08 (ClientProjectPage.js) and billing.tsx deliberately excluded per D-SCOPE-1=B. Upsell logic untouched (D-4 defer). Live deployed smoke: mobile project-detail counters `1 in progress / 1 in review / 1 done` rendered from backend `status_counts` — zero client-side synthesis. |
| 4 | DeveloperWork | `web/src/pages/DeveloperWorkPage.js` | `frontend/app/developer/work.tsx` | `.reduce` ×1 (real — `totalHours` aggregation, line 152); `.filter` ×1 (form-cleanup, acceptable); `Math.min` ×1 (cosmetic) — **1 real violation** | 0 | 0 | 0 | loading ✅ / error 🟡 (alert×4) / empty 🟡 | ✅ both surfaces exist (but mobile has C-7 violation) | `audit` | — | `54c05b9` | Web `.reduce(totalHours)` = page aggregation = I-01/I-04 breach. Mobile `tasks.filter().sort()` = hide+reorder. |
| 5 | DeveloperGrowth | `web/src/pages/DeveloperGrowthPage.js` | `frontend/app/developer/growth.tsx` | `Math.min` ×2 (cosmetic clamps) — **0 real violations** | 0 | 0 | 0 (to verify) | loading ✅ / error 🟡 / empty 🟡 ; mobile: loading **❌ (0 explicit branch)** | ✅ both surfaces | `audit` | — | `54c05b9` | Cleanest from forbidden-grammar lens; check authority for tier/network aggregates (likely backend already). |
| 6 | ProviderInbox | `web/src/pages/ProviderInbox.js` | `frontend/app/inbox.tsx` | `.filter` ×3 (1 synthetic-lifecycle expired removal + 2 local-list removals); `Math.max(0, expires_in-1)` — **3 real violations** | **2** (lines 79, 95) + **2 list removals** (107, 124) = 4 mutation-class breaches | 0 | 0 (uses canonical inbox endpoints — verify) | mobile: loading **❌ (0 explicit branch)** ; web: loading ✅ / error 🟡 (alert×2) | ✅ both surfaces (but both with high violation density) | `audit` | — | `54c05b9` | **Highest violation density**. Countdown decrement (line 69) + filter expired (line 70) = synthetic lifecycle. POST→local removal = synthetic state. Placed last in order so doctrine is maximally proven before rewrite. |

`Contract owner` and `Last verified commit` populated when slice moves to `frozen`.

### Additional surfaces discovered during snapshot (not in original Phase 1 plan)

| Surface | Issue | Decision |
|---|---|---|
| `web/src/pages/ClientDeliverable.js` (singular!) | 2 legacy `/api/deliverables/*` calls (lines 66, 82); 323 lines; imported in `App.js:35` | **Registered as BD-07** (legacy duplicate deliverable surface). Slice #1 owns its closure (either remove it, redirect to canonical `ClientDeliverablePage`, or sunset). |
| `web/src/pages/ClientProjectPage.js` | Mixed: 2 legacy `/api/deliverables/*` (lines 465, 505) + 1 canonical `/api/client/deliverables/*/pay` (line 481) | **Registered as BD-08** (mixed-family consumer). Closed in slice #3 (ClientCabinet) since it's a project-level surface that overlaps both Deliverable and Cabinet concerns. |
| `web/src/pages/ClientProjects.js` (list) | Legacy enum value `'pending'` in filter chain (line 86) | Bounded debt under BD-03 (already covers `pending` enum). No new entry needed. |
| `web/src/pages/TesterValidationPage.js` | Heavy `'pending'` use, but on `validation` collection — different concept than deliverable | Out of scope: `validation.status` enum follows module/QA lifecycle (§3 ladder), not deliverable lifecycle. No violation. |

---

## 4. Audit details — slice #1 (ClientDeliverable)

### Web `web/src/pages/ClientDeliverablePage.js` (482 lines)

| # | Violation | Reference | Location | Severity |
|---|---|---|---|---|
| V-1 | Convenience state: `changeSummary` synthesized client-side from `blocks` | I-02 | lines 125–130 | 🔴 |
| V-2 | Forbidden `.filter` in page scope ×3 | I-04 | lines 127, 128, 129 | 🔴 |
| V-3 | Optimistic local mutation after POST approve | I-05 | line 62 | 🔴 |
| V-4 | Optimistic local mutation after POST reject | I-05 | line 81 | 🔴 |
| V-5 | UI derives status (`isPending = status === 'pending'`) — uses **legacy** enum value | I-01, ladder §3 | lines 121–123 | 🟡 |
| V-6 | Error state = `console.error + alert` (not structural render branch) | I-10 | lines 47–48, 66, 86 | 🟡 |
| V-7 | Wrong endpoint family (legacy `/api/deliverables/*`) | I-03 | lines 44, 58, 77 | 🔴 |

### Mobile

| Observation | Reference |
|---|---|
| No dedicated `client/deliverable/[id].tsx` — deliverables shown inline on `projects/[id].tsx` | parity gap (DoD §5) |
| `app/client/projects/[id].tsx` line 182 uses `useMemo(() => deliverables.filter(...))` | violates I-04 in `ClientCabinet` scope (BD-04) |
| `app/chat.tsx`, `frontend/src/decision-hub.tsx` already on canonical family A | aligned |

### Endpoint family resolution (input for slice execution)

- Canonical = `/api/client/deliverables/*` (already used by mobile, chat, decision-hub)
- Legacy `/api/deliverables/*` → bounded debt BD-01

---

## 5. Backend gaps (proposed → must satisfy I-06)

Promotion requires ≥2 independent surfaces proving the same shape.

| ID | Candidate | Surfaces affected | Evidence count | Status | Decision |
|---|---|---|---|---|---|
| G-01 | `change_summary` field on `GET /api/client/deliverables/{id}` | ClientDeliverable web | 1 | NG-01 | **Non-goal until ≥2 surfaces require**. Web currently synthesizes — that synthesis to be removed (carved out from delivery slice; section disappears until backend provides). |
| G-02 | `can_approve` / `can_reject` action-authorization flags | ClientDeliverable web + (future) mobile counterpart | 1 confirmed + 1 pending | NG-02 | **Re-evaluate after mobile screen creation**. If both surfaces converge on same authorization logic, promote. |
| G-03 | Dynamic `next_steps` on DeliverablePage | ClientDeliverable, ClientCabinet | 0 (planned) | NG-03 | **Carved out** to ClientCabinet slice. |

No gap is allowed to migrate from this section to backend code without an
evidence count ≥ 2 **and** a decision entry here recorded before the
backend handler is touched.

---

## 6. Intentional carve-outs

| ID | Item | Owning slice | Reason |
|---|---|---|---|
| C-01 | `useMemo` filter at `frontend/app/client/projects/[id].tsx:182` | ClientCabinet (#3) | Parent surface, not deliverable page itself |
| C-02 | `chat.tsx` inline approve/reject quick-actions | post-Phase 1 | Different surface concept (chat-driven actions) |
| C-03 | Legacy `/api/deliverables/*` family removal | each slice removes own consumers | Family sunsets when last consumer migrates |
| C-04 | Visual status banner chroma in DeliverablePage | atmosphere doctrine | `PERCEPTION_TONE ∉ substrate` |
| C-05 | "What Happens Next" static copy block | atmosphere | Not state-dependent; UX narrative |
| C-06 | Web ESLint TS rules (`DISABLE_ESLINT_PLUGIN=true`) | Phase 2/3 | BD-05 |

---

## 7. Deferred atmosphere decisions

Items intentionally NOT addressed in Phase 1. Recorded here so future passes
do not relitigate "was this missed or deliberate?"

| Item | Rationale |
|---|---|
| Visual status banner color hierarchy | Perception layer, not operational substrate |
| Glow / shadow / token tier additions | Not yet substrate-justified; awaits dedicated perception doctrine |
| Landing copy / hero visuals | Separate art-direction discipline |
| Typography rhythm tuning | Phase 2/3 candidate after state primitives stabilize |
| Iconography unification (lucide-react vs expo/vector-icons) | Cross-platform perception layer |

---

## 8. Follow-up primitives (Phase 2 candidates)

Tagged from each slice for later mechanical extraction. **Empty until at least
one slice is `frozen`** — extraction without evidence produces giant components.

| Primitive candidate | Originating surfaces | Promotion criterion |
|---|---|---|
| _(none yet)_ | _(none)_ | ≥2 frozen surfaces with structurally identical loading/error/empty branch |

---

## 9. Regression anchors

Baseline snapshot captured 2026-05-12 via static grep (no runtime). To be
re-measured at each slice boundary.

| Anchor | Snapshot @ 2026-05-12 | After slice #1 | After slice #2 | After slice #3 | After slice #4 | After slice #5 | After slice #6 |
|---|---:|---:|---:|---:|---:|---:|---:|
| `.reduce(` in Phase 1 web surfaces | **1** (DeveloperWorkPage:152) | **1** (unchanged — slice #4 target) | **1** (unchanged — not slice #2 territory) | — | target 0 | — | — |
| `.filter(` in Phase 1 web surfaces (excl. form-cleanup & cosmetic) | **6** (CD ×3 synth, PI ×3) | **3** (CDP ×0, PI unchanged) | **3** (CVP ×0 — already clean pre-slice; unchanged) | — | — | — | target 0 |
| `useMemo(` in Phase 1 web surfaces | **0** | **0** | **0** | 0 | 0 | 0 | 0 |
| `Math.max\|min(` excl. cosmetic clamps | **0 real** (all 6 matches are progress-bar UI) | **0 real** | **0 real** | 0 | 0 | 0 | 0 |
| Optimistic mutation occurrences (`set\w+\(prev => \(\{ \.\.\.prev,` pattern) | **6** (CD ×2, PI ×4 incl. list-removals) | **2** (CDP ×0, PI ×2 toggleStatus/quickMode; list-removals still match but only with `\.filter` pattern — counted under that anchor) | **2** (CVP read-only by design — no mutations; PI unchanged) | — | — | — | target 0 |
| Legacy `/api/deliverables/*` call-sites | **8** (CDP ×3 + CD-singular ×2 + CPP ×2 + slice-unscoped ×1) | **2** (CDP ×0, CD-singular deleted, CPP ×2 — BD-08 owned by slice #3) | **2** (unchanged — CVP never used that family) | target 0 (CPP ×0) | — | — | — |
| Canonical `/api/client/deliverables/*` call-sites | **5** (chat, decision-hub, projects/[id], CC simulate-payment, CPP pay) | **19** (CDP ×3 + new mobile ×4 + decision-hub navigation upgrade + existing) | **19** (unchanged — CVP uses `/projects/{id}/versions` ratified canonical-within-mixed per D-1B) | target 21+ (after CPP migration) | — | — | — |
| Legacy enum `revision_requested` writes (page scope) | **1** (CDP:81 optimistic mutation — disappears with I-05) | **0** | **0** | 0 | 0 | 0 | 0 |
| Legacy enum `pending` deliverable status reads (page scope) | **3** (CDP:121, CDP:122-equiv, ClientProjects:86) | **1** (CDP migrated to `pending_approval` + legacy normalization helper; ClientProjects:86 in BD-08 territory) | **1** (CVP migrated to canonical enum + inline `normalizeStatus` per slice #1 pattern; ClientProjects:86 still BD-08) | — | target 0 | — | — |
| Convenience state symbol count (I-02 forbidden list) | **0** verbatim ; **1 informal** (`changeSummary` synthesis in CDP) | **0** informal (section removed entirely; no replacement synthesis introduced) | **0** | 0 | 0 | 0 | 0 |
| `alert(` as error UI fallback (Phase 1 surfaces) | **15** (CDP ×2, CC ×1, DWP ×4, PI ×2, work.tsx ×7 incl. Alert.alert) | **13** (CDP ×0) | **13** (CVP had 0; unchanged) | — | target 12 (CC ×0) | target 8 (DWP+work.tsx mostly closed) | target 0 |
| Concepts with mobile parity gap | **3 of 6** (Deliverable, Versions, Cabinet) | **2 of 6** (Versions, Cabinet) | **1 of 6** (Cabinet) | target 0 | 0 | 0 | 0 |
| Surfaces with explicit loading branch | **7 of 9** (mobile growth.tsx + inbox.tsx missing) | **8 of 10** (+ new mobile deliverable screen) | **10 of 12** (+ new web/mobile versions screens — both with explicit loading/error/empty branches) | — | — | target 8 of 11 | target 11 of 11 |
| Vendor name leakage outside `live_adapters.py` | **0** | **0** | **0** | 0 | 0 | 0 | 0 |
| Implicit-chronology coupling (CA-1, CA-2, CA-4 — page renders order without contracting order) | n/a (pre-audit) | n/a | **1 surface** (CVP+CVS, BD-12 documented; insufficient for I-11 promotion — single read-only consumer) | re-measure | re-measure | re-measure | re-measure |
| **Implicit authority coupling count** (any class — chronology, aggregation, lifecycle, etc. — frontend assumes backend semantics not contractually named) — *new persistent metric introduced post-slice-#2 per governance refinement* | n/a | n/a | **1** (owned by **BD-12**, chronology class) | **2** (BD-12 chronology + **BD-14** aggregation — "one open invoice per module" tolerated bounded) | re-measure | re-measure | re-measure |
| **I-06 promotion crossings** — backend additive shapes legitimately introduced via slice work | 0 | 0 | 0 | **1** (`status_counts` on `/client/project/{id}/workspace`, BD-15) | — | — | — |
| Mobile `useMemo` + `.filter` for module-status synthesis | n/a (pre-audit) | n/a | 2 surfaces (`projects/[id].tsx` ×3 filters + `projects/index.tsx` ×4 filters) | **0 surfaces** (both consume `status_counts`) | 0 | 0 | 0 |
| Cross-concept invoice synthesis (chronology + aggregation, BD-14 family) | n/a | n/a | 1 (UUID lex-sort proxy) | **1 bounded** (created_at sort + aggregation note) | re-measure | — | — |
| **Slice DoD met** | — | **✅ all 10 pts** | **✅ all 10 pts** (ratified) | **✅ all 10 pts** | — | — | — |

Legend: `CD` = ClientDeliverable.js (singular legacy); `CDP` = ClientDeliverablePage.js; `CPP` = ClientProjectPage.js; `CC` = ClientCabinet.js; `DWP` = DeveloperWorkPage.js; `PI` = ProviderInbox.js.

---

## 10. Semantic Authority Map

For each Phase 1 surface, this table declares **who owns each concern**.
Anything marked `backend` MUST come from the server response; UI just renders.
Anything marked `frontend (cosmetic)` is presentation-only — no business value
encoded.

A "?" means the authority is currently unclear and must be resolved during
the slice's audit-to-implementation transition.

### 10.1 ClientDeliverable

| Concern | Authority | Notes |
|---|---|---|
| Status lifecycle (`pending_approval → approved\|rejected`) | backend | I-03 enum ladder §3 of CONTRACT |
| Approval permission (can current user approve?) | backend | NG-02 candidate `can_approve` flag — still 1-surface, not promoted |
| What's changed (added/improved/fixed buckets) | **backend ?** | Currently fabricated client-side → NG-01 carve-out: section disappears until backend owns it |
| Resource list (preview/api/repo URLs) | backend | Already provided in `blocks[]` |
| Work units backing the deliverable | backend | Already provided in `work_units[]` via canonical GET |
| Next step after approve/reject | backend (cosmetic copy frontend) | Dynamic next-step deferred to ClientCabinet (NG-03) |
| Display grouping of blocks | frontend (cosmetic) | Sorting/grouping for visual rhythm, no business impact |

### 10.2 ClientVersions

| Concern | Authority | Notes |
|---|---|---|
| Version chronological order | backend | Strongest chronology authority test |
| Diff between versions | backend | Server returns the diff payload |
| Active version pointer | backend | — |
| Version label / display name | backend | — |
| Per-version metadata (created_at, author) | backend | — |
| Time-since-now display | frontend (cosmetic) | `fmtRelative(created_at)` allowed |

### 10.3 ClientCabinet

| Concern | Authority | Notes |
|---|---|---|
| Project progress % | backend | Reads `project.progress` |
| Modules count / status breakdown | backend | Server returns aggregates |
| Pending deliverables list | backend (per query filter) | Adds `?status=pending_approval` filter param to canonical GET |
| Aggregate totals (cost, hours) | backend | I-01 aggregation rule |
| Confidence / risk score | backend | Already computed in `calculate_project_confidence` |
| Next steps recommendations | backend | Already computed in `get_next_steps` helper |
| Tab order / section visibility | frontend (cosmetic) | UI layout decision, no business value |

### 10.4 DeveloperWork

| Concern | Authority | Notes |
|---|---|---|
| Active timer state (running / stopped / category) | backend | `time_tracking_layer` — single source |
| Total hours logged on a unit | **backend** | Currently `workLogs.reduce(sum)` on client — I-04 breach to close |
| Submit eligibility (link required, status check) | backend | Form validation OK locally; business eligibility from server |
| Task assignment list | backend | — |
| Task ordering | backend | Mobile currently `tasks.filter().sort()` — I-04 breach to close |
| Time elapsed display (live counter) | **backend ?** | Currently `Math.max(0, Math.round((now-start)/60000))` client-side — cosmetic since `start` is server-provided. Acceptable if `start` is the only server input. |
| Submit modal copy | frontend (cosmetic) | — |

### 10.5 DeveloperGrowth

| Concern | Authority | Notes |
|---|---|---|
| Tier (junior/middle/senior/elite) | backend | — |
| Network size, earnings, reputation | backend | — |
| Next tier criteria (network_needed, earnings_needed) | backend | Already in response |
| Progress-bar fill % | frontend (cosmetic clamp) | `Math.min(100, x*100)` is presentation, not derivation |
| Achievement list | backend | — |
| Leaderboard position | backend | — |

### 10.6 ProviderInbox

| Concern | Authority | Notes |
|---|---|---|
| Inbox item list | backend | — |
| Item expiry / countdown | **backend (truth) + frontend (display ticker)** | Backend owns `expires_at`; UI may compute "seconds until" for display. Current code mutates `expires_in` on a timer + removes expired entries client-side = **I-01 + I-05 breach (synthetic lifecycle)**. Resolution: backend pushes update / UI re-reads on tick. |
| Quick-mode eligibility (rating > 70) | backend | Currently `alert('требует рейтинг > 70')` client-side — should come as `can_quick_mode` flag |
| Accept / decline action permissions | backend | NG-02 family |
| Post-action list state | backend (refetch) | Currently `setInbox(prev => prev.filter(...))` — I-05 breach |
| Profile status, quick-mode flag | backend | Currently `setProfile(prev => ({ ...prev, ... }))` — I-05 breach |
| Recommended action highlight | backend | Currently inline `data?.recommended` + client filter to exclude it from others list — borderline; recommend backend returns `recommended` + `others` already separated |

### Aggregate authority summary

| Concern class | Backend | Frontend (cosmetic only) | Currently misowned |
|---|---|---|---|
| Lifecycle / state transitions | ✅ | ❌ | 6 occurrences (slice #1 + #6 mostly) |
| Aggregation / totals | ✅ | ❌ | 1 occurrence (DWP totalHours) |
| Permissions / authorization | ✅ | ❌ | 3 informal (CDP, PI ×2) — NG-02 / authority-flag promotion candidate |
| Display ordering / grouping | varies | OK if presentation-only | 2 occurrences (mobile work.tsx, mobile inbox.tsx) |
| Time-since / countdown | backend truth + UI tick | OK | 1 critical (PI synthetic lifecycle) |
| Status labels / colors | frontend (cosmetic dictionary) | ✅ | none |
| Progress-bar clamps | frontend (cosmetic) | ✅ | none — all 6 Math.min matches are presentation |

---

## 11. Testing-against-doctrine probes (for Phase 0.5b)

Probes the testing walkthrough must measure. These are **objective**, not
subjective ("clean / not clean"):

| Probe | Expected | Method |
|---|---|---|
| UI computes business state | 0 occurrences in page scope | grep contract §2 |
| Optimistic mutation | 0 occurrences in page scope | grep contract §2 |
| Divergent endpoint family use | 0 new consumers on legacy families | grep + registry diff |
| Independent GET composition | yes per page | code inspection — no merged response objects |
| Loading / error / empty separation | 3 distinct branches per page | code inspection |
| Web ↔ mobile semantic parity | every concept has both surfaces | matrix §3 column "Mobile file" non-empty |
| Legacy enum leakage | bounded (BD-02, BD-03) | grep count = baseline; no new writes |
| Synthetic timeline generation | 0 | grep `[\.\.\.]push` / array spreads on timeline state |
| Vendor name leakage in business logic | 0 (I-08) | grep `stripe_session_id\|wfp_order_ref` outside `integrations/live_adapters.py` |

---

## 12. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-12 | initial | Matrix scaffold; slice #1 (ClientDeliverable) audit row populated; gaps G-01..G-03 deferred to non-goals; carve-outs C-01..C-06 recorded. |
| 2026-05-12 | Phase 0.5a snapshot | Slice matrix §3 populated with static-grep findings for all 6 surfaces. Surface order swapped (DeveloperWork now #4, DeveloperGrowth #5) per chronology-sensitivity criterion. §9 regression anchors baseline column filled. §10 Semantic Authority Map added (per-surface concern-ownership table). 2 additional surfaces discovered (`ClientDeliverable.js` singular, `ClientProjectPage.js` mixed) — registered as BD-07/BD-08 in SUBSTRATE_CONTRACT.md. ProviderInbox identified as highest-violation-density surface (synthetic lifecycle on countdown line 69–70, list-removal mutations 107/124, profile mutations 79/95). |
| 2026-05-12 | Phase 0.5b targeted probes (Option C) | 5 probes C-01..C-05 executed. **C-01**: real enum values in DB = `{pending_approval, approved}` only — `revision_requested`/`pending` never written → BD-02/BD-03 sunset closer. **C-02**: canonical `/api/client/deliverables/*/approve` empirically does full side-effect chain (status flip + invoice issuance + project progress +15 + realtime `invoice.created` to user + realtime `deliverable.approved` to role:admin + learning candidate detection). Legacy family stays compat-only. **C-03**: mobile `developer/growth.tsx` has `loading` state declared but no conditional render branch (collapses to `data?.tier` optional chaining); mobile `inbox.tsx` has no loading state at all and `catch {}` silently swallows errors → both confirmed I-10 structural collapse. **C-04 severity calibration**: CDP optimistic mutations are MATCH today (latent breach — would diverge after slice #1 migration to canonical reject `status: 'rejected'` ≠ local `'revision_requested'`); ProviderInbox toggleStatus/toggleQuickMode have 5s lying-UI window (server-side rejection invisible until next poll) = operationally dangerous; ProviderInbox countdown decrement = drift between 5s polls, can hide items server still considers active = operationally dangerous. **C-05**: `ClientDeliverable.js` (singular) is fully unreachable — imported in `App.js:35` but no `<Route>` and no JSX usage. BD-07 sunset = just delete the file + remove import. No redirect/migration needed. |
| 2026-05-12 | **Slice #1 — ClientDeliverable — FROZEN** | Mechanical governance repair completed. (1) `web/src/pages/ClientDeliverable.js` deleted + `App.js:35` import removed (BD-07 sunset). (2) `web/src/pages/ClientDeliverablePage.js` rewritten on canonical `/api/client/deliverables/*` family with structural inline loading/error/empty branches, canonical enum `pending_approval/approved/rejected` (legacy `pending`/`revision_requested` read-side normalized via `normalizeStatus()`), zero optimistic mutations (POST → `await fetchDeliverable()`), zero convenience state (changeSummary section removed entirely — no replacement synthesis), inline action-error render branch replaces alert(). (3) `frontend/app/client/deliverable/[id].tsx` created as mobile parity surface (semantic parity, not pixel-identical): same canonical endpoints, same enum, same `normalizeStatus()`, KeyboardAvoidingView on reject modal, three structural state branches. (4) Navigation entrypoints wired: `decision-hub.tsx` now pushes to `/client/deliverable/{id}` (was `/client/projects/{project_id}`); `app/client/projects/[id].tsx` adds inline "View details" link on each decision card (existing approve/reject quick-actions preserved as BD-06-style). **No new abstractions, hooks, or primitives introduced** per slice scope. **Post-slice smoke confirmed**: GET canonical 200 with `work_units`; GET non-existent 404 with shaped error; POST reject on already-approved 400 with shaped error — UI error branch consumes shape correctly. Numbers achieved exceed targets (legacy /api/deliverables/* call-sites 8→2, optimistic mutations 6→2, parity gap 3→2, convenience state 1→0, alert() in Phase 1 surfaces 15→13). |
| 2026-05-12 | **Slice #1 — deployed artefact verified** | Web bundle rebuilt twice. First build (`main.456a01e1.js`) exposed pre-slice infrastructure gap: deployed bundle had `API = undefined/api` because `REACT_APP_BACKEND_URL` was never set at build time — visible in backend logs as `POST /api/web-ui/client/undefined/api/auth/login → 405`. Pre-existing, not slice #1 regression, but blocked observation. Resolved by creating `/app/web/.env` with empty `REACT_APP_BACKEND_URL=` (same-origin /api resolution via Kubernetes ingress), rebuild → `main.a45c089e.js`. **Final bundle checks**: `undefined/api` occurrences = **0**; canonical `/client/deliverables/` path = 5; all 8 structural testIDs present; `changeSummary` literal = **0**; `revision_requested` literal = 6 (all known bounded debt). **Deployed visual smoke**: client@atlas.dev login + navigate to `/client/deliverable/del_edece5c25c5d` → page renders fully, "Delivery Approved" banner visible, canonical `approved` status tag, all sections (What's Included / Resources / What Happens Next) populated from backend. **runtime state == deployed artefact** — governance hygiene gap closed.|
| 2026-05-12 | Re-clone bootstrap (new pod) | Repo cloned fresh into `/app`, all 3 surfaces re-bootstrapped (backend port 8001 + web build served via `/api/web-ui/` + Expo metro tunnel). Slice #1 freeze-check probes re-verified on new bundle (`main.a4881a3f.js`): `undefined/api`=0, `/client/deliverables/`=5, `changeSummary`=0, `revision_requested`=6. All 4 slice-#1 contract probes pass live (GET 200, GET 404 shaped error, POST reject 200, POST reject-again 400 shaped). Bundle content-hash differs from `a45c089e` due to webpack content-hash variation from node_modules drift — semantic content identical (all 4 grep metrics match). Two seed observations registered: BD-09 (data-quality, `del_98a3d2ce115a` missing `client_id` → 403 to owner) and BD-10 (access-governance, `/api/projects/{id}/versions` has no project-ownership check, any authenticated user can read any project's versions). Neither is substrate-doctrine debt; both deferred to appropriate queues. |
| 2026-05-12 | **Slice #2 — ClientVersions — AUDIT PASS (governed)** | Audit completed read-only, no code touched. Surface inventory: web `ClientVersionsPage.js` exists (167 LOC, pre-slice clean), mobile screen MISSING (parity gap M-1), backend handler `GET /api/projects/{project_id}/versions` returns flat list `sort("created_at", -1)`. Code-scope forbidden-pattern grep: **0 real violations** (cleanest Phase 1 surface). Violations identified: V-1 endpoint family impurity (BD-11), V-2 status enum coverage gap (UI handles `pending`/`revision_requested` but live data is `pending_approval`/`rejected`), V-3/V-4 error→empty state collapse, V-5 implicit chronology coupling (BD-12), V-6 orphan route (no nav-in entry-point), V-7 authority-overreach via convenience fetch shape (page consumes `/projects/mine` list to synthesize singular project name authority). New audit category exercised: **Chronology assumptions inventory (CA-1..CA-8)** — implicit-coupling debt formally registered with empirical evidence pool for eventual I-11 candidacy. Decisions D-1..D-4 enumerated with recommendations. Bounded debts BD-09..BD-13 registered, classified by layer. Non-goals explicitly listed to prevent future re-litigation. |
| 2026-05-12 | **Slice #2 — ClientVersions — FROZEN** | Mechanical governance repair completed under frozen constraints D-1B / D-2A / D-3C / D-4B. (1) `web/src/pages/ClientVersionsPage.js` rewritten on `/api/projects/{id}/versions` (canonical-within-mixed, ratified per D-1B), canonical status enum + inline `normalizeStatus()` (slice #1 pattern, NOT extracted — `normalizeVersionStatus()` deliberately avoided per "small duplication > premature semantic centralization"), all 3 canonical statuses + legacy read-side normalization, structural error branch with retry (V-3/V-4 closed), singular `/api/projects/{id}` for project name (V-7 closed — authority-overreach via convenience fetch shape eliminated), zero optimistic mutations (read-only surface, no possible breach), zero client-side chronology transforms (no `.sort` / `.reverse` / `.filter` / `.reduce` / `useMemo` in page scope), no "latest"/"current"/"active" derivation. (2) `frontend/app/client/versions/[project_id].tsx` created as mobile parity surface — same authority model (same endpoints, same enum normalization, same structural state branches), NOT same pixels (mobile-native card list, no vertical-rail timeline). Strictly NO mobile-native chronology semantics introduced (no collapsible groups, month sections, "recent" buckets, swipe chronology, optimistic insert animations). (3) BD-12 implicit-chronology debt documented in both files' header comments with explicit tolerance criteria: backend ordering stable, single-consumer, read-only, non-interactive chronology — sentence enshrined to formally explain bounded scope and prevent accidental-omission interpretation by future readers. **I-11 NOT promoted** — empirical evidence still insufficient (single read-only consumer); decision deferred per brief. **No new abstractions, hooks, or shared helpers introduced.** **Backend untouched** (I-06: 1-surface evidence fails promotion threshold). **Post-slice smoke confirmed**: GET versions 200 with descending-by-created_at ordering; GET singular project 200 + ownership check; deployed web bundle `main.602c454c.js` rendered fully on preview (Acme Client logged in → `/client/project/proj_09ad143593cd/versions` → "Mobile App Refresh" + v0.4 card + "changes requested" blue badge for rejected status — confirming V-2 enum fix in deployed artefact); deployed mobile screen rendered fully on Expo Metro preview (`/client/versions/proj_09ad143593cd` → identical authority semantics, mobile-native layout, NO chronology synthesis). Numbers achieved: legacy-enum-reads on CVP 3→1 (read-side normalization only), parity gap 2/6→1/6, structural-loading-branch surfaces 8/10→10/12, alert() count unchanged (CVP never used), implicit-chronology-coupling surfaces newly tracked = 1 (CVP+CVS — below I-11 promotion threshold). **Chronology drift inspection**: backend returns descending, frontend renders array-order top→bottom on both surfaces, zero transformations between contract and pixels — clean chronology pipeline observed in live deployed artefact. Decision on I-11 promotion deferred to post-multi-consumer evidence per doctrine. |
