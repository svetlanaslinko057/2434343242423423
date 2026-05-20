# Product Scope Freeze — Amendment 1 (May 19, 2026)

> Origin document: `docs/product-scope-freeze.md` (May 9, 2026).
> This file records a single decision change. It does NOT replace the freeze;
> all OTHER decisions in the original document remain in force.

## Context

The original product-scope-freeze (Decision 1) declared:

> Expo admin = operational cockpit, NOT full admin surface.
> Mobile admin MUST NOT receive parity flows for: project kanban,
> team rebalance, users mgmt, contracts overview, scope templates,
> integration key rotation, marketplace quality, master dashboard.

Two months of operations on the cockpit surfaced a real gap: admins on the
go (off-desk hours, weekend incidents) DID need read-level access to several
of those surfaces to triage. The fix is NOT to make Expo admin a full
replacement for web admin (that remains true) — the fix is to allow
**read-mostly drill-down screens** to ship on Expo, reachable from the
admin home's Operations grid.

## Amended Decision 1

Expo admin is still **cockpit-first** in its tab bar (5 tabs: Home, QA,
Validation, Finance, Profile). Additionally, the admin can now reach 8
**read-mostly** drill-down surfaces from the **Operations grid** rendered
below the alerts and quick-actions block on `/admin/home`:

| Surface | Route | Endpoint(s) | Write actions |
|---|---|---|---|
| Users | `/admin/users` | `GET /api/admin/users` | None (placeholder) |
| Team | `/admin/team` | `GET /api/admin/team/capacity` + `bottlenecks` | None |
| Contracts | `/admin/contracts` | `GET /api/admin/contracts` | None (links to existing `/admin/projects/[id]`) |
| Templates | `/admin/templates` | `GET /api/admin/scope-templates`, `/admin/decomposition/templates` | None |
| Integrations | `/admin/integrations` | `GET /api/integrations/manifest` | None — **key rotation stays on web** (mobile is too small) |
| Inbox | `/admin/inbox` | `GET /api/admin/messages/inbox` | None (placeholder) |
| Marketplace | `/admin/marketplace` | `GET /api/marketplace/modules?admin=1` | None |
| Master dashboard | `/admin/master` | `GET /api/admin/master/pipeline` | None |

### Architectural rules (locked in for the expansion)

1. **No new business logic on Expo.** Every endpoint above already existed
   on the backend prior to this expansion. The Expo screens are
   thin presentation layers over those endpoints. No backend changes were
   made or are permitted under this amendment.

2. **Single source of truth for admin UI primitives.** All 8 screens use:
   - `src/admin/ui.tsx` — `AdminHeader`, `AdminListScreen`, `AdminRow`,
     `AdminSection`, `AdminActionSheet`.
   - `src/admin/useAdminResource.ts` — single hook for load + refresh +
     error surfacing.

   Adding a 9th screen MUST go through these primitives. PRs that ship a
   bespoke loading/list component for an admin surface will be rejected.

3. **Operations grid is the single discovery path.** Drill-down screens
   are NOT in the tab bar (it would dilute cockpit signal). They are
   `href: null` in `admin/_layout.tsx` and reachable only via:
   - The Operations grid on `/admin/home`.
   - Direct routing (alerts, push notifications) — when a deep-link
     surfaces a specific record.

4. **Write actions stay on web.** Drilling, filtering and signal review
   ship on Expo. Mutations (suspend user, rotate key, edit contract,
   publish template) keep their canonical home on the web admin. If a
   write action ever ships on Expo, it MUST:
   - Live behind a confirmation sheet (`AdminActionSheet`).
   - Mirror an existing web action — no Expo-only mutations.

5. **Runtime-client transport.** All 8 screens consume `src/api` (the
   May 2026 shim) which is now backed by `runtime`. The screens themselves
   never import `runtime-client` directly — see the migration discipline
   in `audit/RUNTIME_CLIENT_MIGRATION.md`.

## What is still OUT of scope on Expo admin (unchanged)

- Project kanban drag-and-drop (too dense for a phone).
- Bulk user / payout / scope template edits.
- Integration key rotation.
- Web Master Dashboard analytics charts (Expo gets the funnel counts only).
- Decomposition template authoring.
- Workflow rule editing.

If those needs surface during this Operations grid's observation window,
a new amendment must be filed.

## Observation window

This amendment is **on probation for 30 days** (May 19 → Jun 18, 2026).
We track:
- 401/403 rate on the 10 endpoints (should stay ≤ baseline web rate).
- Admin home → Operations grid → screen funnel (we expect ≥ 20% of admin
  sessions to drill at least once after week 1).
- Crash rate on `/admin/*` routes (must stay 0 — these are read-only).

If any signal regresses, the Operations grid will be hidden by feature
flag and this amendment reverted.

---

Signed off in repo: amendment file is the change-log. No separate ticket.
