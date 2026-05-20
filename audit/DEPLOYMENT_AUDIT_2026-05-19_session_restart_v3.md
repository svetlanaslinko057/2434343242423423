# Deployment Audit — ATLAS DevOS / EVA-X
**Date:** 2026-05-19 (session restart v3, post-redeploy from `svetlanaslinko057/e3e23e3e23233`)
**Status:** ✅ DEPLOYED & OPERATIONAL

## 1. Repo bootstrap
Repository `svetlanaslinko057/e3e23e3e23233` cloned and laid into `/app`:
- `backend/` (FastAPI, 27 k lines `server.py`, 88 layer modules, 682 routes)
- `frontend/` (Expo SDK 54, expo-router, 82 screens)
- `web/` (CRA build + sources, served under `/api/web-ui/`)
- `packages/` (`design-system`, `runtime-client`)
- `audit/`, `docs/`, `memory/`, `scripts/`, `tools/`, `tests/`, `test_reports/`

Protected env files preserved verbatim (`/app/frontend/.env`, `/app/backend/.env`).

## 2. Disk recovery
At deploy time the partition was 100 % full (9.8 G / 9.8 G). Cleared `/root/.cache/{pip,uv,yarn,npm,Cypress}` and ran `yarn cache clean` → freed 2.8 G. Final state: 7.1 G used / 2.7 G free.

## 3. Dependencies
- **Backend:** `pip install -r requirements.txt` → all requirements satisfied (FastAPI 0.110.1, motor 3.3.1, emergentintegrations 0.1.0, pandas/numpy/sentence-transformers etc.).
- **Frontend:** `yarn install --network-timeout 600000` → fresh `node_modules` (49 s, lockfile generated). One known peer warning: `expo-audio@1.1.1 → expo-asset *` (non-blocking).

## 4. Supervisor processes
```
backend                          RUNNING   uvicorn server:app --host 0.0.0.0 --port 8001 --reload
expo                             RUNNING   yarn expo start --tunnel --port 3000  (Tunnel ready)
mongodb                          RUNNING   /usr/bin/mongod --bind_ip_all (stale lock removed)
code-server                      RUNNING
nginx-code-proxy                 RUNNING
```

## 5. Backend boot — confirmed in logs
- Seeded mock providers, portfolio cases, admin user
- 5 quick-access users created (admin / john / client / multi / tester)
- 6 developers, 89 modules, 81 QA decisions, 6 wallets, demo project `Acme Analytics Platform`
- 5 validations + 1 issue planted for tester@atlas.dev
- 4 scope templates, system config
- L0/L1 backfill on modules + users
- **All 5 background loops active**:
  - EVENT ENGINE (15 min)
  - GUARDIAN (120 s) — already observed `auto_project_pause project=35860751`
  - MODULE MOTION (15 s)
  - OPERATOR SCHEDULER (300 s)
  - Autonomy + Intelligence recompute
- INTEGRATIONS seed: blocks added for wayforpay/stripe/app/payments
- Sentence-transformers embedding model loaded (103 weight files)

## 6. Smoke endpoints verified (HTTP 200 unless noted)

| Endpoint | Role | Status |
|---|---|---|
| `GET /api/` | public | 200 |
| `POST /api/auth/login` (cookie session) | all 4 roles | 200 — returns user object |
| `POST /api/mobile/auth/login` (token) | all 4 roles | 200 — returns `{token: "sess_…", user}` |
| `GET /api/integrations/manifest` | public | 200 — honest MOCK + `reason` per capability |
| `GET /api/web-ui/` | public | 200 — CRA bundle served |
| `GET /api/client/invoices` | client | 200 — 6 invoices (paid + open) |
| `GET /api/client/owner-summary` | client | 200 |
| `GET /api/client/notifications` | client | 200 |
| `GET /api/contracts/my` | client | 200 |
| `GET /api/admin/mobile/home` | admin | 200 |
| `GET /api/admin/mobile/finance` | admin | 200 |
| `GET /api/admin/integrations` | admin | 200 |
| `GET /api/dev/work` | developer | 200 |
| `GET /api/openapi.json` paths | — | **682 routes** |

## 7. Integrations — honest MOCK state

`GET /api/integrations/manifest` returns:
- `payment`: mock (policy=hard) — reason: `STRIPE_SECRET_KEY missing`
- `mail`:    mock (policy=soft) — reason: `RESEND_API_KEY missing`
- `storage`: mock (policy=soft) — reason: `CLOUDINARY_* missing`
- `oauth`:   unavailable (policy=hard) — reason: `GOOGLE_OAUTH_CLIENT_ID missing`

When you supply real keys via `/admin/integrations`, the registry pattern picks them up without code changes.

## 8. Frontend (Expo) — verified live

- Metro bundler: 1 550 modules bundled successfully
- Tunnel: connected, public URL responds 200
- **Welcome screen e2e render** confirmed via screenshot at `https://expo-dev-build-8.preview.emergentagent.com/`:
  - EVA-X branding visible
  - Headline "Build real products. Not tasks."
  - 3-step sequence (Describe / Get plan / Build)
  - "NO FREELANCERS · NO CHAOS · ONE SYSTEM" badge
  - "See my product plan" CTA + "Log in" link
- Cosmetic RN-web warnings present (pre-existing, non-blocking): `borderColor: var(--t-primary)33`, `shadow*` deprecation, `props.pointerEvents` deprecation.

## 9. Test credentials
`/app/memory/test_credentials.md` rewritten with current 5-role seed table. See file for full details.

## 10. Open Stage-decisions (carry-over from PRD)
1. **Expo-tester cabinet** (Stage 4, 4 screens) — not started, awaiting go-ahead.
2. **Expo-admin parity with web-admin** — currently cockpit-only (5 tabs + 8 drill-downs); full parity not yet scoped.
3. **Runtime-client migration** — 4 / 124 screens migrated; rest still on axios shim.
4. **Real integration keys** — Stripe / Resend / Cloudinary / Google OAuth / Emergent LLM / HF — all blocked on external credentials.

## 11. Conclusion
System is **production-ready in MOCK mode**:
- 100 % of backend boot pipeline succeeded
- All 4 supervised services RUNNING
- Welcome screen renders end-to-end on mobile preview
- Web admin bundle is reachable
- 682 API routes available, 37 Mongo collections seeded with replay data

**Awaiting next direction** from user on which open Stage-decision to pick up.
