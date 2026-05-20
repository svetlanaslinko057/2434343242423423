# Money Writer Inventory + Freeze Plan — Stage 7A.5

**Status:** 📋 LIVE — produced under signed Decisions 1=D, 2=E, 4=A.
**Date:** 2026-05-14
**Stage:** 7A.5 (transition — last Discovery artefact before Stage 7B begins)
**Charter:** `/app/audit/MONEY_AUTHORITY_CHARTER.md`
**Memo:** `/app/audit/MONEY_DECISIONS_2_6_MEMO.md`
**Traces:** `ESCROW_SMOKE_TRACE.md`, `WORK_EXECUTION_SMOKE_TRACE.md`, `WITHDRAWAL_SMOKE_TRACE.md`
**Blast-radius:** `MONEY_BLAST_RADIUS.md`, `blast_radius_clean.json`

This document is **not code, not migration**. It is the exact mutation graph
that gates Stage 7B (controlled freeze + bridge implementation).

> **Operating principle (under signed Decisions):**
>   1. Decision 1=D — Canonical surfaces are split by financial meaning.
>   2. Decision 2=E — Every domain writer MUST bridge to canonical payable
>      (`dev_wallets` + `dev_earning_log`) before its own commit is considered
>      complete. Legacy/audit surfaces continue to exist; canonical must be
>      always populated.
>   3. Decision 4=A — `dev_withdrawals` canonical, `db.withdrawals` orphan
>      (no parallel implementation — freeze writers/readers).
>
>   Bridge ≠ Orchestrator. Bridge = each writer carries the *obligation* to
>   write canonical. Orchestrator = one function owns all writes
>   (Decision 5 / 2.F, deferred).

---

## 1. Authority map (current state under signed decisions)

| Domain | Canonical surface | Audit / per-event record | Legacy / mirror | Frozen / orphan |
|---|---|---|---|---|
| Developer payable balance | `dev_wallets` + `dev_earning_log` | `money_ledger_events` (event_type=earning_*) | `users.total_earnings`, `users.escrow_earnings` (Decision 3 deferred) | — |
| Client billing | `invoices` | `money_ledger_events` (event_type=invoice_paid) | — | — |
| Locked-funds lifecycle | `escrows` | `escrow_payouts` (per-release immutable) + `money_ledger_events` (event_type=escrow_*) | — | — |
| Payout intent (batch) | `dev_withdrawals` | `money_ledger_events` (event_type=payout_*) | — | **`withdrawals`** (Decision 4=A) |
| Work-pipeline domain | `payouts` (root) + `earnings` (root) **with bridge to dev_wallets per 2.E** | (currently none) | — | — |
| Cross-domain audit | n/a | `money_ledger_events` (append-only) | — | — |
| Per-task audit | `task_earnings` | — | — | — |

**Headline change vs Charter §6.1:** `payouts` and `earnings` (root) are no
longer "frozen pending Decision 2" — under Decision 2=E they are
**domain-owned** with a **bridge obligation** to the canonical payable surface.

---

## 2. Writer inventory — exhaustive

### Path A — Approve-Module HTTP (canonical writer of `dev_wallets` + `dev_earning_log`)

| # | Writer site | Collection touched | Mutation | Idempotency guard | Ordering / Retry |
|---|---|---|---|---|---|
| A.1 | `server.py:10754` (`_credit_module_reward`) | `dev_earning_log` | `insert_one({log_id, user_id, module_id, amount, tier, rate, ...})` | **Pre-read** at line 10721 (`find_one({"module_id": id})`) — short-circuits if row exists. **Not unique-index enforced.** Race-prone if `_credit_module_reward` is called concurrently on same module. | None — fire-and-forget |
| A.2 | `server.py:10768` (`_credit_module_reward`) | `dev_wallets` | `$inc earned_lifetime, available_balance` (upsert=True) | Guarded by A.1's short-circuit only | None |

**Callers of `_credit_module_reward`:**
- `server.py:22343` — `client_approve_module` HTTP handler (primary)
- `server.py:23117` — same handler, secondary call (after QA flow)

**Bridge obligation under 2.E:** Path A IS the canonical writer. No external
bridge needed; A.1/A.2 are the bridge target.

**Detector classes that fire if A misbehaves:**
- `wallet_journal_drift` (A.2 ran but not A.1, or A.1 amount ≠ A.2 amount)
- `double_credit_suspected` (A.1 short-circuit failed under concurrency)
- `wallet_balance_equation_broken` (A.2 wrote inconsistent fields)

---

### Path B — Escrow chain (canonical writer of `escrows`, audit writer of `escrow_payouts`)

| # | Writer site | Collection touched | Mutation | Idempotency guard | Ordering / Retry |
|---|---|---|---|---|---|
| B.1 | `escrow_layer.py:77` (`create_escrow`) | `escrows` | `insert_one(doc)` | **Pre-read** at line ~50 (`find_one({"module_id"})`); returns existing if found. Not unique-index enforced. | Called by `money_runtime.on_invoice_paid` and `money_runtime.py:333` |
| B.2 | `escrow_layer.py:117` (`partial_release`) | `escrows` | `$inc released_amount, $set status` | Status predicate in update filter | Fired by `release_escrow` per developer share |
| B.3 | `escrow_layer.py:235` (`release_escrow`) | `escrows` | `$set status, completed_at` | `status != REFUNDED` in update filter | Fired by `on_module_done` |
| B.4 | `escrow_layer.py:280` (`refund_escrow`) | `escrows` | `$set status=refunded, refunded_amount` | Status predicate | Manual + auto-cancellation |
| B.5 | `escrow_layer.py:319` (`fund_escrow`) | `escrows` | `$set status=funded, locked_amount, funded_at` | Status predicate (pending → funded only) | Fired by `money_runtime.on_invoice_paid` |
| B.6 | `escrow_layer.py:204` (`release_escrow`) | `escrow_payouts` | `insert_one({payout_id, escrow_id, module_id, developer_id, amount, ...})` per developer share | Per-release fresh UUID (NOT idempotent across retries) | One insert per developer per release |
| B.7 | `escrow_layer.py:218` (`release_escrow`) | `users` (field `total_earnings` + `escrow_earnings`) | `$inc total_earnings, escrow_earnings` | **None** — no idempotency at all | Side-effect of B.3 |

**Callers of escrow_layer functions:**
- `money_runtime.py:85` → `create_escrow`
- `money_runtime.py:116` → `fund_escrow`
- `money_runtime.py:141` → `release_escrow`
- `money_runtime.py:158` → `refund_escrow`
- `money_runtime.py:333` → `create_escrow` (fallback path)

**`money_runtime.on_module_done_chain` callers:**
- `server.py:23156` (within `client_approve_module`)

**Bridge obligation under 2.E:** Path B writes `escrow_payouts` (audit) and
`users.total_earnings` (legacy mirror) — but **does NOT** write
`dev_wallets`/`dev_earning_log`. Under 2.E the bridge must:
- After B.6 (escrow_payouts insert), invoke the same canonical contract
  as A.1/A.2 — i.e. write `dev_earning_log` (idempotency_key=escrow_payout_id
  OR a composite of module_id + developer_id) AND `$inc dev_wallets`.
- B.7 (`users.$inc total_earnings`) becomes **redundant under bridge**;
  retained as legacy mirror until Decision 3 freeze.

**Detector classes that fire if B has no bridge:**
- `escrow_payouts_orphan` (B.6 ran without canonical write) ← currently fires
- `wallet_not_credited` (B.3 ran without canonical write) ← currently fires
- `legacy_drift_total_earnings` (B.7 wrote but canonical empty) ← currently fires

**Smoke trace #1 evidence:** all three fire today on every escrow-only path.

---

### Path C — Work pipeline (canonical writer of `payouts`/`earnings` root)

| # | Writer site | Collection touched | Mutation | Idempotency guard | Ordering / Retry |
|---|---|---|---|---|---|
| C.1 | `work_execution.py:450` (`qa_pass`, end) | `payouts` (root) | `insert_one({payout_id, developer_id, module_id, amount, status=pending, ...})` | None | Fires when module's last task is approved |
| C.2 | `work_execution.py:656` (`payout_approve`) | `payouts` (root) | `update_one(status=pending → approved)` | Status predicate | Admin action |
| C.3 | `work_execution.py:675` (`payout_mark_paid`) | `payouts` (root) | `update_one(status=approved → paid)` | Status predicate | Admin action |
| C.4 | `work_execution.py:681` (`payout_mark_paid`) | `earnings` (root) | `insert_one({earning_id, developer_id, module_id, amount, status=paid, ...})` | None — could double-insert on retry | Same handler as C.3 |
| C.5 | `work_execution.py:964` (alternative) | `payouts` (root) | `insert_one` (parallel path) | None | Unclear trigger — needs investigation in Stage 7A.6 |
| C.6 | `client_acceptance.py:120` | `payouts` (root) | `insert_one` | None | Module acceptance flow |
| C.7 | `mobile_adapter.py:334` | `payouts` (root) | `insert_one` | None | Mobile module acceptance |

**Bridge obligation under 2.E:** Path C is the most invasive bridge. 5 distinct
insert sites currently write `payouts` (root) without ever touching canonical.
Under 2.E each must, after its own commit, write `dev_earning_log` and
`$inc dev_wallets` for the same developer + module. **Idempotency_key on
canonical write = `payout_id`** (each payout already has a UUID).

**Smoke trace #2 evidence:** Path C fires entirely without canonical touch.
Detector class `payouts_root_orphan` + `earnings_root_orphan` permanent.

**Special concern — C.5 (`work_execution.py:964`):** parallel inline path
inserting `payouts`. Needs trace coverage before Stage 7B can scope it.

---

### Path D — Withdrawal (canonical writer of `dev_withdrawals`; mutates `dev_wallets` via CAS)

| # | Writer site | Collection touched | Mutation | Idempotency guard | Ordering / Retry |
|---|---|---|---|---|---|
| D.1 | `server.py:11049` (`request_withdrawal`) | `dev_wallets` | CAS: `$inc available_balance: -amt, pending_withdrawal: +amt` with `available_balance >= amount - 0.001` predicate | **CAS predicate ensures atomicity** — first-writer-wins | Returns 400 if predicate fails |
| D.2 | `server.py:11087` (`request_withdrawal`) | `dev_withdrawals` | `insert_one({withdrawal_id, user_id, amount, status=requested, ...})` | New UUID per request; D.1 was the lock | If D.2 raises, D.1 is rolled back via D.3 |
| D.3 | `server.py:11090` (`request_withdrawal` rollback) | `dev_wallets` | `$inc available: +amt, pending: -amt` | Only on D.2 failure | Implicit rollback path |
| D.4 | `server.py:11147` (`admin_approve_withdrawal`) | `dev_withdrawals` | CAS: `update_one(status=requested → approved)` | Status predicate | Concurrent admin clicks: first wins |
| D.5 | `server.py:11169` (`admin_mark_withdrawal_paid`) | `dev_withdrawals` | CAS: `update_one(status=approved → paid)` | Status predicate | First-writer-wins |
| D.6 | `server.py:11187` (`admin_mark_withdrawal_paid`) | `dev_wallets` | `$inc pending_withdrawal: -amt, withdrawn_lifetime: +amt` | Guarded by D.5's CAS success (only the row that flipped runs D.6) | Idempotent — only fires once |
| D.7 | `server.py:11210` (`admin_reject_withdrawal`) | `dev_withdrawals` | CAS: `update_one(status IN [requested, approved] → rejected)` | Status predicate | |
| D.8 | `server.py:11224` (`admin_reject_withdrawal`) | `dev_wallets` | `$inc available: +amt, pending: -amt` | Guarded by D.7's CAS success | Idempotent |

**Bridge obligation under 2.E:** None. Path D already writes to the canonical
withdrawal collection AND directly mutates `dev_wallets`. **D is the only
path that has both correctness AND atomicity today.**

**Smoke trace #3 evidence:** Path D is internally consistent.

---

### Path E — Orphan (Decision 4=A — FROZEN)

| # | Writer site | Collection touched | Fate under Decision 4=A |
|---|---|---|---|
| E.1 | `admin_mobile.py:516` (`withdrawal_approve`) | `withdrawals` (orphan) | **FREEZE — Stage 7B PR-4** |
| E.2 | `admin_mobile.py:566` (`withdrawal_reject`) | `withdrawals` (orphan) | **FREEZE — Stage 7B PR-4** |

Path E has no production trigger that ever writes to `db.withdrawals` from
the developer side, so freezing E.1/E.2 has zero behaviour change on the
developer flow. Side effects to review before freeze:
- `_write_audit` call inside E.1/E.2 — admin audit log entries
- `_emit("admin.withdrawal_decided", ...)` event — any subscribers?
- Admin mobile cockpit may have a UI that POSTs to these endpoints — must
  redirect (or remove from UI) before freeze.

---

### Path F — Money ledger (audit chain — Decision 6 pending)

`money_ledger.py:135` is the only direct writer (via `record_event`). 13
production call sites currently invoke it:

| # | Caller | Event type | Idempotency_key |
|---|---|---|---|
| F.1 | `server.py:6067` | invoice_created | invoice_id |
| F.2 | `server.py:6133` | invoice_paid | invoice_id |
| F.3 | `server.py:6198` | invoice_void | invoice_id |
| F.4 | `server.py:11261` | invoice_paid | invoice_id |
| F.5 | `server.py:11274` | (linked) | derived |
| F.6 | `server.py:11440` | invoice_paid (settle path) | invoice_id |
| F.7 | `server.py:11453` | escrow_funded | escrow_id |
| F.8 | `server.py:13613` | invoice_overdue | invoice_id |
| F.9 | `server.py:13633` | invoice_overdue_paid | invoice_id |
| F.10 | `server.py:23125` | qa_approved | module_id |
| F.11 | `server.py:23140` | earning_approved | module_id |
| F.12 | `server.py:23159` | escrow_released | escrow_id OR module_id |
| F.13 | `module_motion.py:179/192/212` | auto-promotion events | module_id |

**Smoke trace #1 finding (revised):** the ledger gap is NOT in
`client_approve_module` HTTP handler — that handler does call F.10–F.12.
The gap is in **non-HTTP entry points** that fire `escrow_layer.on_module_done`
or `_credit_module_reward` directly (e.g. admin force, scheduler retrigger,
module_motion auto-promotion). Those skip F.10–F.12 entirely.

**Bridge obligation for F under 2.E:** none — ledger is audit only. But for
the bridge contract under 2.E to be testable, ledger must be **mandatory on
every canonical write** (Decision 6.A). The recommendation: a single helper
`_canonical_credit(module_id, developer_id, amount, source_path)` that:
1. Inserts `dev_earning_log` (idempotency_key = source-specific)
2. `$inc dev_wallets`
3. Emits `EVENT_EARNING_APPROVED` to ledger

Every bridge under 2.E calls this helper.

---

### Path G — Invoice writers (canonical, multiple)

Invoices have **25+ writer sites** across `server.py`, `money_runtime.py`,
`overdue_engine.py`, `revenue_brain.py`, and seeds. All write to the same
canonical collection (`invoices`) — there is no other "invoice truth"
elsewhere. Authority is clear; the multiplicity is operational complexity,
not architectural fragmentation.

**Bridge obligation under 2.E:** none — invoices ARE the canonical
client-billing surface.

**Pre-Stage-7B inventory completion needed:** classify each of the 25+
sites as "creation" vs "status mutation" vs "settlement". Not blocking
for the bridge work, but blocking for any future invoice refactor.

---

### Path H — Per-task audit (`task_earnings`)

| # | Writer | Mutation |
|---|---|---|
| H.1 | `earnings_layer.py:232` | insert |
| H.2 | `earnings_layer.py:477/573` | status updates |
| H.3 | `payout_layer.py:196/325` | linked to payout transitions |
| H.4 | `qa_layer.py:401/423` | QA decisions |

`task_earnings` is per-task, not per-module. Sits below Path C in the
work pipeline. **Under Decision 2=E it is part of the work-pipeline
domain audit; no bridge obligation** (the bridge is at the module-level
Path C exit, not per-task).

---

## 3. Cross-path coordination matrix (currently informal)

This is the matrix of which paths must coordinate (today via implicit
comments / shared callers, never by structural contract):

| Trigger event | Path A | Path B | Path C | Path D | Path F |
|---|---|---|---|---|---|
| `POST /api/client/modules/{id}/approve` (HTTP) | ✅ fires (A.1/A.2 via 22343 + 23117) | ✅ fires (23156 → release_escrow) | ❌ skipped | ❌ | ✅ fires (F.10–F.12) |
| `module_motion.py` auto-promotion (15s loop) | ❌ skipped | ❌ skipped | ❌ skipped | ❌ | ✅ partial (F.13 only) |
| `POST /api/qa/reviews/{id}/pass` (HTTP) | ❌ skipped | ❌ skipped | ✅ fires (C.1) | ❌ | ❌ |
| `POST /api/admin/payouts/{id}/mark-paid` (HTTP) | ❌ skipped | ❌ skipped | ✅ fires (C.3 + C.4) | ❌ | ❌ |
| `POST /api/developer/withdrawals` (HTTP) | ❌ | ❌ | ❌ | ✅ fires (D.1–D.2) | ❌ |
| `POST /api/admin/withdrawals/{id}/mark-paid` (HTTP) | ❌ | ❌ | ❌ | ✅ fires (D.5–D.6) | ❌ |
| `POST /api/admin/mobile/withdrawals/{id}/approve` | ❌ | ❌ | ❌ | ❌ (Path E orphan) | ❌ |
| Direct `escrow_layer.on_module_done` call (script/admin force) | ❌ skipped | ✅ fires | ❌ | ❌ | ❌ skipped |
| `_credit_module_reward(module)` direct call | ✅ fires | ❌ skipped | ❌ | ❌ | ❌ skipped |

**Observation:** the only trigger that fires all required paths is the
HTTP `client_approve_module` handler. Every other trigger is partial.

**Under Decision 2=E:** the matrix becomes:

| Trigger event | Bridge to canonical fires? | Acceptance criterion |
|---|---|---|
| Any Path A entry | ✅ (already is canonical) | A.1 + A.2 atomic |
| Any Path B entry | ✅ (new bridge after B.6) | B.6 + new bridge to dev_earning_log/dev_wallets atomic |
| Any Path C entry | ✅ (new bridge after C.3/C.4) | C.4 + new bridge to dev_earning_log/dev_wallets atomic |
| Any Path D entry | ✅ (already correct) | D unchanged |
| Path E | n/a | FROZEN |

---

## 4. Idempotency boundary inventory

| Path | Idempotency contract today | Idempotency contract under 2.E |
|---|---|---|
| A.1 (dev_earning_log) | Pre-read by `module_id`; race window | Must move to unique index on `(module_id, source)` to be retry-safe |
| A.2 (dev_wallets $inc) | None — relies on A.1 short-circuit | Should be safe to redo (idempotent only when A.1 has skipped) |
| B.1 (escrow create) | Pre-read by `module_id`; race window | Same |
| B.6 (escrow_payouts) | Fresh UUID — NOT retry-safe | New bridge needs idempotency_key = `payout_id` |
| C.1 (payouts insert) | None — would duplicate on retry | New bridge needs idempotency_key = `payout_id` |
| C.4 (earnings insert) | None | New bridge needs idempotency_key = `payout_id` or `earning_id` |
| D.1–D.2 (withdrawal request) | D.1 CAS predicate | OK |
| D.4 (approve CAS) | Status predicate | OK |
| D.5/D.7 (mark-paid/reject CAS) | Status predicate | OK |
| F (ledger) | `idempotency_key` on `record_event`, unique-by-event-type+key | Already correct; must be enforced on every canonical writer |

**Critical structural gap:** A.1 + B.1 + B.6 + C.1 + C.4 all use pre-read or
no guard. A unique index per logical write is the only retry-safe pattern.
This is the **first concrete code change** required for the 2.E bridge to
be safe — adding the index lets the bridge be invoked with `INSERT ON
DUPLICATE KEY IGNORE` semantics (motor: catch DuplicateKeyError).

---

## 5. Side-effect inventory

For each writer, what fires outside the money domain (events, audit logs,
notifications):

| Writer | Side effects |
|---|---|
| A.1/A.2 | None observed |
| B.1–B.5 | None observed |
| B.6/B.7 | None observed |
| C.1–C.4 | None observed (no event emission) |
| D.1–D.8 | `logger.info(...)` only |
| E.1/E.2 | `_write_audit(...)` + `_emit("admin.withdrawal_decided", ...)` (will be lost on freeze — needs migration plan) |
| F.* | None observed (ledger is itself an audit emission) |

**Stage 7B PR-4 (Path E freeze) blocker:** identify subscribers of the
`admin.withdrawal_decided` event. If any exist, migration is required.

---

## 6. Freeze plan — Stage 7B PR-by-PR breakdown

This is the **gate-by-gate** list. No PR ships until detector confirms
the previous gate's invariant holds for ≥ 24h.

### PR-0 — Pre-bridge safety nets (read-only-equivalent)
- Add unique indexes to support idempotent canonical writes:
  - `dev_earning_log` unique on `(module_id, source_path)` (new field
    `source_path` defaulted to "approve_module" for back-compat).
  - `escrow_payouts` unique on `payout_id` (already UUID, just enforce).
  - `payouts` unique on `payout_id` (already UUID).
- Verify: detector unchanged on baseline + smoke traces.

### PR-1 — Path B bridge (escrow → canonical)
- After `escrow_layer.release_escrow:204` (B.6) inserts per-developer payouts,
  call new helper `_canonical_credit(module_id, developer_id, amount,
  source_path="escrow_release", idempotency_key=escrow_payout_id)`.
- Helper writes A.1 (dev_earning_log) + A.2 ($inc dev_wallets) + F (ledger
  EARNING_APPROVED event).
- Detector criteria for ship:
  - `escrow_payouts_orphan` count → 0 over 24h of live + smoke traffic
  - `wallet_not_credited` count → 0
  - `M2_wallet_journal_drift` count remains 0

### PR-2 — Path C bridge (work pipeline → canonical)
- Same helper at C.1 / C.4 entry points (all 7 sub-sites).
- `idempotency_key = payout_id`.
- Detector criteria for ship:
  - `payouts_root_orphan` count → 0
  - `earnings_root_orphan` count → 0
  - `M3_payouts_root_vs_journal` count → 0 (on new data; legacy seed drift
    OK by `lifecycle_stage` tagging)

### PR-3 — Ledger enforcement (Decision 6.A activation)
- Detector `ledger_missing` severity raised from `info` to `error`.
- Backfill `record_event` calls in `escrow_layer.create_escrow/fund_escrow/release_escrow/refund_escrow` directly (currently only HTTP path emits them).
- Detector criteria for ship:
  - `ledger_missing` count → 0 on smoke trace #1 (escrow path)

### PR-4 — Path E freeze (Decision 4=A activation)
- Remove `admin_mobile.py:501-580` endpoints OR redirect them to operate on
  `dev_withdrawals` with identical predicates as `server.py:11139+`.
- Migrate any UI calls to `/api/admin/mobile/withdrawals/*` → `/api/admin/withdrawals/*`.
- Drop `db.withdrawals` collection AFTER 24h confirms no writers / no readers.

### PR-5 — Legacy mirror freeze (Decision 3.B activation, gated by PR-1)
- After PR-1 has run for ≥ 7 days with `wallet_not_credited` = 0 and
  `M1_legacy_signal_without_wallet` not increasing.
- Remove `escrow_layer.py:218` `$inc total_earnings, escrow_earnings`.
- Migrate readers `server.py:15241/15256/20075/20085/20230/20240` to read
  `dev_wallets.earned_lifetime` (one-line changes each).
- Drop fields from user document.

### PR-6 — Orchestrator (Decision 5, deferred)
- Only AFTER PR-1 through PR-5 ship + detector clean for 14 days.
- Single `settle_module(module_id, source_path)` function owns all bridges.
- Existing writers become thin shims that call the orchestrator.

---

## 7. What this freeze plan explicitly does NOT do

- ❌ Touch any writer in this session.
- ❌ Migrate any data.
- ❌ Drop any collection.
- ❌ Add unique indexes (PR-0 is documented, not executed here).
- ❌ Change detector severity (PR-3 documented, not executed).
- ❌ Remove `admin_mobile` endpoints (PR-4 documented, not executed).
- ❌ Touch `users.total_earnings` `$inc` (PR-5 documented, not executed).
- ❌ Introduce an orchestrator (PR-6 deferred).

Stage 7A.5 closes here. Stage 7B starts with PR-0 once the owner signs off
on this plan.

---

## 8. Gating checklist (Stage 7A.5 → Stage 7B)

- [x] Decision 1 = D signed
- [x] Decision 2 = E signed
- [x] Decision 4 = A signed
- [x] Writer inventory exhaustive (Sections 2 + 3)
- [x] Idempotency boundary map (Section 4)
- [x] Side-effect inventory (Section 5)
- [x] Freeze plan PR-by-PR (Section 6)
- [ ] **Inventory completion gate** — investigate `work_execution.py:964`
  (C.5, parallel inline path). Cannot ship PR-2 until this path is traced.
- [ ] **Side-effect subscriber audit for `admin.withdrawal_decided`** —
  blocks PR-4 sign-off.
- [ ] **PR-0 sign-off** — owner signs the index-additions PR.
- [ ] Detector live ≥ 7 days under non-smoke traffic (carries through PR-0).
- [ ] PR-1 sign-off (Path B bridge).
- [ ] PR-2 sign-off (Path C bridge).
- [ ] PR-3 sign-off (Ledger enforcement + Decision 6.A).
- [ ] PR-4 sign-off (Path E freeze + Decision 4=A activation).
- [ ] PR-5 sign-off (Decision 3.B activation).
- [ ] PR-6 sign-off (Decision 5 = 2.F upgrade).

---

## 9. Outstanding micro-traces required before Stage 7B

| Trace | Purpose | Gates which PR |
|---|---|---|
| Trace `work_execution.py:964` | Identify the alternative Path C path | PR-2 |
| Trace `admin.withdrawal_decided` event subscribers | Quantify Path E migration scope | PR-4 |
| 24h dry-run with index additions on staging | Verify PR-0 is no-op for behaviour | PR-0 |
| `module_motion.py` partial-fire audit | Today the loop only writes F.13 ledger events without canonical writes — confirm this is bypass-by-design vs gap | PR-1, PR-3 |

These are all read-only / observation-only. They are **not** Stage 7B
writer changes.

---

## 10. Operating principle re-statement

We are now operating under **three signed architectural decisions**:

> 1. **The money domain has multiple canonical surfaces by financial meaning.**
>    Not one ledger of truth, but a *map* of truths.
> 2. **Every domain writer must bridge to canonical payable before its
>    own commit is considered complete.** Local writes remain; canonical
>    cannot remain silent.
> 3. **The withdrawal split-brain is an orphan branch, not a parallel
>    implementation.** Freeze, don't preserve.

The freeze plan in Section 6 is the smallest sequence of PRs that gets us
from the current state to a state where:
- All four execution paths credit the canonical wallet (PR-1 + PR-2).
- The ledger is reliable audit (PR-3).
- The orphan branch is gone (PR-4).
- The legacy mirror is gone (PR-5).
- Optionally, a single orchestrator owns everything (PR-6).

That is Stage 7B's work. This document is its precondition.
