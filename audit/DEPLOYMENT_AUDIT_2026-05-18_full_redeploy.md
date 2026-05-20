# DEPLOYMENT AUDIT — Full Redeploy from GitHub (May 18, 2026)

> Контекст: пользователь попросил «развернуть полностью проект» из репозитория
> `https://github.com/svetlanaslinko057/qwdqwqwqwq`, изучить, сделать аудит.
> Этот документ фиксирует состояние развёрнутого окружения и читается дальше
> как стартовая точка для следующей сессии.

---

## 1. Что развёрнуто

| Поверхность           | Путь           | Статус   | Доступ                                                                        |
|-----------------------|----------------|----------|-------------------------------------------------------------------------------|
| Backend (FastAPI)     | `/app/backend` | ✅ RUN   | `http://localhost:8001/api/*` и `https://expo-preview-v1.preview.emergentagent.com/api/*` |
| Mobile Expo           | `/app/frontend`| ✅ RUN   | `http://localhost:3000` → tunnel `https://expo-preview-v1.preview.emergentagent.com/` |
| Web (CRA admin/marketing) | `/app/web` | ✅ BUILT | `https://expo-preview-v1.preview.emergentagent.com/api/web-ui/` (отдаётся FastAPI mount) |
| MongoDB               | `mongodb://localhost:27017` (`test_database`) | ✅ RUN | local |

Supervisor процессы (`sudo supervisorctl status`):
```
backend          RUNNING
expo             RUNNING
mongodb          RUNNING
code-server      RUNNING
nginx-code-proxy RUNNING
```

---

## 2. Объём кодовой базы

| Слой         | Файлы | Строк    | Что внутри |
|--------------|------:|---------:|-----------|
| Backend `.py`| **135** | **73 972** | `server.py` (26 869) + 49 доменных модулей + 22 теста + интеграции/middleware/services |
| Backend endpoint decorators (`@api_router`/`@app`/`@router`) | — | **576** | 53 `include_router` вызовов в `server.py` |
| Expo routes `.tsx` под `frontend/app/` | **78** | — | role-buckets: `admin/`, `client/`, `developer/`, `tester/`, `operator/`, `lead/`, `project/`, `contract/`, `workspace/`, `help/` + ~30 верхнеуровневых экранов (`describe`, `chat`, `auth`, `welcome`, `estimate-*`, `hub`, `gateway`, `voice-demo`, 2FA…) |
| Web pages `.js` под `web/src/pages/` | **104** | — | admin cockpit + клиентский описатель + публичные лендинги |
| Mongo collections referenced  | **122** | — | money / escrow / contract / projects / chat / leads / audit / cognition / funnel / telemetry … |
| Background loops              | **4**   | — | Auto-guardian (120s), Module Motion (15s), Operator Scheduler (300s), Event Engine (15min) + TTL index 24h на `competitor_url_cache` |

---

## 3. Что было сделано в этой сессии (redeploy)

1. **Clone** `https://github.com/svetlanaslinko057/qwdqwqwqwq` → `/tmp/repo_audit`.
2. **rsync** всё кроме `.git / .emergent / node_modules / __pycache__ / .metro-cache / build/` → `/app/`.
3. **Сохранены protected env**: `/app/backend/.env` (MONGO_URL, DB_NAME) и
   `/app/frontend/.env` (EXPO_PACKAGER_*). Содержимое из репо НЕ перекрывалось.
4. **Disk cleanup**: `/app` был на 100% (9.8G / 9.8G). Очищены `~/.cache/pip`
   и `~/.cache/yarn` → освобождено ≈3 ГБ.
5. **`pip install -r backend/requirements.txt`** — все зависимости встали, включая:
   `fastapi 0.110.1`, `motor 3.3.1`, `pymongo 4.5.0`, `emergentintegrations 0.1.0`,
   `litellm 1.80.0`, `openai 1.99.9`, `stripe 15.0.1`, `sentence-transformers 5.4.1`,
   `resend 2.30.0`, `pyotp 2.9.0`, `qrcode 8.2`, `beautifulsoup4 4.13.5`, `lxml 6.1.0`.
6. **`yarn install`** в `/app/frontend` — установлены 1+ ГБ `node_modules` (Expo SDK 54, react 19.1, react-native 0.81.5, expo-router 6, expo-audio 1.1, socket.io-client 4.8.1, и т.д.).
7. **`yarn install` + `yarn build`** в `/app/web` — собран admin cockpit (517 КБ JS + 20 КБ CSS gzip).
8. **`supervisorctl restart backend && restart expo`** — оба сервиса подняты, seed данных прошёл.

---

## 4. Seed-данные (после `_create_quick_access_users` на старте)

| Учётка                | Пароль     | Роль       |
|-----------------------|-----------|-----------|
| `admin@atlas.dev`     | `admin123`| admin     |
| `john@atlas.dev`      | `dev123`  | developer |
| `client@atlas.dev`    | `client123` | client  |
| `multi@atlas.dev`     | `multi123`| developer |
| `tester@atlas.dev`    | `tester123` | tester  |

Дополнительно засеяно (`Seed developer`):
`alice.kim`, `marco.rossi`, `priya.shah`, `diego.silva` (всех 4 — senior/middle).

Также при старте отрабатывает `mock_seed` (2 проекта, 7 модулей, 6 earnings,
6 invoices, 2 deliverables, 3 tickets) + `seed_replay v1` (16 overrides, 14 qa_fail,
19 reassign, 12 overload, 9 suppression).

Auth — **session-cookie** (`set-cookie: session_token=…; HttpOnly; Secure;
SameSite=none; Max-Age=604800`). Bearer-токен НЕ выдаётся. Это критично
для тестирования: использовать `curl -c cookies.txt` + `-b cookies.txt`.

E2E проверка прошла:
```
POST /api/auth/login          → 200 (set-cookie)
GET  /api/me                  → 200 (с cookie)
GET  /api/admin/leads         → 200
GET  /api/admin/settings/llm  → 200
GET  /api/admin/integrations  → 200 (compat → /api/admin/settings/integrations)
```

`/api/admin/settings/llm`:
- `preferred_provider=openai`, `default_model=gpt-4o-mini`
- `openai.configured=false`, `emergent.configured=false`
- `env_fallback.emergent=false`, `env_fallback.openai=false`
- **active_provider: null** → LLM пока выключен. Это блокирует:
  - `/api/estimate/analyze-url` (вернёт 503 `LLM_NOT_CONFIGURED`)
  - `/api/estimate/transcribe-voice` (whisper-1)
  - `/api/estimate` LLM-scope inference
  - chat auto-transcribe голосовых

`/api/admin/settings/integrations`:
- `blocks: []` — wayforpay/stripe/app/payments seed-блоки видны через legacy путь
  `/api/admin/integrations` (compat route фиксируется в логе `compat_route_used`).
- Stripe, Resend, Cloudinary, Google OAuth, OpenAI/Emergent LLM **все в MOCK**
  до тех пор пока admin не пропишет ключи через cockpit.

---

## 5. Архитектурная карта (по `PRD.md` + код)

```
                          ┌──────────────────────────────────────────────┐
                          │  Mobile Expo  /app/frontend  (78 .tsx)       │
                          │  - role buckets: admin/client/developer/...  │
                          │  - public: welcome/describe/estimate-result  │
                          │  - i18n.tsx, theme-context, runtime-client   │
                          └──────────────┬───────────────────────────────┘
                                         │ axios → EXPO_PUBLIC_BACKEND_URL/api
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ FastAPI  /app/backend/server.py (26 869 LOC) + 49 модулей + 53 router'а         │
│                                                                                 │
│  Auth layer       :  auth_otp, two_factor, google_auth, /auth/* (cookie session)│
│  Money            :  money_runtime, money_ledger, money_divergence,             │
│                       escrow_layer, escrow_api, payout_layer                    │
│  Pricing          :  pricing_engine (Reality Layer × 5 axes), services/pricing  │
│  Project lifecycle:  decomposition_engine, work_execution, module_execution,    │
│                       module_motion, dev_work, assignment_engine, team_balancer │
│  Quality          :  qa_layer, acceptance_layer                                 │
│  Operator/scale   :  operator_engine, scaling_engine, auto_guardian             │
│  Decision/intel   :  decision_layer, intelligence_layer, intelligence_api,      │
│                       execution_intelligence, system_truth                      │
│  Earnings         :  earnings_layer, developer_economy, developer_intelligence  │
│  Account/profile  :  account_layer, developer_brain, hidden_ranking,            │
│                       reputation_decay                                          │
│  Client surface   :  client_workspace, client_acceptance, client_escrow,        │
│                       client_costs, client_operator(_opportunities), client_…   │
│  Admin            :  admin_actions/control/integrations/llm/mobile/             │
│                       production/risk/system/team/users                         │
│  Marketplace      :  leads_layer, market_bootstrap, funnel_events,              │
│                       competitor_analyzer, etap3_routes                         │
│  Tester           :  qa_layer (validation contract)                             │
│  Legal/contract   :  legal_contract_layer                                       │
│  Integrations     :  integrations/{ai, base, live_adapters, mail, mocks,        │
│                       oauth, payment, registry, storage} + admin_integrations   │
│  Payments         :  payment_providers/{base, mock, stripe_provider, wayforpay} │
│  Time/event       :  time_tracking_layer, event_engine                          │
│  Files/voice      :  file_parser, stt_service, cloudinary_service               │
│  Push/Realtime    :  push_sender, socketio (4.13 engine + 5.16 socketio)        │
│  Compat/Observe   :  compat_routes, middleware/{compat_observability,           │
│                       error_shape, request_id}                                  │
│  Mobile compat    :  mobile_adapter, admin_mobile                               │
│                                                                                 │
└──────────────┬──────────────────────────────────────────────────────────────────┘
               │ Motor / Mongo
               ▼
       MongoDB (`test_database`, 122 collections)
       Notable collections:
         projects · modules · invoices · escrow_holds · money_ledger
         users · auth_codes · auth_events · contracts · contract_signatures
         chat_messages · message_threads · client_alerts · client_notifications
         leads · anonymous_leads · client_opportunities
         qa_decisions · validations · validation_issues
         system_actions_log · audit_log · admin_audit_log
         cognition_events · cognition_overrides
         funnel_events · competitor_url_events · competitor_url_cache (TTL 24h)
         pricing_history · legacy_estimate_hits
         … (122 total)
               ▲
               │ also served by:
┌──────────────┴──────────────────────────────────────────────────────────────────┐
│ Web CRA  /app/web/build  (mounted at FastAPI /api/web-ui/*)                     │
│  - admin cockpit: AdminFinance/Inbox/Integrations/Pricing/Reprice/Calibration   │
│  - visitor: ClientEstimatePage (analyzer + chips), publicLandings               │
│  - Radix UI + Tailwind, react-router-dom 7, lucide-react                        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Что работает (E2E проверено в этой сессии)

| Проверка                                         | Результат |
|---|---|
| `GET /api/`                                       | 200 `{"message":"Development OS API","version":"1.0.0"}` |
| `POST /api/auth/login admin@atlas.dev`            | 200 + set-cookie |
| `GET /api/me` (с cookie)                           | 200, role=admin |
| `GET /api/admin/leads` (с cookie)                  | 200 |
| `GET /api/admin/settings/integrations` (с cookie)  | 200 |
| `GET /api/admin/settings/llm` (с cookie)           | 200 |
| `GET /` (Expo tunnel, web bundle)                  | 200, рендер EVA-X landing "Build real products. Not tasks." |
| `GET /api/web-ui/` (CRA admin)                     | 200, рендер EVA-X "Software, actually shipped." |
| Background loops                                  | стартанули: GUARDIAN (120s), MODULE MOTION (15s), OPERATOR SCHEDULER (300s) |
| TTL index `competitor_url_cache`                  | ✅ ensured (24h) |
| Seed mock providers + portfolio + dev pool + tester | ✅ all seeded on first boot |
| Pre-existing tests dir `/app/backend/tests/`       | 355 tests **collected**; коллекция падает на `test_auth_otp.py` (AttributeError NoneType) — нужно фиксить отдельно |

---

## 7. Что НЕ работает / открытые вопросы

| Проблема                                                                            | Серьёзность | Действие |
|---|---|---|
| **LLM provider не сконфигурирован** (`active_provider=null`) — нет ни `EMERGENT_LLM_KEY` в env, ни ручного ключа в `/admin/integrations` | средняя — блокирует `/api/estimate/analyze-url`, `transcribe-voice`, scope-inference | спросить ключ у пользователя ИЛИ запросить Emergent LLM key через `emergent_integrations_manager` |
| **Pytest collection breaks** в `backend/tests/test_auth_otp.py` (NoneType attribute error) | низкая, не блокирует runtime | починить fixture при следующей итерации |
| `GET /openapi.json` → 500 (известно из PRD §5)                                        | низкая | требует response_class у нестандартных endpoints |
| Stripe / Resend / Cloudinary / Google OAuth ключи не подключены                       | средняя — Stripe в MOCK, mock-payment URL работает | пользователь сам подключает через `/admin/integrations` cockpit |
| React Hooks-order warning в `/developer/*` (известно из PRD §5)                       | низкая, cosmetic | оставлено как было |
| `expo` показывает deprecation warnings (`shadow*`, `props.pointerEvents`) — это react-native-web 0.21 предупреждения | низкая, cosmetic | не блокирует |
| `metro.config.js` detected change при старте — это часть существующего скаффолдинга, безопасно | низкая | не трогать |

---

## 8. Состояние интеграций (по `/admin/integrations` seed)

Засеяны блоки: `wayforpay`, `stripe`, `app`, `payments` — все в **MOCK**
до тех пор пока admin не пропишет ключ через UI. Резолюция ключа
(см. `admin_llm_settings.get_active_llm_key`):
1. `preferred_provider` из БД
2. ключ другого провайдера из БД (soft-fallback)
3. env-ключ предпочитаемого провайдера
4. любой env-ключ

В этой сессии env-ключи **не выставлены** → `active_provider=null`.

---

## 9. Что я НЕ изменил (намеренно)

- `metro.config.js` — protected;
- `frontend/.env` (EXPO_PACKAGER_*) — protected;
- `backend/.env` (MONGO_URL, DB_NAME) — protected; **не добавлял EMERGENT_LLM_KEY**, потому что в репо его не было и пользователь не давал ключ;
- никакой код backend/frontend/web НЕ менялся — только установка зависимостей и сборка;
- `requirements.txt`, `package.json` — не модифицированы;
- pytest fixture'ы НЕ чинил — отдельная задача для следующей итерации.

---

## 10. Чек-лист для следующей итерации (когда пользователь скажет «продолжаем»)

- [ ] Уточнить у пользователя приоритеты: что именно в этой сессии — feature work,
      bug bash, performance, или конкретный модуль из 49.
- [ ] Если нужна LLM — попросить ключ (или получить Emergent LLM key через
      `emergent_integrations_manager`) и положить в `EMERGENT_LLM_KEY` в backend/.env
      → проверить `/api/admin/settings/llm/test`.
- [ ] Починить `test_auth_otp.py` (NoneType fixture) → 355 tests должны полностью
      собираться.
- [ ] Опционально подключить настоящие Stripe / Resend / Cloudinary / Google OAuth
      ключи через `/admin/integrations` cockpit.
- [ ] Опционально починить `/openapi.json` 500.

---

## 11. Маленькая business-замочка (smart enhancement candidate)

PRD фиксирует funnel: `describe_opened` → `describe_completed` → `estimate_generated`.
Аналитика уже собирается в `funnel_events` + `competitor_url_events` (включая
mobile/desktop split, latency p50/p95, error_kind buckets). Это даёт реальный
revenue-сигнал: **conversion-to-paying-client** можно мерить через
`legacy_estimate_hits` → `client_legal_profiles` → `escrow_holds` цепочку.
В следующей итерации можно добавить admin dashboard-карточку с этим funnel'ом,
чтобы видеть top-of-funnel drop-off в реальном времени.

---
*Подготовлено E1, May 18 2026 22:45 UTC. Read-only audit + redeploy.*
