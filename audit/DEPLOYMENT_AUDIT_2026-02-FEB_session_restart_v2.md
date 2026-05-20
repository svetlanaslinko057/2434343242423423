# DEPLOYMENT AUDIT — Session Restart v2 (Feb 2026)

> Repo: `svetlanaslinko057/d32d3d2323` (ATLAS DevOS / EVA-X)
> Trigger: пользователь запросил "разверни полностью данный проект, изучи репозиторий, полностью сделай аудит"
> Status: **DEPLOYED. Backend + Expo + MongoDB зелёные. Web build НЕ собран (HTTP 503 на /api/web-ui/).**

---

## 0. TL;DR — что готово прямо сейчас

| Слой | Статус | Smoke |
|---|---|---|
| MongoDB | ✅ RUNNING | 37 collections, seed применён (6 devs, 89 modules, 2 projects, 6 invoices, 7 cognition_actions, 70 replay events) |
| Backend (FastAPI, port 8001) | ✅ RUNNING | 688 routes, openapi.json 443 KB, все 4 фоновые петли (Guardian/Module Motion/Operator/Event) стартанули |
| Expo (port 3000, web bundle) | ✅ RUNNING | bundle 200, welcome screen рендерит "Build real products. Not tasks." c EVA-X брендингом |
| Web CRA (`/app/web`) | ❌ НЕ СОБРАН | `/app/web/build` отсутствует → `GET /api/web-ui/` → 503 `{"detail":"Web UI not built yet"}` |
| Auth (4 роли) | ✅ ВСЕ ЗЕЛЁНЫЕ | admin / client / developer / tester логинятся, возвращают user_id+role+roles[]+active_role |
| Integrations manifest | ✅ HONEST | все 5 capabilities (payment/mail/storage/oauth/ai) = **mock**, причина "X_KEY missing" указана |
| Documents (contracts+invoices) | ⚠ CHILDREN PARTIAL | `/api/contracts/my` → `{items:[], count:0}` (пусто); `/api/client/invoices` → 6 записей, paid invoice `inv_7ec9b970d7c5` $1200 виден |

---

## 1. Что было сделано в этой сессии

1. **Восстановление кода**: rsync `/tmp/repo` (свежий `git clone https://github.com/svetlanaslinko057/d32d3d2323`) → `/app/`. `.env`, `.git`, `.emergent` сохранены через бэкап + `--exclude`.
2. **Backend deps**: `pip install -r /app/backend/requirements.txt` (требовалось `socketio`, `transformers`, `torch`, `sentence-transformers`, `google-genai 1.71.0` — всё подтянулось).
3. **Disk crisis recovery**: на этапе pip install диск `/app` (9.8G) заполнился до 100% (виновник — `/app/frontend/.metro-cache` 335M + pip cache). Удалил `/app/frontend/.metro-cache` + `pip cache purge` → освободил 3 ГБ.
4. **Frontend deps**: `expo-audio` отсутствовал в `node_modules` (есть в `package.json`), Expo падал на этапе `withConfigPlugins` с `PluginError`. `yarn install` решил проблему.
5. **Service restart**: `supervisorctl restart backend` + `expo` — оба зелёные. Metro первый bundle ~60s (713 модулей).
6. **Smoke tests**: 4 ролевых логина + integrations manifest + contracts/invoices + welcome screenshot.

---

## 2. Архитектура (что лежит в репо)

```
/app
├── backend/                  FastAPI, server.py 27 162 строк, 688 endpoints
│   ├── server.py             монолит-агрегатор
│   ├── api/adapters/         web_adapter.py (CRA адаптер на /api/web-ui)
│   ├── domains/money/        Phase 2A money domain (events.py, models.py, policies.py, service.py)
│   ├── money_*.py            ledger, projections, bridge, divergence
│   ├── auth_otp.py + google_auth.py    auth (mock-mail mode)
│   ├── auto_guardian.py + module_motion.py + operator_engine.py + event_engine.py    4 фон.петли
│   ├── admin_*.py            14 admin layers
│   ├── client_*.py           7 client layers
│   ├── developer_*.py        4 developer layers
│   └── …106 файлов
├── frontend/                 Expo Router, ~190 экранов
│   ├── app/                  file-based routes
│   │   ├── admin/            5-tab cockpit + 8 drill-downs
│   │   ├── client/           home/billing/contracts/modules/payment-plan/validation/versions
│   │   ├── developer/        home/earnings/market/leaderboard/feedback/growth/acceptance
│   │   ├── tester/, operator/, project/, lead/, workspace/, contract/, help/
│   │   └── welcome.tsx + describe.tsx + estimate-result.tsx + project-booting.tsx
│   └── src/                  api.ts (43 import), runtime/, runtime-client/, design-tokens.ts, theme.ts
├── web/                      CRA + Tailwind + craco — admin/client web surface (build НЕ существует)
├── packages/                 monorepo-style
│   ├── design-system/        shared tokens/typography/motion/theme
│   └── runtime-client/       middleware (token-prime, telemetry, retry)
├── audit/                    65+ MD-аудитов от предыдущих сессий + JSON baseline'ы
├── docs/                     scope freeze, charter'ы, runtime-contracts
├── memory/PRD.md             Phase 2C-B1+B2+B2.5+B3+B3.1 done (dev_wallet projection)
├── scripts/                  smoke + probe скрипты
├── tools/                    stage_3_1_baseline.py + stage_3_2_heatmap.py
└── tests/                    architecture/test_layering.py + др.
```

---

## 3. Smoke-test результаты (зафиксированы curl'ом)

```
POST /api/auth/login admin@atlas.dev/admin123        → 200 user_fdfdb97a43b5 role=admin
POST /api/auth/login client@atlas.dev/client123      → 200 user_961ff4f6cbfc role=client
POST /api/auth/login john@atlas.dev/dev123           → 200 user_f7cc845bdb5a role=developer
POST /api/auth/login tester@atlas.dev/tester123      → 200 user_f421cc68a302 role=tester

GET  /api/integrations/manifest                       → 200 capabilities: 5/5 mock (payment/mail/storage/oauth/ai)
GET  /api/contracts/my       (client cookie)          → 200 {items:[], count:0}
GET  /api/client/invoices    (client cookie)          → 200 6 invoices (1 paid $1200 USD)
GET  /api/web-ui/                                     → 503 "Web UI not built yet"
GET  /                       (Expo bundle)            → 200 49 885 bytes
GET  /welcome                (Expo bundle)            → 200 50 677 bytes (рендерится EVA-X welcome)
```

Welcome screen визуально:
- Логотип "EVA-X"
- H1: "Build real products. Not tasks."
- 3 sequence: Describe / Get plan / We build
- 4 буллета value-props
- CTA "See my product plan"

---

## 4. Findings (что требует внимания)

### A. БЛОКЕРЫ — НЕТ

### B. ВЫСОКИЙ ПРИОРИТЕТ

1. **`/api/web-ui/` отдаёт 503** — `/app/web/build` отсутствует. Если web-сурфейс нужен:
   `cd /app/web && yarn install && yarn build` (или `/app/scripts/rebuild-web.sh`).
   Не запускал — диск /app сейчас 73% занято.

2. **`/api/contracts/my` пуст для `client@atlas.dev`** — мок-сид заводит invoices (6) но не контракты. UI должен пережить пустой items[] (Promise.allSettled), но если нежелательно — расширить `mock_seed.py`.

### C. СРЕДНИЙ ПРИОРИТЕТ

3. **Все 5 интеграций в MOCK режиме** (явный design-choice). Для prod нужно: `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `CLOUDINARY_*`, `GOOGLE_CLIENT_ID`, `EMERGENT_LLM_KEY`.

4. **Expo tunnel (ngrok) не работает** — повторяющееся `CommandError: ngrok tunnel took too long`. НЕ критично: web-bundle на localhost:3000 отдаёт 200.

### D. НИЗКИЙ ПРИОРИТЕТ

5. **Pre-existing patterns (НЕ баги по `test_result.md`)**: `Invalid borderColor` warning, WS auth-token 401 на первой загрузке.

6. **Code-server STOPPED** — после рестарта контейнера не поднялся auto. Не блокирует runtime.

---

## 5. Phase-tracking

- ✅ Phase 0 Foundation
- ✅ Phase 1 Substrate
- ✅ Phase 2A Money Domain
- ✅ Phase 2B PR1/PR2/PR3 (Escrow/Earnings/Payout Bridges)
- ✅ Phase 2C-B1..B3.1 (dev_wallet projection flipped to source-of-truth)
- 🟡 Phase 2C-B4 — Removal of legacy `dev_wallets` writes (В РАБОТЕ)
- 🟡 Phase 2C-D — Replay backfill (закрыт)

`test_result.md` фокус: 4 high-priority front-flow ещё `working: "NA"`:
- Documents screen
- Estimate → project-booting
- Admin cockpit + 8 drill-downs
- Runtime-client migration

---

## 6. Что я НЕ трогал

- ❌ `metro.config.js`
- ❌ `EXPO_PACKAGER_PROXY_URL` / `EXPO_PACKAGER_HOSTNAME`
- ❌ `MONGO_URL` (`mongodb://localhost:27017` + `DB_NAME="test_database"`)
- ❌ `requirements.txt` / `package.json` (только `pip install` / `yarn install` поверх)
- ❌ Никаких legacy `dev_wallets` writers
- ❌ `pricing_engine.py` / HVL

---

## 7. Recommended next steps

1. **Build web CRA** → закроет 503 на `/api/web-ui/`.
2. **Run testing_agent_v3_expo** на 4 NA-flow.
3. **Phase 2C-B4 финал**: `grep -rn "db.dev_wallets.update_one\|db.dev_wallets.insert_one" /app/backend/`.
4. **Real integrations**: Stripe/Resend/Cloudinary/Google OAuth/Emergent LLM (по мере получения ключей).
5. **Деплой production**.

---

*Audit prepared: Feb 2026, post session-restart, repo `d32d3d2323`*
