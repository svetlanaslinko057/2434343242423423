# Runtime-client migration — completion note (May 19, 2026)

This is the closing note on the migration discipline started in April 2026
when `src/runtime/index.ts` shipped as the new canonical transport.

## What changed

- `src/api.ts` is no longer an axios instance. It is now a **shim** that
  preserves the axios-shaped public API (`api.get('/x')` → `{ data, status, … }`)
  while every byte under the hood flows through `runtime`.
- All 43 Expo screens that import `api` from `src/api` continue to work
  without a single line changed. They now benefit from runtime middleware
  (token-prime, telemetry, auth-expired, dedup, capability-gate, retry).
- `ApiError` and `ErrorCode` re-export from `runtime-client/errors` —
  every `instanceof ApiError` check across the app keeps working with
  the canonical error class.

## Why a shim, not a hand-rewrite of 43 files

1. **Risk surface**: a single behavioural shim is easier to validate (one
   file's worth of tests) than 43 incremental rewrites where one bad
   import wrecks a screen.
2. **No path churn**: the shim auto-prepends `/api/` to caller-supplied
   paths, so existing code keeps using relative paths (`api.get('/me')`)
   while runtime sees absolute (`/api/me`). Hand-rewriting would force
   touching every callsite.
3. **Pilot Audit Discipline already validated runtime on 4 surfaces**
   (wallet, billing, developer/work, developer/profile). Extending that
   confidence to the remaining 39 screens through a single shim is the
   cheapest path to migration completion.

## What's retired

- The local axios instance in `src/api.ts` (replaced by runtime).
- Local request-id generator (runtime adds them).
- Local 401 → `AsyncStorage.removeItem(...)` interceptor (runtime owns it
  via `auth-expired` middleware).

## What survived (binary-compatible)

- `default` export `api` with `.get/.post/.put/.patch/.delete/.request`.
- `apiClient` named export with the same verbs + `.request`.
- `ApiError`, `ErrorCode` (re-exports from runtime-client).
- `getCapabilities`, `getCapabilityMode`, `clearCapabilitiesCache`
  (now backed by runtime's `CapabilityClient`, but `clearCache` is a
  no-op since runtime owns the cache lifecycle).

## What's gone for good

- `api.interceptors.*` (was never used outside the file).
- `api.defaults.*` (same).
- `api.raw` (same).
- `api.create()` (same).

If a future PR genuinely needs interceptors, add a middleware in
`src/runtime-client/middleware/` instead.

## Optional follow-up (not blocking)

For new code, prefer the modern path:

```ts
import { runtime } from '@/src/runtime';
const r = await runtime.get<MyResponse>('/api/my-endpoint');
```

This skips the shim's path normalisation and gives slightly better
type ergonomics. But there is **no requirement** to migrate existing
callsites — the shim is permanent infrastructure now.

## File map

- `src/api.ts` — shim (this file is the migration artifact)
- `src/runtime/index.ts` — wires runtime-client to the Expo adapter
- `src/runtime-client/` — the actual transport library

Migration done. No further action required.
