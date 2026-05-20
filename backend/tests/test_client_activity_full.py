"""
Backend tests for /api/client/activity/full (Block 9.5 — Client Activity Operator Panel).

Coverage:
  - auth (no token → 401, valid client → 200)
  - default project resolution
  - explicit project_id filtering
  - 404 for non-existent project_id
  - counters consistency (sum == total_modules)
  - percent rounding rule (math.round(completed/total*100), 0 if total=0)
  - phase mapping (development → Build/2/4)
  - events shape: module + system events with dot=purple, sorted desc, capped at 30
  - available_projects always present
  - no MongoDB '_id' anywhere in response
"""
import os
import json
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://full-stack-demo-14.preview.emergentagent.com",
).rstrip("/")

CLIENT_EMAIL = "client@atlas.dev"
CLIENT_PASSWORD = "client123"

MOBILE_PROJECT_ID = "proj_f0448f80641e"  # Mobile App Refresh


# ----- fixtures -----

@pytest.fixture(scope="module")
def client_token():
    r = requests.post(
        f"{BASE_URL}/api/mobile/auth/login",
        json={"email": CLIENT_EMAIL, "password": CLIENT_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("token"), "no token in mobile login response"
    return body["token"]


@pytest.fixture(scope="module")
def auth_headers(client_token):
    return {"Authorization": f"Bearer {client_token}"}


# ----- helpers -----

def _has_mongo_id(obj) -> bool:
    """Recursively check for any '_id' key."""
    if isinstance(obj, dict):
        if "_id" in obj:
            return True
        return any(_has_mongo_id(v) for v in obj.values())
    if isinstance(obj, list):
        return any(_has_mongo_id(v) for v in obj)
    return False


# ----- auth tests -----

class TestAuth:
    def test_no_auth_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/client/activity/full", timeout=15)
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:200]}"

    def test_authorized_client_returns_200(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text[:500]


# ----- default (no project_id) -----

class TestDefaultPayload:
    def test_top_level_keys_present(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            headers=auth_headers, timeout=15,
        )
        d = r.json()
        for k in ("project", "available_projects", "progress",
                  "phase", "time", "current_work", "next_modules", "events"):
            assert k in d, f"missing top-level key: {k}"

    def test_available_projects_count(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            headers=auth_headers, timeout=15,
        )
        d = r.json()
        assert isinstance(d["available_projects"], list)
        # client is seeded with 3 projects
        assert len(d["available_projects"]) == 3, \
            f"expected 3 available projects, got {len(d['available_projects'])}"
        # each item must have id/title/status
        for p in d["available_projects"]:
            assert {"id", "title", "status"} <= set(p.keys())

    def test_no_mongo_id_in_response(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            headers=auth_headers, timeout=15,
        )
        d = r.json()
        assert not _has_mongo_id(d), "found '_id' in response payload"

    def test_progress_keys_and_types(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            headers=auth_headers, timeout=15,
        )
        prog = r.json()["progress"]
        for k in ("total_modules", "completed", "in_progress",
                  "review", "blocked", "queued", "percent"):
            assert k in prog, f"missing progress key: {k}"
            assert isinstance(prog[k], int), f"{k} should be int, got {type(prog[k])}"

    def test_counters_consistency(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            headers=auth_headers, timeout=15,
        )
        prog = r.json()["progress"]
        s = (prog["completed"] + prog["in_progress"] + prog["review"]
             + prog["blocked"] + prog["queued"])
        assert s == prog["total_modules"], (
            f"counters sum ({s}) != total_modules ({prog['total_modules']})"
        )

    def test_percent_rounding_rule(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            headers=auth_headers, timeout=15,
        )
        prog = r.json()["progress"]
        total = prog["total_modules"]
        if total == 0:
            assert prog["percent"] == 0
        else:
            expected = int(round((prog["completed"] / total) * 100))
            assert prog["percent"] == expected, (
                f"percent={prog['percent']} expected={expected} "
                f"(completed={prog['completed']}, total={total})"
            )

    def test_phase_mapping_for_development(self, auth_headers):
        """Default project (Acme Analytics) is in development → Build/2/4."""
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            headers=auth_headers, timeout=15,
        )
        d = r.json()
        if (d.get("project") or {}).get("current_stage") == "development":
            assert d["phase"]["label"] == "Build"
            assert d["phase"]["index"] == 2
            assert d["phase"]["total"] == 4
            assert d["phase"]["current"] == "build"
        else:
            pytest.skip(f"default project not in development stage: {d.get('project')}")

    def test_time_object_shape(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            headers=auth_headers, timeout=15,
        )
        t = r.json()["time"]
        assert "remaining_hours" in t and "eta_days" in t
        assert isinstance(t["remaining_hours"], int)
        assert isinstance(t["eta_days"], int)


# ----- explicit project_id filter -----

class TestProjectFilter:
    def test_filter_to_mobile_project(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            params={"project_id": MOBILE_PROJECT_ID},
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["project"]["id"] == MOBILE_PROJECT_ID
        assert d["project"]["title"] == "Mobile App Refresh"

    def test_filter_keeps_available_projects(self, auth_headers):
        """available_projects must always come back (selector data)."""
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            params={"project_id": MOBILE_PROJECT_ID},
            headers=auth_headers, timeout=15,
        )
        d = r.json()
        assert len(d["available_projects"]) == 3

    def test_current_work_statuses(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            params={"project_id": MOBILE_PROJECT_ID},
            headers=auth_headers, timeout=15,
        )
        d = r.json()
        allowed = {"review", "validation", "in_progress", "submitted",
                   "blocked", "failed"}
        for m in d["current_work"]:
            assert m["status"] in allowed, (
                f"current_work has unexpected status {m['status']!r}"
            )
            for k in ("module_id", "title", "status", "status_label",
                      "eta_hours", "developer_name", "action_required"):
                assert k in m, f"missing key {k} in current_work item"
        assert len(d["current_work"]) <= 5

    def test_next_modules_statuses(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            params={"project_id": MOBILE_PROJECT_ID},
            headers=auth_headers, timeout=15,
        )
        d = r.json()
        queued = {"available", "pending", "reserved", "accepted"}
        for m in d["next_modules"]:
            # We only assert shape; status itself is not exposed in next_modules.
            for k in ("module_id", "title", "eta_hours"):
                assert k in m, f"missing key {k} in next_modules item"
        assert len(d["next_modules"]) <= 5

    def test_non_existent_project_returns_404(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            params={"project_id": "non_existent_xyz"},
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 404, (
            f"expected 404, got {r.status_code}: {r.text[:200]}"
        )


# ----- events feed -----

class TestEvents:
    def test_events_capped_at_30(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            headers=auth_headers, timeout=15,
        )
        events = r.json()["events"]
        assert len(events) <= 30

    def test_events_sorted_desc(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            headers=auth_headers, timeout=15,
        )
        events = r.json()["events"]
        ats = [e.get("at") or "" for e in events]
        assert ats == sorted(ats, reverse=True), "events not sorted desc by 'at'"

    def test_events_shape(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            headers=auth_headers, timeout=15,
        )
        events = r.json()["events"]
        for e in events:
            for k in ("at", "module_title", "module_id", "verb", "dot"):
                assert k in e, f"event missing key {k}: {e}"
            assert e["dot"] in {"green", "yellow", "blue", "purple"}

    def test_system_events_have_purple_dot_and_kind(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            headers=auth_headers, timeout=15,
        )
        events = r.json()["events"]
        sys_events = [e for e in events if e.get("kind") == "system"]
        if sys_events:
            for e in sys_events:
                assert e["dot"] == "purple", (
                    f"system event must have dot=purple, got {e['dot']}"
                )
                assert e["verb"] == "by system"
        else:
            # Not a hard fail: system events are seeded in default project.
            # We still want at least one purple dot somewhere on the default payload.
            purple = [e for e in events if e.get("dot") == "purple"]
            assert purple, "no system (purple) events in default project feed"


# ----- module-level status mapping smoke -----

class TestStatusClassification:
    def test_status_buckets_disjoint(self, auth_headers):
        """A module that's done should not also count as queued, etc.
        We can't introspect raw modules from outside, but the consistency test
        already enforces sum == total. Add a sanity check that none of the
        counters is negative."""
        r = requests.get(
            f"{BASE_URL}/api/client/activity/full",
            headers=auth_headers, timeout=15,
        )
        prog = r.json()["progress"]
        for k in ("completed", "in_progress", "review", "blocked", "queued",
                  "total_modules", "percent"):
            assert prog[k] >= 0, f"{k} is negative: {prog[k]}"
        assert 0 <= prog["percent"] <= 100
