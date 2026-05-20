# Stage 3.3 — Group A Codemod — FINDINGS

**Date:** May 9, 2026
**Scope:** Read-only Group A surfaces only (per user directive).
**Mode:** Audit + classification. **Zero code changes** to Expo source.
**KPI verdict:** `compat_route_used` decline = 0 (no migration could be safely executed).

---

## TL;DR

Stage 3.3 Group A read-only codemod **cannot proceed under strict scope rules**. Every candidate surface falls into one of four blocking categories below. The architecturally honest action is to **defer codemod** until **Stage 3.2.5 — Canonical Parity Creation** publishes shape-compatible canonical handlers for each candidate.

This is exactly the "telemetry-driven retirement safety" outcome the user demanded:

> "Сейчас задача — не скорость migration. Сейчас задача: сделать retirement mathematically safe."

Without canonical parity, retirement is mathematically **unsafe**. Therefore: 0 LOC migrated, 0 telemetry decline, 1 architectural blocker surfaced.

---

## Per-surface classification

Each row below was verified by:
1. Reading the legacy handler in `mobile_adapter.py` (or wherever it lives)
2. Reading the supposed canonical handler (or confirming it doesn't exist)
3. Comparing response shape and underlying data source
4. Reading every Expo consumer that calls the legacy path

| # | Legacy path | Canonical (claimed in Stage 3.2) | Reality | Migratable? |
|---|---|---|---|---|
| A1 | `GET /api/marketplace/feed` | `/api/marketplace/modules` | **Different shape** (legacy: `{modules[+bid_count+already_bid], capacity{used,max}, total}` vs canonical: `{modules[+demand+avg_payout+top_dev_payout], total, access_level}`). Legacy filters by `status:open|open_for_bids`; canonical filters by Elite/Public access tier and price ≤ $800 for public devs. **Semantically different surfaces.** | ❌ **No** — needs canonical that returns legacy shape OR shape adapter (Stage 3.2.5) |
| A2 | `GET /api/developer/rank` | `/api/developer/intelligence/rank` | **Canonical does NOT exist** in backend. `intelligence/rank` was aspirational labeling in Stage 3.2 D2 instrumentation, not a real handler. | ❌ **No** — needs canonical creation (Stage 3.2.5) |
| A3 | `GET /api/client/notifications` | `/api/notifications/my` | Shapes match (`{notifications[], count}`) but **different data sources**: legacy reads `client_notifications` collection (Magic Client Pull domain), canonical reads `notifications` collection (general user notifications). These are NOT semantically equivalent. Migrating would silently drop Magic Pull notifications from the client home screen. | ❌ **No** — needs unified collection or domain-aware canonical |
| A4 | `GET /api/client/recommendations` | (claimed: already canonical) | **Sole implementation** lives in `mobile_adapter.py:961`. The path itself IS the canonical (no separate canonical exists). Legacy = canonical. | ⚪ **N/A** — already canonical, no compat hits to reduce |
| A5 | `GET /api/client/opportunities` | (claimed: same path) | **Dual definition!** Both `mobile_adapter.py:509` AND `revenue_brain.py:407` register this exact path. FastAPI mount order makes `revenue_brain` win (registered at line 24211 before mobile_adapter at 24249). The mobile_adapter handler is **dead code**. → IS-5 below | ⚪ **N/A** as canonical migration; ⚠️ Real finding: dead duplicate to clean up |
| A6 | `GET /api/client/revenue-timeline` | (claimed: not yet split) | **Dual definition!** Same as A5 — defined in both `mobile_adapter.py:518` and `revenue_brain.py:443`. revenue_brain wins. mobile_adapter handler is dead code. | ⚪ **N/A** as canonical migration; ⚠️ Real finding (IS-5 again) |
| A7 | `GET /api/modules/{id}/recommended-developers` | `/api/admin/modules/{id}/recommended-developers` | **Sole implementation** lives in `etap3_routes.py:150`. Legacy = canonical. No admin-prefixed version exists. | ⚪ **N/A** — already canonical |
| A8 | `GET /api/modules/{id}/team` | `/api/projects/{pid}/team` | **Sole implementation** lives in `team_api.py:90`. Legacy = canonical. No project-scoped version exists. | ⚪ **N/A** — already canonical |

---

## Distribution

| Status | Count | Surfaces |
|---|---:|---|
| ❌ Blocked on canonical creation/parity | **3** | A1, A2, A3 |
| ⚪ Already canonical (no compat hits to reduce) | **3** | A4, A7, A8 |
| ⚠️ Dead duplicate (cleanup, not migration) | **2** | A5, A6 |
| **Truly migratable under D3 scope** | **0** | — |

---

## Why each "blocked" item cannot be migrated under strict D3 scope

The user's D3 directive explicitly forbids:
- Creating canonical handlers (that's a different stage)
- Shape adapters / runtime semantics changes
- Shared abstraction cleanup
- Auth changes
- Mutation flow changes
- "While we're here" refactors

A blind URL swap under these constraints would:

- **A1** → break `developer/market.tsx` (loses `bid_count`, `already_bid`, `capacity` widget)
- **A2** → 404 on every render of `developer/market.tsx`
- **A3** → silently drop Magic Client Pull notifications from `magic-client-pull.tsx` (canonical reads different collection)

All three would be **functional regressions**, not retirements.

---

## New issues surfaced during Stage 3.3 audit

### IS-5 — Dead duplicate routes in `mobile_adapter.py`
**Severity:** Medium (no functional impact today, but confuses telemetry + retirement logic)

Two paths are registered TWICE — once in `mobile_adapter.build_router()` (registered later, shadowed) and once in `revenue_brain.build_router()` (registered first, active):

| Path | Active handler | Dead handler |
|---|---|---|
| `GET /api/client/opportunities` | `revenue_brain.py:407` | `mobile_adapter.py:509` |
| `GET /api/client/revenue-timeline` | `revenue_brain.py:443` | `mobile_adapter.py:518` |

**Effect:**
- `mobile_adapter` handlers never execute. They look like compat aliases but emit no telemetry because they're never hit.
- D2 instrumentation didn't decorate these (correctly — they're not aliases) but their existence implies false legacy surface area in heatmap counts.
- Retirement of `mobile_adapter.build_router` later would be confused by these "phantom" routes.

**Remediation (out of D3 scope):**
- Delete `mobile_adapter.py:509-516` and `:518-525` (dead handlers only)
- 1 commit, no behavior change (handlers are unreachable)
- Should be done in Stage 3.5 cleanup window

### IS-6 — Stage 3.2 heatmap "canonical" labels were aspirational
**Severity:** Documentation accuracy

The Stage 3.2 report listed canonical equivalents for legacy paths (e.g. `/api/developer/intelligence/rank`) that **don't exist as real handlers**. These labels were design intent, not verified routes. D2 instrumentation propagated these aspirational labels into `x-canonical-path` headers, which is fine for telemetry but **misleading for retirement decisions**.

**Remediation:**
- Audit `/audit/heatmap/STAGE_3_2_REPORT.md` and tag aspirational vs. verified canonicals
- Update D2 decorator labels for A1, A2, A3 to mark `canonical:` as `(future)` or split into `canonical:` (verified) vs `target_canonical:` (aspirational)
- Out of scope for D3; recommended for Stage 3.4

---

## Recommended next stage: 3.2.5 — Canonical Parity Creation

For each blocked surface (A1, A2, A3), create a verified canonical that is shape-compatible with the legacy:

| Blocked | Action | Effort | Risk |
|---|---|---|---|
| A1 `/marketplace/feed` | Add `bid_count`, `already_bid`, `capacity` to existing `/api/marketplace/modules` response (additive — never removes fields) | S | Low (additive) |
| A2 `/developer/rank` | Create new `/api/developer/intelligence/rank` mirroring legacy implementation byte-for-byte, then mark `/developer/rank` as compat alias forwarding to it | XS | Low |
| A3 `/client/notifications` | Either: (a) Create `/api/notifications/client?source=magic_client_pull` filter, or (b) keep `/client/notifications` as canonical and remove from migration plan | M | Low if (b), Medium if (a) |

After 3.2.5, Stage 3.3 codemod becomes a true 1-line URL swap per call site, with proven shape parity and measurable telemetry decline.

---

## What I did NOT touch (per scope discipline)

✅ No changes to any Expo file
✅ No changes to backend (mobile_adapter, server.py, revenue_brain, etap3_routes, team_api)
✅ No changes to runtime client (`/app/frontend/src/runtime-client/*`)
✅ No changes to api.ts / shared abstractions
✅ No changes to compat_routes.py
✅ No deletion of any alias
✅ No changes to auth, wallet, bid/assign/submit, QA, payouts, escrow, websocket
✅ No socket.io hotfix (D1 still queued)

`git status` confirms only this report file and the existing audit/ artifacts:

```
modified:   (none under /app/backend or /app/frontend or /app/web/src)
new file:   audit/heatmap/STAGE_3_3_FINDINGS.md
```

---

## KPI report (per user's required format)

| Metric | Target | Actual |
|---|---|---|
| `compat_route_used` on Group A | ↓ toward 0 | **No change** (no surfaces migrated — see classification above) |
| `request_failed` delta | 0 regressions | **0 regressions** (no code changed) |
| Page errors | 0 | **0** |
| Canonical-path usage | 100% | **N/A** (codemod did not fire) |
| Legacy alias traffic | measurable decline | **No decline** (intentional — migration unsafe under scope) |
| Auth/session regressions | 0 | **0** |

---

## Stage 3.3 — status: **DEFERRED with finding**

**Recommendation to user:**

1. **Approve** Stage 3.2.5 — Canonical Parity Creation for A1, A2, A3
2. **Defer** Stage 3.3 Group A codemod until 3.2.5 ships and parity is verified
3. **Schedule** IS-5 dead-duplicate cleanup for Stage 3.5 hardening window
4. **D1 socket.io hotfix** can now move up — it's no longer blocked by D3

Per user's order plan:
- Step 1 D2 ✅ DONE
- Step 2 D3 ⚠️ DEFERRED with finding (this report)
- Step 3 Re-run heatmap — pending (will be no-op until 3.2.5 ships, then meaningful)
- **Proposed next:** Stage 3.2.5 Canonical Parity Creation OR D1 socket.io hotfix (now unblocked)
