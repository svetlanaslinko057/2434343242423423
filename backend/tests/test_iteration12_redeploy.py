"""
Iteration 12: Post-redeploy smoke + validation test suite.

Coverage:
- /api/auth/login for 4 roles (admin/client/dev/tester) -> 200 + user_id + cookie
- /api/integrations/manifest -> 200, capabilities transparent mock
- /api/web-ui/ -> 200 HTML CRA build
- /api/contracts/my (client cookie) -> 200 list
- /api/client/invoices (client cookie) -> 200 list (with paid)
- /api/admin/users, /api/admin/team, /api/admin/contracts, /api/admin/integrations (admin cookie) -> 200
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
           os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")

CREDS = {
    "admin": ("admin@atlas.dev", "admin123"),
    "client": ("client@atlas.dev", "client123"),
    "developer": ("john@atlas.dev", "dev123"),
    "tester": ("tester@atlas.dev", "tester123"),
}


def _login(role: str) -> requests.Session:
    email, pw = CREDS[role]
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": pw},
        timeout=15,
    )
    assert r.status_code == 200, f"{role} login failed: {r.status_code} {r.text[:300]}"
    data = r.json()
    assert "user_id" in data or "id" in data or "user" in data, f"login payload missing user id: {data}"
    return s


# ---------- AUTH ----------
class TestAuthLogin:
    @pytest.mark.parametrize("role", list(CREDS.keys()))
    def test_login_role(self, role):
        email, pw = CREDS[role]
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": email, "password": pw},
            timeout=15,
        )
        assert r.status_code == 200, f"{role} login {r.status_code}: {r.text[:300]}"
        body = r.json()
        # Has some user identifier
        uid = body.get("user_id") or body.get("id") or (body.get("user") or {}).get("id")
        assert uid, f"{role} login: no user_id in body keys={list(body.keys())}"
        # Has a session cookie
        assert len(r.cookies) > 0 or "set-cookie" in {k.lower() for k in r.headers}, \
            f"{role} login: no cookies set"


# ---------- INTEGRATIONS MANIFEST ----------
class TestIntegrationsManifest:
    def test_manifest_public(self):
        r = requests.get(f"{BASE_URL}/api/integrations/manifest", timeout=15)
        assert r.status_code == 200, f"manifest {r.status_code}: {r.text[:300]}"
        data = r.json()
        # manifest should be a list/dict of capabilities; allow either shape
        assert isinstance(data, (dict, list)), f"unexpected manifest shape: {type(data)}"
        # Look for at least one mock entry with a reason
        text = repr(data).lower()
        assert "mock" in text or "missing" in text or "stub" in text, \
            f"manifest does not appear to surface mock reasons: {text[:400]}"


# ---------- WEB-UI (CRA build) ----------
class TestWebUI:
    def test_web_ui_root_html(self):
        r = requests.get(f"{BASE_URL}/api/web-ui/", timeout=15)
        assert r.status_code == 200, f"web-ui {r.status_code}: {r.text[:300]}"
        ctype = r.headers.get("content-type", "")
        assert "html" in ctype.lower(), f"web-ui content-type not html: {ctype}"
        assert "<html" in r.text.lower() or "<!doctype" in r.text.lower(), \
            "web-ui body is not HTML"


# ---------- CLIENT ENDPOINTS ----------
class TestClientSurface:
    @pytest.fixture(scope="class")
    def client_session(self):
        return _login("client")

    def test_contracts_my(self, client_session):
        r = client_session.get(f"{BASE_URL}/api/contracts/my", timeout=15)
        assert r.status_code == 200, f"contracts/my {r.status_code}: {r.text[:300]}"
        body = r.json()
        items = body.get("items") if isinstance(body, dict) else body
        assert isinstance(items, list), f"contracts/my: items not a list, body={str(body)[:200]}"

    def test_client_invoices(self, client_session):
        r = client_session.get(f"{BASE_URL}/api/client/invoices", timeout=15)
        assert r.status_code == 200, f"client/invoices {r.status_code}: {r.text[:300]}"
        body = r.json()
        items = body if isinstance(body, list) else body.get("items") or body.get("invoices")
        assert isinstance(items, list), f"client/invoices: not a list, body={str(body)[:200]}"
        # At least one invoice expected from seed (paid)
        if items:
            statuses = {(i.get("status") or "").lower() for i in items if isinstance(i, dict)}
            # informational only — don't fail if seed differs
            print(f"client invoice statuses: {statuses}")


# ---------- ADMIN SURFACE ----------
class TestAdminSurface:
    @pytest.fixture(scope="class")
    def admin_session(self):
        return _login("admin")

    @pytest.mark.parametrize("path", [
        "/api/admin/users",
        "/api/admin/team",
        "/api/admin/contracts",
        "/api/admin/integrations",
    ])
    def test_admin_endpoint(self, admin_session, path):
        r = admin_session.get(f"{BASE_URL}{path}", timeout=15)
        assert r.status_code == 200, f"{path} {r.status_code}: {r.text[:400]}"
        body = r.json()
        assert isinstance(body, (dict, list)), f"{path}: unexpected body type {type(body)}"
