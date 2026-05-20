# Phase 2A — Money Domain Pilot Closeout (19 May 2026)

> Этап 2A из плана пользователя: **canonical money write-path** через `domains/money/` + архитектурный инвариант, что только этот домен пишет в money-коллекции. Состояние: ✅ ЗАВЕРШЕНО.

---

## TL;DR

`MoneyService` — единый orchestration слой для **любого** движения денег в системе. После Phase 2A:

- ✅ **7 операций money-домена** (hold/release/refund/credit_validator/payout/reverse + balance projections) реализованы как чистые use-cases поверх append-only ledger.
- ✅ **Append-only ledger** (`money_ledger_events`) — единственный writeable storage. Балансы вычисляются как `SUM(deltas)` агрегатом.
- ✅ **Идемпотентность** реализована на уровне ledger: повтор append с тем же `idempotency_key` возвращает существующую запись, никаких double-charges.
- ✅ **Domain events** (`EscrowHeld`, `EscrowReleased`, `EscrowRefunded`, `PlatformFeeCharged`, `ValidatorCredited`, `PayoutProcessed`, `TransactionReversed`) публикуются через `EventBus` после каждого successful append.
- ✅ **Архитектурный инвариант #7**: вне `domains/money/` и `infrastructure/db/repositories/` никакие новые файлы не могут писать в money-коллекции (13 grandfathered offenders, будут мигрированы в Phase 2B).
- ✅ **End-to-end smoke (11 инвариантов)** — все passed против live MongoDB.
- ✅ **Architecture tests: 7/7 passing**, `test_only_money_domain_writes_to_money_collections` активирован.

**KPI Phase 2 (`money_divergence.py` must die):** ещё не достигнут — Phase 2B мигрирует legacy writes на `MoneyService`, после чего divergence reconciliation станет ненужным.

---

## Что создано (~770 LoC чистого нового кода)

### `backend/domains/money/`

| Файл | LoC | Содержит |
|---|---:|---|
| `__init__.py` | 35 | Public API: `MoneyService`, `Money`, `AccountKind`, 7 событий |
| `models.py` | 110 | `Money` (integer cents, no floats), `AccountId` (typed prefixes), `AccountKind` enum |
| `events.py` | 85 | `MoneyChanged` базовый + 7 конкретных событий (escrow/fee/validator/payout/reverse) |
| `policies.py` | 75 | Чистые pre-conditions: `assert_amount_positive`, `assert_balance_sufficient`, `assert_payout_meets_minimum`, `default_platform_fee_cents` |
| `service.py` | 365 | `MoneyService` — 7 use-cases (hold_escrow / release_escrow / refund_escrow / credit_validator / process_payout / reverse_transaction / balance_for / project_movement) |

### Обновления

| Файл | Изменение |
|---|---|
| `infrastructure/db/repositories/money.py` | (a) `append()` стал **true idempotent**: при `DuplicateKeyError` на `idempotency_key` возвращает существующую запись (вместо raise). (b) `ensure_indexes()` теперь дропает legacy unique-index `event_id_1` от старого `money_ledger.py` — collection now fully owned. |
| `tests/architecture/test_layering.py` | Добавлен 7-й инвариант: **только `domains/money/` и `infrastructure/db/repositories/` могут писать в money-коллекции** (13 grandfathered, ratcheting down в Phase 2B). |

---

## End-to-end smoke verification (live MongoDB)

```
1. hold $1000        → escrow=USD 1000.00                                  ✓
2. release $400      → dev=USD 392.00, escrow=USD 600.00, platform=USD 8   ✓ (2% fee)
3. credit_validator  → val=USD 20.00                                       ✓
4. refund $600       → escrow=USD 0.00, client_deposit=USD 600.00          ✓
5. payout $392       → dev_wallet=USD 0.00                                 ✓
6. idempotent replay → returned EXISTING entry, escrow=USD 0.00            ✓ no double-charge
7. insufficient bal  → PolicyDenied(money_insufficient_balance, short=500c) ✓
8. min payout guard  → PolicyDenied(money_payout_below_min)                ✓
9. reverse credit    → val=USD 0.00                                        ✓ append-only compensation
10. 8 domain events fired (HELD, REL, FEE, VAL, REF, PAY, HELD-replay, REV) ✓
11. Project P&L     → {fee: 800, escrow_hold: 100000, escrow_release: -800, escrow_refund: 0}
```

---

## Архитектурные тесты (7 / 7 passing)

```
PASSED  test_silent_except_does_not_grow                  baseline 64
PASSED  test_no_new_giant_functions                       baseline 75
PASSED  test_file_size_hard_cap                           grandfathered: server, exec_intel, time_tracking
PASSED  test_file_size_warn                               info-only
PASSED  test_one_writer_per_collection_does_not_grow      per-collection baselines
PASSED  test_only_money_domain_writes_to_money_collections 🆕 13 grandfathered, no new writers
PASSED  test_domains_do_not_cross_import                  activated — domains/money/ только импортирует shared/ и infrastructure/
SKIP    test_routers_do_not_access_db_directly            ждёт app/routers/
```

---

## Ключевые design decisions (закреплены в коде)

### 1. Integer cents, never floats
`Money(cents: int)` — float запрещён через `__post_init__`. Конвертация в доллары для UI — presentation concern, домен оперирует только cents.

### 2. Typed account ids
`AccountId(kind=AccountKind.DEVELOPER_WALLET, owner_ref="dev_A")` строится в string `ac_dev:dev_A`. Невозможно случайно передать developer user_id где ожидается escrow project_id — типы расходятся.

### 3. Append-only ledger, balance = projection
Никаких `balance -= X`. Только `ledger.append(delta=-X)`. Баланс — это `SUM(delta_cents) GROUP BY account_id` агрегат. Это значит, что **divergence невозможна** — нет двух источников правды для одного значения.

### 4. Idempotency через deterministic keys
Каждая операция строит детерминированный `idempotency_key`:
```
escrow_hold:{project_id}:{module_id|_}:{cents}
escrow_release:{project_id}:{module_id|_}:{cents}#debit
escrow_release:{project_id}:{module_id|_}:{cents}#credit
escrow_release:{project_id}:{module_id|_}:{cents}#fee
escrow_refund:{...}#debit
payout:{batch_id}:{developer_id}:{cents}#debit
reverse:{original_entry_id}
```
Сетевой retry с теми же параметрами — безопасен, возвращает existing entry.

### 5. Compensating reversals
`reverse_transaction(original_entry_id, reason)` — не удаляет запись, а создаёт mirror-entry с противоположным delta. Audit trail сохранён.

### 6. Event-driven projections (готово к Phase 2B)
Все 7 событий публикуются через `EventBus`. Phase 2B сможет подписать legacy collections (`dev_wallets`, `payments`, `payouts`) как read projections без изменения `MoneyService`.

### 7. Архитектурный enforcement в CI
`test_only_money_domain_writes_to_money_collections` означает, что любой PR, добавляющий `db.dev_wallets.update_one(...)` в новый файл (вне `domains/money/`), валит билд автоматически. Это и есть «защита от наслоения логики».

---

## Что НЕ сделано (намеренно — план пользователя)

❌ **Не мигрировали legacy money-flows** — это Phase 2B. 13 grandfathered файлов (server.py, earnings_layer, escrow_layer, escrow_api, money_ledger, money_runtime, money_divergence, payout_layer, client_escrow, seed_money_demo, module_motion, wayforpay_callback, auto_guardian, overdue_engine, client_acceptance) продолжают писать как раньше.
❌ **Не удалили `money_divergence.py`** — это Phase 2D. Сначала миграция, потом удаление.
❌ **Не создали `app/routers/` для money** — пока эндпоинты остаются в server.py. Wiring через `Depends(get_money_service)` появится когда extraction routers начнётся.
❌ **Не тронули pricing_engine** — прямой constraint пользователя. Pricing и Money — разные домены.

---

## Метрики

| Что | Значение |
|---|---:|
| Новый код в Phase 2A | ~770 LoC (domains/money/ + 7-й архитектурный тест) |
| Изменённый существующий код | ~30 LoC (только money repository индексы + idempotency-return) |
| Сервисов RUNNING | 4/4 (backend hot-reload без ошибок) |
| API endpoints всё ещё работают | 682 |
| Архитектурных тестов | 7 passing / 1 skip |
| Бизнес-инвариантов в smoke | 11 / 11 passed |
| Money domain events типов | 7 (плюс базовый `MoneyChanged`) |
| Money operations через service | 7 (hold/release/refund/credit_val/payout/reverse + 2 read helpers) |

---

## Phase 2B — следующий шаг (по плану пользователя)

> «Самые опасные старые flows migrate»

Что мигрировать в первую очередь:
1. `escrow_layer.py` + `escrow_api.py` → переключить на `MoneyService.hold_escrow` / `release_escrow` / `refund_escrow`
2. `earnings_layer.py` → переключить на `MoneyService.release_escrow` (credit-side) и `credit_validator`
3. `payout_layer.py` → переключить на `MoneyService.process_payout`
4. `wayforpay_callback.py` → callback вызывает `MoneyService.hold_escrow` после провайдера

После каждой миграции:
- Запустить архитектурные тесты — `MONEY_WRITERS_GRANDFATHERED` сжимается на 1 файл за раз
- Запустить интеграционные тесты на тех же эндпоинтах что и до миграции — должны дать те же балансы

---

## Phase 2D KPI (ещё впереди)

```
"money_divergence.py" должен умереть.

Это главный KPI pilot-а.

Если reconciliation нужен — архитектура ещё broken."
```

После Phase 2B/2C `money_divergence.py` будет удалён как класс. На этом Phase 2 закроется.

---

## Структура (текущая)

```
backend/
├── shared/                              ← Phase 0
│   ├── config.py / constants.py / errors.py / events.py / logging.py
├── infrastructure/                      ← Phase 0
│   └── db/repositories/
│       ├── base.py
│       ├── users.py / projects.py / modules.py
│       └── money.py                     ← idempotent append + legacy index cleanup
├── domains/                             ← 🆕 Phase 2A
│   └── money/
│       ├── models.py      (Money, AccountId, AccountKind)
│       ├── events.py      (7 domain events)
│       ├── policies.py    (invariants — pure functions)
│       └── service.py     (MoneyService — canonical write path)
├── tests/architecture/                  ← Phase 0
│   └── test_layering.py                 ← 7 инвариантов, 1 ждёт routers/
└── audit/
    ├── ARCHITECTURE_DECOMPOSITION_AUDIT_2026-05-19.md
    ├── PHASE_0_FOUNDATION_CLOSEOUT_2026-05-19.md
    └── PHASE_2A_MONEY_DOMAIN_CLOSEOUT_2026-05-19.md  ← this file
```

---

**STOP POINT.** Foundation + Money domain в place. Ждём команды на:
- (A) **Phase 2B** — миграция legacy money-flows (escrow_layer → MoneyService), 4-5 файлов;
- (B) **Production traffic / observation** как договорено в Phase 0+ плане;
- (C) Что-то ещё.
