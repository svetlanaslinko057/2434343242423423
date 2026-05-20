# Phase 2C-B4.0 — Acceptance Report

**Date:** Feb 2026 (session-restart verification)
**Scope:** verify the B4.0 code change (DEV POOL boot-time `delete_many` removed + `insert_many` made idempotent) holds live, then re-run the full acceptance contract on the current build.

## 1. Inventory verification (live grep)

Live `grep -rn 'db.dev_wallets.(insert|update|delete|...)' /app/backend` returned the following production-path writers (test-only writers excluded):

| # | file:line | function | op | trigger | class | status after B4.0 |
|---|---|---|---|---|---|---|
| 1 | `server.py:9789` (comment-only) | `seed_dev_pool` boot — wipe | — | — | **B-seed** | ✅ **REMOVED** (was `delete_many`) |
| 2 | `server.py:9882` | `seed_dev_pool` boot — insert | `insert_many` (gated) | every backend boot | **B-seed** | 🟡 **NEUTRALISED** (idempotent — only inserts user_ids that do not yet exist) |
| 3 | `server.py:11187` | `_credit_module_reward` | `update_one $inc` | client approves module | **A-mirrored** | unchanged (B4.1) |
| 4 | `server.py:11468` | request withdraw — CAS reserve | `update_one $inc` | dev requests payout | **D-business** | unchanged (B4.3) |
| 5 | `server.py:11514` | request withdraw — refund | `update_one $inc` | error path of #4 | **D-business** | unchanged (B4.3) |
| 6 | `server.py:11559` | dev cancels withdrawal | `update_one $inc` | dev cancels | **D-business** | unchanged (B4.3) |
| 7 | `server.py:11651` | admin marks-paid | `update_one $inc` | admin processes payout | **A-mirrored** | unchanged (B4.2) |
| 8 | `server.py:11703` | admin rejects withdrawal | `update_one $inc` | admin rejects | **D-business** | unchanged (B4.3) |
| 9 | `seed_money_demo.py:304` | demo credit | `update_one $inc` | demo injector | **B-seed** | unchanged (B4.0.1) |
| 10 | `seed_money_demo.py:414` | demo payout request | `update_one $inc` | demo injector | **B-seed** | unchanged (B4.0.1) |
| 11 | `seed_money_demo.py:445` | demo mark paid | `update_one $inc` | demo injector | **B-seed** | unchanged (B4.0.1) |
| 12 | `mock_seed.py:253` | mock seed wallet | `update_one upsert` | mock injector | **B-seed** | unchanged (B4.0.1) |

Note: original plan counted #1+#2 separately (delete + insert). After B4.0 only #2 remains, and it is **idempotent** — verified live by tagging existing rows with a canary field and confirming the canary survived a backend restart, with `wallet_inserted=0` reported in boot logs.

### Class summary (post-B4.0)

| Class | Count | Eligibility |
|---|---:|---|
| A — already mirrored by MoneyService | 2 (#3, #7) | safe to remove in B4.1 / B4.2 |
| B — seed/demo-only | 5 (#2 idempotent + #9–#12) | #2 already neutralised; #9–#12 = B4.0.1 |
| C — diagnostic/admin-only | 0 | n/a |
| D — still business-critical legacy | 4 (#4, #5, #6, #8) | **DO NOT touch** until `pending_withdrawal` is modelled in the canonical ledger |

## 2. Live acceptance probes

| # | Probe | Expected | Observed | Verdict |
|---|---|---|---|---|
| 1 | Tag 7 `dev_wallets` rows, restart backend | 7/7 docs survive with canary intact | 7/7 carry canary; `DEV POOL: ... 0 new wallets (existing preserved)` in boot log | ✅ PASS |
| 2 | `replay-seed-money-bridge.py` first run from baseline | `pool_seed=6 already_converged=0 orphan_preserved=1` | `pool_seed=6 already_converged=0 orphan_preserved=1` | ✅ PASS |
| 3 | Re-run replay (must no-op) | `pool_seed=0 already_converged=6 orphan_preserved=1` | `pool_seed=0 already_converged=6 orphan_preserved=1` | ✅ PASS |
| 4 | Stability probe POST-replay (5 runs) | `{matches: 6, mock_orphan: 1}` identical across all 5 runs, checksums steady | 5/5 runs: `{matches: 6, mock_orphan: 1}` checksum `d9d2e713b8a5…` | ✅ PASS |
| 5 | Tag converged state, restart backend, re-tag check | converged state survives; histogram unchanged | 7/7 canary survived; stability probe POST-restart still `{matches: 6, mock_orphan: 1}`, checksum `d9d2e713b8a5…` | ✅ PASS |
| 6 | `WARN dev_wallet_read.mismatch` count in backend logs | 0 | 0 in `backend.err.log` + 0 in `backend.out.log` | ✅ PASS |
| 7 | Architecture tests (`tests/architecture/test_layering.py`) | 7 passed, 1 skipped, including `test_one_writer_per_collection_does_not_grow` and `test_only_money_domain_writes_to_money_collections` | 7 passed, 1 skipped (0.15 s) | ✅ PASS |
| 8 | Unit tests (`test_dev_wallet_projection.py` + `test_dev_wallet_reader.py`) | all pass | 19 passed (0.04 s) | ✅ PASS |

### Architecture invariants (post-B4.0)
- ✅ `test_one_writer_per_collection_does_not_grow` — no new writer added to the legacy collection.
- ✅ `test_only_money_domain_writes_to_money_collections` — `dev_wallets_projection` writer count remains 1 (`money_projections.py`).
- ✅ `test_silent_except_does_not_grow` — no new bare excepts introduced.
- ✅ `test_no_new_giant_functions` / `test_file_size_*` — no regression.

## 3. What B4.0 actually changed (already in `server.py`)

```python
# Lines 9788–9798 — the destructive boot-time wipe is GONE:
# Phase 2C-B4.0 — DEV POOL boot-time wallet wipe REMOVED.
# Previously this block also did `db.dev_wallets.delete_many({...})`
# which destroyed canonical-form rows (normalised by
# `replay-seed-money-bridge.py`) on every backend restart. ...

# Lines 9869–9885 — insert is now gated on existence:
if wallet_bulk:
    existing = await db.dev_wallets.find(
        {"user_id": {"$in": dev_pool_ids}},
        {"_id": 0, "user_id": 1},
    ).to_list(50)
    seeded_ids = {r["user_id"] for r in existing}
    new_rows = [w for w in wallet_bulk if w["user_id"] not in seeded_ids]
    if new_rows:
        await db.dev_wallets.insert_many(new_rows)
    wallet_inserted = len(new_rows)
else:
    wallet_inserted = 0
```

Observed runtime impact (boot log): `DEV POOL: seeded 6 devs, 89 modules, 81 qa decisions, 0 new wallets (existing preserved)` — proves the gated insert is a no-op once seeded.

## 4. Out-of-scope (preserved per user contract)

- ❌ Removing all 11 remaining writers
- ❌ Dropping `dev_wallets` collection
- ❌ Disabling `money_divergence.py`
- ❌ Removing `replay-seed-money-bridge.py`
- ❌ Switching payout writes directly to canonical model
- ❌ Touching writers #3 (A), #4–#6 (D), #7 (A), #8 (D), #9–#12 (B seed/demo)

## 5. Next sub-phases (per plan)

| Sub-phase | Removes | Class | Status |
|---|---|---|---|
| **B4.0** | DEV POOL boot wipe + reinsert (now idempotent) | B-seed | ✅ ACCEPTED |
| B4.0.1 | `seed_money_demo.py` (#9–#11) + `mock_seed.py` (#12) | B-seed | next-eligible |
| B4.1 | `_credit_module_reward` legacy write (#3) | A-mirrored | requires bridge-coverage proof |
| B4.2 | admin mark-paid legacy write (#7) | A-mirrored | requires bridge-coverage proof |
| B4.3 | pending_withdrawal lifecycle (#4, #5, #6, #8) | D-business | requires canonical model for in-flight payout |
| B4.4 | `dev_wallets` → diagnostic only | — | depends on B4.1–B4.3 |
| B4.5 | divergence engine → passive observer | — | last |

## 6. Honest disclosure

1. **#2 (insert_many)** is **not removed**, only neutralised. On a truly fresh DB it still seeds the legacy `dev_wallets` rows once. The replay script then converges them to canonical form. B4.0.1 will remove the dependency on these seeds by hardcoding amounts in the replay script itself.
2. The architecture test that the user originally referenced as `7 passed, 1 skipped` in the plan now reports the same: **7 passed, 1 skipped** — confirmed live.
3. Stability probe **wrote `PHASE_2C_B2_DEV_WALLETS_STABILITY_2026-05-20.md`** in this run (it auto-stamps the date). The B4.0 acceptance does not depend on the file name; the invariants are what matters and they hold.

## 7. Verdict

**Phase 2C-B4.0 — ACCEPTED.**

All acceptance criteria from the user contract met live:
- backend restart does NOT wipe projection-supporting legacy state
- Stage B projection balances still serve user-facing reads (verified by checksum stability)
- `replay-seed-money-bridge.py` is no-op on second run
- stability probe `{matches: 6, mock_orphan: 1}` — steady-state
- WARN mismatch count = 0
- architecture tests green
- unit tests green

System is ready to accept **B4.0.1** (remove the 4 remaining B-seed writers: `seed_money_demo.py` × 3 + `mock_seed.py` × 1) on user's go-ahead.
