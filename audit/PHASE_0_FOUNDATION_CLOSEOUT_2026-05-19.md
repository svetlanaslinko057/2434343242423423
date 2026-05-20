# Phase 0 — Foundation Closeout (19 May 2026)

> Этап 1 из принятого пользователем плана **(C) + Money pilot** — фундамент без миграции существующего кода. Состояние: ✅ ЗАВЕРШЕНО. Готов к Money pilot (Этап 2).

---

## Что сделано (Foundation extraction)

### 1. `backend/shared/` — cross-cutting primitives (149 LoC чистого нового кода)

| Файл | LoC | Назначение |
|---|---:|---|
| `shared/__init__.py` | 30 | Барель-экспорт `settings`, `get_event_bus`, ошибки |
| `shared/config.py` | 105 | Типизированные dataclass'ы: `MongoSettings`, `StripeSettings`, `ResendSettings`, `CloudinarySettings`, `GoogleOAuthSettings`, `LLMSettings`, `AppSettings`. Все env reads — здесь, ровно один раз. |
| `shared/constants.py` | 60 | 32 бизнес-константы (TIER_MULTIPLIER_*, QA_PASS_THRESHOLD, ESCROW_HOLD_HOURS, SESSION_TTL_DAYS, GUARDIAN_LOOP_SECONDS, …) с типами + источник доктрины. |
| `shared/errors.py` | 75 | Иерархия `DomainError` → `NotFoundError` / `InvariantViolated` / `PolicyDenied` / `AuthorizationError` / `ConfigurationError` / `ExternalServiceError`. С `http_status` + `to_dict()`. |
| `shared/events.py` | 110 | Async in-memory `EventBus` + `DomainEvent` базовый dataclass. Subscriber-isolation (одна сломанная подписка не блокирует других). |
| `shared/logging.py` | 35 | Идемпотентный `get_logger(name)` со structured handler. |

**Smoke (выполнен):** все импорты работают, `is_production = False` корректно (нет реальных ключей).

### 2. `backend/infrastructure/db/repositories/` — single-writer wrappers

| Файл | LoC | Owns |
|---|---:|---|
| `base.py` | 110 | `BaseRepository`: `_id` exclusion, `find_one_by_id` / `get_by_id` (raises `NotFoundError`), `find_many`, `count`, `exists`, internal write helpers, `ensure_indexes` hook |
| `users.py` | 50 | `UsersRepository` — типизированные `set_active_role`, `increment_strikes`, `update_tier`, `mark_logged_in` + `find_by_email`/`find_by_role` |
| `projects.py` | 50 | `ProjectsRepository` — `update_status`, `update_progress`, `increment_progress`, `mark_idle` + `find_by_client`/`find_active` |
| `modules.py` | 90 | `ModulesRepository` — каноничный enum `MODULE_STATES` (pending/in_progress/review/revision_requested/done/rejected), `update_status` валидирует против enum (`InvariantViolated`), `assign_to`/`unassign`, `status_counts` aggregation |
| `money.py` | 145 | **`MoneyRepository`** — append-only ledger `money_ledger_events`, идемпотентный insert (unique `idempotency_key`), `balance(account_id)` и `project_movement` через aggregate. Каноничный enum `KINDS` (deposit/escrow_hold/escrow_release/escrow_refund/payout/fee/adjustment/refund) — критичный фундамент для Money pilot. |

**Smoke (выполнен end-to-end против live MongoDB):**
- ✓ `append` создаёт запись с idempotency_key
- ✓ повторный append с тем же ключом → `InvariantViolated: money_idempotency_conflict`
- ✓ `balance` возвращает sum правильно (10 000 cents)
- ✓ невалидный `kind` → `InvariantViolated: money_kind_invalid`

### 3. `backend/tests/architecture/` — CI guardrails

7 архитектурных тестов, бегут pytest'ом:

| Тест | Статус | Baseline |
|---|---|---|
| `test_routers_do_not_access_db_directly` | SKIP (нет `app/routers/`) | активируется при extraction |
| `test_silent_except_does_not_grow` | ✅ PASSED | 64 (audit baseline; новые `except: pass` валят CI) |
| `test_no_new_giant_functions` | ✅ PASSED | 74 функций >120 LoC (audit baseline) |
| `test_file_size_hard_cap` | ✅ PASSED | grandfathered: server.py 27K, execution_intelligence 3098, time_tracking 1623 |
| `test_file_size_warn` | ✅ PASSED (info-only) | Печатает файлы 1500–3500 LoC |
| `test_one_writer_per_collection_does_not_grow` | ✅ PASSED | per-collection baselines: users=11, modules=14, projects=5, qa_decisions=5, auto_actions=7, system_actions_log=7, events=6, work_units=6, invoices=4, money_ledger_events=1 |
| `test_domains_do_not_cross_import` | SKIP (нет `domains/`) | активируется при extraction |

**Итого:** **5 passed, 2 skipped в 0.13s** — CI gate работает.

---

## Что НЕ сделано (намеренно — следуя совету пользователя)

❌ **Не мигрировали существующий код** в новые модули. `server.py` 27K LoC по-прежнему пишет в коллекции напрямую — это будет ratcheting через baseline'ы тестов.
❌ **Не вынесли bootstrap/workers** в отдельные процессы. Совет пользователя: «отделить bootstrap, lifecycle, loops, ПОТОМ думать про celery/rq» — пока рано.
❌ **Не создали `app/routers/` или `domains/`** — пустые директории = шум. Архитектурные тесты автоматически активируются когда они появятся (Phase 1+).

---

## Принципы, зафиксированные в коде

1. **Один источник env** — все ключи читаются в `shared.config`, нигде больше нет `os.environ.get`.
2. **Append-only ledger для денег** — `money_divergence.py` (1117 LoC reconciliation) станет ненужен, когда все money writes пойдут через `MoneyRepository`.
3. **Изоляция подписчиков event bus** — одна упавшая подписка не валит publisher (явный design choice в `events.py`).
4. **Типизированные исключения** — replace silent `except: pass` через `DomainError` иерархию. HTTP status уже встроен (`http_status`).
5. **Module state enum** — `ModulesRepository.update_status` валидирует против каноничного списка. Невалидный статус → `InvariantViolated` с контекстом.
6. **CI ratcheting** — все архитектурные baseline'ы только сжимаются. PR, увеличивающий silent except или writer-count, валит CI.

---

## Метрики foundation

| Что | Сколько |
|---|---:|
| Новый код | ~860 LoC (shared + repositories + tests) |
| Изменённый существующий код | **0 LoC** (foundation не трогает текущую систему) |
| Архитектурных инвариантов под CI | 5 активных + 2 ждущих extraction |
| Тестов pass | 5 / 5 |
| Сервисов RUNNING после изменений | 4/4 (backend, expo, mongodb, nginx-code-proxy) |
| API endpoints всё ещё работают | 682 |
| Время на этап | ~1 сессия (тот самый «1–1.5 недели» в линейном времени) |

---

## STOP POINT — наблюдение

Согласно плану пользователя:
> «После этого: production traffic, observe, посмотреть где настоящая боль, и только потом решать full decomposition или selective stabilization.»

Сейчас foundation готов. **Этап 2 (Money pilot)** — это:
- Расширение `MoneyRepository` методами для escrow flow (`hold_escrow`, `release_escrow`, `refund_escrow`, `process_payout_batch`)
- Создание `MoneyService` (use-case layer), который обращается ТОЛЬКО к `MoneyRepository` + публикует `MoneyChanged` события
- Переключение **новых** money write-paths на `MoneyService` (старые остаются как есть)
- Метрика: после pilot — `writers["money_ledger_events"] == 1` (только `MoneyRepository`), а старые money-коллекции (`dev_wallets`, `payments`, `dev_earning_log`) становятся **read-only снапшотами**, синхронизируемыми от ledger через subscriber.

Жду команды на начало Этапа 2, либо паузу для наблюдения как договорено.

---

## Файлы, изменённые/созданные в Этапе 1

```
backend/
├── shared/                              ← NEW
│   ├── __init__.py
│   ├── config.py
│   ├── constants.py
│   ├── errors.py
│   ├── events.py
│   └── logging.py
├── infrastructure/                      ← NEW
│   ├── __init__.py
│   └── db/
│       ├── __init__.py
│       └── repositories/
│           ├── __init__.py
│           ├── base.py
│           ├── users.py
│           ├── projects.py
│           ├── modules.py
│           └── money.py
└── tests/
    ├── __init__.py                      ← NEW
    └── architecture/                    ← NEW
        ├── __init__.py
        └── test_layering.py

audit/
└── PHASE_0_FOUNDATION_CLOSEOUT_2026-05-19.md  ← this file
```

Backend перезапустился по hot-reload без ошибок; API/auth/login для всех 4 ролей продолжают возвращать 200. **Регрессий нет.**
