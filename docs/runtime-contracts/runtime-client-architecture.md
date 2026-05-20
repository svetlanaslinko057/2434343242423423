# Runtime-Client Architecture

**Frozen contract.** Owners: `packages/runtime-client/` (shared TS package
consumed by both web and Expo via `web/src/runtime/index.ts` and
`frontend/src/runtime/index.ts`).

The runtime-client is the **only** way UI code talks to the backend going
forward. Direct `axios` / `fetch` are legacy and will be removed page-by-page
in Stage 3.

## Topology

```
            ┌──────────────────────────────────────────┐
            │  UI page (web React / Expo screen)        │
            │  import { runtime } from '../runtime'     │
            │  await runtime.get('/api/...')            │
            └────────────────┬─────────────────────────┘
                             │
            ┌────────────────▼─────────────────────────┐
            │  RuntimeClient (factory + middleware     │
            │  pipeline; same TS class for web + expo) │
            └────────────────┬─────────────────────────┘
                             │
                ┌───────┬────┼────┬─────────────────┐
                │       │    │    │                 │
                ▼       ▼    ▼    ▼                 ▼
              dedup   cap-  retry  telemetry      transport
                      gate                          │
                                                    ▼
                                           PlatformAdapter
                                          (web | expo)
                                                    │
                                                    ▼
                                            HTTP (fetch)
                                                    │
                                                    ▼
                                       FastAPI ( /api/... )
```

## Public surface (frozen)

### `runtime` object

Both web and Expo expose **one** `runtime` instance (singleton). UI code
never instantiates the client directly.

```ts
// web:    web/src/runtime/index.ts          (createWebRuntimeClient)
// expo:   frontend/src/runtime/index.ts     (createExpoRuntimeClient)

import { runtime } from '../runtime';

const { data, requestId, fromCompatRoute } =
  await runtime.get('/api/admin/mobile/finance');
```

### Method shape

```ts
runtime.get<T>(url, config?):    Promise<ApiResponse<T>>
runtime.post<T>(url, body?, config?):   Promise<ApiResponse<T>>
runtime.patch<T>(url, body?, config?):  Promise<ApiResponse<T>>
runtime.put<T>(url, body?, config?):    Promise<ApiResponse<T>>
runtime.delete<T>(url, config?): Promise<ApiResponse<T>>

runtime.capabilities:            CapabilityClient
```

Returned `ApiResponse` (frozen):

```ts
interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  requestId: string;
  fromCompatRoute: boolean;
  canonicalPath?: string;
}
```

Errors are always `ApiError` instances (see `canonical-error-shape.md`).

## Middleware pipeline (frozen order)

The chain from inside to outside:

1. **transport** (innermost) — `fetch` via `PlatformAdapter`. Reads
   `x-request-id`, `x-compat-route`, `x-canonical-path`. Parses canonical
   error envelopes.
2. **telemetry** — emits `request_completed` / `request_failed` /
   `compat_route_hit` after the inner chain settles.
3. **retry** — replays `next()` per `retry-idempotency-policy.md`.
4. **dedup** — collapses concurrent identical idempotent requests.
5. **capability-gate** (outermost) — short-circuits `hard` capability
   when mode != live.

Order matters:
- capability-gate is outermost so blocked requests never even reach dedup
  / retry / telemetry (no spurious "request_failed" events).
- telemetry sits **outside** retry so duration includes backoffs.
- retry sits **outside** dedup so a single dedup-collapsed call is retried
  once on behalf of all callers.

Adding new middleware MAY happen, but order placement requires explicit
review against the rules above.

## Platform adapters

```ts
interface PlatformAdapter {
  getItem(key): Promise<string|null>;
  setItem(key, value): Promise<void>;
  removeItem(key): Promise<void>;
  decorateInit(init, config): RequestInit;
  onAuthExpired?(): Promise<boolean>;
}
```

| Surface | Adapter | Auth carrier | Persistent storage |
|---------|---------|--------------|---------------------|
| Web | `createWebAdapter` | session cookie (`credentials: 'include'`) | `localStorage` |
| Expo | `createExpoAdapter({ tokenKey })` | `Authorization: Bearer ${AsyncStorage[tokenKey]}` | `AsyncStorage` |

Each adapter:
- Handles `decorateInit` per platform (cookies vs. Bearer).
- Implements `onAuthExpired` to clear stored token / redirect.
- Exposes the same KV API for capability cache persistence.

A new platform (e.g. a CLI or worker) implements this interface and reuses
all middleware unchanged.

## Capability client

```ts
runtime.capabilities.refresh():   Promise<CapabilityManifest|null>
runtime.capabilities.peek(name):  CapabilityState | null
runtime.capabilities.subscribe(fn): unsubscribe
```

- `refresh()` re-fetches `/api/integrations/manifest`. Called on app boot;
  idempotent.
- `peek(name)` returns the current cached state (or `null` if unknown).
  Used by `capability-gate` synchronously per request.
- `subscribe(fn)` notifies UI of manifest changes (badges update without
  page reload).

Cache layers, in order:

1. **Memory** — current process.
2. **Persisted** — via `PlatformAdapter` (`localStorage` / `AsyncStorage`).
3. **Network** — re-fetched once `server_time + ttl_ms` elapses, on `401`,
   or on explicit `refresh()`.

Stale-while-revalidate is the default. UI never blocks on the network for
a manifest read.

## Telemetry contract

The runtime ships every request through a single `onTelemetry` hook:

```ts
type TelemetryEvent =
  | { type: 'request_completed', url, method, status, durationMs, requestId, capability?, attempt? }
  | { type: 'request_failed',    url, method, status?, errorCode?, durationMs, requestId?, capability?, attempt? }
  | { type: 'compat_route_hit',  url, method, status, requestId, canonicalPath }
  | { type: 'capability_gate_blocked', url, method, capability }
  | { type: 'retry_attempt',     url, method, attempt, requestId? }
  | { type: 'dedup_hit',         url, method }
```

The hook is a callback the surface app provides (see
`web/src/runtime/index.ts::onTelemetry`). Where the events ultimately land
(console, OTel, custom collector) is **not** part of the contract — the
event shape is.

## Logging convention (frozen)

Browser/Expo console output produced by the runtime-client uses the prefix
`[runtime]` so it is greppable in dev tools and crash reports. Format:

```
[runtime] compat_route_hit  { legacy: '/api/admin/finance', canonical: '/api/admin/mobile/finance', requestId: 'a3f9...' }
[runtime] request_failed    { url: '/api/foo', code: 'capability_offline', requestId: 'a3f9...' }
```

## What lives in `packages/runtime-client/`

This is a private monorepo package (`@evax/runtime-client`, `private: true`).
Both web and Expo consume it via filesystem reference (the source is copied
into `web/src/runtime-client/` and `frontend/src/runtime-client/` because
both bundlers resolve relative to their own `src/`). The single source of
truth is `/app/packages/runtime-client/src/`.

When extending the runtime, change ONLY in `packages/runtime-client/src/`
and re-sync to the surfaces. Long-term: replace the file copies with proper
package imports — that's a deployment-config change, not a contract change.

## What does NOT belong here

- ❌ Page-specific data shaping (do that in pages/hooks).
- ❌ Authentication flows (login form lives in UI, adapter only carries
  the token).
- ❌ Business logic. The runtime is transport + observability only.
- ❌ Direct DOM / RN access (kept platform-agnostic so adapters do all I/O).

## Migration policy

- The middleware **interface** is frozen. Adding new middleware is fine.
- The `RequestConfig` keys are frozen. Adding new optional keys is fine.
- The `ApiResponse` keys are frozen. `data` shape is per-endpoint and not
  in scope here.
- The telemetry event shape is frozen by `type`. Adding new keys to a known
  type is fine; new event `type`s require a TS type update on both sides.
