# Work-Execution Smoke Trace #2 — second money execution path observed

**Date:** 2026-05-14
**Stage:** 7A (Discovery)
**Charter:** `/app/audit/MONEY_AUTHORITY_CHARTER.md`
**Prior trace:** `/app/audit/ESCROW_SMOKE_TRACE.md`
**Trace data:** `/app/audit/work_execution_smoke_trace_baseline.json`
**Script:** `/app/scripts/work_execution_smoke_trace.py`
**Run ID:** `66c03936`

---

## Purpose

The escrow smoke trace (#1) revealed that `release_escrow` writes ONLY to
`escrow_payouts` + `users.total_earnings` and **never touches the canonical
wallet**. To unlock Decision 2 (intent semantic of `payouts`/`earnings` root)
and to verify whether the WORK pipeline behaves differently, this trace fires:

    task.in_progress → task.complete → qa.review pending → qa.passed
                    → module.done → payouts.insert (pending)
                    → admin approve → admin mark-paid → earnings.insert

…using the EXACT control flow from `work_execution.py`
(qa_pass at line 409, payout_approve at 563, payout_mark_paid at 663). Detector
snaps the state after every transition.

## What this trace does NOT do

- ❌ Modify any writer
- ❌ Call any escrow_layer function (deliberately — this is the parallel pipeline)
- ❌ Call `_credit_module_reward` (the canonical-wallet writer)
- ❌ Fix anything

Pure observation, parallel to trace #1.

---

## Stepwise readings

| Step | task | qa | module | payouts# | payouts.status | earnings# | log_rows | wallet | total_earnings | ledger | classes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| T0 — seeded | in_progress | — | in_progress | 0 | [] | 0 | 0 | — | 0 | 0 | (none) |
| T1 — task complete + qa pending | review | pending | in_progress | 0 | [] | 0 | 0 | — | 0 | 0 | (none) |
| T2 — qa.pass → module.done → payouts.insert | done | passed | **done** | **1** | [pending] | 0 | 0 | — | 0 | 0 | **`payouts_root_orphan`** |
| T3 — admin approve | done | passed | done | 1 | [approved] | 0 | 0 | — | 0 | 0 | `payouts_root_orphan` |
| T4 — admin mark-paid + earnings.insert | done | passed | done | 1 | [paid] | **1** | **0** | — | **0** | **0** | `payouts_root_orphan`, **`earnings_root_orphan`** |
| T5 — settled | done | passed | done | 1 | [paid] | 1 | 0 | — | 0 | 0 | (permanent) |

(Notation: `wallet = —` means `dev_wallets` row does not exist for this developer.)

---

## What this proves — the headline finding

The work_execution pipeline writes **EXCLUSIVELY** to:

| Collection | Touched | Value at T5 |
|---|---|---|
| `payouts` (root) | ✅ | $1500 status=paid |
| `earnings` (root) | ✅ | $1500 status=paid |
| `tasks` | ✅ | task.status flow |
| `qa_reviews` | ✅ | review.status flow |
| `modules` | ✅ | status=done |
| **`dev_wallets`** (canonical) | **❌** | row does not exist |
| **`dev_earning_log`** (canonical journal) | **❌** | 0 rows |
| **`escrows`** | **❌** | 0 rows |
| **`escrow_payouts`** (audit) | **❌** | 0 rows |
| **`users.total_earnings`** (legacy mirror) | **❌** | 0 |
| **`money_ledger_events`** (audit) | **❌** | 0 |

**The work pipeline is its own complete, self-contained money path. It bypasses
not only the canonical wallet but also the escrow chain, the legacy mirror,
and the audit ledger. All five "other places" remain at zero while the work
pipeline declares $1500 paid.**

---

## Combined picture from trace #1 + trace #2

The system has been demonstrated to contain **THREE independent money
execution paths**, each writing to a disjoint subset of collections:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Path A — Approve-Module HTTP (canonical, Decision 1=D)              │
│   _credit_module_reward (server.py:10675)                           │
│   writes: dev_earning_log + dev_wallets                             │
│   triggered by: POST /api/client/modules/{id}/approve               │
│   ⚠️  Observed in NEITHER smoke trace — no script-callable shortcut │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ Path B — Escrow Chain (Smoke trace #1)                              │
│   escrow_layer.release_escrow (escrow_layer.py:155)                 │
│   writes: escrow_payouts + users.$inc total_earnings                │
│   triggered by: on_module_done, _money_runtime.on_module_done_chain │
│   NEVER writes: dev_wallets, dev_earning_log, ledger                │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ Path C — Work Pipeline (Smoke trace #2)                             │
│   work_execution.qa_pass / payout_approve / payout_mark_paid        │
│   writes: payouts (root) + earnings (root)                          │
│   triggered by: POST /api/qa/reviews/{id}/pass + admin actions      │
│   NEVER writes: dev_wallets, dev_earning_log, escrow_payouts,       │
│                 users.total_earnings, ledger                        │
└─────────────────────────────────────────────────────────────────────┘
```

**Three paths. Five disjoint write targets. Zero overlap. No shared
orchestrator. No mutual idempotency.** Whichever path fires for a given
module decides which surface gets the money. The detector classes
(`payouts_root_orphan`, `escrow_payouts_orphan`, `wallet_not_credited`) are
exactly the runtime fingerprints of which path fired.

---

## Decision-level conclusions

### Decision 2 — `payouts`/`earnings` (root) intent semantic — REJECTED

The recommendation in the memo was **2.B — domain-owned intent record**, on
the hypothesis that `payouts (root)` represents pre-settlement intent.

**This trace falsifies that hypothesis.** The work pipeline:
- Inserts `payouts` with `status=pending` at T2 (looks like intent — OK)
- Transitions through `status=approved` at T3 (still looks like intent)
- Transitions to `status=paid` at T4 — **inserts `earnings.amount=$1500`
  status=paid** — and STOPS THERE. There is no second-stage settlement that
  reaches the canonical wallet.

i.e. from the work pipeline's point of view, **`payouts.status=paid + earnings.status=paid`
IS the settlement.** It is not an "intent waiting to be settled by escrow or
wallet" — it is the final state. The pipeline does not believe a canonical
wallet exists.

**Revised recommendation for Decision 2 (still non-binding):**
- **2.D — Work pipeline is a third canonical surface, NOT intent.** Under
  Decision 1=D's "split authority by financial meaning", the work pipeline
  is its own canonical domain ("work-settled money via QA path") parallel to
  the escrow domain. This means:
  - `payouts` (root, status=paid) IS canonical for "QA-settled money".
  - `earnings` (root) IS the audit record for QA-settled releases.
  - The wallet (`dev_wallets`) is canonical only for "approve-module-settled
    money" — a third, separate domain.
- This is **structurally honest** but **operationally untenable**: a developer
  can be paid via path A, B, or C, and the "total earned" question has three
  different answers.
- **Real Decision 2** must therefore choose between:
  - **2.E — Consolidate.** Pick one canonical, route the other two through
    a bridge that writes the canonical. (Big change. Decision 5 territory.)
  - **2.F — Tri-domain.** Formally declare three canonical money domains
    with separate semantics and require all UI / API to label which domain
    a number comes from. ("$1500 earned in QA pipeline, $1000 released from
    escrow, $5020 credited via approve-module" — never summed.)

This is now a **product-and-architecture decision**, not a code decision.

### Decision 5 — module-done orchestrator — REINFORCED

Recommendation was **5.A — single orchestrator**. This trace makes the
recommendation stronger:
- It is not enough to make `_credit_module_reward` always fire with
  `release_escrow`.
- It must ALSO fire with `work_execution.qa_pass` (the path that writes
  `payouts (root)`).
- i.e. the orchestrator must own **all three paths** to be useful.

Otherwise Path C will continue to bypass canonical wallet exactly as Path B
does today.

### Decision 6 — ledger role — UNCHANGED

`money_ledger_events` stayed at 0 throughout both traces. The ledger is
ornamental on every observed canonical path right now. Recommendation 6.A
(mandatory audit) stands, with the order: implement orchestrator first
(Decision 5), then bolt ledger calls into the orchestrator.

### Decisions 3 and 4 — UNCHANGED

Neither trace touched `withdrawals`, `dev_withdrawals`, or
`users.total_earnings` mass at scale. Decision 4 still needs a withdrawal
smoke trace. Decision 3 still gated by Decision 5.

---

## Headline data points to put on the table

> **Same developer, $1500 of work, $0 in the canonical wallet.**

Per Decision 1=D, the canonical wallet is the SSOT of "what this developer earned".
The work pipeline fully settled $1500 to this developer at the source-of-truth
level it knows about (`payouts.status=paid` + `earnings.status=paid`). The
canonical wallet has no row for this developer at all.

This is the **runtime signature of "canonical declared ≠ canonical executed"**
that the smoke trace was built to detect. Found it on the first run.

---

## Cleanup

```
python3 /app/scripts/work_execution_smoke_trace.py --cleanup
```
