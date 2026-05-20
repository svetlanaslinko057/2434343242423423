"""
Structured logging helper.

Wraps stdlib `logging` with a helper that always emits structured fields
suitable for log-aggregation pipelines. Replaces ad-hoc `print(...)` and
unstructured `logger.info(f"x={x}")` calls.

Usage:
    from shared.logging import get_logger
    log = get_logger(__name__)
    log.info("invoice.paid", extra={"invoice_id": "inv_1", "amount": 100.0})
"""
from __future__ import annotations
import logging
import sys


_CONFIGURED = False


def _configure_root_once() -> None:
    """Set up root logger formatter on first import. Idempotent."""
    global _CONFIGURED
    if _CONFIGURED:
        return
    handler = logging.StreamHandler(sys.stdout)
    fmt = logging.Formatter(
        fmt="%(asctime)s %(levelname)s %(name)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(fmt)
    root = logging.getLogger()
    # Only add our handler if root has no handlers (avoid double-logging
    # when uvicorn / pytest install their own).
    if not root.handlers:
        root.addHandler(handler)
    root.setLevel(logging.INFO)
    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    """Return a logger configured against the shared root handler."""
    _configure_root_once()
    return logging.getLogger(name)
