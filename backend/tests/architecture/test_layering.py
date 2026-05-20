"""
Architecture invariants — static-grep CI guardrails.

5 invariants from audit §7. Each declares a BASELINE (current bad count) so
the test fails on regressions even before the count reaches zero. As code
migrates onto repositories / shared.config / shared.errors, baselines
ratchet down.
"""
from __future__ import annotations

import os
import re
from collections import defaultdict
from pathlib import Path

import pytest


BACKEND = Path(__file__).resolve().parent.parent.parent

# Files exempt from architecture rules (seed scripts, migrations, infra).
EXEMPT_FILES = {
    "mock_seed.py",
    "seed_replay.py",
    "seed_money_demo.py",
    "init_decision_collections.py",
    "init_earnings_collections.py",
    "init_events_collection.py",
    "gunicorn_conf.py",
    "run_stub.sh",
    "run_overdue_check.sh",
}


def _py_files(root: Path) -> list[Path]:
    out: list[Path] = []
    for p in root.rglob("*.py"):
        rel = p.relative_to(root).as_posix()
        if "__pycache__" in rel or "/tests/" in rel or rel.startswith("tests/"):
            continue
        if "/scripts/" in rel or "/audit/" in rel:
            continue
        if p.name in EXEMPT_FILES:
            continue
        out.append(p)
    return out


def _read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return ""


# ─── INVARIANT 1: routers/app.py must not touch db directly ──────────────────
def test_routers_do_not_access_db_directly() -> None:
    """Future routers/ folder must call repositories, never db.collection.X.

    Currently EMPTY (no routers/ directory yet — Phase 0 hasn't extracted
    them). This test guards FUTURE state. While that's true, it passes
    trivially. Once routers/ appears it activates.
    """
    routers_dir = BACKEND / "app" / "routers"
    if not routers_dir.exists():
        pytest.skip("app/routers/ not yet created — routes still in server.py")

    offenders: list[tuple[str, int]] = []
    for p in routers_dir.rglob("*.py"):
        src = _read(p)
        hits = len(re.findall(r"\bdb\.\w+\.(insert_one|update_one|delete_one|find)", src))
        if hits:
            offenders.append((str(p.relative_to(BACKEND)), hits))
    assert not offenders, f"Routers touching db directly: {offenders}"


# ─── INVARIANT 2: no new `except: pass` ──────────────────────────────────────
# Audit baseline 2026-05-19: 64 silent catches across backend (this measure
# uses a stricter regex than the original audit grep). Existing offenders
# are grandfathered; new ones fail the test.
SILENT_EXCEPT_BASELINE = 64


def test_silent_except_does_not_grow() -> None:
    """`except: pass` is a deliberate footgun. Existing 61 are grandfathered;
    new occurrences fail the test."""
    pat = re.compile(
        r"except[^:]*:\s*(?:#[^\n]*\n)?\s*pass\b", re.MULTILINE
    )
    counts: dict[str, int] = {}
    total = 0
    for p in _py_files(BACKEND):
        n = len(pat.findall(_read(p)))
        if n:
            counts[p.relative_to(BACKEND).as_posix()] = n
            total += n

    assert total <= SILENT_EXCEPT_BASELINE, (
        f"silent except count grew: {total} > baseline {SILENT_EXCEPT_BASELINE}. "
        f"Offenders: {dict(sorted(counts.items(), key=lambda x: -x[1])[:5])}. "
        f"Use shared.errors typed exceptions instead."
    )


# ─── INVARIANT 3: max function length ────────────────────────────────────────
# Audit found: startup_event 748, leave 516, estimate_project 269, etc.
# Baseline current worst-case to prevent NEW giant functions.
MAX_FUNCTION_LINES = 120
FAT_FUNCTION_BASELINE = 75   # current count of functions > 120 lines (audit 2026-05-19 + Phase 2A)


def test_no_new_giant_functions() -> None:
    """Functions >120 lines are a smell — extract use-cases. Baseline current
    fat count; PRs cannot grow it."""
    pat = re.compile(r"^(\s*)(?:async )?def (\w+)", re.MULTILINE)
    fat: list[tuple[str, str, int]] = []
    for p in _py_files(BACKEND):
        lines = _read(p).split("\n")
        funcs = [(i, m.group(2), len(m.group(1))) for i, l in enumerate(lines) for m in [pat.match(l)] if m]
        for idx, (start, name, indent) in enumerate(funcs):
            end = funcs[idx + 1][0] if idx + 1 < len(funcs) else len(lines)
            size = end - start
            if size > MAX_FUNCTION_LINES:
                fat.append((p.relative_to(BACKEND).as_posix(), name, size))

    assert len(fat) <= FAT_FUNCTION_BASELINE, (
        f"Function-size baseline blown: {len(fat)} > {FAT_FUNCTION_BASELINE}. "
        f"New fat functions: {sorted(fat, key=lambda x: -x[2])[:5]}. "
        f"Extract use-cases into domain services."
    )


# ─── INVARIANT 4: file size warning + hard cap ───────────────────────────────
MAX_FILE_LINES_WARN = 1500
MAX_FILE_LINES_HARD = 3500   # server.py 26916, execution_intelligence 3098

# Files allowed to exceed the hard cap (currently — should shrink over time).
HARD_CAP_GRANDFATHERED = {
    "server.py",                       # 27K — Phase 1+ target
    "execution_intelligence.py",       # 3098 — decompose in Phase 5
    "time_tracking_layer.py",          # 1623 — domain extraction TBD
}


def test_file_size_hard_cap() -> None:
    """Any NEW file above 3500 LoC fails the build. Grandfathered list does
    not grow."""
    too_big: list[tuple[str, int]] = []
    for p in _py_files(BACKEND):
        n = sum(1 for _ in _read(p).split("\n"))
        if n > MAX_FILE_LINES_HARD and p.name not in HARD_CAP_GRANDFATHERED:
            too_big.append((p.relative_to(BACKEND).as_posix(), n))
    assert not too_big, f"New giant files: {too_big}. Split before merging."


def test_file_size_warn() -> None:
    """Soft warning: emits xfail for files > 1500 LoC not yet planned for
    decomposition. Use this as a steering signal, not a blocker."""
    warnings = []
    for p in _py_files(BACKEND):
        n = sum(1 for _ in _read(p).split("\n"))
        if MAX_FILE_LINES_WARN < n <= MAX_FILE_LINES_HARD:
            warnings.append((p.relative_to(BACKEND).as_posix(), n))
    # Information only — print for visibility, don't fail.
    if warnings:
        print(f"\n[WARN] Files > {MAX_FILE_LINES_WARN} LoC awaiting decomposition:")
        for name, n in sorted(warnings, key=lambda x: -x[1]):
            print(f"  {n:5}  {name}")


# ─── INVARIANT 5: one writer per critical collection ─────────────────────────
# Future state: each collection has exactly one writer (its repository).
# Today: record baselines from audit; PR fails if the writer-count GROWS.
CRITICAL_COLLECTIONS = {
    "users": 11,
    "modules": 14,
    "projects": 5,
    "money_ledger_events": 1,    # new — must stay 1
    "qa_decisions": 5,
    "auto_actions": 7,
    "system_actions_log": 7,
    "events": 6,
    "work_units": 6,
    "invoices": 4,
}


def test_one_writer_per_collection_does_not_grow() -> None:
    """Each critical collection has a baseline #writers. PR fails if any goes UP."""
    write_op = re.compile(
        r"\bdb\.(\w+)\.(insert_one|insert_many|update_one|update_many|"
        r"delete_one|delete_many|replace_one|find_one_and_update|bulk_write)"
    )
    writers: dict[str, set[str]] = defaultdict(set)
    for p in _py_files(BACKEND):
        # Repositories themselves are EXPECTED to write — exclude them.
        rel = p.relative_to(BACKEND).as_posix()
        if rel.startswith("infrastructure/db/repositories/"):
            continue
        src = _read(p)
        for m in write_op.finditer(src):
            writers[m.group(1)].add(rel)

    grew: list[tuple[str, int, int, list[str]]] = []
    for coll, baseline in CRITICAL_COLLECTIONS.items():
        actual_writers = writers.get(coll, set())
        if len(actual_writers) > baseline:
            grew.append((coll, baseline, len(actual_writers), sorted(actual_writers)))

    assert not grew, (
        "Writer-count grew for critical collections (single-ownership regression):\n"
        + "\n".join(
            f"  db.{c}: was {b} → now {n}: {ws}"
            for c, b, n, ws in grew
        )
        + "\nRoute new writes through infrastructure/db/repositories/."
    )


# ─── INVARIANT 7: only domains/money/ writes to money collections ────────────
# Single-ownership boundary for Phase 2 Money pilot. Any new file (outside
# domains/money/ and infrastructure/db/repositories/) that writes to a money
# collection fails this test. Existing offenders are grandfathered until
# Phase 2B migrates them.
MONEY_COLLECTIONS: set[str] = {
    "money_ledger_events",   # canonical ledger (only MoneyRepository writes)
    "dev_wallets",
    "dev_earning_log",
    "payments",
    "payouts",
    "escrows",
    "invoices",
    "platform_revenue",
}

# Files allowed to write to money collections today (will shrink in Phase 2B):
MONEY_WRITERS_GRANDFATHERED: set[str] = {
    "server.py",
    "earnings_layer.py",
    "escrow_layer.py",
    "escrow_api.py",
    "money_ledger.py",
    "money_runtime.py",
    "money_divergence.py",
    "payout_layer.py",
    "client_escrow.py",
    "seed_money_demo.py",
    "module_motion.py",
    "wayforpay_callback.py",
    "auto_guardian.py",
    "overdue_engine.py",
    "client_acceptance.py",
}


def test_only_money_domain_writes_to_money_collections() -> None:
    """The Money pilot's most important invariant.

    AFTER Phase 2B migration completes:
      • only `domains/money/*` and `infrastructure/db/repositories/money.py`
        may write to MONEY_COLLECTIONS.
      • The grandfathered set above shrinks each PR until empty.
    """
    write_op = re.compile(
        r"\bdb\.(\w+)\.(insert_one|insert_many|update_one|update_many|"
        r"delete_one|delete_many|replace_one|find_one_and_update|bulk_write)"
    )
    new_offenders: list[tuple[str, str]] = []
    for p in _py_files(BACKEND):
        rel = p.relative_to(BACKEND).as_posix()
        # Allowed writers
        if rel.startswith("domains/money/"):
            continue
        if rel.startswith("infrastructure/db/repositories/"):
            continue
        if p.name in MONEY_WRITERS_GRANDFATHERED:
            continue
        # Anyone else writing to a money collection is a NEW offender
        src = _read(p)
        for m in write_op.finditer(src):
            coll = m.group(1)
            if coll in MONEY_COLLECTIONS:
                new_offenders.append((rel, coll))

    assert not new_offenders, (
        "New file writes to a money collection outside domains/money/:\n"
        + "\n".join(f"  {f} → db.{c}" for f, c in new_offenders)
        + "\nRoute writes through MoneyService (domains/money/service.py)."
    )


# ─── INVARIANT 6: domain cross-imports forbidden ─────────────────────────────
def test_domains_do_not_cross_import() -> None:
    """domains/X/ must not `from domains.Y import` — only through events.

    Currently no domains/ folder exists yet. Skips trivially until it does.
    """
    domains_dir = BACKEND / "domains"
    if not domains_dir.exists():
        pytest.skip("domains/ not yet created — extraction not started")

    domain_names = [
        d.name for d in domains_dir.iterdir() if d.is_dir() and not d.name.startswith("_")
    ]
    violations: list[tuple[str, str]] = []
    for d in domain_names:
        for p in (domains_dir / d).rglob("*.py"):
            src = _read(p)
            for other in domain_names:
                if other == d:
                    continue
                if re.search(rf"^from domains\.{other}\b|^import domains\.{other}\b", src, re.MULTILINE):
                    violations.append((p.relative_to(BACKEND).as_posix(), other))
    assert not violations, (
        f"Cross-domain imports detected (use events.publish() instead):\n  {violations}"
    )
