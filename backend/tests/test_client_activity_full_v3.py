"""
Backend tests for /api/client/activity/full — Iteration 3 (Block 9.5 polish).

New cause→effect copywriting fields under test:
  - headline_subtitle           (str | null) at top level
  - action_highlight.cause_effect (str | null) when action_highlight is set
  - current_work[].subtask      (str | null) per row
  - operator_status             {active: bool, message: str}

Re-asserts no regressions on:
  - 401 unauthenticated
  - 404 for foreign / missing project_id
  - all legacy top-level keys still emitted
  - no MongoDB '_id' leakage anywhere (recursive scan)
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

MOBILE_PROJECT_ID = "proj_f0448f80641e"   # Mobile App Refresh — review + in_progress
ACME_PROJECT_ID   = "proj_76a611531646"   # Acme Analytics — only completed+queued
OPS_PROJECT_ID    = "proj_2b6b0d1cb224"   # Internal Ops Tool — completed=total


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
    return requests.get(
        f"{BASE_URL}/api/client/activity/full",
        params=params,
        headers=auth_headers,
        timeout=15,
    )


def _has_mongo_id(obj) -> bool:
    if isinstance(obj, dict):
        if "_id" in obj:
            return True
        return any(_has_mongo_id(v) for v in obj.values())
    if isinstance(obj, list):
        return any(_has_mongo_id(v) for v in obj)
    return False


# ----- headline_subtitle -----

class TestHeadlineSubtitle:
    def test_key_present_at_top_level(self, auth_headers):
        d = _get(auth_headers).json()
        assert "headline_subtitle" in d, "'headline_subtitle' key missing at top level"

    def test_value_is_string_or_none(self, auth_headers):
        d = _get(auth_headers).json()
        v = d["headline_subtitle"]
        assert v is None or isinstance(v, str), (
            f"headline_subtitle must be str|None, got {type(v).__name__}: {v!r}"
        )

    def test_mobile_subtitle_says_holding_next_step(self, auth_headers):
        """Mobile App Refresh has 1 review module and 0 blocked → copy ladder
        returns 'This is the only thing holding the next step'."""
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        review_n = d["progress"]["review"]
        blocked_n = d["progress"]["blocked"]
        if blocked_n > 0:
            pytest.skip("blocked overrides review in copy ladder")
        if review_n == 0:
            pytest.skip("no review module in mobile project anymore")
        assert d["headline_subtitle"] == "This is the only thing holding the next step", (
            f"unexpected subtitle for review-state mobile: {d['headline_subtitle']!r}"
        )

    def test_acme_subtitle_null_when_no_active_signal(self, auth_headers):
        """Acme has only completed+queued, no review/blocked, percent<95,
        in_progress=0 → subtitle must be null."""
        r = _get(auth_headers, ACME_PROJECT_ID)
        if r.status_code == 404:
            pytest.skip("Acme project not present")
        d = r.json()
        p = d["progress"]
        if (p["review"] == 0 and p["blocked"] == 0
                and p["in_progress"] == 0
                and p["percent"] < 95
                and p["percent"] > 0):
            assert d["headline_subtitle"] is None, (
                f"expected null subtitle for quiet Acme, got {d['headline_subtitle']!r}"
            )
        else:
            pytest.skip(f"Acme progress no longer in 'quiet' bucket: {p}")

    def test_ops_subtitle_when_finishing(self, auth_headers):
        """Internal Ops Tool is at 100% (completed=total) → copy ladder
        produces 'Final modules are wrapping up' (percent>=95 branch)."""
        r = _get(auth_headers, OPS_PROJECT_ID)
        if r.status_code == 404:
            pytest.skip("Ops project not present")
        d = r.json()
        if d["progress"]["percent"] < 95:
            pytest.skip(f"Ops not in finishing bucket: {d['progress']}")
        if d["progress"]["review"] > 0 or d["progress"]["blocked"] > 0:
            pytest.skip("review/blocked overrides percent branch")
        assert d["headline_subtitle"] == "Final modules are wrapping up", (
            f"unexpected ops subtitle: {d['headline_subtitle']!r}"
        )


# ----- action_highlight.cause_effect -----

class TestActionHighlightCauseEffect:
    def test_cause_effect_for_approval_needed(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        ah = d["action_highlight"]
        if not ah:
            pytest.skip("no action_highlight on mobile project")
        if ah["type"] != "approval_needed":
            pytest.skip(f"action_highlight type is {ah['type']!r}, not approval_needed")
        assert "cause_effect" in ah, f"cause_effect missing in action_highlight: {ah}"
        assert ah["cause_effect"] == "This is the only thing holding the next step", (
            f"unexpected cause_effect for approval_needed: {ah['cause_effect']!r}"
        )

    def test_cause_effect_for_blocked_type(self, auth_headers):
        """Walk all available projects; if any surfaces a 'blocked' action_highlight,
        verify the cause_effect copy. Otherwise structurally skip."""
        d_default = _get(auth_headers).json()
        for proj in d_default.get("available_projects", []):
            r = _get(auth_headers, proj["id"])
            if r.status_code != 200:
                continue
            ah = r.json().get("action_highlight")
            if ah and ah.get("type") == "blocked":
                assert ah.get("cause_effect") == \
                    "Project progress is paused until this clears", (
                    f"unexpected cause_effect for blocked: {ah.get('cause_effect')!r}"
                )
                return
        pytest.skip("no blocked-type action_highlight in any project for this client")

    def test_no_cause_effect_field_when_action_highlight_is_null(self, auth_headers):
        """Spec: when action_highlight=null, the cause_effect field doesn't exist
        (because the whole object is null). We assert the value is exactly None."""
        r = _get(auth_headers, ACME_PROJECT_ID)
        if r.status_code == 404:
            pytest.skip("Acme not present")
        d = r.json()
        if d["action_highlight"] is not None:
            pytest.skip("Acme unexpectedly has action_highlight")
        assert d["action_highlight"] is None
        # And there is no top-level 'cause_effect' field leaked outside the object.
        assert "cause_effect" not in d, (
            f"top-level cause_effect leaked into payload: {d.get('cause_effect')!r}"
        )

    def test_cause_effect_present_in_all_action_highlights(self, auth_headers):
        """Whenever action_highlight is set, cause_effect must be a non-empty string."""
        d_default = _get(auth_headers).json()
        checked = 0
        for proj in d_default.get("available_projects", []):
            r = _get(auth_headers, proj["id"])
            if r.status_code != 200:
                continue
            ah = r.json().get("action_highlight")
            if ah is None:
                continue
            assert "cause_effect" in ah, f"cause_effect missing in {ah}"
            assert isinstance(ah["cause_effect"], str) and ah["cause_effect"].strip(), (
                f"cause_effect must be non-empty string, got {ah['cause_effect']!r}"
            )
            checked += 1
        if checked == 0:
            pytest.skip("no action_highlight surfaced for any of the client's projects")


# ----- current_work[].subtask -----

class TestCurrentWorkSubtask:
    def test_subtask_key_on_every_row(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        if not d["current_work"]:
            pytest.skip("no current_work items")
        for m in d["current_work"]:
            assert "subtask" in m, f"current_work row missing 'subtask': {m}"
            v = m["subtask"]
            assert v is None or isinstance(v, str), (
                f"subtask must be str|None, got {type(v).__name__}: {v!r}"
            )

    def test_review_module_subtask_is_decision_copy(self, auth_headers):
        """Push Notifications is in 'review' → status override returns
        'ready for your decision' regardless of template/title verb."""
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        review_rows = [m for m in d["current_work"] if m["status"] == "review"]
        if not review_rows:
            pytest.skip("no review rows in current_work")
        for m in review_rows:
            assert m["subtask"] == "ready for your decision", (
                f"review module {m['title']!r} subtask mismatch: {m['subtask']!r}"
            )

    def test_profile_in_progress_subtask_says_building_profile(self, auth_headers):
        """Profile & Settings (template_type='profile' or title contains
        'profile') in_progress → 'building profile screens'."""
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        candidates = [
            m for m in d["current_work"]
            if m["status"] == "in_progress"
            and ("profile" in (m["title"] or "").lower())
        ]
        if not candidates:
            pytest.skip("no in-progress profile module in current_work")
        for m in candidates:
            assert m["subtask"] == "building profile screens", (
                f"profile module subtask mismatch: title={m['title']!r} "
                f"subtask={m['subtask']!r}"
            )

    def test_subtask_does_not_leak_outside_current_work(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        # subtask should never appear on next_modules or events.
        for n in d.get("next_modules", []):
            assert "subtask" not in n, f"subtask leaked into next_modules: {n}"
        for e in d.get("events", []):
            assert "subtask" not in e, f"subtask leaked into events: {e}"


# ----- operator_status -----

class TestOperatorStatus:
    def test_key_present_and_shape(self, auth_headers):
        d = _get(auth_headers).json()
        assert "operator_status" in d, "'operator_status' key missing"
        op = d["operator_status"]
        assert isinstance(op, dict), f"operator_status must be object, got {type(op)}"
        assert "active" in op and isinstance(op["active"], bool), (
            f"operator_status.active must be bool: {op}"
        )
        assert "message" in op and isinstance(op["message"], str) and op["message"].strip(), (
            f"operator_status.message must be non-empty string: {op}"
        )

    def test_mobile_active_managing(self, auth_headers):
        """Mobile has in_progress=1 → active=true with managing copy."""
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        if d["progress"]["in_progress"] == 0:
            pytest.skip("mobile no longer has in-progress modules")
        op = d["operator_status"]
        assert op["active"] is True, f"expected active=true, got {op}"
        assert op["message"] == "System is actively managing your project", (
            f"unexpected managing copy: {op['message']!r}"
        )

    def test_active_when_auto_actions_present(self, auth_headers):
        """Acme has 0 in_progress but seeded auto_actions (purple events) →
        active=true via the bool(sys_actions) branch."""
        r = _get(auth_headers, ACME_PROJECT_ID)
        if r.status_code == 404:
            pytest.skip("Acme not present")
        d = r.json()
        if d["progress"]["in_progress"] > 0:
            pytest.skip("Acme has in_progress now — different branch")
        purple_events = [e for e in d["events"] if e.get("dot") == "purple"]
        if not purple_events:
            pytest.skip("no purple events for Acme — no auto_actions seeded")
        op = d["operator_status"]
        assert op["active"] is True, (
            f"expected active=true (auto_actions present), got {op}"
        )
        assert op["message"] == "System is actively managing your project", (
            f"unexpected message when auto_actions present: {op['message']!r}"
        )

    def test_operator_status_present_for_all_projects(self, auth_headers):
        d_default = _get(auth_headers).json()
        for proj in d_default.get("available_projects", []):
            r = _get(auth_headers, proj["id"])
            assert r.status_code == 200, f"{proj['id']} → {r.status_code}"
            op = r.json().get("operator_status")
            assert isinstance(op, dict), f"missing operator_status on {proj['id']}: {op}"
            assert isinstance(op.get("active"), bool)
            assert isinstance(op.get("message"), str) and op["message"].strip()


# ----- backwards compat (must hold after polish) -----

class TestBackwardsCompatV3:
    def test_no_auth_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/client/activity/full", timeout=15)
        assert r.status_code == 401

    def test_unknown_project_returns_404(self, auth_headers):
        r = _get(auth_headers, "proj_does_not_exist_xyz")
        assert r.status_code == 404

    def test_all_legacy_keys_still_present(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        for k in ("project", "available_projects", "headline", "action_highlight",
                  "progress", "phase", "time", "current_work",
                  "next_modules", "events"):
            assert k in d, f"missing legacy key: {k}"

    def test_all_new_v3_keys_present(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        for k in ("headline_subtitle", "operator_status"):
            assert k in d, f"missing v3 top-level key: {k}"

    def test_counters_consistency_unchanged(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        p = d["progress"]
        s = p["completed"] + p["in_progress"] + p["review"] + p["blocked"] + p["queued"]
        assert s == p["total_modules"], (
            f"counters drift — sum={s} total={p['total_modules']}"
        )

    def test_action_highlight_legacy_fields_still_intact(self, auth_headers):
        """cause_effect addition must not have removed the existing keys."""
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        ah = d["action_highlight"]
        if ah is None:
            pytest.skip("no action_highlight to inspect")
        for k in ("type", "module_id", "title", "label", "cta"):
            assert k in ah, f"legacy action_highlight key missing: {k!r} ({ah})"

    def test_current_work_legacy_fields_still_intact(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        if not d["current_work"]:
            pytest.skip("no current_work rows")
        for m in d["current_work"]:
            for k in ("module_id", "title", "status", "status_label",
                      "eta_hours", "developer_name", "action_required",
                      "last_activity_at"):
                assert k in m, f"legacy current_work key missing: {k!r} in {m}"

    def test_phase_block_unchanged(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        ph = d["phase"]
        for k in ("current", "label", "index", "total"):
            assert k in ph
        assert isinstance(ph["index"], int) and isinstance(ph["total"], int)

    def test_events_impact_field_unchanged(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        for e in d["events"]:
            assert "impact" in e, f"legacy events.impact missing: {e}"


# ----- MongoDB _id leakage on the polished payload -----

class TestNoMongoIdV3:
    def test_recursive_scan_mobile(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        assert not _has_mongo_id(d), "found '_id' anywhere in mobile payload"

    def test_recursive_scan_acme(self, auth_headers):
        r = _get(auth_headers, ACME_PROJECT_ID)
        if r.status_code == 404:
            pytest.skip("Acme not present")
        assert not _has_mongo_id(r.json()), "found '_id' anywhere in Acme payload"

    def test_no_id_inside_operator_status(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        assert "_id" not in d["operator_status"]

    def test_no_id_inside_action_highlight(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        if d["action_highlight"] is not None:
            assert "_id" not in d["action_highlight"]

    def test_no_id_inside_current_work_rows(self, auth_headers):
        d = _get(auth_headers, MOBILE_PROJECT_ID).json()
        for m in d["current_work"]:
            assert "_id" not in m, f"_id leaked into current_work row: {m}"
