#!/usr/bin/env python3
"""
Money Divergence Detector — standalone CLI runner.

Stage 7A — see /app/audit/MONEY_AUTHORITY_CHARTER.md §9 Step 2.

Read-only. Connects to MongoDB directly (no HTTP), runs the same diff logic
as the /api/admin/money/divergence/* endpoints, prints JSON to stdout.

Usage:
    python3 /app/scripts/money_divergence.py overview
    python3 /app/scripts/money_divergence.py modules [--diverged-only]
    python3 /app/scripts/money_divergence.py module <module_id>
    python3 /app/scripts/money_divergence.py developers [--diverged-only]
    python3 /app/scripts/money_divergence.py developer <user_id>

Environment:
    MONGO_URL  (required, read from /app/backend/.env)
    DB_NAME    (optional, defaults to "test_database")

Always-runnable: safe to cron, safe to pipe through jq, safe to diff between
runs ("did anything new diverge today?").
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

# Make the backend package importable so we reuse the live diff logic.
BACKEND_DIR = Path("/app/backend")
sys.path.insert(0, str(BACKEND_DIR))

# Load .env the same way the server does.
try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv(BACKEND_DIR / ".env")
except ImportError:
    pass

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

import money_divergence  # noqa: E402


def _connect():
    url = os.environ.get("MONGO_URL")
    name = os.environ.get("DB_NAME", "test_database")
    if not url:
        print("ERROR: MONGO_URL not set in env", file=sys.stderr)
        sys.exit(2)
    return AsyncIOMotorClient(url)[name]


async def _run(argv: list[str]):
    if not argv:
        print(__doc__)
        sys.exit(1)
    cmd, *rest = argv
    db = _connect()
    diverged_only = "--diverged-only" in rest
    rest = [r for r in rest if not r.startswith("--")]

    if cmd == "overview":
        return await money_divergence.overview(db)
    if cmd == "blast-radius":
        return await money_divergence.blast_radius(db)
    if cmd == "modules":
        rows = await money_divergence.scan_modules(db)
        if diverged_only:
            rows = [r for r in rows if not r.get("ok")]
        return {"count": len(rows), "rows": rows}
    if cmd == "module":
        if not rest:
            print("Usage: module <module_id>", file=sys.stderr)
            sys.exit(1)
        return await money_divergence._diff_module(db, rest[0])
    if cmd == "developers":
        rows = await money_divergence.scan_developers(db)
        if diverged_only:
            rows = [r for r in rows if not r.get("ok")]
        return {"count": len(rows), "rows": rows}
    if cmd == "developer":
        if not rest:
            print("Usage: developer <user_id>", file=sys.stderr)
            sys.exit(1)
        return await money_divergence._diff_developer(db, rest[0])

    print(f"Unknown command: {cmd}", file=sys.stderr)
    print(__doc__)
    sys.exit(1)


def main():
    out = asyncio.run(_run(sys.argv[1:]))
    json.dump(out, sys.stdout, indent=2, ensure_ascii=False, default=str)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
