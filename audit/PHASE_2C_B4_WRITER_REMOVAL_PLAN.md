# Phase 2C-B4 — legacy writer removal plan + first safe removal

**Date:** Feb 2026
**Scope of THIS PR:** inventory all `dev_wallets` writers, classify, remove the **DEV POOL boot-time reseed wipe** (the writer that caused the boot-reset pain hit twice during 2C-B3.1).

## Inventory (12 writers — `db.dev_wallets.{delete,insert,update}` across `/app/backend`)

| # | file:line | function / context | op | trigger | legacy purpose | projection replacement | class | risk |
|---|---|---|---|---|---|---|---|---|
| 1 | `server.py:9788` | `seed_dev_pool` boot hook | `delete_many` | every backend boot | wipe pool wallets before reseed | none (ledger persists) | **B-seed** | LOW |
| 2 | `server.py:9860` | `seed_dev_pool` boot hook | `insert_many` | every backend boot | reinsert pool wallets with `earned_lifetime/paid_lifetime` only | replay-seed-money-bridge.py canonical chain | **B-seed** | LOW |
| 3 | `seed_money_demo.py:304` | demo bootstrap — credit module | `$inc earned/available` | demo data injector | demo earnings progression | `MoneyService.release_escrow` (could be) | **B-seed** | LOW |
| 4 | `seed_money_demo.py:414` | demo bootstrap — request payout | `$inc available -=/pending +=` | demo data injector | demo withdrawal request | `MoneyService.process_payout` (could be) | **B-seed** | LOW |
| 5 | `seed_money_demo.py:445` | demo bootstrap — mark paid | `$inc pending -=/withdrawn +=` | demo data injector | demo payout completion | `MoneyService.process_payout` (could be) | **B-seed** | LOW |
| 6 | `mock_seed.py:253` | mock seed — wallet setup | `update_one upsert` | mock data injector | demo wallet bootstrap | replay-seed-money-bridge.py | **B-seed** | LOW |
| 7 | `server.py:11162` | `_credit_module_reward` | `$inc earned/available` | client approves module | **core business — money creation** | `MoneyService.release_escrow` (already mirrored by Phase 2B PR-1 bridge) | **A-mirrored** | MEDIUM |
| 8 | `server.py:11443` | dev request withdraw — CAS reserve | `$inc available -=/pending +=` | dev requests payout | **core business — reserve** | `MoneyService.process_payout` partial (pending is not in ledger model) | **D-business** | HIGH |
| 9 | `server.py:11489` | request withdraw — insert-error refund | `$inc available +=/pending -=` | error path of #8 | **safety net for #8** | tied to #8 | **D-business** | HIGH |
| 10 | `server.py:11534` | dev cancels withdrawal | `$inc pending -=/available +=` | dev cancels | **core business — restore** | tied to #8 | **D-business** | HIGH |
| 11 | `server.py:11626` | admin marks-paid | `$inc pending -=/withdrawn +=` | admin processes payout | **core business — completion** | `MoneyService.process_payout` (already mirrored by Phase 2B PR-3 bridge) | **A-mirrored** | MEDIUM |
| 12 | `server.py:11678` | admin rejects withdrawal | `$inc pending -=/available +=` | admin rejects | **core business — restore** | tied to #8 | **D-business** | HIGH |

### Classification summary

| Class | Count | Removal eligibility |
|---|---:|---|
| **A — already mirrored by MoneyService** | 2 (#7, #11) | safe to remove after observation that bridge still runs |
| **B — seed/demo-only** | 6 (#1, #2, #3, #4, #5, #6) | safe to remove NOW (no production money path) |
| **C — diagnostic/admin-only** | 0 | n/a |
| **D — still business-critical legacy** | 4 (#8, #9, #10, #12) | **DO NOT touch yet** — `pending_withdrawal` is not in the canonical ledger model |

## Removal order (sequence for future B4.x sub-phases)

| Sub-phase | Removes | Why this order |
|---|---|---|
| **B4.0** (this PR) | #1 + #2 (DEV POOL boot wipe + reinsert) | caused the only operational pain hit so far; pure dev-time seed; no business path |
| B4.0.1 | #3, #4, #5, #6 (demo seeds, mock seeds) | same class as B4.0; isolated to demo flows |
| B4.1 | #7 (`_credit_module_reward` direct write) | class A — bridge already runs canonical; drop the legacy double-write |
| B4.2 | #11 (admin mark-paid direct write) | class A — bridge already runs canonical; drop legacy |
| B4.3 | #8 + #9 + #10 + #12 as a single set (pending_withdrawal lifecycle) | class D — requires designing `pending_withdrawal` semantics into the canonical model OR keeping these as the canonical writer for in-flight payout state |
| B4.4 | `dev_wallets` collection → diagnostic only | only after every read switched + every writer either removed or accepted-as-canonical |
| B4.5 | divergence engine → passive observer | last step; flip its compare to compare projection vs projection-of-replay |

## What B4.0 actually changes

```diff
--- a/backend/server.py  (seed_dev_pool function, ~line 9787)
@@ around the existing wipe + reinsert block
-    await db.dev_wallets.delete_many({"user_id": {"$in": dev_pool_ids}})
+    # Phase 2C-B4.0 — boot-time DEV POOL wallet wipe REMOVED. The
+    # legacy `dev_wallets` doc is now a one-shot bootstrap (insert if
+    # not exists); the ledger is the durable source. Re-running this
+    # hook never destroys existing balances.

@@ around the existing insert_many
-    if wallet_bulk:
-        await db.dev_wallets.insert_many(wallet_bulk)
+    if wallet_bulk:
+        # Phase 2C-B4.0 — idempotent bootstrap. Only insert pool wallet
+        # rows that do not yet exist; subsequent boots no-op. Restores
+        # to the original `seed_money_bridge_replay` script its input
+        # (the seed amounts in dollar form) while removing the
+        # destructive wipe that erased prior-boot state.
+        existing = await db.dev_wallets.find(
+            {"user_id": {"$in": dev_pool_ids}},
+            {"_id": 0, "user_id": 1},
+        ).to_list(50)
+        seeded_ids = {r["user_id"] for r in existing}
+        new_rows = [w for w in wallet_bulk
+                    if w["user_id"] not in seeded_ids]
+        if new_rows:
+            await db.dev_wallets.insert_many(new_rows)
```

Net effect:
- `delete_many` — **REMOVED**. The actual writer that destroyed state on every boot is gone.
- `insert_many` — kept, but **gated on existence**. On fresh DB it bootstraps; on subsequent boots it is a no-op.

## Acceptance for B4.0 (per user contract)

| Criterion | Expected | Result |
|---|---|---|
| backend restart no longer wipes useful projection state | yes | ✅ verified — second boot leaves `dev_wallets` rows untouched |
| Stage B still returns projection balances | yes | ✅ alice still shows `1260/8400/7140` after restart |
| replay-seed-money-bridge.py no-ops on second run | yes | ✅ `already_converged=6 orphan_preserved=2` |
| stability probe still `{matches: 6, mock_orphan: 1}` | yes (+`legacy_only:1` for demo_dev_001 which is unaffected) | ✅ stable |
| `WARN dev_wallet_read.mismatch` count = 0 | yes | ✅ 0 |
| architecture tests green | yes | ✅ 7 passed, 1 skipped |
| unit tests green | yes | ✅ 26 passed |

## Out-of-scope for B4.0 (per user contract)

- ❌ Removing all 12 writers
- ❌ Dropping `dev_wallets` collection
- ❌ Disabling divergence engine
- ❌ Removing `replay-seed-money-bridge.py`
- ❌ Switching payout writes directly to canonical model
- ❌ Touching writers #3 — #6, #7 — #12

## Honest disclosure

After B4.0, on a **truly fresh database** the DEV POOL still seeds
legacy `dev_wallets` rows once (the idempotent path). That insert is
classified as a B-seed writer and will be removed in B4.0.1 once we
can prove the replay script can bootstrap directly from a hardcoded
amount table instead of reading the legacy doc. That's a one-line
change to the replay script and is intentionally kept separate so the
B4.0 diff is auditable on its own.
