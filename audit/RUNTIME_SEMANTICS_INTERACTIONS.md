# Runtime Semantics Interactions Matrix

**Status:** observation document, drafted 2026-05-13
**Scope:** how the five runtime substrate primitives interact with each other.
Read this BEFORE adding a new middleware, a new lifecycle hook, or a new
polling site. Crossing two of these lines without understanding the
interaction is how platforms develop heisenbugs.

---

## The five primitives

| # | Primitive            | Owner                                          | Triggered by                          |
|---|----------------------|------------------------------------------------|---------------------------------------|
| A | **retry**            | `middleware/retry.ts` (factory)                | network error, `retryable: true`      |
| B | **dedup**            | `middleware/dedup.ts` (factory)                | identical request inflight            |
| C | **idempotencyKey**   | `core/request.ts` header injection             | caller passes `{ idempotencyKey }`    |
| D | **AppState/Focus**   | `hooks/useAppStatePolling.ts`                  | `useFocusEffect` + AppState listener  |
| E | **stale-auth**       | `middleware/auth-expired.ts` + adapter chain   | `ApiError(SESSION_EXPIRED/UNAUTHORIZED)` |

Each of these is correct in isolation. Composition is where the work is.

---

## The 5×5 interaction grid

Cells marked **🟢 SAFE** are designed compositions. Cells marked **⚠ WATCH**
need an active doctrine note. Cells marked **🔴 RISK** are known interaction
classes that MUST be tested before any batch that touches both.

|         | A retry | B dedup | C idem | D focus | E auth |
|---------|---------|---------|--------|---------|--------|
| **A retry**  | —       | 🟢       | 🟢      | ⚠       | 🔴      |
| **B dedup**  | 🟢       | —       | 🟢      | ⚠       | 🟢      |
| **C idem**   | 🟢       | 🟢       | —      | 🟢       | 🟢      |
| **D focus**  | ⚠       | ⚠       | 🟢      | —       | 🟢      |
| **E auth**   | 🔴       | 🟢       | 🟢      | 🟢       | —      |

Read cell (row, col) as "row's behaviour when col is also active."

---

## The five interactions called out by name

### I-1. retry × polling   (cells A↔D)

**Risk:** if the polled callback is itself a runtime request that retries
on transient error, then a 30-s polling tick with retry budget 2 can land
THREE requests inside a 5-s window. Across N screens this becomes a
backend storm.

**Contract:**
- Polling sites MUST NOT also retry on their own. `useAppStatePolling`
  passes the user's callback verbatim; the callback is allowed to call
  `runtime.get(...)` which inherits the runtime retry budget — but the
  polling site MUST NOT wrap the callback in additional `for (let i=0;
  i<N; i++)` retry loops.
- Manual refresh (pull-to-refresh) MUST NOT inherit retry budget. Use
  `{ retries: 0 }` for the manual-refresh path or accept the default and
  trust telemetry to surface `retry_attempt` events.
- A polling tick that lands during a previous tick's retry budget MUST
  be dedup-collapsed (cell B↔A is 🟢 because dedup runs BEFORE retry in
  the middleware chain).

### I-2. dedup × focus restore   (cells B↔D)

**Risk:** when an app returns from background, `refreshOnResume` fires one
immediate refresh. If the user ALSO pulls-to-refresh in the same 200 ms,
two identical requests race. Without dedup the backend sees both. With
dedup, one of them inherits the other's response — but if the SECOND
caller passes a different `signal: AbortController`, its abort wires up
to a request it doesn't actually own, which can mis-cancel the FIRST
caller's request.

**Contract:**
- `useAppStatePolling` does NOT take an AbortController. The polled
  callback is "fire and forget."
- Manual refresh paths SHOULD NOT pass `signal` either, unless the
  screen unmounts during the request (then the standard `useEffect`
  cleanup applies; runtime will deliver `request_cancelled` and the
  catch branch must handle it).
- If a screen MUST use AbortController explicitly, it MUST own its
  inflight request — do not share the same key with the polling tick.

### I-3. idempotencyKey × reconnect   (cells C↔A/E)

**Risk:** when the network drops and the request retries (cell A) or the
auth-expired path retries after token refresh (cell E), the SAME
idempotencyKey must travel on every retry attempt. Otherwise the backend
sees two separate non-idempotent attempts and may double-execute.

**Contract:**
- `core/request.ts` injects the `idempotency-key` header ONCE, during
  request decoration, before the retry loop starts. Header is part of
  the cached request descriptor that retry re-issues. ✅ Already correct.
- Callers MUST NOT vary the idempotencyKey across retries (e.g. don't
  bind it to `Date.now()` inside the retry callback). Lock it to the
  resource ID:
  - ✅ `idempotencyKey: 'qa-decision:<id>:<action>'`
  - ✅ `idempotencyKey: 'role-toggle:remove:<email>:<role>'`
  - ⚠ `idempotencyKey: \`pay:\${Date.now()}\`` ← only safe when this
    POST does NOT have a retry budget.

### I-4. AppState × inflight requests   (cells D↔A/B/E)

**Risk:** when AppState transitions `active → background` mid-request, the
OS may suspend the JS thread before the response arrives. On resume, the
socket layer reports either (a) connection closed (retryable error), or
(b) silent timeout (caller hangs forever). Neither matches "request
succeeded."

**Contract:**
- runtime treats backgrounded socket close as `network_offline`
  retryable. On resume, the polling tick fires `refreshOnResume` which
  re-issues a fresh request — old inflight is allowed to either succeed
  late (response just lands) or fail (network_offline). Either way the
  state on screen reflects the NEW response.
- Manual `setInterval` outside `useAppStatePolling` does NOT get this
  semantics. This is why the Operational Polling Law forbids bare
  `setInterval` for any tick > 1 minute.
- For non-idempotent POSTs that fire near a background transition:
  the idempotencyKey (cell C) is what makes resume-recovery safe. Even
  if the backend already executed the request before the suspend, the
  resume's retry hits the idem cache and gets the cached response.

### I-5. stale-auth × queued retries   (cells E↔A)

**Risk:** a request fails with 401 (UNAUTHORIZED). `auth-expired`
middleware fires. The retry middleware ALSO sees the failure. Without
careful chain ordering, retry kicks in BEFORE auth-expired clears the
token, leading to N retries against the same stale 401 — a small storm
that wastes user time and backend cycles.

**Contract:**
- Chain order (mounted in `core/transport.ts`):
  ```
  telemetry → token-prime → auth-expired → dedup → capability-gate → retry
  ```
- `auth-expired` runs BEFORE `retry`. When it sees UNAUTHORIZED:
  - if `adapter.onAuthExpired()` returns `false` (default — token cleared,
    listeners notified, app routed to /auth) → `auth-expired` re-throws
    so retry sees an error already classified as non-retryable
    (`SESSION_EXPIRED` is not in the retryable code set).
  - if `onAuthExpired()` returns `true` (caller refreshed the token) →
    `auth-expired` retries the request ONCE with the new token. retry
    middleware sees a fresh request, not a 401, and behaves normally.
- ✅ Already correct in `middleware/auth-expired.ts` (P0 #1 fix
  2026-05-13). Probe 5 passes by construction.

---

## Composition example: a fully governed POST

```ts
await runtime.post(
  `/api/admin/mobile/qa/${item.id}/approve`,
  {},
  {
    idempotencyKey: `qa-decision:${item.id}:approve`,
    // capability: 'payment' would attach here if this POST dispatched money.
    // Not applicable for QA approve (state-machine transition only).
  },
);
```

Behaviour:
1. **token-prime** — ensures the AsyncStorage token cache is hydrated
   before the request descriptor is built (Probe 5, P0 #2).
2. **auth-expired** — wraps the call; if 401 lands, fires
   `adapter.onAuthExpired()` and does not retry against stale token.
3. **dedup** — if the same `qa-decision:<id>:approve` is already inflight
   (user double-tapped), the second call inherits the first response.
   Emits `dedup_hit` telemetry.
4. **capability-gate** — no `capability` set; soft-passes.
5. **retry** — on transient network failure, retries with the same
   idempotency-key header. Backend's idem store collapses duplicates.

Result: at most ONE state-machine transition lands, regardless of:
- double-click,
- network blip,
- background suspend mid-request,
- stale token,
- focus-restore tick overlap.

This is what "governed operational runtime" looks like as a single
request envelope.

---

## How to read this matrix during a code review

When a PR adds a new runtime call:

1. Which cells does this call touch?
   - "It's a POST" → cells A (retry) + B (dedup) + C (idem if key passed).
   - "It's inside `useAppStatePolling`" → add cell D (focus).
   - "It needs auth" → add cell E.
2. For every pair of touched cells, look up the grid above. 🟢 = no
   action. ⚠ = read the doctrine note. 🔴 = the PR MUST include a test
   or a justification.
3. If the PR introduces a NEW primitive (e.g. a new middleware), extend
   the grid: a 6th row + 6th column with all five existing primitives.

The matrix is a living artefact. When you add a row, write the doctrine
note FIRST, then the middleware.

---

## What is intentionally NOT in this matrix

These are NOT runtime substrate primitives and MUST NOT be added as cells:

- **Optimistic mutations** — view-model concern, not transport.
- **Cache invalidation** — view-model concern.
- **Suspense / streaming** — render concern.
- **Toast rendering** — UI concern.
- **Navigation on error** — caller concern (auth-expired listener is the
  ONLY exception: it dispatches `auth:expired` event and the auth-gate
  decides where to send the user).

Keep this matrix to the transport-and-lifecycle layer. The whole point
of the platform separation is that the UI doesn't know any of these
cells exist.
