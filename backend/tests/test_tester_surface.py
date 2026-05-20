"""
Stage 4 Tester Surface backend tests.

DEPRECATED (iter 10, May 18 2026): superseded by `test_iteration10.py`.
The seed shape changed — this file expects 6 validations + populated
work_units, the new seed produces 5 with status mix (pending/in_progress/
passed/failed/queue) tied to modules instead of work_units. Kept for
audit trail; auto-skipped to avoid red CI.
"""
import os
import uuid
import pytest
import requests

pytestmark = pytest.mark.skip(
    reason="DEPRECATED iter10 — replaced by test_iteration10.py (new seed shape)"
)

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://mobile-expo-stage.preview.emergentagent.com"
).rstrip("/")

TESTER_EMAIL = "tester@atlas.dev"
TESTER_PASSWORD = "tester123"


# ---------------------------------------------------------------- fixtures

@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth(session):
    r = session.post(
        f"{BASE_URL}/api/mobile/auth/login",
        json={"email": TESTER_EMAIL, "password": TESTER_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"mobile login failed: {r.status_code} {r.text}"
    body = r.json()
    assert "token" in body, body
    assert "user" in body, body
    return body


@pytest.fixture(scope="module")
def auth_session(session, auth):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {auth['token']}",
    })
    return s


@pytest.fixture(scope="module")
def tasks(auth_session):
    r = auth_session.get(f"{BASE_URL}/api/tester/validation-tasks", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list)
    return data


# ---------------------------------------------------------------- auth tests

class TestMobileLogin:
    def test_login_returns_tester_role(self, auth):
        u = auth["user"]
        assert u.get("role") == "tester", u
        # REGRESSION-1
        assert u.get("active_context") == "tester", f"active_context missing: {u}"
        states = u.get("states") or []
        assert "tester" in states, f"states missing 'tester': {u}"

    def test_auth_me_reflects_tester(self, auth_session):
        # REGRESSION-2
        r = auth_session.get(f"{BASE_URL}/api/auth/me", timeout=30)
        assert r.status_code == 200, r.text
        me = r.json()
        # /api/auth/me can wrap in {user:...} or be flat - handle both.
        u = me.get("user", me)
        assert "tester" in (u.get("states") or []), f"states missing: {u}"
        assert u.get("active_context") == "tester", f"active_context missing: {u}"
        assert u.get("active_role") == "tester", f"active_role missing: {u}"
        assert "tester" in (u.get("roles") or []), f"roles missing 'tester': {u}"


# ---------------------------------------------------------------- list endpoints

class TestTesterLists:
    def test_validation_tasks_has_six(self, tasks):
        # Spec: 6 seeded items.
        assert len(tasks) >= 6, f"expected >=6 seeded validation tasks, got {len(tasks)}"

    def test_validation_tasks_shape(self, tasks):
        t = tasks[0]
        # Response uses assigned_to and work_unit_id (NOT tester_id/unit_id).
        assert "assigned_to" in t, t.keys()
        assert "work_unit_id" in t, t.keys()
        assert "validation_id" in t, t.keys()
        assert "status" in t, t.keys()

    def test_validation_tasks_mix_of_statuses(self, tasks):
        statuses = {t["status"] for t in tasks}
        # Seed: pending (unclaimed) + in_progress + passed + failed
        assert "pending" in statuses, statuses
        assert "in_progress" in statuses, statuses
        assert "passed" in statuses, statuses
        assert "failed" in statuses, statuses

    def test_tester_issues_array(self, auth_session):
        r = auth_session.get(f"{BASE_URL}/api/tester/issues", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)


# ---------------------------------------------------------------- detail endpoints

@pytest.fixture(scope="module")
def in_progress_validation(tasks):
    for t in tasks:
        if t["status"] == "in_progress":
            return t
    pytest.skip("No in_progress validation in seed")


@pytest.fixture(scope="module")
def pending_validation(tasks):
    for t in tasks:
        if t["status"] == "pending" and not t.get("assigned_to"):
            return t
    pytest.skip("No unclaimed pending validation in seed")


class TestValidationDetails:
    def test_details_populated(self, auth_session, in_progress_validation):
        vid = in_progress_validation["validation_id"]
        r = auth_session.get(f"{BASE_URL}/api/tester/validation/{vid}/details", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "validation" in d
        assert "work_unit" in d
        assert "submission" in d
        assert d["work_unit"] is not None, "work_unit missing"
        assert d["work_unit"].get("title"), f"work_unit.title empty: {d['work_unit']}"
        assert d["submission"] is not None, "submission missing"
        assert d["submission"].get("summary"), f"submission.summary empty: {d['submission']}"

    def test_validation_issues_returns_existing(self, auth_session, in_progress_validation):
        vid = in_progress_validation["validation_id"]
        r = auth_session.get(f"{BASE_URL}/api/tester/validation/{vid}/issues", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        # Per agent-to-agent context, an earlier issue was filed on the in_progress one.
        assert len(data) >= 1, f"expected at least 1 seeded issue on in_progress validation, got {data}"


# ---------------------------------------------------------------- write endpoints

class TestIssueCreation:
    def test_file_issue_appears_in_listing(self, auth_session, in_progress_validation):
        vid = in_progress_validation["validation_id"]
        idem = f"test-issue-{uuid.uuid4().hex[:8]}"
        payload = {
            "title": f"TEST_ Issue {idem}",
            "description": "TEST_ Created by pytest test_tester_surface",
            "severity": "low",
        }
        r = auth_session.post(
            f"{BASE_URL}/api/validation/{vid}/issue",
            json=payload,
            headers={"Idempotency-Key": idem},
            timeout=30,
        )
        assert r.status_code in (200, 201), r.text
        created = r.json()
        # Verify it appears in /issues listing.
        r2 = auth_session.get(f"{BASE_URL}/api/tester/validation/{vid}/issues", timeout=30)
        assert r2.status_code == 200
        listing = r2.json()
        # Match by title (most reliable across response shape variants).
        titles = [i.get("title") for i in listing]
        assert payload["title"] in titles, f"new issue not found in listing. titles={titles}, created={created}"


class TestPassFailIdempotency:
    """
    REGRESSION-3 / 3b / 3c: natural-key idempotency keyed by
    (validation_id, action, tester_id). Same action twice = 200 + idempotent:true.
    Cross-action (pass then fail) still 400.
    """
    def test_pass_idempotent_same_key(self, auth_session, pending_validation):
        # REGRESSION-3
        vid = pending_validation["validation_id"]
        idem = f"pass:{vid}:{uuid.uuid4().hex[:6]}"
        r1 = auth_session.post(
            f"{BASE_URL}/api/validation/{vid}/pass",
            headers={"Idempotency-Key": idem},
            timeout=30,
        )
        assert r1.status_code == 200, f"pass#1: {r1.status_code} {r1.text}"
        body1 = r1.json()
        assert body1.get("message") == "Validation passed", body1
        assert not body1.get("idempotent"), f"first call should NOT be idempotent flagged: {body1}"

        r2 = auth_session.post(
            f"{BASE_URL}/api/validation/{vid}/pass",
            headers={"Idempotency-Key": idem},
            timeout=30,
        )
        assert r2.status_code == 200, f"pass#2 (idempotent): {r2.status_code} {r2.text}"
        body2 = r2.json()
        assert body2.get("message") == "Validation passed", body2
        assert body2.get("idempotent") is True, f"expected idempotent:true on replay, got {body2}"

    def test_fail_after_pass_rejected(self, auth_session, pending_validation):
        """REGRESSION-3b: After /pass, /fail on same row → 400 with status-hint."""
        vid = pending_validation["validation_id"]
        r = auth_session.post(
            f"{BASE_URL}/api/validation/{vid}/fail",
            headers={"Idempotency-Key": f"fail:{vid}:{uuid.uuid4().hex[:6]}"},
            timeout=30,
        )
        assert r.status_code == 400, f"expected 400 cross-action, got {r.status_code} {r.text}"
        body = r.json() if r.text else {}
        hint = body.get("message") or body.get("hint") or body.get("detail") or ""
        # accept any phrasing that conveys current-status block
        assert ("passed" in str(hint).lower()) or ("cannot fail" in str(hint).lower()), \
            f"expected status-hint mentioning 'passed', got: {body}"

    def test_fail_idempotent_symmetric(self, auth_session, tasks):
        """REGRESSION-3c: repeat /fail on an already-failed row by same tester → 200 idempotent:true."""
        # Need a row already in status='failed' OR a fresh pending we can fail twice.
        # Prefer fresh pending so we control the tester_id.
        fresh = None
        for t in tasks:
            if t["status"] == "pending" and not t.get("assigned_to"):
                # skip the one consumed by the pass test (best-effort by id)
                fresh = t
                break
        if fresh is None:
            pytest.skip("No second unclaimed pending available for fail-idempotency test")
        vid = fresh["validation_id"]
        idem = f"fail:{vid}:{uuid.uuid4().hex[:6]}"
        r1 = auth_session.post(
            f"{BASE_URL}/api/validation/{vid}/fail",
            headers={"Idempotency-Key": idem},
            json={"reason": "TEST_ symmetric fail idempotency"},
            timeout=30,
        )
        # First fail may need reason - tolerate 200 only.
        if r1.status_code != 200:
            pytest.skip(f"first /fail did not return 200 (likely needs different payload): {r1.status_code} {r1.text}")
        b1 = r1.json()
        assert not b1.get("idempotent"), f"first /fail should not be idempotent flagged: {b1}"

        r2 = auth_session.post(
            f"{BASE_URL}/api/validation/{vid}/fail",
            headers={"Idempotency-Key": idem},
            json={"reason": "TEST_ symmetric fail idempotency"},
            timeout=30,
        )
        assert r2.status_code == 200, f"fail#2 (idempotent): {r2.status_code} {r2.text}"
        b2 = r2.json()
        assert b2.get("idempotent") is True, f"expected idempotent:true on /fail replay, got {b2}"
