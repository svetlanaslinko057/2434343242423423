# PRD — Phase 2C-B4.2 Closeout, Feb 2026

> 2C-B1 done (shadow projection).
> 2C-B2 done (5/5 stability probe green).
> 2C-B2.5 done (seed convergence).
> 2C-B3 done (dual-read facade + feature flag).
> 2C-B3.1 done (`MONEY_READS_FROM_PROJECTION = true` flipped).
> 2C-B4.0 done (DEV POOL boot wipe removed).
> 2C-B4.0.1 done (demo + mock seeds canonicalised).
> 2C-B4.1 done (admin mark-paid legacy write removed).
> **2C-B4.2 done — `_credit_module_reward` legacy `dev_wallets.update_one $inc earned/available` REMOVED.**
> See closeouts:
>   - `/app/audit/PHASE_2C_B4_2_ACCEPTANCE_2026-02-FEB.md` (this phase)
>   - `/app/audit/PHASE_2C_B4_1_ACCEPTANCE_2026-02-FEB.md`
>   - `/app/audit/PHASE_2C_B4_0_1_ACCEPTANCE_2026-02-FEB.md`
>   - `/app/audit/PHASE_2C_B4_0_ACCEPTANCE_2026-02-FEB.md`

## What changed (Phase 2C-B4.2 only)

| Item | Before | After |
|---|---|---|
| `_credit_module_reward` writes to `dev_wallets` | YES (`$inc earned_lifetime + available_balance`) | **NO — block REMOVED** |
| `dev_earning_log` insert | YES (idempotent on module_id) | UNCHANGED |
| `EVENT_QA_APPROVED` ledger event | recorded by caller `client_approve_module` | UNCHANGED |
| `dev_wallets_projection` (user-facing) | source=ledger | UNCHANGED — still source=ledger |
| Legacy `dev_wallets[john]` (orphan canary) | `earned=$5020 / avail=$1220 / wd=$3800` | UNCHANGED — orphan stays visible |
| Production writers in `server.py` | 5 (4 D-business + 1 A-mirrored) | 4 (4 D-business) |

## Acceptance — all green

- ✅ **legacy `dev_wallets[john]` unchanged after live approve** — `available_balance=1220, earned_lifetime=5020` identical pre/post (B4.2 critical assertion)
- ✅ **`dev_earning_log` idempotent** — re-approve hits endpoint-level 400 guard before reaching the function; idempotency early-return preserved
- ✅ **canonical signal recorded** — 1 new `EVENT_QA_APPROVED` event for `mod_6eebd7711e78`
- ✅ **projection rebuild idempotent** — first run wrote 7 rows; second run `unchanged=7, written=0`
- ✅ **stability probe steady** — 5/5 runs identical, classifications `{ledger_only: 6, mock_orphan: 1}`, checksum `7e042acb3683…` stable
- ✅ **architecture tests** — 4 passed, 1 skipped (silent except count = no growth, writer-count invariant upheld)
- ✅ **`tests/test_dev_wallet_projection.py` + `tests/test_dev_wallet_reader.py`** — 19 passed
- ✅ **`accrual_pending_cents` invariant** — for every projection: `accrual_pending_cents == SUM(ac_accrual:<dev>)`. Holds vacuously today (`task_earnings` collection empty); structurally preserved going forward
- ✅ **`WARN dev_wallet_read.mismatch` count = 0**

### Single divergence introduced (by design)

Legacy `dev_wallets.earned_lifetime` and `available_balance` are now drifted-by-design for any module credited post-B4.2. The drift is **surfaced** by the divergence engine and stability probe as `mock_orphan`-style classifications. This is the controlled proof that:

- projection lives independently
- canonical truth no longer depends on legacy mirror
- divergence engine actually sees drift
- drift is localised and explainable

## Public API impact

None. `_credit_module_reward` is internal. Public surface unchanged.

## Live smoke (admin@atlas.dev / client@atlas.dev, env preview-11)

```
POST /api/client/modules/mod_6eebd7711e78/approve     → 200 status=done qa_status=passed
POST /api/client/modules/mod_6eebd7711e78/approve     → 400 "Module is 'done', not awaiting approval"
POST /api/admin/money/projections/dev-wallets/rebuild → counts.computed=7 written=7 unchanged=0
POST /api/admin/money/projections/dev-wallets/rebuild → counts.computed=7 written=0 unchanged=7 (idempotent)
python3 /app/scripts/dev-wallet-projection-stability.py → 5/5 runs ✅ ALL INVARIANTS HOLD
```

## Phase 2C-B roadmap (current)

1. ✅ 2C-B1 — projection shadow
2. ✅ 2C-B2 — repeatable stability probe
3. ✅ 2C-B2.5 — seed convergence
4. ✅ 2C-B3 — dual-read facade
5. ✅ 2C-B3.1 — `MONEY_READS_FROM_PROJECTION` flipped to true
6. ✅ 2C-B4.0 — DEV POOL boot wipe removed
7. ✅ 2C-B4.0.1 — demo + mock seeds canonicalised
8. ✅ 2C-B4.1 — admin mark-paid legacy write removed
9. ✅ **2C-B4.2 — `_credit_module_reward` legacy write removed**
10. 🟡 **2C-B4.3 — D-class `pending_withdrawal` lifecycle peel** (next; the harder half — state machine + temporal consistency + concurrent flows)
11. 🟡 2C-B4.4 — `dev_wallets` collection → diagnostic only
12. 🟡 2C-B4.5 — divergence engine → passive observer

## Side-tracked follow-ups (NOT B4.2 scope)

- **B4.2.1** — `module_qa_decision` (`server.py:23956`) canonical chain coverage (path calls `_credit_module_reward` but never invokes `on_module_done_chain` or records `EVENT_EARNING_APPROVED`)
- **Schema-fix** — drop redundant `idempotency_key_1` index on `money_ledger_events`. Once dropped, `EVENT_EARNING_APPROVED` propagates correctly and `tests/test_money_stabilization.py::test_full_chain_seed_no_double_events` + `::test_dev_wallet_canonical_no_double_credit` go green (currently failing because of the dual-index conflict that pre-dates B4.2)

## What was explicitly NOT changed (per user's contract)

- ❌ `pending_withdrawal` lifecycle (D-class — B4.3 territory)
- ❌ `bridge_*` family (escrow/refund/earning_approved/earning_reversed/payout) — UNTOUCHED
- ❌ admin aggregate endpoint
- ❌ divergence engine
- ❌ projection rebuild logic
- ❌ payout bridge
- ❌ orphan canary in `mock_seed.py` (intentional fixture)
- ❌ `pricing_engine.py` / HVL
- ❌ no "raz uzh tut" cleanup
