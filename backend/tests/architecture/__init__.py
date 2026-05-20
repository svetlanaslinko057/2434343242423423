"""Architecture guardrail tests — run on every PR via CI.

Purpose: prevent the monolith from growing back after the Phase 0 + Money
pilot refactor. Each test encodes a single architectural invariant from
`audit/ARCHITECTURE_DECOMPOSITION_AUDIT_2026-05-19.md` (§7).

These tests use static grep against the source tree — no fixtures, no
external deps, runnable as plain pytest.

Reading violations: each test prints offenders + their counts. Migration is
incremental — many tests will start RED and ratchet down. The current
baseline (counts at audit time) is encoded in `BASELINE` so regressions
fail the test even before the count reaches zero.
"""
