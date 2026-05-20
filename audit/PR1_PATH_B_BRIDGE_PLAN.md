# PR-1 — Path B Bridge Plan

**Status:** 📋 PLANNING ARTIFACT — documentation only, NO code, NO migration.
**Date:** 2026-05-14
**Stage:** 7B / PR-1 (plan written; implementation gated on PR-0 permanent acceptance)
**PR-0 status:** provisionally accepted; observation window active until ~2026-05-21 20:50 UTC.
**Predecessor:**
- `/app/audit/MONEY_WRITER_INVENTORY.md` (frozen, base inventory)
- `/app/audit/MONEY_WRITER_INVENTORY_ADDENDUM_2026-05-14.md` (delta + money identity primitive)
- `/app/audit/PR0_ACCEPTANCE_REPORT_2026-05-14.md` (substrate enforcement record)

**Signed decisions in force:**
- D1 = D (split-canonical authority by financial meaning)
- D2 = E (every domain writer bridges to canonical payable)
- D4 = A (`dev_withdrawals` canonical, `db.withdrawals` orphan)

**Deferred:** D3 (legacy mirror freeze), D5 (orchestrator), D6 (ledger authority enforcement).

---

## Operating principle (load-bearing for the rest of this plan)

> **Stage 7 is not "rewrite money". Stage 7 is: discover and complete
> latent convergence.**

PR-0 surfaced two convergence islands without inventing them:

1. `module_motion.py` — orchestrated coordination already present
   (Path A + Path B + 3 ledger events, all keyed by `module_id`, dual-fire
   safe under `client_approve_module` re-trigger).

2. `escrow_payouts.payout_id_1` — unique index already present in the
   substrate before PR-0 ran. **Storage-level enforcement on this
   collection has existed historically, without an authority model
   to attach it to.**

Together with the implicit `module_id`-keyed pre-read pattern across
every Path A / Path B / Path C writer, this is evidence that the system
has been **trying** to converge for a long time. It just lacked an
explicit cross-domain authority contract.

PR-1's job is **not invention**. PR-1's job is to **make that latent
convergence explicit and enforceable** for the Path B writer chain.

Anywhere in this plan that reads like a new design, ask first: is this
adding behaviour, or is it formalising behaviour the system already
exhibits in at least one production path? If the answer is "adding",
the design is wrong and must be re-grounded in observed convergence.

---

## §1. Canonical bridge contract (per-writer obligation table)

Notation:
- `_canonical_credit(module_id, developer_id, amount, source_path, idempotency_key)`
  is a **declared helper contract**, not implementation. Its semantics
  in §3.1 below. Bridge writers invoke it; they do not duplicate its body.
- `source_path` is part of the **money identity primitive**
  (Addendum §B). It is a discriminator, not a tag.

### §1.1 — Writer-by-writer bridge obligations

| Writer (file:line) | Today emits | Bridge obligation under D2=E | Bridge `source_path` | Idempotency identity | Trigger relationship |
|---|---|---|---|---|---|
| **B.1** `escrow_layer.create_escrow` (`escrow_layer.py:77`) | `escrows.insert_one` | **None.** Creation event has no developer-payable component yet. | — | — | Predecessor of B.5 / B.6 |
| **B.2** `escrow_layer.partial_release` (`escrow_layer.py:117`) | `escrows.$inc released_amount` | **None directly.** B.2 is a counter mutation; the per-developer payable is emitted by B.6. | — | — | Called by `release_escrow` per share |
| **B.3** `escrow_layer.release_escrow` (`escrow_layer.py:235`) | `escrows.$set status=COMPLETED` | **None directly.** Lifecycle marker only. | — | — | Final state mutation in the release chain |
| **B.4** `escrow_layer.refund_escrow` (`escrow_layer.py:280`) | `escrows.$set status=REFUNDED, refunded_amount` | **None under PR-1.** Refund inverts a fund, never credits a developer. Out of scope. | — | — | Out-of-scope for PR-1 |
| **B.5** `escrow_layer.fund_escrow` (`escrow_layer.py:319`) | `escrows.$set status=FUNDED, locked_amount` | **None.** Funding locks client money; no developer credit. | — | — | Triggered by `money_runtime.on_invoice_paid` |
| **B.6** `escrow_layer.release_escrow:204` | `escrow_payouts.insert_one` (per developer) | **CANONICAL BRIDGE.** After B.6 succeeds for a given developer share, invoke `_canonical_credit` with the parameters in the next column. | `"escrow_release"` | `idempotency_key = escrow_payout_id` (UUID, guaranteed unique under the PR-0 `escrow_payouts.payout_id` unique constraint) | THE bridge anchor for Path B |
| **B.7** `escrow_layer.release_escrow:218` | `users.$inc {total_earnings, escrow_earnings}` | **Legacy mirror.** Continues to run under PR-1. Frozen by Decision 3 freeze (later PR, deferred). | — | — | Becomes redundant once D3 ships |

### §1.2 — `_canonical_credit` declared semantics (contract, not code)

When invoked with `(module_id, developer_id, amount, source_path,
idempotency_key)`:

1. **MUST** attempt to insert a row into `dev_earning_log` with key
   `(module_id, source_path)` and amount=amount. The PR-0 unique
   constraint guarantees retry-safety: a duplicate raises
   `DuplicateKeyError`, which is the **convergence-success signal**, not
   a failure.

2. **MUST** apply `$inc dev_wallets.{available_balance, earned_lifetime}`
   for `developer_id` by `amount` **if and only if** step 1 actually
   inserted (i.e. did not collide). Collision means "this credit has
   already been applied" — wallet must NOT double-increment.

3. **MUST** emit `money_ledger.record_event(EVENT_EARNING_APPROVED,
   idempotency_key=idempotency_key)` regardless of whether step 1
   collided. Ledger collision is also success: ledger event was already
   recorded.

4. **MUST NOT** touch `users.total_earnings` / `users.escrow_earnings`.
   Those are legacy-mirror surfaces, owned by B.7 until Decision 3
   freezes them.

5. **MUST NOT** retry on its own. Retry semantics are the caller's
   concern. The helper is **at-least-once safe** because of (1) and (3),
   so the caller can retry freely — but it does not.

### §1.3 — What the bridge is NOT

- **Not an orchestrator.** B.6 still owns its own write to
  `escrow_payouts`. The bridge runs after B.6, not in place of it.
- **Not a transaction.** No multi-document transaction wraps B.6 + bridge.
  Idempotency at the substrate handles partial failure. See §2 and §3.
- **Not a refactor of `release_escrow`.** The function's existing
  control flow stays. The bridge is a single helper call appended after
  the per-developer insert loop iteration.
- **Not a remover of B.7.** B.7 continues to run. Decision 3 will
  freeze it later, gated by ≥ 7 days of detector cleanliness after PR-1.

---

## §2. Failure matrix

This is the **load-bearing semantic table** of PR-1. Every step in the
release-chain can fail. For each failure point, the table states:
- What detector signals fire **today** (pre-PR-1 baseline).
- What detector signals fire **after PR-1** (with bridge).
- What is corruption vs degraded-but-recoverable.

Detector classes referenced (per `backend/money_divergence.py`):
- `M1` legacy_signal_without_wallet
- `M2` wallet_journal_drift
- `M3` payouts_root_vs_journal
- `M4` escrow_releases_without_ledger
- `M5` payout_intents_never_settled
- `M6` modules_done_without_canonical_credit
- `escrow_payouts_orphan` (per-module class)
- `wallet_not_credited` (per-module class)
- `legacy_drift` (per-developer class)

### §2.1 — Path B chain failure modes

| Step | What fails | State pre-PR-1 (today) | State post-PR-1 | Classification |
|---|---|---|---|---|
| F-1 | `escrow_layer.create_escrow` (B.1) raises | No `escrows` row; downstream chain never starts | Same | benign — out of bridge scope |
| F-2 | `escrow_layer.fund_escrow` (B.5) raises | `escrows.status=pending` stays; release never triggered | Same | benign — out of bridge scope |
| F-3 | `escrow_layer.release_escrow` enters but B.6 (`escrow_payouts.insert_one`) raises mid-loop after some developers credited | Partial `escrow_payouts` rows present; partial `users.$inc` ran (B.7); no canonical writes; **detector fires `escrow_payouts_orphan` for credited developers**; **`legacy_drift` fires** | Partial `escrow_payouts` rows present; partial canonical credits applied for those developers; **detector fires `M4 escrow_releases_without_ledger` only if ledger emit for those developers also failed** (which it won't, because bridge emits ledger after canonical credit); **`escrow_payouts_orphan` does NOT fire for partially-credited developers** | degraded-but-recoverable; retry the same release_escrow call → all completed developers idempotently no-op, remaining developers proceed |
| F-4 | B.6 succeeds for a developer; **bridge step 1** (`dev_earning_log` insert) raises with `DuplicateKeyError` | Pre-PR-1: bridge doesn't exist; not applicable | Convergence-success: an earlier code path (Path A from HTTP, or `module_motion`) already credited this `(module_id, "escrow_release")` pair. Wallet has been credited. Bridge step 2 must NOT run (no double-increment). Bridge step 3 (ledger) still emits, also idempotent. | **convergence success** — the OTHER reason this exact scenario was always going to surface is that this is *exactly* the latent convergence the substrate has been trying to enforce. PR-1 turns it from "silent overwrite" into "explicit no-op". |
| F-5 | B.6 succeeds; bridge step 1 succeeds; **bridge step 2** (`dev_wallets.$inc`) raises | Pre-PR-1: not applicable | `dev_earning_log` has the row; wallet not credited. **`wallet_journal_drift` (M2) fires immediately** on next detector pass. Detector signal is correct and intentional. Operator either: retries the release (bridge step 1 collides idempotently, step 2 reattempts), or files an incident. | degraded-but-detectable; rollback NOT required; PR-1 is operating as designed. |
| F-6 | B.6 succeeds; bridge steps 1 + 2 succeed; **bridge step 3** (ledger emit) raises | Pre-PR-1: `M4 escrow_releases_without_ledger` fires today on every release-via-non-HTTP trigger | Wallet correct; canonical log correct; ledger missing. **`M4` fires.** Detector signal is correct. Operator can replay ledger from canonical state (audit trail is reconstructable). | degraded-but-detectable; M4's purpose IS to surface this; no corruption |
| F-7 | B.6 fails after some developers credited via bridge (mid-loop failure) | Pre-PR-1: per developer who got B.6: `escrow_payouts_orphan` fires. Per developer who didn't: nothing. | Per developer who got B.6 + bridge: detector silent (correct). Per developer who got B.6 but bridge raised mid-step: see F-4/F-5/F-6 above. Per developer who didn't get B.6: nothing. | per-developer classification; recoverable via retry; no chain-level corruption |
| F-8 | B.7 (legacy mirror) raises | Pre-PR-1: `legacy_drift` MAY fire on next pass (depends on whether B.6 ran for that developer) | Same as today — bridge doesn't touch B.7. Under D3 freeze later, B.7 is removed; this row becomes moot. | benign for PR-1 acceptance |
| F-9 | After PR-1: a previously-orphan release retries (operator force, scheduler) | N/A | First retry: bridge fills canonical for that release. `escrow_payouts_orphan` for that release **disappears** on next detector pass. **This disappearance MUST be explainable** — see §4 for rollback semantics on detector disappearance. | the intended convergence outcome |

### §2.2 — Categorical summary

| Category | Pre-PR-1 detector signature | Post-PR-1 detector signature | Operator action required? |
|---|---|---|---|
| Full success | escrow_payouts_orphan, wallet_not_credited fire on every release | All silent | no |
| Partial mid-chain (F-3/F-7) | Mixed orphan signal per developer | Mixed orphan signal per developer | retry release (idempotent) |
| Bridge wallet failure (F-5) | n/a | M2 fires for affected developer | retry release |
| Bridge ledger failure (F-6) | M4 fires today on non-HTTP triggers | M4 still fires for affected release | replay ledger or accept the M4 signal |
| Bridge duplicate detect (F-4) | n/a (silent double-write possible today) | DuplicateKeyError surfaces; bridge no-ops correctly | none — this is success |

**Critical observation:** PR-1 introduces **zero new corruption surfaces**.
Every new failure mode lands on a detector class that either already exists
(M2, M4) or maps to the **disappearance of an existing failure class** (F-9).

---

## §3. Ordering doctrine (load-bearing decision)

Within the bridge, the order of writes is the most important semantic
decision of PR-1. Two reasonable models exist; both have evidence in the
codebase. We must pick one explicitly.

### §3.1 — The two doctrines

**Doctrine A — Audit-first (ledger before canonical):**

```
B.6 escrow_payouts.insert_one      ← existing write, unchanged
↓
ledger.record_event(EVENT_ESCROW_RELEASED)
↓
ledger.record_event(EVENT_EARNING_APPROVED)
↓
dev_earning_log.insert_one(...)    ← canonical
↓
dev_wallets.$inc(...)              ← canonical
↓
B.7 users.$inc total_earnings      ← legacy mirror (until D3)
```

**Doctrine B — Canonical-first (wallet before ledger):**

```
B.6 escrow_payouts.insert_one      ← existing write, unchanged
↓
dev_earning_log.insert_one(...)    ← canonical
↓
dev_wallets.$inc(...)              ← canonical
↓
ledger.record_event(EVENT_EARNING_APPROVED)
↓
ledger.record_event(EVENT_ESCROW_RELEASED)
↓
B.7 users.$inc total_earnings      ← legacy mirror (until D3)
```

### §3.2 — Evidence from existing convergence islands

`module_motion.py:154-225` (convergence island #1) currently writes in
Doctrine B order:

1. `_credit_module_reward` (lines 158) — Path A canonical (`dev_earning_log` + `$inc dev_wallets`)
2. `money_ledger.record_event(EVENT_QA_APPROVED)` (line 179)
3. `money_ledger.record_event(EVENT_EARNING_APPROVED)` (line 192)
4. `money_runtime.on_module_done_chain` (line 209) — fires Path B
5. `money_ledger.record_event(EVENT_ESCROW_RELEASED)` (line 212)

The HTTP `client_approve_module` handler (`server.py:22343-23159`) writes
in a similar Doctrine B order:

1. `_credit_module_reward` first (line 22343)
2. ledger emits (lines 23125–23159)
3. `on_module_done_chain` (line 23156)

The existing convergence islands **already operate under Doctrine B**.

### §3.3 — Decision

**Doctrine = B (Canonical-first).**

Rationale:

1. **Latent-convergence consistency.** Both observed convergence islands
   already operate under Doctrine B. Choosing Doctrine A would create
   a third pattern instead of completing the existing two. That violates
   the Stage 7 operating principle.

2. **Developer-visible truth comes first.** A developer who refreshes
   their wallet must never see a stale balance because the audit
   ledger ran ahead of the canonical write. Wallet is the contract
   surface; ledger is the recovery surface.

3. **Replay-from-canonical is always possible.** If ledger emit fails
   (F-6), ledger can be backfilled from `(escrow_payouts ∪ dev_earning_log)`.
   The reverse — replaying canonical from ledger — is harder because
   the ledger does not carry the per-developer amount split (it carries
   `release_total` only; the per-developer breakdown lives in
   `escrow_payouts`).

4. **Detector design alignment.** `M4 escrow_releases_without_ledger`
   is defined relative to canonical writes (i.e. "canonical write
   happened but ledger didn't"). Doctrine B makes that "missing ledger
   *after* a known canonical write" question always answerable from
   detector position.

### §3.4 — What Doctrine B forbids

- Bridge MUST NOT emit ledger before canonical credit succeeds. If
  canonical fails, no ledger event for that release. Detector class
  `escrow_payouts_orphan` returns (because canonical write didn't happen).
  This is the correct signal — release is genuinely incomplete.

- Bridge MUST NOT swap order under "retry pressure". The order is
  permanent; idempotency makes retries safe at every step.

### §3.5 — What Doctrine B explicitly does NOT decide

- **Replay direction at the orchestrator level (D5 / PR-6).** When the
  orchestrator arrives, it may scan ledger as a source-of-truth replay
  feed. That is a separate decision. Doctrine B at the bridge level is
  about per-event ordering, not replay topology.

### §3.6 — Doctrine A rejection rationale (future-author guard)

This subsection exists not because Doctrine A is defensible, but because
future-author will almost certainly attempt to resurrect it. Audit-first
ordering is the default mental model of anyone who has worked with
finance systems in general but not with THIS substrate specifically.
The reasoning below must therefore be brutally explicit, so that any
re-evaluation has to engage with the substrate's actual semantics
rather than appeal to ledger-centric intuition.

#### Doctrine A re-stated

> **Audit-first:** ledger event(s) emit before canonical wallet/log
> writes. Mental model: "never mutate money state without first
> writing what is about to happen".

#### Why Doctrine A appears logical at first read

| Appeal | Mental model |
|---|---|
| "Audit before mutation" | Classical accounting discipline — journal the entry, then post it |
| "Never lose payout trace" | Ledger event survives even if mutation fails |
| "Financial conservatism" | The cautious option must be the right one |
| "Ledger-centric model" | If ledger is the source of truth for reconciliation, write it first |

Each intuition is internally coherent. **None survives contact with
the observed substrate state of this system.**

#### Why Doctrine A is rejected for THIS substrate

**A1 — Detector semantics already assume canonical wallet as truth boundary.**

The detector classes in `backend/money_divergence.py` are oriented
around `dev_wallets` + `dev_earning_log` as the canonical reference
frame. `M2 wallet_journal_drift`, `M4 escrow_releases_without_ledger`,
`wallet_not_credited`, `legacy_drift` — every one takes canonical
state as the "what should be true" anchor and measures other surfaces
against it.

Under Doctrine A, ledger writes precede canonical writes. The detector
would have to **invert its frame of reference mid-migration** to remain
meaningful — i.e. start treating ledger as the truth anchor and
canonical as the lagging signal. That inversion silently re-interprets
every existing detector class with no code change. It is observability
regression by doctrine choice. Forbidden.

**A2 — Existing convergence islands already run canonical-first.**

Both observed convergence points (Addendum §C and PR-0 acceptance §6
side-finding) operate canonical-first today:

- `module_motion.py:154-225` — `_credit_module_reward` (canonical)
  fires before any `money_ledger.record_event(...)` call.
- `server.py:22343-23159` (HTTP `client_approve_module`) — same order.

Adopting Doctrine A would create **two ordering regimes coexisting in
production during transition**: HTTP/module_motion paths under
canonical-first, escrow_layer.release_escrow path under audit-first.
That is exactly the "parallel implementation" anti-pattern that
Decision 4=A was signed specifically to prevent for `dev_withdrawals`.
Re-introducing it for the Path B chain a few PRs later would be
self-contradicting architecture.

**A3 — Audit-first expands the partial-failure surface in the wrong direction.**

Under Doctrine A, the failure mode "ledger emit succeeded but
canonical credit failed" yields the runtime state:

```
ledger.EVENT_EARNING_APPROVED exists  ∧  dev_earning_log.row absent
```

This is, by construction, **the very pathology Stage 7A was opened to
eliminate** (S-1: `escrow_payouts_orphan` + `wallet_not_credited`).
Doctrine A would formalize S-1 as a regular intermediate state of every
release. Under Doctrine B, the equivalent failure mode is "wallet
credited, ledger missing" — detected cleanly by M4 without contaminating
the canonical truth surface.

**A4 — Rollback clarity becomes weaker under audit-first.**

| Rollback question | Doctrine B (canonical-first) | Doctrine A (audit-first) |
|---|---|---|
| "Is wallet correct for developer X?" | Read `dev_wallets` vs `dev_earning_log.sum` — locally answerable | Must walk ledger event ordering vs deployment timeline — not locally answerable |
| "Did the rollback land between two writes?" | Either wallet+log are both present, or both absent (idempotency) | Ledger present + canonical missing is a valid intermediate state, indistinguishable from corruption |

Audit-first reintroduces temporal-reasoning ambiguity exactly where
Stage 7 was supposed to remove it.

**A5 — Audit-first biases the system toward replay-driven recovery before the orchestrator exists.**

Under Doctrine A, the natural recovery story is "ledger contains all
declared events; canonical is reconstructable from ledger." That model
requires an orchestrator (Decision 5 / PR-6) to own the replay loop.
Decision 5 is **explicitly deferred**. Choosing Doctrine A now commits
the substrate to a replay model whose runtime owner does not yet exist.

Doctrine B makes canonical state the recovery anchor in its own right —
independent of any orchestrator. PR-1 ships without prerequisite
assumptions about future PRs.

#### Conclusion: rejected on substrate-specific grounds, not on aesthetics

This is the load-bearing distinction. Doctrine A is **not** rejected
because audit-first is wrong in general. Many real-world financial
systems run audit-first successfully. It is rejected because **this
particular substrate has three substrate-specific properties** that
all align canonical-first:

1. Detector orientation (A1).
2. Two production convergence islands already operating canonical-first (A2).
3. Deferred orchestrator decision that audit-first would silently pre-commit (A5).

If any of these three properties changes (detector reframes; convergence
islands drift; D5 ships), Doctrine A becomes re-eligible. Until then,
**it is closed for this migration**.

---

## §4. Rollback semantics (corruption-detection contract)

If PR-1 is rolled back, the bridge writes stop. **What the detector does
in that moment is the corruption test.**

### §4.1 — Detector classes that MUST return to their pre-PR-1 state after rollback

| Detector class | Pre-PR-1 baseline state | Post-rollback state | If does not match | Implication |
|---|---|---|---|---|
| `escrow_payouts_orphan` per release | fires for every non-HTTP release | **MUST** fire for every release where bridge had been driving canonical | Bridge was creating canonical rows that survive rollback → silent dual-write existed → **CORRUPTION** |
| `wallet_not_credited` per release | fires today | **MUST** fire for newly-released escrows post-rollback | Bridge has continued running after rollback → rollback incomplete → **CORRUPTION** |
| M2 `wallet_journal_drift` | 0 today | **MUST remain** 0 | Bridge introduced wallet/log mismatches that survive rollback → **CORRUPTION** |
| M4 `escrow_releases_without_ledger` | fires on non-HTTP triggers | **MUST** fire on every non-HTTP release post-rollback | Bridge ledger emits leaking past rollback → rollback incomplete OR ledger events were written from a non-bridge path that wasn't in inventory → **CORRUPTION** |
| `legacy_drift` per developer | fires per escrow_payouts ∩ ¬canonical pair | **MUST** fire for developers whose escrow_payouts post-bridge are now in canonical → returns when canonical writes stop | This one is subtle: if a developer's canonical state from bridge era survives rollback, `legacy_drift` will be CORRECTED (canonical now matches legacy because bridge wrote canonical). **That's NOT corruption.** It's residual convergence. Mark for D3-freeze inspection but not a rollback failure. |

### §4.2 — Detector classes that MUST NOT change on rollback

| Detector class | Why it must not change |
|---|---|
| M3 `payouts_root_vs_journal` | PR-1 doesn't touch Path C. If M3 moves on rollback → bridge touched something out of scope → **CORRUPTION** |
| M5 `payout_intents_never_settled` | Same — Path C scope |
| M6 `modules_done_without_canonical_credit` | This is module-level. If bridge was correct, this class will have *dropped* during PR-1 era for escrow-triggered modules. After rollback, it should **rise back to its pre-PR-1 cardinality for those exact modules**. If rises HIGHER, bridge had latent side effects → **CORRUPTION**. If does not rise → bridge has not actually been rolled back. |

### §4.3 — Detector class disappearance audit (the §E.5 rule)

The addendum §E.5 rule remains in force, scoped to PR-1:

> If any detector class flips from >0 to 0 with no other change →
> Rollback; the indexes / bridge are masking a defect class rather
> than enforcing an invariant.

For PR-1, "no other change" means:
- No new application code path other than the declared bridge.
- No data mutation other than what `_canonical_credit` is contracted to do.
- No detector code change.

If any detector class disappears post-PR-1 *and* none of the bridge writes
explain its disappearance, that is observability regression, not progress.
**Rollback PR-1.**

### §4.4 — Rollback procedure (declared, not executed)

This procedure is declared here so that future-author can execute it
verbatim. It is NOT executed in this PR.

1. Identify bridge insertion point (single call site in
   `escrow_layer.release_escrow` after B.6 per-developer loop iteration).
2. Remove the `_canonical_credit` invocation.
3. **DO NOT** touch any data rows. The PR-0 indexes remain in place;
   the source_path backfill remains in place. Rollback inverts code,
   not substrate.
4. Re-run the same three measurements as PR-0: pre-rollback /
   post-rollback / +smoke. Apply §4.1–§4.3 classification.
5. If any class in §4.1 does NOT return as expected → **CORRUPTION**.
   Stop, declare incident, do not retry PR-1 until investigated.
6. If §4.1 returns cleanly → rollback success. PR-1 is parked pending
   redesign.

---

## §5. Acceptance criteria for PR-1 itself

These criteria define when PR-1 implementation (future PR) is shippable.
PR-1 acceptance is **stricter** than PR-0 because PR-1 changes behaviour.

### §5.1 — Substrate invariants (must hold after PR-1 ships)

| Invariant | Mechanism |
|---|---|
| `(module_id, source_path)` unique on `dev_earning_log` | PR-0 enforced |
| `payout_id` unique on `escrow_payouts` | PR-0 enforced (pre-existing) |
| `payout_id` unique on `payouts` | PR-0 enforced |
| `(event_type, idempotency_key)` unique on `money_ledger_events` | already present (`ledger_idempotency_unique`) |
| Every B.6 write within the release loop is followed by exactly one bridge invocation per developer share | PR-1 code contract |

### §5.2 — Behavioural invariants (must hold under live + smoke traffic)

| Behaviour | Detector signal |
|---|---|
| Every release via HTTP path produces zero new `escrow_payouts_orphan` | per-module class count = 0 for newly-released modules |
| Every release via `module_motion` produces zero new `escrow_payouts_orphan` | same as above; convergence island #1 already operates under D2=E semantics, bridge is propagation |
| Every release via `escrow_api.py:177` (admin force) produces zero new `escrow_payouts_orphan` | same as above |
| Wallet balance after release equals legacy `total_earnings` for that developer **up to** the as-of timestamp | `legacy_drift` count = 0 for new developers; existing drift on seeded developers unchanged (gated by D3) |
| M4 `escrow_releases_without_ledger` count does not exceed pre-PR-1 count on any new release | M4 monotone non-increasing on new data |

### §5.3 — Hard rollback triggers (per §4)

- `M2_wallet_journal_drift` count rises on new releases.
- `M3_payouts_root_vs_journal` count changes.
- `M5_payout_intents_never_settled` count changes.
- `M6_modules_done_without_canonical_credit` count changes on
  non-escrow-triggered modules.
- Any detector class disappears without an explanation traceable to
  bridge semantics.

### §5.4 — Observation window (PR-1)

≥ 7 days of live (non-smoke) traffic under PR-1 with §5.2 holding and
§5.3 not triggering. Same shape as PR-0 acceptance window.

### §5.5 — Counter-cases that MUST be probed before shipping

To be probed by a directed smoke trace (NOT in this planning PR, but
required before PR-1 implementation ships):

1. **Concurrent retry on the same release** — two operators force-release
   the same escrow milliseconds apart. Expected: one bridge invocation
   succeeds; the second hits `DuplicateKeyError` on
   `dev_earning_log.(module_id, source_path)` and no-ops correctly.

2. **Bridge mid-failure recovery** — kill the process between B.6 and
   bridge step 1. On process restart, retry release. Expected: B.6 hits
   `escrow_payouts.payout_id` unique constraint → existing
   `escrow_payouts` row stays; bridge proceeds with new logic and
   completes canonical. Detector signal returns to zero.

3. **HTTP + module_motion race** — `client_approve_module` fires and
   `module_motion` auto-promotes the same module in the same 15s window.
   Expected: whichever wins, the other no-ops via existing pre-reads +
   PR-0 unique constraint. Same `dev_earning_log` row; one wallet $inc;
   ledger events deduped by idempotency_key.

4. **Retry-after-partial-network-timeout** — the production-shaped
   happy-path failure. Sequence:

   (a) HTTP-triggered release fires; B.6 succeeds; bridge canonical
       credit (step 1 + step 2) succeeds; ledger emit succeeds.
   (b) HTTP caller's connection times out **before the response is
       delivered** (network blip, load balancer drop, client cancel).
       From the caller's perspective, the request failed.
   (c) Upstream client retries with the same request identity.
   (d) Second attempt re-enters `escrow_layer.release_escrow` for the
       same escrow. Each substrate enforcement point fires in turn:
       - B.6 `escrow_payouts.payout_id` unique → collision
       - bridge step 1 `dev_earning_log.(module_id, source_path)` unique → collision
       - ledger emit `(event_type, idempotency_key)` unique → collision

   Expected: **every collision is classified as convergence-success
   per Doctrine B + F-4 semantics.** Wallet does not double-credit. No
   detector class fires. HTTP response (success) returns to client
   on the retry.

   This counter-case is the **load-bearing production readiness test**.
   Unlike cases 1–3 (synthetic concurrency / synthetic crash), case 4
   is the everyday failure shape of every real HTTP-driven money
   system. It exercises PR-0 substrate enforcement and PR-1 bridge
   semantics together in a single round-trip, and it is the scenario
   most likely to surface latent bugs that the previous three cases
   miss (e.g. ledger idempotency_key reused across writers leading to
   silent suppression of a legitimate distinct event).

These four counter-cases are the **load-bearing failure scenarios**
that the implementation PR must produce smoke trace artefacts for.

---

## §6. What PR-1 explicitly does NOT do

| Action | Reason |
|---|---|
| Touch Path C (work pipeline, `work_execution.py`) | PR-2 scope |
| Touch Path D (withdrawals, `dev_withdrawals`) | Already correct; no bridge needed |
| Freeze B.7 (`users.$inc total_earnings`) | Decision 3 freeze, deferred PR-5 |
| Remove `escrow_payouts` collection or its writes | It is the immutable per-release audit record; under D1=D it has explicit canonical scope |
| Introduce a single-orchestrator function | Decision 5 = 2.F, deferred PR-6 |
| Refactor `release_escrow` control flow | Bridge is appended, not interleaved |
| Touch `_credit_module_reward` (Path A canonical) | Bridge does not replace Path A; convergence is per-source-path |
| Change detector severity / class definitions | PR-1 does not alter observability |
| Re-baseline smoke trace artefacts | Baselines remain immutable per addendum §E.1 |
| Add unique indexes beyond PR-0 | PR-0 substrate is sufficient for PR-1; new indexes would be a separate PR with its own acceptance window |
| Add retry wrappers / catch-and-continue around bridge calls | Same forbidden list as PR-0 |
| Fix the smoke harness cleanup gap | See §7 — explicitly deferred |

---

## §7. Harness-gap isolation note

Re-asserted from PR-0 acceptance report §4 and §8:

> The smoke trace harness (`scripts/escrow_smoke_trace.py`,
> `scripts/work_execution_smoke_trace.py`,
> `scripts/withdrawal_smoke_trace.py`) tags seed entities with
> `smoke_seed: True` and cleans them via `delete_many({"smoke_seed": True})`.
>
> Production code paths invoked by smoke traces (e.g.
> `escrow_layer.create_escrow`, `release_escrow`,
> `_credit_module_reward`) create cascade rows in `escrows`,
> `escrow_payouts`, `dev_earning_log` **without propagating** the
> `smoke_seed` flag. Those rows survive `--cleanup-after` and leak into
> subsequent blast-radius / detector measurements.

### §7.1 — PR-1 is FORBIDDEN from touching the harness

Reason: timing contamination. If the harness cleanup semantics change
during the PR-1 observation window, we cannot separately attribute:
- substrate convergence outcomes from bridge writes
- harness lifecycle changes from cleanup-flag propagation
- smoke trace artefact differences from either

The user's framing (paraphrased):

> Currently we have freshly activated enforcement layer, first real
> observation window, first post-index runtime. If we change harness
> cleanup semantics now, we mix substrate enforcement observations with
> harness lifecycle changes. That worsens attribution clarity.

### §7.2 — Harness fix is its own future mini-PR

The harness gap will be fixed as a **separate isolated PR** that:

- Runs **AFTER** PR-1's 7-day observation window closes cleanly.
- Has its own pre/post baseline pair.
- Touches **only** harness code (`scripts/*.py`).
- Does not touch `backend/`, `frontend/`, `web/`.
- Has its own acceptance contract analogous to PR-0 §E.

Until that mini-PR ships:
- Acceptance comparisons for PR-1 are made against the **post-PR-0
  stable substrate state**, not against pristine baselines.
- The drift between [post-bridge] and [post-bridge + smoke residue] is
  not a PR-1 acceptance signal.
- The drift between [pre-PR-1] and [post-PR-1] on **non-smoke live
  traffic** IS the PR-1 acceptance signal.

### §7.3 — Future-author guard rail

Anyone reading this plan in the future and considering "while we're in
here, let's also tidy up the cleanup function": **don't.** Open a
separate PR. The reason is in §7.1.

---

## §8. Outstanding gates opened by PR-1 (declared, deferred)

These are deferred until either (a) PR-1 implementation completes and
its observation window closes cleanly, OR (b) explicit re-evaluation.

| Gate | Scope | When |
|---|---|---|
| Directed smoke trace covering §5.5 counter-cases | Stage 7B observation harness extension | Before PR-1 implementation ships |
| `payouts.reason=partial_on_cancel` terminal-status trace (Addendum §G) | PR-2 (Path C) scope blocker | Before PR-2 plan is authored |
| `module_motion` partial-failure semantics under forced A-success B-fail injection | PR-6 (orchestrator) risk model | Stage 7B observation |
| Harness cleanup-flag propagation | Isolated mini-PR | After PR-1 7-day window closes |
| Decision 3 freeze (`users.$inc total_earnings` removal) | PR-5 | After PR-1 + PR-2 both clean for ≥ 7 days |
| Decision 6 enforcement (`M4` severity raise from info → error) | PR-3 | Concurrent with PR-1 if bridge ledger emits prove reliable |

---

## §9. Forensic timeline addendum

This planning artifact is the next entry in the timeline started by the
addendum §I:

```
[Stage 7B / PR-0]    EXECUTED — substrate enforcement layer active
                     ([A]==[B] proven; [B]→[C] attributed to harness gap)
[Stage 7B / PR-0]    Provisional acceptance granted; observation window opened
                     (terminates ~2026-05-21 20:50 UTC)
[Stage 7B / PR-1 plan]  THIS DOCUMENT — bridge contract, ordering doctrine,
                        failure matrix, rollback semantics declared
[Stage 7B / PR-1 implementation]  GATED on:
                                  - PR-0 7-day window passing cleanly
                                  - §5.5 counter-case smoke traces written
                                  - this plan accepted by owner
[Stage 7B / harness mini-PR]      GATED on: PR-1 7-day window passing cleanly
```

---

## §10. One-paragraph summary

PR-1 makes the latent convergence at the Path B writer chain explicit
and enforceable by appending a single `_canonical_credit` invocation
after each `escrow_payouts.insert_one` inside `escrow_layer.release_escrow`.
The helper writes `dev_earning_log` keyed by
`(module_id, source_path="escrow_release")`, $inc's `dev_wallets`, and
emits `money_ledger.EVENT_EARNING_APPROVED` — in that order
(Doctrine B, consistent with both existing convergence islands). The
plan introduces zero new corruption surfaces, maps every failure mode
to an existing detector class, and defines rollback semantics by
detector-class return-to-baseline expectations. The smoke harness
cleanup gap is explicitly forbidden from being touched by PR-1.

End of plan.
