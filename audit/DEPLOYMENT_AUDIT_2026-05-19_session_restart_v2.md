# DEPLOYMENT + REPOSITORY AUDIT — Session Restart (v2)

**Дата:** 19 мая 2026
**Контекст:** свежее развёртывание `github.com/svetlanaslinko057/dwdqwdqwdqwdqw` в пустой контейнер `/app` + полный аудит репозитория «ATLAS DevOS / EVA-X».

---

## 0. TL;DR

✅ **Проект развёрнут и работает end-to-end.** Backend, MongoDB, Expo — RUNNING.
✅ **Сидинг применён:** 5 quick-access юзеров + 6 разработчиков + 89 модулей + 81 QA-решение + 14-дневный replay.
⚪ **Web (CRA)** — собран в `/app/web/build/`, **не запущен как dev-сервер** (CRA не поддерживается в preview, обслуживается FastAPI через `/api/web-ui/*` если включено в server.py).
🟡 **3rd-party интеграции** (Stripe, WayForPay, Cloudinary, Resend, Google OAuth, OpenAI/LiteLLM) — все в **MOCK-режиме**, ждут ключей.

| Слой | LoC / # | Статус |
|---|---|---|
| `backend/server.py` | 26 916 строк | ✅ RUNNING |
| Backend total Python | 111 файлов / ~75K LoC | ✅ |
| REST endpoints (OpenAPI) | **682** | ✅ |
| MongoDB collections | **37** | ✅ |
| Expo mobile screens (`.tsx`) | **93** | ✅ bundled (1561 modules) |
| Web (CRA + Tailwind + Radix) | 225 JS/JSX + build артефакт | ⚪ статичный билд |
| Background loops | 5 (Event / Guardian / Module / Operator / Autonomy) | ✅ активны |

**External preview URL:** `https://mobile-showcase-expo.preview.emergentagent.com`

---

## 1. Что было сделано в этой сессии

1. Клонирован репозиторий → `/tmp/repo` (142 MB).
2. Синхронизирован `/tmp/repo → /app` через `rsync` (исключены `.git`, `.emergent`, `node_modules`, `backend/.env`, `frontend/.env`, чтобы сохранить protected configs).
3. Освобождён диск: удалены `.metro-cache` (331M), pip cache (~3 GB), `/tmp/repo`.
4. `pip install -r backend/requirements.txt` в `/root/.venv` (137 пакетов: socketio, stripe, sentence-transformers, litellm, resend, pyotp, qrcode, beautifulsoup4, …).
5. `yarn install` в `/app/frontend` (восстановлены axios, socket.io-client, expo-audio, expo-auth-session, expo-location, expo-notifications, expo-document-picker, expo-image-picker, expo-clipboard, expo-crypto, expo-device, @expo-google-fonts).
6. `supervisorctl restart backend expo` → оба сервиса RUNNING; mongod уже работал.
7. Автоматический seed при старте backend (mock_seed + tester + seed_replay 14d).

---

## 2. Архитектура (по факту в коде)

### Backend (FastAPI + Motor/MongoDB)
- **Точка входа:** `backend/server.py` (26 916 строк).
- **22 слоя** подключены как роутеры: `acceptance_layer`, `account_layer`, `admin_*` (×11), `assignment_engine`, `auto_guardian`, `autonomy_layer`, `client_*` (×7), `decision_layer`, `decomposition_engine`, `developer_*` (×5), `earnings_layer`, `escrow_layer`, `event_engine`, `execution_intelligence` (3 098 LoC — самый большой слой), `flow_control`, `funnel_events`, `google_auth`, `hidden_ranking`, `intelligence_layer`, `legal_contract_layer`, `mobile_adapter`, `module_execution`, `module_motion`, `money_*` (×3: divergence, ledger, runtime), `operator_engine`, `overdue_engine`, `payout_layer`, `pricing_engine`, `qa_layer`, `reputation_decay`, `scaling_engine`, `system_truth`, `team_*` (×4), `time_tracking_layer`, `two_factor`, `validation_campaigns`, `work_execution`.
- **Интеграции (`backend/integrations/`):** registry-pattern, файлы: cloudinary_service.py, email_service.py (Resend), google_auth.py, payment_providers/{stripe,wayforpay,mock}, push_sender.py, stt_service.py. Все — **MOCK** до подачи ключей.
- **Фоновые петли** (стартуют в `lifespan`):
  - GUARDIAN — каждые 120 с
  - MODULE MOTION — каждые 15 с
  - OPERATOR SCHEDULER — каждые 300 с
  - EVENT ENGINE — каждые 15 мин
  - AUTONOMY scan + INTELLIGENCE recompute

### Web (`/app/web/`, CRA + Tailwind + Radix)
- 225 JS файлов в `src/`; 4 поверхности: client, admin (+v2), developer, ui-kit.
- Билд лежит в `/app/web/build/static/{css,js}` и **подмаунчен FastAPI** под `/api/web-ui/*` (см. `homepage: "/api/web-ui"` в `web/package.json`).
- ⚠️ Standalone CRA dev-server **не поднимается** в preview-окружении — это by design.

### Mobile / Expo (`/app/frontend/`)
- Expo SDK 54, **expo-router** (file-based), 93 экрана `.tsx`.
- Кабинеты:
  - **Client** (`app/client/*`): home, activity, billing, contracts, deliverables, modules, payment-plan, profile, referrals, support, validation, versions.
  - **Developer** (`app/developer/*`): home, acceptance, earnings, feedback, growth, leaderboard, market, modules, notifications, profile, support, time-logs, validation, wallet, work.
  - **Admin cockpit** (`app/admin/*`): home, qa, validation, finance, profile + 8 drill-down (users, team, contracts, templates, integrations, inbox, marketplace, master, control, execution-console, projects).
  - Общие: auth, welcome, gateway, describe, estimate-result, estimate-improve, hub, chat, documents, profile, inbox, help, account, two-factor-setup, contract-sign.
- Realtime: `socket.io-client` 4.8.1.
- Native API: expo-audio, expo-image-picker, expo-document-picker, expo-notifications, expo-location, expo-clipboard.

---

## 3. Smoke-проверки текущей сессии

```
GET  /api/                                  → 200  {"message":"Development OS API","version":"1.0.0"}
GET  /openapi.json paths count              → 682
GET  /docs                                  → 200
POST /api/auth/login admin@atlas.dev        → 200  user_347123a1a96e, role=admin
POST /api/auth/login client@atlas.dev       → 200  user_f20cc00035c0, role=client
POST /api/auth/login john@atlas.dev         → 200  user_8b9a836553da, role=developer
POST /api/auth/login tester@atlas.dev       → 200  user_527c821ca272, role=tester
MongoDB collections                         → 37
Expo dev server (port 3000)                 → 200  (bundled 1561 modules)
Web preview EVA-X landing                   → ✅ рендерится (Build real products. Not tasks.)
```

Supervisor:
```
backend            RUNNING
expo               RUNNING
mongodb            RUNNING
nginx-code-proxy   RUNNING
```

---

## 4. Тестовые учётки (созданы `mock_seed`)

| Роль | Email | Пароль |
|---|---|---|
| Admin | admin@atlas.dev | admin123 |
| Developer | john@atlas.dev | dev123 |
| Client | client@atlas.dev | client123 |
| Multi-role (dev+client) | multi@atlas.dev | multi123 |
| Tester | tester@atlas.dev | tester123 |

Плюс 6 разработчиков (alice / marco / priya / luka / sara / diego), demo-project «Acme Analytics Platform» (3 модуля), 14 дней replay (override / qa_fail / reassign / overload / suppression).

---

## 5. Состояние ключевых доменов (по аудитам в `/audit/`)

| Домен | Готовность | Стучные риски |
|---|---|---|
| **Auth (JWT + cookie + OTP + 2FA)** | ~95% | Resend в моке → ссылки восстановления только в логах |
| **Money / Escrow / Payouts** | ~90% | См. `audit/MONEY_AUTHORITY_CHARTER.md`, `MONEY_STATE_MACHINE.md`. Все провайдеры в моке |
| **Assignment Engine** | ~95% | Параметры balancer'а зашиты в код — нужен admin UI калибровки |
| **QA / Acceptance** | ~95% | Полишинг `AdminFlagReviewModal` |
| **Pricing Engine** | ~95% | `PRICING_STABILIZATION_2026-05-18` зафиксировал divergence-окно |
| **Execution Intelligence** | ~90% | 3098 LoC, монолитный — кандидат на декомпозицию |
| **Mobile (Expo)** | ~92% | Client/Developer завершены; Admin = cockpit-only by design |
| **Web (CRA)** | ~95% | Build готов, ждёт реальных API-ключей |
| **Runtime client migration** | ✅ **100%** | Завершено в прошлой сессии (см. `RUNTIME_CLIENT_MIGRATION_COMPLETE.md`) |

---

## 6. Gap-list и риски

**Критичные (блокеры прод-релиза):**
1. **Все 3rd-party интеграции в моке.** Нет реальных ключей для Stripe, WayForPay, Cloudinary, Resend, Google OAuth, OpenAI/LiteLLM, HuggingFace. Без них: нет писем, нет реальных платежей, нет загрузки файлов, LLM-фичи на заглушках.
2. **HuggingFace warning** в логах (sentence-transformers `all-MiniLM-L6-v2` грузится без `HF_TOKEN`). Работает, но при рейт-лимите может фолить.

**Средние:**
3. `execution_intelligence.py` — 3098 LoC, требует декомпозиции на 3–4 подмодуля.
4. `mock_seed.py` non-idempotent: при каждом рестарте растут счётчики `replay_*` коллекций.
5. `web/build/` не персистится через git LFS — каждый redeploy требует `yarn build`.
6. Frontend `package.json` стартовый скрипт `"start": "expo start --web --port 3000"` — supervisor же использует `--tunnel --port 3000`. Несоответствие, но не блокер.

**Низкие:**
7. Логи backend засоряются хешами эмбеддингов при холодном старте.
8. В `audit/` 64 файла — много исторических версий (cleanup кандидат).

---

## 7. Открытые stage-decisions (наследие предыдущих сессий)

| # | Вопрос | Дефолт | Статус |
|---|---|---|---|
| 1 | Expo-admin parity с web-admin? | Cockpit-only (5 surfaces + 8 drill-down read-mostly) | ✅ решено в `product-scope-freeze-amend-1.md` |
| 2 | Expo-tester (Stage 4)? | Не делать — заменено на capability-flag внутри client/developer | ✅ retired |
| 3 | Runtime-client migration? | Завершить codemod axios → runtime | ✅ закрыто в прошлой сессии |
| 4 | Boot real integrations? | Подождать ключей от заказчика | 🟡 OPEN |

---

## 8. Next-action рекомендации (по убывающей)

1. **Получить ключи** для priority integrations (Resend → почта, Stripe/WayForPay → платежи, Cloudinary → файлы, Google OAuth → social login). После этого `INTEGRATIONS seed` в `admin_integrations.py` подхватит реальные клиенты.
2. **HF_TOKEN** в `.env` backend для стабильной загрузки эмбеддингов.
3. **Idempotent seed:** добавить guard в `mock_seed.py` (skip if `db.seed_log.find_one({label: "boot_replay_v1"})`).
4. **Декомпозиция** `execution_intelligence.py` (3 098 LoC → 3 модуля).
5. **Архив `/audit/`:** перенести `*_2026-05-17*`, `*_2026-05-18*` в `audit/archive/` (оставить только последний DEPLOYMENT_AUDIT и текущий MONEY/SCOPE charter).
6. **CI smoke** на 5 ролей логина + по 1 GET в каждом cabinet (admin/client/dev/tester).
7. Подключить Emergent-managed Google OAuth для guest→client конверсии.

---

## 9. Полный inventory — кратко

```
/app/
├── backend/           (111 .py файлов, 75K LoC, 22 слоя, server.py 27K LoC)
├── frontend/          (Expo SDK 54, 93 экрана, expo-router)
├── web/               (CRA build, 225 JS файлов, /api/web-ui/*)
├── packages/          (design-system, runtime-client)
├── memory/            (PRD.md 335 строк, PRD_2026-05-19.md)
├── audit/             (64 файла — баланс/charter/probe/deploy reports)
├── docs/              (charters, observation snapshots, runtime-contracts)
├── scripts/           (probe/smoke/replay/rebuild утилиты)
├── tools/             (stage_3_*.py heatmap/baseline)
└── tests/             (backend test fixtures)
```

---

**Аудит завершён.** Система готова для следующего шага — жду указаний от пользователя, какое направление разработки начать (новая фича, фикс, интеграция реальных ключей, доработка какого-либо слоя).
