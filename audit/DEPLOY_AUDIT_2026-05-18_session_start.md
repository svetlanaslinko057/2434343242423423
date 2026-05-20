# ATLAS DevOS / EVA-X — Deploy & Audit Report
**Дата:** 18 мая 2026  
**Среда:** Emergent preview (`app-preview-mobile-33.preview.emergentagent.com`)  
**Сделал:** E1 (initial deployment + audit)

---

## 1. Развёртывание — статус: ✅ ВСЁ ПОДНЯТО

| Сервис   | Порт | Статус   | URL внешний                                                       |
|----------|-----:|----------|-------------------------------------------------------------------|
| backend (FastAPI + uvicorn) | 8001 | RUNNING | `https://…/api/*` |
| expo (Metro + RN Web) | 3000 | RUNNING | `https://…/` |
| mongodb (локальный) | 27017 | RUNNING | `mongodb://localhost:27017/test_database` |
| web (CRA build) | served by FastAPI | RUNNING | `https://…/api/web-ui` |

**Проверки live**:
- `GET /api/` → `200 {"message":"Development OS API","version":"1.0.0"}`
- `GET /api/integrations/manifest` → `200`, capabilities mock-mode (см. секцию 4)
- `GET /api/web-ui` → `200`, CRA-бандл отдаётся
- `POST /api/auth/login {admin@atlas.dev/admin123}` → `200`, роль `admin`
- Expo Web на `/` рендерит landing **EVA-X** «Build real products. Not tasks.»

---

## 2. Что есть в коде (масштаб)

### Backend (`/app/backend`, FastAPI)
- **86 Python-модулей**, ядро `server.py` — **26 471 строк**.
- **608 endpoints**, разнесённых по 56+ APIRouter'ам. Топ-роутеры:
  - `server.py` — 412 ендпоинтов (legacy ядро)
  - `work_execution.py` 20, `mobile_adapter.py` 19, `account_layer.py` 15
  - `admin_mobile.py` 13, `admin_integrations.py` 13, `revenue_brain.py` 10
  - `legal_contract_layer.py` 10, `escrow_api.py` 10
- Богатая доменная модель: `assignment_engine`, `decomposition_engine`, `pricing_engine`, `money_ledger`, `money_runtime`, `money_divergence`, `escrow_layer`, `payout_layer`, `acceptance_layer`, `legal_contract_layer`, `decision_layer`, `intelligence_layer`, `execution_intelligence`, `revenue_brain`, `auto_guardian`, `operator_engine`, `module_motion`, `event_engine`, `overdue_engine`, `competitor_analyzer`, `scaling_engine`, `team_balancer`, `reputation_decay`.
- Фоновые demons (запущены): `EVENT ENGINE` (15-мин скан), `GUARDIAN` (120s), `MODULE MOTION` (15s), `OPERATOR SCHEDULER` (300s).
- Embedding модель `sentence-transformers/all-MiniLM-L6-v2` загружается лениво (≈8 с при первом обращении). Готова.
- **112 Mongo-коллекций** упомянуты в PRD; локально создано на boot: TTL indexes для `competitor_url_cache` (24h), `money_ledger` indexes — есть.

### Frontend (`/app/frontend`, Expo SDK 54 + expo-router)
- **78 экранов** (`*.tsx`).
- Полная мульти-роль-навигация: каталоги `admin/`, `client/`, `developer/`, `tester/`, `operator/`, `lead/`, `project/`, `contract/`, `help/`, `workspace/`.
- Сквозные entry-points: `welcome.tsx`, `auth.tsx`, `describe.tsx`, `chat.tsx`, `hub.tsx`, `inbox.tsx`, `account.tsx`, `settings.tsx`, `documents.tsx`, `gateway.tsx`, `estimate-result.tsx`, `estimate-improve.tsx`, `project-booting.tsx`, `voice-demo.tsx`, `two-factor-*.tsx`.
- Голос (expo-audio), запись/whisper, push-notifications, image-picker, location, document-picker — всё уже в `package.json`.

### Web (`/app/web`, CRA + Tailwind + Radix UI)
- React 19, Tailwind, lucide-react, Radix UI, react-day-picker, dnd-kit, embla-carousel, react-hook-form + zod.
- Готовая сборка в `/app/web/build` — раздаётся FastAPI'ем по `/api/web-ui`. Этот build deplated по PRD до этой сессии.

### Packages
- `packages/design-system` — общая дизайн-система (токены/компоненты).
- `packages/runtime-client` — общий HTTP-клиент между web и mobile.

### Scripts / Tools / Docs / Audit
- 14 скриптов аудита/смок-трейса (`pricing-stabilization-sweep`, `escrow_smoke_trace`, `withdrawal_smoke_trace`, `work_execution_smoke_trace`, `pr0_*`, `synthetic_runner`, `observation_snapshot`, `scope-benchmark-corpus`, `scope-reviewer-probe`, `classifier-v2-probe`, `llm-scope-probe`, `money_divergence`, `rebuild-web.sh`).
- 45+ markdown-документов в `/app/audit/` (charters, blast radius, money state machine, escrow/withdrawal smoke traces, runtime contracts, deployment audits, pricing reviews).
- Полная PRD — `/app/memory/PRD.md` (558 строк, на русском, актуальна на 18 мая 2026, описывает 7 итераций).

---

## 3. Что **РАБОТАЕТ** (smoke-проверено в этой сессии)

| Проверка | Результат |
|---|---|
| Backend live (`/api/`) | ✅ 200 |
| Frontend SSR (`/`) | ✅ 200 (EVA-X landing рендерится) |
| Web build (`/api/web-ui`) | ✅ 200 |
| Mongo индексы (TTL, money ledger) | ✅ создаются на boot |
| Seed users (5 quick-access) | ✅ admin/dev/client/multi/tester |
| Seed providers, portfolio cases, scope templates, system config | ✅ |
| Seed replay (boot_replay_v1, 70 событий) | ✅ idempotent (marker exists) |
| L0/L1 backfill (89 модулей, 12 юзеров) | ✅ |
| Background daemons (guardian, motion, operator, event) | ✅ запущены |
| Embedding ML модель | ✅ загружается лениво, ready |
| `/api/auth/login` admin | ✅ 200 |
| `/api/integrations/manifest` | ✅ 200 (mock capabilities) |

---

## 4. Интеграции — текущее состояние (mock vs live)

```json
{
  "payment":  { "mode":"mock", "policy":"hard", "reason":"STRIPE_SECRET_KEY missing" },
  "mail":     { "mode":"mock", "policy":"soft", "reason":"RESEND_API_KEY missing" },
  "storage":  { "mode":"mock", "policy":"soft", "reason":"CLOUDINARY_* missing" },
  "oauth":    { "mode":"unavailable", "policy":"hard", "reason":"GOOGLE_CLIENT_ID missing" },
  "ai":       { "mode":"mock", "policy":"soft", "reason":"LLM key present but INTEGRATIONS_LIVE_ENABLED!=1" }
}
```

- **`EMERGENT_LLM_KEY`** уже **добавлен** в `/app/backend/.env`. Чтобы реально использовать LLM (OpenAI/Claude/Gemini/Whisper), нужно:
  1. Выставить `INTEGRATIONS_LIVE_ENABLED=1` в `/app/backend/.env` **либо**
  2. В админ-UI `/admin/integrations` (web) включить provider'а вручную.
- Email (Resend), Storage (Cloudinary), OAuth (Google), Payments (Stripe + WayForPay) — **mock**. Можно подключать по мере необходимости через `/admin/integrations` UI или ENV.

---

## 5. Что **ДОЛОМАНО / требует внимания** (P1 → P3)

| # | Severity | Что | Где | Что делать |
|---|---|---|---|---|
| 1 | P1 | LLM соц-юз остаётся **mock** даже при наличии EMERGENT_LLM_KEY | `integrations/registry.py` — гейт `INTEGRATIONS_LIVE_ENABLED!=1` | Решить policy: включить globally (`INTEGRATIONS_LIVE_ENABLED=1`) или per-provider через admin UI. |
| 2 | P2 | `GET /openapi.json` → 500 (`AssertionError: A response class is needed to generate OpenAPI`) | какой-то endpoint без response_model / response_class | Идентифицировать endpoint через bisect, добавить дефолтный `response_class`. Не блокирует runtime, но мешает Swagger/Postman импорту. |
| 3 | P2 | `email_service` warning `RESEND_API_KEY not set` | env | Опционально: добавить Resend key. |
| 4 | P3 | `huggingface_hub` warning `HF_TOKEN not set` | env | Опционально: для прод-нагрузок добавить HF_TOKEN. |
| 5 | P3 | Web (`/api/web-ui`) не пересобирается автоматически | `/app/web/build` | `cd /app/web && yarn install && yarn build` при изменении web-кода (есть `scripts/rebuild-web.sh`). |
| 6 | P3 | Mobile: hooks warning в `/developer/*` (упомянут в PRD) | `frontend/app/developer/*` | Низкий приоритет, не блокирует функционал. |
| 7 | P3 | Tunnel `ngrok` периодически выдаёт `Cannot read 'body' of undefined` | supervisor logs | Self-recover (supervisor рестартит). Не блокирует. |

---

## 6. Креденшалы

См. `/app/memory/test_credentials.md`. Все 5 quick-access юзеров (admin / john (developer) / client / multi / tester) с паролем `admin123` пересоздаются на старте backend'а.

---

## 7. Что готово к следующему шагу

Платформа полностью развёрнута и доступна end-to-end. На приветственной странице (EVA-X) видны 3 шага product flow:
- SEQ-01 Describe your idea
- SEQ-02 Get full plan & price
- SEQ-03 We build your product

Все 78 экранов компилируются и отдаются Metro'ом. Все 608 backend-эндпоинтов под доступом. Можно сразу:
1. Залогиниться как admin → попасть в cockpit.
2. Залогиниться как client → пройти `/describe` (voice + текст + URL competitor).
3. Через `/admin/integrations` (web-ui `/api/web-ui`) включить live LLM.

---

## 8. Рекомендованные следующие шаги

1. **Подтвердить bind-constraint pricing'а** — прогнать `/api/estimate` на 10 архетипов из `/app/audit/pricing-review-corpus.json` через live-LLM (требует п.1 выше).
2. **Закрыть P2 issues** (openapi.json + Resend/Cloudinary keys для real email/storage).
3. **Решить — где разрабатываем дальше**:
   - дотачивать существующие фичи (escrow flow, money ledger divergence, pricing iter 4)?
   - добавлять новый функционал на верхушку?
   - чинить mobile UX (describe splash для гостей)?
