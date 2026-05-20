# ATLAS DevOS — Web client (React CRA + craco + Tailwind)

This is the customer-facing web platform (client / developer / admin surfaces).
It is served by the FastAPI backend under `/api/web-ui/*` so Kubernetes can
proxy the whole app with a single rule (`/api/* → backend`).

## Paths that matter

| Path | Purpose |
|------|---------|
| `src/` | React source. Pages in `src/pages/`, shared UI in `src/components/`. |
| `build/` | Compiled bundle served by FastAPI. Produced by `yarn build`. |
| `.env.example` | Env vars needed for a production build. Copy to `.env`. |

## Key screens (ATLAS DevOS layer)

| Route | File | Backend endpoint |
|-------|------|------------------|
| `/client/costs` | `pages/ClientCosts.js` | `GET /api/client/costs` |
| `/client/operator` | `pages/ClientOperator.js` | `GET /api/client/operator` |
| `/client/project/:id/workspace` | `pages/ClientWorkspace.js` | `GET /api/client/project/{id}/workspace` |

## Build

```bash
cd web
cp .env.example .env
yarn install --network-timeout 600000
yarn build          # → build/ (served by FastAPI at /api/web-ui/)
```

The FastAPI handler picks up `/app/web/build` automatically (see
`WEB_BUILD_DIR` env / default in `backend/server.py`).

## Dev server (optional)

```bash
yarn start
```

By default this opens on :3000 — but in this project :3000 is already taken by
the Expo Metro bundler. Use a build + FastAPI loop instead (easier):

```bash
yarn build && sudo supervisorctl restart backend
```

## Architecture

- **CRA 5** via `craco` (aliases `@ → src`)
- **Tailwind 3** + `@radix-ui/*` for primitives
- React Router v7 with `basename={process.env.PUBLIC_URL}`
- Auth is cookie-based (`withCredentials: true`) against `/api/auth/*`
