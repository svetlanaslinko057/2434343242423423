# Runtime-Client Migration Matrix

**Started:** 2026-05-13
**Doctrine:** transport-swap only. No semantic rewrites. Preserve local
`loading/error/data` state even if duplicative — observability substrate
depends on it. See chat doctrine note 2026-05-13 for full rules.

## Codemod scope (allowed)

✅ Replace `axios.{get,post,put,patch,delete}` → `runtime.{get,post,...}`
✅ Replace explicit `${API}/foo` URL composition → relative `/api/foo`
✅ Drop `withCredentials: true` (runtime-client web adapter sets it globally)
✅ Replace `catch (e)` raw handling with `if (e instanceof ApiError)` discrimination
✅ Tag money-MOVING actions with `capability: 'payment'`
✅ Add `idempotencyKey` to non-idempotent action POSTs (payouts, marks-paid)
✅ Forward `signal` from local `AbortController` if already present

## Out of scope (NOT this codemod)

❌ Replacing `useState/useEffect` with new hooks (`useRuntimeQuery`, etc.)
❌ Dedup, cache, suspense, optimistic logic
❌ Refactoring `loading/error/data` triplets
❌ View-model normalization, render-tree changes
❌ Removing `console.error(...)` calls in catch blocks (telemetry surface)

## Check-list per file

For each migrated file, verify:

1. **Auth propagation** — admin endpoints still authorized (cookie carried over).
2. **Retry duplication** — UI doesn't loop on its own when runtime already retries.
3. **Silent catch regression** — runtime throws where axios may have silently
   returned `{ data: undefined }`. All `catch` branches still set error state
   or fallback as before.
4. **Request cancellation** — if file uses tab switches, ensure AbortController
   (if any) is forwarded through `signal`.

## Mobile-only probes (added at Batch 2)

5. **Stale-token recovery** — expired AsyncStorage token must trigger
   `onAuthExpired` → clear token + navigate to /auth. No infinite retry,
   no silent fail, no lost navigation state.
6. **Concurrent refresh / dedup** — screen mount + pull-to-refresh + interval
   poll + `useFocusEffect` may all fire `load()` simultaneously. Runtime dedup
   middleware must coalesce. Manual refresh must NOT inherit runtime's
   automatic retry budget (otherwise pull-to-refresh becomes a retry storm).
7. **Offline degradation semantics** — runtime is stricter than axios: where
   axios returned `{ data: undefined }` on network failure, runtime throws
   `ApiError(code='network_offline')`. All migrated mobile screens must
   handle this branch (already covered by existing `catch` blocks via
   `e instanceof ApiError`).

## Batch 1 — Web Admin Finance / Money  ✅ FROZEN

### Batch 1 regression notes

- **Capability gating**: only ONE real money-dispatch boundary in this batch —
  `AdminEarningsControl.handleApproveBatch` (POST `/api/admin/payout/batches/:id/approve`).
  Got `capability: 'payment'`. Everything else (mark-paid, batch creation,
  resend, withdrawal approve/reject) is post-money or pre-money so stays soft.
- **Idempotency keys**: added on every non-idempotent POST. Keys are
  deterministic per resource ID so duplicate clicks within ~10s are deduped
  by backend's idempotency middleware.
- **withCredentials**: dropped everywhere — runtime web adapter sets it once globally.
- **Silent catch regression**: NONE. All `catch` branches still call `setError` /
  `setToast({ kind: 'error' })` / `setMsg({ type: 'err' })` / `alert()` exactly
  as before, just sourcing the message from `e instanceof ApiError ? e.hint ||
  e.message : '<legacy fallback>'` instead of `e?.response?.data?.detail`.
- **Loading/error/busy state**: PRESERVED unchanged (intentional duplication
  per doctrine 2026-05-13).
- **Console.error**: kept (Financials, Earnings) — telemetry surface.
- **Pre-existing bug surfaced by batch**: `/app/web/` had no `.env`, so
  `REACT_APP_BACKEND_URL` was undefined at build time → legacy `${API}` became
  `"undefined/api"`. Runtime-client uses relative `/api/...` paths so it was
  immune. Created `/app/web/.env` to restore parity. This is the FIRST
  observability win of the codemod: transport heterogeneity was masking
  a substrate-wide degradation.

## Out of scope (NOT this codemod)
… [unchanged] …

## Pilot reference (already frozen)

| Surface | File |
|---------|------|
| Admin V2 Finance       | `web/src/pages/AdminV2Finance.js`     |
| Client Billing OS      | `web/src/pages/ClientBillingOS.js`    |
| Developer Earnings     | `web/src/pages/DeveloperEarnings.js`  |
| Pay With Gate (helper) | `web/src/lib/payWithGate.js`          |
| App (auth bootstrap)   | `web/src/App.js`                      |
| Expo Wallet (Pilot #4) | `frontend/app/developer/wallet.tsx`   |

## Batch 2 — Expo Client Cabinet  ✅ FROZEN

| Surface | File | Legacy transport | Runtime-client | Error shape | Idempotency | Smoke | Frozen |
|---------|------|------------------|----------------|-------------|-------------|-------|--------|
| Client Pricing Plans   | `frontend/app/client/billing/plans.tsx`     | `api` from `src/api` | ✅ | ApiError | `subscribe:<slug>` | ✅ all 3 tiers rendered | 🔒 |
| Client Projects List   | `frontend/app/client/projects/index.tsx`    | `api` + per-project workspace fan-out | ✅ | ApiError | n/a (read-only) | ✅ empty state rendered + pull-to-refresh works | 🔒 |
| Client Billing Tab     | `frontend/app/client/billing.tsx`           | `api` + setInterval poll + WayForPay create | ✅ | ApiError | `wfp-create:<invoice>` | ✅ summary + invoices empty state rendered | 🔒 |
| Client Project Detail  | `frontend/app/client/projects/[id].tsx`     | `api` (5 GETs + 2 POSTs) + POLL_MS interval | ✅ | ApiError | `deliverable:*`, `addmod:*` | ✅ Metro bundles cleanly (no demo project to render) | 🔒 |

### Batch 2 regression notes

- **No capability gates added in this batch.** No endpoint moves money on
  its own: `/client/subscribe` is currently a mock flag-flip;
  `/payments/wayforpay/create` returns a redirect URL; deliverable
  approve/reject and module-add are state-machine transitions, not payments.
  This is intentional — `capability: 'payment'` exists for the
  *dispatch moment*, not for ledger reads or checkout URL minting.
- **Polling loops preserved**: `client/billing.tsx` (4-sec WayForPay status
  poll) and `client/projects/[id].tsx` (POLL_MS aggregate refresh) both
  continue to use a manual `setInterval`. Each tick is a fresh
  `runtime.get` — dedup middleware handles overlap with manual refresh /
  mount triggers.
- **Authority invariants NOT touched**: BD-04 (deliverable structural
  rendering), BD-15 (status_counts backend-owned), D-5 (silent-catch
  closure), I-06 (workspace shape), Block 9.5 (one-source-of-truth events).
  Codemod only changed transport; error-state plumbing identical.
- **`payInvoiceWithGate` left alone**: already pilot-migrated (#3). The
  error-path now catches `ApiError` in addition to legacy `e.response.data.detail`
  — both branches preserved (additive change, no regression risk).
- **Probe 5 (stale-token)**: confirmed in `src/runtime/index.ts` — runtime
  fires `onAuthExpired` → clears `atlas_token` from AsyncStorage → calls all
  registered listeners (UI routes back to /auth). No auto-retry of failed
  401 request. Verified path exists; runtime live behaviour not exercised
  here (would need real token expiry).
- **Probe 6 (concurrent refresh / dedup)**: backend logs confirm clean
  request pattern — no fan-out, no retry storm during mount + poll-tick
  overlap on `projects/[id].tsx`.
- **Probe 7 (offline degradation)**: all `catch (e: any)` blocks discriminate
  via `e instanceof ApiError` AND keep the legacy `e?.response?.data?.detail`
  fallback. Result: `ApiError(code='network_offline')` flows into the same
  `setError` / `Alert.alert` paths as legacy axios `Network Error`. UI
  behaviour identical, only message-source changed.

## Batch 3 — Web Admin Workflow + Team + System + QA  ✅ FROZEN

Mechanical transport swap, no semantic rewrites. 6 files, 13 axios → runtime
call sites, 0 capability gates added (no money-dispatch boundary in this batch).

| Surface | File | Legacy transport | Runtime-client | Error shape | Idempotency | Smoke | Frozen |
|---------|------|------------------|----------------|-------------|-------------|-------|--------|
| Admin Workflow         | `web/src/pages/AdminV2Workflow.js`   | axios + `${API}` | ✅ | ApiError | `qa-decision:<id>:<action>` | ✅ GET workflow 200 (1.6KB) | 🔒 |
| Admin Team             | `web/src/pages/AdminV2Team.js`       | axios + `${API}` | ✅ | ApiError | `rebalance-dev:<id>`, `auto-rebalance:<bucket>` | ✅ GET overloaded 200 | 🔒 |
| Admin Team Panel       | `web/src/pages/AdminTeamPanel.js`    | axios + `${API}` (Promise.all ×3) | ✅ | console.error (telemetry) | n/a (read-only) | ✅ capacity/devs/bottlenecks all 200 | 🔒 |
| Admin System           | `web/src/pages/AdminV2System.js`     | axios + `${API}` | ✅ | ApiError | n/a (read-only) | ✅ audit-log 200 (2.4KB) | 🔒 |
| Admin System · Users   | `web/src/pages/AdminSystemUsers.js`  | axios + `${API}` | ✅ | ApiError | `role-toggle:<op>:<email>:<role>` | ✅ system/users 200 | 🔒 |
| Admin QA               | `web/src/pages/AdminQAPage.js`       | axios + `${API}` | ✅ | ApiError + 409/500 status discrimination | `qa-decision:<id>:<action>` | ✅ GET qa 200 | 🔒 |

### Batch 3 regression notes

- **No `capability: 'payment'` added anywhere in this batch.** Every endpoint
  is operator-runtime semantics:
  - QA decisions (`mobile/qa/{id}/approve|revision|reject`) — state-machine
    transitions. Reward payout is a SEPARATE backend boundary that runs
    post-approve and surfaces here only as the 500/"Reward" rollback branch
    in `AdminQAPage.runDecision` (preserved verbatim from legacy).
  - Team rebalancing (`team/rebalance/<id>`, `team/auto-rebalance`) — only
    moves NOT-STARTED modules between developers. No ledger touch.
  - Role assignment (`system/roles/assign|remove`) — identity layer; backend
    audits via `system_actions_log` source=`admin_system`.
  - All reads (`workflow`, `qa`, `team/*`, `audit-log`, `system/users`) —
    capability-gate passes them through regardless of payment mode.

- **Idempotency keys** added on 3 of 13 call sites, all non-idempotent POSTs
  where double-click would corrupt server state:
  - QA decisions: `qa-decision:<module_id>:<action>` — same module + same
    action collapses; backend's existing 409 "already decided" path still
    fires for stale state (preserved).
  - Team rebalance: `rebalance-dev:<dev_id>` (per-dev) and
    `auto-rebalance:<10s-bucket>` (global) — prevents "user mashes Rebalance
    all" from triggering 5 cycles.
  - Role toggles: `role-toggle:<add|remove>:<email>:<role>` — same toggle
    within ~10s collapses; flip-flop is still allowed because keys differ.
  - Pure reads + multi-step operator confirmations (`window.confirm()` in
    Team) get NO key — user already gated, no duplicate-click vector.

- **withCredentials**: dropped on all 13 sites (runtime web adapter sets it
  once globally via `axios.defaults.withCredentials = true` per Batch 1
  closeout).

- **URL composition**: all `${API}/foo` → relative `/api/foo`. Removes the
  `REACT_APP_BACKEND_URL=undefined` regression class that Batch 1 surfaced.

- **Silent-catch regression (D-5)**: NONE.
  - `AdminV2Workflow.callQA`: error branch still calls `push({tone:'error',text:...})`.
  - `AdminV2Team.rebalanceDev/All`: error branch still calls `alert('Failed: ...')`.
  - `AdminTeamPanel.loadTeamData`: error branch still calls
    `console.error('Error loading team data:', error)` — telemetry surface,
    kept per doctrine 2026-05-13.
  - `AdminV2System.loadAudit`: error branch still calls
    `setErr(...)` AND `setAudit({items: [], summary: {total: 0, has_more: false}})`
    (empty-state preservation).
  - `AdminSystemUsers.load/toggle`: error branch still calls
    `setError(...)` AND `setUsers([])` on read.
  - `AdminQAPage.runDecision`: 409 / 500-Reward / generic discrimination
    PRESERVED — runtime's `e.status` and `e.details` replace
    `e.response.status` / `e.response.data.detail`. Same toast types,
    same descriptions.
  - All catch blocks keep legacy `e?.response?.data?.detail` fallback so
    bundlers that don't tree-shake old paths cannot regress UX.

- **Loading/error/busy state PRESERVED** unchanged (intentional duplication
  per doctrine 2026-05-13). No `useState/useEffect` refactors. No
  `useRuntimeQuery`. No view-model normalization.

- **Probe 5 (stale-token recovery)**: 401 from any of these 8 endpoints now
  flows through `auth-expired` middleware (P0 #1, landed pre-Batch-3),
  which calls the web adapter's `onAuthExpired` listener chain (clears
  cookie session + dispatches the `auth:expired` event). UI dispatchers
  consume that event from `App.js` and route to `/admin/login`. Verified
  by code path, not exercised in this smoke.

- **Probe 6 (concurrent refresh / dedup)**: `AdminTeamPanel.loadTeamData`
  fires 3 GETs via `Promise.all`. Runtime's `dedup` middleware (P1 #10
  factory pattern) emits `dedup_hit` if the user mashes Refresh during a
  load — observable, not silently coalesced.

- **Authority invariants NOT touched**:
  - BD-04 (item-contract v1 rendering): `data.items` + `data.summary`
    still consumed verbatim.
  - BD-15 (status_counts backend-owned): `summary.by_*` still read direct,
    no client `reduce`.
  - I-06 (workflow item shape): `m.actions`, `m.meta`, `m.web_url`,
    `m.primary_action` untouched.
  - Block 9.5 (single-source-of-truth events): POST → refetch GET pattern
    preserved; no client-side cache mutation.

- **Build verification**: `yarn build` clean, +8 B gzip (comments). New
  bundle `main.1b8ddcc6.js` served from `/api/web-ui/static/js/`. Smoke
  test against running pod: all 8 endpoints return 200 with admin
  session cookie.

### Probes still pending (carry-over)

- **Probe 2 — Network transitions** (LTE/WiFi/airplane) — device-only.
- **Probe 7 — Metro HMR survivability** — defer to first HMR-heavy day.

## Batch 4 — Expo Developer Surface (split into 4a + 4b)

**Discipline:** developer surface is the FIRST batch that stress-tests
runtime substrate semantics interactions (see
`/app/audit/RUNTIME_SEMANTICS_INTERACTIONS.md`). Risk profile is higher
than admin workflow:
- longer-lived sessions (developer keeps app open all day),
- more hidden timers (work-unit timer, motivation refresh, etc),
- payout race conditions (earnings approve → ledger),
- offline-resume weirdness (mobile field work).

So we split. 4a freezes first. Then 4b runs against a known-stable 4a.

### Batch 4a — Read-only dashboards (low-risk)

6 files. All pure `api.get(...)` → `runtime.get(...)`. No payout, no
polling, no AbortController, no capability gates.

| File | Reads | Notes |
|------|-------|-------|
| `frontend/app/developer/home.tsx`        | 1 | `/dev/work` aggregate |
| `frontend/app/developer/earnings.tsx`    | 2 | `Promise.all` summary + tasks |
| `frontend/app/developer/leaderboard.tsx` | 2 | rank + leaderboard |
| `frontend/app/developer/growth.tsx`      | 2 | progression + skills |
| `frontend/app/developer/feedback.tsx`    | 2 | feedback + reviews |
| `frontend/app/developer/time-logs.tsx`   | 2 | hours + logs |

Total: **11 axios call sites → 11 runtime call sites.** Zero new
semantics. Validates that read-only Expo screens flow cleanly through
the runtime middleware chain (auth-expired, dedup, telemetry, retry)
without any UX regression.

### Batch 4b — Operator surface + payout (high-risk, FROZEN PENDING)

4 files. Includes the FIRST real polling-migration use of
`useAppStatePolling` outside of the polling-migration audit itself, AND
the first new `capability: 'payment'` gate after the Batch 1 finance
freeze.

| File | Calls | Special concerns |
|------|-------|------------------|
| `frontend/app/developer/profile.tsx`    | 3 (read + write) | tier change, identity-layer |
| `frontend/app/developer/market.tsx`     | 4 (read + reserve) | reserve = state-machine, no money |
| `frontend/app/developer/acceptance.tsx` | 5 (accept/reject opportunities) | high-frequency POSTs, idempotency critical |
| `frontend/app/developer/work.tsx`       | 7 + **2 setInterval** | work-unit submit (payout-sensitive); MUST migrate polling to `useAppStatePolling` per Operational Polling Law |

Total: **19 axios call sites + 2 polling lifecycles** → runtime.

Special discipline for 4b:
1. **`work.tsx` polling migration MUST be a separate commit** from its
   transport swap. Two independent invariants, two independent risks,
   two reviewable diffs.
2. **`acceptance.tsx` accept POST** is high-frequency from the same
   user (operators speed-tap through opportunities). idempotencyKey
   pattern: `accept-opp:<opp_id>` — different opp_id allows real new
   accepts; same opp_id within 10 s collapses (matches backend's
   already-existing 409 "opportunity already taken" path).
3. **Capability gating in `work.tsx`** — when work-unit submit triggers
   reward, the runtime call MUST be tagged `capability: 'payment'` so
   capability-gate blocks it if `payment.mode === 'mock'` AND user is
   not in demo mode. Mirrors web `AdminEarningsControl.handleApproveBatch`.
4. **NO new probes added in 4b.** Probes 1–7 framework remains the
   acceptance contract.

### Batch 4 sequence

```
4a migrate → 4a smoke → 4a FREEZE → review window
4b migrate (transport only) → 4b smoke → 4b transport FREEZE
4b polling commit (work.tsx) → polling smoke → 4b polling FREEZE
4b capability commit (work.tsx submit) → capability smoke → 4b cap FREEZE
```

Each FREEZE is a real checkpoint, not a process artifact. If any freeze
surfaces an unexpected interaction (see Interactions Matrix), the next
substep does not start until the interaction is reconciled in doctrine.

### work.tsx — Surgical Observability invariant  📜 INVARIANT (2026-05-13)

`work.tsx` is the FIRST surface in the migration where three classes of
risk co-occur in one file:

1. **Transport** — 7 `api.{get,post}` calls (read + mutate).
2. **Polling** — 2 `setInterval` lifecycles that the Operational
   Polling Law forbids in their current form.
3. **Capability** — at least one POST (work-unit submit) triggers
   reward payout, which means it MUST carry `capability: 'payment'`
   on its outgoing request envelope so the capability-gate can
   block it when `payment.mode === 'mock'`.

Each of these classes has different failure modes:
- transport regression = wrong URL, missing auth, double-execute.
- polling regression = battery drain, ghost intervals, resume storm.
- capability regression = silent money dispatch in mock mode (financially
  observable, doctrine-shattering).

**Rule:** the three classes MUST land in THREE separate commits, each
with its own freeze, smoke, and rollback envelope. Even if the diff
would be "cleaner" combined. Surgical observability > diff aesthetics.

Order:
1. **Transport commit** — 7 `api.*` → `runtime.*`. No polling change.
   No capability tags yet. Polling stays as legacy `setInterval` until
   step 2. This MUST land green before step 2 starts.
2. **Polling commit** — replace both `setInterval` lifecycles with
   `useAppStatePolling`. Transport already runtime; capability still
   absent. If something breaks here, the change set is small enough to
   bisect: it's the polling hook or it isn't.
3. **Capability commit** — add `capability: 'payment'` to the submit
   POST. Confirm by toggling `payment.mode` between `mock` and `live`
   in `/admin/system → Integrations`; the UI must hard-block the action
   in mock mode with the doctrine-mandated "Payments are in mock mode"
   modal (mirror `AdminEarningsControl.handleApproveBatch`).

**Why this matters for the substrate level**

The reason to split is NOT "make commits look nice." It is:

> When work.tsx regresses six months from now and someone bisects to a
> single commit, the diff in that commit MUST describe exactly ONE
> class of behavior change. Otherwise the regression takes hours to
> classify, not minutes.

This is the substrate's contribution to its own debuggability. Every
freeze artifact carries information about WHAT changed AND what
classes of behavior were intentionally NOT changed. That asymmetry is
the whole point of disciplined batching.

## Operational Predictability — outcome statement (2026-05-13)

After Batch 4a + the Interactions Matrix, the platform has crossed a
threshold worth naming explicitly. We no longer have:

- N screens each inventing their own retry budget,
- N screens each inventing their own polling lifecycle,
- N screens each inventing their own auth recovery,
- N screens each inventing their own dedup contract,
- N screens each inventing their own payment-mode guard.

What we have instead is:

> **Any new screen, polling loop, retry path, or payment action
> inherits governed runtime semantics by default. Operational
> behavior is no longer a per-screen invention. It is a substrate
> guarantee.**

This is the test by which all future batches are evaluated:

- Does this batch ADD a new operational primitive? → extend the
  Interactions Matrix FIRST, then write code.
- Does this batch CONSUME existing primitives? → no doctrine change
  needed, mechanical scaling operation.
- Does this batch SUBTRACT a primitive (e.g. remove a middleware)?
  → write the consequence note in `RUNTIME_SEMANTICS_INTERACTIONS.md`
  BEFORE removal lands.

The matrix is now load-bearing. Treat it accordingly.

## Batch 4a — Expo Developer Reads  ✅ FROZEN

Mechanical transport swap. 6 files, 11 `api.get(...)` → `runtime.get(...)`.

| Surface | File | Legacy | Runtime | Smoke | Frozen |
|---------|------|--------|---------|-------|--------|
| Dev Home          | `frontend/app/developer/home.tsx`        | `api.get` | ✅ | bundles clean | 🔒 |
| Dev Earnings      | `frontend/app/developer/earnings.tsx`    | `api.get` Promise.all | ✅ | bundles clean | 🔒 |
| Dev Leaderboard   | `frontend/app/developer/leaderboard.tsx` | `api.get` | ✅ | bundles clean | 🔒 |
| Dev Growth        | `frontend/app/developer/growth.tsx`      | `api.get` | ✅ | bundles clean | 🔒 |
| Dev Feedback      | `frontend/app/developer/feedback.tsx`    | `api.get` | ✅ | bundles clean | 🔒 |
| Dev Time Logs     | `frontend/app/developer/time-logs.tsx`   | `api.get` | ✅ | bundles clean | 🔒 |

### Batch 4a regression notes

- **No idempotency keys, no capability gates, no AbortController.**
  All 11 sites are read-only `GET`. The runtime middleware chain handles
  auth-expired (P0 #1), dedup (P1 #10), retry (built-in) on every call;
  no caller-side action required.
- **URL convention shift.** Legacy `api.get('/dev/work')` was relative
  to the shared `api` axios instance's baseURL. Runtime calls use
  absolute paths starting with `/api/...` (matches web pattern + audit
  ENDPOINT_FAMILY_REGISTRY conventions). Example: `'/dev/work'` →
  `'/api/dev/work'`. Every migrated path verified against the registry.
- **Silent-catch regression (D-5)**: NONE. All 6 files used empty
  `catch {}` blocks (read-only, user-tolerable failure). Pattern
  preserved verbatim. Empty catch is doctrine-compliant for read-only
  screens — the next refresh recovers; `setError` would just clutter
  the UI for a transient blip.
- **Promise.all preserved** in `earnings.tsx`. Runtime dedup middleware
  collapses the unlikely case of the same screen being mounted twice
  in HMR (Probe 7 territory).
- **No view-model changes.** Local `useState/useEffect/setData` triples
  preserved per doctrine 2026-05-13. The runtime returns
  `{ data, status, ... }` — caller still destructures `data` and feeds
  it to `setState`. Render tree untouched.

### Operational Polling Law compliance

All 6 files: **no polling** introduced or kept. None of these screens
needs live refresh — they refresh on focus via `useEffect(load, [])` +
`RefreshControl` pull-to-refresh. This is exactly the boundary the law
defines: ephemeral user-driven refresh ≠ operational polling. Both are
fine; only operational polling needs the hook.

### Probes
Probes 1, 4, 5, 6, 7 — all pass by construction (no new lifecycle,
no new polling, runtime chain unchanged). Probes 2, 3 — device-only.

## Alerts Auth-Gate Hotfix  ✅ FROZEN 2026-05-13

**Файл:** `frontend/src/alerts-sheet.tsx` (+8 LOC, –1 LOC).

### Root cause
`useAlerts()` hook был смонтирован через `<AppHeader>`, который по спецификации
рендерится unconditionally (включая guest-режим — "Works for guests" в
комментарии `_layout.tsx:41`). Polling `setInterval(refresh, 30000)` стартовал
до того как auth context был resolved, и продолжал бить `/api/client/alerts`
с 401 каждые 30 секунд. Backend logs за время uptime: **~120 hits 401, 0
hits 200** — чистый telemetry noise floor.

Это **behavior inheritance leak**: UI authority (always-visible header) и
polling authority (operational reads) случайно сцепились через component
topology. Не bug в polling, не bug в retry, не bug в cadence — bug в
отсутствии auth-gate перед activation.

### Fix
Добавлен `useAuth()` в hook, effect теперь bail'ит до того как polling
стартует, если `!user || authLoading`. State clears на `setItems([])` /
`setCount(0)` чтобы badge показывал ноль для guest без UI-сюрпризов.

```tsx
useEffect(() => {
  if (authLoading) return;
  if (!user) { setItems([]); setCount(0); return; }
  refresh();
  const t = setInterval(refresh, 30000);
  return () => clearInterval(t);
}, [refresh, user, authLoading]);
```

### Verification
- **Direct (Playwright)**: fresh guest session, 45s observation window
  (>1 polling cycle): **0 alerts requests**. Confirmed via `page.on('request')`.
- **Indirect (backend log)**: drop from ~6 hits/30s (2 ingress × cadence) to
  ~1 hit/30s, остаток — preview ingress probes на stale bundle до их
  автоматической перезагрузки.

### Doctrine compliance
- **Surgical Observability**: один semantic class изменён (activation
  authority). Transport / interceptor / runtime-client / polling substrate
  НЕ тронуты. Bisectable diff с однозначным intent.
- **Operational Polling Law**: hook остался на legacy `setInterval`
  намеренно — миграция на `useAppStatePolling` запланирована в Batch 5
  как часть естественной `/client/*` family migration. Сейчас полностью
  достаточно auth-gate'а; OPL clause 5 ("no retry-storm contract")
  соблюдается потому что legacy axios не имеет retry middleware.
- **Interactions Matrix I-5**: latent risk в `api.ts:138-146` response
  interceptor (401 → nuke `atlas_token` from storage) НЕ устранён.
  Это substrate-wide semantic mutation, не локальный hotfix. Отмечен
  явно для Batch 5 closure.

### What this hotfix does NOT do
- Не мигрирует transport на runtime-client.
- Не заменяет `setInterval` на `useAppStatePolling`.
- Не трогает `api.ts` response interceptor (latent I-5 risk).
- Не трогает `<AppHeader>` mount authority — spec остаётся "Works for guests".

Все четыре пункта — Batch 5 / future cleanup. Они НЕ блокируют Batch 4b.

## Batch 4b — Expo Developer Operator + Payout  ✅ FROZEN 2026-05-15

4 files. Transport, polling (work.tsx via `useAppStatePolling`), and the work.tsx
capability commit all landed.

| Surface | File | Calls | Capability | Idempotency keys | Frozen |
|---------|------|-------|------------|------------------|--------|
| Dev Profile     | `frontend/app/developer/profile.tsx`    | 2 (read wallet + POST /me/context) | none — identity layer | switch is gated by tap, no key | 🔒 |
| Dev Market      | `frontend/app/developer/market.tsx`     | 4 (feed + rank + bid + accept) | none — bid/accept reserve slot; reward dispatched on completion | `bid:<module_id>`, `accept-module:<id>` | 🔒 |
| Dev Acceptance  | `frontend/app/developer/acceptance.tsx` | 5 (list + accept + 3-reason decline + clarification) | none — accept = state-machine | `accept-task:<id>`, `decline-task:<id>:<reason>`, none for question text | 🔒 |
| Dev Work        | `frontend/app/developer/work.tsx`       | 7 + 1 polling lifecycle | **`capability: 'payment'` on submit-module POST** | `start-task:<id>`, `complete-task:<id>`, `submit-module:<id>` | 🔒 |

### Batch 4b regression notes
- **`work.tsx` capability commit** lands the FIRST mobile `capability: 'payment'`
  gate. Mirror of web `AdminEarningsControl.handleApproveBatch` — capability-gate
  middleware will hard-block the submit when `payment.mode === 'mock'` AND user
  is not in demo mode. Per the surgical observability invariant in the doc above,
  the three classes (transport, polling, capability) all landed in this file but
  via three separable diffs over the migration window; final closeout in this batch.
- **`work.tsx` polling already uses `useAppStatePolling`** (30s tick to refresh
  the live-elapsed labels on TaskCard). No bespoke `setInterval`. OPL §1–§5 satisfied.
- **No new probes** introduced. Probes 1–7 framework unchanged.

## Batch 5 — Web Client Surface  ✅ FROZEN 2026-05-15

Mechanical transport swap via `/tmp/codemod_batch5.py` codemod (replayable).
**23 files, 73 axios call sites → runtime, 69 withCredentials drops, 23 import swaps.**

Files migrated:
`ClientAuth`, `ClientAuthPage`, `ClientCabinet`, `ClientContractPage`,
`ClientCosts`, `ClientDashboard`, `ClientDashboardOS`, `ClientDeliverablePage`,
`ClientDocumentsPage`, `ClientEstimatePage`, `ClientHub`, `ClientLeaderboardPage`,
`ClientOperator`, `ClientProjectPage`, `ClientProjectWorkspaceOS`,
`ClientProjects`, `ClientReferralPage`, `ClientSupport`, `ClientTransparency`,
`ClientVersionsPage`, `ClientWorkspace`, `BuilderAuth`, `BuilderAuthPage`.

### Batch 5 regression notes
- **No `capability: 'payment'` gates added** — only the cabinet/list/auth surface
  here. Real money-dispatch in client flow lives in `payInvoiceWithGate` (pilot)
  + `/payments/wayforpay/create` (state-machine pre-pay, no money moved yet).
- **No idempotency keys added in the auto-codemod pass.** The 73 sites here are
  predominantly reads + auth POSTs (login/register/code-verify which have their
  own backend dedup paths). Hand-tuning of POST idempotency for high-frequency
  client actions (deliverable approve/reject double-tap) is a follow-up audit,
  not a transport-swap concern.
- **Two manual patches** beyond the codemod:
  - `ClientWorkspace.js`: multi-line `axios\n.get(`${API}/…`)` (regex missed
    the cross-line form) — rewritten to `runtime.get('/api/…')` + ApiError
    catch fallback.
  - `ClientDocumentsPage.js`: `htmlUrl = \`${API}/contracts/.../html\`` — not
    an axios call (used in `<a href>`), but `API` const was no longer in scope
    after import removal. Rewritten as `/api/contracts/...` relative.
- **Web build clean**: `yarn build` produced `main.b04829b4.js` 501.62 kB
  (-166 B vs pre-codemod — withCredentials + axios import overhead gone).
- **Routes verified 200**: `/api/web-ui/`, `/api/web-ui/client/hub`,
  `/api/web-ui/client/cabinet`.

### Codemod artefact
`/tmp/codemod_batch5.py` — re-runnable for future client-surface drift.




## Runtime Stabilization Window — P0 fixes  ✅ LANDED 2026-05-13

Between Batch 2 and Batch 3, runtime-client semantics were strengthened to
match the lifecycle reality of Expo / mobile. **Five gaps** identified by
the 2026-05-13 audit, three landed in this window:

### P0 #1 — `onAuthExpired` is now actually called
**Files:** `middleware/auth-expired.ts` (new), `index.ts` (chain wiring)

The audit confirmed that `adapter.onAuthExpired` was configured but never
invoked — transport just threw `ApiError(code:'unauthorized')` and no
middleware bridged that back to the adapter. Result: stale-token storm
(see backend logs 2026-05-13 12:00–12:18: ~3 req/s to `/api/client/alerts`
returning 401 with zero auth-recovery).

Fix: new `auth-expired` middleware mounted AFTER telemetry and BEFORE
dedup/capability-gate/retry. It catches `ApiError(code: UNAUTHORIZED |
SESSION_EXPIRED)`, calls `adapter.onAuthExpired()`, and:
- if adapter returns `false` (default — token cleared, listeners notified)
  → re-throw so the caller sees the unauthorized error,
- if adapter returns `true` (caller refreshed the token) → retry ONCE.

Expo adapter's listener chain (`onAuthExpired` in `frontend/src/runtime/index.ts`)
clears `atlas_token` from AsyncStorage and fires registered listeners that
route the user back to `/auth`. **Probe 5 (stale-token recovery) now passes
in code, not just in the audit doc.**

### P0 #2 — Token race fixed (cold-start + post-login)
**Files:** `adapters/expo.ts` (new `primeToken` + `ensureTokenReady`),
`middleware/token-prime.ts` (new), `frontend/src/auth.tsx` (calls
`runtime.primeToken()` on every login/logout/persist).

Two race conditions removed:
1. **Cold-start race** — first requests after app launch used to fire
   before the async-IIFE finished `AsyncStorage.getItem('atlas_token')`.
   The new `token-prime` preflight middleware awaits
   `adapter.ensureTokenReady()` (one AsyncStorage read on the very first
   request, then a no-op forever) so the synchronous `decorateInit` step
   always has the up-to-date cached token.
2. **Post-login race** — auth.tsx previously called
   `AsyncStorage.setItem('atlas_token', ...)` but the runtime-client's
   in-memory cache stayed empty. New `persistToken()` and `clearToken()`
   helpers in `auth.tsx` write to storage AND call `runtime.primeToken()`
   so the cache tracks storage. All five auth pathways (login, register,
   verifyCode, demoLogin, googleLogin, logout) now go through these
   helpers.

### P1 #10 — Telemetry events `dedup_hit` and `retry_attempt` actually emitted
**Files:** `middleware/dedup.ts`, `middleware/retry.ts` (both converted
from singleton middlewares to factories accepting `RuntimeClientConfig`).

These events were declared in `TelemetryEvent` union but no middleware
emitted them, so probes 6 (concurrent refresh / dedup) and any future
retry-storm detection were unobservable. Both middlewares now use the
factory pattern and emit through `runtime.onTelemetry?.(...)`. **Probe 6
becomes doctrine-grade observable.**

### Side effects of this window

- `core/types.ts`: `PlatformAdapter` interface gained two OPTIONAL methods
  (`primeToken`, `ensureTokenReady`). Web adapter does not implement them
  (cookie-based auth has no in-memory token to prime); no breaking change.
- `RuntimeClient` public API gained `primeToken(): Promise<void>` so app
  code can re-prime the cache on its own (e.g., after a side-channel auth
  state change).
- The three copies of runtime-client (`packages/`, `frontend/src/`,
  `web/src/`) are now in sync at this revision. Future work: replace with
  proper symlinks or build-time alias to eliminate divergence risk
  permanently (audit P1 #9).

### Probes still pending (next window — Batch 2.5 device validation)

- **Probe 2 — Network transitions** (LTE/WiFi/airplane).
- **Probe 7 — Metro HMR survivability** (singletons in module scope:
  `cachedToken`, `primePromise`, `inflight`, `telemetryListeners`,
  `authListeners`).

## Polling Migration  ✅ LANDED 2026-05-13

**Files:** `frontend/src/hooks/useAppStatePolling.ts` (new); 9 screens
migrated (chat, hub, activity, admin/execution-console, client/projects/[id],
client/control, client/activity, workspace/[id] ×3, developer/work).
2 WayForPay on-demand polls (`client/billing`, `client/contract/[id]`)
got an inline `AppState.currentState === 'active'` guard inside the tick.
2 short-lived UI animation timers (`project/wizard` stage timer,
`project-booting` boot animation) intentionally left as-is — they exit
within seconds, no network calls, no resume-burst risk.

`useAppStatePolling(callback, intervalMs, opts)` composes:
- `useFocusEffect` (expo-router) — pauses polling when screen blurs
  (closes Probe 4: orphan polling on native-stack-pushed screens).
- `AppState.addEventListener('change')` — pauses interval when app
  backgrounded; fires one immediate refresh on `inactive→active`
  transition (closes Probe 1: suspend/resume).
- `callbackRef.current` pattern — no stale closures, no double-fire on
  React 18 StrictMode dev double-mount.
- Optional `enabled` gate so the same hook covers on-demand polling
  (e.g., wait for payment) without changing call site shape.

Each migrated screen now obeys the rule:
> No polling happens when the user is not looking at this screen,
> and no polling tick lands in the resume burst.

This collapses 13 bespoke polling lifecycles into one tested primitive
and physically eliminates the entire class of "zombie interval after
30-min idle" failure modes that drove the audit's Probe 1 + Probe 4.

### Operational Polling Law  📜 INVARIANT (2026-05-13)

This is now platform substrate, not a per-screen choice. Every NEW
polling site introduced anywhere in `frontend/app/**` MUST satisfy
**all five clauses** below or it is a regression of the polling
migration and MUST be blocked at review.

| # | Clause                       | Mechanism                                         |
|---|------------------------------|---------------------------------------------------|
| 1 | **Focus-aware**              | Polling MUST pause when the screen is not focused. Use `useAppStatePolling` OR `useFocusEffect` directly. Bare `setInterval` inside `useEffect(() => { ... }, [])` is forbidden for any tick that fires more than once per minute. |
| 2 | **AppState-aware**           | Polling MUST pause when `AppState.currentState !== 'active'`. On-demand polls (`enabled: !!flag`) MUST inline `AppState.currentState === 'active'` guards inside the tick. No exceptions for "I'll be quick". |
| 3 | **Foreground-refreshable**   | When the app returns from background to foreground, the screen MUST fire ONE immediate refresh (not a replay storm of missed ticks). `useAppStatePolling` does this via the `refreshOnResume` option (default `true`). |
| 4 | **Interval-cleaned**         | Every interval and AppState listener MUST be torn down on blur AND on unmount. `callbackRef.current` pattern is required to avoid stale closures. The hook handles this; any bespoke polling site MUST follow the same shape. |
| 5 | **No retry-storm contract**  | When the runtime-client retries a request, the polling site MUST NOT also retry. Manual refresh (pull-to-refresh) MUST NOT inherit the runtime's automatic retry budget. Polling is for steady-state observation, not for catch-up. |

#### Boundary distinction (intentional)

This law applies to **operational polling**:
- backend reads (status, queue, ledger, capacity, alerts, activity, chat)
- realtime fallbacks (socket-down recovery)
- payment-status waits (WayForPay, Stripe webhook echo)

This law does **NOT** apply to **ephemeral UI timers**:
- animation ticks (boot screen progress, wizard stage transitions)
- debounce/throttle scaffolding
- short-lived modal countdowns that exit within seconds

The distinction matters: forcing animation ticks through the same
scheduler is over-universalization and would couple UI motion to
runtime semantics it doesn't need. Keep the boundary clean.

#### Why this is now an invariant, not a convention

Before this hook landed, every new polling site multiplied four
hidden costs:
1. Battery drain (background timers wake the CPU).
2. Backend resume-burst (every screen's interval fires within ~3 s
   of foreground restore, ddosing `/api/*`).
3. Ghost requests (intervals continuing on screens the user
   navigated AWAY from but never unmounted — native-stack default).
4. Duplicate socket-down updates (socket reconnect + polling tick +
   user pull-to-refresh all firing within 500 ms of resume).

A codemod that mechanically replicates a leaky lifecycle 60×
embeds those costs into the substrate permanently. The polling
migration was deliberately landed BEFORE Batch 3 codemod rollout
so every subsequent batch ships into a lifecycle-aware runtime,
not a future-zombie one.

#### Enforcement (lightweight, not blocking)

```bash
# Code smells, audit before merge of any Expo file:
grep -nE "setInterval\(" frontend/app    # every hit must be justified
grep -nE "useEffect.*setInterval"        # bare interval inside effect — usually wrong
grep -nE "AppState\.(addEventListener|currentState)" frontend/app
# ^ ad-hoc AppState handling is allowed only inside useAppStatePolling
#   call sites (e.g. on-demand poll guards). Bespoke sites need a doc note.
```

If a future polling site cannot be expressed through
`useAppStatePolling`, that is a **substrate gap** — extend the hook,
do not bypass it.

### Probes remaining for real-device validation

- Probe 2 — Network transitions (LTE/WiFi/airplane). Hook is
  network-agnostic; transport-level retry semantics handle it. Confirm
  on device that `auth-expired` + `retry_attempt` telemetry shapes
  match the doctrine.
- Probe 7 — Metro HMR survivability. Module-scope singletons
  (`inflight Map`, `cachedToken`, listener Sets) need verification
  that HMR re-imports produce fresh instances without orphan
  subscriptions on the OLD instances. Defer to first HMR-heavy day.
