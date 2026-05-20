# Phase 2C-B2 — dev_wallets projection stability probe
**Date:** 2026-05-20
**Status:** ❌ UNSTABLE
**Base URL:** `http://localhost:8001`
**Runs:** 5 (repeatable, not calendar-bound)

## Outcome

One or more invariants failed. See `errors` below. **Do not advance to 2C-B3 until these are explained or resolved.**

Errors:
  • diverged>0 in some run: [1, 1, 1, 1, 1]

## Invariants

| Invariant | Status |
|---|---|
| projection checksum stable across runs | ✅ |
| classification histogram stable across runs | ✅ |
| `diverged` count is zero every run | ❌ |
| `mock_orphan` count stable (orphan preserved) | ✅ |
| `matches` count monotone non-decreasing | ✅ |
| legacy `dev_wallets` not mutated by probe | ✅ |
| rebuild idempotent after run 1 (`unchanged == rows_total`) | ✅ |

## Per-run summary

| run | rows | checksum | rebuild.counts | classifications |
|---:|---:|---|---|---|
| 1 | 6 | `0724168f18b2…` | computed=6/written=0/unchanged=6/errors=0 | `{"diverged": 1, "matches": 5}` |
| 2 | 6 | `0724168f18b2…` | computed=6/written=0/unchanged=6/errors=0 | `{"diverged": 1, "matches": 5}` |
| 3 | 6 | `0724168f18b2…` | computed=6/written=0/unchanged=6/errors=0 | `{"diverged": 1, "matches": 5}` |
| 4 | 6 | `0724168f18b2…` | computed=6/written=0/unchanged=6/errors=0 | `{"diverged": 1, "matches": 5}` |
| 5 | 6 | `0724168f18b2…` | computed=6/written=0/unchanged=6/errors=0 | `{"diverged": 1, "matches": 5}` |

## Legacy `dev_wallets` mutation check

- Before probe: rows=6, checksum=`82b273a0e08af251…`
- After probe:  rows=6, checksum=`82b273a0e08af251…`
- Verdict: ✅ legacy untouched

## What this probe deliberately did NOT do

- ❌ Switch any UI reader from `dev_wallets` to projection
- ❌ Remove or modify any legacy `dev_wallets` writer
- ❌ "Repair" the mock-seed payout orphan
- ❌ Modify `money_divergence.py`, `pricing_engine.py`, or HVL
- ❌ Edit any source file outside `/app/scripts` and `/app/audit`

## Next

Investigate the failing invariants above before advancing. Do not progress to 2C-B3.
