# Tester Role — Audit Report (May 18, 2026)

> Краткий, прямой ответ на вопрос: что у тестера РЕАЛЬНО работает, что только
> заглушка, и сравнение глубины с client/developer.

---

## TL;DR — за 30 секунд

**Tester — это реальная роль в бизнес-модели платформы**, такая же платная как
developer. На уровне backend она реализована на **~65%** — пайплайн «принять
работу → Pass/Fail → создать issue» работает end-to-end, но **денежного хвоста
нет** (тестер не получает оплату за работу). Сравнение с client/developer:

| Аспект | Client | Developer | Tester |
|---|:---:|:---:|:---:|
| Mobile profile screen | ✅ profile.tsx | ✅ profile.tsx | ❌ **НЕТ** |
| Mobile wallet/earnings | ✅ billing.tsx | ✅ wallet.tsx + earnings.tsx | ❌ **НЕТ** |
| Backend wallet | ✅ client_escrow | ✅ payout_layer + developer_economy | ❌ **НЕТ** |
| Auto-payouts | ✅ deposit checkout | ✅ payout per QA-passed module | ❌ **НЕТ** |
| Web admin oversight | ✅ AdminLeads, AdminClients | ✅ AdminUsersPage | ⚠ partial |
| Production endpoints | ✅ полный | ✅ полный | ⚠ упрощённый (см. ниже) |

То есть **тестер технически может работать**, но не зарабатывать. Это критичный
gap для production-запуска роли.

---

## 1. Что реализовано в backend (точно работает)

### 1.1 Мобильные endpoints (под `require_role("tester","admin")`)

| Endpoint | Что делает | Статус |
|---|---|:---:|
| `GET /api/tester/validation-tasks` | Список задач: assigned-to-me ∪ unassigned-pending | ✅ real |
| `GET /api/tester/issues` | Список issues, которые тестер создал | ✅ real |
| `POST /api/validation/{id}/pass` | Pass с idempotency (тот же тестер ре-issue → 200) | ✅ real |
| `POST /api/validation/{id}/fail` | Fail → work_unit идёт в `revision` (dev переделывает) | ✅ real |
| `POST /api/validation/{id}/issue` | Создать issue: `{title, description, severity}`. Severity ∈ `low/medium/high/critical` | ✅ real |
| `GET /api/validation/{id}/issues` | Issues по конкретной валидации | ✅ real |
| `GET /api/tester/validation/{id}/details` | Деталь валидации для detail-экрана | ✅ real |
| `GET /api/tester/validation/{id}/issues` | Issues по валидации (alias) | ✅ real |

### 1.2 Backend модели (Pydantic + Mongo)

`ValidationTask` (collection `validation_tasks`):
```python
{validation_id, work_unit_id, project_id, assigned_to/tester_id,
 status: pending|in_progress|passed|failed, issues:[], tester_notes,
 created_at, completed_at}
```

`ValidationIssue` (collection `validation_issues`):
```python
{issue_id, validation_id, title, description,
 severity: low|medium|high|critical, status: open, created_at, created_by}
```

### 1.3 Сидинг (что появляется в БД при старте backend)

Логи: `TESTER SEED: 5 validations + 1 issue → tester@atlas.dev`

- 2 валидации «mine» (pending + in_progress)
- 2 валидации «mine completed today» (passed + failed)
- 1 валидация «unclaimed in queue»
- 1 issue «Validation form submits twice on slow connection» severity=high

→ Когда вы зашли как `tester@atlas.dev` и увидели «1 validation waiting» —
это и есть этот seed. **Это НЕ mock-логика — это реальные документы в Mongo**,
которые двигаются при Pass/Fail.

---

## 2. Что есть, но архитектурно проблемно (warning-уровень)

### 2.1 ⚠ Дубликаты endpoints — два набора `/validation/{id}/pass|fail`

В `server.py` зарегистрированы **дважды**:
- **Strict tester-facing версия** (строки 3688–3768): `require_role("tester","admin")`, idempotent, использует `tester_id`. **Эта побеждает в FastAPI registry** (первая регистрация).
- **Legacy более старая версия** (строки 10542–10611): без role-check, принимает inline `notes`, использует `assigned_to`, сетит `qa_passed:true`. **Не вызывается** (shadowed по path).

**Импакт:** код-смелл, но не критичный баг. Дубликаты warn'ились в логах при старте (`Duplicate Operation ID`). Когда дойдут руки до hardening — нужно удалить старые dead-routes.

### 2.2 ⚠ Tester Pass/Fail НЕ создаёт `qa_decision` запись

Production-уровень QA workflow живёт в `qa_layer.handle_qa_decision_workflow`,
который:
- Создаёт `qa_decisions` audit row
- Обновляет `work_units` lifecycle
- **Обновляет earnings (QA-gated)**
- Считает `revision_hours` из time-logs
- Считает `first_pass_success` метрику
- Шлёт realtime-нотификацию разработчику

**Но это вызывается только из `/api/admin/tasks/{task_id}/qa-decision`** (admin-only).

Когда тестер с мобильника жмёт Pass — `qa_decisions` НЕ создаётся, earnings
developer'а НЕ триггерится автоматически. То есть **тестер закрывает валидацию,
но developer'у не выплачивается** пока admin не пройдёт повторно через
admin-эндпоинт.

В текущем datastate `qa_decisions` = 105 записей (все от admin-flow / seed_replay,
ни одной от tester-flow).

**Это и есть «65% реализации»: тестер видит работу, ставит вердикт, но
финансовый эффект его вердикта на разработчика — пока ручной через admin.**

### 2.3 ❌ У тестера НЕТ кошелька / earnings / payouts

Поиск `tester.*wallet|tester.*payout|tester.*earnings` в backend — **0 совпадений**.

То есть тестер не получает деньги за работу. Это либо:
- (a) Намеренно — потому что тестинг внутренний и тестеры это сотрудники
  на зарплате, не gig-исполнители;
- (b) Дыра в архитектуре — модель не достроена.

PRD не отвечает на этот вопрос явно. По контексту платформы (gig-marketplace,
исполнители получают payout per work-unit) — это похоже на (b), но требует
вашего решения.

### 2.4 ❌ В Mobile expo у tester'а только 3 вкладки в bottom-tab — НЕТ profile

Сравнение `_layout.tsx`:

```
client/      → 9 routes (home, projects, billing, profile, support, ...)
developer/   → 16 routes (home, work, market, earnings, wallet, profile, ...)
tester/      → 4 routes (home, validations, history + deep-link detail)
```

**У тестера нет:**
- `profile.tsx` — экран профиля (как у client/developer)
- `wallet.tsx` / `earnings.tsx` — никакой денежной поверхности
- `notifications.tsx` — нет inbox

→ Когда вы зашли и увидели только 3 кнопки внизу (Home / Queue / History) —
это потому что Stage 4 product-scope-freeze явно ограничил scope до 4 экранов.
В `/app/docs/product-scope-freeze.md` (Decision 2) написано: «Build mobile
tester (Stage 4) — bounded to 4 screens. Out of scope: validation authoring,
tester admin/oversight, bulk operations».

То есть **отсутствие profile / wallet — это намеренное решение в скоупе**, а
не баг. Но если запускать tester'а как платную роль — надо расширять scope.

---

## 3. Web admin cockpit — что есть для контроля тестеров

### 3.1 Web страницы тестера (для самих тестеров, не админа)

Под `/tester/*` в CRA app:

| Route | Файл | Что показывает | API |
|---|---|---|---|
| `/tester/dashboard` | `TesterHub.js` (161 LOC) | Stat-карточки + next task CTA | `GET /tester/validation-tasks` |
| `/tester/validation` | `TesterValidationList.js` (168 LOC) | Список с фильтрами | `GET /tester/validation-tasks` |
| `/tester/validation/:id` | `TesterValidationPage.js` (342 LOC) | Detail + Pass/Fail/Issue actions | `POST /validation/{id}/pass\|fail\|issue` |
| `/tester/issues` | `TesterIssues.js` (126 LOC) | Все мои issues | `GET /tester/issues` |
| `/tester/performance` | `TesterPerformance.js` (154 LOC) | **Self-performance метрики** | `GET /tester/validation-tasks` + `/tester/issues` |

`TesterLayout` обёртывает их с `ProtectedRoute allowedRoles={['tester','admin']}`.

**Эти страницы — реальные**, не mock. API endpoints живые, рендер на реальных
Mongo-документах из seed.

### 3.2 Admin oversight тестеров

Что есть для админа над tester-poверхностью:

| Где | Что | Статус |
|---|---|:---:|
| `GET /api/admin/testers` | Список всех users с `role=tester` | ✅ real |
| `POST /api/validation/create` | Создать валидацию для work_unit | ✅ real (admin-only) |
| `POST /api/validation/{id}/assign` | Привязать tester'а к валидации | ✅ real (admin-only) |
| Admin AdminUsersPage | Изменить role любого user'а на `tester` | ✅ real (UI + backend) |
| Admin nav «Testers» tab | ❌ **НЕТ** | отсутствует |
| Admin: per-tester performance дашборд | ❌ **НЕТ** | tester_stats считается в `/admin/tasks/qa-decision`, но UI на него не привязан |
| Admin: tester payout review | ❌ **НЕТ** (нет понятия payout) | — |

В админ-навигации (`/admin/finance|inbox|integrations|workflow|...`) **отдельного
таба «Testers» нет**. Можно посмотреть тестеров только через `AdminUsersPage`
(фильтр по role=tester) и через раздачу валидаций (`/admin/work-units/...`).

---

## 4. Полная картина зрелости — табличка

Шкала: 🟩 production-ready · 🟨 работает но gap · 🟥 не реализовано

| Слой | Component | Зрелость | Что не так |
|---|---|:---:|---|
| **Backend models** | ValidationTask, ValidationIssue | 🟩 | — |
| **Backend endpoints** | tester-facing 8 endpoints | 🟩 | — |
| **Backend** | duplicate /validation/{id}/pass\|fail | 🟨 | dead-code, не критично |
| **Backend** | qa_decisions при tester Pass/Fail | 🟥 | не создаётся → дев не получает payout автоматом |
| **Backend** | tester wallet / earnings / payout | 🟥 | роль не платная (или не достроена) |
| **Mongo seed** | tester@atlas.dev + 5 validations + 1 issue | 🟩 | работает на каждом старте если коллекция пустая |
| **Mobile Expo** | home / validations / validation/[id] / history | 🟩 | — |
| **Mobile Expo** | profile screen у tester'а | 🟥 | отсутствует (по freeze-doc намеренно) |
| **Mobile Expo** | wallet / earnings / notifications | 🟥 | отсутствует |
| **Web tester app** | dashboard / list / detail / issues / performance | 🟩 | 5 страниц, всё real |
| **Web admin** | role assignment (включая tester) | 🟩 | через AdminUsersPage |
| **Web admin** | dedicated «Testers» nav tab | 🟥 | отсутствует |
| **Web admin** | per-tester performance dashboard | 🟥 | данные есть, UI нет |
| **Web admin** | tester payout review | 🟥 | нет понятия payout |

---

## 5. Решения, которые нужны от вас

Чтобы понять, надо ли «тушить и достраивать» — ответьте на 3 вопроса:

### Q1. Тестер — это платная gig-роль или внутренний сотрудник?

- **Если gig** (как developer) → надо построить **tester wallet + payout
  layer + earnings calculation** (например: $5 за каждую passed
  validation, $10 за критичный найденный баг). Это 1–2 дня работы. После
  этого можно открывать платформу для внешних QA-исполнителей.
- **Если сотрудник** (на зарплате, без per-task payout) → текущий код OK,
  только надо добавить tester profile screen (тривиально) и tester nav-tab
  у админа (1 час).

### Q2. Нужен ли automatic qa_decision при tester Pass/Fail?

- **Да** → надо подключить вызов `handle_qa_decision_workflow` из
  `/api/validation/{id}/pass|fail`. Это 30 минут работы. Эффект: когда
  тестер жмёт Pass — earnings developer'а сразу триггерится без admin step.
- **Нет** → оставляем admin двойной step (тестер сабмитит вердикт, admin
  одобряет финансово). Безопаснее, но добавляет latency и admin workload.

### Q3. Нужен ли admin-cockpit тестеров в web?

- **Да** → новая страница `/admin/testers` с per-tester accuracy / volume
  / latest issues. ~2–3 часа работы (данные `tester_stats` уже считаются
  в backend).
- **Нет** → пока обходимся `AdminUsersPage` фильтром по role.

---

## 6. Что я в этой сессии (vNEXT-5) **НЕ ломал**

Изменения этой сессии:
- `/app/backend/.env` (+ `AUTH_OTP_DEV_MODE=true`, + `EMERGENT_LLM_KEY=…`)
- `/app/backend/tests/test_auth_otp.py` (NoneType fix, 1 строка)
- `/app/memory/PRD.md` (добавил vNEXT-5 entry)

**Никакого tester-кода НЕ трогал.** Stage 4 mobile cabinet существовал в
репозитории ещё до сессии. Все остальные кабинеты (client / developer / admin /
operator) работают как работали — проверено: login через `client@atlas.dev`,
`john@atlas.dev`, `admin@atlas.dev`, `tester@atlas.dev` — все 200, кабинеты
рендерятся.
