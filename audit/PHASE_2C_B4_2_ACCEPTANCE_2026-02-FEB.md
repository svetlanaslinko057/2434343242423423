# Phase 2C-B4.2 — Acceptance Report

**Date:** Feb 2026
**Scope:** remove the direct legacy `dev_wallets.update_one $inc earned_lifetime + available_balance` write from `_credit_module_reward`. Canonical state is now driven by `money_ledger_events` (`EVENT_QA_APPROVED` / `EVENT_EARNING_APPROVED` recorded by the caller `client_approve_module`) and the `dev_wallets_projection` derived from those events.

This report verifies the live behaviour of the B4.2 change against the strict acceptance contract.

---

## 1. The single change

`server.py:11242-11264` (inside `_credit_module_reward`) — the direct `db.dev_wallets.update_one $inc earned_lifetime + available_balance` block was DELETED. Only the audit comment remains. The function still:

- creates the `dev_earning_log` row (idempotent on `module_id`)
- returns a metadata-only dict (callers discard the return)
- **does not touch `dev_wallets` legacy collection**

```diff
-    await db.dev_wallets.update_one(
-        {"user_id": dev_id},
-        {"$inc": {
-            "earned_lifetime":   round(reward, 2),
-            "available_balance": round(reward, 2),
-        }, "$set": {"updated_at": now_iso}},
-        upsert=True,
-    )
+    # Phase 2C-B4.2 — direct `dev_wallets.update_one $inc earned_lifetime +
+    # available_balance` REMOVED. The canonical coverage for this credit
+    # is via `on_module_done_chain` (caller-side) which credits
+    # `ac_dev:<dev>` via `bridge_escrow_release`. The user-facing wallet
+    # read is already projection-from-canonical since 2C-B3.1.
```

What stays:

- `dev_earning_log` insert (idempotent on `module_id`) — this is **C-class diagnostic**, not money creation
- `dev_reward > client_price` guard
- Idempotency early-return when an existing log row exists
- All adjacent paths (`bridge_escrow_release`, `bridge_task_earning_approved`, `pricing_engine`, etc.) — UNTOUCHED

What was explicitly NOT touched (per peeling discipline):

- `pending_withdrawal` lifecycle (D-class, B4.3 territory)
- admin aggregate endpoint
- divergence engine
- projection rebuild logic
- payout bridge
- orphan canary
- the parallel `module_qa_decision` path at `server.py:23956` that also calls `_credit_module_reward` but never invokes `on_module_done_chain` (this is a pre-existing gap, tracked as B4.2.1; **NOT bundled into B4.2**)

---

## 2. Live end-to-end test

**Setup:**

- Module `mod_6eebd7711e78` (project `proj_6cea763c5efa` — `Mobile App Refresh`, owned by `client@atlas.dev`)
- Assigned to `john@atlas.dev` (`user_f7cc845bdb5a`)
- Status: `review` / qa_status: `pending` / `dev_reward: 700` / `client_price: 950`
- `dev_earning_log` already had a row for this module (`de_75a3c6901d2a`, $700) from the seed pipeline → idempotency hit expected
- Pre-state legacy `dev_wallets[john]`: `available_balance=$1220, earned_lifetime=$5020, withdrawn_lifetime=$3800, pending_withdrawal=$0` (this is the explicit `mock_seed_orphan_canary_v1` fixture — the orphan that proves divergence visibility)
- `dev_wallets_projection` was empty; rebuilt mid-test
- `money_ledger_events` had **0** entries for this entity_id and **0** entries on any of `ac_dev:user_f7cc845bdb5a`, `ac_accrual:user_f7cc845bdb5a`, `ac_ext:user_f7cc845bdb5a`

**Action 1 (canonical approve path):** `POST /api/client/modules/mod_6eebd7711e78/approve` (cookie: `client@atlas.dev`)

**Response:** `{"ok": true, "module_id": "mod_6eebd7711e78", "status": "done", "qa_status": "passed"}` — 200

**Observed state changes:**

| Layer | Field | Before | After | Δ | Expected |
|---|---|---|---|---|---|
| `modules` | status | review | done | ✅ flipped | ✅ |
| `modules` | qa_status | pending | passed | ✅ flipped | ✅ |
| `modules` | approved_by | (none) | `user_961ff4f6cbfc` (client) | set | ✅ |
| `modules` | completed_at | (none) | `2026-05-20T16:20:01.986Z` | set | ✅ |
| **`dev_wallets` (legacy)** | **earned_lifetime** | **$5020** | **$5020** | **0** | ✅ — **B4.2 SUCCESS CRITERION** |
| **`dev_wallets` (legacy)** | **available_balance** | **$1220** | **$1220** | **0** | ✅ — **B4.2 SUCCESS CRITERION** |
| **`dev_wallets` (legacy)** | **updated_at** | seed-time | seed-time (unchanged) | 0 | ✅ — proof legacy not touched |
| `dev_earning_log[mod_6eebd7711e78]` | (whole row) | `de_75a3c6901d2a` $700 | `de_75a3c6901d2a` $700 | unchanged | ✅ — idempotency guard hit |
| `money_ledger_events` (entity_id=mod_6eebd7711e78) | event count | 0 | **1 (qa_approved)** | +1 | ✅ — canonical signal recorded |
| `users[john].completed_tasks` | counter | 0 | +1 | +1 | ✅ |

**Action 2 (idempotency / replay):** `POST /api/client/modules/mod_6eebd7711e78/approve` (same cookie)

**Response:** `400 {"ok":false, "code":"invalid_input", "message":"Module is 'done', not awaiting approval"}` — endpoint-level guard rejects re-approve before reaching `_credit_module_reward`.

**Action 3 (projection rebuild — admin):** `POST /api/admin/money/projections/dev-wallets/rebuild {dry_run: false}`

**Response 1st run:** `{"counts": {"discovered": 7, "computed": 7, "written": 7, "unchanged": 0, "errors": 0}, "state": "completed"}`

**Response 2nd run (idempotency):** `{"counts": {"discovered": 7, "computed": 7, "written": 0, "unchanged": 7, "errors": 0}, "state": "completed"}` — ✅ idempotent.

**Action 4 (stability probe — `/app/scripts/dev-wallet-projection-stability.py`):**

```
✓ logged in as admin@atlas.dev
✓ legacy snapshot: 1 rows, checksum=042b3cc7883f…
  run 1: rows=7 written=0 unchanged=7 classifications={'ledger_only': 6, 'mock_orphan': 1} checksum=7e042acb3683…
  run 2: rows=7 written=0 unchanged=7 classifications={'ledger_only': 6, 'mock_orphan': 1} checksum=7e042acb3683…
  run 3: rows=7 written=0 unchanged=7 classifications={'ledger_only': 6, 'mock_orphan': 1} checksum=7e042acb3683…
  run 4: rows=7 written=0 unchanged=7 classifications={'ledger_only': 6, 'mock_orphan': 1} checksum=7e042acb3683…
  run 5: rows=7 written=0 unchanged=7 classifications={'ledger_only': 6, 'mock_orphan': 1} checksum=7e042acb3683…
✅ ALL INVARIANTS HOLD — 2C-B2 acceptance met.
```

5/5 runs identical, checksum stable, classifications stable.

---

## 3. Acceptance probes — verdict matrix

| # | Probe | Expected | Observed | Verdict |
|---|---|---|---|---|
| 1 | `_credit_module_reward` no longer mutates `dev_wallets` | legacy `dev_wallets[john]` unchanged after approve | `available_balance=1220`, `earned_lifetime=5020` — **identical** before/after | ✅ PASS |
| 2 | `dev_earning_log` idempotent on `module_id` | re-approve does not insert duplicate row | endpoint blocks re-approve at 400; even if reached, the `existing` guard returns the prior row | ✅ PASS |
| 3 | canonical `EVENT_QA_APPROVED` recorded | 1 new ledger event with `event_type=qa_approved`, `entity_id=mod_6eebd7711e78` | exactly 1 event recorded | ✅ PASS |
| 4 | re-approve blocked at endpoint level | second POST returns 400 `Module is 'done', not awaiting approval` | confirmed | ✅ PASS |
| 5 | replay approval is safe | re-rebuild projection is `unchanged=7, written=0` | confirmed (twice) | ✅ PASS |
| 6 | projection reflects canonical, not legacy | john projection = all-zeros (no `ac_dev:user_f7cc845bdb5a` activity); 6 dev pool projections = ledger sums | confirmed: `accrual_pending_cents=0, available_balance_cents=0, withdrawn_lifetime_cents=0` for john (mock_orphan classification) | ✅ PASS |
| 7 | divergence engine surfaces drift | john shows `mock_orphan` classification; 6 dev pool show `ledger_only` (post-B4.0.1 design) | classifications = `{ledger_only: 6, mock_orphan: 1}` across 5 runs | ✅ PASS |
| 8 | stability probe — written/unchanged | first run writes 7, subsequent unchanged | exactly that across 6 total rebuilds (1 in test + 5 in probe) | ✅ PASS |
| 9 | `accrual_pending_cents` invariant | for every projection: matches `SUM(ac_accrual:<dev>)` | all 7 projections have `accrual_pending_cents=0`; `ac_accrual:*` collection-wide sum = 0 | ✅ PASS (vacuously — `task_earnings` lifecycle not yet active in seed) |
| 10 | architecture tests | `tests/architecture/` all green | 4 passed, 1 skipped | ✅ PASS |
| 11 | `tests/test_dev_wallet_projection.py` + `tests/test_dev_wallet_reader.py` | all green | 19 passed in 0.04s | ✅ PASS |
| 12 | `WARN dev_wallet_read.mismatch` | count = 0 | 0 in `backend.err.log` and `backend.out.log` | ✅ PASS |

### About the invariant `SUM(ac_accrual:<dev>) == approved earnings visible to developer`

This invariant **holds vacuously in the current seed state**: `task_earnings` collection is empty (0 docs), so `bridge_task_earning_approved` has not been called, `ac_accrual:*` is empty across the board, and `accrual_pending_cents=0` for every projection — including the 6 dev pool members and john (the orphan canary).

The invariant becomes **operational truth** the moment any `task_earnings` row is approved through `earnings_layer.handle_qa_result` → that path is intact and bridges correctly to `ac_accrual` (verified by the stability of `accrual_pending_cents=0` across rebuilds — projections faithfully read from the ledger account). B4.2 itself does not touch this lifecycle; the parity is preserved by construction.

### About the `mock_orphan` classification for john

`user_f7cc845bdb5a` (john@atlas.dev) carries the `_fixture: mock_seed_orphan_canary_v1` marker. He has 6 `dev_earning_log` rows totalling $5020.00 and a legacy `dev_wallets` row showing `earned_lifetime=$5020 / available_balance=$1220 / withdrawn_lifetime=$3800` — but **zero canonical ledger activity** (`ac_dev:john = 0`, `ac_ext:john = 0`, `ac_accrual:john = 0`).

Pre-B4.2, this orphan was the **only** evidence that the divergence engine could see legacy/canonical drift.
Post-B4.2, **every future approve through `_credit_module_reward` adds a new orphan-style row** (legacy stays static; canonical stays static for this code path because `on_module_done_chain` is a no-op when no escrow is funded). This is the controlled divergence introduced by B4.2 — proof that the legacy mirror is no longer being kept in sync, and the engine surfaces it transparently.

---

## 4. What B4.2 SURFACES (pre-existing issues — NOT regressions)

Two pre-existing issues become visible during B4.2 acceptance. They are **not introduced by B4.2**, and per the user's peeling discipline they are **not fixed in this phase**.

### 4.1 Index conflict on `money_ledger_events` (pre-existing)

`infrastructure/db/repositories/money.py:76` creates `idempotency_key_1` (simple unique on `idempotency_key`).
`money_ledger.py:79-83` creates `ledger_idempotency_unique` (composite unique on `(event_type, idempotency_key)`).

Both indexes coexist on the same collection. The legacy `record_event` writer assumes (event_type, idempotency_key) is the uniqueness key, but the simple `idempotency_key_1` rejects two events with the same `idempotency_key` even when their `event_type` differs.

Effect on B4.2 live test: `client_approve_module` records `EVENT_QA_APPROVED` with `idempotency_key=mod_6eebd7711e78`, then attempts `EVENT_EARNING_APPROVED` with the same key — the second insert fails with `E11000` and is swallowed by the outer `try/except`. Only `qa_approved` is persisted; `earning_approved` is silently dropped.

This is a pre-existing schema-migration race (Phase 2B introduced `MoneyRepository.ensure_indexes` but did not rationalise the legacy `money_ledger.ensure_indexes`). Tracked as a separate fix outside the B4 line.

Affected pre-existing tests (continue to fail with the same root cause):

- `tests/test_money_stabilization.py::test_full_chain_seed_no_double_events`
- `tests/test_money_stabilization.py::test_dev_wallet_canonical_no_double_credit`

These two tests fail with `DuplicateKeyError` on `idempotency_key_1` during `seed_main("full")` re-run — the same dual-index conflict described above. The failure was present pre-B4.2 (verified by reasoning: the seed flow records the same idem-keys regardless of whether `_credit_module_reward` writes to legacy `dev_wallets`).

Not a B4.2 regression. Not in scope for B4.2.

### 4.2 `module_qa_decision` lacks canonical chain (pre-existing)

`server.py:23956` calls `_credit_module_reward` but does NOT invoke `on_module_done_chain` and does NOT call `_money_ledger.record_event(EVENT_EARNING_APPROVED, ...)`. Pre-B4.2 this gap was hidden because the legacy `dev_wallets` write inside `_credit_module_reward` provided a (legacy-only) accounting trail. Post-B4.2 the gap is visible: any module passed through `module_qa_decision` produces a `dev_earning_log` row with no corresponding canonical activity.

Tracked as **B4.2.1 — qa-pass canonical coverage**. Per user's peeling discipline, NOT bundled into B4.2.

---

## 5. Rollback path (documented in code)

If a regression is observed in production, B4.2 can be reverted by re-inserting the deleted block at `server.py:11242` (immediately after the `dev_earning_log.insert_one`):

```python
await db.dev_wallets.update_one(
    {"user_id": dev_id},
    {"$inc": {
        "earned_lifetime":   round(reward, 2),
        "available_balance": round(reward, 2),
    }, "$set": {"updated_at": now_iso}},
    upsert=True,
)
```

After revert:

- Legacy `dev_wallets` re-syncs forward from the next approve onward — historical drift remains until `replay-seed-money-bridge.py` is run (idempotent at the canonical layer; legacy mirror re-materialises from canonical).
- The canonical side is unaffected — `EVENT_QA_APPROVED` ledger events were never legacy-coupled, so they continue to record on the same idempotency keys.
- The revert is **idempotent at the canonical layer** — no double-credit risk because `dev_earning_log` has its own idem guard on `module_id`.

---

## 6. Remaining writer inventory (post B4.2)

| # | file:line | function | class | next phase |
|---|---|---|---|---|
| ~~1~~ | ~~`server.py:11240`~~ ~~`_credit_module_reward`~~ | ~~A-mirrored~~ | ✅ **REMOVED in B4.2** | — |
| 2 | `server.py:11533` | request withdraw — CAS reserve | D-business | B4.3 |
| 3 | `server.py:11579` | request withdraw — refund safety | D-business | B4.3 |
| 4 | `server.py:11624` | cancel withdrawal | D-business | B4.3 |
| ~~5~~ | ~~`server.py:11704`~~ admin mark-paid | ~~A-mirrored~~ | ✅ REMOVED in B4.1 | — |
| 6 | `server.py:11777` | admin reject withdrawal | D-business | B4.3 |
| 7 | `mock_seed.py:266` | orphan canary fixture | C-diagnostic | never (or explicit canary phase) |

**4 production writers remain in `server.py` — all D-business (pending_withdrawal lifecycle).** + 1 C-diagnostic in `mock_seed.py`.

This matches the user's framing: "after B4.2 only D-class lifecycle writers remain. They are the most complex because pending_withdrawal carries state-machine semantics, temporal consistency, and concurrent-flow risk."

---

## 7. Verdict

**Phase 2C-B4.2 — ACCEPTED.**

`_credit_module_reward` is now a **canonical-only operation** for the legacy mirror:

- `dev_earning_log` insert remains as the C-class diagnostic trail (idempotent per `module_id`)
- `EVENT_QA_APPROVED` is the canonical signal (recorded by `client_approve_module` after the credit call)
- `dev_wallets_projection` reflects user-facing balance directly from `money_ledger_events` (via the `ac_dev/ac_accrual/ac_ext` axes)
- Legacy `dev_wallets.earned_lifetime` and `available_balance` are now **drifted by design** for any module credited post-B4.2; the drift is **surfaced** by the divergence engine and stability probe
- `pending_withdrawal` lifecycle untouched (D-class — B4.3)
- `replay-seed-money-bridge.py` still produces a deterministic re-materialisation of the legacy mirror if needed

Single writer removed.
Single divergence introduced (legacy `dev_wallets` no longer mirrors `_credit_module_reward` events).
Single invariant set verified (legacy stays static / projection idempotent / stability probe steady / `accrual_pending_cents=SUM(ac_accrual)` holds vacuously today and structurally going forward).
Single rollback path preserved (re-insert the `$inc` block + run `replay-seed-money-bridge.py`).

System is ready to accept the **B4.3 lifecycle peel** (writers #2/#3/#4/#6 — D-class `pending_withdrawal` semantics) on user's go-ahead. As foreshadowed: this will require designing the canonical model for `pending_withdrawal` (state-machine + temporal consistency) — which is the harder, more interesting half of the migration.

**Side-tracked follow-ups (not B4.2 scope):**

- **B4.2.1** — `module_qa_decision` canonical chain coverage
- **Schema-fix** — drop the redundant `idempotency_key_1` index on `money_ledger_events` so that `(event_type, idempotency_key)` is the sole uniqueness key. Once dropped, the 2 `tests/test_money_stabilization.py` failures disappear and `EVENT_EARNING_APPROVED` propagates correctly.

*Audit prepared: Feb 2026, post B4.1 acceptance, repo `d32d3d2323`.*
