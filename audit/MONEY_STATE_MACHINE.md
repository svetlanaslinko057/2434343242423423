# Money State Machine — Human-Facing Economic Truth Model

**Status:** 📋 PRODUCT CONSTITUTION — human-facing reality, not technical spec.
**Date:** 2026-05-14
**Audience:** product, support, operator-facing copy, future engineering decisions where they touch money.
**Predecessors:** the entire Stage 7 audit chain (substrate-side). This is the
human-side mirror.

This document does not describe how money moves. The substrate documents
(`MONEY_WRITER_INVENTORY*.md`, `PR0_ACCEPTANCE_REPORT*.md`,
`PR1_PATH_B_BRIDGE_PLAN.md`) cover that. This document describes
**what truth the platform owes the human at each moment**.

If a future feature, refactor, or migration would force a human to
experience a money state not described here, that feature is wrong —
not the document.

---

## Operating principle

> **A money system is not the database. A money system is what the user
> believes is true about their money, plus the contract that the
> platform stands behind that belief.**

The substrate has finally reached the point where it can tell the truth.
This document is what truth it has been hired to tell.

---

## §1. Developer money journey

The developer's lived experience of money on this platform. Each row is
a state the developer can be in at any moment. The right two columns
are the **product contract** — what the developer believes, and what
the platform must keep true regardless of failures.

| # | Developer state | What the developer thinks | What the platform must guarantee |
|---|---|---|---|
| D-1 | **No active module** | "Nothing is owed to me yet." | The wallet's `available_balance` and `pending_withdrawal` together equal exactly what has been earned but not yet withdrawn. Zero is honest zero. |
| D-2 | **Module assigned** | "I have work to do. No money has been earned yet." | Assignment alone never produces a money state. No row in any money surface exists for this developer–module pair until work is accepted. |
| D-3 | **Module in progress** | "I'm working. The reward I see on the marketplace is what I will earn if I deliver." | The agreed reward (visible at acceptance time) is locked. It cannot decrease silently. Any change to the agreed amount must be visible to the developer before it takes effect. |
| D-4 | **Module submitted, awaiting review** | "I delivered. I'm waiting for the client / QA decision." | The developer is never billed for the time the platform takes to review. Review duration is platform overhead, not developer cost. |
| D-5 | **QA in progress** | "Someone is checking my work." | The developer is told *which* outcome paths are possible from this state (pass → credit; fail → revision; reject → no credit). No fourth outcome may surface later. |
| D-6 | **Module approved (the critical moment)** | "I earned this money. It should be in my balance now or in a known short delay." | Either the wallet has already been credited, or there is a visible, time-bounded "settlement pending" indicator. Silent gaps between approval and credit are forbidden. (See §5 forbidden combinations: `module.done && !payout_authorized`.) |
| D-7 | **Wallet credited** | "My balance went up. This money is mine." | `available_balance` is the source of truth. The wallet display is the contract surface. Any other view that disagrees is the one that's wrong. |
| D-8 | **Withdrawal requested** | "I asked to cash out. The amount is reserved. I can't spend it twice." | The requested amount moves atomically from `available_balance` to `pending_withdrawal`. The developer cannot double-spend by requesting twice. The total `available_balance + pending_withdrawal` equals what it was before the request. |
| D-9 | **Withdrawal pending admin decision** | "I'm waiting for approval." | The developer sees the request status and an expected decision window. The request cannot be silently rejected or silently approved. |
| D-10 | **Withdrawal approved, not yet paid** | "Approved — money is on its way." | The amount stays in `pending_withdrawal` until external payment settles. The developer cannot "have it both ways" (available AND pending). |
| D-11 | **Withdrawal paid** | "Money is out of the platform." | `pending_withdrawal` returns to its prior level minus the paid amount; `withdrawn_lifetime` increases by exactly the paid amount; `available_balance` is unchanged from the pre-paid state. The conservation of mass is the contract. |
| D-12 | **Withdrawal rejected** | "It didn't work — money should come back to me." | The full requested amount returns from `pending_withdrawal` to `available_balance`. The reason is visible. The developer is never left in a "rejected but still locked" state. |
| D-13 | **Module cancelled mid-flight (partial work)** | "The project ended early. I should get paid for what I actually did." | If `compute_dev_earned > 0`, a partial settlement event is visible. The amount, basis, and resolution path are explained. Cancellation never produces a *zero-or-full* outcome silently. |
| D-14 | **Anomaly detected by platform** | The developer should not encounter this state in normal use — but if they do: "The platform saw a problem and is resolving it." | The developer sees that an issue exists, that the platform owns it, and that money is not lost. No "money is missing, you figure it out" experience. |

### Critical observation about D-6

Between "module approved" and "wallet credited" lies the entire reason
PR-1 exists. Under the pre-PR-1 substrate, this gap could be silently
permanent for non-HTTP triggers. Under the PR-1 substrate, the gap is
either zero (canonical-first Doctrine B) or detectable (one of M2, M4,
or escrow_payouts_orphan fires).

**The product promise that flows from this:** if a developer ever
experiences "my work was approved but I see no money", that experience
is now a **bug in the system**, not a feature of the system. Before
PR-1, it was a feature.

---

## §2. Client money journey

The client's lived experience of money on this platform.

| # | Client state | What the client thinks | What the platform must guarantee |
|---|---|---|---|
| C-1 | **Project idea described** | "I'm describing what I want. No commitment yet." | No money state exists for this project. Estimates and scope previews are not invoices. |
| C-2 | **Estimate received** | "Here is the price the platform proposes." | The estimate is binding to the platform for a stated window. The client cannot be surprised by a different number on the contract. |
| C-3 | **Contract signed** | "I agreed to the price. Now I owe this amount." | An invoice exists. The contract amount and the invoice amount are equal. There is no third number. |
| C-4 | **Invoice paid** | "My money has left my account." | The platform acknowledges receipt within the payment processor's settlement window. Until acknowledged, the client never sees "paid" claimed against unsettled funds. |
| C-5 | **Escrow funded** | "My money is locked for this project specifically. The platform can't redirect it." | The locked amount on the project is exactly the invoice amount paid. A single client payment never funds two projects. |
| C-6 | **Work in progress on a module** | "The team is building the thing I paid for." | The client can see what was promised (scope), what is being delivered (modules), and how the locked money maps to deliverables. |
| C-7 | **Module delivered for review** | "I can look at what was built. I can accept or push back." | The client has a defined window to respond. No money moves while the window is open. |
| C-8 | **Module accepted** | "I'm satisfied. The developer should get paid for this." | The release event is recorded. The client sees the release as "money sent on my behalf to the team that built this module". |
| C-9 | **All project modules accepted** | "The project is complete." | The total of all released amounts equals the contracted price (modulo recorded discounts / scope changes). No phantom remainder. |
| C-10 | **Project refund / cancellation** | "I should get back what hasn't been used." | Refundable balance = locked amount − amount already released to developers. The client never has to subtract these themselves. |
| C-11 | **Dispute opened** | "Something didn't go right." | The funds at issue are placed in a visible holding state. Neither side can move them unilaterally. |
| C-12 | **Anomaly detected by platform** | "The platform saw a problem with my project's money." | The client sees ownership of the issue rests with the platform, not with them. They are not asked to reconcile internal records. |

### Critical observation about C-8

When the client clicks "accept" on a module, the substrate today does
roughly seven things across three writers (Path A approve, Path B
release, Path F ledger). From the client's perspective, **all seven
happen at once or none of them happens**. There is no "I accepted, but
the developer wasn't credited" state visible to the client. If it
happens internally, it is the platform's anomaly to resolve, not the
client's.

---

## §3. Admin / operator truth surface

The operator is not staring at MongoDB collections. The operator is
**resolving human contradictions** that the substrate has surfaced.

The right column is the operator's actual user story — not "what
table to query".

| Detector class (internal) | What the operator is actually resolving |
|---|---|
| `wallet_not_credited` | A developer completed approved, paid work but their balance never went up. Restore the developer's experience of being credited. |
| `escrow_payouts_orphan` | A client's money was released against a module, but the developer it was released to does not see it in their wallet. The money is somewhere; the developer is owed visibility. |
| `M2 wallet_journal_drift` | A developer's wallet balance and the history of their earnings do not agree. One of them is right; the operator decides which, and the other must be corrected. |
| `M3 payouts_root_vs_journal` | A payment record exists in one part of the system claiming the developer was paid X, while the developer's earnings history shows Y. The operator decides which the developer should see. |
| `M4 escrow_releases_without_ledger` | A money movement happened with no audit entry. The movement is real; the audit gap is the issue. Reconstruct the audit. |
| `M5 payout_intents_never_settled` | An obligation was declared to a developer (work-pipeline `payouts.status=pending|approved`) and never closed. Either pay it, cancel it, or move it back to "in review". Never leave it open silently. |
| `M6 modules_done_without_canonical_credit` | A module is closed but no developer was credited for it. Either credit the developer or explicitly mark the module as zero-reward with a recorded reason. |
| `legacy_drift` | Two different views of "total earnings for this developer" show different numbers. Pick the canonical one; explain to the developer if they had been seeing the wrong one. |
| `release_mismatch` | An escrow says it released X total, but the per-developer breakdown sums to Y. Either X is wrong or Y is wrong; the operator finds which and aligns the other. |
| `M1 legacy_signal_without_wallet` | A legacy earnings record exists for a developer who has no canonical wallet row. Decide: is this a developer who was paid before the canonical surface existed? Backfill or write off, explicitly. |

### The operator's first principle

**The operator never fixes data. The operator restores narrative.**

Every anomaly the substrate surfaces is a place where a human (developer,
client, or auditor) is currently experiencing — or about to experience —
a story that the platform has not honoured. The fix isn't a SQL update.
The fix is restoring the story.

The data change is the by-product. The customer-visible repair
(message, balance update, audit annotation) is the deliverable.

---

## §4. Canonical economic state graph

This is the business-level lifecycle every dollar travels. It is the
graph that the product is selling. The substrate's job is to make this
graph executable; this document's job is to make this graph **the only
graph that exists**.

```
                  ┌──────────────────────┐
                  │  invoice_created     │   "client owes platform"
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  invoice_paid        │   "client has paid platform"
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  escrow_funded       │   "money locked to project"
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  work_accepted       │   "module assigned to dev"
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  work_completed      │   "QA passed"
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  payout_authorized   │   "amount decided for dev"
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  wallet_credited     │   "dev sees money in balance"
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  withdrawal_requested│   "dev asks to cash out"
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  withdrawal_approved │   "admin approves"
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  withdrawal_paid     │   "money leaves platform"
                  └──────────────────────┘

Side branches (must each have a defined terminal state):
  • invoice_void       ← from invoice_created
  • invoice_overdue    ← from invoice_created, then to invoice_paid OR invoice_void
  • module_cancelled   ← from work_accepted or work_completed
    └─ if partial work done: payout_authorized (partial)
       └─ wallet_credited (partial)
  • escrow_refunded    ← from escrow_funded if project cancelled
  • withdrawal_rejected ← from withdrawal_requested or withdrawal_approved
```

### Rules of the graph

1. **Every dollar that enters the platform must reach a terminal node.**
   Terminals are: `withdrawal_paid` (to a developer), `escrow_refunded`
   (to a client), `invoice_void` (never collected), or held in a
   declared dispute state. There is no fifth terminal.

2. **No node can be silently skipped.** Going from `work_completed`
   directly to `withdrawal_requested` without `wallet_credited` is not
   a valid edge. Every transition is observable.

3. **Backward transitions exist only at declared points.** Modules can
   be cancelled. Withdrawals can be rejected. Escrows can be refunded.
   But once a withdrawal is `paid`, money has left the platform and
   cannot be unpaid by the platform alone.

4. **Time bounds are part of the contract.** Each node has an expected
   maximum residence time. Staying in `invoice_paid` for hours without
   reaching `escrow_funded` is an anomaly even if no money has moved
   incorrectly.

5. **The graph is the same for everyone.** Admin power can change
   *which* path a transaction takes, not what paths exist. Admin
   cannot invent a state.

---

## §5. Forbidden narrative combinations

These are the user-visible contradictions. Each row is a state pair the
platform must never let a human observe. The detector classes in §3
are how the substrate surfaces these contradictions; this section is
why they are contradictions.

| Forbidden combination | Why it's forbidden (the human-visible contradiction) |
|---|---|
| `escrow_released` **AND** `!wallet_credited` | Client sees "money sent on my behalf"; the developer it was sent to sees nothing. Two humans see opposite truths about the same dollar. |
| `withdrawal_paid` **AND** `wallet.pending_withdrawal > 0` for the same request | Developer is told "your withdrawal completed" while the wallet still shows the request as in-flight. Contradiction in a single screen. |
| `payouts.status=paid` **AND** no `dev_earning_log` row | Admin dashboard says the developer was paid; the developer's own statement of earnings doesn't include the payment. Two views of the same transaction don't agree. |
| `invoice_paid` **AND** `!escrow_funded` for that project | Client believes their money is committed to a project; the project shows no locked funds. Money entered the platform with no declared purpose. |
| `module.done` **AND** `!payout_authorized` for the assignee | Work was officially accepted but no one decided what to pay the developer. Acceptance without economics is forbidden. |
| `wallet_credited` **AND** `!invoice_paid` upstream | Developer balance reflects money that no client ever sent. Money was created from nothing. The platform has been over-promised. |
| `withdrawal_approved` **AND** `!withdrawal_requested` by the developer | Admin approved a withdrawal the developer never asked for. Movement initiated against the user's will. |
| `module.cancelled` **AND** developer credited the full `dev_reward` | Cancellation should produce partial settlement at most; full settlement on cancellation is fraud-shaped. |
| `withdrawal_rejected` **AND** money does not return to `available_balance` | Developer was told "no" and money is still locked. The "no" is incomplete. |
| `escrow_refunded` **AND** developers already credited from that escrow | Client got money back; developers were also paid. The arithmetic doesn't close. |
| `legacy total_earnings > 0` **AND** `dev_wallets` row absent for the same developer | A developer "exists in the books" but not "in the wallet". Person without an account is owed money. |
| Detector class disappears without any visible resolution | A reported anomaly silently became non-anomaly. The user who was about to see resolution sees... nothing. Story dropped. |

### The last row deserves its own paragraph

The §E.5 substrate rule — *"detector class going from >0 to 0 without
other change = rollback"* — has a human-side mirror: **every detector
disappearance must produce a user-visible resolution event**. Either
the affected developer gets a "we found and fixed it" message, or the
operator records "we determined this was not a real anomaly, here's
why". Silent disappearance is structurally identical to lying about
having had a problem.

---

## §6. User-visible guarantees (the platform constitution)

Each of these is one sentence the platform stakes its reputation on.
They are not implementation goals. They are the contract.

### Developer guarantees

1. **No invisible payment states.** Accepted work cannot disappear into
   a state the developer cannot see. If the system has decided you
   earned money, the system has told you.

2. **Wallet is truth.** What `available_balance` says is what is
   withdrawable. The platform does not maintain a "real balance"
   different from the one you see.

3. **Withdrawals have three outcomes and only three.** A withdrawal
   request resolves to `paid`, `rejected`, or remains `pending`
   (with visible status). There is no fourth outcome. There is no
   silent expiration. There is no "we lost track of it".

4. **Cancellation is honoured proportionally.** If a project is
   cancelled after you did real work, you are paid for the real work.
   The platform calculates the amount; the developer does not
   reconstruct it from logs.

5. **Anomalies are the platform's problem.** If the system surfaces an
   anomaly that affects you, you are told that the platform owns the
   fix — not that you should reconcile your records against ours.

### Client guarantees

1. **Locked money has a purpose.** Every dollar a client pays into the
   platform is funded against a specific project. The system never
   collects money "for general use".

2. **Released escrow has a beneficiary.** When the platform tells the
   client "this escrow released", a developer (or set of developers)
   received the funds. The release event maps to a visible payout
   outcome.

3. **Refunds are mathematically complete.** Refundable amount = paid
   amount − amount already released to the team. The client never has
   to subtract these themselves and never has to argue about the
   arithmetic.

4. **Cancellation closes the books.** A cancelled project either ends
   with all escrow refunded, or with a fully documented partial
   release plus refund of the remainder. There is no third state.

5. **The platform does not move client funds without client action.**
   The only events that move a client's locked money are: client
   acceptance of a module, client-approved refund, or a dispute
   resolution following a defined process. No automatic redirection.

### Platform / operator guarantees (to itself)

1. **Every money anomaly maps to an explainable lifecycle break.** If
   the detector fires and the operator cannot say *which* node-to-node
   transition in §4 failed, the operator's tooling is incomplete, not
   the anomaly.

2. **No anomaly is invisible.** The detector classes in §3 cover every
   shape of contradiction in §5. If a new shape of contradiction is
   discovered in production, the detector grows to cover it before
   the next release.

3. **Silent healing is forbidden.** Resolved anomalies produce an
   explicit, recorded resolution. The detector dropping a class to
   zero with no recorded resolution is a P1 incident, not a victory.

4. **The substrate may become stricter; it may not become quieter.**
   Adding enforcement (PR-0, PR-1, future PRs) must reduce
   contradictions, not reduce observability of contradictions.

---

## §7. Detector → narrative mapping

This is the translation layer. Engineering observes detector class
names; humans observe stories. The translation is the product
instrument.

| Detector says (internal) | Product says (narrative) | Action owner |
|---|---|---|
| `wallet_not_credited count: N` | "N developers were promised payment that never became visible in their balance." | Operator must restore each developer's view of being paid. |
| `escrow_payouts_orphan count: N` | "N escrow releases sent money to developers who do not yet see it." | Operator must close the visibility gap per developer. |
| `M2 wallet_journal_drift count: N` | "N developers see a wallet balance that disagrees with their earning history." | Operator must reconcile and inform the developer. |
| `M3 payouts_root_vs_journal count: N` | "N developers have an admin-side record of payment that does not match what they themselves see." | Operator decides which view is right; the developer's view is corrected if it was wrong. |
| `M4 escrow_releases_without_ledger count: N` | "N money movements happened with no audit-trail entry. Money is fine; the receipt isn't." | Operator backfills the audit; no developer-facing communication needed unless the developer asks. |
| `M5 payout_intents_never_settled count: N` | "N declared obligations to developers are open and not closed." | Operator must close each one to `paid`, `cancelled`, or back to `pending review`. |
| `M6 modules_done_without_canonical_credit count: N` | "N completed work items have no associated developer credit." | Operator credits or formally marks as zero-reward with a recorded reason. Developer is told either way. |
| `legacy_drift count: N` | "N developers see different total-earnings numbers in different views." | Operator picks the canonical number; views that disagreed are corrected. |
| `release_mismatch count: N` | "N escrows say they released more (or less) than the sum sent to developers." | Operator finds the missing or extra release; client and developers see the corrected statement. |
| `M1 legacy_signal_without_wallet count: N` | "N developers have a historical earnings record but no current wallet." | Operator either reconciles to a new canonical wallet or formally writes off with the developer's knowledge. |

### What this translation forbids

The translation forbids treating a detector class as resolved by
"making the number go down". The detector class is **a count of
humans whose story is currently incoherent**. Resolution requires
that each of those humans has been moved to a coherent story —
not that the count decreased.

If the count went from 3 to 0 because data was deleted, the count
is wrong. If the count went from 3 to 0 because three humans were
each told what happened and shown a corrected view, the count is right.

This is the §E.5 rule in product form.

---

## §8. What is NOT in this document (deliberate exclusions)

- ❌ UI mockups, screen layouts, copy strings.
- ❌ API endpoint design or contract specs.
- ❌ React component structure.
- ❌ Websocket event shapes.
- ❌ Orchestration / reconciliation algorithms.
- ❌ New detector definitions.
- ❌ Bridge code (PR-1 / PR-2 scope).
- ❌ Database schema decisions.

If any of these are needed to make the constitution true, they will
be added in separate documents that **reference this one as their
acceptance criterion**, not the other way around.

---

## §9. How this document gets used

1. **Before a money-touching feature ships,** the PM/engineer asks:
   "Does this introduce a state not in §1, §2, §4, or §6?"
   If yes, either this document grows first, or the feature is wrong.

2. **Before an anomaly resolution playbook is written,** the operator
   asks: "Which row in §3 is this? Which guarantee in §6 is being
   honoured by the resolution?" If no row fits, the detector class
   needs a §7 entry first.

3. **Before a new detector is added** (out of scope for current PR-1
   plan but inevitable later), the detector author asks: "What human
   contradiction in §5 does this surface?" If none, the detector is
   probably measuring infrastructure, not money.

4. **Before a forbidden combination becomes possible** (e.g. a refactor
   removes a constraint), the change is blocked. §5 is not aspirational.
   It is the firewall.

5. **Before a customer-facing support message is sent** about money,
   the writer checks: "Does this message respect a §6 guarantee, or
   am I asking the customer to do operator work?" If the latter, the
   message is rewritten.

---

## §10. The single sentence

> **The platform owes every human exactly one coherent story about their
> money, and the substrate's job is to make sure that story stays
> coherent under every failure mode, retry, and migration the platform
> ever encounters.**

Everything in this document, in the audit chain, in PR-0, in PR-1, and
in every future PR is in service of that single sentence.

End of constitution.
