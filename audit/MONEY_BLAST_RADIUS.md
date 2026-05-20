# Money Blast-Radius — Stage 7A measurement baseline

**Date:** 2026-05-14
**Stage:** 7A (Discovery)
**Charter:** `/app/audit/MONEY_AUTHORITY_CHARTER.md` (Decision 1=D signed)
**Trace artifacts:** `ESCROW_SMOKE_TRACE.md`, `WORK_EXECUTION_SMOKE_TRACE.md`
**Raw data:** `/app/audit/blast_radius_baseline.json`
**Endpoint:** `GET /api/admin/money/divergence/blast-radius` (admin-only)
**CLI:** `python3 /app/scripts/money_divergence.py blast-radius`

This file records the FIRST blast-radius reading of the live `test_database`,
including residue from both smoke traces. It is the **baseline** against
which every future reading is diff'd.

> **Operating principle (Stage 7A):**
>   Canonical declared (Decision 1=D) ≠ canonical executed.
>   Measure the gap before touching any writer.

---

## Carrier mass (M7) — the headline reading

How many dollars exist in each money carrier right now:

| Carrier | $ value | Authority class |
|---|---:|---|
| `invoices.amount` where status=paid | **$6 200** | client-billing canonical |
| `escrows.locked_amount` | $0 | locked-funds canonical |
| `escrows.released_amount` | **$1 000** | locked-funds canonical |
| `escrow_payouts.amount` | **$1 000** | audit (per-release record) |
| **`dev_wallets.earned_lifetime`** | **$5 020** | developer-payable canonical (D) |
| **`dev_earning_log.amount`** | **$5 020** | developer-payable journal (D) |
| `payouts.amount` (root) | **$3 100** | ⚠️ frozen pending Decision 2 |
| `earnings.final_earning` (root) | (also non-zero, not summed here) | ⚠️ frozen pending Decision 2 |
| `users.total_earnings` | **$1 000** | legacy mirror (Decision 3) |
| `money_ledger_events` (count) | **0** | audit (Decision 6) |

**Nothing balances against anything else.**

- Invoices paid $6 200 ↔ Escrows received only $1 000. **$5 200 of client
  billing has no escrow record.**
- Wallet=$5 020 (canonical) ↔ Legacy mirror=$1 000 ↔ Escrow_payouts=$1 000
  ↔ Payouts(root)=$3 100. **Four numbers, four answers, same database.**
- Ledger=0 events. **Audit is empty.**

This is the **scale of the semantic financial fragmentation** the charter
predicted. It is not "drift". It is not "stale syncs". It is **disjoint
carrier populations**.

---

## Per-metric readings

### M1 — Developers with legacy signal but empty canonical wallet

> Decision 3 — how many developers would Decision 3.A (freeze legacy) silently zero?

**Count: 1** (the smoke trace #1 developer)

Sample:

```
user_id: smoke_dev_c1f07e9a
users.total_earnings: $1000
users.escrow_earnings: $1000
wallet.earned_lifetime: $0   (no dev_wallets row exists)
```

**Blocker for:** Decision 3.A (freeze legacy). Sign 3.B (freeze AFTER Decision 5)
or this developer becomes invisible to all leaderboards / profile views.

### M2 — Wallet ≠ journal sum (canonical contract under D)

> Decision 1 — is the canonical contract already broken in live data?

**Count: 0** ✅

The canonical contract `wallet.earned_lifetime == Σ dev_earning_log.amount`
is currently UPHELD by every existing wallet row. This is the one piece of
good news: when the canonical path fires, it is internally consistent.

**The problem is that the canonical path FIRES TOO RARELY**, not that it
fires inconsistently. The two smoke traces confirmed: two of three
production paths bypass the canonical path entirely.

### M3 — `payouts` (root) vs `dev_earning_log`

> Decision 2 — how large is the work-pipeline domain vs the canonical wallet?

**Count: 1**

Sample:

```
developer_id: user_072abe1ee988  (john@atlas.dev)
payouts(root).amount sum: $3100   (status across pending+approved+paid)
dev_earning_log sum:      $5020
delta:                    -$1920
```

Two readings of the same developer's "earned money" differ by $1920, in
opposite directions: log says wallet credited $5020, payouts pipeline
recorded $3100. They are not "out of sync" — they are **measuring different
work**.

### M4 — Escrow releases without ledger events

> Decision 6 — how silent is the ledger on the canonical chain right now?

**Count: 1** (the smoke trace #1 escrow)

Sample:

```
escrow_id: esc_… (smoke trace #1)
module_id: smoke_mod_c1f07e9a
released_amount: $1000
status: completed
ledger_events for this escrow OR module: 0
```

100% of observed escrow releases have **zero ledger coverage**. Decision 6.A
(audit-only mandatory) requires this to drop to 0 before promotion to error.

### M5 — Payout intents never settled

> Decision 2 / 5 — how many work-pipeline intents never reached canonical?

**Count: 3** (john@atlas.dev's three seeded payout rows)

Sample of three rows:

```
payout_id  developer_id          module_id    amount  status   created_at
─────────  ────────────────────  ───────────  ──────  ───────  ──────────
…1         user_072abe1ee988     mod_acme_a   $1200   paid     2026-05-13
…2         user_072abe1ee988     mod_acme_b   $1100   paid     2026-05-13
…3         user_072abe1ee988     mod_acme_c   $800    paid     2026-05-13
```

All three are status=paid. **dev_earning_log has 0 rows for any of those modules.**

i.e. on the seeded path (which mirrors the work_execution pipeline), every
payout reached final state `paid` without ever crediting the canonical
wallet. Three settled payouts, zero canonical credits.

### M6 — Modules done without canonical wallet credit (THE Stage 7A question)

> Declared ≠ executed at module level.

**Count: 1** (smoke trace #1 module — the escrow-only path)

Sample:

```
module_id: smoke_mod_c1f07e9a
title: Smoke trace module
client_price: $1000
escrow_payouts.amount sum: $1000  (paid via escrow path)
dev_earning_log rows: 0           (canonical wallet never credited)
```

100% of observed escrow-released modules failed to credit the canonical
wallet. The smoke trace #1 reproduction is **archetypal**, not anecdotal —
every escrow release in production today must be assumed to exhibit this
pattern until M6 → 0 is empirically verified.

### M7 — Carrier mass (already discussed above)

---

## Read of the readings — what to actually do

### Confirmed by measurement

1. **Canonical wallet (`dev_wallets`/`dev_earning_log`) is internally consistent
   when it fires** (M2=0). This means **no reconciliation job is needed for
   the canonical surface itself** — it is honest within its scope.

2. **Canonical wallet does NOT fire on either the escrow path or the work
   pipeline path** (M5=3, M6=1, plus both smoke traces). It fires ONLY on
   the approve-module HTTP path. **Two of three production money paths
   bypass it.**

3. **The legacy mirror (`users.total_earnings`)** has $1000 mass (M1=1) —
   small absolute size, but **load-bearing for the escrow path** because
   nothing else records that path's output for the developer aggregate.

4. **The ledger is empty** (M4: 1/1 escrow releases have 0 events, M7:
   total event count = 0). The ledger is not "behind" — it is **not running**.

5. **`payouts` (root) carries $3100 of money the canonical wallet has no
   record of** (M3, M5). This is **not intent** (smoke trace #2 proved
   status=paid is terminal), it is a **third canonical surface for the work
   pipeline**.

### Implied scope for Stage 7B (NOT to be started until decisions sign)

Stage 7B freezes "unsafe writes". The blast-radius reads identify the
unsafe writers as **the writers that bypass the canonical path**:

| Writer | Path | Bypasses canonical? |
|---|---|---|
| `escrow_layer.release_escrow:204+218` | B | ✅ writes `escrow_payouts` + `users.$inc` |
| `work_execution.qa_pass`:end (payouts.insert) | C | ✅ writes `payouts` (root) |
| `work_execution.mark_paid` (earnings.insert) | C | ✅ writes `earnings` (root) |
| `mobile_adapter` payouts writes | C-variant | ✅ writes `payouts` (root) |
| `client_acceptance` payouts writes | C-variant | ✅ writes `payouts` (root) |

Five distinct writer sites bypass canonical. Freeze plan (Stage 7B) must
address all five OR provide a bridge from each to the canonical wallet.

### What CANNOT be done

- ❌ **Cannot freeze `users.total_earnings`** (Decision 3.A) — would silently
  zero out every escrow-path developer (M1).
- ❌ **Cannot start reconciliation** — the four numbers ($5020 wallet, $1000
  legacy, $3100 payouts-root, $1000 escrow_payouts) measure different things,
  not the same thing drifted. There is nothing to reconcile **to** until
  Decision 2 is resolved.
- ❌ **Cannot enforce ledger** — would error every canonical write today
  because no canonical writer currently calls `record_event`.
- ❌ **Cannot ship a Decision 5 orchestrator** — would require choosing
  which of the three paths owns the canonical credit, which is Decision 2's
  job and is currently unsigned.

### What SHOULD be done next (still Stage 7A — no writers touched)

1. **Withdrawal smoke trace #3** — required to unlock Decision 4. The two
   collections (`withdrawals` vs `dev_withdrawals`) need a live trace through
   the request → admin-approve → mark-paid flow.

2. **Re-read the blast-radius after non-seed data accumulates.** Today every
   metric is dominated by the seed + smoke artifacts. The real shape of
   live divergence will only emerge after some non-smoke traffic.

3. **Decision 2 deserves a re-write.** The memo's recommendation 2.B (intent
   semantic) was falsified by smoke trace #2. The revised options 2.D / 2.E /
   2.F need a separate decision pass.

---

## Operational usage

```
# One-shot read:
python3 /app/scripts/money_divergence.py blast-radius

# Compare against baseline (after cleanup_after on smoke traces):
python3 /app/scripts/escrow_smoke_trace.py --cleanup
python3 /app/scripts/work_execution_smoke_trace.py --cleanup
python3 /app/scripts/money_divergence.py blast-radius > /tmp/clean_baseline.json
diff <(jq '.metrics | to_entries | map({k:.key, count:.value.count})' /app/audit/blast_radius_baseline.json) \
     <(jq '.metrics | to_entries | map({k:.key, count:.value.count})' /tmp/clean_baseline.json)

# Admin endpoint:
GET /api/admin/money/divergence/blast-radius
```

---

## Sign-off — what this measurement changes in the memo

| Decision | Was | After this measurement | Reason |
|---|---|---|---|
| 1 | signed (D) | unchanged | M2=0 confirms canonical is internally consistent |
| 2 | rec: 2.B intent | **2.B falsified — needs re-decision** | Smoke trace #2 + M5=3 show `payouts paid` is terminal, not intent |
| 3 | rec: 3.B (after 5) | unchanged | M1=1 confirms freeze is dangerous |
| 4 | rec: 4.A | unchanged | not measured yet — smoke #3 pending |
| 5 | rec: 5.A | **reinforced** | M6=1, both smoke traces confirm orchestrator is the only fix |
| 6 | rec: 6.A | unchanged but now sized | M4=1/1 — ledger is silent on 100% of canonical chains observed |

**Updated charter checklist additions** (added to `MONEY_AUTHORITY_CHARTER.md` §13):

- [x] Step 2 — detector endpoints live
- [x] Step 2.1 — escrow smoke trace
- [x] Step 2.2 — work-execution smoke trace
- [x] Step 2.3 — blast-radius measurement
- [x] Step 2.3-clean — clean-baseline rerun after `dropDatabase` (see `WITHDRAWAL_SMOKE_TRACE.md` Part A)
- [x] Step 2.4 — withdrawal smoke trace #3 (Decision 4 unblocker — split-brain runtime-confirmed)
- [ ] Step 2.5 — Decision 2 re-decision (memo 2.B falsified)
- [ ] Step 2.6 — Detector live ≥ 7 days under non-smoke traffic
- [ ] Step 3 — writer freeze plan (gated)
- [ ] Step 4 — reconciliation (gated)
