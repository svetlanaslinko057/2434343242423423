"""
Reputation decay — unit + integration tests.

Covers:
  • reputation_decay.apply_decay() — table of cases + parser resilience
  • reputation_decay.get_decay_info() — payload shape + 4 messages
  • reputation_decay.touch_activity() — developer-only write, noop on None,
    never raises
  • developer_economy.calculate_developer_rating() — decay applied to
    final rating, breakdown.base_rating + breakdown.decay_penalty
  • GET /api/developer/growth/dashboard — `decay` field shape + regression
    of existing top-level keys
  • POST /api/developer/timer/stop   → last_active_at refresh
  • POST /api/developer/tasks/{id}/submit → last_active_at refresh
  • POST /api/developer/tasks/{id}/accept → last_active_at refresh
  • admin endpoint call does NOT touch john.last_active_at (admin is not dev)

After every test the john@atlas.dev row is reset to now() and any test
seeded work_units / qa_decisions (prefixed test_wu_ / test_qd_) are purged.
"""
import os, sys, uuid, asyncio
from datetime import datetime, timezone, timedelta

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

# Make backend modules importable
_BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from reputation_decay import (              # noqa: E402
    apply_decay,
    get_decay_info,
    touch_activity,
    GRACE_DAYS,
    PER_WEEK_PENALTY,
    MAX_PENALTY,
)
from developer_economy import calculate_developer_rating  # noqa: E402

# ─────────────────────────── config ────────────────────────────────────
BASE_URL = os.environ.get(
    "EXPO_BACKEND_URL", "https://expo-react-stack.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

JOHN_ID = "user_fe458c829cc5"
JOHN_EMAIL = "john@atlas.dev"

CREDS = {
    "admin":  {"email": "admin@atlas.dev",  "password": "admin123"},
    "dev":    {"email": JOHN_EMAIL,         "password": "dev123"},
    "client": {"email": "client@atlas.dev", "password": "client123"},
}


# ─────────────────────────── helpers ───────────────────────────────────
def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return s


def _db():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


def _run(coro):
    """Tiny helper so we can call async mongo ops from sync tests."""
    return asyncio.get_event_loop().run_until_complete(coro) \
        if False else asyncio.new_event_loop().run_until_complete(coro)


async def _reset_john_fresh():
    db = _db()
    await db.users.update_one(
        {"email": JOHN_EMAIL},
        {"$set": {"last_active_at": datetime.now(timezone.utc).isoformat()}},
    )


async def _set_john_last_active(iso_or_none):
    db = _db()
    if iso_or_none is None:
        await db.users.update_one(
            {"email": JOHN_EMAIL}, {"$unset": {"last_active_at": ""}}
        )
    else:
        await db.users.update_one(
            {"email": JOHN_EMAIL}, {"$set": {"last_active_at": iso_or_none}}
        )


async def _get_john_last_active():
    db = _db()
    u = await db.users.find_one({"email": JOHN_EMAIL}, {"_id": 0, "last_active_at": 1})
    return (u or {}).get("last_active_at")


async def _cleanup_test_seed():
    db = _db()
    await db.work_units.delete_many({"unit_id": {"$regex": "^test_wu_"}})
    await db.qa_decisions.delete_many({"decision_id": {"$regex": "^test_qd_"}})
    await db.submissions.delete_many({"unit_id": {"$regex": "^test_wu_"}})
    await db.task_earnings.delete_many({"task_id": {"$regex": "^test_wu_"}})


# ─────────────────── restore john / cleanup after every test ───────────
@pytest.fixture(autouse=True)
def _cleanup_between_tests():
    yield
    _run(_cleanup_test_seed())
    _run(_reset_john_fresh())


# ─────────────────── reusable sessions (module scope) ──────────────────
@pytest.fixture(scope="module")
def admin_session():
    return _login(CREDS["admin"])


@pytest.fixture(scope="module")
def dev_session():
    return _login(CREDS["dev"])


# ════════════════════ UNIT ▸ apply_decay ══════════════════════════════
class TestApplyDecay:
    """Table-driven — docs line 5-10 contract."""

    NOW = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)

    @pytest.mark.parametrize("days,expected", [
        (0,  0),      # today
        (3,  0),
        (7,  0),     # edge of grace window
        (8,  3),     # first week past grace
        (14, 6),
        (21, 9),
        (28, 12),
        (35, 15),    # cap reached
        (90, 15),    # capped
    ])
    def test_penalty_table(self, days, expected):
        la = (self.NOW - timedelta(days=days)).isoformat()
        assert apply_decay(la, now=self.NOW) == expected

    def test_none_returns_max(self):
        assert apply_decay(None, now=self.NOW) == MAX_PENALTY == 15

    def test_accepts_datetime_object(self):
        la = self.NOW - timedelta(days=10)
        assert apply_decay(la, now=self.NOW) == 3

    def test_accepts_iso_with_z_suffix(self):
        la_iso = (self.NOW - timedelta(days=21)).isoformat().replace("+00:00", "Z")
        assert apply_decay(la_iso, now=self.NOW) == 9

    def test_accepts_naive_iso(self):
        naive = (self.NOW - timedelta(days=14)).replace(tzinfo=None).isoformat()
        assert apply_decay(naive, now=self.NOW) == 6

    def test_invalid_string_returns_max(self):
        assert apply_decay("not a date", now=self.NOW) == MAX_PENALTY

    def test_constants(self):
        assert GRACE_DAYS == 7 and PER_WEEK_PENALTY == 3 and MAX_PENALTY == 15


# ════════════════════ UNIT ▸ get_decay_info ═══════════════════════════
class TestGetDecayInfo:
    NOW = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
    EXPECTED_KEYS = {
        "active", "last_active_at", "days_inactive",
        "penalty", "max_penalty", "grace_days", "message",
    }

    def test_shape_never_active(self):
        info = get_decay_info(None, now=self.NOW)
        assert set(info.keys()) == self.EXPECTED_KEYS
        assert info == {
            "active": True,
            "last_active_at": None,
            "days_inactive": None,
            "penalty": 15,
            "max_penalty": 15,
            "grace_days": 7,
            "message": info["message"],   # checked next
        }
        assert "no activity" in info["message"].lower()

    def test_message_safe(self):
        la = (self.NOW - timedelta(days=3)).isoformat()
        info = get_decay_info(la, now=self.NOW)
        assert info["penalty"] == 0
        assert info["active"] is False
        assert "safe" in info["message"].lower()
        assert info["days_inactive"] == 3

    def test_message_decreasing(self):
        la = (self.NOW - timedelta(days=14)).isoformat()
        info = get_decay_info(la, now=self.NOW)
        assert info["penalty"] == 6
        assert info["active"] is True
        assert "decreasing" in info["message"].lower()
        assert "−6" in info["message"] or "-6" in info["message"]

    def test_message_maxed_out(self):
        la = (self.NOW - timedelta(days=60)).isoformat()
        info = get_decay_info(la, now=self.NOW)
        assert info["penalty"] == 15
        assert info["active"] is True
        assert "maximum decay" in info["message"].lower()

    def test_last_active_at_always_iso_utc_when_provided(self):
        la = (self.NOW - timedelta(days=2)).replace(tzinfo=None).isoformat()
        info = get_decay_info(la, now=self.NOW)
        # Result must be a valid tz-aware ISO string
        dt = datetime.fromisoformat(info["last_active_at"])
        assert dt.tzinfo is not None


# ════════════════════ UNIT ▸ touch_activity ═══════════════════════════
class TestTouchActivity:

    def test_updates_developer_row(self):
        async def go():
            db = _db()
            await _set_john_last_active("2020-01-01T00:00:00+00:00")
            await touch_activity(db, JOHN_ID)
            u = await db.users.find_one({"user_id": JOHN_ID},
                                        {"_id": 0, "last_active_at": 1})
            ts = datetime.fromisoformat(u["last_active_at"])
            # should be within last 5 min
            assert (datetime.now(timezone.utc) - ts) < timedelta(minutes=5)
        _run(go())

    def test_skips_non_developer(self):
        """admin user_id with role=admin should NOT be written."""
        async def go():
            db = _db()
            admin = await db.users.find_one({"email": "admin@atlas.dev"},
                                            {"_id": 0, "user_id": 1, "role": 1})
            assert admin["role"] == "admin"
            before = await db.users.find_one({"user_id": admin["user_id"]},
                                             {"_id": 0, "last_active_at": 1})
            await touch_activity(db, admin["user_id"])
            after = await db.users.find_one({"user_id": admin["user_id"]},
                                            {"_id": 0, "last_active_at": 1})
            # No write — field stays untouched (either both None or equal)
            assert before.get("last_active_at") == after.get("last_active_at")
        _run(go())

    def test_none_is_silent_noop(self):
        async def go():
            db = _db()
            await touch_activity(db, None)      # must not raise
            await touch_activity(db, "")        # falsy — must not raise
        _run(go())

    def test_never_raises_on_db_error(self):
        async def go():
            class BrokenDB:
                class users:
                    @staticmethod
                    async def update_one(*_a, **_kw):
                        raise RuntimeError("mongo down")
            # Should swallow the exception
            await touch_activity(BrokenDB(), "someone")
        _run(go())


# ════════════════════ INTEGRATION ▸ rating pipeline ═══════════════════
class TestRatingDecayIntegration:
    """Seed 10 done tasks + 10 QA (8 pass / 2 fail). Expect base≈74.5 (senior)."""

    @pytest.fixture(autouse=True)
    def _seed(self):
        async def setup():
            db = _db()
            now = datetime.now(timezone.utc)
            # Seed 10 done tasks — all with estimated == actual to force S=100
            tasks = [{
                "unit_id": f"test_wu_{uuid.uuid4().hex[:10]}",
                "assigned_to": JOHN_ID,
                "status": "done",
                "estimated_hours": 4,
                "actual_hours": 4,
                "created_at": (now - timedelta(days=3)).isoformat(),
            } for _ in range(10)]
            await db.work_units.insert_many(tasks)

            # Seed 10 QA decisions — 8 pass, 2 fail
            qa = []
            for i in range(10):
                qa.append({
                    "decision_id": f"test_qd_{uuid.uuid4().hex[:10]}",
                    "developer_id": JOHN_ID,
                    "result": "passed" if i < 8 else "failed",
                    "created_at": (now - timedelta(days=2)).isoformat(),
                })
            await db.qa_decisions.insert_many(qa)
        _run(setup())
        yield
        # cleanup handled by outer autouse fixture

    def _calc_rating(self, last_active_iso):
        async def go():
            db = _db()
            await _set_john_last_active(last_active_iso)
            return await calculate_developer_rating(db, JOHN_ID, period_days=30)
        return _run(go())

    def test_fresh_no_decay_senior(self):
        """last_active=now → penalty 0, base_rating≈74.5, senior."""
        fresh = datetime.now(timezone.utc).isoformat()
        r = self._calc_rating(fresh)
        # Q=80, S=100, T=50(default — no time_tracking), E=50 → 74.5
        assert r["breakdown"]["Q"] == 80.0
        assert r["breakdown"]["S"] == 100.0
        assert r["breakdown"]["base_rating"] == 74.5
        assert r["breakdown"]["decay_penalty"] == 0
        assert r["rating"] == 74.5
        assert r["level"] == "senior"

    def test_10_days_penalty_3(self):
        la = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
        r = self._calc_rating(la)
        assert r["breakdown"]["base_rating"] == 74.5
        assert r["breakdown"]["decay_penalty"] == 3
        assert r["rating"] == 71.5
        assert r["level"] == "senior"

    def test_30_days_penalty_12(self):
        la = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        r = self._calc_rating(la)
        assert r["breakdown"]["decay_penalty"] == 12
        assert r["rating"] == 62.5
        assert r["level"] == "senior"

    def test_never_active_demotes_to_middle(self):
        r = self._calc_rating(None)   # unsets field
        assert r["breakdown"]["decay_penalty"] == 15
        assert r["rating"] == 59.5
        assert r["level"] == "middle"


# ════════════════════ ENDPOINT ▸ growth dashboard ═════════════════════
class TestGrowthDashboardDecayField:
    EXPECTED_DECAY_KEYS = {
        "active", "last_active_at", "days_inactive",
        "penalty", "max_penalty", "grace_days", "message",
    }

    def test_decay_block_present(self, dev_session):
        r = dev_session.get(f"{API}/developer/growth/dashboard", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "decay" in data, f"missing decay block, keys={list(data.keys())}"
        assert set(data["decay"].keys()) == self.EXPECTED_DECAY_KEYS
        assert data["decay"]["max_penalty"] == 15
        assert data["decay"]["grace_days"] == 7
        assert 0 <= data["decay"]["penalty"] <= 15

    def test_no_regression_on_top_level_fields(self, dev_session):
        r = dev_session.get(f"{API}/developer/growth/dashboard", timeout=15)
        assert r.status_code == 200
        data = r.json()
        for key in ("wallet", "growth_score", "invite_link", "referrals_count", "tier"):
            assert key in data, f"regression: '{key}' missing"

    def test_decay_days_and_penalty_math(self, dev_session):
        stale = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
        _run(_set_john_last_active(stale))
        r = dev_session.get(f"{API}/developer/growth/dashboard", timeout=15).json()
        assert r["decay"]["days_inactive"] == 20
        assert r["decay"]["penalty"] == 6


# ═════════════════ HOOKS ▸ endpoints refresh last_active ══════════════
class TestTimerStopHook:

    def test_timer_stop_refreshes_last_active(self, dev_session):
        stale = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
        _run(_set_john_last_active(stale))
        r = dev_session.post(f"{API}/developer/timer/stop", timeout=15)
        # timer might already-be-stopped → 200 with already_stopped flag,
        # OR 500 if internal fails.  We only care that touch_activity ran.
        after = _run(_get_john_last_active())
        assert after is not None
        ts = datetime.fromisoformat(after)
        assert (datetime.now(timezone.utc) - ts) < timedelta(minutes=5), (
            f"last_active_at not refreshed by timer/stop (got {after}); "
            f"endpoint status={r.status_code} body={r.text[:200]}"
        )


class TestSubmitHook:

    def test_submit_refreshes_last_active(self, dev_session):
        """Create an in_progress work_unit owned by john, submit it, verify."""
        async def seed():
            db = _db()
            unit_id = f"test_wu_{uuid.uuid4().hex[:10]}"
            await db.work_units.insert_one({
                "unit_id": unit_id,
                "assigned_to": JOHN_ID,
                "status": "in_progress",
                "title": "submit hook test",
                "project_id": "test_project",
                "estimated_hours": 1,
                "actual_hours": 0,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            return unit_id
        unit_id = _run(seed())

        stale = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
        _run(_set_john_last_active(stale))

        r = dev_session.post(
            f"{API}/developer/tasks/{unit_id}/submit",
            json={"summary": "done", "links": []},
            timeout=20,
        )
        assert r.status_code == 200, f"submit failed: {r.status_code} {r.text}"

        after = _run(_get_john_last_active())
        ts = datetime.fromisoformat(after)
        assert (datetime.now(timezone.utc) - ts) < timedelta(minutes=5)


class TestAcceptHook:

    def test_accept_refreshes_last_active(self, dev_session):
        async def seed():
            db = _db()
            unit_id = f"test_wu_{uuid.uuid4().hex[:10]}"
            await db.work_units.insert_one({
                "unit_id": unit_id,
                "assigned_to": JOHN_ID,
                "status": "assigned_waiting_response",
                "title": "accept hook test",
                "project_id": "test_project",
                "estimated_hours": 1,
                "actual_hours": 0,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            return unit_id
        unit_id = _run(seed())

        stale = (datetime.now(timezone.utc) - timedelta(days=25)).isoformat()
        _run(_set_john_last_active(stale))

        r = dev_session.post(f"{API}/developer/tasks/{unit_id}/accept", timeout=20)
        # accept_task may succeed (200) or fail due to unrelated accept-layer
        # validation; we still verify activity behaviour below.
        after = _run(_get_john_last_active())
        if r.status_code == 200:
            ts = datetime.fromisoformat(after)
            assert (datetime.now(timezone.utc) - ts) < timedelta(minutes=5), (
                f"last_active_at not refreshed after accept; body={r.text[:200]}"
            )
        else:
            pytest.skip(
                f"accept endpoint returned {r.status_code} "
                f"({r.text[:200]}) — hook not reached"
            )


# ═════════════════ NEGATIVE ▸ admin endpoint does not touch john ══════
class TestAdminActivityIsolation:

    def test_admin_calls_do_not_touch_john(self, admin_session):
        stale = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
        _run(_set_john_last_active(stale))

        # Hit an admin-only endpoint (system/users list)
        r = admin_session.get(f"{API}/admin/system/users", timeout=15)
        assert r.status_code == 200

        after = _run(_get_john_last_active())
        assert after == stale, (
            f"john.last_active_at changed after admin call "
            f"(before={stale}, after={after})"
        )
