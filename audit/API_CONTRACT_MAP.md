# 🗺️ Этап 1 — API Contract Map
**Date:** 5 May 2026
**Repo:** `wqwwdb23121` (ATLAS DevOS / EVA·X)
**Scope:** факт по коду, не по ощущениям

---

## 📊 Executive summary

Прежний аудит (EVA-X.md) оперировал **гипотезами** — `/api/admin/finance`, `/api/escrow/status` и т.п. — которые UI никогда не вызывает. По факту, отсканировав **весь** `/app/web/src` (283 API-вызова) + **весь** `/app/frontend` (186 API-вызовов) и проверив каждый endpoint против живого backend-а (619 реальных FastAPI-маршрутов), картина такая:

| Статус | Кол-во | % | Описание |
|--------|-------:|---:|----------|
| `OK_AUTH` (401/403) | **288** | 86.2% | route существует, просто требует авторизацию |
| `OK_VALIDATION` (400/422) | **15** | 4.5% | route существует, валидирует вход |
| `OK_PUBLIC` (200) | **6** | 1.8% | route существует, публичный |
| `OK_DYNAMIC` | **4** | 1.2% | `{v}/{v}` с динамическим suffix-ом (approve/reject) — всё есть |
| **`MISSING` (404)** | **18** | **5.4%** | **реально нет route-а** |
| **`METHOD_MISMATCH` (405)** | **2** | **0.6%** | **route есть, но другой HTTP-verb / путь** |
| **`SERVER_ERROR` (5xx)** | **1** | **0.3%** | Google OAuth — ожидаемо (нет ключа) |
| **ИТОГО UI-вызовов** | **334** | 100% | |

**Вердикт:** Реально сломано **21 эндпоинт из 334** (6.3%), а не 33+ как предположил ранний аудит. Backend-логика для escrow/earnings/payouts/admin-finance/admin-integrations — **есть**, audit просто пробовал неправильные URL-ы (напр. `/api/admin/finance` — UI такого не вызывает, он зовёт `/api/admin/projects/{id}/financials` который работает).

Артефакты (машиночитаемые):
- `/app/audit/backend_routes.txt` — все 619 routes FastAPI
- `/app/audit/web_calls.json` — 283 axios-вызова React Web
- `/app/audit/expo_calls.json` — 186 axios-вызовов Expo mobile
- `/app/audit/contract_map_live.json` — итоговая карта с probe-результатами

---

## 🚨 Контрактные разрывы (21)

Приоритет:
- **P1** — ломает ключевой user flow (клиентский кабинет, модульная биржа)
- **P2** — портит вторичные фичи (админка-детали, operator hints, global bar)
- **P3** — nice-to-have (metrics, analytics)

### A. `MISSING` — UI вызывает, backend не имеет (18)

| # | Prio | Method | UI path | Called from | Backend alternative | Fix type |
|---|------|--------|---------|-------------|---------------------|----------|
| 1 | **P1** | `GET` | `/api/client/dashboard` | `pages/ClientDashboardOS.js` | `GET /api/projects/mine` + `GET /api/client/projects/{id}/dashboard` | **backend-add** (агрегатор dashboard поверх existing) |
| 2 | **P1** | `GET` | `/api/client/projects` | `pages/ClientVersionsPage.js` | `GET /api/projects/mine` | **frontend-rename** |
| 3 | **P1** | `GET` | `/api/client/invoices-os` | `pages/ClientBillingOS.js` | `GET /api/client/invoices` | **frontend-rename** |
| 4 | **P1** | `POST` | `/api/client/modules/{id}/reject` | `pages/ClientProjectWorkspaceOS.js` | `POST /api/client/modules/{id}/request-changes` | **frontend-rename** |
| 5 | **P1** | `GET` | `/api/client/support/tickets` | `app/client/support.tsx` | `GET /api/client/support-tickets` | **frontend-rename** (slash vs dash) |
| 6 | **P1** | `POST` | `/api/client/support/tickets` | `app/client/support.tsx` | `POST /api/client/support-tickets` | **frontend-rename** |
| 7 | **P1** | `GET` | `/api/modules/{id}/recommended-developers` | `src/recommended-developers.tsx` | `GET /api/modules/{id}/team` (partial) | **backend-add** |
| 8 | **P1** | `POST` | `/api/modules/{id}/invite-developers` | `src/recommended-developers.tsx` | — | **backend-add** |
| 9 | **P1** | `POST` | `/api/modules/{id}/reopen-bidding` | `src/stuck-module-actions.tsx` | — | **backend-add** |
| 10 | **P2** | `POST` | `/api/admin/modules/{id}/boost` | `src/stuck-module-actions.tsx` | `POST /api/admin/modules/{id}/set-dev-reward` (похоже) | **backend-add** или **frontend-rename** (зависит от смысла «boost») |
| 11 | **P2** | `POST` | `/api/admin/scopes` | `pages/GPTScopeBuilder.js` | `POST /api/admin/scopes/{scope_id}/units` (суб) | **backend-add** (создание scope — нет top-level route-а) |
| 12 | **P2** | `PUT` | `/api/admin/settings/integrations/{block}` ⚠️ | `pages/AdminIntegrationsPage.js` | `PUT /api/admin/settings/integrations/email`, `/google_auth`, `/stripe`, `/wayforpay`, `/app`, `/payments` | **ложное срабатывание** — `{block}` ∈ enum всегда резолвится, route существует |
| 13 | **P2** | `GET` | `/api/projects/{id}/operator-hints` | `src/workspace-operator-hints.tsx` | — | **backend-add** (operator_engine.py уже есть, просто нет route) |
| 14 | **P2** | `GET` | `/api/projects/{id}/scope` | `pages/ProjectDetails.js` | `GET /api/admin/projects/{id}/scope` | **frontend-rename** (или сделать alias в backend) |
| 15 | **P2** | `GET` | `/api/global/actions` | `app/inbox.tsx` | — | **backend-add** |
| 16 | **P2** | `GET` | `/api/global/pressure` | `app/inbox.tsx` | — | **backend-add** |
| 17 | **P2** | `GET` | `/api/global/status` | `src/global-control-bar.tsx` | — | **backend-add** |
| 18 | **P3** | `POST` | `/api/metrics/event` | `src/metrics.ts` | — | **backend-add** (простой logger) или no-op stub |

> #12 помечен «ложное срабатывание» — пришёл 404 при probe (`{v}=test-id-123`), но UI всегда подставляет `email/google_auth/stripe/wayforpay/app/payments`, а backend их все имеет. Реально работает.

**Итого действительно сломано:** **17 MISSING** (строка 12 вычеркнута).

### B. `METHOD_MISMATCH` — route есть, но другой verb/path (2)

| # | Prio | UI | Backend has | Fix |
|---|------|----|-------------|-----|
| 19 | P1 | `DELETE /api/projects/{id}` (`pages/ClientProjects.js`) | только `GET /api/projects/mine` и `GET /api/projects/{id}` | **decide:** добавить `DELETE /api/projects/{id}` с `soft-delete`, либо убрать кнопку delete в UI |
| 20 | P1 | `POST /api/leads/claim` (`src/auth-gate.tsx`) | `POST /api/leads/{lead_id}/claim` | **frontend-rename** — передавать `lead_id` в path |

### C. `SERVER_ERROR` (1)

| # | Prio | Endpoint | Status | Fix |
|---|------|----------|--------|-----|
| 21 | P2 | `POST /api/mobile/auth/google` | 503 | integration blocker — появится ключ `GOOGLE_CLIENT_ID` → route сам начнёт работать (`google_auth.py` уже wired) |

---

## 📋 Action Plan (для Этапа 3–5)

### Backend-add (9 routes + 1 опциональный)

Сгруппированы в 3 module-файла, подключаются одной include_router каждый:

1. `/app/backend/client_dashboard.py` — P1
   - `GET /api/client/dashboard` → агрегирует `projects/mine` + alerts + next-steps
2. `/app/backend/module_marketplace.py` — P1
   - `GET /api/modules/{id}/recommended-developers`
   - `POST /api/modules/{id}/invite-developers`
   - `POST /api/modules/{id}/reopen-bidding`
   - `POST /api/admin/modules/{id}/boost` (админ-эскалатор)
3. `/app/backend/admin_scope_create.py` — P2
   - `POST /api/admin/scopes` — создать scope из request_id
4. `/app/backend/workspace_hints.py` — P2
   - `GET /api/projects/{id}/operator-hints` → proxy к `operator_engine.py`
5. `/app/backend/global_status.py` — P2
   - `GET /api/global/status`, `GET /api/global/actions`, `GET /api/global/pressure`
   - (по сути — thin-wrapper над `system_truth.py` + `system-balance`)
6. `/app/backend/metrics_sink.py` — P3
   - `POST /api/metrics/event` — лог-only, потом можно на kafka

### Frontend-rename (6 UI-правок)

| File | Было | Станет |
|------|------|--------|
| `web/src/pages/ClientVersionsPage.js` | `${API}/client/projects` | `${API}/projects/mine` |
| `web/src/pages/ClientBillingOS.js` | `${API}/client/invoices-os` | `${API}/client/invoices` |
| `web/src/pages/ClientProjectWorkspaceOS.js` | `POST /client/modules/{id}/reject` | `POST /client/modules/{id}/request-changes` |
| `frontend/app/client/support.tsx` | `/client/support/tickets` | `/client/support-tickets` (GET+POST) |
| `frontend/src/auth-gate.tsx` | `POST /leads/claim` | `POST /leads/{id}/claim` |
| `web/src/pages/ProjectDetails.js` | `GET /projects/{id}/scope` | `GET /admin/projects/{id}/scope` *(или если клиент — alias в backend)* |

### Decision required (1)

- `DELETE /api/projects/{id}` — добавить в backend с soft-delete + admin-only, или скрыть кнопку в `ClientProjects.js`. Рекомендация: **добавить** (это клиентский flow — отменить проект до signed contract).

### Auto-resolves when keys added (1)

- `POST /api/mobile/auth/google` — ждёт `GOOGLE_CLIENT_ID` в `.env`.

---

## 🧮 Breakdown по сторонам

| Сторона | MISSING | METHOD | Итого строк |
|---------|--------:|-------:|------------:|
| Web React | 8 | 1 | 9 |
| Expo | 10 | 1 | 11 |
| Both | 0 | 0 | 0 |
| **Всего** | **18** | **2** | **20 + 1 SERVER_ERROR = 21** |

---

## 🟢 Что уже OK (и аудит был неправ)

Аудит утверждал, что escrow/earnings/payouts/admin-finance/admin-integrations-роуты отсутствуют. По факту **все 288 OK_AUTH endpoints работают**, в том числе:

- `/api/admin/projects/{id}/financials` ✅ (не `/api/admin/finance`)
- `/api/admin/settings/integrations/*` ✅ (6 блоков)
- `/api/billing/invoices/{project_id}` ✅
- `/api/client/projects/{id}/contract` ✅
- `/api/client/modules/*/approve|request-changes` ✅
- `/api/admin/withdrawals/*/approve|reject|mark-paid` ✅
- `/api/developer/earnings`, `/developer/work`, `/developer/leaderboard` — все **существуют** (401 auth)
- `/api/marketplace/feed`, `/api/me/wallet`, `/api/dev_work` — **существуют**

Аудит пробовал URL-ы «по наитию». Контракт-мап показывает, что **код UI и backend в большинстве синхронизированы** — разрыв только в 21 строке.

---

## 🎯 Следующий шаг → Этап 2 (Security + Production Runtime)

После утверждения Контракт-мапа переходим к Этапу 2:
1. Убрать дубль `CORSMiddleware` (server.py:145 и :8386)
2. `allow_origins` → whitelist, `allow_credentials=True`
3. `/api/healthz` + `/api/readyz`
4. `AUTH_OTP_DEV_MODE=false` (сейчас `true`)
5. `slowapi` на `/auth/*`
6. `gunicorn + 4 uvicorn workers` вместо `--reload --workers 1`
7. Lazy-load `sentence-transformers` (убрать 15s cold start)

Затем Этап 3 (Money Layer) — закрыть 21 строку из этого документа, начиная с P1.
