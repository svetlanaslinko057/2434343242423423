# Phase 2C-B4.1 — Acceptance Report

**Date:** Feb 2026
**Scope:** remove the direct legacy `dev_wallets.update_one` write from the admin mark-paid handler. Canonical `money_ledger_events` becomes the sole writer for this path.

## 1. The single change

`server.py:11704-11710` — DELETED the legacy `$inc pending→withdrawn` block.

```diff
-    # Sole winner of the CAS — now it's safe to drain pending → withdrawn.
-    w = await db.dev_withdrawals.find_one({"withdrawal_id": withdrawal_id}, {"_id": 0})
-    await db.dev_wallets.update_one(
-        {"user_id": w["user_id"]},
-        {"$inc": {
-            "pending_withdrawal": -float(w["amount"]),
-            "withdrawn_lifetime": float(w["amount"]),
-        }, "$set": {"updated_at": now_iso}},
-    )
-    logger.info(f"DEV WITHDRAW PAID ...")
-
-    # Phase 2B PR-3 — canonical mirror: ...
-    await _money_bridge.bridge_payout_processed(...)
+    # Sole winner of the CAS — now drive the canonical payout.
+    w = await db.dev_withdrawals.find_one({"withdrawal_id": withdrawal_id}, {"_id": 0})
+    # [B4.1 audit comment: legacy `dev_wallets.update_one $inc` REMOVED;
+    #  `dev_wallets_projection` (derived from canonical) is now the sole
+    #  user-facing source of truth for this transition.]
+    logger.info(f"DEV WITHDRAW PAID ...")
+    # Phase 2B PR-3 — canonical write (now sole writer): ...
+    await _money_bridge.bridge_payout_processed(...)
```

What stays:
- The `dev_withdrawals` CAS (the actual lock — D-class lifecycle, untouched)
- The `bridge_payout_processed` call (now the sole writer)
- All other paths (`request_developer_withdrawal`, `cancel_developer_withdrawal`, `admin_reject_withdrawal`) — D-class business writers, NOT touched per B4.1 scope.

## 2. Live end-to-end test

**Setup:**
- Pool dev: `alice.kim@atlas.dev` (`user_d700fcee8501`)
- Pre-state: projection `avail=$1260, withdrawn=$7140`; legacy mirror identical
- Manually inflated legacy `pending_withdrawal=$50, available_balance=$1210` (mimicking the request-withdraw step which is D-class)
- Created an `approved` withdrawal: `w_814cde8ca5` for `$50`

**Action:** `POST /api/admin/withdrawals/w_814cde8ca5/mark-paid` (admin auth)

**Response:** `{"ok": true, "withdrawal_id": "w_814cde8ca5", "status": "paid"}` — 200

**Observed state changes:**

| Layer | Field | Before | After | Δ | Expected |
|---|---|---|---|---|---|
| `dev_withdrawals` | status | approved | paid | flipped | ✅ |
| `dev_wallets` (legacy) | withdrawn_lifetime | $7140 | **$7140** | **0** | ✅ — no legacy write (B4.1 success criterion) |
| `dev_wallets` (legacy) | pending_withdrawal | $50 | **$50** | **0** | ✅ — stays drifted (D-class still owns this field) |
| `dev_wallets` (legacy) | available_balance | $1210 | $1210 | 0 | ✅ — not in mark-paid path |
| `money_ledger_events` | entries for this withdrawal | 0 | **2** | **+2** | ✅ — `ac_dev:* debit + ac_ext:* credit`, both `kind=payout`, idem_key `legacy_payout_processed:w_814cde8ca5:rev0#{debit,credit}` |
| `dev_wallets_projection` | withdrawn_lifetime_cents | 714000 | **719000** | **+5000** | ✅ — projection reflects $50 payout from canonical |
| `dev_wallets_projection` | available_balance_cents | 126000 | **121000** | **−5000** | ✅ |
| `dev_wallets_projection` | source | ledger | ledger | unchanged | ✅ |

**Divergence verification (expected by design):**
```
LEGACY withdrawn_lifetime: $7140.0  (B4.1 keeps this static — no legacy write)
PROJ   withdrawn_lifetime_cents: 719000 ($7190)
Δ: 5000 cents (= $50.00, exactly the payout amount)
```
This divergence is the **invariant proof** that B4.1 worked: the canonical side moved, the legacy side did not.

## 3. Acceptance probes — all PASS

| # | Probe | Expected | Observed | Verdict |
|---|---|---|---|---|
| 1 | Admin mark-paid mutates **canonical ledger only** | 2 new entries in `money_ledger_events`; 0 mutations to `dev_wallets` | 2 ledger entries; legacy `withdrawn_lifetime` unchanged from $7140 | ✅ PASS |
| 2 | Projection balance updates correctly | `withdrawn_lifetime_cents` +5000; `available_balance_cents` −5000 | Exactly +5000 / −5000 | ✅ PASS |
| 3 | User-facing wallet reflects payout without legacy write | `projection.source=ledger`, `withdrawn_lifetime_cents=719000` | Confirmed live via `GET /api/admin/money/projections/dev-wallets/user_d700fcee8501` | ✅ PASS |
| 4 | Payout eligibility remains correct | Withdrawal flipped `approved→paid` exactly once | CAS won on first call; second call returned `{"ok": true, "already": true}` | ✅ PASS |
| 5 | Idempotency (re-call) | No duplicate ledger entries, no double-mutation | Ledger entry count stays at 2 after re-call (idem keys: `…#debit`, `…#credit`) | ✅ PASS |
| 6 | No new WARN mismatch | `WARN dev_wallet_read.mismatch` count stays at 0 | 0 in `backend.err.log` + 0 in `backend.out.log` | ✅ PASS |
| 7 | Divergence engine remains stable | Stability probe produces a steady, repeatable classification across multiple runs | 3 consecutive runs all returned `{diverged: 1, matches: 5}`, checksum `0724168f18b2…` identical | ✅ PASS |
| 8 | Architecture tests | `test_silent_except_does_not_grow` + `test_one_writer_per_collection_does_not_grow` + 5 others | 7 passed, 1 skipped (silent except count = 64, no growth) | ✅ PASS |
| 9 | Unit tests (`test_dev_wallet_projection.py` + `test_dev_wallet_reader.py`) | All pass | 19 passed (0.04 s) | ✅ PASS |
| 10 | Stability probe — written/unchanged | rows=6 written=0 unchanged=6 | Exactly that across 3 runs | ✅ PASS |

### About the `diverged: 1` in the stability probe

The single `diverged` classification is **expected and correct**. It is `user_d700fcee8501` (alice.kim) — the dev I just paid $50 to. The divergence engine correctly flags:

```
legacy.withdrawn_lifetime = 7140.0   ← B4.1: no longer mutated by admin mark-paid
canonical.ac_ext credit  = 719000¢    ← B4.1: now sole writer
diff_cents.withdrawn_lifetime = +5000 ← matches the test payout exactly
```

This is the divergence engine working **as designed**: legacy mirror is now drifting from canonical, and the engine surfaces it transparently. The orphan canary from `mock_seed.py` is the other half of this invariant — both prove the engine can detect legacy/canonical drift.

## 4. Rollback path (documented in code)

If a regression is observed in production, B4.1 can be reverted by re-inserting the deleted block at `server.py:11703` (between the CAS and the bridge call):

```python
    await db.dev_wallets.update_one(
        {"user_id": w["user_id"]},
        {"$inc": {
            "pending_withdrawal": -float(w["amount"]),
            "withdrawn_lifetime": float(w["amount"]),
        }, "$set": {"updated_at": now_iso}},
    )
```

After revert, run `python3 /app/scripts/replay-seed-money-bridge.py` — the legacy mirror will be re-materialised from canonical (legacy + canonical converge back to `{matches: 6, mock_orphan: 1}` shape).

The revert is **idempotent at the canonical layer** — the bridge's `legacy_payout_processed:<wid>:rev0` idempotency key means re-calling mark-paid after revert produces zero additional ledger entries for that withdrawal.

## 5. What was preserved (per peeling discipline)

| Component | Status | Verified |
|---|---|---|
| `dev_wallets` legacy collection | STAYS | live in DB, still queryable, still mirrored by replay script |
| `money_divergence.py` engine | STAYS | stability probe ran cleanly, surfaced the expected drift |
| Payout projections (dual-observable) | STAYS | `GET /api/admin/money/projections/dev-wallets/{user_id}` returns both projection + comparison block |
| `replay-seed-money-bridge.py` | STAYS available | still idempotent, still re-materialises legacy mirror |
| Admin diagnostics legacy-aware | STAYS | divergence endpoint still able to compare legacy vs canonical (the test proves it works — it correctly identified the divergence) |
| All A/B/C/D writers except #5 (admin mark-paid) | UNTOUCHED | live grep shows 5 writers in `server.py` (down from 6), 1 in `mock_seed.py` (C-diagnostic, intentional) |

## 6. Remaining writer inventory (post B4.1)

| # | file:line | function | class | next phase |
|---|---|---|---|---|
| 1 | `server.py:11240` | `_credit_module_reward` | A-mirrored | **B4.2** (next, per user) |
| 2 | `server.py:11521` | request withdraw — CAS reserve | D-business | B4.3 |
| 3 | `server.py:11567` | request withdraw — refund safety | D-business | B4.3 |
| 4 | `server.py:11612` | cancel withdrawal | D-business | B4.3 |
| ~~5~~ | ~~`server.py:11704` admin mark-paid~~ | ~~A-mirrored~~ | ✅ **REMOVED in B4.1** | — |
| 6 | `server.py:11756` | admin reject withdrawal | D-business | B4.3 |
| 7 | `mock_seed.py:266` | orphan canary fixture | C-diagnostic | never (or explicit canary phase) |

5 production writers remain in `server.py` (4 D-business + 1 A-mirrored) + 1 C-diagnostic in `mock_seed.py`.

## 7. Verdict

**Phase 2C-B4.1 — ACCEPTED.**

Admin mark-paid is now a **canonical-only operation**:
- `dev_withdrawals` CAS is the lock (D-class lifecycle, untouched)
- `bridge_payout_processed` is the sole money-moving writer
- `dev_wallets_projection` reflects user-facing balance directly from `money_ledger_events`
- Legacy `dev_wallets.withdrawn_lifetime` and `pending_withdrawal` are now **drifted by design** for any withdrawal paid post-B4.1, and that drift is **surfaced** by the divergence engine and stability probe.

System is ready to accept **B4.2 — remove `_credit_module_reward` legacy write (A-mirrored)** on user's go-ahead. Note: `_credit_module_reward` is closer to earnings lifecycle and accrual semantics; expect to verify `task_earnings` projection coverage before removing the legacy write.
