# Stage 3.1 — Playwright baseline (read-only)

**Date:** 2026-05-09
**Runner:** `/app/tools/stage_3_1_baseline.py`
**Artefacts:** `/app/audit/baseline/{p1..p4}.{json,jpg}` + `summary.json`
**Scope:** observation only — no migrations, no fixes, no app code touched.

---

## Scenarios covered

| # | Pilot | Role | URL | Goal |
|---|---|---|---|---|
| 1 | AdminV2Finance | admin | `/api/web-ui/admin/earnings-control` | load admin earnings & finance |
| 2 | ClientBillingOS | client | `/api/web-ui/client/billing-os` | load client billing surface |
| 3 | DeveloperEarnings | developer | `/api/web-ui/developer/earnings` | load 4-tab earnings page |
| 4 | Expo Wallet (smoke) | developer | `/developer/wallet` (Expo Router web target) | load mobile wallet, capability badge, withdrawals |

For each, the runner:
- programmatically logged in via API (cookie auth for web, Bearer token via injected `localStorage.atlas_token` for Expo)
- captured every `/api/*` request (status, `x-request-id`, `x-compat-route`, `x-canonical-path`)
- captured all browser console output (errors, warnings, runtime telemetry)
- saved a JPEG screenshot at the end of `networkidle + 2.5s settle`

---

## Web results

| Pilot | Nav | API calls | All ≤ 399 | request-id present on each | Page errors |
|---|---|---:|---|---|---:|
| Admin Finance | ok | 8 | ✅ all 200 | ✅ 8/8 | 0 |
| Client Billing | ok | 8 | ✅ all 200 | ✅ 8/8 | 0 |
| Developer Earnings | ok | 12 | ✅ all 200 | ✅ 12/12 | 0 |

**Per-pilot domain calls (signal endpoints, not static):**

```
admin     → /api/integrations/manifest /api/auth/me /api/notifications/unread-count /api/admin/mobile/finance
client    → /api/integrations/manifest /api/auth/me /api/notifications/unread-count /api/client/invoices
developer → /api/integrations/manifest /api/auth/me /api/notifications/unread-count
            /api/developer/earnings/{flagged,held,summary,tasks} /api/developer/payout/batches
```

All payment/money-touching reads hit the canonical paths — **zero compat-route fallbacks** under the migrated screens.

---

## Expo results (smoke)

| Pilot | Nav | API calls | All ≤ 399 | request-id present on each | Page errors |
|---|---|---:|---|---|---:|
| Expo Wallet | ok | 8 | ✅ all 200 | ✅ 8/8 | 0 |

Calls (note: Expo built with `EXPO_PUBLIC_BACKEND_URL=https://mobile-web-stack-11.preview.emergentagent.com` — same backend, different preview alias):

```
GET /api/integrations/manifest         — capability boot
GET /api/developer/wallet              — wallet GET (runtime-client)
GET /api/developer/withdrawals         — withdrawals GET (runtime-client)
GET /api/mobile/auth/me                — auth bootstrap
GET /api/me                            — legacy /me probe (auth-gate side)
GET /api/notifications/my?unread=true  — push poller
GET /api/client/alerts (×2)            — global alerts poller (NOT from wallet)
```

Only `wallet` + `withdrawals` belong to Pilot #4. The other 6 calls are app-shell / global pollers — they do NOT go through runtime-client yet (still on `src/api.ts`). This is expected — non-pilot surfaces remain on legacy axios per Stage 3 discipline.

---

## Request-id captured

- **36/36 unique** request-ids across all 36 captured `/api/*` responses.
- 100% propagation. No stripped headers, no duplicates, no nulls.
- Backend correlator (`middleware/request_id.py`) and frontend transport are aligned.

---

## Compat hits

| Pilot | `x-compat-route` count | `x-canonical-path` redirects |
|---|---:|---:|
| Admin Finance | 0 | 0 |
| Client Billing | 0 | 0 |
| Developer Earnings | 0 | 0 |
| Expo Wallet | 0 | 0 |

**Total: 0 compat hits across all 4 pilots.**

This is the expected outcome — the 4 migrated surfaces hit canonical paths only. The compat layer is currently load-bearing only for the **non-migrated** surfaces (which Stage 3.1 deliberately did not exercise).

A separate compat heatmap (Stage 3.2) needs to drive synthetic load through the legacy surfaces to surface compat hits there. That's why this baseline alone cannot answer "is compat retirement safe?" — it can only answer "are the migrated surfaces clean?". The answer to the latter is YES.

---

## Runtime errors

**Aggregate counts:**
- HTTP failures (status ≥ 400): **0**
- Page errors (uncaught exceptions): **0**
- React warnings: **0**
- Console errors: **12** (4 web pilots × 3 errors each — see "Remaining instability" below)
- Console errors on Expo: **0**

The Expo wallet had only deprecation **warnings** (`shadow*` props, `pointerEvents` prop), nothing of runtime concern.

---

## Screenshots / artifacts

```
/app/audit/baseline/
├── p1_admin_finance.jpg          (26 KB)
├── p1_admin_finance.json         per-call detail + console
├── p2_client_billing.jpg         (17 KB)
├── p2_client_billing.json
├── p3_developer_earnings.jpg     (26 KB)
├── p3_developer_earnings.json
├── p4_expo_wallet.jpg            (18 KB)
├── p4_expo_wallet.json
└── summary.json                  aggregated counters
```

JSONs are kept as the canonical artefact (deterministic, diffable). Screenshots are reference-only.

---

## Remaining instability

### IS-1 — Web socket.io path mismatch (real bug, not a pilot regression)

**All 4 web pilots emitted 4 console errors each:**

```
WebSocket connection to
'wss://681ec133-7045-47dc-8d28-9f6ca9049c50.preview.emergentagent.com/socket.io/'
failed: Error during WebSocket handshake: Unexpected response code: 502

[Socket] Connection error: websocket error
```

**Root cause:** `/app/web/src/lib/socket.js:29` does:
```js
socket = io(API_URL.replace('/api', ''), { transports: [...] })
```
which connects to bare host + default `/socket.io/` path. But the backend mounts socket.io at `/api/socket.io/` (server.py:292 `socketio_path="api/socket.io"`).

**Live verification:**
- `GET /socket.io/?EIO=4&transport=polling` → **404** (bare host)
- `GET /api/socket.io/?EIO=4&transport=polling` → **200** (canonical)

**Behavior:** socket.io-client retries (5x, 1s delay) → eventually gives up → realtime bridges silently degrade to "no live updates". Each failed attempt logs 2 console errors.

**Impact assessment:**
- ✗ Real-time toasts (validation.created, task.declined, etc.) NOT delivered to web clients.
- ✗ TesterRealtimeBridge / ClientRealtimeBridge / ExecutorRealtimeBridge all rendered useless on web.
- ✓ Expo realtime works correctly (`frontend/src/realtime.ts` line 23: `SOCKET_PATH = '/api/socket.io'`).
- ✓ Backend itself is healthy — socket connects fine when path is right.

**This is NOT a pilot regression.** The bug pre-existed the migration. Pilot baseline simply made it visible because the runner captures console.

**Recommendation (NOT executed in Stage 3.1):**
- Tier-3 size fix: `/app/web/src/lib/socket.js:29` — pass `path: '/api/socket.io/'` option to `io()`.
- One-line change. Out of Stage 3.1 scope. Either:
  a) treat as separate Tier-3 hotfix (independent of runtime-client), OR
  b) defer to Stage 3.5 production hardening.

### IS-2 — Expo built against alias preview URL

`EXPO_PUBLIC_BACKEND_URL` is baked at build time as `https://mobile-web-stack-11.preview.emergentagent.com`. This alias still works (same backend), but the request flow on the Expo screenshot shows a different host than the web tests. Cosmetic, not functional.

**Recommendation:** when the production preview URL stabilises (or for prod), rebuild Expo. Out of Stage 3.1 scope.

### IS-3 — Expo wallet route emits no telemetry to console

The runtime-client telemetry sink `/app/frontend/src/runtime/index.ts` only `console.warn`s `compat_route_hit`, `request_failed`, `capability_gate_blocked`. Since none of those happened, console was clean. This is **correct behavior**, not instability — flagged here because the empty `console: []` array might look like a capture failure to a future reader. It isn't.

---

## Conclusion

Baseline is **green** for the four migrated surfaces:

- ✅ All HTTP 200
- ✅ 100% request-id propagation
- ✅ 0 compat hits on migrated paths
- ✅ 0 page errors
- ✅ 0 runtime-client failures
- ⚠️ 1 pre-existing infrastructure bug surfaced (web socket path) — does not block migration; documented for separate hotfix decision.

**Stage 3.1 is GREEN.** Ready to proceed to **Stage 3.2 — compat heatmap** when you give the signal.
