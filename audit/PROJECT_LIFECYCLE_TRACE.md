# PROJECT_LIFECYCLE_TRACE.md
**Subject:** `proj_d7f78d8f92db` — "Acme Analytics Platform" (idempotent boot-seed canonical demo)
**Trace date:** 2026-05-13
**Trace type:** observed operational reality (not intended design)
**Mode:** Stage 7 — discovery, not migration

Trace is a **forcing function**, not documentation. Goal: name contradictions, not describe behavior.

---

## 0. Subject snapshot

```
project_id      proj_d7f78d8f92db
name            Acme Analytics Platform
client_id       user_00ccf901f26e
status          active
current_stage   "development"
progress        55           ← stored derived (no live recompute)
risk_level      "low"
confidence_score 100
created_at      2026-05-13T20:26:35
last_calculated_at 2026-05-13T21:13:17  ← what was calculated? unclear

modules:
  mod_5ac00687f518  "Auth & User Management"   price=1500  status=done    qa_status=passed
  mod_3dc838294809  "Analytics Dashboard"      price=2000  status=paused  qa_status=pending  paused_by=operator
  mod_75b9a45bed03  "Stripe Integration"       price=1200  status=paused  qa_status=pending  paused_by=guardian

assignee for all 3 modules: user_a949a3e6a729 (John Developer)
John.active_modules = 0      ← stored, not derived
John.dev_wallets    = NULL   ← no wallet doc exists
John.dev_earning_log = []    ← no entries

payouts collection (3 entries):
  po_b1a922b6a7  mod_5ac00687f518  amount=1200  status=paid       ← module.price=1500, payout=1200
  po_aada59ab5c  mod_3dc838294809  amount=800   status=approved   ← module.price=2000, payout=800
  po_403bb66af5  mod_75b9a45bed03  amount=1100  status=approved   ← module.price=1200, payout=1100

escrow_payouts collection: empty
escrows collection:        empty
invoices collection:       empty
money_ledger_events:       empty
deliverables:              empty
module_assignments:        empty

qa_decisions:
  mod_5ac00687f518 → result=rejected  source=seed_replay_v1
  mod_3dc838294809 → result=rejected  source=seed_replay_v1
  mod_75b9a45bed03 → result=rejected  source=seed_replay_v1

events:
  evt_75837bbdff1c  type=project_idle  severity=warning  status=open  resolved_at=null
```

Already from raw state, three independent emitters wrote disjoint stories. Below — the trace per stage.

---

## 1. Lifecycle stage trace

Format per row:
**Stage | Emitter | Source of Truth (SoT) | Consumers | Failure Mode | Recovery Owner**

| # | Stage | Emitter | SoT | Consumers | Failure Mode | Recovery |
|---|-------|---------|-----|-----------|--------------|----------|
| 1 | **Project creation** | `POST /api/projects` (`server.py:5333`) — sets `current_stage="discovery"` | `projects.{project_id,client_id,status,current_stage}` | nothing immediate; UI re-fetch | If insert fails mid-doc → orphan project_id never returned to client; no compensating delete | **NONE** |
| 2 | **Scope intake (AI estimate)** | `POST /api/scope/save` (`server.py:4166`) — `current_stage="scope"` | `scopes` collection + `projects.scope_id` | UI loads scope page; downstream pricing | If scope saved but project update fails → project stuck at "discovery" with phantom scope_id | **NONE** (no reconciler scans for orphan scopes) |
| 3 | **Module decomposition** | LLM-driven decomposition handler (mock fallback) → `db.modules.insert_many` | `modules.{module_id,project_id,price,base_price,status="todo",assigned_to=null}` | `module_motion.py:62` background loop reads modules per project → writes `projects.progress`; assignment_engine reads for routing | If decomposition partial → project has N modules, but `projects.progress` aggregates over partial set; **module_motion auto-completes the wrong %** | **NONE** (manual operator only) |
| 4 | **Auto-assignment** | `assignment_engine` (sync path) — `modules.update_one({_id}, {$set:{assigned_to:dev_id, assignment_mode:"auto"}})` | `modules.assigned_to` ⚠️ + `modules.assignment_mode` ⚠️ | dev_work reads via `modules.assigned_to`; admin_control & operator queries; team_balancer | **Two SoT for "who has the module":** `modules.assigned_to` (live) vs `module_assignments` collection (insert-only) — collection is **empty** for Acme but Acme has 3 assigned modules. Anything reading `module_assignments` (e.g. audit views) sees zero. | **NONE** |
| 5 | **Developer acceptance** | `POST /api/developer/tasks/:id/accept` — idempotent | `modules.status="in_progress"` + sometimes `accepted_at` | UI work.tsx; module_motion; event_engine.task_waiting_review | If accept POST 200 but `modules.update_one` short-writes → status stays "todo" with no error to user; idempotencyKey collapses the retry. **Silent loss of accept signal.** | **NONE** (no read-after-write check) |
| 6 | **Work in progress** | `POST /api/dev/tasks/:id/start`, `/complete`, `/api/dev/work-units/:id/log-time` | `modules.last_activity_at` + `time_tracking_layer`+ `developer_scores` | event_engine detects `task_stuck`, `task_waiting_review`, `developer_overloaded` via cron scan; AUTO_BALANCER 60s cadence | event_engine creates `events` rows but **never resolves** them (Acme's `evt_75837bbdff1c project_idle` has `status=open, resolved_at=null` for hours despite payout activity) | event_engine self-resolves on subsequent scan only if **specific** unblock condition seen; otherwise rows accumulate |
| 7 | **Module submit for QA** | `POST /api/modules/:id/submit` (`server.py:7411`) | `modules.{status="reviewing", qa_status="pending", deliverable_url}` + `deliverables.insert_one` (intended) | qa_layer queue; admin QA dashboard | Acme has 1 done module, 0 deliverables. Either deliverable was never written OR was written then garbage-collected. **The submit→deliverable path is not invariant-preserving.** Capability:'payment' gate **NOT yet added** (reserved per work.tsx:165 comment). | **NONE** |
| 8 | **QA decision (approve)** | TWO PARALLEL HANDLERS:<br>(a) `server.py:22330+22338` — `modules.qa_status="passed"` + calls `_credit_module_reward()` — **canonical money path**<br>(b) `server.py:23096+23204` — `modules.qa_status="passed"` — **does NOT call _credit_module_reward** | `modules.qa_status`, `modules.status="done"`, `modules.completed_at` | money_runtime, escrow_layer, client UI, dev_work | Two writers, two semantics. Whichever fires first wins `qa_status`. If (b) fires for a module, **module is marked done but no money credited to wallet** → dev's earnings page shows $0 for completed work. | **NONE** (no idempotent reconciler scans for `done+no_earning_log`) |
| 9 | **QA decision (reject)** | `server.py:22432` — `modules.qa_status="failed"` + revision flow + `qa_decisions.insert_one`<br>OR seed_replay writes directly | `qa_decisions.result="rejected"` + `modules.qa_status` (sometimes) | Module returns to dev for revision; UI shows feedback | **seed_replay writes `qa_decisions` without touching `modules.qa_status`** — Acme module 1 has `qa_status="passed"` AND a `qa_decisions.result="rejected"`. **No reconciliation step.** Reader of decisions sees rejected; reader of module sees passed. | **NONE** |
| 10 | **Module pause** | THREE EMITTERS with overlapping vocabulary:<br>• `auto_guardian.py:133` writes `paused_by:"guardian"`<br>• `auto_guardian.py:193` writes `paused_by:"operator"` (in guardian code!)<br>• `admin_control.py:110` writes `paused_by:"admin"`<br>• `client_operator.py:75` writes `paused_by:"guardian" if by_system else uid` | `modules.{status="paused", paused_by, paused_at, prev_status}` | dev_work hides paused modules from active list; admin & client surfaces filter; event_engine | **`paused_by` has 4+ possible values with no enum**: `"guardian"`, `"admin"`, `"operator"`, or arbitrary user_id. **Resume queries filter by exact value** — `admin_control.py:120`'s "resume all" filters `paused_by:"admin"`. **Modules paused by guardian or operator are invisible to admin resume.** Acme module 2 (paused_by="operator") + module 3 (paused_by="guardian") → neither resumed by any admin "resume all" action. | **NONE** by design — implicit (operator must manually un-pause via separate path that doesn't exist in UI) |
| 11 | **Client approve module (canonical money path)** | `POST /api/client/modules/:id/approve` → `server.py:23077 client_approve_module` → `_credit_module_reward(module)` at `:10675` | `dev_wallets.{user_id, earned, available_balance}` + `dev_earning_log.insert_one({user_id, module_id, amount, type})` | dev_work reads as canonical SoT; payout dispatch | If `_credit_module_reward` returns existing entry (idempotency by `module_id` lookup at `:10749`), retry is safe. **But:** if approve handler version (b) at server.py:23096 runs INSTEAD of canonical path, money credit is silently skipped. | **NONE** |
| 12 | **Payout to developer** | THREE PARALLEL COLLECTIONS:<br>• `db.payouts` — written by `mock_seed` (`server.py:9646`), `client_acceptance.py:120`, `referral_payouts`<br>• `db.dev_wallets + db.dev_earning_log` — written ONLY by `_credit_module_reward`<br>• `db.escrow_payouts` — written by `escrow_layer.py:204` | **No single SoT.** | Different readers query different collections:<br>• `dev_work.py` reads ONLY wallet+log (explicit comment: "DO NOT read db.payouts here — parallel/legacy")<br>• `client_workspace.py`, `client_costs.py`, `client_operator.py`, `client_acceptance.py`, `admin_production.py`, `admin_risk.py`, `auto_guardian.py` read `db.payouts`<br>• `escrow_layer` reads `db.escrow_payouts` | **Developer sees $0 earnings, client sees $1900 cost, backend records 3 payouts in `payouts` collection but zero in `dev_earning_log`.** Three different financial truths exposed to three different roles simultaneously. | **NONE** |
| 13 | **Client invoice** | `client_acceptance.py:120` inserts into `db.payouts` (developer-facing) + (intended) `db.invoices` (client-facing) | `invoices.{invoice_id, project_id, module_id, amount, status, paid_at}` | Client billing UI; Stripe webhook; admin financial dashboard | Acme has 3 paid/approved payouts but **0 invoices**. Either invoice creation is gated behind a flag/condition not met, or mock_seed only seeded one side of the duality. **Client view of "money spent" cannot be reconciled with developer view of "money earned" because the bridge collection (invoices) is empty.** | **NONE** |
| 14 | **Escrow release** | `escrow_layer.escrow_release()` → `escrow_payouts.insert_one` + `escrows.status="released"` | `escrows.status` + `escrow_payouts` | money_runtime, payout dispatch | Acme has **0 escrows total**, yet `payouts` shows 1 paid + 2 approved. **Money was paid out without ever entering escrow.** Mock_seed wrote `payouts` directly, bypassing escrow_layer. Real money flows would be impossible to audit — escrow is meant to be the integrity gate. | **NONE** |
| 15 | **Project status update** | THREE WRITERS to `projects.progress`:<br>• `module_motion.py:62` — async loop, derived from modules<br>• `server.py:3909` — admin path hardcodes `progress=20` on `status="reviewing"`<br>• `server.py:5027` — yet another path with `new_progress` arg | `projects.progress` (single field, three writers) | Client dashboard headline; admin overview; intelligence_layer projections | **Acme's `progress=55`** matches no natural derivation (1 done of 3 = 33%; price-weighted 1500/4700 = 32%). Value is stale or written by an obsolete path. `last_calculated_at` is recent (21:13:17) which suggests a recent loop ran — but result diverges from observable module reality. | module_motion (overwrites on next tick — but it last ran when?) |
| 16 | **Event detection** | `event_engine` scans every 15 min: detects `task_stuck`, `task_waiting_review`, `task_revision_loop`, `developer_overloaded`, `project_idle`, `qa_backlog_high` | `events.{event_id, type, status, severity, project_id, module_id, resolved_at}` | Admin alerts; autonomy actions; operator escalation | `evt_75837bbdff1c project_idle` for Acme stays `open` indefinitely. Resolution depends on event-specific clear conditions which **for some event types are never re-evaluated** (project_idle requires "project has activity in last N hours" — but project_idle was raised AFTER recent payout activity, so condition is already not met yet event stays open). | event_engine resolves only on **next** matching scan condition — `project_idle` resolver may be missing entirely |
| 17 | **Background loops convergence** | 6 independent loops (`event_engine` 15m, `AUTO_BALANCER` 60s, `AUTONOMY` 4m, `MODULE_MOTION` 15s, `GUARDIAN` 120s, `OPERATOR_SCHEDULER` 5m) | Each loop reads + writes a different subset of fields | Everyone | **No formal ordering invariant.** AUTO_BALANCER can move a module while MODULE_MOTION is computing progress for it; GUARDIAN can pause a module mid-AUTONOMY-action; OPERATOR_SCHEDULER can clear an event AUTO_BALANCER just raised. **Implicit composition of async authorities.** | **NONE** |

---

## 2. Semantic Split-Brain Candidates

Each entry is a verified divergence in the live DB or code. Severity is operational risk.

### S-1. Money state is shattered across 3 collections — **SEVERE**

**Evidence:**
- `dev_work.py:79-82` explicit declaration: SoT = `dev_wallets + dev_earning_log`, "DO NOT read db.payouts here (parallel/legacy collection)"
- 7+ files read `db.payouts` as authoritative for client/admin views
- `escrow_payouts` is a third parallel collection written by `escrow_layer:204`
- For Acme: `payouts` has 3 entries, `dev_wallets` is null, `dev_earning_log` is empty, `escrow_payouts` is empty
- John (assigned dev) sees **$0 earned** in his app
- Client (looking at same modules) sees **$3100 approved + $1200 paid** = $4300 in costs
- Backend has **$0** in canonical wallet ledger

**Why dangerous:** This is not "stale cache" — this is **three independent emitters writing to disjoint sources of truth, each marked authoritative by some part of the system.** Any reconciliation attempt will require picking a winner and re-running every closed payment cycle through it. The longer this persists, the more divergent the histories.

**Authority diagram (current):**
```
mock_seed              ─▶ db.payouts  (read by client/admin/guardian)
client_acceptance.py   ─▶ db.payouts
referral_payouts flow  ─▶ db.payouts
_credit_module_reward  ─▶ db.dev_wallets + db.dev_earning_log  (read by dev_work)
escrow_layer.release   ─▶ db.escrow_payouts
```

Three writers, three readers, **zero bridges**.

### S-2. `paused_by` has 4+ possible string values with no enum + asymmetric resume queries — **HIGH**

**Evidence:**
- Writers: `auto_guardian.py` writes both `"guardian"` AND `"operator"`; `admin_control.py` writes `"admin"`; `client_operator.py` writes `"guardian"` or arbitrary `uid`
- Readers: `admin_control.py:120` resume query filters `paused_by: "admin"` — only matches admin's own pauses
- Acme module 2 (`paused_by="operator"`) and module 3 (`paused_by="guardian"`) are both invisible to admin "resume all"

**Why dangerous:** Modules paused by autonomy or operator UI are **stuck forever** unless someone hand-writes the exact unpause filter for that authority. This is a deadlock-by-vocabulary.

### S-3. `qa_decisions.result` and `modules.qa_status` are independent — **HIGH**

**Evidence:**
- Acme module 1: `modules.qa_status="passed"`, `modules.status="done"`, but the **only** `qa_decisions` entry for that module says `result="rejected"`
- `qa_decisions` is append-only (decision history)
- `modules.qa_status` is mutable (current state)
- No invariant enforces "latest qa_decisions.result must match modules.qa_status"
- `seed_replay_v1` wrote rejections without updating `modules.qa_status` (it ran on top of `mock_seed` which had already set passed)

**Why dangerous:** Anyone showing a QA history to a developer or client (e.g. "your work was rejected on 2026-05-06") presents **contradictory truth** versus the live module state. Bug reports will be impossible to triage because the audit trail and the live state genuinely disagree.

### S-4. `modules.assigned_to` vs `db.module_assignments` — **MEDIUM** (currently latent)

**Evidence:**
- Acme has 3 modules with `assigned_to` set, but **0 rows in `module_assignments` collection**
- code refs to `db.module_assignments` exist (likely intended for history/audit)
- Empty collection means anything reading it sees "nothing assigned" for projects that DO have assignments

**Why dangerous:** Latent. If a future feature reads `module_assignments` (e.g. assignment history for trust scoring), it sees the wrong story. Low blast radius today, becomes high once a consumer mounts.

### S-5. `projects.progress` and `projects.current_stage` derived stored, multi-writer — **MEDIUM**

**Evidence:**
- Acme `progress=55` doesn't match any natural derivation
- 3 different code paths write the field
- `module_motion.py:62` is the "canonical" derivation loop but it's not the only writer
- `current_stage` (`discovery|scope|design|development|qa|delivery|support`) is hand-advanced by various handlers, no machine

**Why dangerous:** Headline numbers shown to client diverge from underlying reality. The "55%" is what the client sees on their dashboard.

### S-6. `events` rows raised but never reconciled — **MEDIUM**

**Evidence:**
- `evt_75837bbdff1c project_idle` open since detection, despite recent payouts on Acme
- event_engine scans only detect-and-create; resolution depends on `_resolve_*` per type
- Acme has live payout activity but the `project_idle` event ignores it

**Why dangerous:** Operator dashboards will be perma-noisy. Admin will train themselves to ignore alerts. The "alert" surface becomes signal-less.

### S-7. `_credit_module_reward` idempotency by `module_id` only — **LOW** (but architectural)

**Evidence:** `server.py:10749` — checks `db.dev_earning_log.find_one({"module_id": module.get("module_id")})` before crediting. One credit per module forever.

**Why dangerous:** If a module is approved, rejected (revision), re-submitted, re-approved — the second approval will **not credit** because the first entry exists. Developer is paid once for a module that took 3 revisions. May be intended (one-payment-per-module policy) but is not stated as a business rule and not protected from accidental re-creation under a different `module_id`.

### S-8. Six async loops with no ordering invariant — **LOW today, foundational**

Already documented in row #17.

---

## 3. The First Truly Dangerous Contradiction

**S-1: Money is stored in three disjoint collections, with three independent writers and three independent readers, and no bridge.**

**Why this one:**
1. It is **live now** — Acme demonstrates it with real numbers (dev sees $0, client sees $4300)
2. It is **business-fatal** — financial inconsistency is the one thing customers cannot forgive
3. It is **self-reinforcing** — every new feature picks one of the three SoT and entrenches divergence further (e.g. `dev_work.py` explicitly *opted out* of `db.payouts` rather than reconciling)
4. It **invalidates audit** — escrow's purpose is to be the canonical integrity gate; current state has 0 escrows for 3 payouts → escrow is **bypassed** by the dominant write path (mock_seed pattern propagated into `client_acceptance`)
5. It **blocks Stage 7 cleanly** — every downstream observability question ("where does money zacomes from?", "did this dev get paid for this work?") cannot be answered without first choosing a winner

**This is the architectural disease that must be named first.** Everything else in the trace (paused_by vocab, qa split, progress drift, event resurrection, loop ordering) is a structurally lighter version of the same pattern: **multiple authorities writing to disjoint surfaces with no bridge**. But money is the load-bearing case where the cost of staying split-brain compounds daily.

---

## 4. What this trace does NOT do (Stage 7 discipline)

- Does **not** propose fixes
- Does **not** suggest a winning SoT for money
- Does **not** prescribe an enum for `paused_by`
- Does **not** sketch reconciliation jobs
- Does **not** redesign event_engine resolution semantics

Naming the contradictions IS the work for this stage. Resolution is later batches (B/C/D from the Stage 7 plan).

---

## 5. Deltas to capture next

When the next trace runs against **`mock_seed` "Mobile App Refresh" + "Internal Ops Tool"** projects (the dirtier data sets), the expected deltas to verify:

1. Does S-1 (money split) hold across non-canonical projects? (Strong prediction: yes, more aggressively — referral_payouts adds a 4th write path)
2. Does S-2 (paused_by) get hit by any seed-replay-generated pause? (Test for `paused_by: <uid>` values in the wild)
3. Does S-3 (qa decision/module disagree) accumulate over the 14-day seed_replay history? (Strong prediction: every module the replay touched)
4. Does S-6 (orphan events) include event types other than `project_idle`?
5. New contradictions surfaced only by dirty data — likely candidates:
   - Currency rounding drift (price vs payout amounts in mock_seed)
   - Developer assigned to modules across multiple paused/active projects (workload computation reliability)
   - QA reviewer is the same person as the developer (self-approval — already evidence: Acme module 1 `reviewer_id` == `assigned_to`)

After dirty-data trace runs, the union of contradictions becomes the input for **B (state normalization)** scoping.

---

## 6. Trace evidence index

All evidence in this document is sourced from:
- Live MongoDB `test_database` snapshot at 2026-05-13 ~22:00 UTC
- `backend/server.py` (revision in `/app`, matches commit `c659417`-era code)
- `backend/dev_work.py:79-82` (explicit SoT declaration)
- `backend/auto_guardian.py:133,193`, `backend/admin_control.py:110,120`, `backend/client_operator.py:75`
- `backend/module_motion.py:62`
- `backend/escrow_layer.py:204`
- `backend/_credit_module_reward` at `server.py:10675`
- `backend/client_acceptance.py:120`

Every cell in the table can be reproduced by:
1. Querying the named collection for the named project
2. Reading the named file at the named line range
3. Diffing observed state against any "canonical" path's expected writes

This trace is reproducible, falsifiable, and bounded. It is execution artifact, not theory.
