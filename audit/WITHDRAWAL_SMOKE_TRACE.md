# Withdrawal Smoke Trace #3 + Clean-baseline rerun

**Date:** 2026-05-14
**Stage:** 7A (Discovery)
**Charter:** `/app/audit/MONEY_AUTHORITY_CHARTER.md`
**Trace artifacts:** `escrow_smoke_trace_baseline.json`, `work_execution_smoke_trace_baseline.json`, `withdrawal_smoke_trace_baseline.json`, `blast_radius_clean.json`
**Scripts:** `/app/scripts/withdrawal_smoke_trace.py`

This file records two artefacts produced in the same Stage 7A session:
1. **Part A — Clean-baseline blast-radius rerun** (after `dropDatabase` + boot reseed).
2. **Part B — Withdrawal smoke trace #3** (Decision 4 unblocker).

---

## Part A — Clean-baseline blast-radius

### What changed in the environment

The previous baseline (`blast_radius_baseline.json`, 2026-05-14 ~14:10) was
read while **both smoke traces' residue was still in the DB** (escrow trace's
$1000 release + work-pipeline trace's $1500 settlement). To get a non-
contaminated reading, executed:

```
mongosh "mongodb://localhost:27017/test_database" --eval 'db.dropDatabase()'
sudo supervisorctl restart backend     # triggers boot seed + mock_seed + seed_replay
```

Database now contains only the genuine boot-time seed (no smoke artefacts):

| Collection | Boot-seed count |
|---|---|
| `users` | 5 |
| `projects` | 3 |
| `modules` | 10 |
| `invoices` | 6 |
| `escrows` | 0 |
| `escrow_payouts` | 0 |
| `dev_wallets` | 1 |
| `dev_earning_log` | 6 |
| `payouts` | 3 |
| `earnings` | 0 |
| `task_earnings` | 0 |
| `dev_withdrawals` | 0 |
| `withdrawals` | 0 |
| `money_ledger_events` | 0 |
| `tasks` | 0 |
| `qa_reviews` | 0 |

### Clean reading (raw: `blast_radius_clean.json`)

```
M1_legacy_signal_without_wallet:            0   ← down from 1
M2_wallet_journal_drift:                    0   ← unchanged
M3_payouts_root_vs_journal:                 1   ← down from 2
M4_escrow_releases_without_ledger:          0   ← down from 1 (no escrows in clean seed)
M5_payout_intents_never_settled:            3   ← down from 4
M6_modules_done_without_canonical_credit:   0   ← down from 1 (no escrow releases in seed)
M7_carrier_mass:
  invoices_paid_sum         $5 200
  escrows_locked_sum         $0
  escrows_released_sum       $0     ← clean (smoke #1 added $1000)
  dev_wallets_earned_sum     $5 020
  dev_earning_log_sum        $5 020
  escrow_payouts_sum         $0     ← clean
  payouts_root_sum           $3 100 ← seed only (smoke #2 added $1500)
  users_total_earnings_sum   $0     ← clean (smoke #1 had inc'd this $1000)
  money_ledger_events_count  0
```

### The headline finding from the clean baseline

**Fragmentation is baked into the seed code itself.**

Even without ANY runtime activity, the seed creates:
- `dev_wallets.earned_lifetime = $5 020`
- `dev_earning_log.sum = $5 020` ✅ canonical contract holds (M2=0)
- `payouts (root).sum = $3 100` ← parallel work-pipeline history
- `invoices.paid.sum = $5 200`

These four numbers are different. They describe different work. **There is
no module in the seed that appears in both `dev_earning_log` and `payouts`.**
The seed is writing two parallel histories for the same developer that
refer to disjoint sets of modules:

- M3 sample: `developer_id user_96d17655f7c1, payouts_root_sum=$3 100, dev_earning_log_sum=$5 020, delta=-$1920`
- M5 sample: 3 payout rows (1× paid + 2× approved) — none of them have a
  corresponding `dev_earning_log` entry for the same module.

i.e. the developer in the seed has effectively been paid twice over —
once through the work pipeline ($3 100 across 3 modules), and once through
the approve-module path ($5 020 across 6 different modules). The two ledgers
do not even agree on which modules earned money.

**Implication for the charter:**

The "canonical declared ≠ canonical executed" pattern is not just a runtime
fault — it is **encoded in the seed**. Any new install of this system starts
already in a fragmented financial state. Stage 7A's value is now even
clearer: without the divergence detector + charter, every new deployment
would assume the seed is the source of truth.

### Note: developer with legacy-only (M1=0) is a NEGATIVE confirmation

The contaminated baseline showed M1=1 (one developer with legacy signal but
empty wallet — the smoke trace #1 dev). Clean baseline shows M1=0.

**This is good news**: in the seed-only state, no developer is in the
"legacy-only" trap. **But smoke trace #1 PROVED that any future real escrow
release will move M1 from 0 to ≥1** because `release_escrow` writes
`users.$inc total_earnings` exclusively. So M1=0 today does NOT mean
Decision 3.A (freeze legacy) is safe — it means the failure mode has not
yet been triggered in this install.

---

## Part B — Withdrawal smoke trace #3

### Part B.1 — Canonical flow (server.py routes, `dev_withdrawals` collection)

| Step | wallet.available | wallet.pending | wallet.withdrawn | dev_withdrawals# | withdrawals# (mobile) | dev divergence classes |
|---|---:|---:|---:|---:|---:|---|
| T0 — seeded | $2 000 | $0 | $0 | 0 | 0 | wallet_journal_drift, legacy_drift_total_earnings (pre-existing seed noise) |
| T1 — dev requested $800 | $1 200 | $800 | $0 | 1 | 0 | (same) |
| T2 — admin approve (canonical) | $1 200 | $800 | $0 | 1 | 0 | (same) |
| T3 — admin mark-paid (canonical) | **$1 200** | **$0** | **$800** | 1 | 0 | (same) |

**Result:** ✅ Canonical flow closes correctly:
- $2000 = $1200 available + $0 pending + $800 withdrawn (balance equation holds)
- Σ dev_withdrawals(paid).amount = $800 = wallet.withdrawn_lifetime
- The CAS-based update predicates (`available_balance >= amount` on request,
  `status == "approved"` on mark-paid) are doing their job — atomic, idempotent.
- **No `withdrawals_drift` divergence class fires** for this developer.
  The canonical withdrawal flow is internally consistent.

This is the **second observed canonical-path that is internally consistent
when it fires** (the first was `_credit_module_reward` per M2=0). Two for two.

### Part B.2 — Split-brain (admin_mobile, `withdrawals` collection)

| Step | wallet.available | wallet.pending | wallet.withdrawn | dev_withdrawals# | withdrawals# (mobile) | mobile_visible_to_dev |
|---|---:|---:|---:|---:|---:|---|
| S0 — planted row in db.withdrawals | $1 200 | $0 | $800 | 1 | 1 | — |
| S1 — admin mobile approved (in db.withdrawals) | $1 200 | $0 | $800 | 1 | 1 | — |
| S2 — read dev view | $1 200 | $0 | $800 | 1 | 1 | **❌ false** |
| S3 — wallet state after | **$1 200** | **$0** | **$800** | 1 | 1 | ❌ |

**Result:** 🔴 Split-brain confirmed. The mobile-admin-approved $500
withdrawal:
- Status `approved` ✅ in `db.withdrawals` (admin's view)
- **❌ Invisible** to the developer's view (`db.dev_withdrawals` has no such row)
- **❌ Zero wallet mutation** — `withdrawn_lifetime` stays at $800, not $1300
- The $500 just sits in `db.withdrawals` forever. Admin thinks it's done.
  Developer doesn't see it. Wallet doesn't know about it.

### Observation: "planted row" requirement is itself the proof

This trace had to *manually insert* the row into `db.withdrawals` because
**no developer-facing endpoint ever writes that collection.** The mobile
admin cockpit operates on rows that have no developer-side origin under the
current writer layout. Two possibilities under the current code:

1. There is no integration path that creates `db.withdrawals` rows
   — the mobile cockpit's queue is permanently empty in production.
2. There is a path we did not find — but neither `server.py`,
   `admin_mobile.py`, nor `mobile_adapter.py` contains an `db.withdrawals.insert_one`.

Either way, **mobile admin's approve/reject endpoints operate on an
orphan collection.** They can be invoked, they update fields, they emit
audit events — but they never affect any developer's actual money.

This is the strongest evidence for **Decision 4.A (canonical = `dev_withdrawals`,
freeze `withdrawals`)** the audit has produced.

### Additional finding — mobile admin has no `mark-paid` endpoint

`admin_mobile.py:501-580` defines:
- `POST /admin/mobile/withdrawals/{id}/approve` — writes `withdrawals.status = "approved"`
- `POST /admin/mobile/withdrawals/{id}/reject` — writes `withdrawals.status = "rejected"`

**There is no `mark-paid` mirror.** The canonical path's `mark-paid` (server.py:11159)
is the one that actually moves money: `pending_withdrawal → withdrawn_lifetime`.
The mobile admin path has no equivalent. So even if `db.withdrawals` rows were
being created by some future code path, admin mobile could never *complete*
the withdrawal — it would always be stuck at "approved" with no settlement.

This compounds the Decision 4 evidence: not only is the mobile path orphan,
it is also **incomplete** — only 2 of 3 lifecycle transitions exist.

---

## Decision-level conclusions

### Decision 4 — canonical = `dev_withdrawals` — CONFIRMED at runtime

Recommendation 4.A from the memo is now backed by direct evidence:
1. Mobile admin path writes a different collection from the developer path.
2. Approvals on the mobile path are invisible to the developer.
3. Mobile path has no mark-paid → cannot settle money even if the queue had rows.
4. Mobile path never adjusts `dev_wallets` — the developer's pending/withdrawn
   accounting is permanently wrong if mobile path ever fires.

**Recommended sign-off action (still non-binding):**

- Sign Decision 4 = **4.A — canonical=`dev_withdrawals`, freeze writers/readers
  of `db.withdrawals`**, with the additional finding that the mobile path is
  not just split-brain but also incomplete.
- Mobile admin cockpit (per scope-freeze) is cockpit-only, so the freeze is
  cheap: remove the 2 mobile endpoints OR redirect them to operate on
  `dev_withdrawals` with the same predicates as `server.py:11139+`.

### Decision 3 — `users.total_earnings` — CONTEXT REFINED

Clean baseline shows M1=0 in the seed. Combined with smoke trace #1 (which
made M1=1), the rule is:
- Seed state: clean (`total_earnings = 0`, no developer in legacy-only trap).
- Real-runtime escrow flow: creates legacy-only developers.
- **Therefore Decision 3 must reference Decision 5 sequencing:** legacy can
  be frozen only when the orchestrator guarantees the canonical wallet is
  always credited on escrow release. Until then, freezing legacy in the
  current code zeros out every escrow-released-developer.

Memo recommendation 3.B (freeze AFTER Decision 5) is unchanged.

### Decision 2 — re-decision still pending

Withdrawal trace doesn't touch Decision 2's domain. Decision 2 still needs
the 2.D / 2.E / 2.F re-decision per the falsification of 2.B in WORK_EXECUTION_SMOKE_TRACE.md.

### Decision 5 — orchestrator — SCOPE CONFIRMED EVEN WIDER

The orchestrator scope now needs to span:
- Path A — approve-module → wallet credit (`_credit_module_reward`)
- Path B — escrow release → escrow_payouts + legacy mirror
- Path C — work pipeline → payouts (root) + earnings (root) settlement
- Path D — withdrawal → `dev_withdrawals` lifecycle + wallet pending/withdrawn

Four paths, each currently independent. Recommendation 5.A (single orchestrator)
remains, but the scope is "the entire money state machine", not "just module-done".

### Decision 6 — ledger role — unchanged

M4 was 1/1 = 100% in the contaminated baseline (the escrow release without
ledger). In the clean baseline M4=0 because there are no escrow releases yet.
This does NOT mean the ledger problem is fixed — smoke trace #1 proved that
the very next real escrow release will set M4=1. Decision 6.A (audit
mandatory) remains the right call.

---

## Charter updates

Apply to `MONEY_AUTHORITY_CHARTER.md`:
- [x] Step 2.4 — withdrawal smoke trace #3 (DONE — split-brain runtime-confirmed)
- [x] Clean blast-radius rerun (THIS document, Part A)
- [ ] Step 2.5 — Decision 2 re-decision (still pending — 2.B falsified, 2.D/E/F awaiting choice)
- [ ] Step 2.6 — Detector live ≥ 7 days under non-smoke traffic

Apply to `MONEY_DECISIONS_2_6_MEMO.md`:
- Decision 4 — runtime-confirmed, ready for sign-off.
- Decision 5 — scope expanded to 4 paths (was 3).
- Decision 3 — refined: clean state masks the problem; smoke trace proves
  the fault triggers on real escrow flow.

---

## Operational instructions

```
# Clean reset + reseed (DESTRUCTIVE — drops test_database):
mongosh "mongodb://localhost:27017/test_database" --eval 'db.dropDatabase()'
sudo supervisorctl restart backend

# Read clean baseline:
python3 /app/scripts/money_divergence.py blast-radius

# Run withdrawal smoke trace #3:
python3 /app/scripts/withdrawal_smoke_trace.py

# Cleanup smoke artefacts only (preserves seed):
python3 /app/scripts/withdrawal_smoke_trace.py --cleanup
python3 /app/scripts/work_execution_smoke_trace.py --cleanup
python3 /app/scripts/escrow_smoke_trace.py --cleanup
```
