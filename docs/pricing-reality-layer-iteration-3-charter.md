# Pricing Reality Layer — Iteration 3 Charter

**Status:** ✅ ACTIVE. All Iteration 3 work conforms to these rules unless this document is amended.
**Adopted:** 2026-05-18
**Builds on:** PRD §0 Iteration 2 (immutable revisions, hybrid axes, narrative chips, separation of implementation vs production responsibility).

This is a **governance** document, not a TODO. After the user's sign-off of Iteration 2 we agreed on five hard rules that govern every Iteration 3 PR.

---

## Hard rules (do not violate)

### Rule 1 — Calibration NEVER mutates pricing

The calibration job is **read-only by construction**. It only:

- analyses completed projects with a `reality_layer.axes` snapshot,
- compares observed cost vs configured multiplier,
- emits suggestions.

It MUST NOT:

- write to `pricing_config.reality_layer`,
- silently drift multipliers,
- run an auto-tune background loop,
- be invokable via any path that has a `commit=true` mode.

**Suggestion contract** (immutable schema):

```json
{
  "axis": "unknowns.high",
  "current_multiplier": 1.6,
  "observed_delta": "+38%",
  "sample_size": 19,
  "suggested_range": [1.8, 2.1],
  "confidence": "low | medium | high"
}
```

Admin reviews suggestions → opens the existing `AdminPricingConfigPanel` → manually edits the multiplier → presses save. No "Apply suggestion" shortcut that bypasses the panel. The friction is the feature.

### Rule 2 — Re-price is preview-first

The admin re-price flow MUST be a two-step UI:

1. **Preview** — dropdowns, live recalculation, delta, narrative-chip diff, revision-preview. Backend endpoint: `POST /api/admin/projects/{id}/reprice-preview`. **No DB writes.**
2. **Commit** — explicit second click ("Commit re-price"). Backend endpoint: `POST /api/admin/projects/{id}/reprice`. Writes new snapshot, pushes previous snapshot into `pricing_history`, bumps revision.

Single-step "save on change" is forbidden. The friction is the feature.

### Rule 3 — Snapshot immutability is sacred

The Iteration 2 win — **price the client saw = price stored in project snapshot** — must survive Iteration 3 untouched.

- Re-price MUST NOT mutate the existing `pricing` / `reality_layer` objects in place.
- It MUST push the previous snapshot into `pricing_history` (already implemented backend-side) and create a new snapshot with `revision = prev + 1`.
- Calibration MUST NOT touch any project snapshot.
- The UI MUST display the current snapshot's `narrative_chips` exactly as stored — never recompute from current `pricing_config`.

### Rule 4 — Narrative chips = economic explanation layer

Narrative chips ("Production-grade", "Platform complexity", "Realtime", …) are **not UI decoration**. They are:

- the client-facing economic explanation of the production cost,
- the sales / trust / negotiation / scope-defense surface,
- evidence the client agreed to a specific entropy profile when accepting the offer.

Therefore:

- Every surface that renders `final_price` (or `pricing.final_price`) MUST also render the matching `narrative_chips` from the same snapshot.
- Chips MUST come from the snapshot, never from the current pricing_config (otherwise stale offers misrepresent themselves).
- Chips never expose multipliers or numbers — only the human label.

### Rule 5 — Legacy $25 — block new callers, keep compatibility

`/api/ai/estimate` (the legacy $25/h estimator) is already `deprecated=True` and emits `LEGACY_ESTIMATE` warning logs. Iteration 3 adds:

- HTTP `Deprecation: true` and `Sunset: <future-date>` response headers on every call (RFC 8594).
- Removal of `/api/ai/estimate` calls from the first-party frontend (`ClientEstimatePage`, etc.) so we don't shoot ourselves in the foot pretending to be an external caller.
- A `LEGACY_ESTIMATE` counter exposed in admin diagnostics so we know when the last caller goes away.

Physical removal happens in a later iteration AFTER the observation window confirms zero callers.

---

## Iteration 3 order (locked)

1. **Web narrative chips parity** — every web surface rendering `final_price` must render `narrative_chips`. Cheap UX consistency win, lowest blast-radius. (`ClientEstimatePage.js` already done in Iteration 2; audit other surfaces.)
2. **Admin Re-price UI** — preview-first per-project re-price flow. Lives at `/admin/projects/{id}` (deep-link from inbox / war-room) and is reachable as a tab in `/admin/finance`.
3. **Calibration UI** — read-only suggestions table. Surfaces `GET /api/admin/pricing/calibration-suggestions` with apply/ignore. "Apply" does NOT auto-apply — it jumps the admin to the multiplier in `AdminPricingConfigPanel`.
4. **Legacy $25 deprecation gate** — Sunset headers + remove first-party callers + diagnostic counter.

---

## What we deliberately are NOT doing in Iteration 3

- ❌ No evidence-backed auto-detection (realtime detected, infra detected, etc.). User explicitly deferred this to "next big step, not now".
- ❌ No semi-autonomous pricing intelligence. Reality Layer stays **human-controlled**.
- ❌ No global reprice job ("apply new defaults to all projects"). Snapshots are immutable.
- ❌ No client-facing reprice ("ask client to accept new price"). Out of Iteration 3 scope.
- ❌ No statistical sophistication in calibration v1. Mean ± stdev is enough for transparency. Better math is a v2 problem.

---

## Amendment procedure

Same as `product-scope-freeze.md`:

1. Open a PR that modifies THIS document with the proposed scope change.
2. Document what economic reality changed and why the rule must bend.
3. Get explicit sign-off from the owner.
4. Only then change behaviour.
