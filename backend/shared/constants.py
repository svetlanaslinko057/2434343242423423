"""
Business constants and default thresholds.

These are the ONLY allowed home for hardcoded business numbers outside of
database-driven configuration. Anything tunable at runtime lives in
`db.pricing_config` / `db.system_config` and falls back here as the default.

Rule: no other file may inline magic business numbers. Use these constants
(or read from db config). Architecture tests grep for inline literals in
routers/* and fail PRs that introduce new ones.

Audit reference: ARCHITECTURE_DECOMPOSITION_AUDIT_2026-05-19.md §1.4 (B-2).
"""
from __future__ import annotations
from typing import Final

# ── Pricing tier multipliers ────────────────────────────────────────────────
TIER_MULTIPLIER_JUNIOR: Final[float] = 0.75
TIER_MULTIPLIER_MIDDLE: Final[float] = 1.0
TIER_MULTIPLIER_SENIOR: Final[float] = 1.5
TIER_MULTIPLIER_ELITE: Final[float] = 2.0

# ── QA / Acceptance thresholds ──────────────────────────────────────────────
QA_PASS_THRESHOLD: Final[float] = 0.7        # confidence ≥ this → auto-pass
QA_FLAG_THRESHOLD: Final[float] = 0.4        # confidence < this → flag for admin
QA_REVISION_CAP: Final[int] = 3              # max revision rounds per module
DEVELOPER_QUALITY_FLOOR: Final[float] = 0.55  # below this → suspend assignment

# ── Escrow / payouts ────────────────────────────────────────────────────────
ESCROW_HOLD_HOURS: Final[int] = 48           # hold after approval before release
PAYOUT_BATCH_MIN_AMOUNT: Final[float] = 10.0  # minimum amount to issue payout
WITHDRAWAL_DEFAULT_FEE_PCT: Final[float] = 0.02

# ── Assignment / capacity ───────────────────────────────────────────────────
DEFAULT_DEVELOPER_CAPACITY: Final[int] = 5   # max concurrent modules
OVERLOAD_THRESHOLD: Final[int] = 7
OVERDUE_GRACE_HOURS: Final[int] = 24

# ── Time tracking ───────────────────────────────────────────────────────────
TIMER_IDLE_TIMEOUT_MINUTES: Final[int] = 30
TIMER_MAX_DAILY_HOURS: Final[float] = 12.0

# ── Authentication ──────────────────────────────────────────────────────────
PASSWORD_MIN_LENGTH: Final[int] = 6
SESSION_TTL_DAYS: Final[int] = 30
OTP_CODE_TTL_SECONDS: Final[int] = 300       # 5 minutes
OTP_MAX_ATTEMPTS: Final[int] = 5
BRUTE_FORCE_LOCKOUT_MINUTES: Final[int] = 15

# ── Realtime / WebSocket ────────────────────────────────────────────────────
SOCKET_PING_INTERVAL_SECONDS: Final[int] = 25
SOCKET_PING_TIMEOUT_SECONDS: Final[int] = 60

# ── Background loop intervals (seconds) ─────────────────────────────────────
GUARDIAN_LOOP_SECONDS: Final[int] = 120
MODULE_MOTION_LOOP_SECONDS: Final[int] = 15
OPERATOR_SCHEDULER_LOOP_SECONDS: Final[int] = 300
EVENT_ENGINE_LOOP_SECONDS: Final[int] = 900  # 15 minutes
AUTONOMY_SCAN_LOOP_SECONDS: Final[int] = 300

# ── Validation / community ──────────────────────────────────────────────────
VALIDATION_QUORUM_MIN: Final[int] = 3
VALIDATION_AGREEMENT_THRESHOLD: Final[float] = 0.66

# ── Reputation decay ────────────────────────────────────────────────────────
REPUTATION_DECAY_HALF_LIFE_DAYS: Final[int] = 90

# ── Currency ────────────────────────────────────────────────────────────────
DEFAULT_CURRENCY: Final[str] = "USD"
SUPPORTED_CURRENCIES: Final[tuple[str, ...]] = ("USD", "EUR", "UAH")
