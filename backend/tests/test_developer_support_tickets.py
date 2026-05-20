"""
Developer Cabinet — Support Tickets + Notifications regression suite.

Covers:
- POST /api/mobile/auth/login (john@atlas.dev / dev123)
- GET  /api/developer/support-tickets
- POST /api/developer/support-tickets (with validation)
- GET  /api/developer/support-tickets/{id}
- POST /api/developer/support-tickets/{id}/respond
- GET  /api/notifications/unread-count
- GET  /api/notifications/my
- POST /api/notifications/mark-read
"""
import os
import uuid
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://app-development-hub-5.preview.emergentagent.com"
).rstrip("/")

DEV_EMAIL = "john@atlas.dev"
DEV_PASS = "dev123"


@pytest.fixture(scope="module")
def dev_token():
    r = requests.post(
        f"{BASE_URL}/api/mobile/auth/login",
        json={"email": DEV_EMAIL, "password": DEV_PASS},
        timeout=15,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    body = r.json()
    assert "token" in body and body["token"]
    return body["token"]


@pytest.fixture
def auth_headers(dev_token):
    return {"Authorization": f"Bearer {dev_token}", "Content-Type": "application/json"}


# ── Developer support tickets ─────────────────────────────────────────────
class TestDeveloperSupportTickets:
    def test_list_tickets_initial(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/developer/support-tickets", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "tickets" in body
        assert isinstance(body["tickets"], list)

    def test_create_ticket_valid(self, auth_headers):
        payload = {
            "title": f"TEST_ ticket {uuid.uuid4().hex[:6]}",
            "description": "Repro: tapped submit, got 500.",
            "ticket_type": "bug",
            "priority": "high",
        }
        r = requests.post(
            f"{BASE_URL}/api/developer/support-tickets",
            json=payload, headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["ticket_id"].startswith("tkt_")
        assert t["title"] == payload["title"]
        assert t["ticket_type"] == "bug"
        assert t["priority"] == "high"
        assert t["status"] == "open"
        assert t.get("audience") == "developer"
        pytest.created_ticket_id = t["ticket_id"]

    def test_create_ticket_rejects_empty_title(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/developer/support-tickets",
            json={"title": "", "ticket_type": "bug", "priority": "low"},
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_create_ticket_rejects_bad_type(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/developer/support-tickets",
            json={"title": "TEST_ bad type", "ticket_type": "garbage", "priority": "low"},
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 400

    def test_create_ticket_rejects_bad_priority(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/developer/support-tickets",
            json={"title": "TEST_ bad prio", "ticket_type": "bug", "priority": "urgent"},
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 400

    def test_get_ticket_detail(self, auth_headers):
        tid = getattr(pytest, "created_ticket_id", None)
        assert tid, "previous test must have created a ticket"
        r = requests.get(f"{BASE_URL}/api/developer/support-tickets/{tid}", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ticket_id"] == tid
        assert "responses" in body
        assert isinstance(body["responses"], list)

    def test_get_ticket_404(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/developer/support-tickets/tkt_doesnotexist", headers=auth_headers, timeout=15)
        assert r.status_code == 404

    def test_respond_to_ticket(self, auth_headers):
        tid = getattr(pytest, "created_ticket_id", None)
        assert tid
        msg = f"TEST_ reply {uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/api/developer/support-tickets/{tid}/respond",
            json={"message": msg}, headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["response_id"].startswith("resp_")
        assert body["message"] == msg
        assert body["ticket_id"] == tid

        # Verify reply was persisted by re-fetching the ticket
        d = requests.get(f"{BASE_URL}/api/developer/support-tickets/{tid}", headers=auth_headers, timeout=15)
        assert d.status_code == 200
        responses = d.json()["responses"]
        assert any(rr["message"] == msg for rr in responses), "Reply not persisted"

    def test_respond_rejects_empty_message(self, auth_headers):
        tid = getattr(pytest, "created_ticket_id", None)
        assert tid
        r = requests.post(
            f"{BASE_URL}/api/developer/support-tickets/{tid}/respond",
            json={"message": "   "}, headers=auth_headers, timeout=15,
        )
        assert r.status_code == 400

    def test_list_includes_new_ticket(self, auth_headers):
        tid = getattr(pytest, "created_ticket_id", None)
        assert tid
        r = requests.get(f"{BASE_URL}/api/developer/support-tickets", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        ids = [t["ticket_id"] for t in r.json()["tickets"]]
        assert tid in ids


# ── Notifications endpoints used by bell + notifications screen ──────────
class TestNotificationsEndpoints:
    def test_unread_count(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/notifications/unread-count", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        # Field is commonly `count` or `unread_count` — accept either
        assert any(k in body for k in ("count", "unread_count", "unread")), body

    def test_list_my_notifications(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/notifications/my?limit=50", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "notifications" in body
        assert isinstance(body["notifications"], list)

    def test_mark_read_all_idempotent(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/notifications/mark-read",
            json={"notification_ids": [], "all": True},
            headers=auth_headers, timeout=15,
        )
        # Acceptable: 200 success OR 204 no-content
        assert r.status_code in (200, 204), r.text


# ── Auth gating sanity (no token → 401/403) ──────────────────────────────
class TestAuthGating:
    def test_list_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/developer/support-tickets", timeout=15)
        assert r.status_code in (401, 403), r.status_code

    def test_create_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/developer/support-tickets",
            json={"title": "x", "ticket_type": "bug", "priority": "low"},
            timeout=15,
        )
        assert r.status_code in (401, 403), r.status_code
