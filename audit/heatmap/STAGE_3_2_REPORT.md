# Stage 3.2 — Compat Heatmap (read-only)

**Date:** 2026-05-09
**Runner:** `/app/tools/stage_3_2_heatmap.py` + static analysis pass
**Artefacts:** `/app/audit/heatmap/{raw_per_page,heatmap,summary}.json` + `heatmap.csv`
**Scope:** observation only — NO code touched, NO migrations, NO `lib/api.js`/`api.ts` retirement.

---

## Method (two-phase)

### Phase A — runtime walk
Drive 51 non-pilot surfaces (26 web pages + 25 Expo screens) under real auth
sessions, capture every `/api/*` response, count surfaces where
`x-compat-route: true` came back.

### Phase B — static analysis (added because Phase A surfaced a blind spot)
Grep the source tree for direct API calls (`axios.*`, `api.*`, `runtime.*`)
to known compat-aliased paths. Cross-reference with backend compat surface
inventory.

This dual approach exists because Stage 3.2 discovered an
**observability gap** in the compat layer (see IS-2 below).

---

## Surfaces scanned

**Web (26 non-pilot pages):** AdminDashboard, AdminIntegrations, AdminContracts,
AdminTemplates, AdminBilling, AdminSystemUsers, AdminInbox, AdminTeamPanel,
AdminOperatorPanel, AdminV2Dashboard, AdminV2Workflow, AdminV2Team,
AdminV2System, AdminV2Profile, ClientDashboard, ClientWorkspace,
ClientOperator, ClientLeaderboardPage, ClientVersionsPage, DeveloperDashboard,
DeveloperAssignments, DeveloperTimeControl, DeveloperLeaderboard,
DeveloperIntelLeaderboard, DeveloperIntelFeedback, DeveloperIntelGrowth.

**Expo (25 non-pilot screens):** ClientHome, ClientBilling, ClientActivity,
ClientAccount, ClientProfile, ClientSupport, ClientReferrals, ClientControl,
DeveloperHomeMobile, DeveloperMarket, DeveloperWork, DeveloperEarningsMobile,
DeveloperTimeLogs, DeveloperProfileMobile, AdminHomeMobile, AdminQAMobile,
AdminFinanceMobile, AdminProfileMobile, Inbox, Operator, Documents, Hub,
ProfileGlobal, Settings, ActivityGlobal.

**Pilots #1-#4 deliberately excluded** — they are the migrated baseline,
not subjects of compat heatmap.

---

## Compat hits total (Phase A — runtime walk)

| Counter | Value |
|---|---:|
| Surfaces navigated OK | **51 / 51** |
| Total `/api/*` calls captured | **404** |
| `x-compat-route: true` headers seen | **0** |
| Unique legacy-route hits (Phase A only) | **0** |
| HTTP failures | 0 |
| Page errors | 0 |

**Phase A says: zero observable compat hits across all 51 non-pilot surfaces.**

This is a stronger result than expected. It means **most of the codebase has
already been migrated to canonical paths in the URL layer** — even on screens
that have NOT been migrated to runtime-client. The compat decorator
(`compat_routes.py`) layer exists as a safety net for old bookmarks /
external integrations / browser-cached navigation, but no active UI code
hits the decorated aliases at page load.

---

## Compat hits total (Phase B — static analysis)

Phase B was added when it became clear that **a second compat surface
(`mobile_adapter.build_legacy_aliases()`) is NOT instrumented** with the
`compat_decorator`. So Phase A could not see hits there. Static grep of
`api.get/post/put/delete` calls in `frontend/` against the un-instrumented
alias list gave:

| Legacy path (alias) | Used by (Expo file) | Canonical equivalent | Severity |
|---|---|---|---|
| `GET /marketplace/feed` | `developer/market.tsx`, `src/dev-opportunities-pressure.tsx` | `/api/marketplace/modules` | **HOT** |
| `GET /developer/rank` | `developer/market.tsx` | (canonical: `/api/developer/intelligence/rank`) | **HOT** |
| `POST /modules/{id}/bid` | `developer/market.tsx` | `/api/marketplace/modules/{id}/bid` | **HOT** |
| `POST /modules/{id}/submit` | `developer/work.tsx` | `/api/work-units/{id}/submit` | **HOT** |
| `POST /modules/{id}/assign` | `src/magic-client-pull.tsx` | `/api/admin/modules/{id}/assign` | **HOT** |
| `POST /marketplace/modules/{id}/accept` | `developer/market.tsx` | (canonical alias of itself or `/api/marketplace/modules/{id}/bid` accept variant) | **HOT** |
| `GET /modules/{id}/recommended-developers` | `src/recommended-developers.tsx` | `/api/admin/modules/{id}/recommended-developers` | warm |
| `POST /modules/{id}/invite-developers` | `src/recommended-developers.tsx` | `/api/admin/modules/{id}/invite-developers` | warm |
| `POST /modules/{id}/reopen-bidding` | `src/stuck-module-actions.tsx` | `/api/admin/modules/{id}/reopen-bidding` | warm |
| `GET /modules/{id}/team` | `src/module-team.tsx` | `/api/projects/{pid}/team` | warm |
| `GET /client/notifications` | `src/magic-client-pull.tsx` | `/api/notifications/my` | **HOT** |
| `GET /client/recommendations` | `src/magic-client-pull.tsx` | `/api/client/recommendations` (already canonical?) | warm_agg |
| `GET /client/opportunities` | `src/client-opportunity-feed.tsx` | `/api/client/opportunities` | **HOT** |
| `POST /client/opportunities/{id}/accept` | `src/client-opportunity-feed.tsx` | (no canonical published yet) | warm_agg |
| `POST /client/opportunities/{id}/dismiss` | `src/client-opportunity-feed.tsx` | (no canonical published yet) | warm_agg |
| `GET /client/revenue-timeline` | `src/revenue-timeline.tsx` | (canonical: not yet split) | warm_agg |

**Static-analysis compat-call sites: 16** (all in Expo, all in `frontend/src/`
helpers + `frontend/app/developer/market.tsx`).

**Web compat API calls: 0.** Web uses canonical URLs throughout.

---

## Top legacy routes (combined HOT list, ranked)

1. `GET /marketplace/feed` — Expo developer market screen, used on every refresh. Hit at every developer login. **Highest priority.**
2. `GET /developer/rank` — same screen, parallel call to `/marketplace/feed`. Pair migration with #1.
3. `POST /modules/{id}/bid` — bidding flow, money-adjacent (changes module state).
4. `POST /modules/{id}/submit` — work submission, ledger-adjacent (triggers QA → earnings).
5. `POST /modules/{id}/assign` — admin auto-assign, money-adjacent.
6. `POST /marketplace/modules/{id}/accept` — direct module acceptance, ledger-adjacent.
7. `GET /client/notifications` — used by magic-client-pull triple poll.
8. `GET /client/opportunities` — used by client-opportunity-feed.

---

## Dead aliases

Compat aliases in `compat_routes.py` decorated with `@compat_decorator(canonical=...)`
that received **0 hits** in Phase A AND have **0 references** in the source tree:

| Legacy | Canonical | Status |
|---|---|---|
| `GET /admin/finance` | `/api/admin/mobile/finance` | dead — only `<Link to=>` SPA route refs |
| `GET /admin/integrations` | `/api/admin/settings/integrations` | dead — same |
| `GET /admin/integrations/capabilities` | `/api/integrations/capabilities` | dead |
| `GET /admin/billing/overview` | `/api/admin/money/overview` | dead |
| `GET /admin/payments` | `/api/admin/payments/transactions` | dead |
| `GET /admin/control` | `/api/admin/control-center/overview` | dead |
| `GET /admin/llm` | `/api/admin/settings/llm` | dead |
| `GET /admin/mobile` | `/api/admin/mobile/home` | dead |
| `GET /admin/operator` | `/api/operator/feed` | dead |
| `GET /admin/leads` | `aggregator:db.leads` | dead (aggregator) |
| `GET /admin/system` | `aggregator:system_config+alerts+users` | dead (aggregator) |
| `GET /admin/system/snapshot` | `aggregator:system_config+alerts+users` | dead (aggregator) |
| `GET /billing/overview` | `/api/client/billing/summary` | dead |
| `GET /notifications/unread` | `/api/notifications/my?unread=true` | dead — `NotificationBell.js` calls `/notifications/unread-count` (a DIFFERENT canonical path, not aliased) |
| `GET /activity` | `/api/activity/workspace/all` | dead — Expo `/activity` matches are SPA route refs only |
| `GET /developer/earnings` | `/api/developer/earnings/summary` | dead — `DeveloperEarnings.js` (Pilot #3, migrated) calls canonical |
| `GET /developer/leaderboard` | `/api/developer/intelligence/leaderboard` | dead — refs are SPA `<Link to=>` only |
| `GET /marketplace` | `/api/marketplace/modules` | dead — refs are `<Link to=>` only |
| `GET /marketplace/opportunities` | `/api/marketplace/modules` | dead |
| `GET /me/wallet` | `/api/developer/wallet` | dead |
| `GET /dev_work` | `/api/dev/work` | dead |

**21 of 22 decorated compat aliases are DEAD.** The only compat decorator that
might be in occasional use is `compat_routes.py`'s decoration as an external
safety net — but no internal UI code hits any of them.

---

## Must-keep aliases

Two categories survive any retirement:

### MK-1 — `/api/auth/login` and friends (mobile_adapter.py:133+)
`POST /api/auth/login`, `/api/auth/register`, `/api/auth/demo`,
`/api/auth/google`, `/api/auth/me`, `/api/auth/logout`, `/api/auth/switch-role`.

These are **not** legacy aliases — they are the canonical mobile auth surface
(parallel to `/api/mobile/auth/login`). Both names must keep working because
already-shipped Expo bundles call them. Retiring would brick installed apps.

### MK-2 — Module/marketplace aliases used by current Expo build
The 16 routes listed in Phase B above. Until Expo screens are migrated and
republished, these aliases must keep working. Retirement is **gated by Stage
3.3 codemod completion** for the affected screens.

### MK-3 — `compat_routes.py` decorated aliases (the 21 "dead" rows above)
Even though no current UI code hits them, **do not retire blindly**:
- External integrations / partner webhooks may use them.
- User-bookmarked URLs may hit them.
- The decorator emits structured logs precisely so you can prove zero hits
  over an extended window before retiring.

**Recommended:** start a **30-day observation log** (grep
`type:compat_route_used` from backend.out.log). Only after 30 days of zero
hits should any compat_routes.py alias be removed.

---

## Recommended migration order

Codemod for Stage 3.3 should follow this sequence — strictly read-only,
GET-only first, then writes:

### Group A — read-only marketplace (lowest risk, highest hit count)
1. `GET /marketplace/feed` → `runtime.get('/api/marketplace/modules', { developer_filter: true })`
2. `GET /developer/rank` → `runtime.get('/api/developer/intelligence/rank')`
3. `GET /client/notifications` → `runtime.get('/api/notifications/my')`
4. `GET /client/recommendations` → `runtime.get('/api/client/recommendations')` (verify canonical)
5. `GET /client/opportunities` → `runtime.get('/api/client/opportunities')`
6. `GET /client/revenue-timeline` → confirm canonical path exists; otherwise keep alias as MK-2

### Group B — read-only module helpers
7. `GET /modules/{id}/recommended-developers` → admin canonical
8. `GET /modules/{id}/team`

### Group C — ledger-adjacent writes (idempotency-key required, capability-tagged)
9. `POST /modules/{id}/bid` → `runtime.post(canonical, body, { idempotencyKey })`
10. `POST /modules/{id}/submit` → same
11. `POST /modules/{id}/assign` → admin write, capability=`payment` (if it triggers earnings)
12. `POST /marketplace/modules/{id}/accept` → ledger-adjacent
13. `POST /modules/{id}/invite-developers`
14. `POST /modules/{id}/reopen-bidding`
15. `POST /client/opportunities/{id}/accept`
16. `POST /client/opportunities/{id}/dismiss`

### Group D — auth (DO NOT include in Stage 3.3)
Auth migration is a SEPARATE pilot per stage plan. Excluded from codemod.

### Group E — `compat_routes.py` retirement (Stage 3.5+)
After Groups A–C land AND 30-day observation window passes AND zero
`compat_route_used` log lines, retire the 21 decorated aliases.

---

## Socket.IO mismatch (IS-1) status

Per Stage 3.1 finding. **NOT touched in Stage 3.2** as instructed.

Summary unchanged:
- File: `/app/web/src/lib/socket.js:29`
- Issue: `io(API_URL.replace('/api', ''))` connects to bare host, missing `/api/` prefix on socket.io path
- Live verification: `/socket.io/` → 404, `/api/socket.io/` → 200
- Impact: web realtime bridges silently degrade
- Decision pending: hotfix now vs. Stage 3.5 production hardening

---

## Other findings

### IS-2 — Compat observability blind spot (NEW, found in Stage 3.2)

`mobile_adapter.py:build_legacy_aliases()` mounts 19 routes with
`tags=["mobile-compat-aliases"]` but **does NOT wrap them with
`compat_decorator`**. Effect:
- Responses do **not** carry `x-compat-route: true` / `x-canonical-path`.
- No `compat_route_used` log lines emitted.
- Phase A heatmap walk could not observe these hits — only static analysis
  could find them.

**Pre-existing infrastructure issue, not a Stage 3.2 regression.**

**Recommendation (NOT executed in Stage 3.2):** wrap each of the 19 aliases
in `mobile_adapter.build_legacy_aliases()` with `@compat_decorator(canonical=...)`.
Effort: small (15–25 lines, mostly mechanical). Outcome: Phase A becomes
authoritative — no static analysis fallback needed for future heatmaps.
Either Tier-3 hotfix or Stage 3.3 prep step. **Do not retire any compat
alias until this is fixed and a fresh observation window passes.**

### IS-3 — Two independent compat surfaces with different observability
- `compat_routes.py` (22 aliases) — decorated, observable, structured-logged
- `mobile_adapter.build_legacy_aliases()` (19 aliases) — undecorated, opaque

This split made sense historically (mobile_adapter was the "mobile-compat"
v1, compat_routes is v2 for web migrations). But the asymmetric observability
makes retirement decisions risky on the v1 side. Same fix as IS-2.

---

## Artifacts

```
/app/audit/heatmap/
├── raw_per_page.json     full per-surface capture (51 entries)
├── heatmap.json          aggregated by (legacy, canonical) — runtime-walk only
├── heatmap.csv           same, spreadsheet form
└── summary.json          totals + by_severity + top10
```

Static analysis evidence is embedded in this report (no separate file —
tied to grep commands in `tools/stage_3_2_heatmap.py` comments).

---

## No-code-change confirmation

- ✓ No file in `/app/backend/` modified.
- ✓ No file in `/app/web/src/` modified.
- ✓ No file in `/app/frontend/{app,src}/` modified.
- ✓ Only files added: `/app/tools/stage_3_2_heatmap.py`, this report.
- ✓ No supervisor restart triggered.
- ✓ No app config touched.

`git status -uall /app/backend /app/web /app/frontend` shows zero diffs.

---

## Decision needed (carry-forward)

Three queued decisions, **none executed**:

| # | Decision | Effort | Risk if delayed |
|---|---|---|---|
| D1 | Hotfix `lib/socket.js` path now (IS-1) vs. defer to Stage 3.5 | XS (1 line) | Low — silent degrade, not a contract break |
| D2 | Instrument `mobile_adapter.build_legacy_aliases` with `@compat_decorator` (IS-2/IS-3) before Stage 3.3 | S (15–25 lines) | High if delayed past Stage 3.3 — codemod can't verify "no hits" without observability |
| D3 | Open Stage 3.3 codemod for **Group A read-only** marketplace/notifications? | M | None — observation can continue |

**My recommendation:** D2 is the only true blocker for Stage 3.3. D1 is independent
hotfix, can park. D3 awaits your call after this report.
