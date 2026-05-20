# Product Scope Freeze — May 9, 2026

**Status:** ✅ FROZEN. All future work conforms to these decisions unless this document is explicitly amended.

This is a **governance** decision, not a "TODO". Three role-surface questions were
open after the architecture audit (`/app/audit/ARCHITECTURE_AUDIT_2026-05-09.md`).
They are now closed.

---

## Decision 1 — Expo Admin = operational cockpit, NOT full admin surface

### What this means
- Expo `/admin/*` covers ONLY: alerts, QA approve/revision/reject, withdrawal
  approve/reject, payout-batch approve, admin profile, mobile visibility config.
- Web `/admin/*` is the **canonical admin surface** — full Workflow / Team /
  System / Templates / Integrations / Inbox / WarRoom / MarketplaceQuality.
- Mobile admin **must NOT** receive parity flows for: project kanban, team
  rebalance, system users management, contracts overview, scope templates,
  integration key rotation, deep WarRoom drill-downs.

### Why
- Polluted on-the-go UX if you stuff full admin into a phone.
- Maintenance explosion (every web admin feature → 2x cost).
- Real admin work needs keyboard, multi-pane, copy-paste — not thumb-driven.

### Rule
> Adding a new mobile admin screen requires a documented **operational
> justification** (incident response, time-sensitive approval, mobile-first
> alert) — not just feature parity wishful thinking.

### Status
✅ **FROZEN** — current 5 cockpit screens are the canonical Expo admin
surface. Future expansion is policy-gated, not feature-driven.

---

## Decision 2 — Expo Tester = build mobile tester (Stage 4)

### What this means
- Tester role gets a dedicated mobile surface (rationale: tester flows are
  lightweight, checklist-oriented, notification-driven → genuinely mobile-fit).
- Backend is already complete (`/api/tester/*` × 5 + `/api/validation/*` × 8).
- Build scope is bounded to **4 screens** (Stage 4):
  1. Tester Home — assigned validations + queue snapshot
  2. Validation list — paginated, filter by status
  3. Validation detail — pass / fail / issue actions per work-unit
  4. History / performance — past validations + accuracy metrics

### Out of scope for Stage 4
- ❌ Validation authoring (admin-only, web)
- ❌ Tester admin / oversight (web)
- ❌ Bulk operations (web)

### Status
✅ **PLANNED for Stage 4** (after runtime-client migration completes in
Stage 3). Not started now — discipline holds.

---

## Decision 3 — Lead = conversion surface, NOT a separate role

### What this means
- `/lead/workspace.tsx` is a **pre-auth conversion screen** that shows a
  guest "the system is already building your product" to incentivize sign-in.
  This is its only purpose.
- There is **no separate "lead" role** in the auth system. Lead = unauthenticated
  visitor with a captured idea/estimate.
- Operational workflows that might look "lead-shaped" express through:
  - **client** role (post-conversion: project owner)
  - **developer** role (work surface)
  - **admin** role (oversight)

### Rule
> A new "lead-cabinet" or "lead role with permissions" requires explicit
> business justification AND demonstration that the workflow CANNOT be
> expressed through client/developer/admin. Default = NO.

### Status
✅ **FROZEN** — lead remains conversion-only. No auth changes, no permission
layer additions.

---

## What this freeze enables

1. **Runtime-client migration can finish** without parallel scope creep.
2. **Compat-route heatmap** stays signal-rich (no synthetic noise from new
   screens being added during observation window).
3. **Auth migration pilot** (Stage 3.4) doesn't have to handle a new role.
4. **Production hardening** (Stage 5) has a definite end-state to harden against.

## What this freeze blocks

- ❌ "While we're here let's add admin Workflow on mobile"
- ❌ "Lead role with own dashboard"
- ❌ "Mobile admin should mirror web admin"
- ❌ "Tester web-only, skip mobile"

If a future business need argues against any of these — amend this document
explicitly with rationale. Do not silently violate.

---

## Amendment procedure

1. Open a PR that modifies THIS document with the proposed scope change.
2. Document:
   - What operational reality changed since 2026-05-09
   - Why the workflow can't be expressed in the current surface
   - Cost estimate (screens / endpoints / auth changes)
3. Get explicit sign-off from the owner.
4. Only THEN add corresponding screens / roles / endpoints.

This is the same procedure that frozen runtime contracts use
(`/app/docs/runtime-contracts/README.md`).
