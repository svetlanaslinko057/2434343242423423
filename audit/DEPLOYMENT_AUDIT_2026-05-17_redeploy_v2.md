# Deployment Audit — May 17, 2026 (session: redeploy_v2)

> Запрос пользователя: «Разверни полностью данный проект, изучи репозиторий, полностью сделай аудит и-- после чего мы продолжим. Все есть в коде, мы только начинаем данную разработку и делаем веб сайт и моб приложение експо.»
>
> Третье развёртывание подряд после fork/restart. Предыдущие: `DEPLOYMENT_AUDIT_2026-05-17.md`, `DEPLOYMENT_AUDIT_2026-05-17_redeploy.md`.

## TL;DR

✅ **Всё развёрнуто и зелёное.** Все 3 поверхности отвечают:
- Backend API → `:8001/api/*` (HTTP 200, 418 routes)
- Web admin/client cockpit → `/api/web-ui/` (HTTP 200, 502 KB JS)
- Expo mobile/web preview → welcome screen "EVA-X · Build real products. Not tasks." рендерится за ~6s

Готово к продолжению разработки.

## 1. Что сделано в этой сессии

| # | Шаг | Команда / результат |
|---|-----|---------------------|
| 1 | Pull репозитория `svetlanaslinko057/hgytyt7` в `/tmp` и rsync в `/app` (защищённые `.env` + `.git` + `.emergent` сохранены) | 14 верхне-уровневых директорий загружено |
| 2 | Восстановление backend deps | `pip install -r requirements.txt` → 135 пакетов. Установились: torch 2.12, transformers 5.8, sentence-transformers 5.4, beautifulsoup4, lxml, slowapi, resend, pyotp, qrcode, stripe, google-genai 1.71 |
| 3 | Frontend (Expo) deps | `yarn install` в `/app/frontend` → ✅ (warning: `expo-audio` peer dep `expo-asset` — нефатально) |
| 4 | Web (CRA admin) deps + build | `yarn install && DISABLE_ESLINT_PLUGIN=true CI=false yarn build` → `build/` готов за 49s |
| 5 | Restart backend | supervisor → `RUNNING`, sat loops живы: Event Engine, Guardian, Module Motion, Operator Scheduler, Auto Balancer |
| 6 | Заполнение `/app/memory/test_credentials.md` | Был пустой → внесены 5 quick-access юзеров (`admin/dev/client/multi-dev/tester @ admin123`) |
| 7 | Health-check (curl) | `/api/healthz` 200, `/api/readyz` 200 (`mongo:true,config:true`), `/api/auth/login admin@atlas.dev` 200 → user_id+role=admin |
| 8 | Web-ui smoke | `GET /api/web-ui/` 200 |
| 9 | Expo smoke (Playwright) | `https://expo-preview-build-2.preview.emergentagent.com/` рендерит welcome "EVA-X · Build real products" + CTA "See my product plan" + footer "30 SECONDS · NO SIGN-UP REQUIRED" |

## 2. Health snapshot

```
GET  /api/healthz                       → 200 {"status":"ok"}
GET  /api/readyz                        → 200 {"ready":true,"checks":{"mongo":true,"config":true}}
POST /api/auth/login admin@atlas.dev    → 200 user_id=user_6308d232b80a, role=admin
GET  /api/web-ui/                       → 200 (502 KB JS + 20 KB CSS, admin cockpit)
GET  /                                  → 200 (Expo web bundle, EVA-X welcome)
```

Backend boot log (выжимка):
```
DEV POOL: seeded 6 devs, 89 modules, 81 qa decisions, 6 wallets
SEED REPLAY: status=noop (idempotent — marker exists, batch_id=replay_ff024e0197)
L1 backfill: 89 modules default=auto
EMBEDDING: model ready
Seeded 4 scope templates
EVENT ENGINE: Background scanner started (15 min interval)
MONEY LEDGER: indexes ensured
COMPETITOR CACHE: TTL index ensured (24h)
GUARDIAN: loop started (interval 120s)
MODULE MOTION: loop started (interval 15s)
OPERATOR SCHEDULER: started (300s interval)
OPERATOR auto_project_pause project=817d7c50 paused=1   # Guardian уже отработал
```

## 3. Инвентарь кода

| Слой | Файлов |
|------|--------|
| Backend `.py` (без `__pycache__`, без `tests/`) | **112** |
| Backend `/api/*` routes | **418** + Socket.IO |
| Expo routes (`frontend/app/**/*.tsx`) | **78** |
| Web (`web/src/*.{js,jsx,ts,tsx}`) | **232** |
| Audit docs (`/audit/*.md`) | 22 рапорта + 12 JSON-снимков |
| Runtime contracts (`/docs/runtime-contracts/`) | 7 спек |

## 4. Сервисы (supervisor)

| Сервис | Статус | Порт | Уровень |
|--------|--------|------|---------|
| mongodb | RUNNING | 27017 | `mongodb://localhost:27017/test_database` |
| backend | RUNNING | 8001 | FastAPI + Socket.IO, 418 routes, 5 фоновых лупов |
| expo | RUNNING | 3000 | Metro `--tunnel`, web-bundle ~1585 модулей |
| nginx-code-proxy | RUNNING | 8443 | code-server |
| code-server | RUNNING | — | dev environment |

Web (CRA) подаётся статикой через FastAPI mount `/api/web-ui` — отдельного процесса не требуется.

## 5. Поверхности — готовность (из existing audits + scope-freeze)

### Backend (~95%)
22 крупных модуля-слоя: acceptance, qa, payout, escrow, time-tracking, earnings, legal-contract, intelligence, autonomy, event-engine, operator-engine, mobile-adapter, decision, team, assignment, dev-economy, client-transparency, scaling, decomposition, money-ledger/runtime, competitor-analyzer. 5 фоновых лупов работают.

### Web (CRA admin/client cockpit, ~95%)
4 surface'а: Client, Admin (AdminV2 = 27 страниц), Developer, Tester (7 страниц).
AdminInboxPage содержит `🔗 Analyze a site link` инструмент (с 24h-кэшем).

### Expo mobile (смешанная)
- ✅ Client cabinet — 15 экранов, parity с web
- ✅ Developer cabinet — 12 экранов, parity с web
- ⚠️ Admin cockpit — 5 экранов (frozen scope, НЕ полный admin)
- ⏳ Tester — нет (Stage 4, 4 экрана запланировано)
- ⏳ Lead — только conversion-screen, frozen

### Cross-cutting
- Money-ledger (append-only chain) формализован
- Realtime через Socket.IO (web + mobile)
- Auth: JWT + OTP + 2FA (`auth_otp.py`, `two_factor.py`, `google_auth.py`)
- Runtime-client pilot migration: 3 web pages + 1 Expo screen (wallet.tsx)

## 6. Сидинг (auto, на каждый cold-start)

- 5 quick-access юзеров (см. `test_credentials.md`)
- 6 marketplace developers
- 89 модулей, 81 QA-решений, 6 wallets
- 2 demo-проекта (включая `Acme Analytics Platform` для `client@atlas.dev`)
- 7 модулей, 6 invoices, 6 earnings, 2 deliverables, 3 tickets, 3 notifications
- 70 событий replay-данных (overrides/qa_fail/reassign/overload/suppression)
- 4 scope templates, money-ledger indexes, competitor-cache TTL 24h
- Integrations rotation: wayforpay / stripe / app / payments

## 7. Известные ограничения (унаследовано из PRD §5 и Deployment §7)

| # | Проблема | Влияние | Статус |
|---|----------|---------|--------|
| 1 | `GET /openapi.json` → 500 | Ломает Swagger, runtime OK | open |
| 2 | React Hooks-order warning в `/developer/*` | Только warning | open |
| 3 | Splash-hang `/describe` на mobile-viewport | Гостевой UX, минор | mitigated (graceExpired 1.5s) |
| 4 | Live keys Stripe / Resend / Cloudinary НЕ в env | Mail/files в MOCK, blocks production payments | open — user должен поставить |
| 5 | `EMERGENT_LLM_KEY` НЕ в `.env` | LLM-фичи → 503 LLM_NOT_CONFIGURED | open — user может включить через `/admin/integrations` |
| 6 | `expo-audio@1.1.1` peer dep warning | Только warning | open |
| 7 | Web build warning: `@react-native-async-storage/async-storage` not found в `src/runtime-client/adapters` | Warning, web не падает | open (RN-only код в shared-папке) |

## 8. Готовность к продолжению

✅ **Платформа полностью работает.** Доступные направления:

1. **Подключение live-ключей** (Stripe / Resend / Cloudinary / OpenAI или `EMERGENT_LLM_KEY`) — снимет MOCK mode на оплатах, email, файлах, LLM analyze.
2. **Stage 4 — Tester mobile surface** (4 экрана) — единственный явно frozen-but-planned scope.
3. **Stage 5 — production hardening** (по audit-док.).
4. **Завершение runtime-client migration** (codemod, после observation window).
5. **72-ч окно телеметрии** уже работает: `competitor_url_events` + `funnel_events` коллекции собирают данные (см. PRD §0.1 / §0.2 для готовых aggregate-запросов).
6. **Bug-fix очередь**: openapi.json 500, Hooks-order warning в developer, splash-hang corner-case.

## 9. Что НЕ требует немедленных действий (scope-freeze)

Согласно `docs/product-scope-freeze.md`:
- ❌ Не строить mobile-admin до feature parity с web
- ❌ Не вводить отдельную "lead" роль (frozen scope)
- ❌ Не делать tester web-only без явного решения
- ❌ Не делать массовую runtime-client миграцию до окончания observation window
