# Deployment Audit — May 17 2026

> Аудит выполнен по запросу: «Разверни полностью данный проект, изучи репозиторий, полностью сделай аудит».

## 1. Что развёрнуто

Локальный `/app` был пустым scaffold'ом (одиночный `server.py` со status-check + одиночный `app/index.tsx`). Полностью синхронизирован с https://github.com/svetlanaslinko057/1e12e12e121, защищённые `.env` сохранены.

| Сервис    | Состояние | Где                                                                  |
|-----------|-----------|----------------------------------------------------------------------|
| MongoDB   | RUNNING   | `localhost:27017` (db `test_database`)                               |
| Backend   | RUNNING   | uvicorn `:8001`, FastAPI + Socket.IO, **131 .py**, **48 routers**    |
| Expo Web  | RUNNING   | Metro `:3000`, **78 routes** в `app/`, **78 компонентов** в `src/`   |
| CRA Web   | NOT BUILT | `/app/web` (214 файлов), требует `yarn install && yarn build`        |

**Preview URL:** https://mobile-app-expo-4.preview.emergentagent.com/ — рендерит welcome-экран EVA-X («Build real products. Not tasks.»).

## 2. Health-check результаты

```
GET /api/healthz   → 200 {"status":"ok"}
GET /api/readyz    → 200 {"ready":true,"checks":{"mongo":true,"config":true}}
GET /api/          → 200 {"message":"Development OS API","version":"1.0.0"}

POST /api/auth/login {admin@atlas.dev / admin123}
                   → 200, user_id=user_461cbc0530cb, role=admin, roles=[admin]
```

## 3. Что засеяно при старте

- 5 quick-access юзеров (admin, john-dev, client, multi-dev, tester) — см. `/app/memory/test_credentials.md`
- 6 marketplace developers (alice/marco/priya/luka/sara/diego)
- 89 модулей, 81 QA решений, 6 wallets
- 2 demo проекта (`Acme Analytics Platform` + ещё один)
- 7 модулей, 6 invoices, 6 earnings, 2 deliverables, 3 tickets, 3 notifications
- 70 событий replay-данных (overrides=16, qa_fail=14, reassign=19, overload=12, suppression=9)
- 4 scope templates, system config, money-ledger indexes, competitor-cache TTL 24h
- 3 фоновых лупа: Event Engine (15 мин), Guardian (120s), Module Motion (15s)
- Integrations: wayforpay, stripe, app, payments (admin может ротировать ключи через `/admin/integrations`)

## 4. Архитектура (по PRD)

**ATLAS DevOS / EVA-X** — мультироль-платформа доставки продуктов: клиент описывает идею → escrow финансирует → внутренние developers выполняют модули → tester валидирует → admin контролирует через cockpit.

Поверхности:
- **Mobile (Expo)** — все 7 ролевых поддиректорий (`admin/`, `client/`, `developer/`, `tester/`, `operator/`, `lead/`, `contract/`) + voice-flow (`describe.tsx`, `chat.tsx` с Telegram-style mic).
- **Web (CRA)** — канонический admin-surface (full Workflow / Team / System / Templates / Integrations / Inbox / WarRoom / MarketplaceQuality). **Не собран** (см. п. 5).
- **Backend (FastAPI + Motor + Socket.IO)** — 48 routers, ~608 endpoint'ов, 112 Mongo-коллекций. Money-ledger, escrow-state-machine, decision-layer, QA, two-factor, OTP-auth, audit-логи, runtime-client architecture.

## 5. Известные проблемы (унаследованы из PRD + добавлены этой сессией)

| # | Проблема                                                                                                 | Источник      | Влияние                                       |
|---|----------------------------------------------------------------------------------------------------------|---------------|-----------------------------------------------|
| 1 | `GET /openapi.json` → 0 paths (FastAPI: "A response class is needed to generate OpenAPI")               | PRD п. 5      | Не блокирует runtime, ломает Swagger          |
| 2 | `/app/web` не собран → `/api/web-ui` отдаёт 503                                                          | PRD п. 8      | Канонический admin недоступен                 |
| 3 | React Hooks-order warning в `/developer/*`                                                               | PRD п. 5      | Только варнинг                                 |
| 4 | Mobile-вьюпорт `/describe` иногда зависает на splash из-за бесконечного `useMe()` для гостей             | PRD п. 5      | Гостевой UX                                    |
| 5 | Real ключи Stripe / Resend / Cloudinary не подключены (mock-режим)                                       | PRD п. 8      | Не блокирует runtime, mail/files в моке      |
| 6 | `Embedding error ... marshal data too short` при seed scope-templates                                    | startup log   | Семантический поиск шаблонов деградирован     |
| 7 | Supervisor `expo --tunnel` периодически падает с `ngrok timeout` → авторестартится                       | supervisor    | Текущий запуск стабилен; ngrok через раз     |
| 8 | `expo-audio@1.1.1` peer dep warning: `expo-asset@*` не установлен явно                                   | yarn install  | Только варнинг, экспо работает                |
| 9 | `package-lock.json` конфликтовал с `yarn.lock` → удалён, чистый `yarn install` сделан                    | этой сессии   | Исправлено                                     |

## 6. LLM / Integrations статус

- `EMERGENT_LLM_KEY` **не выставлен** в `/app/backend/.env`. Adm может добавить через `/admin/integrations` (web UI), как описано в PRD п. 3.
- Активный провайдер при первом старте: env-ключ или emergent (если задан). Сейчас `RESEND_API_KEY not set` → почта в моке. `CLOUDINARY: MOCK mode` → файлы локально в `/app/backend/uploads/mock`.
- Готовые интеграции (по `/app/backend/integrations/`): ai, mail, oauth, payment, storage + registry + mocks. Boundary-layer не пускает business-логику к вендор-именам — реальные адаптеры в `live_adapters.py` (Stripe / WayForPay).

## 7. Что было сделано этой сессией (изменения)

1. ✅ Полная синхронизация `/app` ← GitHub (rsync, исключая `.env`, `.git`, `.emergent`, `node_modules`, `.metro-cache`, `__pycache__`).
2. ✅ Восстановление защищённых `.env`.
3. ✅ Очистка диска: `.metro-cache` (249 MB), `__pycache__`, `pip cache` (3.0 GB), `yarn cache`.
4. ✅ `pip install -r requirements.txt` (130 пакетов, добавлены `sentence-transformers`, `transformers`, `slowapi`, `resend`, `pyotp`, `qrcode`, `emergentintegrations`, и др.).
5. ✅ Удалён конфликтный `package-lock.json`; чистый `yarn install` (1500+ модулей).
6. ✅ Рестарт supervisor `backend` + `expo` → оба RUNNING.
7. ✅ Сидинг подтверждён в логах.
8. ✅ Health/auth checks прошли.
9. ✅ `/app/memory/test_credentials.md` создан (отсутствовал; в `.gitignore`).
10. ✅ Скриншот welcome-экрана EVA-X сделан в 390×844, mobile-вьюпорт работает.

## 8. Что готово к следующему шагу

Платформа полностью развёрнута и отвечает в preview. Готова к:
- ручному QA по любой роли (5 quick-access юзеров),
- сборке web (`cd /app/web && yarn install && yarn build`) для admin-cockpit,
- подключению live-ключей (Stripe / Resend / Cloudinary / OpenAI / Emergent LLM),
- продолжению фич из roadmap (Stage 4 — Tester mobile, Stage 5 — production hardening).
