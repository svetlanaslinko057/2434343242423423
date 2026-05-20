# PRD — Phase 2C-B1 + 2C-B2 + 2C-B2.5 + 2C-B3 + 2C-B3.1, Feb 2026

> 2C-B1 done (shadow projection).
> 2C-B2 done (5/5 stability probe green).
> 2C-B2.5 done (seed convergence — `{matches: 6, mock_orphan: 1}`).
> 2C-B3 done (dual-read facade + feature flag).
> **2C-B3.1 done — `MONEY_READS_FROM_PROJECTION` flipped to `true`.
> Projection is now the user-facing source. WARN mismatch count = 0.
> Observation window for 2C-B4 starts now.**
> See closeouts:
>   - `/app/audit/PHASE_2C_B3_1_DEV_WALLET_FLIP.md`
>   - `/app/audit/PHASE_2C_B3_1_PREFLIP_STABILITY.md`
>   - `/app/audit/PHASE_2C_B3_DEV_WALLET_READ_SWITCH.md`

## What changed (Phase 2C-B1 only)

| Item | Before | After |
|------|--------|-------|
| Reader of dev wallet | `dev_wallets` (legacy) | UNCHANGED — legacy still canonical |
| Writer of dev wallet | 11 grandfathered writers | UNCHANGED — no writes removed |
| New module | — | `/app/backend/money_projections.py` |
| New collection | — | `dev_wallets_projection` (read-model only) |
| New watermark | — | `dev_wallet_projection_watermarks` |
| New admin endpoints | — | 3 (GET list, POST rebuild, GET single+compare) |
| `money_divergence.py` | active | UNCHANGED |
| Pricing / HVL | active | UNCHANGED |

## Acceptance — all green

- ✅ **dry_run does not write** — verified: `counts.written=0` while
  `counts.computed=7`. Watermark recorded as `state=dry_run`.
- ✅ **rebuild idempotent** — verified live: first run wrote 7 rows, second
  run skipped all 7 as `unchanged=7`, `written=0`.
- ✅ **projection from ledger is repeatable** — pure `SUM(delta_cents)`
  aggregation on `ac_dev:<id>`, `ac_accrual:<id>`, `ac_ext:<id>`. No
  hidden state. Tests cover the formula.
- ✅ **known mock orphan stays visible** — `user_a0129bbef170` classified
  as `mock_orphan` with `diff_cents.withdrawn_lifetime=380000` (= $3,800).
  Projection reports the honest `withdrawn_lifetime_cents=0` from the
  ledger; the diff is NOT masked.
- ✅ **no legacy writes removed** — `grep` confirms all existing
  `db.dev_wallets.update_one` / `insert_one` call sites still present in
  `server.py`, `module_motion.py`, `auto_guardian.py`, etc.
- ✅ **architecture tests green** — `tests/architecture/test_layering.py`
  17 passed / 1 skipped. The new `dev_wallets_projection` collection is
  NOT in `MONEY_COLLECTIONS`; the new `money_projections.py` is the
  single writer to it, so the writer-count invariant is upheld.

## Mapping (ledger → projection — integer cents)

```
ac_dev:<dev>     →  available_balance_cents
ac_ext:<dev>     →  withdrawn_lifetime_cents
ac_dev + ac_ext  →  earned_lifetime_cents      (lifetime credits to wallet)
ac_accrual:<dev> →  accrual_pending_cents      (post-QA, pre-payout)
(no source)      →  pending_withdrawal_cents = null    (deliberate)
```

`pending_withdrawal_cents` is `null` (not 0) by design: in-flight payouts
are not yet ledger-recorded events, so the projection refuses to fabricate
a number it cannot derive.

## Classification grid (`compare_dev_wallet_projection`)

| Class | Meaning |
|---|---|
| `matches` | every cents field equal within ±1 cent |
| `legacy_only` | legacy wallet present, ledger has zero activity for this dev |
| `ledger_only` | ledger has activity, legacy doc is missing |
| `mock_orphan` | legacy says withdrawn > 0 but `ac_ext` is empty (the Phase 2C-D payout orphan) |
| `neither` | no record on either side (defensive only) |
| `diverged` | anything else — admin investigates |

## Public API (admin-only)

```
GET  /api/admin/money/projections/dev-wallets
       ?limit=<int>&skip=<int>
     → {count, limit, skip, projections[], watermark}

POST /api/admin/money/projections/dev-wallets/rebuild
       body: {dry_run=true, limit=null, currency="USD"}
     → {dry_run, counts{discovered, computed, written, unchanged, errors},
        state, projections[]  (only when dry_run=true)}

GET  /api/admin/money/projections/dev-wallets/{developer_id}
     → {projection, comparison{classification, legacy, projection,
        diff_cents}}
```

## Live smoke (admin@atlas.dev, env preview-10)

```
POST .../rebuild  {dry_run:true}   →  computed=7, written=0   (preview)
POST .../rebuild  {dry_run:false}  →  computed=7, written=7   (initial)
POST .../rebuild  {dry_run:false}  →  computed=7, unchanged=7 (idempotent)
GET  .../user_a0129bbef170         →  classification="mock_orphan"
                                      diff_cents.withdrawn=380000 ($3,800)
```

## Phase 2C-B roadmap (sequenced)

1. **2C-B1 — projection shadow** ✅ DONE
2. **2C-B2 — repeatable stability probe** ✅ DONE
   - 5/5 runs green via `/app/scripts/dev-wallet-projection-stability.py`
   - All 7 invariants (checksum / histogram / diverged=0 / mock_orphan
     stable / matches monotone / legacy immutable / idempotent after run 1)
   - Histogram steady-state: `{legacy_only: 6, mock_orphan: 1}`
     diverged=0 across all runs
3. **2C-B3 — switch UI reads** to `dev_wallets_projection` (or directly to
   the ledger-derived formula); legacy writes still happen for safety net.
4. **2C-B4 — remove legacy writes** — only after 2C-B3 stable; reduces
   grandfathered set in `test_only_money_domain_writes_to_money_collections`.

## 2C-B2 observation note

The histogram `{legacy_only: 6, mock_orphan: 1, matches: 0}` is a direct
consequence of the seed pipeline writing legacy `dev_wallets` rows
without going through the bridge (`seed_money_demo.py`). This is honest
signal, not a failure:
  • 2C-B1 contract: "do not mask the orphan"  ✅ orphan visible
  • 2C-B2 contract: "prove stability by repetition"  ✅ 5/5 runs identical
  • Pre-2C-B3 work: drive `legacy_only → matches` by either replaying the
    seed wallets through `money_bridge.bridge_*` (preferred) OR seeding
    the bridge during demo setup (alternative). NOT in scope for 2C-B2.

## What was explicitly NOT changed (per user's constraint)

- ❌ No legacy `dev_wallets` writes were removed (still 11 writers).
- ❌ No UI reader was switched off `dev_wallets`.
- ❌ No mock-seed orphan was "fixed" manually.
- ❌ `pricing_engine.py` / HVL untouched.
- ❌ `money_divergence.py` left intact.
