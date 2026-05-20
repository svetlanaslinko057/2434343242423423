# Phase 2B PR-3 — Payout Bridge to MoneyService (19 May 2026)

> Когда developer выводит деньги, payout проходит через MoneyService.process_payout()
> и отражается в money_ledger_events как canonical debit.
> Status: ✅ ОТГРУЖЕНО

---

## TL;DR

```
legacy mark-paid → dev_wallets.$inc(withdrawn_lifetime) / task_earnings.status=paid
                ↘
                  bridge_payout_processed → MoneyService.process_payout()
                                              ↓
                                              ac_dev:<dev>  -cents (debit)
                                              ac_ext:<dev>  +cents (credit)
                                              kind=payout
```

После PR-3 у нас **полный money spine** в canonical ledger:
- **PR-1**: escrow hold / release / refund (`ac_client` ↔ `ac_escrow` ↔ `ac_dev`)
- **PR-2**: task earning accrued / reversed (`ac_accrual`)
- **PR-3**: payout processed (`ac_dev` → `ac_ext`)

Все три PR'а dual-write поверх legacy. Legacy остаётся business authority. Ledger становится audit + invariant authority.

---

## Изменения файлов

| Файл | Изменение | LoC delta |
|---|---|---:|
| `backend/money_bridge.py` | `bridge_payout_processed(...)` — best-effort mirror на `MoneyService.process_payout`, deterministic idempotency_key, ловит `PolicyDenied` отдельно для divergence diagnostics | +63 |
| `backend/server.py` | `/api/admin/withdrawals/{id}/mark-paid` теперь зовёт bridge после успешного CAS + `dev_wallets.$inc` | +13 |
| `backend/payout_layer.py` | `mark_batch_paid` теперь зовёт bridge с `legacy_id=batch_<id>` после legacy update | +11 |

**Всего:** +87 LoC, 0 удалений.

---

## Bridge contract

```python
await bridge_payout_processed(
    *,
    developer_id: str,
    amount_dollars: float,
    legacy_id: str,            # "<withdrawal_id>" or "batch_<batch_id>"
    legacy_kind: str = "withdrawal",   # or "payout_batch"
    actor: str = "system",
    revision: int = 0,         # 0 by default; bumped on admin force-replay
    external_ref: str = "",
)
```

**Idempotency_key:** `legacy_payout_processed:<legacy_id>:rev<revision>`. Replay-safe: повторный вызов с тем же key возвращает existing entries без второго debit/credit.

**Ledger movement (через `MoneyService.process_payout`):**
- debit `ac_dev:<developer_id>`  → `-cents`, `kind="payout"`
- credit `ac_ext:<developer_id>` → `+cents`, `kind="payout"`

**Policy enforcement:** `MoneyService.process_payout` сам проверяет:
- `assert_payout_meets_minimum(amount)` → `PolicyDenied(code="money_payout_below_min")` если `< $10`
- `assert_balance_sufficient(ac_dev)` → `PolicyDenied(code="money_insufficient_balance")` если canonical баланс не покрывает

Bridge ловит оба исключения и **логирует**, не пробрасывает в legacy. Это — divergence signal, не ошибка business flow:

```python
WARNING - MONEY BRIDGE: bridge_payout_processed suppressed
  legacy_id=wd_xxx
  developer_id=dev_xxx
  amount_dollars=5.0
  legacy_kind=withdrawal
  error="PolicyDenied('payout: amount below minimum (USD 0.05 < 10.0 USD)', code='money_payout_below_min', ...)"
```

Это позволяет в продакшене сразу видеть, где legacy расходится с canonical policy.

---

## Wired callsites

| Callsite | Trigger | Bridge call |
|---|---|---|
| `server.py /api/admin/withdrawals/{id}/mark-paid` | After CAS `approved → paid` + `dev_wallets.$inc({pending_withdrawal: -A, withdrawn_lifetime: +A})` | `bridge_payout_processed(legacy_id=withdrawal_id, legacy_kind="withdrawal")` |
| `payout_layer.mark_batch_paid` | After `payout_batches.status = paid` + all `task_earnings.status = paid` | `bridge_payout_processed(legacy_id=f"batch_{batch_id}", legacy_kind="payout_batch")` |

**Не подключены пока (намеренно):**
- `admin_mobile.py /api/admin/mobile/withdrawals/{id}/approve` — это approve, не mark-paid; денежного движения нет
- `admin_mobile.py /api/admin/mobile/withdrawals/{id}/reject` — это reject, не payout
- `server.py /api/admin/withdrawals/{id}/reject` — reject path, deny payout; ledger ничего не пишет
- `server.py /api/developer/withdrawals/{id}/cancel` — developer self-cancel; ledger ничего не пишет
- `db.withdrawals` collection в admin_mobile — отдельная от `db.dev_withdrawals`; не trigger-ит money move в legacy (статусы без $inc dev_wallets). Если придут реальные deposits на эту коллекцию — bridge добавим в PR-3.1.

---

## Smoke verification (live MongoDB)

```
SEEDED: ac_dev:dev_pr3_f99bb1=$500.00  ac_ext:dev_pr3_f99bb1=$0.00
                                  (via PR-1 escrow release of $500)

[1/5 happy path]
AFTER payout $50: ac_dev=$450.00  ac_ext=$50.00       ← canonical move ✓

[2/5 idempotency]
AFTER replay (same legacy_id): ac_dev=$450.00 ext=$50.00 ← unchanged ✓

[3/5 below minimum]
MONEY BRIDGE: bridge_payout_processed suppressed (PolicyDenied money_payout_below_min)
AFTER min-violation: ac_dev=$450.00 ext=$50.00         ← unchanged ✓ (legacy not affected)

[4/5 insufficient balance]
MONEY BRIDGE: bridge_payout_processed suppressed (PolicyDenied money_insufficient_balance)
AFTER insufficient: ac_dev=$450.00 ext=$50.00          ← unchanged ✓

[5/5 direct MoneyService policy enforcement]
DIRECT minimum policy enforced: money_payout_below_min
DIRECT insufficient policy enforced: money_insufficient_balance

[PR-2 regression]
ac_accrual=$100.00 (expected $100.00) ✓

[PR-1 regression]
escrow_hold + release pipeline функционирует ✓ (видно в SEEDED step)

DIAG: {
  escrow_hold:           5 events
  escrow_release:        12 events  (net $0 — debit+credit pairs)
  escrow_refund:         2 events   (net $0)
  task_earning_accrued:  2 events
  task_earning_reversed: 1 event
  payout:                2 events   (net $0 — debit ac_dev + credit ac_ext)  ← NEW (PR-3)
}
```

---

## Acceptance equation (PR-3)

| Acceptance criterion | Status |
|---|---|
| Repeated mark-paid не даёт double debit | ✅ idempotency_key `legacy_payout_processed:<id>:rev0` |
| Payout меньше минимума reject через policy | ✅ `assert_payout_meets_minimum` → `PolicyDenied money_payout_below_min` (для прямого MoneyService call); для bridge — divergence warning |
| Insufficient balance reject | ✅ `assert_balance_sufficient(ac_dev)` → `PolicyDenied money_insufficient_balance` (для прямого MoneyService call); для bridge — divergence warning |
| `dev_wallets.withdrawn_lifetime` ↔ ledger payout movement | ✅ оба растут на ту же дельту при happy path; расхождение видно через простой aggregation diff (формула ниже) |
| PR-1 escrow smoke не ломается | ✅ верифицировано в smoke (seed step) |
| PR-2 earnings smoke не ломается | ✅ верифицировано в smoke (ac_accrual=$100 ok) |
| Architecture tests 7/7 passing | ✅ |
| MoneyService initialised at startup | ✅ logs: `MONEY BRIDGE: MoneyService initialised (Phase 2B PR-1)` |

---

## Convergence query templates (после PR-3)

```sql
-- canonical payout total per developer
SELECT account_id, -SUM(delta_cents)/100 AS paid_out_dollars
FROM money_ledger_events
WHERE kind='payout' AND delta_cents < 0
GROUP BY account_id;       -- key: ac_dev:<developer_id>

-- legacy payout total per developer
SELECT user_id, SUM(withdrawn_lifetime) FROM dev_wallets GROUP BY user_id;

-- divergence per developer
diff(developer_id) = canonical_paid_out - legacy_withdrawn_lifetime
must converge to 0 for all (developer_id, time_period) after PR-3 deploy date.
```

При несовпадении надо смотреть `bridge_payout_processed suppressed` warnings в `/var/log/supervisor/backend.err.log` — там точная причина (под минимум, недостаточный баланс в canonical, etc.).

---

## Что НЕ сделано (намеренно, scope PR-3)

❌ Backfill canonical `ac_dev` balance с историческими данными из `dev_wallets.available_balance` — это Phase 2C "replay" task. Прямо сейчас:
- legacy `dev_wallets.available_balance` содержит баланс из ВСЕХ прошлых escrow_release + manual adjustments
- canonical `ac_dev` содержит только escrow_release ПОСЛЕ PR-1 deploy date
- → старые withdrawals будут падать на `money_insufficient_balance` в bridge; это divergence signal, не data loss

❌ Не подключены `admin_mobile.py` withdrawal approve/reject endpoints — это статусные переходы без money move, ledger ничего не должен писать. Подключим только если найдём подтверждённый money $inc там.

❌ Не добавлены unit-тесты Phase 2C reconciliation queries — это для Phase 2C deliverable.

❌ Не удалены legacy direct writes из `dev_wallets` (`$inc withdrawn_lifetime`) — удаление в Phase 2C через projection inversion (dev_wallets станет subscriber of `kind=payout` events).

❌ Не трогали Stripe / WayForPay live integration — payout providers continue to live behind `payment_providers/` MOCK; bridge работает на canonical bookkeeping уровне, не на external PSP уровне.

❌ Не трогали `money_divergence.py` — он пока ещё нужен, потому что legacy backfill не сделан. После Phase 2C replay он превратится в pure monitoring tool (без repair-семантики).

---

## Architecture state (после PR-3)

```
                ┌───────────────────────────────────┐
                │   LEGACY collections (write)      │
                │   escrows / escrow_payouts /      │
                │   task_earnings / dev_wallets /   │
                │   dev_withdrawals / payout_batches│
                └────────────────┬──────────────────┘
                                 │ (best-effort mirror)
                ┌────────────────▼──────────────────┐
                │   money_bridge.py                 │
                │     bridge_escrow_hold      (PR-1)│
                │     bridge_escrow_release   (PR-1)│
                │     bridge_escrow_refund    (PR-1)│
                │     bridge_task_earning_*   (PR-2)│
                │     bridge_payout_processed (PR-3)│  ← NEW
                └────────────────┬──────────────────┘
                                 │
                ┌────────────────▼──────────────────┐
                │   MoneyService (domains/money)    │
                │     hold_escrow / release_escrow  │
                │     refund_escrow                 │
                │     accrue_task_earning           │
                │     reverse_task_earning          │
                │     process_payout       ← NEW    │
                │     credit_validator              │
                │     reverse_transaction           │
                └────────────────┬──────────────────┘
                                 │
                ┌────────────────▼──────────────────┐
                │   MoneyRepository (append-only)   │
                │   money_ledger_events             │
                │   - typed account_id              │
                │   - unique entry_id (sparse)      │
                │   - unique idempotency_key        │
                │     (sparse)                      │
                │   - allowed kinds enum            │
                └───────────────────────────────────┘
```

**Все 5 background loops продолжают работать, 682 API routes по-прежнему доступны, supervisor RUNNING.**

---

## Следующий шаг — Phase 2C (legacy → projection)

После PR-3 у нас есть три independent canonical authorities (escrow / accrual / payout). Это значит можно начинать **инвертировать direction of truth**:

| Phase 2C-A | task_earnings ← projection of `task_earning_accrued` / `task_earning_reversed` events |
| Phase 2C-B | dev_wallets ← projection of `escrow_release` + `payout` events on `ac_dev:*` |
| Phase 2C-C | escrow_payouts ← projection of `escrow_release` events |
| Phase 2C-D | Drop direct writes из grandfathered files. Reduce `MONEY_WRITERS_GRANDFATHERED` set with each PR. |
| Phase 2D    | `money_divergence.py` теряет smysl — превращается в monitoring tool без repair. |

---

End of PR-3 closeout.
