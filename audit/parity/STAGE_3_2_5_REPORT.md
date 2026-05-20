# Stage 3.2.5 — Canonical Parity Creation — DONE

**Date:** May 9, 2026
**Scope:** Resolve the three blockers found in Stage 3.3 (A1, A2, A3) by creating real canonical endpoints with shape parity. Plus instrumentation cleanup (IS-6).
**Mode:** Backend additive only. **Zero changes** to Expo source, web build, runtime client, auth, or shared abstractions.

---

## Stage 3.2.5 — готов

### Canonical endpoints created/updated:

| Endpoint | Action | File |
|---|---|---|
| `GET /api/marketplace/modules` | **Enriched** with parity fields (additive only): `bid_count` and `already_bid` per module, top-level `capacity: {used, max}`, comma-separated `?status=open,open_for_bids` support. All pre-existing fields preserved. | `backend/server.py:20134` |
| `GET /api/developer/intelligence/rank` | **Created** — wires through to the new shared `compute_developer_rank(db, user)` helper. Returns `{rank, total_devs, stats:{win_rate,qa_rate,total_earned,completed}, milestones:{to_elite}}`. | `backend/developer_intelligence.py` (added route + module-level helper) |
| `GET /api/client/notifications` | **Re-classified as canonical** for the Magic Client Pull domain (reads `client_notifications` collection — distinct from `notifications` collection that `/notifications/my` reads). Removed aspirational `@compat_decorator` that mislabeled it as alias. | `backend/mobile_adapter.py:954` |

### Legacy aliases updated:

| Legacy | Update | Forward target |
|---|---|---|
| `GET /api/marketplace/feed` | Unchanged. Continues to work, retains `@compat_decorator(canonical="/api/marketplace/modules")`. Now the label is **verified real**, not aspirational. | `/api/marketplace/modules` |
| `GET /api/developer/rank` | Body re-implemented as `return await compute_developer_rank(_db, user)` (single source of truth). `@compat_decorator(canonical="/api/developer/intelligence/rank")` retained — now points at a **real** canonical. | `/api/developer/intelligence/rank` |
| `GET /api/client/notifications` | Decorator removed (it IS the canonical). | self |

### Aspirational labels removed (IS-6 fix):

| Path | Old label (aspirational) | Action |
|---|---|---|
| `POST /api/modules/{id}/bid` | `/api/marketplace/modules/{id}/bid` (does not exist) | `@compat_decorator` removed. Route is documented as sole canonical pending future Stage 3.2.5 round 2. |
| `POST /api/modules/{id}/assign` | `/api/admin/modules/{id}/assign` (does not exist) | Same. |

### Shape parity proof:

Probe script: `/app/audit/parity/parity_probe.py`. Uses real seed credentials (`john@atlas.dev` / `client@atlas.dev`). Hits both legacy + canonical for each pair, asserts:

- 200/200 status for paired endpoints
- Top-level key parity (canonical ⊇ legacy)
- Critical per-item fields present (`bid_count`, `already_bid`, etc.)
- Header invariants (legacy → `x-compat-route: true` + `x-canonical-path` set; canonical → NO `x-compat-route`; both → `x-request-id`)
- For `/developer/rank`: byte-identical bodies (same shared helper)

**Probe result: 4 / 4 PASS.**

```
[A1] /marketplace/feed vs /marketplace/modules
  OK:   legacy 200
  OK:   canonical 200
  OK:   top-level keys ⊇: ['capacity', 'modules', 'total']
  OK:   canonical.capacity = {'used': 0, 'max': 5}
  OK:   legacy x-compat-route=true, x-canonical-path=/api/marketplace/modules
  OK:   canonical does NOT carry x-compat-route (correct)
  OK:   both carry x-request-id

[A2] /developer/rank vs /developer/intelligence/rank
  OK:   both 200
  OK:   bodies byte-identical: rank=1, total_devs=2
  OK:   legacy → canonical=/api/developer/intelligence/rank
  OK:   canonical clean (no compat headers)

[A3] /client/notifications — declared canonical (Magic Pull domain)
  OK:   200 OK
  OK:   /notifications/my (sibling canonical) also 200
  OK:   /client/notifications carries NO x-compat-route (canonical, not alias)
  OK:   shape contains 'notifications', 'count'

[A4] Aspirational labels removed
  OK:   /bid no longer carries x-canonical-path (status=404)
  OK:   /assign no longer carries x-canonical-path (status=404)

  [PASS] A1 marketplace
  [PASS] A2 developer/rank
  [PASS] A3 client/notifications
  [PASS] A4 aspirational labels
```

### Instrumentation labels fixed:

`x-canonical-path` header now points only at **verified existing endpoints** for every instrumented compat alias:

| Legacy | `x-canonical-path` | Verified? |
|---|---|---|
| `/marketplace/feed` | `/api/marketplace/modules` | ✅ exists at server.py:20134 |
| `/developer/rank` | `/api/developer/intelligence/rank` | ✅ exists at developer_intelligence.py |
| `/client/notifications` | (no header — declared canonical) | ✅ N/A |
| `/modules/{id}/bid` | (no header — aspirational removed) | ✅ N/A |
| `/modules/{id}/assign` | (no header — aspirational removed) | ✅ N/A |

### Probes:

- ✅ Legacy response shape ⊆ canonical response shape (no missing fields)
- ✅ For developer-aware endpoints: per-module `bid_count` + `already_bid`
- ✅ Top-level `capacity: {used, max}` in canonical (developer role) / `null` (other roles)
- ✅ `x-request-id` propagation maintained on both endpoints
- ✅ `x-compat-route` only on legacy, never on canonical
- ✅ For `/developer/rank` ↔ `/intelligence/rank`: byte-identical bodies (single source helper)

### No UI changes:

- ✅ `/app/frontend/app/**/*.tsx` — untouched
- ✅ `/app/frontend/src/**/*.tsx` — untouched
- ✅ `/app/web/src/**/*` — untouched
- ✅ `/app/frontend/src/runtime-client/*` — untouched
- ✅ `api.ts` / shared abstractions — untouched

### What was changed (full list):

```
modified:   backend/server.py                       (+~50 lines, additive enrichment of canonical)
modified:   backend/developer_intelligence.py       (+~60 lines, new route + shared helper)
modified:   backend/mobile_adapter.py               (rewrote 3 handlers to use shared helpers / removed aspirational decorators)
new file:   audit/parity/parity_probe.py            (probe script, ~250 lines)
new file:   audit/parity/STAGE_3_2_5_REPORT.md      (this report)
```

No deletions of any alias. No changes to writes / auth / wallet / QA / payouts / escrow / websocket. No socket.io hotfix applied yet (B is next).

### Remaining blockers for Stage 3.3:

**None for surfaces A1, A2, A3.** All three now have shape-compatible canonicals with verified probes. Stage 3.3 codemod for these can proceed as a true 1-line URL swap per call site.

**Remaining (deferred, NOT in 3.2.5 scope):**
- `/modules/{id}/bid` and `/modules/{id}/assign` — sole-implementation paths. Their canonicals (under `/marketplace/modules/{id}/bid` and `/admin/modules/{id}/assign`) still don't exist. Would need a future Stage 3.2.5 round 2 OR could be left as-is (declared as canonical themselves). Not blockers for Stage 3.3 Group A scope (those are write/mutation routes and explicitly excluded from Group A).
- IS-5 (dead duplicate routes in mobile_adapter for `/client/opportunities` + `/client/revenue-timeline`) — unchanged, scheduled for Stage 3.5 cleanup window (after B).

---

## Updated execution plan

| # | Step | Status |
|---|---|---|
| 1 | D2 instrumentation | ✅ DONE |
| 2 | D3 Stage 3.3 read-only codemod | ⚠️ DEFERRED with finding |
| **2.5** | **Stage 3.2.5 Canonical Parity Creation** | ✅ **DONE (this report)** |
| 3 | Stage 3.3 codemod (Group A) — now safe | ⏳ unblocked, awaiting your decision |
| **B** | **Socket.IO hotfix (IS-1)** | ⏳ **next per your A→B→C order** |
| **C** | **Dead duplicate cleanup (IS-5)** | ⏳ after B |
| 4 | Re-run heatmap | ⏳ |
| 5 | Observation window | ⏳ |
| 6 | Group B | ⏳ |
| 7 | Auth pilot | ⏳ |
| 8 | Group C | ⏳ |
| 9 | compat retirement | ⏳ |

Per your directive A → B → C: A is done, moving to B (Socket.IO hotfix) next.
