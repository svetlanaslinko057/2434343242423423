# PR-0 Acceptance Report — Constraint Enforcement Layer

**Date:** 2026-05-14
**Stage:** 7B / PR-0 (execution closed)
**Signed scope:** /app/audit/MONEY_WRITER_INVENTORY_ADDENDUM_2026-05-14.md §D, §E
**Execution constraints:** strictly per user-signed allowlist
**Artefacts:** /app/audit/pr0_artefacts/

---

## 1. Mutations applied (the only writes in PR-0)

| # | Collection | Action | Affected | Status |
|---|---|---|---|---|
| 1 | `dev_earning_log` | `update_many({"source_path": {"$exists": False}}, {"$set": {"source_path": "approve_module"}})` | 6 rows matched, 6 modified | ok |
| 2 | `dev_earning_log` | `create_index([("module_id", 1), ("source_path", 1)], unique=True)` | new index `dev_earning_log_module_source_unique` | created |
| 3 | `escrow_payouts` | unique on `payout_id` — pre-existing | existing `payout_id_1` already unique | **preexisting_ok** (convergence point, no mutation) |
| 4 | `payouts` | `create_index("payout_id", unique=True)` | new index `payouts_payout_id_unique` | created |

**Forbidden actions performed: zero.**
- No duplicates deleted.
- No rows merged.
- No retry wrappers.
- No catch-and-continue.
- No auto-heal migrations.
- No topology-changing writes.
- No detector suppression.
- No smoke artefact modification.
- No baseline hash re-write.

---

## 2. Three-measurement isolation table

To distinguish PR-0 effect from smoke-rerun side-effect, the same blast_radius
metric set was captured three times in this execution session:

| Measurement | Captured by | Captured when |
|---|---|---|
| [A] PRE | `pr0_execute.py:capture_state("pre")` → `state_pre.json` | Before any PR-0 mutation |
| [B] POST | `pr0_complete.py:capture_state("post")` → `state_post.json` | Immediately after all 3 indexes + backfill in place |
| [C] POST + smoke | `money_divergence.py blast-radius` → `blast_radius_postPR0.json` | After 3 smoke trace re-runs |

### 2.1 Detector class distribution (E.3.5)

| Detector class | [A] pre | [B] post | [C] +smoke | PR-0 effect | Smoke effect |
|---|---|---|---|---|---|
| M1 legacy_signal_without_wallet | 0 | 0 | 0 | ✓ unchanged | ✓ unchanged |
| M2 wallet_journal_drift | 0 | 0 | 0 | ✓ unchanged | ✓ unchanged |
| M3 payouts_root_vs_journal | 1 | 1 | 1 | ✓ unchanged | ✓ unchanged |
| M4 escrow_releases_without_ledger | 0 | 0 | **1** | ✓ unchanged | ✗ drift (smoke residue) |
| M5 payout_intents_never_settled | 3 | 3 | 3 | ✓ unchanged | ✓ unchanged |
| M6 modules_done_without_canonical_credit | 0 | 0 | 0 | ✓ unchanged | ✓ unchanged |

### 2.2 Carrier mass (E.3.1)

| Carrier | [A] pre | [B] post | [C] +smoke | PR-0 effect | Smoke effect |
|---|---|---|---|---|---|
| dev_earning_log_sum | 5020.0 | 5020.0 | 5020.0 | ✓ unchanged | ✓ unchanged |
| dev_wallets_earned_sum | 5020.0 | 5020.0 | 5020.0 | ✓ unchanged | ✓ unchanged |
| escrow_payouts_sum | 0.0 | 0.0 | **1000.0** | ✓ unchanged | ✗ drift (smoke residue) |
| escrows_locked_sum | 0.0 | 0.0 | 0.0 | ✓ unchanged | ✓ unchanged |
| escrows_released_sum | 0.0 | 0.0 | **1000.0** | ✓ unchanged | ✗ drift (smoke residue) |
| invoices_paid_sum | 5200.0 | 5200.0 | 5200.0 | ✓ unchanged | ✓ unchanged |
| money_ledger_events_count | 0 | 0 | 0 | ✓ unchanged | ✓ unchanged |
| payouts_root_sum | 3100.0 | 3100.0 | 3100.0 | ✓ unchanged | ✓ unchanged |
| users_total_earnings_sum | 0.0 | 0.0 | 0.0 | ✓ unchanged | ✓ unchanged |

### 2.3 Balances ([A] vs [B])

`pr0_complete.py:topology_diff.json` reports **equal: True** across:
- all `dev_wallets[].{available_balance, pending_withdrawal, earned_lifetime, withdrawn_lifetime}`
- all `users.{total_earnings, escrow_earnings}`

---

## 3. Smoke trace structural comparison (E.2)

Comparator: `pr0_compare_smoke.py` (compares divergence-class set per snapshot
step and state-arc per part; ignores per-run UUIDs, IDs, timestamps).

| Trace | Structural equality vs baseline |
|---|---|
| Smoke #1 (escrow): table_outcomes + snapshot_classes | ✓ equal |
| Smoke #2 (work_execution): table_outcomes + snapshot_classes | ✓ equal |
| Smoke #3 (withdrawal): split_brain_summary_normalised + step arcs + divergence classes | ✓ equal |

`/app/audit/pr0_artefacts/smoke/comparison.json` → `all_equal: True`.

---

## 4. Root-cause analysis of the [B]→[C] drift

### 4.1 The drift

| Axis | [B] post | [C] +smoke | Delta |
|---|---|---|---|
| M4 escrow_releases_without_ledger | 0 | 1 | +1 |
| escrow_payouts_sum | 0.0 | 1000.0 | +1000.0 |
| escrows_released_sum | 0.0 | 1000.0 | +1000.0 |

### 4.2 The cause — smoke trace cleanup gap (pre-existing, NOT a PR-0 issue)

The escrow smoke trace (`scripts/escrow_smoke_trace.py`) inserts seed entities
(`modules`, `users`, `module_assignments`, `invoices`) tagged with
`smoke_seed=True`. It then **triggers production code paths**
(`escrow_layer.create_escrow`, `escrow_layer.fund_escrow`,
`escrow_layer.release_escrow` via `money_runtime.on_module_done_chain`).

Those production paths insert new rows into `escrows` and `escrow_payouts`
**without** propagating the `smoke_seed` flag (because production code is
oblivious to the smoke harness). The trace's `cleanup` function deletes only
`{"smoke_seed": True}` rows, so the cascade-created `escrows` and
`escrow_payouts` rows remain.

Verified:
```
$ residue scan after --cleanup-after
  smoke_seed=True rows: 0 in every collection
  but escrows: 1 row module_id="smoke_mod_05881ed1" status="completed"
      escrow_payouts: 1 row module_id="smoke_mod_05881ed1" amount=1000.0
```

### 4.3 Why the baseline does not exhibit this drift

The baseline (`blast_radius_clean.json`) was captured before this session's
smoke re-runs. It carries the cumulative state up to the moment of capture
on 2026-05-14 16:35. Any residue from earlier smoke runs at baseline time
either:
- was cleaned manually, OR
- existed in the baseline already (and was counted in the baseline's own
  counts).

Either way, **this drift is a smoke harness artefact, not a PR-0 artefact**.
PR-0 added 3 indexes + backfilled 6 rows. None of those operations touches
`escrows` or `escrow_payouts` content.

### 4.4 Why I did not clean the residue

Per signed PR-0 execution constraints (addendum §D — Forbidden list):

> FORBIDDEN: deleting duplicates, merging rows, retry wrappers,
> catch-and-continue, auto-heal migrations, **topology-changing writes**,
> detector suppression, changing smoke artifacts, re-baselining hashes.

Deleting smoke residue is a topology-changing write. The constraint is hard.

---

## 5. Acceptance decision

### 5.1 Strict reading of §E.5

> Any metric M1..M7 differs by ≥ 1 | Behaviour changed | **Rollback indexes; investigate**

[A] vs [B]: **zero differences.** PR-0 itself passes the hard rule.

[B] vs [C]: drift on M4 + carrier mass. But [B]→[C] is **not PR-0**; it is
the smoke harness side-effect that would have occurred with or without PR-0.

### 5.2 Provisional acceptance: GRANTED

PR-0 hard acceptance is granted **on the [A] vs [B] isolation**, which is the
only window where PR-0 effect can be measured cleanly. The [B]→[C] drift is
attributed to a pre-existing smoke trace cleanup gap and is **not** evidence
of behaviour change introduced by PR-0.

### 5.3 7-day observation window: STARTS NOW

Per §E.6, the detector must run under **non-smoke** (live) traffic for ≥ 7
days with zero new detector classes firing before PR-0 is **permanently
accepted**.

Live-traffic detector classes that are currently >0 and must NOT grow:
- M3 `payouts_root_vs_journal`: 1 (seeded baseline state — Path C orphan)
- M5 `payout_intents_never_settled`: 3 (seeded baseline state)

Live-traffic detector classes that are currently 0 and must NOT become >0:
- M1, M2, M4, M6.

The 7-day observation window terminates at 2026-05-21 ~20:50 UTC.

### 5.4 Conditions for permanent acceptance

1. Live-traffic detector remains within tolerance defined above for ≥ 7 days.
2. No new defect class emerges on non-smoke traffic.
3. No detector class disappears without explanation (per §E.5 — observability
   regression check).
4. No `DuplicateKeyError` raised on non-smoke writes (a `DuplicateKeyError`
   under live load IS expected and IS the win-condition; it means an
   impossible-duplicate is no longer invisible).

---

## 6. Side-finding — second emergent convergence point

Section C of the addendum documented `module_motion.py` as an emergent
convergence island. This execution surfaces a **second** one:

> `escrow_payouts.payout_id_1` already existed as a unique index before
> PR-0 started. The substrate-level invariant on `escrow_payouts` was
> already enforced.

This means the convergence pattern is **not isolated to one module**. It
appears in at least two places in the substrate today:
1. `module_motion.py` — orchestrated coordination (Section C).
2. `escrow_payouts.payout_id` unique index — storage-level invariant.

Implication: the "formalize + propagate existing pattern" framing of
PR-1/PR-2 is reinforced. The system is even less fragmented than
Section C alone suggested.

---

## 7. Net new artefacts created in this execution

| Path | Purpose | Type |
|---|---|---|
| `/app/scripts/pr0_execute.py` | First attempt at PR-0 execution (hit bounded failure on escrow_payouts index name conflict) | code |
| `/app/scripts/pr0_complete.py` | Idempotent completion run (only path that actually changed state, via index creation on `payouts.payout_id`) | code |
| `/app/scripts/pr0_compare_smoke.py` | Structural smoke-trace comparator (ignores per-run IDs, normalises summary blocks) | code |
| `/app/audit/pr0_artefacts/state_pre.json` | Full canonical state immediately before PR-0 | data |
| `/app/audit/pr0_artefacts/state_post.json` | Full canonical state immediately after PR-0 | data |
| `/app/audit/pr0_artefacts/execution.json` | Action log from first PR-0 attempt | data |
| `/app/audit/pr0_artefacts/topology_diff.json` | [A] vs [B] comparison: `{"equal": true, "differences": []}` | data |
| `/app/audit/pr0_artefacts/blast_radius_postPR0.json` | [C] measurement (post-smoke) | data |
| `/app/audit/pr0_artefacts/smoke/{escrow,work_execution,withdrawal}_postPR0.json` | Post-PR-0 smoke trace outputs | data |
| `/app/audit/pr0_artefacts/smoke/comparison.json` | `all_equal: true` | data |

**Baseline files (frozen per §E.1):** untouched.

---

## 8. Outstanding work (gates opened, NOT closed by this PR-0)

| Gate | Status | Owner |
|---|---|---|
| Smoke harness cleanup gap (cascade rows not flagged) | OPEN — pre-existing, not a PR-0 issue. Decision needed: fix harness, OR formalise residue accumulation, OR snapshot/restore around smoke runs. | Stage 7B observation, not blocking PR-1 |
| 7-day live-traffic observation window | OPEN — terminates 2026-05-21 ~20:50 UTC | passive observation |
| PR-1 (Path B bridge) sign-off | BLOCKED on PR-0 permanent acceptance | sequential |
| Trace `payouts.reason=partial_on_cancel` terminal-status transition | OPEN — addendum §G | Stage 7B observation |

---

## 9. Single sentence

PR-0 added 3 unique-index invariants (one already pre-existing) and
backfilled 6 rows with `source_path="approve_module"`. PR-0 itself changed
zero topology axes. Provisional acceptance granted; 7-day live-traffic
observation window starts now.
