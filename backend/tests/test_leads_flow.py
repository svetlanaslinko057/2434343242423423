"""
Backend tests: Visitor → Lead → Client flow + auth/exists probe.

Covers:
  - POST /api/leads/intake (public, no auth)
  - GET  /api/leads/:lead_id (public)
  - POST /api/leads/:lead_id/claim (auth required, ownership check, idempotency)
  - GET  /api/leads/by-email/pending (auth required)
  - GET  /api/auth/exists (public probe)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_BACKEND_URL",
    "https://full-stack-demo-14.preview.emergentagent.com",
).rstrip("/")

CLIENT_EMAIL = "client@atlas.dev"
CLIENT_PASSWORD = "client123"
JOHN_EMAIL = "john@atlas.dev"
JOHN_PASSWORD = "dev123"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def client_session():
    """Logged-in session for client@atlas.dev (cookie-based)."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": CLIENT_EMAIL, "password": CLIENT_PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def john_session():
    """Logged-in session for john@atlas.dev (to test wrong-email 403)."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": JOHN_EMAIL, "password": JOHN_PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


# ---------- /api/auth/exists ----------
class TestAuthExists:
    def test_existing_email_returns_true(self, api):
        r = api.get(f"{BASE_URL}/api/auth/exists", params={"email": CLIENT_EMAIL})
        assert r.status_code == 200
        assert r.json() == {"exists": True}

    def test_new_email_returns_false(self, api):
        fresh = f"never.seen.{uuid.uuid4().hex[:8]}@test.io"
        r = api.get(f"{BASE_URL}/api/auth/exists", params={"email": fresh})
        assert r.status_code == 200
        assert r.json() == {"exists": False}

    def test_malformed_email_returns_false(self, api):
        r = api.get(f"{BASE_URL}/api/auth/exists", params={"email": "not-an-email"})
        assert r.status_code == 200
        assert r.json() == {"exists": False}


# ---------- /api/leads/intake + /api/leads/:id ----------
class TestLeadIntakeAndGet:
    def test_intake_public_no_auth(self, api):
        payload = {
            "email": f"TEST_brand.new.{uuid.uuid4().hex[:8]}@test.io",
            "goal": "Build a telemedicine app with video calls, prescriptions and patient records",
            "mode": "hybrid",
            "estimate": {"final_price": 12345, "timeline_days": 30},
        }
        r = api.post(f"{BASE_URL}/api/leads/intake", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        # Shape checks
        assert data["lead_id"].startswith("lead_")
        assert data["email"] == payload["email"].lower()
        assert data["state"] == "lead"
        assert data["locked"] is True
        assert data["mode"] == "hybrid"
        assert data["goal"] == payload["goal"]
        assert data["estimate"] == payload["estimate"]
        assert data["claimed_at"] is None
        assert data["claimed_project_id"] is None
        # No Mongo _id leaked
        assert "_id" not in data

        # GET to verify persistence
        g = api.get(f"{BASE_URL}/api/leads/{data['lead_id']}")
        assert g.status_code == 200
        got = g.json()
        assert got["lead_id"] == data["lead_id"]
        assert got["email"] == payload["email"].lower()
        assert got["state"] == "lead"
        assert got["locked"] is True
        assert "_id" not in got

    def test_intake_rejects_short_goal(self, api):
        payload = {
            "email": f"TEST_short.{uuid.uuid4().hex[:6]}@test.io",
            "goal": "too short",  # < 10 chars
            "mode": "hybrid",
        }
        r = api.post(f"{BASE_URL}/api/leads/intake", json=payload)
        assert r.status_code == 422, r.text

    def test_intake_rejects_bad_mode(self, api):
        payload = {
            "email": f"TEST_badmode.{uuid.uuid4().hex[:6]}@test.io",
            "goal": "A valid long product description for validation purposes",
            "mode": "wrong_mode",
        }
        r = api.post(f"{BASE_URL}/api/leads/intake", json=payload)
        assert r.status_code == 400, r.text

    def test_get_nonexistent_lead_404(self, api):
        r = api.get(f"{BASE_URL}/api/leads/lead_does_not_exist_xx")
        assert r.status_code == 404


# ---------- /api/leads/:id/claim ----------
class TestLeadClaim:
    def _make_lead(self, api, email, goal=None):
        payload = {
            "email": email,
            "goal": goal or "Build a SaaS CRM with contact management, pipelines and email automation",
            "mode": "hybrid",
            "estimate": {"final_price": 9999},
        }
        r = api.post(f"{BASE_URL}/api/leads/intake", json=payload)
        assert r.status_code == 200, r.text
        return r.json()["lead_id"]

    def test_claim_requires_auth(self, api):
        lead_id = self._make_lead(api, CLIENT_EMAIL)
        r = api.post(f"{BASE_URL}/api/leads/{lead_id}/claim")
        assert r.status_code == 401, r.text

    def test_claim_wrong_email_returns_403(self, api, john_session):
        # Lead created for client@atlas.dev but claimed by john@atlas.dev
        lead_id = self._make_lead(api, CLIENT_EMAIL)
        r = john_session.post(f"{BASE_URL}/api/leads/{lead_id}/claim")
        assert r.status_code == 403, r.text
        assert "different email" in r.json().get("detail", "").lower() or \
               "sign in" in r.json().get("detail", "").lower()

    def test_claim_matching_email_creates_project_and_is_idempotent(
        self, api, client_session
    ):
        lead_id = self._make_lead(api, CLIENT_EMAIL)

        # First claim → creates a project
        r1 = client_session.post(f"{BASE_URL}/api/leads/{lead_id}/claim")
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1.get("project_id", "").startswith("proj_"), d1
        assert d1.get("redirect") == f"/workspace/{d1['project_id']}"
        assert "pricing" in d1
        # first-time claim should NOT report already_claimed
        assert d1.get("already_claimed") is not True

        # Lead doc should now be marked claimed
        lead_after = api.get(f"{BASE_URL}/api/leads/{lead_id}").json()
        assert lead_after["state"] == "claimed"
        assert lead_after["locked"] is False
        assert lead_after["claimed_project_id"] == d1["project_id"]
        assert lead_after["claimed_at"] is not None

        # Second claim → idempotent
        r2 = client_session.post(f"{BASE_URL}/api/leads/{lead_id}/claim")
        assert r2.status_code == 200, r2.text
        d2 = r2.json()
        assert d2.get("already_claimed") is True
        assert d2["project_id"] == d1["project_id"]
        assert d2["redirect"] == f"/workspace/{d1['project_id']}"

    def test_claim_nonexistent_lead_404(self, client_session):
        r = client_session.post(f"{BASE_URL}/api/leads/lead_does_not_exist_xx/claim")
        assert r.status_code == 404


# ---------- /api/leads/by-email/pending ----------
class TestPendingLeadsForMe:
    def test_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/leads/by-email/pending")
        assert r.status_code == 401

    def test_returns_pending_leads_for_my_email(self, api, client_session):
        # Seed a brand new pending lead for client@atlas.dev
        payload = {
            "email": CLIENT_EMAIL,
            "goal": "Pending lead for client inbox surfacing — should appear in /pending",
            "mode": "ai",
        }
        r = api.post(f"{BASE_URL}/api/leads/intake", json=payload)
        assert r.status_code == 200
        lead_id = r.json()["lead_id"]

        g = client_session.get(f"{BASE_URL}/api/leads/by-email/pending")
        assert g.status_code == 200, g.text
        body = g.json()
        assert "leads" in body
        ids = [row["lead_id"] for row in body["leads"]]
        assert lead_id in ids, f"expected {lead_id} in pending, got {ids}"
        # All returned leads must belong to this email, be in 'lead' state, and unclaimed
        for row in body["leads"]:
            assert row["email"] == CLIENT_EMAIL
            assert row["state"] == "lead"
            assert row.get("claimed_project_id") in (None, "")
