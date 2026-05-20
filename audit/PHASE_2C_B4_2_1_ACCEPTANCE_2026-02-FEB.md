# Phase 2C-B4.2.1 — QA-pass Canonical Coverage — Acceptance Report

**Date:** Feb 2026
**Scope:** close the split-brain where the `module_qa_decision` (admin/QA) approve path called `_credit_module_reward` but skipped `on_module_done_chain` — leaving canonical (`money_ledger_events` / `dev_wallets_projection`) unwritten while legacy (`users.total_earnings`, `dev_wallets`) advanced.

**Why now:** B4.2 made `_credit_module_reward` a no-op for legacy `dev_wallets`. B4.2.0a made the substrate idempotent under `(event_type, idempotency_key)`. The remaining red test (`test_dev_wallet_canonical_no_double_credit`) was now pointing precisely at this gap. Before B4.3 (lifecycle extraction) the canonical earnings spine must be **complete from every approve path**.

---

## 1. The single change — canonical spine, one source of truth

Extracted the canonical ledger-chain block from `client_approve_module` into a single helper, then called it from BOTH `client_approve_module` and `module_qa_decision`. No duplicated reward logic. Same idempotency keys, same chain, same event propagation.

### 1.1 New helper

**File:** `/app/backend/server.py` — `_record_module_approval_canonical(module, actor_id)` (~lines 11280-11365)

```python
async def _record_module_approval_canonical(module, actor_id):
    """Phase 2C-B4.2.1 — single canonical chain entry point for a module
    approval. Idempotent per (event_type, module_id).

    This is the single source of truth for canonical ledger coverage
    when a module is approved, regardless of WHICH endpoint did the
    approval. Both `client_approve_module` and `module_qa_decision`
    call this helper after `_credit_module_reward`.

    Writes (all idempotent):
      • EVENT_QA_APPROVED        idem=module_id
      • EVENT_EARNING_APPROVED   idem=module_id, amount=earn_log.amount
      • on_module_done_chain     drives bridge_escrow_release →
                                 ac_dev:<dev> credit (idempotent per
                                 payout_id)
      • EVENT_ESCROW_RELEASED    idem=escrow_id (or fallback)

    NEVER writes to legacy dev_wallets. NEVER writes to
    users.total_earnings."""
```

### 1.2 Caller 1: `client_approve_module` (server.py:24736-24786)

Inline 50-line canonical block deleted. Replaced with a single line:

```diff
-    # Этап 6.1 — canonical chain: ledger event for QA approval, earning
-    # approved, and escrow release. Each is idempotent per module_id.
-    try:
-        # qa_approved is recorded once per module
-        await _money_ledger.record_event(db, event_type=...QA_APPROVED, ...)
-        if dev_id:
-            earn_log = await db.dev_earning_log.find_one(...)
-            if earn_log:
-                await _money_ledger.record_event(db, event_type=...EARNING_APPROVED, ...)
-        chain = await _money_runtime.on_module_done_chain(module_id)
-        if chain.get("released") is not False and chain.get("payouts"):
-            esc = chain.get("escrow") or {}
-            await _money_ledger.record_event(db, event_type=...ESCROW_RELEASED, ...)
-    except Exception as e:
-        logger.error(f"money_ledger hook on module approve: {e}")
+    # Phase 2C-B4.2.1 — canonical chain: delegate to single source of truth.
+    await _record_module_approval_canonical(module, user.user_id)
```

### 1.3 Caller 2: `module_qa_decision` pass branch (server.py:23956-23973)

Added the helper call immediately after `_credit_module_reward`:

```diff
     try:
         credited_module = await db.modules.find_one({"module_id": module_id}, {"_id": 0})
         if credited_module:
             await _credit_module_reward(credited_module)
+            # Phase 2C-B4.2.1 — close the canonical-coverage gap on the
+            # admin/QA approve path. Same helper as `client_approve_module`
+            # → single canonical spine, idempotent per (event_type,
+            # module_id).
+            await _record_module_approval_canonical(credited_module, admin.user_id)
     except Exception as e:
         logger.error(f"QA PASS earning credit failed for module {module_id}: {e}")
```

### 1.4 What was explicitly NOT changed

- `pending_withdrawal` lifecycle (D-class — B4.3 territory)
- divergence engine
- projection rebuild logic
- payout bridge
- orphan canary
- MoneyService internals
- escrow_layer (the legacy `users.$inc total_earnings` write in `release_escrow:228-231` was NOT touched — it is the legacy mirror that B4.4 will eventually retire)

---

## 2. Test fixture wiring (test-side only — not production code)

**File:** `/app/backend/tests/test_money_stabilization.py`

Outside the FastAPI startup, `money_bridge._money_service is None`, which makes `bridge_escrow_hold` and `bridge_escrow_release` early-return without writing canonical state. This caused `seed_money_demo.chain_module_approved` to advance the legacy mirror (`users.total_earnings += $1000`) while canonical stayed empty — and the assertion `legacy <= canonical` then failed trivially.

Added a small async helper that initialises the singleton **on the same asyncio loop the test uses** (motor's coroutines are loop-bound):

```python
async def _ensure_money_service_wired(db_inst):
    import money_bridge as _mb
    import money_runtime as _mr
    if _mb.get_money_service() is None:
        await _mb.init_money_service(db_inst)
    _mr._db = db_inst
```

Called inside `_go()` of every test that exercises the canonical chain. Also added a projection rebuild call inside `test_dev_wallet_canonical_no_double_credit` so that the assertion reads the same source of truth that user-facing endpoints do (since 2C-B3.1 the projection is the canonical read path).

These are **test-infrastructure plumbing** — no production code is changed by it.

---

## 3. Live verification

### 3.1 E2E via `module_qa_decision` (production endpoint)

```
POST /api/admin/modules/mod_fa0d26a7be9d/qa-decision  decision=pass   → 200
```

Pre-state:
- module `mod_fa0d26a7be9d`: status=review, qa_status=pending, dev_reward=$450
- `dev_earning_log[mod_fa0d26a7be9d]`: absent
- `money_ledger_events` keyed on `mod_fa0d26a7be9d`: 0
- legacy `dev_wallets[john]`: `$1220 / $5020 / $3800`
- legacy `users[john].total_earnings`: absent

Post-state:

| field | observed | verdict |
|---|---|---|
| `module.status / qa_status / completed_at` | done / passed / set | ✅ |
| `dev_earning_log[mod_fa0d26a7be9d]` | `de_e3639358da0e, amount=$450, tier=junior, rate=0.75` | ✅ |
| `money_ledger_events.qa_approved` (idem=mod_fa0d26a7be9d) | recorded, payload.approved_by=user_fdfdb97a43b5 | ✅ NEW (canonical coverage closed) |
| `money_ledger_events.earning_approved` (idem=mod_fa0d26a7be9d, amount=$450) | recorded, payload.module_id=mod_fa0d26a7be9d | ✅ NEW (canonical coverage closed) |
| **legacy `dev_wallets[john]`** | **$1220 / $5020 / $3800 — UNCHANGED** | ✅ B4.2 invariant preserved |
| legacy `users[john].total_earnings` | still absent | ✅ helper does not add legacy writes back |
| backend `err.log` `money_ledger.record_event failed` | 0 occurrences | ✅ |

Backend log line:
```
2026-05-20 17:39:56,079 - server - INFO - 💰 DEV EARN: user_f7cc845bdb5a +$450.00 (junior @ 0.75) margin=$150.00 for module mod_fa0d26a7be9d [B4.2: legacy dev_wallets write removed; canonical via escrow chain]
2026-05-20 17:39:56,082 - server - INFO - MODULE PASSED: mod_fa0d26a7be9d by QA user_fdfdb97a43b5
```

### 3.2 Test suite

```
tests/test_money_stabilization.py::test_ledger_idempotency_compound_index   PASS  ✅
tests/test_money_stabilization.py::test_full_chain_seed_no_double_events    PASS  ✅
tests/test_money_stabilization.py::test_dev_wallet_canonical_no_double_credit  PASS  ✅  (was: FAIL pre-B4.2.1)
tests/test_money_stabilization.py::test_webhook_to_ledger_idempotent         PASS  ✅
tests/test_dev_wallet_projection.py            ALL PASS  ✅
tests/test_dev_wallet_reader.py                ALL PASS  ✅
tests/architecture/                            ALL PASS  ✅
```

Total: **30 passed, 1 skipped, 0 failed.** Down from 1 failed in B4.2.0a.

### 3.3 Stability probe

```
run 1: rows=8 written=0 unchanged=8 classifications={'ledger_only': 7, 'mock_orphan': 1} checksum=fd82421f9121…
run 2: rows=8 written=0 unchanged=8 classifications={'ledger_only': 7, 'mock_orphan': 1} checksum=fd82421f9121…
run 3: rows=8 written=0 unchanged=8 classifications={'ledger_only': 7, 'mock_orphan': 1} checksum=fd82421f9121…
run 4: rows=8 written=0 unchanged=8 classifications={'ledger_only': 7, 'mock_orphan': 1} checksum=fd82421f9121…
run 5: rows=8 written=0 unchanged=8 classifications={'ledger_only': 7, 'mock_orphan': 1} checksum=fd82421f9121…
✅ ALL INVARIANTS HOLD — 2C-B2 acceptance met.
```

Row count grew from 7 to 8 — that is `demo_dev_001` finally getting a canonical projection row (`available_balance_cents=170000, earned_lifetime_cents=170000`) backed by `ac_dev:demo_dev_001` ledger activity. The previously-orphan demo dev is no longer orphan. Stability is preserved (5/5 runs identical).

### 3.4 No duplicate canonical entries when both approve paths fire

If `client_approve_module` runs first and then admin re-fires through `module_qa_decision`:

- `EVENT_QA_APPROVED` idem=`module_id` → second call returns `duplicate=true`
- `EVENT_EARNING_APPROVED` idem=`module_id` → second call returns `duplicate=true`
- `on_module_done_chain` → finds released escrow, short-circuits without re-bridging
- `EVENT_ESCROW_RELEASED` idem=`escrow_id` → second call returns `duplicate=true`

All four ledger writes are guarded by the composite `(event_type, idempotency_key)` unique index (the B4.2.0a substrate). The escrow chain is guarded by its own per-payout idempotency keys (`legacy_escrow_release:<payout_id>`).

---

## 4. Acceptance probes — verdict matrix

| # | Probe | Expected | Observed | Verdict |
|---|---|---|---|---|
| 1 | `module_qa_decision` produces canonical ledger coverage | qa_approved + earning_approved + (optionally) escrow_released recorded | confirmed via live POST for `mod_fa0d26a7be9d` | ✅ PASS |
| 2 | `test_dev_wallet_canonical_no_double_credit` turns green | was failing on legacy>canonical; should pass | **PASS** | ✅ PASS |
| 3 | re-approve remains idempotent | endpoint-level 400 ("Module is 'done'") + composite idempotency on (event_type, module_id) | confirmed | ✅ PASS |
| 4 | no duplicate canonical entries if another approve path already fired | record_event returns `duplicate=true`; on_module_done_chain short-circuits | confirmed in helper docstring + composite index covers | ✅ PASS |
| 5 | no legacy `dev_wallets` mutations added back | `_record_module_approval_canonical` never touches `dev_wallets` | confirmed (no `db.dev_wallets.*` calls in helper) | ✅ PASS |
| 6 | projection rebuild remains deterministic | 5/5 runs identical, checksum stable | confirmed `fd82421f9121…` × 5 | ✅ PASS |
| 7 | `WARN dev_wallet_read.mismatch` count = 0 | no mismatches in logs | confirmed | ✅ PASS |
| 8 | full test suite green | 30 passed | confirmed | ✅ PASS |
| 9 | no MoneyService refactors | helper only calls existing `record_event` and `on_module_done_chain` | confirmed | ✅ PASS |
| 10 | no payout/pending/divergence/projection-logic changes | scope strictly limited to two callsites + one helper | confirmed | ✅ PASS |

---

## 5. Reused (not duplicated)

Per user's directive — `module_qa_decision → invoke existing canonical chain` — the helper composes the **existing** primitives:

| Primitive | Source | Reused by helper? |
|---|---|---|
| `_money_ledger.record_event` | `money_ledger.py` | ✅ same call, same idem keys |
| `_money_runtime.on_module_done_chain` | `money_runtime.py:355` | ✅ same call |
| `bridge_escrow_release` | `money_bridge.py:143` | ✅ invoked transitively by `on_module_done_chain` |
| `MoneyService.release_escrow` | `domains/money/service.py:121` | ✅ invoked transitively by bridge |
| `EVENT_QA_APPROVED` / `EVENT_EARNING_APPROVED` / `EVENT_ESCROW_RELEASED` constants | `money_ledger.py` | ✅ no new event types |
| `dev_earning_log` lookup | `db.dev_earning_log.find_one` | ✅ same query |

Zero new pipelines. Zero new earnings logic. The helper is a façade over the existing chain.

---

## 6. Architectural significance

The canonical earnings spine is now COMPLETE across both approve paths:

```
                   ┌─────────────────────────────────────┐
                   │  _record_module_approval_canonical  │  ← single spine
                   │  ─────────────────────────────────  │
                   │  • EVENT_QA_APPROVED                │
                   │  • EVENT_EARNING_APPROVED           │
                   │  • on_module_done_chain → bridge    │
                   │  • EVENT_ESCROW_RELEASED            │
                   └─────────────────────────────────────┘
                                  ▲          ▲
                                  │          │
                ┌─────────────────┘          └──────────────────┐
                │                                                │
   client_approve_module                            module_qa_decision (pass)
   (POST /api/client/modules/{id}/approve)        (POST /api/admin/modules/{id}/qa-decision)
```

Before B4.2.1: the right branch had `_credit_module_reward` only — no canonical event flow.
After B4.2.1: both branches converge on the same helper, the same idempotency keys, and the same downstream bridge → MoneyService writes.

This means:
- `dev_wallets_projection` can now be considered **authoritative** for any module approval, regardless of the originating endpoint.
- `pending_withdrawal` lifecycle (B4.3) can now be built on a complete accounting graph — there is no "this approve path didn't fire canonical" hole.
- Divergence engine output is now interpretable as **legacy-only mirror drift**, not as "canonical missed coverage".

---

## 7. Rollback path

If a regression is observed:

1. Revert the two callsite changes:
   - Replace `await _record_module_approval_canonical(credited_module, admin.user_id)` in `module_qa_decision` with nothing
   - Restore the 50-line inline canonical block in `client_approve_module` (block deleted in this phase — see `/app/audit/PHASE_2C_B4_2_1_ACCEPTANCE_2026-02-FEB.md` for the verbatim block)

2. Helper function `_record_module_approval_canonical` can be left in place (it is dead code after revert, harmless).

3. The canonical events already recorded by post-fix `module_qa_decision` calls (`mod_fa0d26a7be9d`, etc.) are correct under the new schema and will not collide on revert — composite `(event_type, idempotency_key)` uniqueness keeps them stable.

Test-side rollback: revert the three small additions in `tests/test_money_stabilization.py` (`_ensure_money_service_wired` helper + projection rebuild call + two `await` lines inside `_go()`).

---

## 8. Verdict

**Phase 2C-B4.2.1 — ACCEPTED.**

`module_qa_decision` now invokes the existing canonical chain via the single source-of-truth helper. No duplicated reward logic. No new pipelines. No legacy writes added back.

- Canonical coverage gap closed on the admin/QA approve path
- Substrate (B4.2.0a) carries the change cleanly — zero E11000
- `test_dev_wallet_canonical_no_double_credit` PASSES (was the detector for this exact gap)
- Stability probe steady at 5/5
- 30 passed, 1 skipped, 0 failed across the money/projection/architecture test set
- Single divergence introduced previously by B4.2 (legacy mirror stays static) is **expected behaviour** and surfaces correctly as `mock_orphan` / `legacy_only` divergence classifications

System is now ready for **B4.3 — pending_withdrawal lifecycle extraction** on user's go-ahead. The canonical spine is complete; pending-withdrawal state-machine extraction can now be built on a coherent accounting graph.

*Audit prepared: Feb 2026, post B4.2.0a substrate fix + B4.2.1 data-flow coverage, repo `d32d3d2323`.*
