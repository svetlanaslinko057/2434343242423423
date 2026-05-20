# Money Authority Charter — ATLAS DevOS / EVA-X

**Status:** ✅ DECISION 1 SIGNED — split authority by financial meaning (Option D). Other decisions remain open.
**Date:** 2026-05-13
**Author:** Audit pass — read-only, no fixes applied.
**Decision 1 signed:** 2026-05-13 — see §6 Option D, formalised in §6.1 below.
**Scope:** Money domain only. Not invoicing UX, not payment-provider integration, not push.
**Goal:** Decide who is the *single source of truth* for money, then everything downstream
(reconciliation jobs, UI banners, transport polling, escrow CTA visibility) becomes deterministic.

---

## 0. TL;DR — why this charter exists

The money domain currently has **at least 10 collections** writing or reading
money-state. Multiple of them claim to be canonical:

- `money_ledger.py` declares itself **"single source of truth for the money flow"** (line 5).
- `_credit_module_reward` in `server.py:10675` declares **"dev_wallets is the single source of truth"** (line 207 of escrow_layer).
- `escrow_layer.release_escrow` writes to `escrow_payouts` AND `users.$inc total_earnings`
  AND `users.$inc escrow_earnings` (line 204–218 of escrow_layer.py) — same call mutates **three** developer-money surfaces.
- `work_execution.py` independently writes `payouts` + `earnings` for the same lifecycle event (line 450, 681).

Multiple writer paths fire on overlapping triggers (module_approve, module_done,
module_motion auto-promotion, webhook). The system uses **soft idempotency
guards per path** (`dev_earning_log` unique by module_id, money_ledger
idempotency_key, escrow `status != REFUNDED` filter), but **no path knows
about the others**. That is the cause of S-1: numbers diverge between
developer-wallet view, client-escrow view, and payout-batch view, depending
on which path fired last.

This is **not a data hygiene problem**. It is a **broken authority model**.
Reconciliation jobs cannot be written until authority is declared, because
the question "which value is correct" has no current answer.

---

## 1. Current money surfaces (what users actually see)

| # | Surface | Path | Reads from | UI claim |
|---|---|---|---|---|
| 1 | Developer "My earnings" (mobile) | `/api/developer/earnings/*` | `task_earnings` + `dev_earning_log` | "Your lifetime earnings" |
| 2 | Developer wallet (mobile + web) | `/api/dev/wallet`, `dev_work.py` | `dev_wallets.available_balance / earned_lifetime` | "Available balance" |
| 3 | Developer escrow payouts (mobile) | `/api/money/runtime/developer/escrow-payouts` | `escrow_payouts` filtered by developer_id | "Per-escrow released to you" |
| 4 | Developer leaderboard (web) | server.py ≈15240 | computed sum of `earnings.final_earning` | `total_earnings` rank |
| 5 | Client escrows (mobile + web) | `/api/money/runtime/client/escrows` | `escrows.locked/released/refunded` | "Funds locked for module X" |
| 6 | Client invoices (mobile + web) | `/api/invoices/*` | `invoices.status / amount / settlement_escrow_id` | "Pay $X to start" |
| 7 | Client cabinet costs (web) | `client_costs.py` | mixed: `invoices` + module pricing | "What you've spent" |
| 8 | Admin Finance zone (web) | `admin_*` modules | `escrows`, `payouts`, `withdrawals`, `dev_wallets` | aggregate dashboards |
| 9 | Admin money runtime (web + mobile) | `/api/money/runtime/state` | `invoices` + `escrows` + `payouts` + `dev_earning_log` counts | "Settlement chain state" |
| 10 | Admin money ledger (web) | server.py ≈24051 | `money_ledger_events` audit log | "Where did this dollar go" |

Surfaces 1–4 can show three different numbers for "what this developer has earned"
depending on which collection backs the screen. Same for client-side surfaces 5–7.

---

## 2. Current money collections — full census

(All collections that store money-state-changing data, with current writer count.)

| Collection | Writers (path count) | Readers (path count) | Stored fields (money-relevant) |
|---|---|---|---|
| `invoices` | 12+ files | 73+ sites | `amount`, `status`, `paid_at`, `settlement_escrow_id`, `payment_mode` |
| `escrows` | `escrow_layer.py` only | money_runtime + admin dashboards | `total_amount`, `locked_amount`, `released_amount`, `refunded_amount`, `status` |
| `escrow_payouts` | `escrow_layer.release_escrow` only | escrow_layer + tests | `amount`, `developer_id`, `escrow_id`, `responsibility`, `status` |
| `dev_wallets` | `server._credit_module_reward`, `server.withdrawal_*`, `mock_seed`, `seed_money_demo` | 9+ sites | `earned_lifetime`, `available_balance`, `withdrawn_lifetime`, `pending_withdrawal` |
| `dev_earning_log` | `server._credit_module_reward` (idempotent unique-per-module), `seed_*` | computed-readers | `amount`, `module_price`, `tier`, `rate`, `platform_margin` |
| `users.total_earnings` (field, not separate collection) | `escrow_layer.release_escrow` (`$inc`), seeds | leaderboard, profile | legacy mirror, named "legacy" in code |
| `users.escrow_earnings` (field) | `escrow_layer.release_escrow` (`$inc`) | nowhere in production code | parallel legacy mirror |
| `payouts` (root) | `work_execution.py`, `mobile_adapter.py`, `client_acceptance.py`, server seed | `auto_guardian`, `admin_production`, `admin_risk`, `client_workspace`, `client_operator`, `client_operator_opportunities`, `money_runtime` count | `amount`, `developer_id`, `status` |
| `earnings` (root) | `work_execution.py` only | `mobile_adapter.py` aggregate, `developer_intelligence.py` aggregate, `etap3_routes.py` | `final_earning`, `developer_id` |
| `task_earnings` | `earnings_layer.py`, `payout_layer.py`, `qa_layer.py` | `payout_layer`, `developer_economy`, server.py ≈11658/11720/11799 | per-task amount, status, approved_at |
| `withdrawals` / `dev_withdrawals` | `admin_mobile.py`, `server.py` (11087, 11147, 11169, 11210) | dev portal | amount, status |
| `money_ledger_events` (audit) | `server.py` (~10 sites), `module_motion.py` (3), `seed_money_demo.py`, tests | 1 production read (server.py:24051), 4 internal reads in `money_ledger.py` | append-only event chain |
| `referral_payouts` | server.py | server.py reads | scope: referrals, partial overlap with payouts |

**Counted: 12 collections + 2 user-document fields = 14 distinct money-truth carriers.**

---

## 3. Writers matrix — who writes what, when

| Trigger event | Path | Collections mutated |
|---|---|---|
| Client clicks "Pay invoice" | `server.py` invoice endpoints | `invoices` ← status=paid → fires `_money_runtime.on_invoice_paid` |
| `on_invoice_paid` chain | `money_runtime.py` | `escrows` ← create/fund (via `escrow_layer.fund_escrow`) + `modules` status |
| Webhook mark-paid | server.py | `invoices` (with idempotency_key) + `money_ledger_events.record_event` |
| Module status → done (manual) | `server.client_approve_module` line 22338 | calls `_credit_module_reward` → `dev_earning_log` + `dev_wallets`. **Also** calls `_money_runtime.on_module_done_chain` → `escrow_layer.release_escrow` → `escrow_payouts` + `users.$inc total_earnings` + `users.$inc escrow_earnings` |
| Module status → done (auto via module_motion) | `module_motion.py` line 179/192/212 | money_ledger_events.record_event + same `_credit_module_reward` path |
| Module status → done (via on_module_done webhook) | server.py 23117 | both `_credit_module_reward` AND `on_module_done_chain` |
| Work submitted / accepted | `work_execution.py`, `client_acceptance.py`, `mobile_adapter.py` | `payouts.insert_one` + `earnings.insert_one` — **independent of escrow chain** |
| QA approved | `qa_layer.py` | `task_earnings.update_one` — **independent of escrow + module reward chain** |
| Withdrawal request | server.py 11049–11224 | `dev_wallets` ($inc pending_withdrawal, $dec available_balance) + `dev_withdrawals.insert_one` |
| Withdrawal approve/reject | `admin_mobile.py` | `withdrawals.update_one` — **NOT `dev_withdrawals`**; possibly stale duplicate collection |

**Critical contradiction:** when a single module reaches `done`, **three independent
write paths run concurrently** that all believe themselves canonical:
1. `_credit_module_reward` → writes `dev_wallets` + `dev_earning_log`
2. `escrow_layer.release_escrow` → writes `escrow_payouts` + `users.$inc total_earnings`
3. (depending on trigger) `work_execution`/`client_acceptance` → writes `payouts` + `earnings`

Each has its own idempotency guard but **none knows about the others**.
That is the structural source of S-1.

---

## 4. Readers matrix — who reads what for "earnings"

| Screen / endpoint | Reads from | Answers question |
|---|---|---|
| Developer wallet hub | `dev_wallets.earned_lifetime` | "lifetime earned" |
| Developer recent earnings list | `task_earnings` filtered by developer_id | "per-task history" |
| Developer escrow payouts tab | `escrow_payouts` filtered by developer_id | "per-escrow released" |
| Web leaderboard | sum(`earnings.final_earning`) per dev | "rank by earned" |
| Profile total | `users.total_earnings` field | "displayed total" |
| Admin dashboard (escrow) | `escrows.released_amount` summed | "money paid out to teams" |
| Admin money runtime banner | `dev_earning_log.count` | "earning rows recorded" |

**Test `test_money_stabilization.py:167` explicitly enforces:**
```
assert users.total_earnings <= dev_wallets.earned_lifetime + 0.01
```
i.e. the **test code already knows** these two values can diverge, and only
asserts a *bound* not equality. That's an explicit admission of the divergence
S-1 surfaces.

---

## 5. Contradiction S-1 — evidence trail

> **Claim (S-1):** Numbers for a single developer's earnings differ between
> the developer screen, the client-escrow screen, and the admin payout-batch
> screen, on the same database state.

**Evidence:**

1. **Two parallel write paths fire on module-done (server.py 22338 + 23117 + 23156):**
   - `_credit_module_reward` writes `dev_wallets.earned_lifetime` based on
     `client_price × tier_rate`.
   - `_money_runtime.on_module_done_chain` → `escrow_layer.release_escrow`
     writes `escrow_payouts.amount` based on
     `escrow.total_amount × completed_share × (responsibility / total_resp)`.
   - These two formulas operate on **different inputs**:
     dynamic-pricing tier vs Block-3 responsibility share. They will agree
     only by coincidence on single-developer modules with tier_rate ≈ 1.0.

2. **`escrow_layer.release_escrow:209` self-comments:**
   > "We deliberately do NOT credit dev_wallets here, because that path is
   > fired by client_approve_module / module_motion via the same chain. If
   > we credited here too, the same module would double-credit."
   
   This is **manual coordination between two independent writers** — fragile.
   If `client_approve_module` ever stops calling `_credit_module_reward` (or
   if a new path triggers `release_escrow` directly via admin), the implicit
   contract breaks and `dev_wallets` and `escrow_payouts` diverge silently.

3. **Three separate "developer money" surfaces in the API** all backed by
   different collections (§1 lines 1, 2, 3). A developer looking at "lifetime
   earnings" can see three different numbers depending on which tab is open.

4. **`work_execution.py` writes `payouts` + `earnings` on submission** which
   are **not** touched by the escrow path. The admin "payout batches" view
   reads `payouts`. The dev wallet view reads `dev_wallets`. Same dollar can
   be in `payouts` but not in `dev_wallets`, or vice versa.

5. **The legacy field `users.total_earnings`** is `$inc`-mutated by
   `escrow_layer` and read by leaderboards. No path keeps it in sync with
   `dev_wallets.earned_lifetime`. The test only asserts `<= +0.01`.

6. **`withdrawals` vs `dev_withdrawals`** — two collections, both updated.
   `server.py` writes to `dev_withdrawals`; `admin_mobile.py` writes to
   `withdrawals`. Same withdrawal can exist in only one of the two.

These are not bugs in single paths. They are **structural** — fixing one path
in isolation just shifts the divergence to a different pair of collections.

---

## 6. Proposed authority model — options

(No decision made yet. These are the candidates to choose from.)

### Option A — `dev_wallets` is canonical, everything else is derived/audit

- `dev_wallets.{earned_lifetime, available_balance, withdrawn_lifetime, pending_withdrawal}` = **truth**.
- `dev_earning_log` = **append-only journal** that wallet is summed from
  (already idempotent unique-by-module).
- `escrow_payouts` = **per-escrow audit record**, NOT a developer-money source.
- `users.total_earnings`, `users.escrow_earnings` = **deprecate**, mirror from wallet only at read time.
- `payouts` (root) and `earnings` (root) = **legacy**, freeze writes, migrate readers to wallet+log.
- `task_earnings` = **per-task audit record** for "what happened on this task", not a balance.
- `money_ledger_events` = **cross-domain audit**, not a balance source.

**Pros:** `_credit_module_reward` already implements this contract; `dev_earning_log`
already has idempotency-by-module; reconciliation is one query
(`sum(dev_earning_log.amount) - sum(dev_withdrawals.paid.amount)`).

**Cons:** the escrow chain currently has no link to `dev_earning_log`. The chain
must be unified: `release_escrow` must STOP writing to `users.$inc` and INSTEAD
write to `dev_earning_log` with the same idempotency_key as `_credit_module_reward`,
OR delegate to `_credit_module_reward`.

---

### Option B — `escrow_payouts` is canonical for "released to dev", `dev_wallets` is derived

- `escrows` + `escrow_payouts` = **truth** for paid-out-to-dev.
- `dev_wallets` = **projection** (aggregated sum + withdrawal subtractions).
- All "released to developer" math goes through `release_escrow`.
- `_credit_module_reward` becomes a **thin wrapper** that calls `release_escrow`
  in a special "non-escrow" mode for legacy modules with no funded escrow.

**Pros:** money is tied to client-escrow funding (matches "MONEY BEFORE WORK"
principle from `escrow_layer.py:1`). One canonical formula
(`escrow.total × completed_share × responsibility_share`).

**Cons:** Dynamic Pricing tier model (`_credit_module_reward`) is currently
the source of `dev_reward` in dev_earning_log. Migrating away from tier-based
pricing requires a product decision (not a money-domain decision).

---

### Option C — `money_ledger_events` is canonical, all balances are projections

- Every money-mutating action emits a `record_event` first.
- `dev_wallets`, `escrow_payouts`, `users.total_earnings`, `payouts` ALL become
  **read-side projections** rebuilt from the ledger.
- Reconciliation = replay the event log.
- This is the pattern `money_ledger.py:5` literally claims.

**Pros:** cleanest event-sourcing model; auditability is free; tests already
exist for idempotency.

**Cons:** **biggest blast radius**. Today the ledger is written from <20
call-sites but read from 1 production site (`server.py:24051`) and 0 balance
queries. Every balance query in the app would need to be rewritten as a
ledger projection. This is a 3-month migration with intermediate divergence
risk worse than today's.

---

### Option D — Split authority by role surface

- **Developer side:** `dev_wallets` is canonical (Option A scope, developer only).
- **Client side:** `escrows` + `invoices` is canonical (no change).
- **Admin side:** `money_ledger_events` is canonical for audit only; balances
  read from the role-canonical collections.
- Bridge: explicit projection sync job that re-derives `users.total_earnings`,
  `payouts`, `earnings` (root) from `dev_wallets` + `dev_earning_log` on a
  schedule, marks them `derived=True` in the doc, and forbids new writers.

**Pros:** smallest blast radius; matches the current code intent
(`_credit_module_reward` already treats `dev_wallets` as truth on dev side;
escrow layer already owns client side); no event-sourcing migration.

**Cons:** requires explicit deprecation of `payouts`/`earnings`/`task_earnings`
as balance sources, and explicit re-wiring of any UI that reads from them.

---

## 6.1 — Decision 1 signed (2026-05-13): Option D

> **Signed:** split authority by financial meaning. No single canonical store.
>
> **Authority assignments under Option D:**
>
> | Domain | Canonical | Derived / Mirror | Audit |
> |---|---|---|---|
> | Developer payable balance | `dev_wallets` (`earned_lifetime`, `available_balance`, `withdrawn_lifetime`, `pending_withdrawal`) backed by `dev_earning_log` as the append-only journal | `users.total_earnings`, `users.escrow_earnings` (legacy mirrors — pending Decision 3) | `money_ledger_events` (event_type=earning_*) |
> | Client billing | `invoices` (`amount`, `status`, `paid_at`, `settlement_escrow_id`) | `client_costs` reads, dashboard rollups | `money_ledger_events` (event_type=invoice_paid) |
> | Locked-funds / escrow lifecycle | `escrows` (`total_amount`, `locked_amount`, `released_amount`, `refunded_amount`, `status`) | `escrow_status` field mirrored to `modules` | `escrow_payouts` (per-release immutable record) + `money_ledger_events` (event_type=escrow_*) |
> | Payout intent (batch level) | `payout_batches` + `dev_withdrawals` | `withdrawals` (collection-name typo or duplicate — pending Decision 4) | `money_ledger_events` (event_type=payout_*) |
> | Cross-domain audit | n/a | n/a | `money_ledger_events` (append-only) |
> | **Frozen on inspection** (no new business meaning, candidates for deprecation, pending Decision 2) | n/a | n/a | `payouts` (root), `earnings` (root), `task_earnings` |
>
> **Implications:**
>
> - `escrow ≠ earnings` — locked funds in escrow do NOT mean the developer is paid.
>   Developer is paid only when `dev_earning_log` row exists.
> - `client billing ≠ developer payable` — what client owes/paid is read from
>   `invoices`. What developer earned is read from `dev_wallets`. The bridge
>   between them is `escrows`. No single number summarises both.
> - `ledger ≠ UI aggregate` — `money_ledger_events` exists for auditability
>   ("where did this dollar move when"); UI balances are computed from the
>   canonical collections above, not by replaying the ledger.
> - `payout intent ≠ settled money` — a row in `payout_batches` means
>   "admin agreed to pay X"; the corresponding `dev_wallets.withdrawn_lifetime`
>   bump means "money left the platform". They are not interchangeable.
>
> **What this unblocks:**
>
> 1. **Money Divergence Detector** (read-only) becomes well-defined: for each
>    domain, compare canonical → derived → audit, report drift, classify.
> 2. **Step 3 freeze plan** can name specific writers and deprecation order.
> 3. **Step 4 reconciliation** can be scoped per-domain instead of per-collection.
>
> **What is still blocked (pending Decisions 2–6):**
>
> - Any write-freeze on `payouts`/`earnings`/`task_earnings` (Decision 2).
> - Any deletion of `users.total_earnings`/`users.escrow_earnings` (Decision 3).
> - Any unification of `withdrawals` vs `dev_withdrawals` (Decision 4).
> - Any orchestrator change for the module-done trigger fan-out (Decision 5).
> - Any change in ledger writer expectations (Decision 6).
>
> The detector is built against Option D's authority map but does NOT mutate
> any of the above. It only reports what the canonical-vs-derived diff is.

---

## 7. Non-goals for this charter

This document **does not** decide or implement:

- ❌ Any migration code (no `migrate_*` scripts, no rewriting of writers yet).
- ❌ Any reconciliation job (no nightly diff-and-correct).
- ❌ Any UI changes (no banner about discrepancy, no hiding screens).
- ❌ Any new collections, indexes, or schema changes.
- ❌ Any payment-provider work (Stripe webhook handling stays as-is).
- ❌ Any compat-route changes (existing routes keep returning today's numbers).
- ❌ Any test changes (we leave the `<= +0.01` assertion as-is; it documents the divergence).

---

## 8. Required decisions BEFORE any code

Until each of these is answered in writing **in this document**, no money-domain
code change is sanctioned. Each "Decision N" must reference this charter by date.

### Decision 1 — Canonical authority collection

> Which option (A / B / C / D) is the authority model?

This is the **first and only blocker**. Until answered:
- Do not write a reconciliation job (it has nothing to reconcile to).
- Do not "fix" the divergence in any single path (it will resurface from another).
- Do not extend money UI (it will display whichever number happens to win the race).

Current recommendation (audit-side, not binding): **Option D**.
Reason: matches the intent already documented in `_credit_module_reward` and
`escrow_layer:209` comments, smallest blast radius, doesn't require event-sourcing
migration.

### Decision 2 — Status of `payouts` (root) and `earnings` (root)

Two collections are **independently written by multiple files** (work_execution,
mobile_adapter, client_acceptance) and read by **at least 7 sites** including
admin dashboards. Are they:
- (a) canonical for "what work was paid out via the work pipeline" (parallel domain), or
- (b) **legacy/duplicate** of `escrow_payouts` + `dev_earning_log` and should be frozen?

If (b), the question becomes: which admin screen breaks if we freeze writes
to these collections? Answer required before any deprecation.

### Decision 3 — `users.total_earnings` and `users.escrow_earnings` fields

These are explicitly called "legacy mirror" in code and the test only enforces
an inequality. Should they be:
- (a) frozen now (set read-only, no more `$inc` from `escrow_layer`), with reads
  redirected to `dev_wallets`?
- (b) kept and brought into agreement by an explicit projection sync?
- (c) deleted from the user document entirely?

### Decision 4 — `withdrawals` vs `dev_withdrawals`

Two collections, both written. One is likely a typo or a half-finished migration.
Which is canonical? The other must be frozen and its UI rewired.

### Decision 5 — Trigger consolidation for module-done

Today three paths fire on module-done:
- `_credit_module_reward` (called from server.py 22338, 23117)
- `_money_runtime.on_module_done_chain` (called from server.py 23156)
- `module_motion.py` auto-promotion writes `money_ledger_events` (179/192/212)

Should there be **exactly one** orchestrator that fires the canonical chain,
with the other two reduced to call-throughs? This is required regardless of
Decision 1 — the duplication is the actual delivery mechanism for S-1.

### Decision 6 — Money Ledger role

Is `money_ledger_events`:
- (a) **the canonical authority** (Option C above)?
- (b) **append-only audit** parallel to canonical balances (Option A/B/D)?

This decides whether new writers must call `money_ledger.record_event` or not.

---

## 9. First safe implementation slice (executable AFTER decisions are signed)

Assuming Decision 1 = **Option D** (canonical=`dev_wallets`+`escrows`,
ledger=audit), the **first slice** is read-only, zero-risk:

### Step 1 — Authority labels in code (no behavior change)
- Add a module-level constant `CANONICAL = True` to `dev_wallets`/`escrows`
  writer modules; `CANONICAL = False` to legacy ones.
- Add a docstring header to each money module pointing to this charter.
- Mark `users.total_earnings`/`users.escrow_earnings` field writes with a
  `# DEPRECATED — Money Authority Charter Decision 3` inline comment.

### Step 2 — Read-side divergence detector (audit endpoint)
- New endpoint `GET /api/admin/money/divergence` that for every developer
  computes:
  ```
  wallet_lifetime  = dev_wallets.earned_lifetime
  log_sum          = sum(dev_earning_log.amount)
  escrow_sum       = sum(escrow_payouts.amount where developer_id=X)
  legacy_total     = users.total_earnings
  payouts_sum      = sum(payouts.amount where developer_id=X, status=paid)
  earnings_sum     = sum(earnings.final_earning where developer_id=X)
  ```
- Reports per-developer rows where any pair differs by more than $0.01.
- **Does not mutate anything.** Pure diagnostic.

### Step 3 — Writer freeze plan (DO NOT IMPLEMENT YET)
- Document which writers to freeze and in what order.
- Each freeze is a separate PR with its own diff and rollback plan.
- No freeze ships until Step 2 output is small (< 1% of developers diverge)
  or explicit reconciliation has converged them.

### Step 4 — Reconciliation job (DO NOT IMPLEMENT YET)
- Defined ONLY after Step 2 has run for ≥ 7 days against live data.
- Defined ONLY after Decisions 1–6 are signed.

---

## 10. What this charter explicitly does NOT permit

- ❌ "Quick fix" of S-1 in a single endpoint. Every quick fix shifts divergence
  to a different pair of collections. Audited.
- ❌ Adding any new money collection. The current 12 + 2 fields is already the
  problem; more carriers cannot solve it.
- ❌ A "reconciliation script" that rewrites `dev_wallets` from `escrow_payouts`
  or vice versa, before Decision 1 is signed. We do not know which side is right.
- ❌ A second contradiction trace (S-2, S-3, ...) before this charter is closed.
  More evidence will not change the structural answer.
- ❌ UI flags / banners / hiding screens until the canonical authority is decided.
  Today, every UI claim about money is true *for the collection it reads from*.

---

## 11. Amendment procedure

Same as `docs/product-scope-freeze.md`:
1. Open a PR that modifies THIS document with the proposed decision answer.
2. Reference: which collection becomes authority, which become derived/legacy/audit,
   what happens to each writer path, what is the blast radius.
3. Get explicit sign-off from the owner.
4. ONLY THEN write any money-domain code (writer freeze, reconciliation, UI rewire).

---

## 12. Linked artifacts

- `/app/audit/MONEY_AUTHORITY_CHARTER.md` — this document
- `/app/memory/AUDIT_REPORT.md` — full deployment + architecture audit (2026-05-13)
- `/app/memory/PRD.md` — Product Requirements
- `/app/docs/product-scope-freeze.md` — frozen role-surface decisions
- `/app/audit/ARCHITECTURE_AUDIT_2026-05-09.md` — prior architecture audit
- Source files (read-only review):
  - `backend/money_ledger.py` (220 lines)
  - `backend/money_runtime.py` (366 lines)
  - `backend/escrow_layer.py` (473 lines)
  - `backend/escrow_api.py` (278 lines)
  - `backend/payout_layer.py` (547 lines)
  - `backend/earnings_layer.py` (1277 lines)
  - `backend/account_layer.py` (485 lines)
  - `backend/server.py:10675` `_credit_module_reward`
  - `backend/work_execution.py` (writers to `payouts`/`earnings`)
  - `backend/tests/test_money_stabilization.py` (documents the divergence)

---

## Charter status checklist

- [x] Decision 1 (authority collection) signed — **Option D**, 2026-05-13, see §6.1
- [ ] Decision 2 (`payouts`/`earnings` root status) signed
- [ ] Decision 3 (`users.total_earnings` field status) signed
- [ ] Decision 4 (`withdrawals` vs `dev_withdrawals`) signed
- [ ] Decision 5 (module-done trigger consolidation) signed
- [ ] Decision 6 (ledger role) signed
- [x] Step 1 (authority labels) — Option D map encoded in `money_divergence.overview()` `authority_map` field; module docstring of `money_divergence.py` and Charter §6.1 act as the single source of truth for which collection plays which role
- [x] Step 2 (divergence detector endpoint) — implemented as `/app/backend/money_divergence.py` + 5 admin endpoints + standalone CLI at `/app/scripts/money_divergence.py`
- [ ] Step 2 — live for ≥ 7 days against live data (this run = baseline only)
- [ ] Step 3 (writer freeze plan) drafted with PR-by-PR breakdown
- [ ] Step 4 (reconciliation job) drafted — implementation gated on Steps 1–3

Until every box above is ticked, no UI/transport/polling work in the
money domain ships.

---

## 13. Stage 7A baseline reading (2026-05-14, post-detector wiring)

First run of the detector against the seeded `test_database`. Reported as
read-only evidence — no remediation actions taken.

**Overview:**
```
modules:        7 scanned, 0 ok, 7 diverged
developers:     2 scanned, 1 ok, 1 diverged
by_class:       ledger_missing            × 6  (info)
                payouts_root_orphan       × 1  (warning)
                legacy_drift_total_earnings × 1  (warning)
                withdrawals_drift         × 1  (warning)
                payouts_root_drift_dev    × 1  (info)
by_severity:    info=7, warning=3, error=0
```

**Notable per-developer divergence** (`user_072abe1ee988` / `john@atlas.dev`):
- wallet vs journal: ✅ agrees ($5020 = $5020)
- balance equation: ✅ closes (1220 available + 3800 withdrawn + 0 pending = 5020)
- `legacy_drift_total_earnings`: `users.total_earnings=$0` vs `wallet=$5020` — legacy mirror fully stale, never written by current seed path
- `withdrawals_drift`: `wallet.withdrawn_lifetime=$3800` but no rows in `dev_withdrawals` — seed wrote to wallet directly without inserting per-withdrawal records (loss of audit trail at developer level)
- `payouts_root_drift_dev`: `payouts(root)=$3100` vs `dev_earning_log=$5020` — $1920 split between the two surfaces, surfaced exactly as the parallel-writer artifact predicted in §5

**Interpretation:**
- 0 `error`-severity divergences in current seed (no `wallet_not_credited`, no `escrow_payouts_orphan`, no `release_mismatch`, no `double_credit_suspected`). Means the seed path itself is internally consistent under Option D's developer-side authority — but only because the seed bypasses the escrow chain entirely. Real client→escrow→release flows have not been exercised against the detector yet (no escrow rows in seed).
- 6 of 6 modules with money activity have `ledger_missing`. Confirms `money_ledger_events` is wired only for select code paths and the seed predates ledger adoption. Not a balance bug — audit log gap.
- The detector is now the single operational read-out for "where do truths disagree". It runs in O(N_modules + N_developers) for current data volume; promote to projection-collection if N grows past ~10⁴.

**Operational usage:**
```
# Cron-friendly snapshot (always-runnable, exits 0):
python3 /app/scripts/money_divergence.py overview > /tmp/divergence.json

# Diff between two snapshots:
diff <(python3 /app/scripts/money_divergence.py overview) /tmp/divergence.json

# Drill into one developer:
python3 /app/scripts/money_divergence.py developer user_072abe1ee988

# Admin UI (web/mobile) consumes any of:
GET /api/admin/money/divergence/overview
GET /api/admin/money/divergence/modules?only_diverged=true&cls=wallet_not_credited
GET /api/admin/money/divergence/module/<module_id>
GET /api/admin/money/divergence/developers?only_diverged=true
GET /api/admin/money/divergence/developer/<user_id>
```

**Gate to Stage 7B (freeze unsafe writes):** detector must run against
non-seeded data with real client→escrow→release flow and report the same
classes BEFORE any writer is touched. Stage 7A is not done — it is in
operation.
