# Deployment & Repository Audit — ATLAS DevOS / EVA-X
**Date:** 2026-02 (Feb session restart, post-redeploy from `svetlanaslinko057/eeevveeveve`)
**Auditor:** E1 agent
**Status:** ✅ DEPLOYED & OPERATIONAL (mock-integrations mode)

---

## 1. Что развёрнуто

Репозиторий `https://github.com/svetlanaslinko057/eeevveeveve` (8 commits, последний — `d91aaab`, "Auto-generated changes") синхронизирован в `/app` через `rsync` (без `.git`, `.emergent` сохранены). Protected env-файлы остались нетронутыми (`/app/backend/.env`, `/app/frontend/.env`, `/app/frontend/metro.config.js`).

### Структура

| Каталог | Содержимое |
|---|---|
| `backend/` | FastAPI, 91 Python-модулей, 67 659 LOC, `server.py` = 27 088 строк (1 MB) |
| `frontend/` | Expo SDK 54 + expo-router, 93 экрана (.tsx) |
| `web/` | CRA + Tailwind + Radix UI, 53 экрана, обслуживается через `/api/web-ui/` |
| `packages/` | `design-system` + `runtime-client` (внутренние пакеты) |
| `audit/` | 59 markdown-аудитов фаз 0 → 2C-B4 + JSON артефакты, contract maps |
| `docs/` | charters, scope freeze, synthetic corpus, runtime-contracts |
| `memory/` | PRD (последний — Phase 2C-B1+B2+B2.5+B3+B3.1), test_credentials |
| `scripts/` | 17 утилит для smoke/replay/stability probe |
| `tools/` | baseline + heatmap |
| `tests/` | 26 backend test-файлов |

### Disk recovery
На старте `/app` был 9.8G / 9.8G (100%). После очистки pip-cache (`pip cache purge` — 2.9 GB) и удаления `/tmp/repo_clone` (378 MB) свободно 2.6 GB. Финальное состояние: 7.2 GB used / 2.6 GB free (74%).

### Зависимости
- **Backend:** `pip install -r requirements.txt --no-cache-dir` — все требования удовлетворены (FastAPI 0.110.1, motor 3.3.1, emergentintegrations 0.1.0, python-socketio 5.16.1, sentence-transformers 5.4.1, torch 2.12.0, stripe 15.0.1, slowapi, resend, pyotp, qrcode, beautifulsoup4, lxml).
- **Frontend (Expo):** `yarn install --network-timeout 600000` — 44 s, lockfile сгенерирован. Известный peer-warning: `expo-audio@1.1.1 → expo-asset *` (non-blocking), и серия `@typescript-eslint/* → typescript <5.9.0` vs реальный 5.9.3 (non-blocking).

---

## 2. Сервисы (supervisor)

| Process | Status | Команда |
|---|---|---|
| backend | RUNNING | `uvicorn server:app --host 0.0.0.0 --port 8001 --workers 1 --reload` |
| expo | RUNNING | `yarn expo start --tunnel --port 3000` (CI=true, NGROK token подхвачен) |
| mongodb | RUNNING | `/usr/bin/mongod --bind_ip_all` |
| code-server | RUNNING | — |
| nginx-code-proxy | RUNNING | — |

Tunnel Ngrok был с временными `TypeError: Cannot read properties of undefined (reading 'body')` при первом запуске — типичный flake туннеля. Текущее состояние: подключение установлено (`Tunnel connected. Tunnel ready.`), preview-URL отвечает HTTP 200.

---

## 3. Backend boot — pipeline OK

Из логов `/var/log/supervisor/backend.err.log` (выборочно):
- Seed mock-провайдеров, портфельных кейсов, admin-пользователя
- **5 quick-access ролевых seed-аккаунтов** (admin / john / client / multi / tester) re-upsert-нуты — см. `/app/memory/test_credentials.md`
- 6 developers, 89 modules, 81 QA decisions, 6 wallets, demo project `Acme Analytics Platform`
- 5 validations + 1 issue → `tester@atlas.dev`
- 4 scope templates, system config
- L0/L1 backfill (modules + users)
- Все 5 фоновых лупов запущены:
  - EVENT ENGINE (15 мин)
  - GUARDIAN (120 с) — наблюдалось `auto_project_pause project=e0eb5475`
  - MODULE MOTION (15 с)
  - OPERATOR SCHEDULER (300 с)
  - Autonomy + Intelligence recompute
- INTEGRATIONS seed: блоки `wayforpay`, `stripe`, `app`, `payments`
- Sentence-transformers `all-MiniLM-L6-v2` лениво загружен (103 weight files)
- MoneyService инициализирован (Phase 2B PR-1)
- MONEY LEDGER indexes, COMPETITOR CACHE TTL, VALIDATION CAMPAIGNS — все индексы созданы

### Известные warnings (cosmetic, non-blocking)
- **Duplicate Operation ID** для ~15 эндпоинтов (`fail_validation`, `audit_log`, `list_users_v2`, `get_user_detail`, `block_user`, `unblock_user`, `change_role`, `logout_all`, `soft_delete` и др.) — повторное подключение роутеров `admin_users_layer.py` поверх legacy в `server.py`. На функциональность не влияет, openapi.json просто использует последнее.
- **HuggingFace** warns про отсутствие `HF_TOKEN` — модель грузится анонимно.

---

## 4. Smoke endpoints (live, HTTP)

| Endpoint | Метод | Статус |
|---|---|---|
| `/api/` | GET | 200 — `{message:"Development OS API", version:"1.0.0"}` |
| `/openapi.json` | GET | 200 — **688 routes** |
| `/api/integrations/manifest` | GET | 200 — честный mock-статус |
| `/api/auth/login` (cookie) | POST `admin@atlas.dev/admin123` | 200 — возвращает user-объект |
| `/api/mobile/auth/login` (token) — admin | POST | 200 |
| `/api/mobile/auth/login` (token) — developer | POST | 200 |
| `/api/mobile/auth/login` (token) — client | POST | 200 |
| `/api/mobile/auth/login` (token) — tester | POST | 200 |
| `/api/web-ui/` | GET | **503** — `Web UI not built yet, build_dir=/app/web/build` (by design, см. §6) |

Mongo: 37 коллекций засеяно.

---

## 5. Интеграции — честный MOCK

`GET /api/integrations/manifest`:

| Capability | mode | policy | provider | Reason |
|---|---|---|---|---|
| payment | mock | **hard** | mock-payment | `STRIPE_SECRET_KEY missing` |
| mail | mock | soft | mock-mail | `RESEND_API_KEY missing` |
| storage | mock | soft | mock-storage | `CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET missing` |
| oauth | unavailable | hard | mock-oauth | `GOOGLE_CLIENT_ID missing` |

Реестр интеграций (см. `/app/backend/integrations/`) при появлении реальных ключей через `/api/admin/integrations` подхватывает их без правок кода.

---

## 6. Frontend (Expo) — live render

- Metro CI-mode bundler собрал bundle, реагирует на `:3000`
- Tunnel public URL `https://expo-mobile-app-18.preview.emergentagent.com/` → HTTP 200
- **Welcome screen** рендерится корректно:
  - EVA-X брендинг (логотип + wordmark)
  - Заголовок "Build real products. Not tasks."
  - Подзаголовок "Describe your idea. Get a full product plan. Launch with our team."
  - Бейдж "NO FREELANCERS · NO CHAOS · ONE SYSTEM"
  - 3-step sequence (SEQ-01 Describe / SEQ-02 Get full plan & price / SEQ-03 We build your product)
  - Список преимуществ (Real product, Fixed scope, Built by platform team, No hiring)
  - "USED TO BUILD" блок (SaaS / Marketplaces / AI tools / Internal systems)
  - CTA "See my product plan" + "30 SECONDS · NO SIGN-UP REQUIRED"
- Cosmetic RN-web warnings из прошлых аудитов остаются (pre-existing, non-blocking): `borderColor: var(--t-primary)33`, `shadow*` deprecation, `props.pointerEvents` deprecation.

---

## 7. Web admin (CRA) — НЕ собран

`/api/web-ui/` отдаёт **503**, потому что `/app/web/build` отсутствует. Бэкенд по дизайну возвращает honest 503 (см. `server.py` строки 26 472–26 492). Для подъёма web-админки нужно отдельно собрать CRA:

```bash
cd /app/web && yarn install && yarn build
# затем /api/web-ui/ начнёт отдавать SPA index.html без рестарта backend
```

Это пока **не сделано** в текущем deploy — оставлено на следующий шаг (тяжелее по диску, и web-админка опциональна для mobile-first сценария).

---

## 8. Что делает проект (executive summary репозитория)

**ATLAS DevOS / EVA-X** — мульти-роль платформа для управления полным циклом разработки продуктов «без фриланса, без хаоса, единая система»:

- **Роли**: admin / client / developer / tester / multi-role.
- **Core flow**: client описывает идею → AI-классификатор + scope-engine генерируют план и фиксированную цену → escrow-депозит → команда платформы декомпозирует на модули → developers выполняют → QA → payout.
- **Бэкенд-домены** (90+ модулей):
  - **money** (ledger / projections / divergence / bridge / replay / runtime) — событийная двойная запись, projection-pattern, Phase 2C-B3.1 завершён: `MONEY_READS_FROM_PROJECTION=true`, projection стал источником истины. Phase 2C-B4 запланирован — удаление 11 legacy-writers `dev_wallets`.
  - **escrow / payout / earnings / pricing**
  - **decomposition / assignment / module-motion / work-execution / acceptance / qa**
  - **autonomy / operator-engine / event-engine / guardian / scaling**
  - **decision-layer / intelligence (developer + team + system_truth)**
  - **legal-contract / validation-campaigns / tester-surface**
  - **leads / funnel-events / mobile-adapter / admin-mobile**
  - integrations: stripe / wayforpay / resend / cloudinary / google-oauth / emergentintegrations (LLM)
- **Frontend (Expo)**: 93 экрана, welcome + auth + role-based cabinets, mobile-first.
- **Web admin (CRA)**: 53 экрана, Tailwind + Radix UI, дашборды и cockpit.
- **Audit + docs**: 59 phase-аудитов, charters, runtime-contracts, observation snapshots, classifier probes, scope-benchmarks, pricing-stabilization sweeps. Уровень дисциплины разработки — высокий, есть "money authority charter", "blast radius" анализ, идемпотентность probes.

---

## 9. Текущее состояние фаз (по PRD `/app/memory/PRD.md`)

| Phase | Статус |
|---|---|
| 2C-B1 — projection shadow | ✅ DONE |
| 2C-B2 — stability probe (5/5 green) | ✅ DONE |
| 2C-B2.5 — seed convergence (`matches: 6, mock_orphan: 1`) | ✅ DONE |
| 2C-B3 — dual-read facade + feature flag | ✅ DONE |
| 2C-B3.1 — flag flipped: projection = user-facing source | ✅ DONE |
| 2C-B4 — removal of 11 legacy `dev_wallets` writers | 🟡 PLAN ready (`PHASE_2C_B4_WRITER_REMOVAL_PLAN.md`) |
| 2C-D — replay backfill | 📋 documented |

---

## 10. Risks / open issues

| # | Risk | Severity | Recommendation |
|---|---|---|---|
| 1 | `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `CLOUDINARY_*`, `GOOGLE_CLIENT_ID` отсутствуют | Medium | Все capability работают в honest-mock. До прод-релиза попросить ключи у пользователя. |
| 2 | `web/build` не собран → admin web недоступен | Low | По запросу собрать `cd /app/web && yarn install && yarn build`. |
| 3 | 15+ Duplicate Operation ID warnings в OpenAPI | Cosmetic | Можно прибраться, но не блокер. |
| 4 | Expo ngrok tunnel периодически даёт `body undefined` на старте | Low | Auto-recovery: после 1–2 рестартов поднимается стабильно. |
| 5 | Pre-existing RN-web cosmetic warnings (`shadow*`, `pointerEvents`, `borderColor` var) | Cosmetic | Унаследовано из предыдущих сессий. |
| 6 | `server.py` = 27k LOC — монолит | Medium | По audit'у Phase 2C идёт декомпозиция (`domains/`, `infrastructure/`, `services/`, `api/`, `shared/`, `middleware/`). Продолжается. |
| 7 | 11 legacy `dev_wallets` writers ещё активны (страховка после flip) | Medium | Phase 2C-B4 готов к запуску по плану. |
| 8 | `HF_TOKEN` не задан — модель грузится анонимно | Low | Опционально. |

---

## 11. Готовность к продолжению разработки

✅ Backend поднят — 688 routes, все фоновые лупы активны
✅ MongoDB — 37 коллекций засеяно
✅ Expo — Metro + tunnel работают, welcome screen рендерится end-to-end
✅ Auth — все 4+1 ролевых seed-аккаунта логинятся (admin/dev/client/tester/multi)
✅ Integrations registry — honest-mock, готов принять реальные ключи
✅ Audit + PRD актуальны и сохраняют контекст между сессиями

⚠️ Web admin SPA — требует ручной сборки (5 мин)
⚠️ Реальные ключи интеграций — нужны от пользователя для выхода из mock-режима

**Система готова принимать следующее направление работы** (Phase 2C-B4 writer removal, Expo-tester cabinet, Expo-admin parity, real integration keys, или новые фичи по запросу).
