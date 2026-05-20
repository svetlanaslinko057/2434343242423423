# IS-1 Hotfix — Socket.IO Path Mismatch — DONE

**Date:** May 9, 2026
**Scope:** Sub-narrow per directive — only `/app/web/src/lib/socket.js`.
**Mode:** Surgical 1-option fix on the web client. **Zero changes** to backend, auth, Expo, namespaces, reconnect policy, event names, telemetry, or shared abstractions.

---

## Root cause (confirmed wire-level)

`socket.io-client` defaults to `path: '/socket.io/'`. The backend mounts Socket.IO at `/api/socket.io/` (`server.py:292`: `socketio_path="api/socket.io"`) to match the Kubernetes ingress that proxies only `/api/*` to the backend service.

Wire-level baseline (BEFORE fix):

| Path | Direct (localhost:8001) | External (Cloudflare ingress) |
|---|---|---|
| `/socket.io/?EIO=4` | **HTTP 404** | **HTTP 404** |
| `/api/socket.io/?EIO=4` | HTTP 200 | HTTP 200 |

The web client was hitting the 404 path → silent realtime degrade. Expo client (`frontend/src/realtime.ts`) was already using the correct path, so mobile was unaffected.

---

## Change applied

Single addition to `io()` options in `web/src/lib/socket.js:29`:

```diff
   socket = io(API_URL.replace('/api', ''), {
+    // IS-1 hotfix (Stage 3.5/B): backend mounts Socket.IO at
+    // `/api/socket.io/` (server.py: socketio_path="api/socket.io") to match
+    // the Kubernetes ingress that only proxies `/api/*` to the backend.
+    // Without this `path` override the client defaults to `/socket.io/` and
+    // never reaches the backend through the ingress — silent realtime
+    // degrade. Expo client (frontend/src/realtime.ts) already uses the
+    // correct path; only the web client needed this fix.
+    path: '/api/socket.io/',
     transports: ['websocket', 'polling'],
     withCredentials: true,
     reconnection: true,
     reconnectionAttempts: 5,
     reconnectionDelay: 1000,
   });
```

Followed by `yarn build` of `/app/web` (new bundle: `main.c13851b2.js` — old: `main.da323de9.js`).

---

## Acceptance criteria — all PASS

| Probe | Expected | Actual |
|---|---|---|
| `/socket.io/?EIO=4...` no longer used by web | yes | ✅ 0 hits captured during dashboard load |
| `/api/socket.io/?EIO=4...` returns 200 | 200 | ✅ both internal and external |
| Browser console socket errors | 0 | ✅ 0 errors |
| Page errors (RedBox / Uncaught) | 0 | ✅ 0 |
| Reconnect loop stable | yes | ✅ no reconnect storm during 5s observation |
| Expo realtime unaffected | yes | ✅ untouched (`frontend/src/realtime.ts` not modified) |
| Backend logs show websocket connects | yes | ✅ `[Socket] Connected: 86Qs7AhbUXMJht_vAAAB` |
| No compat regression | 0 | ✅ Stage 3.2.5 parity probes still pass (re-verified) |

### Concrete verification snapshot

After login as `john@atlas.dev` and navigation to `/api/web-ui/developer/dashboard`:

- Sidebar shows green **"Live"** indicator (driven by socket connection state)
- Console output:
  ```
  [Socket] Connected: 86Qs7AhbUXMJht_vAAAB
  ```
- 0 entries matching `/socket.io/` (legacy default path) in network log
- Dashboard rendered cleanly: earnings, modules, rating widgets, all action cards
- 0 Uncaught/page errors, 0 socket-related console errors

---

## What was NOT touched (scope discipline)

- ✅ Backend Socket.IO mount — `server.py:292` unchanged
- ✅ Auth handshake (`authenticate` event flow) — unchanged in both client and server
- ✅ Reconnect policy — same `reconnection: true, attempts: 5, delay: 1000`
- ✅ Event names — `connect`, `disconnect`, `connect_error`, `authenticate`, `join`, `leave` — all unchanged
- ✅ Namespace structure — unchanged (no namespace refactor)
- ✅ Expo realtime client (`frontend/src/realtime.ts`) — untouched (already correct)
- ✅ Telemetry — no new logging/metrics added
- ✅ "Improvements" — none. No abstraction, no refactoring of getSocket/authenticateSocket/joinRooms/leaveRooms.
- ✅ Stage 3.2.5 canonical endpoints — unaffected; probes re-verified PASS
- ✅ Group A codemod — NOT mixed in (per directive)
- ✅ IS-5 dead duplicates — NOT touched (saved for C)

---

## Files changed (full diff scope)

```
modified:   web/src/lib/socket.js                   (+9 lines, 1 option added)
new file:   web/build/static/js/main.c13851b2.js    (rebuild artifact)
new file:   audit/parity/IS_1_SOCKET_HOTFIX.md      (this report)
```

The `web/build/*` rebuild also contains 9 stale chunks from previous build that were superseded — these are normal CRA artifacts, not behavior changes.

`/app/backend`, `/app/frontend`, `/app/web/src/**` (other than the one file) — clean.

---

## Updated execution plan

| # | Step | Status |
|---|---|---|
| 1 | D2 instrumentation | ✅ DONE |
| 2 | D3 Stage 3.3 codemod (initial attempt) | ⚠️ DEFERRED with finding |
| 2.5 | Stage 3.2.5 Canonical Parity Creation | ✅ DONE |
| **B** | **IS-1 Socket.IO hotfix** | ✅ **DONE (this report)** |
| **C** | **IS-5 Dead duplicate cleanup** | ⏳ **next per A→B→C** |
| 3 | Re-run heatmap | ⏳ after C |
| 4 | Stage 3.3 codemod (Group A — now safe) | ⏳ |
| 5 | Observation window | ⏳ |
| 6 | Group B | ⏳ |
| 7 | Auth pilot | ⏳ |
| 8 | Group C | ⏳ |
| 9 | compat retirement | ⏳ |

Per your directive: **B done, going into C — IS-5 dead duplicate cleanup** in `mobile_adapter.py` (the two unreachable handlers for `/client/opportunities` and `/client/revenue-timeline` that are shadowed by `revenue_brain`).
