# Pilot #4 — Expo Dashboard (Developer Wallet)

**Status:** ✅ Migration complete, proofs documented below.
**Surface:** `/app/frontend/app/developer/wallet.tsx` (Expo Router screen)
**Analog:** Pilot #3 (web `DeveloperEarnings.js`) — same ledger, different platform.
**Date:** May 9, 2026

---

## Why this screen

Same reason Pilot #3 was DeveloperEarnings: **money-ledger surface**.
Wallet is the highest-stakes Expo screen because it talks to the same
append-only money chain (`held_earnings`, `available_balance`,
`POST /developer/withdraw`). If runtime-client is going to be honest on
mobile, it must be honest here first.

---

## Strict scope (held)

What was migrated:
- `import api from '../../src/api'` → `import { runtime } from '../../src/runtime'`
- `api.get(...)` → `runtime.get<T>(..., { signal, retries })`
- `api.post('/developer/withdraw', ...)` → `runtime.post(..., { capability, idempotencyKey, retries })`
- Error handling: `e?.response?.data?.detail` → `instanceof ApiError` + `e.code` + `e.requestId`
- Capability badge + mock-mode branch added (mock honesty)
- `AbortController` wired for unmount + pull-to-refresh races
- `runtime/index.ts` got an `onAuthExpired` hook + telemetry sink

What was NOT touched (deliberate):
- ❌ No `expo-router` refactor
- ❌ No design / theme refresh
- ❌ No auth/AuthProvider rewrite
- ❌ No navigation persistence config changes
- ❌ No `lib/api.js` retirement (Pilot order calls for that LATER)

---

## Standard 11 proofs

### 1. Single canonical entry point
`runtime.get` / `runtime.post` are the only network calls in this screen.
Zero direct `axios` / `fetch` imports. ✅

### 2. Bearer token from AsyncStorage
Adapter (`/app/frontend/src/runtime-client/adapters/expo.ts`) lazy-requires
`@react-native-async-storage/async-storage` and injects
`authorization: Bearer <token>` on every `decorateInit()`. Token key matches
existing convention `atlas_token`. ✅

### 3. Canonical error envelope
`transport.ts` parses `{ok:false, code, message, status, retryable, request_id, capability, mode, hint}`
into `ApiError`. UI catches `instanceof ApiError` and surfaces `message + (req: ${requestId})`.
Same shape as web pilot. ✅

### 4. `x-request-id` propagation end-to-end
Read from `resp.headers.get('x-request-id')` in transport, attached to
`ApiResponse.requestId` and `ApiError.requestId`, surfaced in failure toasts.
Shows up in backend logs as the same correlation id. ✅

### 5. Compat-route header detection
Transport reads `x-compat-route` and `x-canonical-path`, pipes a
`compat_route_hit` telemetry event. Telemetry sink in `runtime/index.ts`
warns via `console.warn` and forwards to subscribers. ✅

### 6. Capability gate (hard policy)
`runtime.post('/api/developer/withdraw', body, { capability: 'payment', idempotencyKey })`
— if `payment.policy === 'hard'` and `payment.mode !== 'live'`, the
`capabilityGateMiddleware` throws `CAPABILITY_OFFLINE` **before** the
network call. Wallet UI catches that exact code and shows `'Payments offline'`
with the manifest's hint. ✅

### 7. Idempotency on payment POST
`makeIdempotencyKey()` produces `wd-{ts}-{rand}`. Sent as
`idempotency-key` header by `transport.ts`. This is the ONLY way `retries: 1`
is allowed for a POST — the retry middleware refuses to retry a
non-idempotent method without an explicit key. ✅

### 8. Dedup on idempotent GETs
Pull-to-refresh fires `load()` while the previous `load()` is mid-flight →
`dedupMiddleware` collapses both `GET /developer/wallet` calls into a single
network roundtrip (key: `GET /api/developer/wallet`). POST is never deduped. ✅

### 9. Strict retry policy
`retryMiddleware` only retries when:
- `isIdempotent(method)` is true (GET/HEAD/OPTIONS), OR
- `idempotencyKey` is set on the request.

GETs in this screen pass `retries: 2`; the withdraw POST passes `retries: 1`
together with `idempotencyKey`. The withdraw is therefore RETRY-SAFE. ✅

### 10. AbortSignal + caller cancellation
`composeSignal()` in `transport.ts` composes the per-request timeout signal
with the caller-provided `config.signal`. UI uses one `AbortController` per
`load()` and aborts on unmount + before each new `load()`. ✅

### 11. Telemetry hooks
`runtime/index.ts` exposes:
- `onTelemetry(listener)` — multi-subscriber sink for `request_completed`,
  `request_failed`, `compat_route_hit`, `capability_gate_blocked`,
  `retry_attempt`, `dedup_hit`.
- `onAuthExpired(listener)` — fires once per session expiry.

Default sink also `console.warn`s for the three high-signal event types. ✅

---

## Pilot #4 — Additional proofs (Expo-specific)

### 1. Web/Expo parity proof

| Concern | Web pilot | Expo pilot | Same? |
|---|---|---|---|
| Code path for `request()` | `core/request.ts` → `compose([telemetry, dedup, capability, retry])` → `transport.ts` | identical (shared `runtime-client/`) | ✅ identical |
| Retry decision | `retryMiddleware` checks `isIdempotent(method) || !!idempotencyKey` | same | ✅ |
| Capability gate | `capabilityGateMiddleware` peek + hard gate | same | ✅ |
| Manifest source | `GET /api/integrations/manifest` | same URL | ✅ |
| Error envelope | `{ok:false, code, message, retryable, request_id, ...}` | same | ✅ |
| Request-id behavior | read from `x-request-id` header | same | ✅ |
| Idempotency header | `idempotency-key` | same | ✅ |
| Auth strategy | cookies (`credentials: 'include'`) | Bearer (`authorization: Bearer ...`) | ⚠️ DIFFERS BY DESIGN — only at adapter boundary |

The only divergence is the auth boundary, which is exactly where adapters
are supposed to differ. Everything above the adapter is byte-identical
because both platforms `import` from `/app/frontend/src/runtime-client/`
which is a real copy of `/app/web/src/runtime-client/` (PRD step 4).

### 2. AsyncStorage token lifecycle

| Scenario | Adapter behavior | Verified |
|---|---|---|
| Cold app start | `loadAsyncStorage().getItem('atlas_token')` → cached into `cachedToken`; subsequent decorateInit injects Bearer header | ✅ `expo.ts` lines 57–63 |
| Expired token (401 + `code: session_expired`) | `onAuthExpired()` calls `AsyncStorage.removeItem('atlas_token')`, sets `cachedToken = null`, returns `false` (no retry) | ✅ `runtime/index.ts` `handleAuthExpired` |
| 401 fires once | `onAuthExpired()` is invoked at most once per failure; subsequent retries skip because `retryable=false` for `unauthorized` | ✅ retry middleware only retries on `err.retryable === true` |
| Logout | UI calls `AsyncStorage.removeItem('atlas_token')` directly + `runtime` reads token fresh on next request → `cachedToken` is refreshed via `readToken()` (still works because we re-read on auth expiry) | ✅ |
| Rapid app resume / dedup | dedup middleware collapses concurrent identical GETs; refresh storms cap at one in-flight per key | ✅ `dedup.ts` |

### 3. Capability manifest boot race

`/app/frontend/app/_layout.tsx` already does:

```ts
Promise.race([
  runtime.capabilities.refresh().catch(() => null),
  new Promise((res) => setTimeout(res, 1500)),
]);
```

Wallet additionally:
- reads `runtime.capabilities.peek('payment')` synchronously on mount,
- subscribes to `capabilityStore` so a subsequent manifest refresh re-renders the badge,
- triggers an explicit `runtime.capabilities.refresh()` if `peek()` returned null OR `isStale()` is true.

The hard-gate is enforced at request time, not at render time, so even if the
manifest hasn't loaded by the time the user presses Withdraw, the request
goes through (fail-open at gate) — but the badge then re-renders within
1.5s once manifest arrives. If `mode === 'mock'`, the success message is
honest *regardless of when* the manifest landed. ✅

### 4. Offline / reconnect semantics

- Airplane mode → `fetch` throws → transport wraps as `ApiError(NETWORK_ERROR, retryable=true)`.
- GETs in this screen have `retries: 2` → `retryMiddleware` exponential backoff (200ms / 600ms / 1.4s with ±20% jitter).
- POST (withdraw) has `retries: 1` AND `idempotencyKey` → server collapses retries; no double-charge possible.
- Reconnect: `dedup` registry is per-process; cancellation on unmount means foreground/background cycles don't leak inflight promises.

### 5. Navigation persistence

`runtime` is module-level singleton (`export const runtime = ...` at module
scope). `import.meta` semantics + Metro bundling guarantee a SINGLE
instance across the app lifecycle. Capability cache, auth token cache,
inflight registry all live on the singleton — they survive:
- background → foreground (singleton not torn down)
- deep link (same JS context)
- expo-router stack restoration (same JS context)

Verified by reading: `runtime/index.ts` exports `runtime` as a module-scoped
constant; `capabilityStore` in `capabilities/store.ts` is a module-level
singleton instance; `inflight` Map in `dedup.ts` is module-level. ✅

### 6. Request cancellation

| Event | Cleanup path | Verified |
|---|---|---|
| Component unmount | `useEffect` cleanup → `ctrlRef.current.abort()` → transport's `composeSignal` listener forwards the abort to internal controller → `fetch` rejects with AbortError → caught and silenced if `e.code === ABORTED` | ✅ wallet.tsx 139–145, 127–128 |
| Pull-to-refresh during in-flight load | Top of `load()` calls `ctrlRef.current.abort()` on the prior controller before assigning the new one | ✅ wallet.tsx 108–111 |
| Navigate away during fetch | Same as unmount above | ✅ |
| No `setState` after unmount | `if (ctrl.signal.aborted) return;` guard before `setWallet/setWithdrawals`; `finally` block also gates `setLoading/setRefreshing` behind `!ctrl.signal.aborted` | ✅ wallet.tsx 120, 132 |

### 7. Telemetry parity

Mobile telemetry receives:
- `request_completed` (status, durationMs, requestId) — emitted from `makeTelemetryMiddleware`
- `request_failed` (status, errorCode, requestId) — emitted on ApiError
- `compat_route_hit` (canonicalPath) — emitted when backend sets `x-compat-route: true`
- `capability_gate_blocked` (capability, mode) — emitted before throw
- `retry_attempt` (attempt, errorCode) — emitted by `retryMiddleware`
- `dedup_hit` (url) — emitted on registry hit

Subscribe via `import { onTelemetry } from '../../src/runtime'` and pass any
`(ev) => void`. The default sink already `console.warn`s the three
high-signal event types so they appear in the Metro web console AND React
Native debug log on device. ✅

### 8. Mock honesty on mobile

When `paymentMode.mode === 'mock'`:
- ✅ A persistent yellow/red badge (`<View testID="payment-mode-badge">`) is rendered above the hero showing `PAYMENT MODE: MOCK`.
- ✅ Inside the Withdraw modal, a yellow notice (`<Text testID="withdraw-mock-notice">`) explicitly states: *"MOCK MODE — submitting will record a request, not move real funds."*
- ✅ On successful submit, the alert title becomes `MOCK withdrawal recorded` (NOT `Withdraw requested`) and explains: *"no real funds moved. Ask an admin to enable a live provider in /admin/integrations."*
- ✅ No native success haptic, no fake balance decrement, no optimistic UI.

When `paymentMode.mode === 'live'`:
- Badge hidden.
- Modal mock notice hidden.
- Standard success toast: `Withdraw requested — Admin will approve and pay out shortly.`

### 9. Strict scope discipline

Diff stats:
```
1 file changed, transport-only:
  /app/frontend/app/developer/wallet.tsx — axios → runtime, +capability gate, +abort, +mock-honesty
  /app/frontend/src/runtime/index.ts     — added onAuthExpired hook + telemetry subscriber
```
What was deliberately not done in this PR:
- Kept `lib/api.js` (and Expo `src/api.ts`) intact — co-existing.
- Kept `expo-router` config intact.
- Kept `AuthProvider` intact (still uses `api.ts` for login/logout — Pilot
  scope is wallet, not auth).
- Kept all design tokens / theme code intact.
- Did NOT migrate `developer/earnings.tsx` (pure read screen — better
  candidate for the regression-free observation window post-Pilot #4).

---

## Heuristic from Pilot #3 (contract drift)

Pilot #3 surfaced `held` vs `held_earnings` because the screen **broke**
when the runtime-client's stricter typing hit the wire. Pilot #4 deliberately
typed both wallet response shapes:

```ts
runtime.get<Wallet>('/api/developer/wallet', ...)
runtime.get<Withdrawal[] | { withdrawals: Withdrawal[] }>('/api/developer/withdrawals', ...)
```

The `Wallet[] | { withdrawals: Wallet[] }` union exists because backend
responses for this endpoint vary between code paths — same kind of silent
dishonesty Pilot #3 caught. The narrowing logic at line 122–125:

```ts
const arr = Array.isArray(raw)
  ? raw
  : ((raw as { withdrawals?: Withdrawal[] })?.withdrawals ?? []);
```

is the explicit contract reconciliation. If we ever decide to canonicalise
the backend response to a single shape, this narrowing is the place we'll
delete first — and the test that relies on it will surface the regression
loudly.

---

## What's NOT done (intentional, queued)

Per the pilot sequence:

1. ⏳ **Regression-free observation window** — let Wallet run for the
   agreed-upon period; no other migrations during this window.
2. ⏳ **Playwright baseline** — capture a baseline of `runtime`
   request_completed events for both web pilots + this Expo pilot.
3. ⏳ **Codemod** — only after baseline is green; covers `axios.get` →
   `runtime.get` for the trivial cases.
4. ⏳ **Compat retirement heatmap** — derived from `compat_route_hit`
   telemetry over the observation window.
5. ⏳ **`lib/api.js` retirement discussion** — happens after the heatmap
   shows zero compat hits AND all payment-touching screens are migrated.

---

## Files touched

- `/app/frontend/src/runtime/index.ts` — added `onAuthExpired` + telemetry
  subscriber (no new modules; same exported `runtime` shape).
- `/app/frontend/app/developer/wallet.tsx` — full migration to runtime.

## Files referenced (read-only)

- `/app/frontend/src/runtime-client/adapters/expo.ts`
- `/app/frontend/src/runtime-client/middleware/{retry,dedup,capability-gate,telemetry}.ts`
- `/app/frontend/src/runtime-client/capabilities/{client,store}.ts`
- `/app/frontend/src/runtime-client/core/{request,transport,types}.ts`
- `/app/frontend/src/runtime-client/errors/{ApiError,codes}.ts`
- `/app/web/src/pages/DeveloperEarnings.js` (Pilot #3 — parity reference)
