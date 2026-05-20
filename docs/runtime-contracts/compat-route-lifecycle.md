# Compat-Route Lifecycle

**Frozen contract.** Owners: `backend/compat_routes.py` (alias router) and
`backend/middleware/compat_observability.py` (decorator).

The compat layer is a **temporary, observable** alias surface that lets the
UI keep using legacy URLs while we migrate page-by-page. It exists to make
migration **safe**, not to live forever.

## Rules of the compat layer (frozen)

1. **One file** holds all aliases (`backend/compat_routes.py`). No business
   logic — only forwarding.
2. **Every alias is documented** with a header comment in the form
   `# COMPAT: <legacy_path> → <canonical_path>`.
3. **Every alias is wrapped** with `@compat_decorator(canonical=...)`.
4. **Forwarding is internal** — `_forward()` issues a localhost call to the
   canonical handler and propagates auth + `x-request-id`.
5. The compat router is mounted **after** all canonical routers in `server.py`.

A handler that does business logic inside a compat alias is a contract
violation. Move the logic to the canonical handler and forward.

## Response contract (frozen)

Every compat response carries two response headers:

| Header | Value | Meaning |
|--------|-------|---------|
| `x-compat-route` | `true` | This response was served via the compat layer. |
| `x-canonical-path` | e.g. `/api/admin/mobile/finance` | The canonical URL the UI should migrate to. |

Both header names are exposed via CORS (`expose_headers` in `server.py`).
The runtime-client reads them and reports `fromCompatRoute` + `canonicalPath`
on `ApiResponse`.

## Observability contract (frozen)

Every compat hit emits exactly one structured log line on the `compat` logger:

```jsonc
{
  "type":       "compat_route_used",
  "legacy":     "/api/admin/finance",
  "canonical":  "/api/admin/mobile/finance",
  "request_id": "a3f9...",
  "user_id":    "user_71e3...",          // best-effort
  "status":     200
}
```

This single line is the **data source** for migration heatmaps. Don't add
business fields here; keep it grep-able.

## UI contract (frozen)

The runtime-client telemetry middleware fires:

- `request_completed` — every request.
- `compat_route_hit` — additional event when `x-compat-route` is set,
  carrying the canonical path the UI should switch to.

Both surfaces (web + Expo) MUST forward these events to a sink so the data
heatmap can be built. The web sink is `runtime/index.ts::onTelemetry`.

## Lifecycle of a single alias

```
Stage 0 — UI uses legacy path. No compat alias yet. Returns 404.
Stage 1 — Compat alias added with @compat_decorator → migration-aware 200.
Stage 2 — UI page migrated to canonical path. Compat traffic on this alias drops.
Stage 3 — Heatmap shows ≤ 1 hit / 24h for ≥ 7 days.
Stage 4 — Alias removed. Pre-removal: confirm zero traffic.
```

### Removal checklist (frozen)

Before removing an alias:

1. ✅ All UI surfaces (web + Expo) call the canonical path.
2. ✅ Compat heatmap shows ≤ 1 hit per 24h for the past 7 days.
3. ✅ A search of the codebase (`grep -r '/legacy/path'`) returns zero hits
   in `web/src` and `frontend/`.
4. ✅ A staging release with the alias removed passes the smoke suite.

Only after **all four**: delete the alias from `compat_routes.py` and the
matching `# COMPAT:` header.

## Adding a new alias

A new alias is added when:

- A canonical handler moves to a new path AND
- We can't redeploy the UI in lockstep.

Procedure:

1. Add the canonical handler at the new path.
2. Add the alias in `compat_routes.py` with `@compat_decorator(canonical=...)`.
3. Document the migration in `compat_routes.py` under a `# COMPAT:` header.
4. Open a tracking item with the planned removal date (default: 30 days).

## Anti-patterns (forbidden)

| ❌ Don't | ✅ Do |
|---------|------|
| Put business logic inside the alias. | Move it to the canonical handler; alias forwards. |
| Manually pick "top routes to migrate". | Use the compat heatmap (data-driven). |
| Migrate aliases en masse without telemetry. | Migrate one page → confirm heatmap drop → next page. |
| Leave aliases without a planned removal date. | Always log a tracking item. |
| Skip the `@compat_decorator`. | Every alias must be observable. |

## Migration policy

- Adding aliases: routine; no contract change.
- Removing aliases: routine, follow the checklist above.
- Changing header names (`x-compat-route` / `x-canonical-path`): **frozen**.
  Bump runtime-client TS types if you ever change them.
