# ATLAS DevOS — Backend Contracts

**The source of truth for every surface.** Everything not listed here is legacy
and must be migrated away from. No new endpoint may be added without updating
this file first.

Last canonical revision: Block A5 (Team view) + cleanup pass + L1/L2 Core Layer.

---

## Two-layer invariant (L1 Core · L2 Scaling)

ATLAS runs on two layers. L1 is YOUR team (core). L2 is the scaling pool (external).
**L1 > L2. L2 never overrides L1.** This is the one rule that keeps the system
from feeling like magic.

Two fields encode the layer:

| Collection | Field | Values | Default | Meaning |
|------------|-------|--------|---------|---------|
| `users` | `source` | `core` \| `external` | `external` | Who owns the developer |
| `modules` | `assignment_mode` | `manual` \| `auto` | `auto` | Who controls the module |

**System agents MUST skip `assignment_mode == "manual"` modules:**

- `auto_guardian.tick()` — first check in the per-module loop (`skipped_manual` counter)
- `operator_engine.run_operator_scan()` — Rule B/C/E use `auto_mods` only; Rule E double-checks

Forbidden on manual modules: auto_pause, auto_rebalance, auto_add_support, auto_invite_top_devs, auto_reassign, any status flip by system.

Flip endpoint (admin only):

```
POST /api/admin/module/{module_id}/assignment-mode   { "mode": "manual"|"auto" }
GET  /api/admin/module/{module_id}/assignment-mode
```

Every flip writes `type: "admin_assignment_mode_change"` into `auto_actions`
(source=admin, confidence=1.0, with `from_mode`/`to_mode`/`actor_id`). No separate
table — single event bus, per the "1 shared bus" rule below.

---

## L0 — Universal Entry (states + active_context)

**Rule: ROLE ≠ ACCOUNT. ROLE = STATE.**

One account, many states. A visitor *acts* and *becomes* a client or developer.
UI is driven by `states` + `active_context`; access control stays on `role`.

Fields on `users`:

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `states` | `list[str] ⊆ {client, developer, admin}` | `[]` | what the user has *become* |
| `active_context` | `str \| null` | `null` | which surface the UI is currently rendering |

**L0 endpoints:**

```
GET  /api/me                      → { states, active_context, role, ... }
POST /api/me/context              { "context": "client"|"developer"|"admin" }
POST /api/projects                { "title", "mode", "goal"? }   ← flips to "client"
POST /api/developer/apply         (no body)                      ← flips to "developer"
```

Every state flip is idempotent:
`$addToSet` on states + `$set` active_context.

`GET /api/me` self-heals: if `role == "admin"` but `"admin"` is missing from
states, it's appended on the fly — no migration race.

**Frontend router rule:**
```js
if (states.length === 0)               → /home          (visitor / CTA screen)
if (active_context === "client")       → /client
if (active_context === "developer")    → /dev
if (active_context === "admin")        → /admin
if (states.length > 1)                 → show ContextSwitcher
```

**Existing `/client/*`, `/dev/*`, `/admin/*` endpoints are NOT touched.**
They keep working through `Depends(get_current_user)` / `require_role(...)`.
L0 is **additive** — states are a UI-routing signal, nothing more.

---

## Production Mode (product layer on top of L1/L2)

`production_mode` is **the client-facing product**. It sits *above* L1/L2 and
picks a philosophy for the whole project:

| Mode | Client label | Who runs it | Guardian/Operator | Price multiplier |
|------|--------------|-------------|-------------------|------------------|
| `dev` | **Качество** | Core team only | **ZERO actions** on this project | 1.00 |
| `hybrid` | **Баланс** | Core + AI + scaling pool | L1 invariant per-module | 0.75 (−25%) |
| `ai` | **Быстро** | AI / web-coding leads | Full autonomy | 0.60 (−40%) |

Stored on `projects.production_mode` (default `hybrid`).

**Hard rule in system agents:**
```python
# auto_guardian.tick  — at start of module loop
if m["project_id"] in dev_mode_projects:   result["skipped_dev_mode"] += 1; continue

# operator_engine.run_operator_scan — before any rule
projects = [p for p in projects if p.get("production_mode") != "dev"]
```

**Pricing is applied at module creation only** (sunk-cost safe). Historical
modules are never re-priced when the mode is flipped. Helper:
`production_mode_multiplier(mode)` in `server.py` is the single source of truth.

Flip endpoint (admin only):
```
POST /api/admin/project/{project_id}/production-mode   { "mode": "ai"|"hybrid"|"dev" }
GET  /api/admin/project/{project_id}/production-mode
```
Every flip writes `type: "admin_production_mode_change"` into `auto_actions` with
`from_mode`, `to_mode`, `price_multiplier`, `actor_id` — same single event bus.

---

## Core principle

> **1 entity = 1 endpoint = 1 contract = N UIs.**
> Backend is the product. UI is a projection.

An endpoint must answer exactly ONE question. If a UI needs two answers,
it reads two endpoints. It does **not** get a "combined" endpoint.

---

## Canonical endpoints

### Client (asks "what is happening with my project?")

| Method | Path | Answers | Owner |
|--------|------|---------|-------|
| GET | `/api/client/project/{project_id}/workspace` | What is happening? | `client_workspace.py` |
| GET | `/api/client/operator` | What is the system doing · what can I do? | `client_operator.py` |
| GET | `/api/client/operator/opportunities` | Where can I earn more? | `client_operator_opportunities.py` |
| GET | `/api/client/costs` | Where is my money going? | `client_costs.py` |
| GET | `/api/client/transparency` | What has the system already done? | `client_transparency.py` |
| POST | `/api/client/operator/{project_id}/action` | Client intervention (pause/resume/…) | `client_operator.py` |

### Developer (asks "what should I do right now?")

| Method | Path | Answers | Owner |
|--------|------|---------|-------|
| GET | `/api/dev/work` | What is on my plate? | `dev_work.py` |
| GET | `/api/dev/tasks?module_id=…` | What tasks make up this module? | `work_execution.py` |
| POST | `/api/dev/tasks/{task_id}/start` | Start task | `work_execution.py` |
| POST | `/api/dev/tasks/{task_id}/complete` | Submit task for review | `work_execution.py` |

### Admin Cockpit (asks "is the system healthy?")

| Method | Path | Answers | Owner |
|--------|------|---------|-------|
| GET | `/api/admin/production` | What is the state of production? | `admin_production.py` |
| GET | `/api/admin/risk` | Where does it hurt? | `admin_risk.py` |
| GET | `/api/admin/actions` | What is the system doing (journal)? | `admin_actions.py` |
| GET | `/api/admin/team` | Who is working, who is struggling? | `admin_team.py` |
| POST | `/api/admin/project/{project_id}/action` | Admin override (pause/resume/force_review) | `admin_control.py` |

---

## Single sources of truth (DRY guards)

These computations live in **exactly one file**. No other file recomputes them.
Everyone else imports.

| Signal | Owner | Rule |
|--------|-------|------|
| `_risk_state(modules)` — healthy/watch/at_risk/blocked | `client_operator.py` | Imported by `client_workspace`, `admin_production`, `admin_risk`. |
| `_cost_status(earned, price)` — under_control/warning/over_budget | `client_operator.py` | Imported by `client_workspace`, `client_costs`, `admin_production`, `admin_risk`. |
| Earned rule (`approved + paid`) / Paid rule (`paid`) | Convention | Applied identically by `client_workspace`, `client_costs`, `client_operator`, `dev_work`, `admin_*`. No override anywhere. |
| Portfolio rollup per project | Convention via `_risk_state` | Same code path in `admin_production` and `admin_risk`. |

If you catch yourself writing `def _risk_state`, `def _cost_status`,
or re-implementing the earned/paid formula — **stop and import instead**.

---

## Event shared bus

One collection, many producers, many readers:

```
db.auto_actions
  ├── source: "guardian"  ← auto_guardian.py
  ├── source: "operator"  ← operator_engine.py, client_operator.py
  └── source: "admin"     ← admin_control.py
```

Readers:
- `admin_actions.py` (feed, deduped)
- `admin_risk.py` (counts + top risks)
- `admin_production.py` (last 24h rollup)

**Rule:** anything that happens must be written here.
**Rule:** nothing new gets its own "events" collection.

---

## Response envelope convention

Every canonical admin/aggregator endpoint returns:

```json
{
  "...": "...",
  "generated_at": "ISO-8601 UTC"
}
```

`generated_at` is non-optional. It's what lets the UI show "as of 3m ago"
without any clock logic of its own.

---

## Legacy endpoints

These exist only for backward compatibility. Every call is logged at WARNING
and every response carries `deprecated=True` in the OpenAPI schema.

| Legacy | Replaced by | Since |
|--------|-------------|-------|
| `GET /api/dev/workspace` | `GET /api/dev/work` | Session: STOP CONTRACT DRIFT |
| `GET /api/client/workspace` | `GET /api/client/project/{id}/workspace` | Session: STOP CONTRACT DRIFT |
| `GET /api/admin/actions` (old audit trail, read `db.actions`) | `GET /api/admin/decisions/audit` (renamed) + new `/api/admin/actions` (auto_actions feed) | A2 |

**Rule:** never reach for a legacy endpoint in new code.
**Rule:** when a legacy endpoint reaches zero callers in logs, it is deleted.

---

## Forbidden patterns

- ❌ Creating `/api/mobile/*` or `/api/web/*` variants of the same data
- ❌ Creating a cockpit-style "merged" endpoint like `/api/admin/cockpit`
- ❌ Passing transport-specific flags (`is_mobile=true`)
- ❌ Returning UI-specific fields (`cta_button_color`, etc.)
- ❌ Recomputing a signal in a file that isn't its owner
- ❌ Writing business events to a collection other than `db.auto_actions`
- ❌ Shadowing a canonical path with a differently-shaped legacy handler

---

## Adding a new endpoint

Before writing a single line of code:

1. What **one question** does it answer?
2. Is that question already answered by an existing endpoint? If yes — **stop**.
3. Which collections does it read? (If it needs a new one, that's a red flag.)
4. What collection does it write to? (For anything event-like: `auto_actions`.)
5. Add it to this file **first**. If you can't describe it in one row, it's
   not ready to exist.
