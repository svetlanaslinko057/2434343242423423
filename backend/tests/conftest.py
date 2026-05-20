"""Shared fixtures for backend tests. Ensures /app/backend is on sys.path so
reputation_decay etc. resolve from test files."""
import os, sys

# Make sibling modules (reputation_decay, developer_economy, …) importable.
_BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)
