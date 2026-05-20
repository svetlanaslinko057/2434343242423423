# Phase 2C-B2 — dev_wallets projection stability probe
**Date:** 2026-05-19
**Status:** ✅ STABLE
**Base URL:** `http://localhost:8001`
**Runs:** 3 (repeatable, not calendar-bound)

## Outcome

Every invariant from the 2C-B2 acceptance grid held across 3 consecutive runs. The projection is repeatable, idempotent, and observation-stable; the mock-seed payout orphan is preserved and visible.

**Gate for 2C-B3 (switch reads) is satisfied.**

## Invariants

| Invariant | Status |
|---|---|
| projection checksum stable across runs | ✅ |
| classification histogram stable across runs | ✅ |
| `diverged` count is zero every run | ✅ |
| `mock_orphan` count stable (orphan preserved) | ✅ |
| `matches` count monotone non-decreasing | ✅ |
| legacy `dev_wallets` not mutated by probe | ✅ |
| rebuild idempotent after run 1 (`unchanged == rows_total`) | ✅ |

## Per-run summary

| run | rows | checksum | rebuild.counts | classifications |
|---:|---:|---|---|---|
| 1 | 8 | `c1b21b7e7845…` | computed=8/written=0/unchanged=8/errors=0 | `{"legacy_only": 1, "matches": 6, "mock_orphan": 1}` |
| 2 | 8 | `c1b21b7e7845…` | computed=8/written=0/unchanged=8/errors=0 | `{"legacy_only": 1, "matches": 6, "mock_orphan": 1}` |
| 3 | 8 | `c1b21b7e7845…` | computed=8/written=0/unchanged=8/errors=0 | `{"legacy_only": 1, "matches": 6, "mock_orphan": 1}` |

## Legacy `dev_wallets` mutation check

- Before probe: rows=8, checksum=`db662350a301da88…`
- After probe:  rows=8, checksum=`db662350a301da88…`
- Verdict: ✅ legacy untouched

## What this probe deliberately did NOT do

- ❌ Switch any UI reader from `dev_wallets` to projection
- ❌ Remove or modify any legacy `dev_wallets` writer
- ❌ "Repair" the mock-seed payout orphan
- ❌ Modify `money_divergence.py`, `pricing_engine.py`, or HVL
- ❌ Edit any source file outside `/app/scripts` and `/app/audit`

## Next

Advance to **2C-B3 — switch developer wallet reads to the projection**.
