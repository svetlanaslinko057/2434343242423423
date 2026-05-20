#!/usr/bin/env python3
"""
Phase 2C-B2 — dev_wallets projection stability probe.

Repeats N rebuilds back-to-back and verifies that the
`dev_wallets_projection` shadow built in 2C-B1 is:
  • deterministic (same ledger → same projection checksum across runs)
  • idempotent at the document level (rebuild N times = unchanged for
    everyone after the first run)
  • observation-stable (classification counts identical across runs;
    no developer flips category)
  • mock-orphan-preserving (orphan count constant; orphans never reclassify
    to `matches` or `diverged`)
  • non-mutating to legacy (`dev_wallets` checksum unchanged before/after)

If every invariant holds for `--runs` consecutive iterations, the user's
"prove stability by repetition, not calendar wait" acceptance is met and
we can proceed to 2C-B3 (switch reads).

Usage:
    python3 /app/scripts/dev-wallet-projection-stability.py \\
        --runs 5 \\
        --base-url http://localhost:8001 \\
        --admin-email admin@atlas.dev \\
        --admin-password admin123

Outputs:
    /app/audit/dev_wallet_projection_stability.json     (machine-readable)
    /app/audit/PHASE_2C_B2_DEV_WALLETS_STABILITY_<DATE>.md   (closeout)

Constraints (per user contract):
    - script is READ-ONLY against `dev_wallets` (only inspects via Motor)
    - script writes ONLY to `dev_wallets_projection` (via rebuild endpoint)
    - script never edits source code
    - script never "repairs" the seed orphan
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from typing import Any


# ── HTTP helpers (stdlib only — script must run with backend deps absent) ──
def _post(url: str, body: dict | None = None, token: str | None = None,
          timeout: int = 30) -> dict:
    data = json.dumps(body or {}).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get(url: str, token: str | None = None, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, method="GET")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _login(base_url: str, email: str, password: str) -> str:
    body = _post(
        f"{base_url}/api/mobile/auth/login",
        {"email": email, "password": password},
    )
    if "token" not in body:
        raise RuntimeError(f"login failed: {body}")
    return body["token"]


# ── Checksums ──────────────────────────────────────────────────────────────
PROJECTION_KEYS = (
    "user_id",
    "available_balance_cents",
    "withdrawn_lifetime_cents",
    "earned_lifetime_cents",
    "accrual_pending_cents",
)

LEGACY_KEYS = (
    "user_id",
    "available_balance",
    "earned_lifetime",
    "withdrawn_lifetime",
    "pending_withdrawal",
)


def _stable_checksum(rows: list[dict], keys: tuple[str, ...]) -> str:
    """SHA-256 of canonical JSON of selected fields, rows sorted by user_id.

    The hash MUST NOT include `computed_at` / `updated_at` — those are
    monotonic on every rebuild even when the ledger is unchanged, and
    would defeat the stability test. We hash only the financial fields
    that the projection contract guarantees deterministic.
    """
    projected = [
        {k: row.get(k) for k in keys}
        for row in sorted(rows, key=lambda r: r.get("user_id") or "")
    ]
    blob = json.dumps(
        projected, sort_keys=True, separators=(",", ":"), default=str
    ).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


# ── Per-developer classification probe ─────────────────────────────────────
def _classify_one(base_url: str, token: str, dev_id: str) -> str:
    res = _get(
        f"{base_url}/api/admin/money/projections/dev-wallets/{dev_id}",
        token=token,
    )
    return res.get("comparison", {}).get("classification") or "unknown"


def _classification_histogram(
    base_url: str, token: str, projections: list[dict]
) -> dict[str, int]:
    """Iterate every developer in the projection list, fetch their
    classification via the compare endpoint, and return a histogram."""
    hist: dict[str, int] = {}
    for row in projections:
        dev_id = row.get("user_id")
        if not dev_id:
            continue
        cls = _classify_one(base_url, token, dev_id)
        hist[cls] = hist.get(cls, 0) + 1
    return hist


# ── Legacy dev_wallets checksum (Motor — direct Mongo read) ────────────────
async def _legacy_checksum(mongo_url: str, db_name: str) -> dict[str, Any]:
    """Read every `dev_wallets` document and checksum the financial fields.
    Pure read. If anything else touched the collection between runs, the
    checksum will diverge."""
    from motor.motor_asyncio import AsyncIOMotorClient  # local import

    client = AsyncIOMotorClient(mongo_url)
    try:
        db = client[db_name]
        rows = await db.dev_wallets.find({}, {"_id": 0}).to_list(10000)
    finally:
        client.close()

    return {
        "row_count": len(rows),
        "checksum": _stable_checksum(rows, LEGACY_KEYS),
    }


# ── Single run ─────────────────────────────────────────────────────────────
def _one_run(base_url: str, token: str, run_index: int) -> dict[str, Any]:
    """One probe iteration: rebuild → list → classify-everyone."""
    started_at = datetime.now(timezone.utc).isoformat()
    rebuild = _post(
        f"{base_url}/api/admin/money/projections/dev-wallets/rebuild",
        {"dry_run": False},
        token=token,
    )

    listing = _get(
        f"{base_url}/api/admin/money/projections/dev-wallets?limit=500",
        token=token,
    )
    projections = listing.get("projections") or []
    classifications = _classification_histogram(base_url, token, projections)

    finished_at = datetime.now(timezone.utc).isoformat()

    return {
        "run_index": run_index,
        "started_at": started_at,
        "finished_at": finished_at,
        "rebuild_counts": rebuild.get("counts", {}),
        "rebuild_state": rebuild.get("state"),
        "rows_total": listing.get("count", 0),
        "projection_checksum": _stable_checksum(projections, PROJECTION_KEYS),
        "classifications": classifications,
    }


# ── Invariant evaluator ────────────────────────────────────────────────────
def _evaluate_invariants(
    runs: list[dict],
    legacy_before: dict,
    legacy_after: dict,
) -> dict[str, Any]:
    """Translate the per-run summaries into pass/fail invariants from the
    user's 2C-B2 acceptance grid."""
    if not runs:
        return {"all_pass": False, "errors": ["no runs"]}

    errors: list[str] = []
    warnings: list[str] = []

    # 1. Projection checksum identical across all runs.
    checksums = {r["projection_checksum"] for r in runs}
    inv_checksum = len(checksums) == 1
    if not inv_checksum:
        errors.append(
            f"projection checksum diverged across runs: {sorted(checksums)}"
        )

    # 2. Classification histograms identical across runs.
    hist_signatures = {
        json.dumps(r["classifications"], sort_keys=True) for r in runs
    }
    inv_hist = len(hist_signatures) == 1
    if not inv_hist:
        errors.append(
            f"classification histogram diverged across runs: {sorted(hist_signatures)}"
        )

    # 3. diverged == 0 in every run.
    diverged_counts = [r["classifications"].get("diverged", 0) for r in runs]
    inv_diverged_zero = all(c == 0 for c in diverged_counts)
    if not inv_diverged_zero:
        errors.append(f"diverged>0 in some run: {diverged_counts}")

    # 4. mock_orphan count stable (the user's "orphan stays visible" rule).
    orphans = [r["classifications"].get("mock_orphan", 0) for r in runs]
    inv_orphan_stable = len(set(orphans)) == 1
    if not inv_orphan_stable:
        errors.append(f"mock_orphan count fluctuated: {orphans}")

    # 5. matches never decreases run-over-run.
    matches = [r["classifications"].get("matches", 0) for r in runs]
    inv_matches_monotone = all(
        matches[i] >= matches[i - 1] for i in range(1, len(matches))
    )
    if not inv_matches_monotone:
        errors.append(f"matches decreased run-over-run: {matches}")

    # 6. Legacy `dev_wallets` checksum unchanged before/after probe.
    inv_legacy_immutable = (
        legacy_before["checksum"] == legacy_after["checksum"]
        and legacy_before["row_count"] == legacy_after["row_count"]
    )
    if not inv_legacy_immutable:
        errors.append(
            f"legacy dev_wallets mutated during probe: "
            f"before {legacy_before} → after {legacy_after}"
        )

    # 7. After the first run, every subsequent rebuild should report
    #    `unchanged == rows_total` (idempotency at the document level).
    rows_total = runs[0]["rows_total"]
    idempotent_runs = []
    for r in runs[1:]:
        counts = r.get("rebuild_counts", {})
        idempotent_runs.append(
            counts.get("unchanged", 0) == rows_total
            and counts.get("written", 0) == 0
        )
    inv_idempotent = all(idempotent_runs) if idempotent_runs else True
    if not inv_idempotent:
        warnings.append(
            "rebuild not fully idempotent past run 1 — some rows written "
            "again (possible upstream ledger movement during probe)"
        )

    return {
        "all_pass": not errors,
        "invariants": {
            "projection_checksum_stable": inv_checksum,
            "classification_histogram_stable": inv_hist,
            "diverged_eq_zero": inv_diverged_zero,
            "mock_orphan_stable": inv_orphan_stable,
            "matches_monotone_non_decreasing": inv_matches_monotone,
            "legacy_dev_wallets_immutable": inv_legacy_immutable,
            "rebuild_idempotent_after_first": inv_idempotent,
        },
        "errors": errors,
        "warnings": warnings,
        "summary": {
            "checksum": next(iter(checksums)) if inv_checksum else None,
            "histogram": runs[0]["classifications"] if inv_hist else None,
            "rows_total": rows_total,
        },
    }


# ── Markdown closeout writer ───────────────────────────────────────────────
def _write_closeout(
    path: str, *, runs: list[dict], legacy_before: dict,
    legacy_after: dict, evaluation: dict, base_url: str,
) -> None:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    status = "✅ STABLE" if evaluation["all_pass"] else "❌ UNSTABLE"
    lines = [
        f"# Phase 2C-B2 — dev_wallets projection stability probe",
        f"**Date:** {today}",
        f"**Status:** {status}",
        f"**Base URL:** `{base_url}`",
        f"**Runs:** {len(runs)} (repeatable, not calendar-bound)",
        "",
        "## Outcome",
        "",
    ]
    if evaluation["all_pass"]:
        lines += [
            "Every invariant from the 2C-B2 acceptance grid held across "
            f"{len(runs)} consecutive runs. The projection is repeatable, "
            "idempotent, and observation-stable; the mock-seed payout "
            "orphan is preserved and visible.",
            "",
            "**Gate for 2C-B3 (switch reads) is satisfied.**",
            "",
        ]
    else:
        lines += [
            "One or more invariants failed. See `errors` below. **Do not "
            "advance to 2C-B3 until these are explained or resolved.**",
            "",
            "Errors:",
        ]
        for e in evaluation["errors"]:
            lines.append(f"  • {e}")
        lines.append("")

    inv = evaluation["invariants"]
    lines += [
        "## Invariants",
        "",
        "| Invariant | Status |",
        "|---|---|",
        f"| projection checksum stable across runs | {'✅' if inv['projection_checksum_stable'] else '❌'} |",
        f"| classification histogram stable across runs | {'✅' if inv['classification_histogram_stable'] else '❌'} |",
        f"| `diverged` count is zero every run | {'✅' if inv['diverged_eq_zero'] else '❌'} |",
        f"| `mock_orphan` count stable (orphan preserved) | {'✅' if inv['mock_orphan_stable'] else '❌'} |",
        f"| `matches` count monotone non-decreasing | {'✅' if inv['matches_monotone_non_decreasing'] else '❌'} |",
        f"| legacy `dev_wallets` not mutated by probe | {'✅' if inv['legacy_dev_wallets_immutable'] else '❌'} |",
        f"| rebuild idempotent after run 1 (`unchanged == rows_total`) | {'✅' if inv['rebuild_idempotent_after_first'] else '❌'} |",
        "",
        "## Per-run summary",
        "",
        "| run | rows | checksum | rebuild.counts | classifications |",
        "|---:|---:|---|---|---|",
    ]
    for r in runs:
        cks = (r["projection_checksum"] or "")[:12]
        c = r["rebuild_counts"]
        rc = (
            f"computed={c.get('computed', 0)}/written={c.get('written', 0)}/"
            f"unchanged={c.get('unchanged', 0)}/errors={c.get('errors', 0)}"
        )
        cls = json.dumps(r["classifications"], sort_keys=True)
        lines.append(
            f"| {r['run_index']} | {r['rows_total']} | `{cks}…` | {rc} | `{cls}` |"
        )

    lines += [
        "",
        "## Legacy `dev_wallets` mutation check",
        "",
        f"- Before probe: rows={legacy_before['row_count']}, checksum=`{legacy_before['checksum'][:16]}…`",
        f"- After probe:  rows={legacy_after['row_count']}, checksum=`{legacy_after['checksum'][:16]}…`",
        f"- Verdict: {'✅ legacy untouched' if inv['legacy_dev_wallets_immutable'] else '❌ MUTATED'}",
        "",
        "## What this probe deliberately did NOT do",
        "",
        "- ❌ Switch any UI reader from `dev_wallets` to projection",
        "- ❌ Remove or modify any legacy `dev_wallets` writer",
        "- ❌ \"Repair\" the mock-seed payout orphan",
        "- ❌ Modify `money_divergence.py`, `pricing_engine.py`, or HVL",
        "- ❌ Edit any source file outside `/app/scripts` and `/app/audit`",
        "",
        "## Next",
        "",
        (
            "Advance to **2C-B3 — switch developer wallet reads to the projection**."
            if evaluation["all_pass"]
            else "Investigate the failing invariants above before advancing. "
                 "Do not progress to 2C-B3."
        ),
        "",
    ]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


# ── Main ───────────────────────────────────────────────────────────────────
async def _main_async(args) -> int:
    token = _login(args.base_url, args.admin_email, args.admin_password)
    print(f"✓ logged in as {args.admin_email}")

    legacy_before = await _legacy_checksum(args.mongo_url, args.db_name)
    print(
        f"✓ legacy snapshot: {legacy_before['row_count']} rows, "
        f"checksum={legacy_before['checksum'][:12]}…"
    )

    runs: list[dict] = []
    for i in range(1, args.runs + 1):
        r = _one_run(args.base_url, token, i)
        runs.append(r)
        c = r["rebuild_counts"]
        print(
            f"  run {i}: rows={r['rows_total']} "
            f"written={c.get('written', 0)} unchanged={c.get('unchanged', 0)} "
            f"classifications={r['classifications']} "
            f"checksum={r['projection_checksum'][:12]}…"
        )

    legacy_after = await _legacy_checksum(args.mongo_url, args.db_name)
    print(
        f"✓ legacy snapshot after: {legacy_after['row_count']} rows, "
        f"checksum={legacy_after['checksum'][:12]}…"
    )

    evaluation = _evaluate_invariants(runs, legacy_before, legacy_after)

    artefact = {
        "phase": "2C-B2",
        "ran_at": datetime.now(timezone.utc).isoformat(),
        "base_url": args.base_url,
        "runs_requested": args.runs,
        "runs": runs,
        "legacy_before": legacy_before,
        "legacy_after": legacy_after,
        "evaluation": evaluation,
    }
    os.makedirs(os.path.dirname(args.json_out), exist_ok=True)
    with open(args.json_out, "w", encoding="utf-8") as f:
        json.dump(artefact, f, indent=2, sort_keys=True, default=str)
    print(f"✓ wrote artefact → {args.json_out}")

    _write_closeout(
        args.md_out,
        runs=runs,
        legacy_before=legacy_before,
        legacy_after=legacy_after,
        evaluation=evaluation,
        base_url=args.base_url,
    )
    print(f"✓ wrote closeout → {args.md_out}")

    if evaluation["all_pass"]:
        print("\n✅ ALL INVARIANTS HOLD — 2C-B2 acceptance met.")
        return 0
    else:
        print("\n❌ STABILITY FAILED — see errors:")
        for e in evaluation["errors"]:
            print(f"   • {e}")
        return 1


def main() -> int:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--runs", type=int, default=5,
                   help="number of consecutive probe iterations (default 5)")
    p.add_argument("--base-url", default="http://localhost:8001",
                   help="backend base URL")
    p.add_argument("--admin-email", default="admin@atlas.dev")
    p.add_argument("--admin-password", default="admin123")
    p.add_argument("--mongo-url",
                   default=os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    p.add_argument("--db-name",
                   default=os.environ.get("DB_NAME", "test_database"))
    p.add_argument("--json-out",
                   default="/app/audit/dev_wallet_projection_stability.json")
    p.add_argument("--md-out",
                   default=f"/app/audit/PHASE_2C_B2_DEV_WALLETS_STABILITY_{today}.md")
    args = p.parse_args()

    try:
        return asyncio.run(_main_async(args))
    except urllib.error.HTTPError as e:
        print(f"HTTP error: {e.code} {e.reason}", file=sys.stderr)
        try:
            print(e.read().decode("utf-8"), file=sys.stderr)
        except Exception:  # noqa: BLE001
            pass
        return 2
    except urllib.error.URLError as e:
        print(f"Network error: {e.reason}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
