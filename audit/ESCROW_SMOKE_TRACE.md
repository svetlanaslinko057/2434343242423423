# Escrow Smoke Trace — first real-runtime evidence

**Date:** 2026-05-14
**Stage:** 7A (Discovery)
**Charter:** `/app/audit/MONEY_AUTHORITY_CHARTER.md`
**Trace data (raw):** `/app/audit/escrow_smoke_trace_baseline.json`
**Script:** `/app/scripts/escrow_smoke_trace.py`
**Run ID:** `c1f07e9a`

---

## Purpose

The detector baseline (Charter §13) ran against seeded data that **bypasses the
escrow chain entirely** (zero `escrows` rows existed). To gate Stage 7A → 7B,
we needed at least one **real-runtime** divergence reading on the canonical
chain. This trace fires:

    invoice (pending) → invoice (paid) → escrow.pending → escrow.funded
                     → module.done → escrow.released → escrow_payouts row
                     → users.$inc total_earnings

…through the existing writers (`escrow_layer.create_escrow`, `fund_escrow`,
`on_module_done` → `release_escrow`, plus `money_runtime.on_invoice_paid`),
on an isolated `smoke_*` module. After every step the detector snapshots:
classes fired, raw collection state, dev/module diff.

Critically the trace **does NOT** invoke `_credit_module_reward` (that's the
`client_approve_module` HTTP handler in server.py). It fires ONLY the escrow
branch. This isolates the parallel-writer behaviour the charter §5 predicted.

## What this trace does NOT do

- ❌ Modify any writer
- ❌ Modify any detector logic
- ❌ Run reconciliation
- ❌ Fix the divergence
- ❌ Replace `_credit_module_reward` or the HTTP path

Pure observation.

---

## Stepwise readings

| Step | invoice | escrow | locked | released | wallet.earned | users.total_earnings | dev_earning_log# | escrow_payouts# | ledger# | classes fired |
|---|---|---|---|---|---|---|---|---|---|---|
| T0 — seeded | pending_payment | — | — | — | — | 0 | 0 | 0 | 0 | (none) |
| T1 — invoice paid + chain | paid | **funded** | **1000** | 0 | — | 0 | 0 | 0 | **0** | `ledger_missing` |
| T2 — module done + release | paid | **completed** | 0 | **1000** | — | **1000** | **0** | **1** | 0 | `wallet_not_credited`, `escrow_payouts_orphan`, `ledger_missing` |
| T3 — settled | paid | completed | 0 | 1000 | — | 1000 | 0 | 1 | 0 | (same as T2 — divergence is permanent) |

(Notation: `wallet.earned = —` means `dev_wallets` row does not exist at all
for this developer. Not zero — absent.)

---

## Interpretation per step

### T1 — invoice paid, escrow funded

- ✅ The settlement chain hook `money_runtime.on_invoice_paid` fired: escrow
  was auto-created and auto-funded based on the paid invoice. `invoice.settlement_escrow_id`
  was set. Module status → `in_progress`.
- 🟡 **`ledger_missing` (info).** No `money_ledger_events.record_event` was
  emitted by `on_invoice_paid` / `fund_escrow` / `create_escrow`. The ledger
  module that calls itself "single source of truth for the money flow"
  (`money_ledger.py:5`) is **not on the canonical chain**. Confirmed at runtime:
  the chain runs, the ledger stays silent. Direct evidence for **Decision 6**.

### T2 — module done, escrow released

This is the divergence collision the charter predicted.

- 🔴 **`escrow_payouts_orphan` (error) — S-1 IN THE WILD.**
  - `escrow_payouts` table now has 1 row (the per-release immutable record): $1000 to `smoke_dev_…`.
  - `dev_earning_log` has 0 rows for this module.
  - i.e. the developer **received** money via the escrow path, but the
    canonical journal that backs the canonical wallet **has no record of it**.
  - Per Decision 1=D, `dev_wallets` (backed by `dev_earning_log`) is the
    canonical developer-payable. **That canonical is silent**. The only place
    this $1000 is visible at the developer aggregate is `escrow_payouts`
    (audit) and `users.total_earnings` (legacy mirror, see below).

- 🔴 **`wallet_not_credited` (error).** Same evidence, different classification:
  `escrow.released_amount=$1000` but `dev_earning_log.sum_for_module=0`.

- 🟡 **`users.total_earnings = $1000` — legacy mirror is now the ONLY
  developer-money signal.**
  - `escrow_layer.release_escrow` line 218 fires `$inc total_earnings`.
  - There is no parallel `_credit_module_reward` to fire `dev_wallets`.
  - **Decision 1=D says wallet is canonical**; runtime says wallet is empty
    and the legacy mirror is the only place money lives. This is a direct
    contradiction with the just-signed authority map.
  - This is the strongest empirical argument that **Decision 3 cannot say
    "deprecate-and-stop-writing"** until `release_escrow` is rewired to write
    to `dev_earning_log` (or until the orchestrator is consolidated — Decision 5).

- 🟡 **`ledger_missing`.** All three lifecycle transitions (paid, funded,
  released) happened — zero ledger events. Confirms `money_ledger_events` is
  ornamental on the escrow chain at present.

### T3 — settled

State identical to T2. No background job (auto_guardian, module_motion,
operator_engine) repairs the divergence. It is **structural and permanent**
under the current writer layout.

---

## What this proves

1. **Decision 1=D is correct but unenforced.** Wallet is declared canonical;
   the canonical chain doesn't write to wallet. Until writers obey the
   authority map, the map is a doc, not a runtime contract.

2. **The "comment-coordination" contract from `escrow_layer.py:209` is broken
   in any path that does not go through `client_approve_module`.** Today every
   non-HTTP path that releases escrow produces this exact divergence:
   - `escrow_layer.on_module_done` called directly
   - `_money_runtime.on_module_done_chain` called from server line 23156
     (no `_credit_module_reward` call in that branch)
   - any future scheduler / event-loop-triggered release
   This is **not** a hypothetical — `_money_runtime.on_module_done_chain` is
   already wired and called from `server.py:23156` in `client_approve_module`,
   side-by-side with `_credit_module_reward`. If one fires without the other
   (e.g. an error in the wrapper, an admin override, a retry), the divergence
   surfaces immediately.

3. **`money_ledger_events` is currently audit-only by negative evidence.**
   The chain that mutates money runs without writing a single ledger row. So
   the practical answer to **Decision 6** ("audit-only" vs "future event-source")
   is already shipped: today it is *not even reliable audit*, let alone an event source.

4. **`escrow_payouts` is the only honest per-release record.** It is the
   most reliable audit collection in the entire money domain — one writer
   (`escrow_layer.release_escrow`), unique by `payout_id`, populated on every
   release. Decision 6 should explicitly preserve this property.

5. **Order of corrective actions is dictated by this trace:**
   - First, the orchestrator must be consolidated so the canonical wallet
     write happens on every released-escrow path (Decision 5).
   - Only then is it safe to consider freezing legacy mirrors (Decision 3).
   - Reconciliation jobs cannot be written until both are in place.

---

## Inputs to Decisions 2–6 from this trace

| Decision | Evidence from this trace |
|---|---|
| 2 (`payouts`/`earnings` legacy?) | Not touched by this trace (work_execution path didn't fire). Need a second smoke trace via the `work_execution` path before signing Decision 2. |
| 3 (`users.total_earnings` field) | **Cannot deprecate yet.** Until Decision 5 ships, this field is the only persistent record of escrow-released money outside `escrow_payouts`. |
| 4 (`withdrawals` vs `dev_withdrawals`) | Not touched (no withdrawal exercised). Open. |
| 5 (module-done orchestrator) | **Sign as: single orchestrator must call both `release_escrow` AND `_credit_module_reward` (or merge them).** Direct evidence: skipping `_credit_module_reward` produces $1000 of phantom money the canonical wallet cannot see. |
| 6 (ledger role) | **Sign as: audit-only — but make the audit actually run.** Today the canonical chain produces zero ledger events. Decision 6 must commit `money_ledger.record_event` calls into the chain BEFORE making any claim about ledger as authority. |

---

## Cleanup

Smoke rows are left in place in `test_database` for inspection of this trace.
Idempotent cleanup:

```
python3 /app/scripts/escrow_smoke_trace.py --cleanup
```

Re-run is safe (uses fresh `run_id`):

```
python3 /app/scripts/escrow_smoke_trace.py
```

Re-run + auto-cleanup (for CI-style checks):

```
python3 /app/scripts/escrow_smoke_trace.py --cleanup-after
```
