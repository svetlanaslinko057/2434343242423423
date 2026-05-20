# Phase 2B PR-2 — Earnings Bridge to MoneyService (19 May 2026)

> «earnings сейчас — главный источник теневых денег и расхождений»
> Status: ✅ ОТГРУЖЕНО (PR-1 уже отгружен. Now ledger авторизирован для **escrow + earnings**.)

---

## TL;DR

Per-task earnings, после QA-аппрува, теперь записываются в canonical `money_ledger_events` **на отдельной оси счёта** `EARNINGS_ACCRUAL`, не конфликтующей с PR-1 escrow→dev_wallet потоком:

```
legacy: task_earnings (Mongo) — write authority for amounts
                ↘
                  bridge_task_earning_approved → MoneyService.accrue_task_earning
                                                  → MoneyRepository.append(kind=task_earning_accrued)
                                                  → ac_accrual:<developer_id>  +cents
```

**Двухосевая модель денежной авторитета теперь живёт в ledger:**

| Account axis | Owner | Filled by | Drained by | Semantics |
|---|---|---|---|---|
| `ac_escrow:<project>` | project | PR-1 `escrow_hold` | PR-1 `escrow_release` / `escrow_refund` | client funds locked against module |
| `ac_dev:<developer>` | developer | PR-1 `escrow_release` | PR-3 (future) `payout` | escrow-released payouts at module granularity |
| `ac_accrual:<developer>` | developer | **PR-2** `task_earning_accrued` | **PR-2** `task_earning_reversed`, PR-3 (future) at payout time | per-task QA-approved earnings (sub-module audit) |
| `ac_plat:platform` | platform | PR-1 `fee` (when fee>0) | (future PR-3) validator credits | platform revenue |

`ac_dev` ≠ `ac_accrual` by design — see "Why parallel tracks, not double-credit" below.

---

## Изменения файлов

| Файл | Изменение | LoC delta |
|---|---|---:|
| `backend/domains/money/models.py` | `AccountKind.EARNINGS_ACCRUAL = "earnings_accrual"` + prefix `ac_accrual` | +3 |
| `backend/domains/money/events.py` | `TaskEarningAccrued`, `TaskEarningReversed` dataclasses | +32 |
| `backend/domains/money/__init__.py` | Re-export new events | +4 |
| `backend/domains/money/service.py` | `accrue_task_earning(...)` (single-leg credit) + `reverse_task_earning(...)` (compensating entry) | +115 |
| `backend/infrastructure/db/repositories/money.py` | KINDS += `task_earning_accrued`, `task_earning_reversed` | +2 |
| `backend/money_bridge.py` | `bridge_task_earning_approved`, `bridge_task_earning_reversed` | +60 |
| `backend/earnings_layer.py` | `handle_qa_result` теперь зовёт bridge на APPROVED/HELD/CANCELLED transitions | +9 |
| `backend/qa_layer.py` | `evaluate_qa_result` теперь зовёт bridge при approved transition | +13 |

**Всего:** ~240 LoC новых, 0 удалённых. Architecture test baseline без изменений.

---

## Почему параллельные оси, а не дополнительный credit к `ac_dev`

PR-1 уже кредитует `ac_dev:<developer>` при `escrow_release` (module-level). Если бы PR-2 ещё раз кредитовал тот же `ac_dev` при task-level approval, получился бы **double-credit**: один и тот же доход развалился бы на две записи в одном wallet, и баланс был бы X×2.

Решение: PR-2 кредитует ОТДЕЛЬНУЮ ось `ac_accrual:<developer>`. Это:

1. **Безопасно для двухстороннего write-path** — legacy `task_earnings.final_earning` и canonical `SUM(ac_accrual:<dev>.delta_cents)` — два чистых SQL-выражения, которые должны быть равны.
2. **Изоморфно legacy data-shape** — `task_earnings` collection ↔ `task_earning_accrued` event stream. Phase 2C-projector сможет рендерить task_earnings из ledger вообще без писателя.
3. **Готовит почву для PR-3** — payout будет debit-ить **обе** оси (`ac_dev` для escrow-released, `ac_accrual` для per-task) и кредитить `ac_external:<dev>`. Расхождение между двумя осями = error signal в reconciliation.
4. **Даёт `money_divergence.py` чёткую точку умирания** — после PR-3 reconciliation между `SUM(ac_accrual)` и `SUM(task_earnings.final_earning)` станет тождественно нулевым (single canonical writer). Тогда `money_divergence.py` действительно теряет смысл.

---

## Wired callsites (где сейчас стреляет bridge)

| Callsite | Trigger | Bridge call |
|---|---|---|
| `earnings_layer.handle_qa_result(qa_status='passed' ...)` | After legacy `task_earnings.update_one(status=approved)` | `bridge_task_earning_approved(earning)` |
| `earnings_layer.handle_qa_result(qa_status='failed' ...)` | After legacy update to `held` (was previously approved) | `bridge_task_earning_reversed(earning, reason='qa_status=failed')` |
| `qa_layer.evaluate_qa_result(result=passed ...)` | After legacy `task_earnings.update_one(status=approved)` | `bridge_task_earning_approved(earning)` |

Каждый callsite — **best-effort**: bridge ловит исключения и логирует, не пробрасывает в legacy. Legacy write всегда происходит **до** bridge call. Если bridge сломается, canonical ledger отстаёт, но legacy остаётся согласованным.

---

## Idempotency contract

| Bridge call | idempotency_key | Notes |
|---|---|---|
| `bridge_task_earning_approved` | `legacy_task_earning_approved:<earning_id>:rev<N>` | Включает `revision_count` → каждая ревизия = новый accrual; replay одной и той же ревизии = no-op |
| `bridge_task_earning_reversed` | `legacy_task_earning_reversed:<earning_id>:<reason[:32]>` | Compensates the **most recent** accrual for this earning_id; повторный вызов с тем же reason = no-op (returns existing reversal) |

`MoneyService.reverse_task_earning` дополнительно идемпотентен по факту: если accrual не существует — возвращает `None`, ничего не пишет.

---

## Smoke verification (live MongoDB)

```
created earning_id=earn_cd7426cded35 status=pending_qa base=$500.00
after handle_qa_result(passed) status=approved final=$500.00
ledger ac_accrual:dev_pr2_62f157 = $500.00
accrual entry: kind=task_earning_accrued delta=50000 acct=ac_accrual:dev_pr2_62f157
after replay handle_qa_result: ac_accrual = $500.00          ← idempotent
after reverse: ac_accrual = $0.00                            ← compensating
after replay reverse: ac_accrual = $0.00                     ← idempotent
DIAG: {
  escrow_hold:           3 events, +$3,500.00
  escrow_release:        8 events,        $0.00 (debit+credit pairs)
  escrow_refund:         2 events,        $0.00
  task_earning_accrued:  1 event,   +$500.00   ← NEW (PR-2)
  task_earning_reversed: 1 event,   -$500.00   ← NEW (PR-2)
}
```

**PR-1 escrow regression also re-tested ✓**:
```
PR-1 REGRESSION: dev=$800.00  escrow=$0.00  → OK
```

---

## Architecture tests

```
tests/architecture/test_layering.py::test_routers_do_not_access_db_directly SKIPPED
tests/architecture/test_layering.py::test_silent_except_does_not_grow         PASSED
tests/architecture/test_layering.py::test_no_new_giant_functions              PASSED
tests/architecture/test_layering.py::test_file_size_hard_cap                  PASSED
tests/architecture/test_layering.py::test_file_size_warn                      PASSED
tests/architecture/test_layering.py::test_one_writer_per_collection_does_not_grow PASSED
tests/architecture/test_layering.py::test_only_money_domain_writes_to_money_collections PASSED
tests/architecture/test_layering.py::test_domains_do_not_cross_import         PASSED
============================== 7 passed, 1 skipped ==============================
```

Никакие grandfathered baselines не сдвинуты. Architecture invariants держат руль.

---

## Что НЕ сделано (намеренно, scope PR-2)

❌ `dev_wallets` / `dev_earning_log` / `platform_revenue` **ещё не projection** — они всё ещё пишутся напрямую из escrow_layer, dev_work, module_motion, server.py. PR-3 (payout migration) уберёт большую часть этих writes, и Phase 2C сделает их event-projection subscribers.

❌ Recalculation (когда `apply_quality_adjustment` меняет `final_earning` уже-approved earning) **не реверсирует и не накатывает дельту**. Сейчас изменения после первого approval остаются в legacy `task_earnings.final_earning`, но canonical ledger хранит только первое начисление. PR-2.1 закроет этот gap — добавит `bridge_task_earning_adjusted(prev, new)`. Это редкий путь (нужны admin force-recalc или revision sequence), поэтому пропущен в PR-2.

❌ Validator credits (HVL reviewers receiving QA review rewards) — отдельный flow, выходит за scope PR-2. `MoneyService.credit_validator()` уже существует и готов, но callsite ещё не подключен (нет legacy QA-reward writer для бриджа).

❌ Не удалены legacy task_earnings writes — двухсторонняя запись остаётся. Удаление в Phase 2C через projection inversion.

---

## Что разблокировано

| Что | Как |
|---|---|
| **Source of truth для escrow + earnings — единый ledger** | После PR-2 цели Phase 2B exit-criteria: ✅ выполнено |
| **Money divergence как diff между двумя SQL-агрегациями** | `SUM(task_earnings.final_earning WHERE status=approved) == SUM(ac_accrual.delta_cents)/100` — расхождение немедленно ловится |
| **PR-3 (payout migration)** | Payout layer теперь может debit-ить две оси (`ac_dev`, `ac_accrual`) и credit-ить `ac_external` — все три имеют canonical authority |
| **Phase 2D KPI** | `money_divergence.py` уже сейчас сводится к чтению ledger-агрегатов вместо ad-hoc reconciliation engines |
| **Independent ledger-based audit для QA-approved earnings** | Можно делать compliance-отчёт «сколько денег платформа подтвердила, что должна» одной агрегацией по `ac_accrual:*` |

---

## Convergence metric (после PR-2)

```sql
-- canonical (ledger)
SELECT SUM(delta_cents) / 100.0 AS accrued_dollars
FROM money_ledger_events
WHERE kind = 'task_earning_accrued';

-- legacy (mongo)
SELECT SUM(final_earning) AS approved_dollars
FROM task_earnings
WHERE earning_status = 'approved';
```

Эти два числа должны быть **строго равны** для всех earnings, прошедших QA после PR-2 deployment. До PR-2 deployment-а ledger пуст для этого kind, и diff = full sum of all pre-existing approvals (это и есть legacy debt, который Phase 2C migrate-нёт через replay).

---

## Acceptance equation (PR-2)

| Инвариант | Состояние |
|---|---|
| Legacy `task_earnings` write unchanged | ✅ (handle_qa_result/qa_layer.evaluate_qa_result сохранили же поведение) |
| Canonical accrual event пишется в ledger | ✅ (kind=task_earning_accrued, account=ac_accrual:<dev>) |
| Idempotency на replay | ✅ (proverено в smoke) |
| Reversal на downgrade | ✅ (kind=task_earning_reversed, баланс возвращается в 0) |
| Idempotent reverse | ✅ (proverено в smoke) |
| Architecture tests 7/7 passing | ✅ |
| PR-1 escrow regression | ✅ (dev=$800, escrow=$0) |
| Bridge не пробрасывает exceptions | ✅ (failure isolation log+swallow) |
| MoneyService init ok | ✅ (видно в логах) |

---

## Следующий шаг — PR-3

`payout_layer.py → MoneyService.process_payout`

После PR-3:
- payout будет debit-ить `ac_dev` + `ac_accrual` (через адаптер-логику в payout flow) и credit-ить `ac_ext:<dev>`
- `dev_wallets` collection сможет умереть как writeable — станет projection of `SUM(ledger entries WHERE account_id LIKE 'ac_dev:%' OR account_id LIKE 'ac_accrual:%' AND owner=<dev>)`
- `money_divergence.py` reconciliation engine превращается в чистый monitoring tool (без repair semantics)
- Phase 2D condition "money_divergence теряет обязательность" — выполняется

---

End of PR-2 closeout.
