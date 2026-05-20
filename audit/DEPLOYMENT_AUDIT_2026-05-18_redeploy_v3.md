# Deployment Audit — May 18, 2026 (redeploy_v3 session)

> User request (RU): «Разверни полностью данный проект, изучи репозиторий, полностью сделай аудит и-- после чего мы продолжим. Все есть в коде, мы только начинаем данную разработку и делаем веб сайт и моб приложение експо.»
>
> Repo: https://github.com/svetlanaslinko057/656565656 (commit `414db83`)
>
> Это четвёртое подряд развёртывание после fork/restart. Предыдущие: `DEPLOYMENT_AUDIT_2026-05-17.md`, `_redeploy.md`, `_redeploy_v2.md`.

---

## TL;DR

✅ **Платформа полностью развёрнута и зелёная.** Все три поверхности отвечают:

| Поверхность                | URL                                                                | HTTP | Что видно                                                                |
|----------------------------|--------------------------------------------------------------------|------|--------------------------------------------------------------------------|
| Backend API (FastAPI)      | `:8001/api/healthz`, `/readyz`                                     | 200  | `mongo:true, config:true`. 418+ routes. 5 фоновых лупов работают.        |
| Web admin cockpit (CRA)    | `/api/web-ui/`                                                      | 200  | Landing **EVA-X · "Software, actually shipped."** + admin/client routes. |
| Expo mobile/web preview    | `/describe` через `https://mobile-build-test-11.preview.emergentagent.com/` | 200  | "Build products. Not tickets." с attach/voice/analyze-url + 3 build mode |

Готово к продолжению разработки.

---

## 1. Что сделано в этой сессии

| #  | Шаг                                                                       | Результат                                                                                                                                                          |
|----|----------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | `git clone` репо во `/tmp/repo_clone`                                      | 17 697 файлов, ~386 MB                                                                                                                                              |
| 2  | rsync в `/app` с сохранением `.env`, `.git`, `.emergent`, `node_modules`   | Все 14 верхне-уровневых директорий перенесены, защищённые env-файлы сохранены                                                                                       |
| 3  | Освобождение диска (`/app` был на 100%)                                    | Удалены `pip cache (3 GB)`, `yarn cache`, `/app/frontend/.metro-cache`. Стало 3.0 GB свободного                                                                      |
| 4  | `pip install -r /app/backend/requirements.txt`                             | 135 пакетов, включая torch 2.12, transformers 5.8, sentence-transformers 5.4, slowapi, resend, pyotp, qrcode, stripe, google-genai 1.71, beautifulsoup4, lxml      |
| 5  | `yarn install` во `/app/frontend`                                          | OK (Done in 47s)                                                                                                                                                    |
| 6  | `/app/web/.env` создан с `REACT_APP_BACKEND_URL=` (пусто), `yarn install` | Web сборка `yarn build` (CRA) → `/app/web/build/` готов за 49s, 502 KB JS + 20 KB CSS                                                                              |
| 7  | `supervisorctl restart backend / expo`                                     | Backend `RUNNING`, Expo `RUNNING` (тоннель `tunnel ready` через ngrok)                                                                                              |
| 8  | Заполнен `/app/memory/test_credentials.md`                                 | 5 quick-access юзеров (`admin/john/client/multi/tester @atlas.dev`) с индивидуальными паролями                                                                      |
| 9  | Health-checks (curl)                                                       | `/healthz` 200, `/readyz` 200 (`mongo:true,config:true`), 5 логинов `/api/auth/login` × 200, `/api/web-ui/` 200                                                     |
| 10 | E2E проверка Expo `/describe` (Playwright)                                 | Главная форма брифа рендерится: `Build products. Not tickets.`, кнопки `ATTACH BRIEF / VOICE / ANALYZE A SITE LINK`, 3 build-modes (`AI Build / AI + Engineering / Full Engineering`) |
| 11 | E2E проверка web `/api/web-ui/` (Playwright)                               | Brand-страница EVA-X с execution pipeline (`SEQ-01..06: Intake / Scope / Contract / Build / QA / Delivery`), статусы LIVE/DONE/RUNNING/QUEUED                       |

## 2. Health snapshot

```
GET  /api/healthz                       → 200 {"status":"ok"}
GET  /api/readyz                        → 200 {"ready":true,"checks":{"mongo":true,"config":true}}
POST /api/auth/login admin@atlas.dev    → 200 user_id=user_19cb1c214730 role=admin
POST /api/auth/login john@atlas.dev     → 200 role=developer
POST /api/auth/login client@atlas.dev   → 200 role=client
POST /api/auth/login multi@atlas.dev    → 200 role=developer
POST /api/auth/login tester@atlas.dev   → 200 role=tester
GET  /api/web-ui/                       → 200 (CRA build, EVA-X landing + admin)
GET  /                                  → 200 (Expo bundle, splash → / redirects to /welcome)
GET  /describe                          → 200 (полная форма брифа)
```

Backend boot log (выжимка):
```
DEV POOL: seeded 6 devs, 89 modules, 81 qa decisions, 6 wallets
SEED REPLAY: status=noop (idempotent, marker exists, batch_id=replay_3640c599c0)
L1 backfill: 89 modules default=auto
EVENT ENGINE: Background scanner started (15 min interval)
MONEY LEDGER: indexes ensured
COMPETITOR CACHE: TTL index ensured (24h)
GUARDIAN: loop started (interval 120s)
MODULE MOTION: loop started (interval 15s)
OPERATOR SCHEDULER: started (300s interval)
AUTO_BALANCER: cycle complete — overloaded=0 priority=0 moves=0
Application startup complete
```

## 3. Инвентарь кода (после деплоя)

| Слой                                     | Файлов |
|------------------------------------------|--------|
| Backend `.py` (включая api/services)     | ~112   |
| Backend `/api/*` routes                  | 418+   |
| Expo routes (`/app/frontend/app/**/*.tsx`) | 78    |
| Web src (`/app/web/src/**/*.{js,jsx,ts}`) | 232+   |
| Audit docs (`/app/audit/*.md`)           | 22+    |
| Runtime contracts (`/app/docs/runtime-contracts/`) | 7 спек |

## 4. Сервисы (supervisor)

| Сервис             | Статус   | Порт   | Уровень                                                |
|--------------------|----------|--------|--------------------------------------------------------|
| mongodb            | RUNNING  | 27017  | `mongodb://localhost:27017/test_database`              |
| backend            | RUNNING  | 8001   | FastAPI + Socket.IO, 418+ routes, 5 фоновых лупов      |
| expo               | RUNNING  | 3000   | Metro `--tunnel`, ~1595 модулей в web-bundle           |
| nginx-code-proxy   | RUNNING  | 8443   | code-server                                            |
| code-server        | RUNNING  | —      | dev environment                                        |

Web (CRA) подаётся статикой через FastAPI mount `/api/web-ui`.

## 5. Поверхности — готовность

### Backend (~95%)
22 крупных модуля-слоя: acceptance, qa, payout, escrow, time-tracking, earnings, legal-contract, intelligence, autonomy, event-engine, operator-engine, mobile-adapter, decision, team, assignment, dev-economy, client-transparency, scaling, decomposition, money-ledger/runtime, competitor-analyzer, pricing-engine (Reality Layer 5-axis).

### Web (CRA admin/client cockpit, ~95%)
- **Marketing/landing** (EVA-X): hero "Software, actually shipped." + execution pipeline визуализация
- **Client cabinet**: project, billing, transparency
- **Admin cockpit (AdminV2)**: ~27 страниц включая Finance/Pricing (с Reality Layer multipliers UI), Workflow, Team, System, Templates, Integrations, Inbox (с `🔗 Analyze a site link`), WarRoom, MarketplaceQuality
- **Developer cabinet** и **Tester** (7 страниц)

### Expo mobile (mixed)
- ✅ Client cabinet — 15 экранов (parity с web)
- ✅ Developer cabinet — 12 экранов (parity с web)
- ✅ Visitor flow — `/welcome`, `/describe` (форма брифа + voice STT + analyze-URL + 3 build modes), `/estimate-result`, `/estimate-improve`, `/chat`
- ⚠️ Admin cockpit — 5 экранов (по `product-scope-freeze`, НЕ полный admin)
- ⏳ Tester — нет (Stage 4, 4 экрана запланировано)
- ⏳ Lead — только conversion-screen, frozen

### Cross-cutting
- Money-ledger (append-only chain) формализован
- Realtime через Socket.IO (web + mobile)
- Auth: JWT + OTP + 2FA (`auth_otp.py`, `two_factor.py`, `google_auth.py`)
- Pricing Reality Layer (5 осей × 4 уровня entropy multipliers, hybrid LLM+admin override)
- Competitor URL analyzer + 24h cache + telemetry funnel (`competitor_url_events`, `funnel_events`)
- Voice STT (whisper-1) — visitor `/describe` + chat auto-transcribe

## 6. Сидинг (auto, на каждый cold-start)

- 5 quick-access юзеров (см. `/app/memory/test_credentials.md`)
- 6 marketplace developers (alice.kim, marco.rossi, …)
- 89 модулей, 81 QA-решение, 6 wallets
- 2 demo-проекта (включая `Acme Analytics Platform` для `client@atlas.dev`)
- 7 модулей, 6 invoices, 6 earnings, 2 deliverables, 3 tickets, 3 notifications
- 70 событий replay-данных (overrides/qa_fail/reassign/overload/suppression)
- 4 scope templates, money-ledger indexes, competitor-cache TTL 24h
- Integrations rotation: wayforpay / stripe / app / payments

## 7. Известные второстепенные проблемы (унаследовано)

| # | Проблема                                                              | Влияние                                       | Статус                                |
|---|------------------------------------------------------------------------|-----------------------------------------------|---------------------------------------|
| 1 | `GET /openapi.json` → 500                                              | Ломает Swagger UI, runtime OK                 | open                                  |
| 2 | React Hooks-order warning в `/developer/*`                             | Только warning, не блокирует                  | open                                  |
| 3 | `/welcome` splash-hang на web-viewport для гостей                      | UX, не блокирует funnel (есть `/describe` deep-link, и hash redirect через `/`) | mitigated (`graceExpired 1.5s` в index)|
| 4 | Live keys Stripe / Resend / Cloudinary НЕ в env                        | Email/files в MOCK, реальные платежи не идут  | open — пользователь должен поставить  |
| 5 | `EMERGENT_LLM_KEY` НЕ в `.env`                                         | LLM-фичи возвращают 503 `LLM_NOT_CONFIGURED`  | open — можно включить через `/admin/integrations` (web UI) |
| 6 | `expo-audio@1.1.1` peer dep warning                                    | Только warning                                | open                                  |
| 7 | Web build warning: `@react-native-async-storage/async-storage` в `src/runtime-client/adapters` | Warning (RN-only код в shared-папке)          | open                                  |

## 8. Test credentials (актуально на 2026-05-18)

См. `/app/memory/test_credentials.md`. Кратко:

| Email                | Password   | Role      |
|----------------------|------------|-----------|
| admin@atlas.dev      | admin123   | admin     |
| john@atlas.dev       | dev123     | developer |
| client@atlas.dev     | client123  | client    |
| multi@atlas.dev      | multi123   | developer |
| tester@atlas.dev     | tester123  | tester    |

Все 5 логинов подтверждены 200 в этой сессии.

## 9. Готовность к продолжению

✅ **Платформа полностью работает.** Доступные направления (в порядке приоритета по PRD/scope-freeze):

1. **Подключение live-ключей** (Stripe / Resend / Cloudinary / OpenAI или `EMERGENT_LLM_KEY`) — снимет MOCK на оплатах, email, файлах, LLM analyze.
2. **Pricing Reality Layer Iteration 3** (по PRD §0):
   - Admin re-price UI в `/admin/finance/pricing` (backend `POST /admin/projects/{id}/reprice` готов)
   - Calibration job на завершённых проектах
   - Web `/describe` (CRA) narrative chips render, как в Expo
3. **Stage 4 — Tester mobile surface** (4 экрана) — единственный явно frozen-but-planned scope.
4. **Stage 5 — production hardening**.
5. **72-ч окно телеметрии** уже работает: `competitor_url_events` + `funnel_events` коллекции собирают данные (см. PRD §0.1/§0.2 для готовых aggregate-запросов).
6. **Bug-fix очередь**: `/openapi.json` 500, Hooks-order warning в developer, `/welcome` splash-hang corner-case.

## 10. Что НЕ требует немедленных действий (scope-freeze)

Согласно `/app/docs/product-scope-freeze.md`:
- ❌ Не строить mobile-admin до feature parity с web
- ❌ Не вводить отдельную "lead" роль (frozen scope)
- ❌ Не делать tester web-only без явного решения
- ❌ Не делать массовую runtime-client миграцию до окончания observation window

---

## Следующие шаги — куда движемся

Пользователь явно сказал: «после чего мы продолжим». Так что эта сессия — **deployment + audit done, ждём дальнейших указаний** что именно строить/чинить в первую очередь.
