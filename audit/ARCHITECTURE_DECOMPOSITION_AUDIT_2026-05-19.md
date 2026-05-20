# Архитектурный аудит — диагноз монолитности и план модульной декомпозиции

**Дата:** 19 мая 2026
**Цель:** объяснить, почему `server.py` разросся до 27K строк, и спроектировать модульную архитектуру, в которой будущие фичи живут внутри границ модуля без «наслоения логики».

---

## 0. TL;DR

`backend/server.py` (26 916 строк, 429 routes) — это **классический «God Module» / Big Ball of Mud**. 22 «слоя» рядом с ним технически выглядят как декомпозиция, но при ближайшем рассмотрении это **router-shim-ы**: бизнес-логика, миграции данных, side-effects и магические числа всё равно живут в `server.py`. У 22 слоёв нет общих границ — они **пишут в одни и те же коллекции MongoDB** (db.modules → пишут 14 файлов, db.users → 11, db.auto_actions → 7), что делает любое изменение fan-out'ом по всему репозиторию.

**Корневые причины:**
1. **Decorator-driven coupling** — `@router.get(...)` инлайнит бизнес-логику прямо рядом с HTTP-маршрутом ⇒ нет уровня «service / use-case».
2. **Shared mutable database** без bounded contexts — любая коллекция доступна всем, инварианты невозможно гарантировать локально.
3. **Domain creep** — `server.py` собирает 30+ доменов под одной крышей (auth + pricing + escrow + QA + assignment + WebSocket + admin + portfolio seed + WayForPay callback + alert engine + …).
4. **«Layer» = file naming convention, не архитектурная единица.** `admin_*` (10 файлов), `client_*` (7), `team_*` (4) — все импортируют общие helpers из `server.py` и пишут в общие коллекции.
5. **Background loops, seed-данные, ML embeddings, payment callbacks** — всё стартует из одного `@app.on_event("startup")` размером **748 строк**.

**Risk сегодня:** одно изменение в pricing engine может незаметно сломать assignment, money ledger или admin dashboard, потому что они читают/пишут одни и те же документы и нет контрактов между ними.

---

## 1. Метрики монолитности

### 1.1. Размеры

| Артефакт | LoC | Routes | Имеет ли границы? |
|---|---:|---:|---|
| `server.py` | **26 916** | **429** | ❌ ни одна |
| `execution_intelligence.py` | 3 098 | 19 | ⚠ один файл, но 14 коллекций |
| `time_tracking_layer.py` | 1 623 | 0 | helper-only |
| `earnings_layer.py` | 1 277 | 0 | helper-only |
| `money_divergence.py` | 1 117 | 6 | ⚠ дублирует money_ledger |
| `mobile_adapter.py` | 1 115 | 0 | ⚠ 10 импортов |
| `admin_mobile.py` | 1 092 | 13 | мобильный фасад над admin |
| `work_execution.py` | 1 004 | 0 | helper-only |
| `legal_contract_layer.py` | 992 | 10 | ⚠ 13 импортов |
| **Все остальные 100+ файлов** | <800 LoC каждый | разное | разное |

**Распределение routes:** `/admin/*` 178 (42%) | `/developer/*` 57 | `/client/*` 51 | `/ai/*` 15 | + 24 других префикса.

### 1.2. Жирные функции внутри `server.py`

| LoC | Линия | Имя |
|---:|---:|---|
| **748** | 9527 | `startup_event` ← seed + indexes + 5 background loops |
| **516** | 441 | `leave` (socket.io handler) |
| **269** | 23304 | `estimate_project` |
| **234** | 20186 | `get_project_war_room` |
| 225 | 13924 | `wayforpay_callback` ← payment provider inline |
| 222 | 8442 | `run_alert_engine` |
| 212 | 22004 | `_current_priority` |
| 207 | 26313 | `_web_ui_root` |
| 199 | 23784 | `module_qa_decision` |
| 198 | 7728 | `get_control_center_overview` |

→ **25+ функций больше 100 строк** в одном файле = классический симптом «логика инлайнится в HTTP-handler».

### 1.3. Крупнейшие именованные секции `server.py`

| LoC | Routes | Линия | Что это |
|---:|---:|---:|---|
| 1198 | 8 | 25124 | (без названия, начинается с `=`) |
| 953 | 3 | 9330 | SERVICE REQUEST DISTRIBUTION |
| 778 | 7 | 23003 | L3 — ESTIMATE (unified pricing + decomposition preview) |
| 718 | 6 | 15080 | TIER SYSTEM |
| 683 | 12 | 7042 | DOMINANCE LAYER ENDPOINTS |
| 627 | 5 | 23781 | MODULE QUALITY SYSTEM (Phase 3) |
| 555 | 6 | 22210 | END CLIENT ACTIVITY |
| 547 | 16 | 2868 | CLIENT WORKSPACE 2.0 (Блок 5) |
| 535 | 14 | 11188 | ADMIN: per-module dev_reward control |
| 521 | 0 | 1150 | CLIENT TRUST ENGINE |
| 497 | 1 | 21713 | CLIENT ACTIVITY — OPERATOR PANEL |
| 482 | 8 | 14207 | GROWTH ENGINE — REFERRAL |
| 479 | 7 | 2185 | PASSWORD RESET |
| 437 | 6 | 7725 | ADMIN CONTROL CENTER |
| 429 | 8 | 8901 | PROVIDER INBOX + PRESSURE ENGINE |
| 423 | 5 | 13784 | WAYFORPAY MOCK |
| ... | ... | ... | (171 секционных маркеров всего) |

⇒ **93% содержимого `server.py` — это именованные секции**, которые должны были стать отдельными модулями, но застряли в одном файле.

### 1.4. Shared mutable state (FAN-IN на коллекции)

Один и тот же документ MongoDB записывают много модулей. Это разрушает encapsulation:

| Коллекция | Файлов-писателей | Кто пишет |
|---|---:|---|
| `db.modules` | **14** | admin_control, admin_mobile, auto_guardian, autonomy_layer, client_operator, decomposition_engine, ... |
| `db.users` | 11 | admin_system, escrow_layer, google_auth, intelligence_layer, mock_seed, reputation_decay, ... |
| `db.auto_actions` | 7 | admin_control, auto_guardian, autonomy_layer, client_acceptance, module_execution, ... |
| `db.system_actions_log` | 7 | admin_mobile, admin_system, execution_intelligence, server, ... |
| `db.events` | 6 | autonomy_api, escrow_api, event_engine, intelligence_api, server, team_api |
| `db.work_units` | 6 | acceptance_layer, autonomy_layer, qa_layer, server, team_layer, time_tracking_layer |

⇒ Изменение поля у `module.status` требует обновления в 14 местах. Тип-чекер не помогает, потому что Mongo schemaless.

### 1.5. Domain naming — фрагментация одного домена по N файлам

| Domain | Файлов | LoC | Симптом |
|---|---:|---:|---|
| **Money** | 10 | ~5 200 | `money_ledger` 219 LoC + `money_runtime` 365 + `money_divergence` 1117 + `escrow_layer` 472 + `escrow_api` 278 + `client_escrow` 143 + `payout_layer` 547 + `earnings_layer` 1277 + `init_earnings_collections` 158 — три параллельных «правды» о деньгах |
| **Admin** | 10 | ~6 000 | actions / control / integrations / llm_settings / mobile / production / risk / system / team / users — каждый файл это сборная солянка |
| **Client** | 7 | ~3 500 | acceptance / costs / escrow / operator / operator_opportunities / transparency / workspace — `operator` дублируется в 4 файлах |
| **Team** | 4 | ~1 800 | api / balancer / intelligence / layer |
| **Developer** | 4 | ~2 000 | brain / economy / intelligence / support |

### 1.6. Дублирование «service contract» паттерна

```
init_router         встречается в 22 файлах
build_router        встречается в 21 файле
wire                встречается в 17 файлах
ensure_indexes      встречается в 8 файлах
```

⇒ Нет единого DI-контейнера. Каждый «слой» вручную регистрирует свой router через `wire(app, db)`, что приводит к 22 разным сигнатурам и 22 разным жизненным циклам.

---

## 2. Корневые причины разрастания (root cause analysis)

### RC-1. **HTTP-handler как место для бизнес-логики**

```python
@router.post("/api/admin/modules/{module_id}/qa-decision")
async def module_qa_decision(...):  # 199 строк
    # читает 5 коллекций
    # пишет в 3
    # вызывает event_engine
    # начисляет earnings
    # шлёт socket.io событие
    # обновляет dev_wallet
    # пересчитывает confidence
```

В правильной архитектуре handler — это **~10 строк адаптер**: парсинг → вызов use-case → сериализация. Сегодня handler ЕСТЬ use-case.

### RC-2. **Нет границ доменов (DDD / Bounded Context)**

Money / Assignment / QA / Pricing / Estimate / Escrow / Payout / Earnings — все они читают и пишут одни и те же документы (`modules`, `users`, `work_units`). Контракты между ними не существуют в виде интерфейсов — они существуют в виде неписанных соглашений о форме документа Mongo.

### RC-3. **Background concerns смешаны с request-time**

`startup_event` (748 строк):
- Сидит portfolio cases, demo project, scope templates, integrations registry, system_config, admin user, 6 dev pool users, 89 modules, 81 qa decisions, 14-day replay
- Создаёт ~15 индексов
- Запускает 5 background loops (Guardian / Module Motion / Operator / Event / Autonomy)
- Загружает `sentence-transformers/all-MiniLM-L6-v2` (lazy)

Любой из этих шагов может сломать запуск приложения. Нет отдельного `bootstrap`/`seeder`/`scheduler` процесса.

### RC-4. **Magic numbers и инлайн-формулы**

~110 числовых констант разбросаны по `server.py` (`tier_multiplier = 1.5`, `qa_threshold = 0.7`, `escrow_hold_hours = 48`, ...). Эти константы — это **бизнес-правила**, которые должны:
- Жить в БД (`db.pricing_config`, `db.system_config`) — что частично сделано;
- ИЛИ в `config/*.py` с типами и описанием.

Сейчас они и в `server.py` инлайн, и в БД, и в `pricing_engine.py` — три источника правды.

### RC-5. **61 silent except**

61 `except: pass` блокирует видимость ошибок. Это значит, что в проде ошибки в money/QA/assignment-цепочках **могут глотаться** и проявляться через два цикла petli (event_engine увидит rogue state, попытается reconcile, и так пять раз пока человек не заметит).

### RC-6. **«Слой» — это HTTP router, не bounded context**

Файл `execution_intelligence.py` (3098 LoC) формально модуль, но он:
- читает 14 коллекций
- содержит 19 HTTP endpoint'ов
- одновременно реализует causal trace, override management, replay, calibration, conviction scoring, suppression detection, parallel-universes, topology, memory, timeline

⇒ 9 разных responsibilities в одном файле. Это **execution_intelligence** = «всё что у меня было ML-ового или аналитического — сюда». Это худший вариант декомпозиции: одно имя, девять concerns.

---

## 3. Текущая архитектура (как есть)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FastAPI app (server.py 27K LoC)                  │
│  429 routes  +  748-line startup_event  +  socket.io  +  CORS       │
└──────────────────┬──────────────────────┬───────────────────────────┘
                   │ wire(app, db)         │ direct decorator
                   ▼                       │
   ┌───────────────────────────────┐       │
   │  22 «router files»            │       │
   │  (admin_*, client_*, ...)     │       │  все ходят в одну
   │  Каждый знает db напрямую     │       │  и ту же MongoDB
   └───────────────┬───────────────┘       │
                   │                       │
                   ▼                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                MongoDB (37 коллекций, все shared, schemaless)        │
│   modules │ users │ work_units │ projects │ invoices │ qa_decisions │
│   events  │ auto_actions │ payouts │ escrows │ ... все доступны всем │
└─────────────────────────────────────────────────────────────────────┘

Background loops (запущены из startup_event):
  Guardian 120s  Module Motion 15s  Operator 300s  Event 15min  Autonomy
```

**Проблема:** все 22 «слоя» и 429 endpoint'ов **одного уровня абстракции** — все знают про БД, все impl-зависимы.

---

## 4. Целевая архитектура (как должно быть)

**Принципы:**
1. **Hexagonal (Ports & Adapters)** — HTTP, WebSocket, MongoDB, payment providers, email — всё это **adapters**. Бизнес-логика не знает о них.
2. **Bounded Context per domain** — каждый домен имеет свой набор моделей, свой repo, свои use-cases, свои события. Внутрь домена нельзя писать снаружи (только через events).
3. **CQRS lite** — write-side через use-case с инвариантами; read-side через query-проекции (denormalised для скорости UI).
4. **Domain events** — Money / QA / Assignment общаются через события (`module.qa_passed`, `invoice.paid`), а не через прямой импорт + db write.
5. **Single repo per collection** — на коллекцию ОДИН класс-репозиторий с типизированным API. Никаких `db.modules.update_one(...)` в 14 местах.

### 4.1. Целевая структура

```
backend/
├── app/                              ← FastAPI application layer
│   ├── main.py                       ← thin entry (≤200 строк)
│   ├── routers/                      ← только HTTP adapters
│   │   ├── auth.py
│   │   ├── client.py
│   │   ├── developer.py
│   │   ├── admin.py
│   │   └── ws.py                     ← socket.io
│   └── deps.py                       ← FastAPI Depends factories
│
├── domains/                          ← bounded contexts (бизнес-логика)
│   ├── identity/                     ← users, roles, auth, 2FA
│   │   ├── models.py                 ← pydantic + invariants
│   │   ├── repo.py                   ← UserRepository
│   │   ├── service.py                ← AuthService (login, register, otp)
│   │   └── events.py                 ← UserRegistered, RoleChanged
│   ├── projects/                     ← project / module / decomposition
│   │   ├── models.py
│   │   ├── repo.py
│   │   ├── decomposition.py
│   │   └── service.py
│   ├── pricing/                      ← estimate, tier, multipliers
│   │   ├── models.py
│   │   ├── rules.py                  ← constants here (no magic in routes)
│   │   └── service.py
│   ├── work/                         ← assignment, work_units, time_tracking
│   │   ├── models.py
│   │   ├── repo.py
│   │   ├── assignment.py
│   │   └── time_tracking.py
│   ├── qa/                           ← review, validation, acceptance
│   │   ├── models.py
│   │   ├── service.py
│   │   └── flag_review.py
│   ├── money/                        ← escrow, ledger, payouts, invoices
│   │   ├── models.py
│   │   ├── ledger.py                 ← единственный источник правды
│   │   ├── escrow.py
│   │   ├── payouts.py
│   │   └── invoices.py
│   ├── intelligence/                 ← разделить execution_intelligence.py на:
│   │   ├── causal_trace.py
│   │   ├── overrides.py
│   │   ├── replay.py
│   │   ├── conviction.py
│   │   └── topology.py
│   └── communications/               ← chat, notifications, push, email
│       ├── notifications.py
│       └── messages.py
│
├── infrastructure/                   ← adapters наружу
│   ├── db/
│   │   ├── client.py                 ← Motor client
│   │   ├── indexes.py                ← все индексы здесь
│   │   └── repositories/             ← по одному файлу на коллекцию
│   ├── payments/
│   │   ├── stripe.py
│   │   ├── wayforpay.py
│   │   └── mock.py
│   ├── email/                        ← Resend adapter
│   ├── storage/                      ← Cloudinary adapter
│   ├── llm/                          ← OpenAI / Litellm adapter
│   └── realtime/                     ← Socket.IO adapter
│
├── workers/                          ← фоновые петли отдельно от app
│   ├── guardian.py
│   ├── module_motion.py
│   ├── operator_scheduler.py
│   ├── event_engine.py
│   └── autonomy.py
│
├── bootstrap/                        ← seed + migrations + indexes
│   ├── seed.py                       ← idempotent seed (was mock_seed.py)
│   ├── migrations/
│   └── indexes.py
│
├── shared/                           ← cross-cutting
│   ├── events.py                     ← in-memory event bus (later: redis)
│   ├── errors.py                     ← typed exceptions
│   └── config.py                     ← single source of truth for constants
│
└── tests/
    ├── unit/                         ← domain logic без БД
    ├── integration/                  ← с БД
    └── e2e/                          ← через HTTP
```

### 4.2. Целевая зависимость слоёв (acyclic)

```
            routers/  ───→ domains/ (через service interface)
                              │
                              ▼
                       domains/services/
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        infrastructure/   shared/      domain.events
        (db, payments,   (config,         publish
        email, llm)      errors)              │
                                              ▼
                                       другие домены
                                       (через subscribers)
```

**Никогда:**
- ❌ `routers/` пишет в `db` напрямую
- ❌ `domains/X/` импортирует `domains/Y/` (только через events)
- ❌ `infrastructure/` импортирует `domains/` (наоборот)

---

## 5. Что закрывает каждый принцип

| Симптом сегодня | Закрывается принципом |
|---|---|
| 199-строчные HTTP handlers | Hexagonal — handler становится 10-строчным адаптером, логика в `service.py` |
| db.modules пишут 14 файлов | Single repo per collection — только `ModuleRepository.update_status()` |
| 3 источника правды о деньгах | One bounded context `domains/money/` с единым `Ledger` |
| 61 silent except | Typed exceptions в `shared/errors.py`, raise→catch на границах |
| 110 магических чисел | `shared/config.py` + БД-overrides только для tunable params |
| 748-line startup_event | Разделить на `bootstrap/seed`, `infrastructure/db/indexes`, `workers/start_all` |
| Cross-layer импорты (10 в mobile_adapter) | События вместо импортов: `MoneyChanged` слушает 4 модуля, никто никого не импортирует |
| execution_intelligence 3098 LoC | 9 отдельных файлов в `domains/intelligence/` по одному concern |

---

## 6. Фазированный план миграции (без даунтайма)

### Фаза 0 — Подготовка (1 неделя)
1. **Внедрить `shared/events.py`** — простой in-memory event bus с типизированными событиями (без redis для старта).
2. **Внедрить `shared/config.py`** — собрать все магические числа (110 шт) в типизированные dataclass'ы. Бизнес-правила остаются в БД (pricing_config), но defaults и hardcode = здесь.
3. **Создать `infrastructure/db/repositories/`** — по одному `*Repository` классу на топ-7 коллекций (users, modules, work_units, projects, invoices, qa_decisions, events).
4. **Добавить `shared/errors.py`** — `DomainError`, `NotFoundError`, `InvariantViolated`, `PolicyDenied`. Запретить новые `except: pass`.

### Фаза 1 — Extract Money (1.5 недели) ⚡ самый рискованный домен первым
Объединить **10 файлов money/escrow/payout/earnings/billing** в `domains/money/`:
- `Ledger` (один writer для дельт балансов)
- `Escrow` (state machine с инвариантами)
- `Payouts` (batch + idempotent)
- `Invoices`
- Все остальные модули обращаются ТОЛЬКО к `MoneyService` или подписываются на `MoneyChanged` event.

Доказательство успеха: `money_divergence.py` (1117 LoC reconciliation) **удаляется**, потому что divergence невозможен — есть один writer.

### Фаза 2 — Extract Identity / Auth (1 неделя)
- `domains/identity/` + `infrastructure/email/`, `infrastructure/oauth/`
- `password_reset`, `2fa`, `google_auth`, `auth_otp` объединяются под одним сервисом.

### Фаза 3 — Extract Projects + Pricing (1.5 недели)
- `domains/projects/` (project / module / decomposition)
- `domains/pricing/` (estimate / tier / multipliers)
- 778 LoC секции «L3 — ESTIMATE» вырезается из `server.py`.

### Фаза 4 — Extract Work + QA (1.5 недели)
- `domains/work/` (assignment, time_tracking, work_units)
- `domains/qa/` (acceptance, validation, flag review)
- `assignment_engine.py` + `team_balancer.py` + `team_intelligence.py` объединяются.

### Фаза 5 — Decompose Intelligence (1 неделя)
- Разрезать `execution_intelligence.py` (3098 LoC) на 9 файлов по одному concern:
  causal_trace / overrides / replay / conviction / suppression / topology / memory / timeline / calibration.

### Фаза 6 — Extract Communications + Workers (1 неделя)
- `domains/communications/` (chat, notifications, push, email)
- `workers/*` — петли выносятся в отдельные процессы (под supervisor program), что позволяет:
  - Перезапускать workers без рестарта API
  - Масштабировать workers независимо

### Фаза 7 — Slim server.py (1 неделя)
После всех extractions `server.py` должен сократиться до **<3000 LoC** (только thin routers + DI wiring). Если больше — это сигнал, что extraction неполная.

**Итого:** ~9 недель работы одного senior-разработчика, либо ~4 недели команды из 3.

---

## 7. Защита от регрессии (контракт на будущее)

После рефакторинга нужны **архитектурные тесты** (CI gates):

```python
# tests/architecture/test_layering.py
def test_routers_never_touch_db_directly():
    """routers/*.py must not import motor / db / pymongo."""
    for f in routers_files():
        assert 'AsyncIOMotorClient' not in open(f).read()
        assert re.search(r'\bdb\.\w+\.', open(f).read()) is None

def test_no_cross_domain_imports():
    """domains/X/ cannot import from domains/Y/."""
    for x in domain_dirs():
        for y in domain_dirs():
            if x == y: continue
            assert f'from domains.{y}' not in source(x)

def test_one_writer_per_collection():
    """Each MongoDB collection must be written by exactly one repository."""
    for coll in mongo_collections:
        writers = grep_writers(coll)
        assert len(writers) <= 1, f'{coll} written by {writers}'

def test_no_silent_except():
    """except: pass is banned outside of shared/errors.py."""
    for f in py_files():
        if 'shared/errors.py' in f: continue
        assert 'except:\n        pass' not in open(f).read()
```

Эти 4 теста запускаются на pre-commit + CI и автоматически блокируют PR, которые ломают границы модулей. Это и есть «чтобы не наслаивалась логика».

---

## 8. Альтернатива — точечный strangler-pattern без полного рефакторинга

Если 9 недель — слишком, можно начать с **2 точечных decompositions** (минимальное вмешательство, максимальный эффект):

### Сценарий «Минимум»:
1. **Только Money domain** (фаза 1) — закрывает самый рискованный bounded context (деньги клиентов). 1.5 недели.
2. **Только `shared/config.py` + `infrastructure/db/repositories/` для топ-7 коллекций** — закрывает 80% shared-state проблемы. 1 неделя.
3. **Архитектурные тесты** (раздел 7) — предотвращает новые регрессии. 0.5 недели.

Итого: **3 недели**, и система перестаёт *усугублять* монолитность даже без полной декомпозиции.

---

## 9. Что НЕ нужно трогать (anti-patterns to avoid)

❌ **Не переписывать `server.py` сразу** — это вызовет регрессии в 429 routes одновременно.
❌ **Не вводить микросервисы** — текущий объём не оправдывает overhead. Hexagonal monolith — правильный outcome.
❌ **Не менять MongoDB на SQL** — это отдельный мега-проект. Сначала чистим архитектуру кода.
❌ **Не переписывать тесты сразу** — миграционная стратегия должна оставлять старые тесты зелёными до самой последней фазы.
❌ **Не запускать рефакторинг параллельно с фичами** — выделить рефакторинг-окно, иначе мерж-конфликты.

---

## 10. Метрики успеха (после рефакторинга)

| Метрика | Сейчас | Цель |
|---|---:|---:|
| `server.py` размер | 26 916 LoC | <3 000 LoC |
| `server.py` routes | 429 | <50 (только wiring) |
| Самый большой файл | 3 098 (execution_intelligence) | <800 |
| Самая длинная функция | 748 (startup_event) | <50 |
| Файлов-писателей `db.modules` | 14 | 1 (ModuleRepository) |
| `except: pass` | 61 | 0 (вне shared/errors.py) |
| Магических чисел в routes | ~110 | 0 |
| Время онбординга нового разработчика | дни | часы |
| Возможность параллельной работы 3+ команд | низкая | высокая |

---

## 11. Следующие действия (если решение принято)

1. **Сегодня:** утвердить план / выбрать сценарий (полный 9 недель vs минимум 3 недели).
2. **Неделя 1:** Фаза 0 — events, config, repositories, errors (фундамент).
3. **Неделя 2-3:** Money extraction (Фаза 1) — самый риск, самая ценность.
4. **Если устраивает темп — продолжить Фазы 2-7.**
5. **После Фазы 1:** ввести архитектурные тесты в CI (раздел 7), чтобы регрессии не появлялись.

---

**Аудит завершён.** Документ — основа для принятия решения о объёме рефакторинга. Жду команды на старт конкретной фазы.
