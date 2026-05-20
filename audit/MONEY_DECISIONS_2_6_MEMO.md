# Money Decisions 2–6 — Decision Memo

**Status:** 📋 DRAFT — awaiting owner sign-off per decision.
**Stage:** 7A (Discovery, ongoing observation)
**Date:** 2026-05-14
**Charter:** `/app/audit/MONEY_AUTHORITY_CHARTER.md`
**Decision 1 (signed):** Option D — split authority by financial meaning
**Runtime evidence:** `/app/audit/ESCROW_SMOKE_TRACE.md` + `/app/audit/escrow_smoke_trace_baseline.json`

This memo is **not a sign-blind list of options**. Each decision has:
1. The question
2. Current evidence (code + runtime)
3. Options
4. Recommendation (audit-side, non-binding)
5. Required follow-up if signed
6. What is still missing before this decision can be signed

No writer changes. No reconciliation. Memo only.

---

## Decision 2 — Status of `payouts` (root) and `earnings` (root)

### Question

Are these two top-level collections:
- (a) **canonical for a parallel domain** ("payouts pipeline" separate from
   escrow lifecycle), or
- (b) **legacy/duplicate** of `escrow_payouts` + `dev_earning_log`, to be frozen?

### Evidence

**Writers** (Charter §3 + grep confirmed):
- `payouts.insert_one` — `client_acceptance.py:120`, `mobile_adapter.py:334`,
  `work_execution.py:450/964`, `work_execution.py:656/675` (updates),
  `server.py:9646` (seed)
- `earnings.insert_one` — `work_execution.py:681`

**Readers** (≥ 7 sites):
- `auto_guardian.py:54`, `admin_production.py:49`, `admin_risk.py:79`,
  `client_workspace.py:120`, `client_operator.py:108`,
  `client_operator_opportunities.py:95`, `money_runtime.py:253/254`,
  `work_execution.py:256/533`, `mobile_adapter.py:493`,
  `developer_intelligence.py:520`, `etap3_routes.py:456`

**Runtime evidence:**
- Detector baseline: `john@atlas.dev` shows `payouts(root)=$3100` vs
  `dev_earning_log=$5020` → $1920 unaccounted. Two collections, one developer,
  two different numbers.
- Smoke trace: the escrow chain (T1 + T2) did NOT write to `payouts` or
  `earnings` at all. These are populated only by the work-submission path,
  not the escrow lifecycle.

### Interpretation

`payouts` (root) and `earnings` (root) carry a **separate semantic**:
"work-pipeline payout intent" (submission-time, pre-QA, pre-escrow-release).
They are NOT duplicates of `escrow_payouts`. They sit one stage earlier in
the lifecycle:

```
work_submitted → payouts (root) row created (intent)
       ↓
   QA approves
       ↓
escrow released → escrow_payouts row (settlement)
       ↓
client_approve_module → dev_earning_log + dev_wallets (canonical credit)
```

Under Decision 1=D the **settled-money truth is `dev_wallets`**. `payouts`
(root) is the **intent record** at work-submission time. They will not equal
in any state except after full settlement of every intent.

### Options

- **2.A — Freeze.** Stop new writes; rewire readers to `dev_earning_log`/`escrow_payouts`. **Blast radius: 11+ reader files.** Loses the "work-submission intent" semantic — readers that need pre-QA visibility will have to read from `task_earnings` or `work_units`.
- **2.B — Domain-owned (intent record).** Keep canonical at the **intent layer**: each `payouts` row is the immutable record of "work_execution.submit fired; here is the intended amount". Detector lowers its `payouts_root_*` divergence severity from `info` to `ok` when wallet has already settled — the discrepancy is **expected** between intent and settlement.
- **2.C — Hybrid.** Add explicit `lifecycle_stage: "intent" | "released" | "settled"` field to each row; detector reads it and only flags divergence when stage mismatches lifecycle.

### Recommendation (non-binding)

**2.B — domain-owned, intent semantic.**

`payouts` and `earnings` are not duplicates — they record a different fact:
"work was submitted and there is an intent to pay X". This fact has business
value (developer-facing pipeline visibility, admin work-acceptance reviews)
and freezing it loses that visibility for marginal cleanup gain.

The detector classes `payouts_root_orphan` and `payouts_root_drift_dev` will
be **relaxed to `info`-severity always** under 2.B, because intent ≠ settled
is the rule, not the exception. The error case becomes "payouts row exists
but lifecycle says intent should be cleared" — a different classifier.

### Required follow-up if signed (2.B)

1. Add `lifecycle_stage` field to new `payouts`/`earnings` writes (additive,
   no break for old rows).
2. Update detector classifications to consume `lifecycle_stage`.
3. Document in `payout_layer.py` docstring that `payouts` (root) is the
   **intent record**, NOT the settlement record.
4. Update `auto_guardian` and other readers to honour intent vs settled
   when computing "is this developer waiting on money".

### What is still missing before signing

- A **second smoke trace** through `work_execution.submit` → `payouts.insert`
  to verify the intent semantic at runtime. Smoke trace from this session
  only covered the escrow branch.
- Decision on whether `task_earnings` (separate from both `earnings` root
  and `dev_earning_log`) is also intent-or-settled. It is currently written
  by `qa_layer.py` + `earnings_layer.py` + `payout_layer.py` — three writers,
  ambiguous semantic. Needs separate trace.

---

## Decision 3 — Fate of `users.total_earnings` / `users.escrow_earnings` fields

### Question

Are these legacy mirror fields:
- (a) **frozen** — stop the `$inc`, redirect reads to `dev_wallets`?
- (b) **maintained mirror** — keep `$inc`, add a sync projection from `dev_wallets`?
- (c) **deleted** outright?

### Evidence

**Writers:**
- `escrow_layer.release_escrow:218` — `$inc total_earnings, escrow_earnings`.
  This is the **only production writer** to `total_earnings` outside of seeds.
- Tests already enforce `users.total_earnings <= dev_wallets.earned_lifetime + 0.01`
  (`test_money_stabilization.py:167`) — i.e. tests document this as a legacy mirror.

**Readers:**
- `server.py:15241/15256` — admin user list payload includes `total_earnings`
- `server.py:20065-20240` — **leaderboard endpoints** sort by `total_earnings`
- (No readers found for `escrow_earnings` outside of admin debug)

**Runtime evidence:**
- Detector: `john@atlas.dev` shows `total_earnings=$0` while `wallet=$5020`.
  Mirror is fully stale (seed wrote wallet but not the mirror).
- Smoke trace T2: `total_earnings` went $0 → $1000 while `wallet` stayed
  undefined. **`total_earnings` is currently the ONLY persistent record
  outside `escrow_payouts` of the released money on the escrow-only path.**

### Interpretation

This is the **most dangerous decision**. The smoke trace proves that under
the current writer layout, `users.total_earnings` carries **load-bearing
financial signal** that nothing else carries:

- When the escrow path fires without `_credit_module_reward`, the wallet is empty.
- The leaderboard reads `total_earnings`. If we freeze the `$inc`, the leaderboard
  (and every other reader) will silently zero-out developers whose money came
  via the escrow-only path.

**Decision 3 is gated by Decision 5.** Until the orchestrator guarantees
`dev_wallets` is credited on every release, `total_earnings` cannot be frozen
without losing signal.

### Options

- **3.A — Freeze now.** Hard-stop `$inc` in `escrow_layer.release_escrow:218`. Repoint readers to `dev_wallets.earned_lifetime`. ⚠️ DANGEROUS — breaks every developer credited only via escrow path until Decision 5 ships.
- **3.B — Freeze AFTER Decision 5.** Ship Decision 5 first (orchestrator always credits wallet on release). Then `total_earnings` becomes truly redundant; freeze in a follow-up PR.
- **3.C — Maintain as projected mirror.** Add a startup hook + per-write sync that keeps `total_earnings = wallet.earned_lifetime` by reading the wallet. Mirror becomes a derived field, not a primary writer.

### Recommendation (non-binding)

**3.B** — freeze, but only after Decision 5 is implemented and verified by
the divergence detector going to zero on `wallet_not_credited` for ≥ 7 days
under live load.

Do NOT sign 3.A. Smoke trace proves this would silently truncate developer
earnings on the escrow-only path.

### Required follow-up if signed (3.B)

1. Sign Decision 5 first.
2. After Decision 5 implementation, run detector for 7 days; if `wallet_not_credited`
   count stays at 0, schedule the `$inc` removal as a separate PR.
3. Migrate `server.py:15241/15256` and the leaderboard (`server.py:20065+`)
   to read `dev_wallets.earned_lifetime`. One-line changes; verified by
   detector.
4. After three more clean detector days, drop the fields from the user
   document (separate PR, idempotent backfill).

### What is still missing

- A measurement of HOW MANY production developers have `total_earnings > 0` but
  `dev_wallets.earned_lifetime = 0`. Detector already produces this per-user;
  needs to be aggregated into the decision file before signing.

---

## Decision 4 — `withdrawals` vs `dev_withdrawals`

### Question

Two collections, both written. Which is canonical? The other must be frozen
and its readers rewired.

### Evidence

**Writers:**
- `dev_withdrawals.insert_one` — `server.py:11087` (developer requests withdrawal)
- `dev_withdrawals.update_one` — `server.py:11147/11169/11210` (developer cancels, admin processes)
- `withdrawals.update_one` — `admin_mobile.py:516/566` (admin approve/reject from mobile admin cockpit)

**Readers:**
- `dev_withdrawals` — server.py (status checks, history), developer profile
- `withdrawals` — admin_mobile only

### Interpretation

This is almost certainly a **partial rename / typo migration** that never
completed:
- The developer-facing CRUD writes `dev_withdrawals`.
- The admin mobile cockpit writes `withdrawals` (different collection,
  different rows).
- An admin who approves a withdrawal via the mobile cockpit updates rows in
  `withdrawals` that the developer-side never reads. Conversely the developer's
  pending withdrawal sits in `dev_withdrawals` until the admin's update to
  `withdrawals` notices it.

Net effect: **admin-mobile approvals do not propagate to the developer view**.
This is the same split-brain S-1 pattern at the withdrawal level.

### Runtime evidence

Detector caught the symptom on `john@atlas.dev`:
- `wallet.withdrawn_lifetime = $3800` but `Σ dev_withdrawals(paid).amount = $0`.
  (Seed shortcut, but same shape: wallet "knows" $3800 left, no per-row record
  on the developer side.)

### Options

- **4.A — Canonical = `dev_withdrawals`** (developer-side). Freeze `withdrawals`. Migrate `admin_mobile.py:516/566` to operate on `dev_withdrawals` by `withdrawal_id`.
- **4.B — Canonical = `withdrawals`**. Less likely — developer writers are larger.
- **4.C — Document both as legacy, build a unified `payout_intents` collection.** Larger scope; out of Stage 7A.

### Recommendation (non-binding)

**4.A — canonical = `dev_withdrawals`.** Smallest blast radius (2 admin_mobile
sites vs 4+ developer sites). The admin mobile cockpit is the wrong one to
preserve here because it's the smaller surface and the scope-freeze document
already declares mobile admin as cockpit-only — feature parity is not a goal.

### Required follow-up if signed (4.A)

1. `admin_mobile.py:516` and `:566` — replace `db.withdrawals` with `db.dev_withdrawals`.
2. Verify by running smoke: developer requests withdrawal via developer
   endpoint → admin approves via admin mobile endpoint → developer endpoint
   reads `status=approved`. Today this would fail.
3. Drop `withdrawals` collection after 7 detector-clean days.
4. Add a row to the detector: `withdrawals_collection_split_brain` (info,
   counts rows present in `withdrawals` but not mirrored in `dev_withdrawals`).

### What is still missing

- A smoke trace covering the withdrawal flow (request → admin approve →
  mark paid) through both endpoints, with detector reading in between.

---

## Decision 5 — Module-done trigger consolidation (orchestrator)

### Question

Today three paths fire on module-done. Should there be **one orchestrator**
that fires the canonical chain, with the others reduced to call-throughs?

### Evidence

Three independent firing paths:
1. **`_credit_module_reward`** — called from `server.py:22338, 23117`
   (within `client_approve_module` HTTP handler)
2. **`_money_runtime.on_module_done_chain`** — called from `server.py:23156`
   (same HTTP handler, side by side with #1)
3. **`module_motion.py:179/192/212`** — auto-promotion path; writes
   `money_ledger_events` directly but does NOT call `_credit_module_reward`
   or `release_escrow`.

The "comment-coordination" between #1 and #2 (`escrow_layer.py:209`) is the
only thing preventing double-credit today. It breaks the moment one fires
without the other.

### Runtime evidence

**Smoke trace T2 is the proof.** Firing only `release_escrow` (which is
exactly what `_money_runtime.on_module_done_chain` does) without
`_credit_module_reward` produced:
- $1000 in `escrow_payouts` ✅
- $1000 in `users.total_earnings` (legacy mirror) ✅
- **$0 in `dev_wallets`** ❌
- 0 rows in `dev_earning_log` ❌

The canonical wallet was bypassed. This is the **structural rupture** between
Decision 1=D's authority map and the actual writer fan-out.

### Options

- **5.A — Single orchestrator function** `on_module_settled(module_id)` that
  calls (in order, idempotent): `release_escrow` → `_credit_module_reward` → `money_ledger.record_event`.
  All three current call sites (`client_approve_module`, `module_motion`,
  any future scheduler) call only this function.
- **5.B — Merge `_credit_module_reward` INTO `release_escrow`.** Eliminates
  the parallel-writer entirely. Risk: dynamic pricing logic (tier × client_price)
  currently in `_credit_module_reward` would have to move into the escrow
  module, blurring escrow's narrow purpose.
- **5.C — Keep current layout but add a guarded wrapper** that detects
  partial fires and refuses to commit until both have run successfully.
  Atomic-write semantics on MongoDB — harder, less reliable.

### Recommendation (non-binding)

**5.A — single orchestrator.** Minimum blast radius. Preserves the narrow
purpose of `escrow_layer` (lifecycle of locked funds) and `_credit_module_reward`
(pricing math + wallet credit). The orchestrator is the **only** code that
knows both must fire together.

### Required follow-up if signed (5.A)

1. Create `backend/money_orchestrator.py` with one function `settle_module(module_id)`.
2. Replace the three call sites with one call each.
3. Detector must show `wallet_not_credited` count → 0 over ≥ 7 days under
   live load before this PR is considered shipped.

### What is still missing

- Ordering decision: does the orchestrator credit wallet BEFORE or AFTER
  release_escrow? Today `_credit_module_reward` runs idempotency-guarded by
  module_id (per `server.py:10749`); `release_escrow` runs idempotency-guarded
  by escrow status. Order matters for failure-mode analysis (which one is
  "left orphaned" if the second fails). Needs explicit decision in the PR.

---

## Decision 6 — Role of `money_ledger_events`

### Question

Is the ledger:
- (a) **audit-only**, parallel to canonical balances?
- (b) **the canonical authority** (Option C from Charter §6, now rejected via Decision 1=D)?
- (c) **future event-source**, gated by a separate decision?

### Evidence

**Self-declaration:** `money_ledger.py:5` reads
> "Single source of truth for the money flow."

**Runtime evidence:**
- Smoke trace T1 (paid + funded): **0 ledger events written** for invoice or escrow lifecycle.
- Smoke trace T2 (released): **0 ledger events written**.
- Detector overview baseline: 6 of 6 modules with money activity had `ledger_missing`.

The ledger module's docstring is **contradicted by its own writers**: the
canonical chain (`money_runtime.on_invoice_paid`, `fund_escrow`, `release_escrow`,
`_credit_module_reward`) does not call `money_ledger.record_event`. Only
`module_motion.py` (3 sites) and a handful of `server.py` invoice-paid paths
call it; the escrow lifecycle is silent.

### Interpretation

Decision 1=D already eliminated the "ledger as authority" option (rejected
Option C). Decision 6 is the **reduced** question: audit-only OR
future event-source (with an explicit migration path).

The smoke trace proves that **right now the ledger is not even reliable audit**.
Any future "ledger is the truth" claim must first survive a 7-day window
where the canonical chain actually writes to it.

### Options

- **6.A — Audit-only, mandatory.** Every canonical writer MUST emit a
  ledger event. Failure to emit is a detector class
  (`ledger_missing` exists already; upgrade to `error` severity once
  every canonical writer is wired).
- **6.B — Audit-only, opportunistic.** Keep current "best effort" — some
  writers call it, some don't. Detector `ledger_missing` stays `info` only.
- **6.C — Future event-source.** Don't enforce now; gate behind a separate
  Decision 7 + a full event-source migration plan. **Not in scope of Stage 7A.**

### Recommendation (non-binding)

**6.A — audit-only, mandatory.**

The ledger is useful audit infrastructure (idempotent by `event_type +
idempotency_key`, indexed, queryable per entity_id). Making it mandatory
on every canonical writer costs <10 lines per writer and gives Stage 7B
the precondition it needs ("freeze unsafe writes" requires knowing which
writes happened — that's exactly what the ledger answers when complete).

### Required follow-up if signed (6.A)

1. Audit all 4 canonical writers (`_credit_module_reward`, `release_escrow`,
   `fund_escrow`, `on_invoice_paid`) and add `money_ledger.record_event` calls
   with proper `idempotency_key`. ≤ 12 lines of code total.
2. Detector: raise `ledger_missing` from `info` to `error` after 7-day window
   where it stays at zero.
3. Document in `money_ledger.py` docstring that "single source of truth" was
   aspirational; it is **the audit-of-record** under Decision 1=D + Decision 6.

### What is still missing

- A measurement of HOW MANY existing money mutations in production currently
  have no ledger row. Detector counts this per module (`ledger_missing` class).
  Aggregate count is needed for the decision PR.

---

## Cross-cutting: dependency order between decisions

```
Decision 1 (signed) — Authority map
        │
        ├──► Decision 5 (orchestrator) — must precede Decision 3
        │           │
        │           └──► Decision 3 (legacy fields freeze) — gated by 5
        │
        ├──► Decision 6 (ledger role) — independent, can sign in parallel
        │
        ├──► Decision 2 (payouts/earnings legacy) — independent BUT requires
        │     a second smoke trace through work_execution before signing
        │
        └──► Decision 4 (withdrawals vs dev_withdrawals) — independent BUT
              requires a withdrawal smoke trace before signing
```

**Strictly required next actions (no writer changes):**

1. **Smoke trace #2** — `work_execution.submit` path: insert into `payouts`
   + `earnings` (root) + `task_earnings`. Detector reads at each step.
   Establishes the intent-semantic for Decision 2.
2. **Smoke trace #3** — withdrawal request → admin approve via admin_mobile.
   Detector reads at each step. Establishes split-brain for Decision 4.
3. **Aggregate measurement queries** (one-shot, read-only):
   - count(users) with `total_earnings > 0` AND wallet missing
   - count(modules) where `escrow_payouts` rows exist AND `dev_earning_log` rows = 0
   - count(money_ledger_events) per canonical event_type vs count(actual mutations) in last 24h

Only after these three artifacts exist can Decisions 2, 3 (post-5), 4, 5, 6 be
signed with the same rigour as Decision 1.

---

## Sign-off block

| Decision | Recommendation | Required before sign | Owner sign | Date |
|---|---|---|---|---|
| 2 | **SIGNED 2026-05-14 = 2.E (bridge per writer)** — 2.D rejected as architecturally invalid (legitimises split-brain), 2.F deferred until orchestrator inventory exists | DONE | ✅ | 2026-05-14 |
| 3 | 3.B — freeze AFTER Decision 5 | Aggregate measurement of stale-mirror count → **M1 measured 2026-05-14 = 0 in clean seed, 1 in contaminated baseline; smoke trace #1 proves M1>0 on real escrow flow** | ☐ (deferred — gated on Decision 5) | |
| 4 | **SIGNED 2026-05-14 = 4.A** — canonical=`dev_withdrawals`, `db.withdrawals` declared orphan branch (not parallel implementation) | DONE | ✅ | 2026-05-14 |
| 5 | 5.A — single orchestrator **(scope: 4 paths)** — escrow + work-pipeline + approve-module + withdrawal | **DEFERRED to Stage 7B** — orchestrator rewrite requires writer inventory + detector-under-real-traffic + ledger visibility | ☐ (deferred) | |
| 6 | 6.A — audit-only mandatory | M4 measured 2026-05-14: 0 clean / 1/1 contaminated | ☐ (deferred — gated on Decision 5) | |

Each sign-off must reference this memo by date (2026-05-14) and amend the
Charter checklist accordingly.

---

## 2026-05-14 addendum — what changed after first measurement

### Decision 2 — recommendation 2.B is FALSIFIED

The `WORK_EXECUTION_SMOKE_TRACE.md` proved that the work pipeline reaches
**terminal `paid` status** for both `payouts` (root) and `earnings` (root)
without ever invoking the canonical wallet. Therefore `payouts` is NOT an
intent record waiting to be settled — for the work pipeline, **it IS the
settlement**. The "intent semantic" hypothesis is wrong.

**New options for Decision 2 (replacing 2.A/B/C):**

- **2.D — Tri-domain (status quo formalised).** Declare three canonical
  surfaces: approve-module → wallet, escrow → escrow_payouts+legacy,
  QA-work-pipeline → payouts+earnings. All three are equally canonical,
  separate domains, NEVER summed. UI must label each.
  - Pro: minimal code change.
  - Con: "developer total earnings" question has no answer.

- **2.E — Consolidate via bridge.** Pick canonical (wallet, per Decision 1).
  Every other writer adds a final step that ALSO writes the canonical via
  a thin bridge function. Each writer keeps its primary collection (audit/
  legacy) but the canonical is always populated.
  - Pro: preserves Decision 1=D intent, no orphan paths.
  - Con: bridge code in 5 writer sites.

- **2.F — Orchestrator-owned.** Decision 5's orchestrator owns the canonical
  credit, and ALL three paths reduce to call-throughs into it. Existing
  collections (`payouts`, `earnings`, `escrow_payouts`) become audit
  emissions of the orchestrator.
  - Pro: cleanest authority model.
  - Con: largest blast radius — touches all three pipelines.

Audit-side recommendation (non-binding): **2.E** — bridge per writer is the
smallest blast radius that honours Decision 1=D without forcing an
orchestrator rewrite. Decision 5 can then independently choose between
"keep three writers + bridges" and "merge into orchestrator" once the
bridge is in place and detector → 0.

### Decision 5 — reinforced

Original scope was "consolidate the two paths on module-done". After smoke
trace #2, there are **three paths**, not two. Decision 5 must explicitly
state which paths it owns. Recommendation 5.A is unchanged but its scope
must now include the work_execution path.

### Decision 6 — sized

M4 reading = 1/1 = 100% of observed canonical-chain mutations have zero
ledger coverage. This is the strongest empirical case for 6.A (audit
mandatory) — there is nothing to lose, no existing ledger users to break.

### Decisions 3 + 4 — unchanged

M1=1 confirms 3.B (gated freeze) is the safe path.
Decision 4 still gated on smoke trace #3.
