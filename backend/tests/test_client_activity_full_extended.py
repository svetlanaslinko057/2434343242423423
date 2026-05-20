"""
Backend tests for /api/client/activity/full — Block 9.5 EXTENDED payload.

Covers new fields added on top of the base 20 tests:
  - headline (string, always present) — smart copy
  - action_highlight (object | null) — top-of-screen banner data
  - current_work[i].last_activity_at (ISO string | null)
  - events[i].impact (string | null) — context line under each event

Also re-asserts:
  - 401 without auth
  - 404 for non-existent project_id
  - counters consistency
  - no MongoDB '_id' anywhere (recursive, including the new fields)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://full-stack-demo-14.preview.emergentagent.com",
).rstrip("/")

CLIENT_EMAIL = "client@atlas.dev"
CLIENT_PASSWORD = "client123"

MOBILE_PROJECT_ID = "proj_f0448f80641e"      # Mobile App Refresh (has review module)
ACME_PROJECT_ID   = "proj_76a611531646"      # Acme Analytics (only completed+queued)


# ----- fixtures -----

@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(
        f"{BASE_URL}/api/mobile/auth/login",
        json={"email": CLIENT_EMAIL, "password": CLIENT_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    token = r.json().get("token")
    assert token, "no token in mobile login response"
    return {"Authorization": f"Bearer {token}"}


def _get(auth_headers, project_id=None):
    params = {"project_id": project_id} if project_id else None
    r = requests.get(
        f"{BASE_URL}/api/client/activity/full",
        params=params,
        headers=auth_headers,
        timeout=15,
    )
    return r


def _has_mongo_id(obj) -> bool:
    if isinstance(obj, dict):
        if "_id" in obj:
            return True
        return any(_has_mongo_id(v) for v in obj.values())
    if isinstance(obj, list):
        return any(_has_mongo_id(v) for v in obj)
    return False


# ----- headline (smart copy) -----

class TestHeadline:
    def test_headline_present_in_default_payload(self, auth_headers):
        d = _get(auth_headers).json()
        assert "headline" in d, "top-level 'headline' missing"
        assert isinstance(d["headline"], str)
        assert d["headline"].strip(), "headline is empty string"

    def test_headline_present_for_mobile_project(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        assert "headline" in d
        assert isinstance(d["headline"], str) and d["headline"].strip()

    def test_headline_mentions_input_when_review_present(self, auth_headers):
        """Mobile App Refresh has 1 review module → headline must reference
        'input' / 'approval' / 'module' count. Matches _smart_headline copy
        ladder: 'Your input is needed on N module(s)'."""
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        review_n = d["progress"]["review"]
        blocked_n = d["progress"]["blocked"]
        headline = d["headline"].lower()

        if blocked_n > 0:
            assert "blocked" in headline, (
                f"review={review_n} blocked={blocked_n} headline={headline!r}"
            )
        elif review_n > 0:
            # copy says: "Your input is needed on N module(s)"
            assert "input" in headline and "module" in headline, (
                f"expected review headline with 'input' and 'module', got {headline!r}"
            )
            assert str(review_n) in headline, (
                f"review count {review_n} should appear in headline, got {headline!r}"
            )
        else:
            pytest.skip(f"Mobile project has no review/blocked modules: {d['progress']}")


# ----- action_highlight -----

class TestActionHighlight:
    def test_action_highlight_key_always_present(self, auth_headers):
        """Key must exist at top level (value may be null)."""
        d = _get(auth_headers).json()
        assert "action_highlight" in d, "'action_highlight' key missing at top level"

    def test_action_highlight_approval_needed_for_mobile(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        review_n = d["progress"]["review"]
        blocked_n = d["progress"]["blocked"]
        ah = d["action_highlight"]

        if review_n == 0 and blocked_n == 0:
            assert ah is None, f"expected null action_highlight, got {ah}"
            pytest.skip("Mobile project has no review/blocked modules")

        assert ah is not None, (
            f"action_highlight should not be null when review={review_n} "
            f"blocked={blocked_n}"
        )
        for k in ("type", "module_id", "title", "label", "cta"):
            assert k in ah, f"action_highlight missing key {k!r}: {ah}"

        # When review present, review takes precedence over blocked.
        if review_n > 0:
            assert ah["type"] == "approval_needed", (
                f"expected type=approval_needed, got {ah['type']!r}"
            )
            assert ah["cta"] == "Review now"
            # The seeded review module is "Push Notifications" → verify module_id
            # points to an actual review module in current_work.
            review_ids = {
                m["module_id"] for m in d["current_work"]
                if m["status"] == "review"
            }
            assert ah["module_id"] in review_ids, (
                f"action_highlight.module_id={ah['module_id']!r} not in "
                f"current_work review set {review_ids}"
            )
        else:
            assert ah["type"] == "blocked"
            assert ah["cta"] == "Open module"

    def test_action_highlight_null_for_acme(self, auth_headers):
        """Acme Analytics has only completed+queued modules → must be null."""
        r = _get(auth_headers, ACME_PROJECT_ID)
        if r.status_code == 404:
            pytest.skip(f"Acme project {ACME_PROJECT_ID} not present for this client")
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        if d["progress"]["review"] == 0 and d["progress"]["blocked"] == 0:
            assert d["action_highlight"] is None, (
                f"expected null action_highlight for Acme, got {d['action_highlight']}"
            )
        else:
            pytest.skip(
                f"Acme unexpectedly has review/blocked: {d['progress']}"
            )

    def test_action_highlight_module_id_matches_push_notifications(self, auth_headers):
        """Spec says the review module for Mobile is 'Push Notifications'.
        Not a hard requirement on title (seed may evolve), so we check the
        title of the highlighted module is non-empty and matches a real
        current_work row."""
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        ah = d["action_highlight"]
        if not ah:
            pytest.skip("no action_highlight to check")
        titles = {m["module_id"]: m["title"] for m in d["current_work"]}
        assert ah["module_id"] in titles, (
            f"action_highlight.module_id={ah['module_id']!r} not in current_work"
        )
        assert ah["title"] == titles[ah["module_id"]], (
            f"action_highlight.title mismatch: {ah['title']!r} vs "
            f"current_work title {titles[ah['module_id']]!r}"
        )


# ----- current_work.last_activity_at -----

class TestLastActivityAt:
    def test_every_current_work_item_has_last_activity_at_key(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        if not d["current_work"]:
            pytest.skip("no current_work items to check")
        for m in d["current_work"]:
            assert "last_activity_at" in m, (
                f"current_work item missing last_activity_at: {m}"
            )
            # Value may be null OR string; not int/dict.
            v = m["last_activity_at"]
            assert v is None or isinstance(v, str), (
                f"last_activity_at must be str|None, got {type(v).__name__}: {v}"
            )

    def test_last_activity_at_for_default_project(self, auth_headers):
        d = _get(auth_headers).json()
        for m in d["current_work"]:
            assert "last_activity_at" in m


# ----- events.impact -----

class TestEventImpact:
    def test_every_event_has_impact_key(self, auth_headers):
        d = _get(auth_headers).json()
        if not d["events"]:
            pytest.skip("no events to check")
        for e in d["events"]:
            assert "impact" in e, f"event missing 'impact': {e}"
            v = e["impact"]
            assert v is None or isinstance(v, str), (
                f"impact must be str|None, got {type(v).__name__}: {v}"
            )

    def test_completed_event_impact_copy(self, auth_headers):
        d = _get(auth_headers).json()
        completed = [e for e in d["events"] if e.get("verb") == "completed"]
        if not completed:
            pytest.skip("no completed events in default feed")
        for e in completed:
            imp = (e["impact"] or "").lower()
            # Copy: "project progress +X%" OR "module shipped"
            assert ("project progress" in imp) or ("module shipped" in imp), (
                f"completed event impact mismatch: {e['impact']!r}"
            )

    def test_review_event_impact_copy(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        review_events = [e for e in d["events"] if e.get("verb") == "moved to review"]
        if not review_events:
            pytest.skip("no 'moved to review' events in mobile project feed")
        for e in review_events:
            assert (e["impact"] or "").lower() == "waiting for your approval", (
                f"review event impact mismatch: {e['impact']!r}"
            )

    def test_system_event_impact_is_system_control(self, auth_headers):
        """dot=purple → impact='system control'."""
        d = _get(auth_headers).json()
        purple = [e for e in d["events"] if e.get("dot") == "purple"]
        if not purple:
            pytest.skip("no purple/system events in default feed")
        for e in purple:
            assert e["impact"] == "system control", (
                f"purple event impact mismatch: {e['impact']!r}"
            )


# ----- backwards-compat (new fields must not break old invariants) -----

class TestBackwardsCompat:
    def test_no_auth_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/client/activity/full", timeout=15)
        assert r.status_code == 401

    def test_non_existent_project_still_404(self, auth_headers):
        r = _get(auth_headers, "non_existent_xyz_abc")
        assert r.status_code == 404

    def test_counters_still_consistent_mobile(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        p = d["progress"]
        s = p["completed"] + p["in_progress"] + p["review"] + p["blocked"] + p["queued"]
        assert s == p["total_modules"], (
            f"sum={s} total={p['total_modules']}"
        )

    def test_no_mongo_id_in_extended_payload(self, auth_headers):
        """Recursive scan covers headline/action_highlight/last_activity_at/impact."""
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        assert not _has_mongo_id(d), "found '_id' in response payload"

    def test_all_old_keys_still_present(self, auth_headers):
        """Legacy consumers (existing 20 tests) rely on these keys."""
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        for k in ("project", "available_projects", "progress", "phase",
                  "time", "current_work", "next_modules", "events"):
            assert k in d, f"missing legacy top-level key: {k}"

    def test_new_keys_present_top_level(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        assert "headline" in d
        assert "action_highlight" in d
