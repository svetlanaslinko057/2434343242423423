# Money State Machine — Queued Additions

**Status:** 📋 QUEUE — append-only expansion intent, NOT yet applied.
**Date queued:** 2026-05-14
**Apply window:** after PR-0 7-day observation window closes cleanly
                  (≥ 2026-05-21 ~20:50 UTC) AND before PR-1 implementation begins.
**Apply mode:** append-only to `/app/audit/MONEY_STATE_MACHINE.md`.
                The constitution as sealed today is the version of record;
                these additions are explicit extensions, not corrections.

This file exists so that the queued intent does not get lost during the
observation window. The constitution itself remains untouched during
the window per the operating principle "observation > velocity".

---

## Queue item Q-1 — §4 backward transition: `dispute_hold`

**Where it goes:** §4 "Canonical economic state graph", side-branches section.

**Why it is qualitatively different from existing branches:**

The four existing backward transitions (`invoice_void`, `invoice_overdue`,
`module_cancelled`, `escrow_refunded`, `withdrawal_rejected`) all share
a property: **one side initiates, the other side accepts the outcome**.
The narrative remains linear even if it reverses.

`dispute_hold` is the first state in which:
- **Both parties can simultaneously believe they are correct.**
- Money **intentionally stops moving** while truth is contested.
- Platform truth becomes **adversarial, not linear** — the platform's
  role flips from "executor of agreed flow" to "neutral holder of
  contested funds".

**Implication for the constitution:**

`dispute_hold` requires its own row in §1 (developer) and §2 (client)
because both parties have a distinct lived experience of the same state.
The developer experiences "I worked and someone is contesting my pay"; the
client experiences "I paid for something I dispute received". Both
guarantees apply simultaneously and they cannot both prevail.

**Implication for §6 guarantees:**

The platform must add (post-window) a clause: "*During dispute hold,
the developer's withdrawability guarantee and the client's refundability
guarantee are both suspended in the contested amount. Neither party
loses; neither party gains. The hold itself is the contract.*"

---

## Queue item Q-2 — §4 backward transition: `administrative_override`

**Where it goes:** §4 "Canonical economic state graph", side-branches section
                   — but with the most explicit caveat in the document.

**The required framing (mandatory verbatim):**

`administrative_override` is **not** "an admin changed a state".
`administrative_override` is **"platform has suspended normal guarantees"**.

This distinction is load-bearing. Any softer framing makes override a
**silent corruption primitive**: an admin can make any contradiction
invisible by relabelling it as override.

**The hard rules for this state (to be written into the constitution
post-window):**

1. **Override is always visible.** It surfaces to every affected human
   as "the platform took manual action on this transaction". It does
   not look like a normal completed transaction.

2. **Override carries a reason and a responsible operator identity.**
   The state itself records who decided what, and why.

3. **Override has a maximum duration.** It is not a permanent state.
   It resolves into either a normal terminal node (with recorded
   reconciliation) or escalates to dispute_hold.

4. **Override cannot rewrite history.** It can only declare a new
   present state. Past detector entries that fired about the
   transaction remain visible.

5. **Override is the ONLY state in which a §6 guarantee is allowed
   to be temporarily not auto-enforced.** Any other state where a
   guarantee fails is a bug.

**Implication for §5 forbidden combinations:**

A 13th forbidden combination (post-window): `administrative_override`
combined with detector class returning to zero **without** an explicit
override-resolution record. This is the override-as-silencer attack
vector and must be explicitly named as forbidden.

---

## Queue item Q-3 — §5 forbidden combination: phantom money

**Where it goes:** §5 "Forbidden narrative combinations", as the 13th row
                   (or 14th after Q-2's implied addition).

**The combination:**

| Forbidden combination | Why forbidden |
|---|---|
| `wallet_credited` AND `withdrawal_rejected` AND no recorded reversal event | Developer saw money. The withdrawal flow implicitly consumed it. Rejection occurred. No narrative of return exists. The developer's experience is: **"I had money yesterday. Today it vanished."** |

**Why this is among the most toxic contradictions a financial system can produce:**

1. It is **observable by the user directly** — they don't need to be
   told. They open the wallet and the number is wrong.

2. It is **uncorrectable by user action** — there is no "click here
   to recover" the user can take. The platform must produce the
   correction unilaterally.

3. It **violates the most basic financial intuition** —
   "money I saw became money I didn't see, with no event between".

4. It is **a compound failure**, not a simple one. Three states had
   to align (credited + rejected + no reversal) for the contradiction
   to manifest. Compound failures are exactly the ones substrate
   enforcement (PR-0) and bridge convergence (PR-1) are designed to
   prevent — but they can only prevent them if the contradiction is
   declared as forbidden in the first place.

**Why this row belongs in the constitution and not in the detector spec:**

It is not a detector definition. It is a **promise** that this
combination will never be observable. The detector classes that
enforce this promise are downstream artefacts. The promise comes first.

---

## On the meta-observation: "domain law above implementation"

The user's framing during sign-off is itself a Stage-7 artefact worth
preserving:

> **detectors, bridges, orchestrators, retries, admin tools, UI states
> become not "features", but enforcement mechanisms of declared truth.**

This inverts the standard mental model:

| Standard model | This system, after constitution |
|---|---|
| Feature → implementation → constraints check | Constitution → enforcement mechanism (which the feature is) |
| Detector lives downstream of decisions | Detector lives downstream of constitution |
| UX is "what we built" | UX is judged against declared truth |
| Migration goal: make code cleaner | Migration goal: make constitution honour-able |

The constitution as currently sealed (without Q-1, Q-2, Q-3) is already
sufficient to make this inversion operational. The queued additions
make the inversion **more complete in its edge cases**, not more
operational in its core.

This is the architectural leap the user named:

> "domain law above implementation"

It is now the operating posture, not an aspiration.

---

## Queue item Q-4 — Next major artefact (post-window): Narrative Coverage Audit

**Status:** declared, not started.
**Scope hint (not the artefact itself):**

The Narrative Coverage Audit is a documentation-only artefact that
maps:

- Every screen currently shown to a developer or client → which §1/§2
  state(s) it represents → which §6 guarantees it must honour →
  which §5 combinations it must make impossible to display.
- Every operator surface → which §3 row(s) it surfaces → which §7
  narrative mapping it uses → which silent-resolution risks exist.
- Every lifecycle transition currently observable to users → whether
  it appears in §4 → whether the transition's expected residence
  time is communicated.

The audit's output is a per-screen, per-flow scorecard:

| Surface | Constitution coverage | Violations found | Repair owner |

The audit does **not** propose UI changes, redesigns, or new
features. It produces the **violation inventory** that subsequent
isolated PRs each address.

**Why it must come after the PR-0 window:**

The Narrative Coverage Audit will inevitably surface discrepancies
between what UI currently shows and what the constitution requires.
If that audit runs during the observation window, every UI-induced
detector reading becomes attribution-ambiguous (was it bridge drift,
harness leak, or UI misrepresentation?). Running it after the window
closes preserves attribution clarity.

**Estimated shape:**

- ~600–900 lines of documentation
- ~3–4 sub-artefacts: developer-side violations, client-side violations,
  operator-side violations, lifecycle-transition gaps
- No code, no API change, no detector definition

**Estimated triggering events that the audit will identify (heuristic, not findings):**

- Screens that show "earnings" without distinguishing
  `available_balance` vs `pending_withdrawal` vs `earned_lifetime`.
- Screens that show "withdrawal in progress" without an expected
  decision window.
- Operator surfaces that surface detector class names directly
  ("M4: 1") rather than translated narrative ("1 release with
  missing audit trail").
- Module status transitions that auto-promote without UI
  acknowledgment.
- Email / notification copy that uses internal status names.

Each of these is testable against the constitution without writing
new code.

---

## Apply checklist for Q-1, Q-2, Q-3 (when window closes)

1. PR-0 observation window closed cleanly (no rollback triggers fired).
2. PR-1 implementation NOT yet begun.
3. Apply Q-1, Q-2, Q-3 as append-only `## §11`, `## §12`, `## §13`
   sections (or as labelled additions to existing §4/§5 with explicit
   "*Added 2026-05-XX in extension wave 1*" marker). Constitution
   prior content remains byte-identical.
4. New SHA-256 recorded; this queue file is closed and renamed
   `_APPLIED.md`.

## Apply checklist for Q-4 (Narrative Coverage Audit)

1. Q-1, Q-2, Q-3 applied (constitution is at extension-wave-1 state).
2. PR-1 implementation status is one of: not started OR shipped with
   observation window closed.
3. Audit begins as a documentation-only sub-stage of Stage 7. Same
   rules: no UI changes, no API changes, no detector changes during
   the audit.

End of queue.
