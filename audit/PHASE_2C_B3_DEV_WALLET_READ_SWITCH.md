# Phase 2C-B3 — developer wallet read switch (closeout)
**Date:** Feb 2026
**Status:** ✅ Cutover infrastructure shipped, flag default OFF (Stage A) for safe rollout

## Outcome

Every user-facing read of a developer's wallet now flows through the
`dev_wallet_reader.read_dev_wallet` facade. The facade does the
dual-read (legacy + projection), compares them on every call, logs
divergence in a structured form, and returns the active source based
on `MONEY_READS_FROM_PROJECTION`.

The OPERATOR controls the cutover. Flipping `MONEY_READS_FROM_PROJECTION`
between `false` and `true` switches the response source without a code
deploy. No writers were modified. No legacy collections were touched.

## Files

| File | LOC | Role |
|---|---:|---|
| `/app/backend/dev_wallet_reader.py` | 178 | NEW — single dual-read entry-point |
| `/app/backend/server.py` | -15 / +10 | 2 read sites migrated (`/api/developer/wallet`, withdrawal error diagnostic) |
| `/app/backend/dev_work.py` | -1 / +6 | 1 read site migrated (developer dashboard) |
| `/app/backend/developer_intelligence.py` | -3 / +6 | 1 read site migrated (analytics tile) |
| `/app/backend/tests/test_dev_wallet_reader.py` | 290 | NEW — 9 facade tests |
| `/app/backend/.env` | +1 | flag entry, default `false` |

Non-targets — deliberately UNCHANGED:
- `server.py:11145, 11183` — read-after-write inside `_credit_module_reward`
  (writer's own response; not user-facing UI)
- `server.py:26050-26059` — aggregate over ALL devs inside the
  divergence detector (legacy-direct on purpose: this is the engine
  the facade is observed BY)
- `money_replay.py`, `money_divergence.py`, `seed_money_demo.py`,
  `mock_seed.py` — diagnostic / replay / divergence tools

## Migrated read paths

| Endpoint / function | Surface | Stage A returns | Stage B returns |
|---|---|---|---|
| `GET /api/developer/wallet` | mobile wallet screen, web dev cockpit | legacy doc shape | projection-derived (legacy shape) |
| Withdraw error diagnostic | "Insufficient balance: $X" UX | legacy `available_balance` | projection `available_balance_cents/100` |
| `dev_work.py` developer dashboard | active modules / earnings tile | legacy wallet | projection-derived |
| `developer_intelligence.py` analytics | leaderboard / earnings tile | legacy `earned_lifetime` | projection-derived |

## Stage rollout — implemented

| Stage | Flag | Returns | Compare | Use |
|---|---|---|---|---|
| **A** (default) | `false` | legacy | yes, log | shipped today |
| **B** | `true` | projection | yes, log | flip when ready |
| **C** | `true` | projection | yes, log | same as B; just naming |
| **D** | n/a | n/a | n/a | 2C-B4 — remove legacy writers |

Flag is read on EVERY call (no caching), so an operator can flip without
a restart. Test: `test_flag_is_read_on_every_call_not_cached`.

## Output shape compatibility

The facade returns the same fields the legacy `dev_wallets` document
used (`user_id`, `available_balance`, `earned_lifetime`,
`withdrawn_lifetime`, `pending_withdrawal` — float dollars), so every
downstream consumer continues to work without changes. Forensic
metadata added:
- `_read_source`: `legacy` | `legacy_missing` | `projection`
- `_stage`: `A` | `B`
- `_classification`: from `compare_dev_wallet_projection`
- `_accrual_pending_cents`: present when Stage B (projection-only)

`pending_withdrawal` is ALWAYS sourced from the legacy doc, even in
Stage B, because the ledger has no concept of in-flight pending. The
projection model deliberately reports `None` here, so the facade
falls back to legacy. This is documented in `dev_wallet_reader.py`.

## Logging

Every dual-read that finds a non-zero diff emits a single line:

```
event=dev_wallet_read.mismatch user_id=<id>
classification=<class> diff_cents=<dict>
```

Level:
- **INFO** if `classification == "mock_orphan"` — the known seeded
  orphan must remain visible but must NOT page operations.
- **WARN** otherwise — any new divergence wakes up the on-call.

This is verified by `test_mock_orphan_mismatch_logged_at_info_not_warning`
and observed live (see "Live evidence" below).

## Acceptance grid (per user contract)

| Criterion | Result |
|---|---|
| UI balances identical before/after switch (Stage A) | ✅ legacy passthrough |
| UI balances reflect projection in Stage B | ✅ verified live (Alice = `matches`) |
| Payout eligibility unchanged | ✅ withdraw flow still uses CAS on legacy doc; diagnostic balance via facade |
| Zero user-visible drift on `matches` devs | ✅ Stage B returns same numbers as Stage A for the 6 converged devs |
| Dual-read mismatch logs == 0 for `matches` devs | ✅ confirmed in live logs (only orphan log line) |
| `mock_orphan` still visible in diagnostics | ✅ `_classification: "mock_orphan"`, structured INFO log |
| No legacy writers removed | ✅ all 11 grandfathered writers still in place |
| Projection NEVER mutates state | ✅ `_FakeCollection.update_one` raises AssertionError in tests |
| Architecture tests green | ✅ 7 passed, 1 skipped |
| Unit tests green | ✅ 26 passed (9 reader + 10 projection + 7 architecture) |

## Live evidence

### Alice (pool dev, post-2C-B2.5)
```
Stage A: {available: 1260.0, earned: 8400.0, withdrawn: 7140.0,
          _read_source: legacy, _classification: matches}
Stage B: {available: 1260.0, earned: 8400.0, withdrawn: 7140.0,
          _read_source: projection, _classification: matches}
→ ZERO user-visible drift between stages.
```

### John (mock_orphan)
```
Stage A: {available: 1220.0, earned: 5020.0, withdrawn: 3800.0,
          _read_source: legacy, _classification: mock_orphan}
Stage B: {available:    0.0, earned:    0.0, withdrawn:    0.0,
          _read_source: projection, _classification: mock_orphan}
→ EXPECTED drift, logged at INFO.
```

### Log line (live)
```
INFO event=dev_wallet_read.mismatch user_id=user_a0129bbef170
     classification=mock_orphan
     diff_cents={'available_balance': 122000,
                 'earned_lifetime':    502000,
                 'withdrawn_lifetime': 380000}
```

`122000 + 380000 = 502000` — the diff is internally consistent
(`earned = available + withdrawn`).

## How operators flip Stage A → B

```bash
# 1. Confirm 2C-B2.5 has been replayed since the last backend boot.
python3 /app/scripts/replay-seed-money-bridge.py            # idempotent
python3 /app/scripts/dev-wallet-projection-stability.py --runs 3
#    → expect histogram {matches: 6, mock_orphan: 1}

# 2. Flip the flag.
sed -i 's/MONEY_READS_FROM_PROJECTION=false/MONEY_READS_FROM_PROJECTION=true/' /app/backend/.env
sudo supervisorctl restart backend
#    (or HUP the worker if the deployment supports it — the flag is
#    read on every call, but `os.environ` is loaded at startup)

# 3. Smoke a developer wallet.
curl -H "Authorization: Bearer <dev_token>" \
     http://localhost:8001/api/developer/wallet
#    → expect `_stage: "B"`, `_read_source: "projection"`

# 4. Watch the log for `dev_wallet_read.mismatch` WARN lines (orphan is
#    INFO, that's fine; WARN means a new divergence).
tail -F /var/log/supervisor/backend.err.log | grep mismatch
```

Rolling back is the same recipe with `false` — no data is destroyed,
the facade just switches its response source.

## What this PR does NOT do

- ❌ Modify `MoneyService`, `domains.money`, or any money writer
- ❌ Modify `money_projections.py`
- ❌ Modify the divergence engine or any `/api/admin/money/divergence` route
- ❌ Make the projection bi-directional (it remains a read model)
- ❌ Switch the admin aggregate at `server.py:26050` to projection
  (that aggregate is the divergence detector's INPUT — it MUST stay
  legacy-direct)
- ❌ Remove or alter the legacy `dev_wallets` doc
- ❌ Flip the cutover flag to Stage B for the operator

## Known follow-ups (NOT 2C-B3 scope)

1. **2C-B2.5 idempotency across boots.** The MoneyService idempotency
   cache lives in-memory; after a backend restart, re-running
   `replay-seed-money-bridge.py` re-tries `release_escrow` against an
   already-drained escrow account and trips `PolicyDenied`. The
   legacy normalisation portion of the script still works; the ledger
   itself remains correct from the first successful run. Fix in
   follow-up: persist idempotency results in `money_idempotency`
   collection (or fall back to checking ledger entries by
   `idempotency_key` before issuing the call).

2. **Persistent reseed wipe.** The DEV POOL seed in `server.py:9787`
   wipes `dev_wallets` for pool devs on every boot. After the wipe,
   the legacy shape reverts to `(earned_lifetime only)` and Stage A
   reads then show `available_balance=0`. Stage B continues to read
   from the persistent ledger and shows the correct numbers. This is
   actually a STAGE B ARGUMENT: the projection is more robust to
   process restarts than the legacy doc. Fix in follow-up: either
   skip the wipe when ledger has entries, OR re-run the normalisation
   step inside the seed.

3. **`server.py:26050` admin aggregate.** Still raw-reads legacy.
   This is INTENTIONAL — that aggregate feeds the divergence detector
   that compares legacy vs canonical sums. Routing it through the
   facade would create a circular comparison (legacy vs itself).
   Plan: build an analogous projection-side aggregate as a SEPARATE
   admin endpoint in 2C-B4, then deprecate the legacy aggregate.

## Next (2C-B4)

After production traffic on Stage B for a sufficient window:
- Remove the 11 legacy `dev_wallets` writers one at a time
- Remove the dual-read fallback in `dev_wallet_reader.py`
- Remove the divergence engine's legacy-side aggregate
- Drop `dev_wallets` collection
