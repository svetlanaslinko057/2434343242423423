# ATLAS DevOS — Web Architecture Rules

**The frontend is a projection of the backend. Nothing else.**

These rules apply to `/app/web/src` and, by mirror, `/app/frontend/app`
(Expo). If you violate them, you create the same mess we just spent
6 cleanup passes removing.

---

## Core rule

> **UI renders JSON. Backend is the source of truth.**
>
> If you can't draw it from the data you already have, the answer is
> not "compute it on the client" — the answer is "the backend must
> return it".

---

## Hard rules (non-negotiable)

1. **UI does not compute data.** No `totals = items.reduce(...)`.
   If a total is needed, the endpoint returns it.

2. **UI does not aggregate.** No grouping, no counting, no `group_by`.
   Every count comes from `response.filters.by_*` or `response.summary.*`.

3. **UI does not decide.** No `if (severity === "critical") showPauseButton()`.
   The backend decided already. Render what it gave you.

4. **UI does not filter.** No `items.filter(...)` that hides rows the
   backend returned. If you want a filter, add it as a query parameter
   to the endpoint.

5. **UI does not own derived state.** If the same value is displayed
   twice, it is fetched once and displayed twice — not recomputed.

6. **UI does not merge endpoints.** One call per section. If two
   sections look related, they still read two independent responses.

---

## Forbidden primitives (grep should return 0)

Inside a page component (not inside pure presentational helpers that
take already-computed values):

```bash
# These are code smells. Audit before every merge:
grep -E "\.reduce\(" src/pages        # aggregation
grep -E "\.filter\(" src/pages        # hiding data
grep -E "\.sort\("   src/pages        # re-ordering
grep -E "useMemo.*\(\) =>" src/pages  # derivation cache — usually wrong
grep -E "Math\.max|Math\.min" src/pages  # comparison heuristics
```

Exceptions:
- `.map(...)` for rendering lists — fine.
- Rendering helpers like `fmtMoney`, `fmtTime` — fine (pure formatting).
- Cosmetic `labelForType(t)` dictionaries — fine (cosmetics, not data).

---

## Keep computation on the server

| ✅ Correct | ❌ Wrong |
|-----------|----------|
| `data.summary.profit` | `data.revenue - data.cost` |
| `data.filters.by_severity.critical` | `data.actions.filter(a => a.severity === "critical").length` |
| `risk.top_risks` | `actions.actions.sort(bySeverity).slice(0, 5)` |
| `team.developers.filter(d => d.status === ...)` ❌ even this | Read `team.summary.top_performers` |

If a field is missing from the response, don't compute it on the client —
open a ticket to add it to the backend.

---

## Fetching pattern

One page → one `useEffect` → N independent `axios.get` calls →
N independent `setState` calls. Never merge responses into a single
client-side object. Each response is a standalone truth.

```js
useEffect(() => {
  Promise.all([
    axios.get("/api/admin/production"),
    axios.get("/api/admin/risk"),
    axios.get("/api/admin/actions"),
    axios.get("/api/admin/team"),
  ]).then(([p, r, a, t]) => {
    setProduction(p.data);
    setRisk(r.data);
    setActions(a.data);
    setTeam(t.data);
  });
}, [bump]);
```

Not:

```js
// ❌ merging creates a fourth "truth" with no owner
const merged = { ...production.data, ...risk.data, counts: computeCounts(actions.data) };
```

---

## Refresh / real-time

- Polling with `setInterval(loadAll, 15000)` is fine for operator screens.
- Pushing to websocket will replace this — same principle, server pushes
  the whole JSON, client replaces state.
- Never apply partial diffs client-side. A new response replaces the old.

---

## Control actions

Buttons call a POST endpoint. The POST returns `{ ok: true, ... }`.
Upon success, the page refetches the GET endpoints. It does **not**
locally mutate its cached JSON.

```js
await axios.post(`/api/admin/project/${id}/action`, { action: "pause" });
triggerRefresh();   // re-runs loadAll()
```

Not:

```js
// ❌ this is a second truth that will drift from the server
setProduction({ ...production, work: { ...production.work, paused_by_system: prev + 1 } });
```

---

## Component layering

```
Page                        ← fetches, owns state, renders sections
  └── Section               ← stateless, receives slice of one response
        └── Primitives      ← stateless, receive primitives/numbers
```

Only the Page has `useEffect` + `useState`. Sections and primitives
are pure render functions that take ready-to-display props.

---

## When you think the rule is wrong

The rule is not wrong. The backend is incomplete.

Symptoms that you're about to violate the rule:
- "I just need this one small calculation"
- "The backend field is inconvenient — let me adjust it here"
- "Caching this on the client will be faster"
- "I'll merge these two responses so the render is simpler"

In every one of those cases, the fix is to change the backend contract,
not to patch the UI. See `/app/backend/CONTRACTS.md` — that file is the
product. This file is just a mirror.
