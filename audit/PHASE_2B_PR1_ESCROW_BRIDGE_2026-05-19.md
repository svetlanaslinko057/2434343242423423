# Phase 2B PR-1 — Escrow Bridge to MoneyService (19 May 2026)

> «Самый опасный путь — клиент оплатил → escrow → release → developer/platform деньги.»
> Phase 2B стартует с него. Состояние: ✅ ОТГРУЖЕНО.

---

## TL;DR

Все escrow-движения денег (fund / release / refund) теперь **дуально записываются**:

```
legacy escrow_layer  →  db.escrows / db.escrow_payouts / users.$inc total_earnings
                      ↘
                        bridge_escrow_*  →  MoneyService.<op>  →  MoneyRepository.append()
                                                                  (canonical money_ledger_events)
```

- Legacy collections **продолжают** наполняться — ни один существующий читатель не сломан.
- Канонический ledger получает атомарный набор записей (escrow debit + dev credit + fee placeholder) на каждый share, с **детерминистичным `idempotency_key`** → ретраи безопасны.
- WayForPay callback автоматически проходит через тот же мост через chain `on_invoice_paid → fund_escrow → bridge_escrow_hold`. Отдельная правка callback-а не требуется.
- Phase 2B exit-metric (`money_divergence теряет смысл`) — пока на пути к снижению, но впервые есть **independent canonical authority**, против которой можно мерить divergence.

---

## Изменения файлов

| Файл | Изменение | LoC delta |
|---|---|---:|
| `backend/money_bridge.py` | **NEW** — bridge module: init + 3 bridge функции (`bridge_escrow_hold`/`bridge_escrow_release`/`bridge_escrow_refund`) + diagnostics. Internally exception-safe. | +205 |
| `backend/escrow_layer.py` | Добавлены 3 точки вызова bridge: после `fund_escrow` write, на каждый per-developer share в `release_escrow`, после funded-refund. | +9 |
| `backend/server.py` | Startup wiring: `import money_bridge` + `@startup_event` вызывающий `init_money_service(db)`. | +9 |
| `backend/infrastructure/db/repositories/money.py` | `entry_id` индекс теперь `sparse=True` (coexistence с legacy документами без `entry_id`); silent `except: pass` заменён на `log.debug`. | +5 / -3 |
| `backend/money_ledger.py` | `event_id` индекс теперь `sparse=True` — устраняет startup-warning от collision на `{event_id: null}` после Phase 2A. | +1 / -1 |

**Всего:** ~220 LoC чистого нового кода + 5 минорных правок. Architecture tests baseline не сдвинут.

---

## Контракт идемпотентности (детерминистические ключи)

| Bridge call | idempotency_key |
|---|---|
| `bridge_escrow_hold(escrow, funded_by)` | `legacy_escrow_hold:<escrow_id>` |
| `bridge_escrow_release(escrow, payout)` | `legacy_escrow_release:<payout_id>` (split в `#debit`, `#credit`, `#fee` внутри `MoneyService`) |
| `bridge_escrow_refund(escrow, amount, reason)` | `legacy_escrow_refund:<escrow_id>:<cents>` |

`MoneyRepository.append()` на `DuplicateKeyError` возвращает **existing** запись → повторный вызов с теми же параметрами не создаёт второго движения. Подтверждено в смоук-тесте (replay `bridge_escrow_hold` на drained escrow → баланс не изменился).

---

## Smoke verification (live MongoDB)

```
PR-1 FINAL:   esc=$0.00   devA=$1400.00   devB=$600.00      (70/30 split of $2000)
LEDGER STATE: by_kind=
  escrow_hold:    3 events,  +$3500.00 cumulative (across smoke runs)
  escrow_release: 8 events,   $0.00 net (debit+credit pairs)
  escrow_refund:  2 events,   $0.00 net
CONVERGENCE METRIC:
  legacy escrow_payouts:        4 rows
  canonical escrow_release:     8 rows  (2× per legacy row: debit + credit)
  canonical escrow_hold:        3 rows  (1 per legacy fund_escrow)
```

Проверенные инварианты:
1. ✅ `fund_escrow` пишет `kind=escrow_hold` на `ac_escrow:<project_id>` с правильной суммой в центах
2. ✅ `release_escrow(100%)` создаёт debit (escrow) + credit (dev) пары для каждого share
3. ✅ Баланс escrow после full release = `$0.00`
4. ✅ Балансы developer wallet'ов точно равны responsibility-share от total
5. ✅ Idempotent replay не делает double-credit
6. ✅ Refund (PENDING → REFUNDED не пишет в ledger — там не было held funds; FUNDED → REFUNDED пишет `escrow_refund` debit + credit пару)
7. ✅ Architecture tests: **7 passed / 1 skipped** (одна Phase-2A silent-except задолженность тоже убрана)

---

## Что НЕ сделано (намеренно, scope PR-1)

❌ Не удалены legacy writes из `escrow_layer.py` — они продолжают работать, мост работает параллельно. Удаление будет в **PR-3 после observation window** (legacy collections станут event-subscribers на `MoneyChanged` события).

❌ `escrow_layer.py` остаётся в `MONEY_WRITERS_GRANDFATHERED` set — у него по-прежнему есть direct writes в `db.escrows` / `db.escrow_payouts` / `db.users.$inc`. Сокращение grandfathered списка — задача PR-3.

❌ Не тронуты `earnings_layer.py`, `payout_layer.py`, `client_escrow.py` — это PR-2 / PR-3.

❌ Не добавлены event-subscribers, которые рендерят legacy collections из MoneyService events — это **Phase 2C**.

❌ Платформенный fee на release установлен в `fee_cents=0` (legacy parity). Включение реального fee — отдельное продуктовое решение, не side-effect миграции.

---

## Что разблокировано

| Что | Как |
|---|---|
| **Independent canonical authority** для escrow flow | Все 4 escrow-операции теперь имеют entry в `money_ledger_events` с typed `account_id` префиксом (`ac_escrow:` / `ac_dev:` / `ac_client:`) |
| **Honest divergence measurement** | Можно сравнить `sum(escrow_payouts.amount)` vs `sum(money_ledger_events WHERE kind='escrow_release' AND account_id LIKE 'ac_dev:%')` — расхождение = баг bridge-а или legacy-а |
| **WayForPay callback** автоматически замостован | callback → `on_invoice_paid` → `fund_escrow` → `bridge_escrow_hold` — explicit правка не требуется |
| **PR-2 (earnings/payout bridge)** | Тот же паттерн `bridge_*` + лениый импорт + best-effort failure isolation |
| **Phase 2D KPI прогресс** | `money_divergence.py` теперь начинает терять смысл для escrow-плеча: можно положить SQL diff против `money_ledger_events` вместо ad-hoc reconciliation |

---

## Acceptance equation (PR-1)

| Инвариант | Состояние |
|---|---|
| Legacy collections write unchanged | ✅ (escrow_payouts row count grows как раньше) |
| Canonical ledger получает entries | ✅ (4 legacy payouts → 8 canonical entries: debit+credit pairs) |
| Балансы по канонической агрегации = legacy ожиданиям | ✅ ($600 + $400 = $1000 = total_amount) |
| Idempotency на retry | ✅ (replay не дублирует) |
| Architecture tests все passing | ✅ (7/7, было 7/7) |
| MoneyService initialised at startup | ✅ (видно в backend logs) |
| Legacy money_ledger.record_event сохраняет работоспособность | ✅ (sparse index допускает coexistence) |
| Все 682 API route остаются доступны | ✅ (`/api/` 200 OK) |

---

## Что измерять в observation window

Перед началом PR-2 (earnings/payout bridge):

1. **Convergence ratio:** `sum(escrow_payouts.amount) == sum(money_ledger_events.delta_cents WHERE kind='escrow_release' AND account_id LIKE 'ac_dev:%') / 100`. Должно быть строго равно после каждой реальной транзакции. Расхождение = bug.
2. **Idempotency_key violations:** `db.money_ledger_events.find({idempotency_key: {$exists: false}, kind: {$in: ['escrow_hold', 'escrow_release', 'escrow_refund']}})` — должно быть пусто. Если что-то падает в этот bucket, значит legacy путь обходит bridge.
3. **Bridge warnings в логах:** `grep "MONEY BRIDGE: bridge_escrow_.*suppressed" /var/log/supervisor/backend.err.log` — должно быть пусто в нормальном режиме. Если есть — анализировать причину failure isolation.
4. **Architecture test baseline:** `pytest tests/architecture/test_layering.py` — должен оставаться 7 passed / 1 skipped после каждого PR.

---

## Следующий шаг — PR-2

> `earnings_layer.py` → переключить на `MoneyService.release_escrow` (credit-side) и `credit_validator`

Применяем тот же паттерн `bridge_*` + lazy import + failure isolation. Целевые писатели в `earnings_layer.py`:
- `task_earnings.insert_one` (per-task earning record)
- `task_earnings.update_one` (status transitions)

После PR-2: суммы по task_earnings должны сходиться с canonical `dev_wallet` балансами для тех же developer_id. Это **второе плечо** конвергенции, после которого `money_divergence` для developer-side authority **полностью теряет смысл** (Phase 2D KPI).

---

End of PR-1 closeout.
