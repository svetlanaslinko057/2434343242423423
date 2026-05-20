# Deployment Audit — May 17 2026 (re-deploy session)

> Запрос пользователя: «Разверни полностью данный проект, изучи репозиторий, полностью сделай аудит и-- после чего мы продолжим. Все есть в коде, мы только начинаем данную разработку и делаем веб сайт и моб приложение експо.»

> Это повторное развёртывание после fork/restart pod. Предыдущий аудит — `DEPLOYMENT_AUDIT_2026-05-17.md` (этот файл — продолжение).

## 1. Что сделано в этой сессии

1. **Полный rsync репозитория `svetlanaslinko057/2768372837` в `/app`** поверх пустого Emergent-шаблона. Защищённые `.env` сохранены (`/app/backend/.env`, `/app/frontend/.env`).
2. **Backend deps**: `pip install --no-cache-dir -r requirements.txt` — 135 пакетов (новые: torch 2.12, sentence-transformers 5.4, transformers 5.8, google-genai 1.71). Освободил 3 GB pip cache, чтобы влезть в 9.8GB диск `/app`.
3. **Frontend deps (Expo)**: `yarn install` в `/app/frontend` — 47 deps + 5 devDeps. После `expo-audio` warning о `expo-asset` peer dep — терпимо.
4. **Web deps + build**: `yarn install && DISABLE_ESLINT_PLUGIN=true yarn build` в `/app/web`. Получили `build/static/js/main.2700676f.js` (502 KB gzip) + `main.8dff9d4c.css` (20 KB gzip). `/api/web-ui/` теперь отвечает **200**.
5. **Supervisor restart** backend + expo → `RUNNING`. Метро отбандлил Web версию приложения за ~15s (1585 модулей).
6. **`test_credentials.md`** заполнен (был пустой).

## 2. Health-check (текущая сессия)

```
GET  /api/healthz                   → 200 {"status":"ok"}
GET  /api/readyz                    → 200 {"ready":true,"checks":{"mongo":true,"config":true}}
POST /api/auth/login admin@atlas.dev → 200 user_id=user_55d3dd5b9cf9, role=admin, roles=[admin]
GET  /api/web-ui/                   → 200 (admin-cockpit, 502KB JS + 20KB CSS)
GET  /api/integrations/manifest     → 200
```

Логи бэкенда:
```
EVENT ENGINE: Background scanner started (15 min interval)
MONEY LEDGER: indexes ensured
COMPETITOR CACHE: TTL index ensured (24h)
GUARDIAN: loop started (interval 120s)
MODULE MOTION: loop started (interval 15s)
OPERATOR SCHEDULER: started (300s interval)
AUTO_BALANCER: cycle complete — overloaded=0 priority=0 moves=0
```

Expo bundle (Web): `Web Bundled 15755ms node_modules/expo-router/entry.js (1585 modules)` — отбандлено без ошибок.

## 3. Текущий код-инвентарь

| Слой | Файлов / роутов |
|------|-----------------|
| Backend `.py` (без `__pycache__` и tests) | **112 файлов** |
| Backend `/api/*` routes | **418** на `api_router` + `/socket.io/*` |
| Expo routes (`/app/frontend/app/**/*.tsx`) | **78 файлов** (роутов) |
| Expo `src/` модулей | ~60 файлов (`auth`, `runtime-client`, `i18n`, `realtime`, `push`, design-system…) |
| Web `src/*` (CRA, admin/client) | **231 файл** |

## 4. Сервисы

| Сервис   | Статус   | Порт | Где                                                                            |
|----------|----------|-----:|--------------------------------------------------------------------------------|
| MongoDB  | RUNNING  | 27017 | `mongodb://localhost:27017/test_database`                                      |
| Backend  | RUNNING  | 8001 | uvicorn + FastAPI + Socket.IO, 418 API routes                                  |
| Expo     | RUNNING  | 3000 | Metro в `--tunnel` mode, web-bundle ~1585 модулей                              |
| Web-CRA  | BUILT    | served via `/api/web-ui` | `/app/web/build/`                                  |
| Nginx-code-proxy | RUNNING | 8443 | code-server frontend                                                       |

**Preview URL:** `https://mobile-dev-preview-75.preview.emergentagent.com/` (отдаёт Expo welcome).

## 5. Архитектура (краткая выжимка из существующих audit-отчётов)

Полные описания: `ARCHITECTURE_AUDIT_2026-05-09.md`, `API_CONTRACT_MAP.md`, `ENDPOINT_FAMILY_REGISTRY.md`, `MONEY_STATE_MACHINE.md`, `MONEY_AUTHORITY_CHARTER.md`, `ESCROW_SMOKE_TRACE.md`, `WITHDRAWAL_SMOKE_TRACE.md`, `WORK_EXECUTION_SMOKE_TRACE.md`, `PROJECT_LIFECYCLE_TRACE.md`, `RUNTIME_SEMANTICS_INTERACTIONS.md`, `RUNTIME_CLIENT_MIGRATION.md`, `PHASE1_SUBSTRATE_CLOSEOUT.md`, `SUBSTRATE_CONTRACT.md`.

### Backend (готовность ~95%)
- 22 крупных модуля-слоя: `acceptance_layer`, `qa_layer`, `payout_layer`, `escrow_layer`, `time_tracking_layer`, `earnings_layer`, `legal_contract_layer`, `intelligence_layer`, `autonomy_layer`, `event_engine`, `operator_engine`, `mobile_adapter`, `admin_mobile`, `decision_layer`, `team_layer`, `assignment_engine`, `developer_economy`, `client_transparency`, `scaling_engine`, `decomposition_engine`, `money_ledger`/`money_runtime`, `competitor_analyzer`.
- 5 фоновых лупов: Event Engine (15 мин), Guardian (120s), Module Motion (15s), Operator scheduler (300s), Team balancer (по lifecycle).
- 5 TODO в коде, не блокирующих.

### Web (CRA, готовность ~95%)
- 4 surface'а: Client / Admin (AdminV2 = новая, 27 страниц) / Developer / Tester (7 страниц, изолирован).
- Деплой через `/api/web-ui/*` (FastAPI static-mount после `yarn build`).
- AdminInboxPage содержит панель `🔗 Analyze a site link` — admin-инструмент анализа сайта-конкурента.

### Expo (мобильный, готовность смешанная)
- **Client cabinet** — 15 экранов, parity с web ✅
- **Developer cabinet** — 12 экранов, parity с web ✅
- **Admin cockpit** — 5 экранов (home/qa/finance/profile/control). Намеренно сокращён vs 27 web — frozen в `docs/product-scope-freeze.md` («operational cockpit, NOT full admin surface»).
- **Tester** — отсутствует на mobile. По scope-freeze → планируется Stage 4 (4 экрана).
- **Lead** — только conversion-screen (`lead/workspace.tsx`), нет рабочей поверхности. Frozen.

### Cross-cutting
- Money-ledger (append-only chain) — формализован в `docs/runtime-contracts/money-ledger-events.md`.
- Realtime через Socket.IO — wired на обеих платформах.
- Auth: JWT + OTP + 2FA (`auth_otp.py`, `two_factor.py`, `google_auth.py`), `AuthProvider` на Expo всё ещё на axios — отложено по Pilot discipline.
- Runtime-client migration в pilot-фазе: 3 web-pages + 1 Expo screen (wallet.tsx) мигрированы.

## 6. Что засеяно при boot

- 5 quick-access юзеров (admin/john-dev/client/multi-dev/tester, пароль `admin123` — см. `test_credentials.md`)
- 6 marketplace developers (alice/marco/priya/luka/sara/diego)
- 89 модулей, 81 QA-решений, 6 wallets
- 2 demo-проекта (включая `Acme Analytics Platform` для `client@atlas.dev`)
- 7 модулей, 6 invoices, 6 earnings, 2 deliverables, 3 tickets, 3 notifications
- 70 событий replay-данных (overrides/qa_fail/reassign/overload/suppression)
- 4 scope templates, money-ledger indexes, competitor-cache TTL 24h
- Integrations: wayforpay / stripe / app / payments seeded (ротация через `/admin/integrations`)

## 7. Известные ограничения (унаследовано из PRD)

| # | Проблема | Влияние |
|---|----------|---------|
| 1 | `GET /openapi.json` → 500 (FastAPI: «A response class is needed to generate OpenAPI») | Ломает Swagger, runtime не влияет |
| 2 | React Hooks-order warning в `/developer/*` | Только warning |
| 3 | Splash-hang на `/describe` иногда на mobile-viewport (PRD §0.1 fix) | Гостевой UX, минор |
| 4 | Live ключи Stripe / Resend / Cloudinary НЕ выставлены → MOCK mode | Mail/files в mock, blocks production payments |
| 5 | `EMERGENT_LLM_KEY` НЕ выставлен в `.env` | LLM-зависимые фичи (URL-analyze, decomposition) деградируют до `LLM_NOT_CONFIGURED` 503 |
| 6 | `expo-audio@1.1.1` peer dep `expo-asset@*` not installed explicitly | Warning только |
| 7 | `expo --tunnel` иногда падает с ngrok timeout → авторестарт | Текущий запуск стабилен |
| 8 | Web build предупреждает «Module not found: `@react-native-async-storage/async-storage` in src/runtime-client/adapters» | Warning, не критично — это RN-only код в shared-папке |

## 8. Готовность к продолжению разработки

✅ **Платформа полностью развёрнута и отвечает на preview.** Все 3 поверхности работают:
- Web admin-cockpit (`/api/web-ui/`)
- Mobile Expo (`/`, через preview URL)
- Backend API (`/api/*`, 418 routes)

Готовы к:
- Ручному QA по любой роли (5 quick-access юзеров).
- Подключению live-ключей: Stripe, Resend, Cloudinary, OpenAI (или `EMERGENT_LLM_KEY` для admin-провижна через `/admin/integrations`).
- Stage 4 — Tester mobile surface (4 экрана).
- Stage 5 — production hardening (по audit-документам).
- Runtime-client migration codemod (после observation window).
- 72-часовому окну телеметрии `competitor_url_events` + `funnel_events` (см. PRD §0.2).

## 9. Что НЕ требует немедленных действий (намеренные scope-freeze)

Согласно `docs/product-scope-freeze.md`:
- ❌ Не строить mobile-admin до feature parity с web.
- ❌ Не вводить отдельную "lead" роль.
- ❌ Не делать tester web-only без явного решения.
- ❌ Не делать массовую runtime-client миграцию до окончания observation window.
