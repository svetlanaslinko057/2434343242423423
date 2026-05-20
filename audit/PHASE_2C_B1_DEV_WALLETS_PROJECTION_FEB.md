# Phase 2C-B1 — dev_wallets projection shadow (closeout)
**Date:** Feb 2026
**Status:** ✅ DONE — shadow projection live, idempotent, observable

## Scope (per user contract)

Build a ledger-derived dev wallet projection that lives BESIDE the legacy
`dev_wallets` collection — never inside it. No reader is switched. No
writer is removed. The mock-seed payout orphan stays visible (we
diagnose it, we don't mask it).

Sequenced roadmap was committed to:
```
2C-B1 projection shadow          ← THIS PR
2C-B2 compare legacy vs projection
2C-B3 switch reads
2C-B4 remove writes
```

## Files

| File | Lines | Role |
|---|---|---|
| `/app/backend/money_projections.py` | 351 | NEW — single writer for `dev_wallets_projection` |
| `/app/backend/server.py` | +66 | NEW — 3 admin endpoints, registered next to `/api/admin/money/divergence` |
| `/app/backend/tests/test_dev_wallet_projection.py` | 251 | NEW — 10 tests, all pass |
| `/app/memory/PRD.md` | rewritten | PRD now points at 2C-B1 closeout |

NO legacy file was modified. `grep -rn 'db.dev_wallets.(update_one\|insert_one)'`
counts unchanged (11 writers as before).

## Source of truth — ledger formulas

```
ac_dev:<dev>      —  $ ever credited to wallet, debited on payout
ac_accrual:<dev>  —  post-QA per-task earnings, awaiting payout flow
ac_ext:<dev>      —  outbound mirror of process_payout

available_balance_cents  = SUM(delta_cents | ac_dev:<dev>)
withdrawn_lifetime_cents = SUM(delta_cents | ac_ext:<dev>)
earned_lifetime_cents    = available_balance_cents + withdrawn_lifetime_cents
accrual_pending_cents    = SUM(delta_cents | ac_accrual:<dev>)
pending_withdrawal_cents = null   (deliberate — no ledger source)
```

Integer cents end-to-end. Same `round half-to-even` convention as the
existing money domain (`shared/constants.py`, `domains/money/policies.py`).

## API surface (admin-only)

```
GET  /api/admin/money/projections/dev-wallets?limit=&skip=
POST /api/admin/money/projections/dev-wallets/rebuild
       body: {dry_run:bool=true, limit:int|null=null, currency:str="USD"}
GET  /api/admin/money/projections/dev-wallets/{developer_id}
```

The single-developer GET also runs `compare_dev_wallet_projection`, so
admins can answer "what does the ledger say about this dev vs legacy"
in one round-trip.

## Acceptance — verified live on env preview-10

| Criterion | Method | Result |
|---|---|---|
| dry_run does not write | `POST .../rebuild {dry_run:true}` then count `dev_wallets_projection` | ✅ count=0, watermark.state="dry_run" |
| rebuild is idempotent | 2 consecutive live rebuilds, same ledger state | ✅ 1st: written=7, unchanged=0  ·  2nd: written=0, unchanged=7 |
| projection from ledger is repeatable | pure SUM aggregation, deterministic on (account_id, currency) | ✅ same ledger → same numbers (verified across 2 runs) |
| known mock orphan stays visible | live compare of `user_a0129bbef170` | ✅ classification="mock_orphan", diff_cents.withdrawn=380000, projection reports honest 0 |
| no legacy writes removed | `grep db.dev_wallets.update_one` before/after | ✅ same 11 writers, unchanged |
| architecture tests green | `tests/architecture/test_layering.py` | ✅ 7 passed, 1 skipped (no regression) |

## Classification grid (`compare_dev_wallet_projection`)

| Class | Trigger |
|---|---|
| `matches` | every cents field equal within ±1 cent |
| `legacy_only` | legacy wallet present, ledger has zero activity for this dev |
| `ledger_only` | ledger activity exists, legacy doc is missing |
| `mock_orphan` | legacy `withdrawn_lifetime` > 0 AND `ac_ext`/`ac_dev` both zero — the Phase 2C-D payout orphan |
| `neither` | no record on either side (defensive) |
| `diverged` | anything else — admin must investigate |

The classification ordering puts `mock_orphan` BEFORE `legacy_only` so
the diagnostic is specific rather than generic (`legacy_only` would
otherwise swallow the orphan signal).

## Tests (10/10 pass)

```
tests/test_dev_wallet_projection.py::test_build_projection_for_pure_ledger_developer  PASS
tests/test_dev_wallet_projection.py::test_build_projection_empty_when_no_ledger_activity  PASS
tests/test_dev_wallet_projection.py::test_rebuild_dry_run_does_not_write  PASS
tests/test_dev_wallet_projection.py::test_rebuild_live_writes_then_is_idempotent  PASS
tests/test_dev_wallet_projection.py::test_rebuild_live_detects_new_ledger_activity  PASS
tests/test_dev_wallet_projection.py::test_compare_matches_when_legacy_mirrors_ledger  PASS
tests/test_dev_wallet_projection.py::test_compare_classifies_mock_seed_payout_orphan  PASS
tests/test_dev_wallet_projection.py::test_compare_classifies_legacy_only  PASS
tests/test_dev_wallet_projection.py::test_compare_classifies_ledger_only  PASS
tests/test_dev_wallet_projection.py::test_rebuild_does_not_touch_legacy_dev_wallets  PASS
```

The last test is the most important one: it asserts that even when the
ledger and legacy disagree (`ledger=$10`, `legacy=$99.99`), a live
rebuild leaves `dev_wallets.{available_balance,earned_lifetime}` untouched.

## Architecture invariants

- `money_projections.py` writes ONLY to `dev_wallets_projection` and
  `dev_wallet_projection_watermarks` — both NEW collections, not in
  `MONEY_COLLECTIONS` or `CRITICAL_COLLECTIONS`. Writer-count invariants
  preserved.
- `money_projections.py` READS from `money_ledger_events` and `dev_wallets`
  only. Reads are not restricted by `test_only_money_domain_writes_to_money_collections`.
- The module does NOT import `domains.money` — projection is decoupled
  from the domain layer so it cannot accidentally trigger a write through
  `MoneyService`. The account-id prefixes are duplicated as string
  constants on purpose.

## Why this path (not the alternatives)

- **Why not switch reads now?** Because the projection has zero hours of
  production observation. The user explicitly stated "we don't have real
  traffic, but we still go forward in a CONTROLLED way" — 2C-B1 is the
  smallest controlled step that produces signal.
- **Why a separate collection (not just the ledger)?** Because the
  comparison endpoint needs a stable snapshot of "what the projection
  said at time T" to detect drift across rebuilds. A pure on-demand
  computation can't answer "did the projection change in the last hour?".
- **Why not fix the mock_orphan?** Because that would mask the only
  signal we have that the legacy payout path was non-canonical. The
  orphan must remain visible until 2C-B3, when ledger becomes the
  authoritative read source.

## Next (2C-B2)

Build a daily classification snapshot job that consumes the
`/api/admin/money/projections/dev-wallets` list and counts each class.
Acceptance for 2C-B3 (switch reads) requires:
- non-orphan devs: `matches` for N consecutive rebuilds
- orphan devs: `mock_orphan` classification stable
- no `diverged` entries for at least 1 stable observation window

2C-B2 is a small read-only daemon — it adds no new writers, only reads
the existing endpoint.
