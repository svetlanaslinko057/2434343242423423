"""
Reputation decay — keeps the developer ranking alive.

Simple rule: an inactive developer loses score over time.

  days_inactive <= 7       → 0 penalty
  7  < days_inactive <= 14 → 3 points off
  14 < days_inactive <= 21 → 6 points off
  ...                      cap at 15

That's it. No ML, no coefficients, no predictions. The decay is added
as a subtraction against the final developer rating and surfaced in
/api/developer/growth/dashboard so the dev sees it coming.

Activity = developer did something meaningful (submit, accept, timer
stop, module delivered). Writes are funnelled through touch_activity()
so there is exactly one place that updates db.users.last_active_at.
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

GRACE_DAYS = 7
PER_WEEK_PENALTY = 3
MAX_PENALTY = 15


def _parse_iso(value: Any) -> Optional[datetime]:
    """Accept datetime, ISO string, or None. Always return tz-aware UTC."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def apply_decay(last_active: Any, now: Optional[datetime] = None) -> int:
    """Return the penalty (0-MAX_PENALTY) for a given last-active timestamp.

    Never-active user → MAX_PENALTY (treated as fully stale).
    """
    now = now or datetime.now(timezone.utc)
    la = _parse_iso(last_active)
    if la is None:
        return MAX_PENALTY
    days = max(0, (now - la).days)
    if days <= GRACE_DAYS:
        return 0
    weeks = days // GRACE_DAYS
    return min(weeks * PER_WEEK_PENALTY, MAX_PENALTY)


def get_decay_info(last_active: Any, now: Optional[datetime] = None) -> dict:
    """UI-ready payload used by /developer/growth/dashboard and the mobile
    home screen. Always returns the same shape."""
    now = now or datetime.now(timezone.utc)
    la = _parse_iso(last_active)
    days = None if la is None else max(0, (now - la).days)
    penalty = apply_decay(last_active, now)

    if la is None:
        message = "No activity recorded yet — complete a module to start your score."
    elif penalty == 0:
        message = f"Active ({days}d ago). Your score is safe."
    elif penalty < MAX_PENALTY:
        message = (f"Your score is decreasing due to inactivity "
                   f"({days}d idle, −{penalty} points). Complete a module to recover.")
    else:
        message = (f"Inactive for {days}d — maximum decay ({penalty} points) applied. "
                   f"Complete a module to reset.")

    return {
        "active": penalty > 0,
        "last_active_at": la.isoformat() if la else None,
        "days_inactive": days,
        "penalty": penalty,
        "max_penalty": MAX_PENALTY,
        "grace_days": GRACE_DAYS,
        "message": message,
    }


async def touch_activity(db, developer_id: Optional[str]) -> None:
    """Single write-path for last_active_at. Silently skips if id is None or
    the user isn't a developer — keeps admin/client writes out of the signal."""
    if not developer_id:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        await db.users.update_one(
            {"user_id": developer_id, "role": "developer"},
            {"$set": {"last_active_at": now_iso}},
        )
    except Exception:
        # Never block a real action because of activity bookkeeping.
        pass
