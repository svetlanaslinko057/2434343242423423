# Endpoint Family Registry

One canonical family per concept. Legacy families are compat-only and named here.

Doctrine reference: [`SUBSTRATE_CONTRACT.md`](./SUBSTRATE_CONTRACT.md) §I-03.
Slice tracker: [`PHASE1_SUBSTRATE_CLOSEOUT.md`](./PHASE1_SUBSTRATE_CLOSEOUT.md).

---

## 0. Status legend

| Status | Meaning | Allowed for new consumers |
|---|---|---|
| `canonical` | Sole sanctioned family for new code | ✅ |
| `compat-only` | Existing consumers may keep using | ❌ |
| `sunset-candidate` | Compat-only + slated for removal once last consumer migrates | ❌ |
| `deprecated` | Returns deprecation header / 308 / 410 (not yet enforced anywhere) | ❌ |

---

## 1. Registry

### 1.1 Deliverables (client side)

| Path family | Status | Verb shape | Side-effects |
|---|---|---|---|
| `/api/client/deliverables/{id}` | **canonical** | `GET` full + `work_units` ; `POST .../approve` ; `POST .../reject` (body `{ reason }`) | invoice issued on approve, support ticket on reject, realtime emits, project progress update |
| `/api/deliverables/{id}` | **sunset-candidate** | `GET` raw doc ; `POST .../approve?feedback=...` ; `POST .../reject?feedback=...` (query) | ticket only |

**Consumer map** (snapshot 2026-05-12):

| Consumer | Current family | Target | Migration slice |
|---|---|---|---|
| `web/src/pages/ClientDeliverablePage.js` | sunset-candidate (B) | canonical (A) | #1 |
| `frontend/app/client/projects/[id].tsx` | canonical (A) | — | aligned |
| `frontend/app/chat.tsx` | canonical (A) | — | aligned |
| `frontend/src/decision-hub.tsx` | canonical (A) | — | aligned |
| `frontend/app/client/deliverable/[id].tsx` (to create) | — | canonical (A) | #1 |

**Sunset trigger for B-family**: web `ClientDeliverablePage.js` migrated and zero
grep matches for `/api/deliverables/[^c]` in `/app/web/src` and `/app/frontend`.

### 1.2 Deliverables (admin side)

| Path family | Status | Notes |
|---|---|---|
| `/api/admin/projects/{pid}/deliverables` | **canonical** | list, create |
| `/api/admin/deliverables/{id}/publish` | **canonical** | publish-for-payment flow |
| `/api/admin/deliverable` | **compat-only** | older create endpoint at `server.py:6322` — to be reviewed |

### 1.3 Projects (client view)

| Path family | Status | Notes |
|---|---|---|
| `/api/client/projects/{id}/*` | **canonical** | workspace, dashboard, deliverables list, work-status, costs, operator |
| `/api/projects/{id}` (singular GET, deliverables list) | **mixed** | overlap with canonical; per-endpoint review owed in slice #3 (ClientCabinet) |

To be expanded in slices #2–#6.

### 1.4 Projects (admin view) — to be registered

Reserved. Audit owed in admin journey close-out (post-Phase 1).

### 1.5 Modules

| Path family | Status | Notes |
|---|---|---|
| `/api/modules/*` (developer-side) | **canonical** for developer flow | acceptance, work submit, time logs |
| `/api/admin/module/{id}/assignment-mode` | **canonical** | L1/L2 governance per `I-07` |

Full registration in slice #5 (DeveloperWork).

### 1.6 Authentication

| Path family | Status | Notes |
|---|---|---|
| `/api/auth/login`, `/api/auth/register`, `/api/auth/session` | **canonical** | password / session |
| `/api/auth/quick` | **canonical (demo only)** | seeded users; not for production consumers |
| `/api/auth/demo`, `/api/auth/demo-provider` | **compat-only** | demo paths kept for fixtures |
| `/api/auth/me`, `/api/auth/logout`, `/api/auth/exists` | **canonical** | session probes |

### 1.7 Money — invoices / payments

| Path family | Status | Notes |
|---|---|---|
| `/api/invoices/*` (read) | **canonical** | invoice query / list |
| `/api/client/billing/*` | **canonical** | client-facing money summaries |
| Vendor leakage | **forbidden** | I-08; never `stripe_*` / `wfp_*` outside `integrations/live_adapters.py` |

Full audit owed parallel to integration rollout (NG-07).

### 1.8 Realtime (Socket.IO)

| Channel | Status | Notes |
|---|---|---|
| `socket.io` mounted at `/api/socket.io` | **canonical** | ingress-only path through `/api/*` |
| Room conventions: `user:{id}`, `role:{r}`, `project:{id}` | **canonical** | server-side authorization enforced (`backend/server.py:join`) |

---

## 2. Promotion / demotion process

### To add a canonical family

1. Backend handler exists with full side-effect chain (invoice / ticket /
   realtime / progress as relevant)
2. ≥1 documented consumer (slice owns the registration)
3. Registry entry created here
4. Slice in `PHASE1_SUBSTRATE_CLOSEOUT.md` performs the migration of existing
   consumers (if applicable)

### To demote a family (canonical → compat-only)

1. New canonical family registered and at least one consumer migrated
2. Existing family marked `compat-only` with consumer map
3. No new consumers wire to the demoted family (enforced by §I-03 grep)

### To sunset (compat-only → sunset-candidate → deprecated)

1. All known consumers migrated
2. Marked `sunset-candidate`
3. After observation window (≥1 Phase, no new consumers): emit deprecation
   header `Sunset: <date>`
4. Final removal in dedicated cleanup PR — out of Phase 1

---

## 3. Enforcement greps

```bash
# Legacy deliverable family (slice #1 target: 0)
grep -RnE "/api/deliverables/[^c]" /app/web/src /app/frontend

# Vendor leakage (I-08, should be 0 outside live_adapters)
grep -RnE "stripe_session_id|wfp_order_ref" /app/backend \
  | grep -v "integrations/live_adapters.py"

# Direct Socket.IO path leakage (must go through /api/socket.io)
grep -RnE "\"/socket\.io\"|'\\.\\/socket\\.io'" /app/web/src /app/frontend
```

---

## 4. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-12 | initial | Registry created. Deliverables family pair documented; consumer map populated for slice #1. Reserved sections for projects-admin, modules, authentication, money, realtime — to be filled in subsequent slices. |
