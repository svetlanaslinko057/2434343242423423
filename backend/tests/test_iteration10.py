"""
Iteration 10 focused regression suite.

Covers:
- BUG: GET /openapi.json must return 200 (was 500 — response_class=None on /api/contracts/{id}/html)
- FEATURE: AUTH_OTP_DEV_MODE=true → POST /api/auth/send-code returns `dev_code` in response body
- FEATURE: GET /api/client/project/{id}/workspace has top-level `status` field
- STAGE 4: GET /api/tester/validation-tasks returns >=5 (2 mine pending/in-progress, 1 passed, 1 failed, 1 unclaimed)
- STAGE 4: GET /api/tester/issues has >=1 demo issue with severity=high
- REGRESSION: /api/estimate works (visitor → estimate)
"""
import os
import uuid
import pytest
import requests

# External preview URL the user actually sees.
PREVIEW_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://expo-mobile-app-17.preview.emergentagent.com"
).rstrip("/")

# /openapi.json is NOT prefixed with /api — ingress doesn't route it externally,
# so we hit the backend internally for that one specific assertion.
INTERNAL_BACKEND = "http://localhost:8001"

TESTER_EMAIL = "tester@atlas.dev"
TESTER_PASSWORD = "tester123"
CLIENT_EMAIL = "client@atlas.dev"
CLIENT_PASSWORD = "client123"


# ------------------------------------------------------------ fixtures

@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email, password):
    r = session.post(
        f"{PREVIEW_URL}/api/mobile/auth/login",
        json={"email": email, "password": password},
        timeout=30,
    )
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def tester_auth(session):
    body = _login(session, TESTER_EMAIL, TESTER_PASSWORD)
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {body['token']}",
    })
    return s


@pytest.fixture(scope="module")
def client_auth(session):
    body = _login(session, CLIENT_EMAIL, CLIENT_PASSWORD)
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {body['token']}",
    })
    return s


# ------------------------------------------------------------ openapi bug

class TestOpenAPIBugFix:
    """Regression: /openapi.json must not 500 after HTMLResponse fix."""

    def test_openapi_returns_200(self):
        r = requests.get(f"{INTERNAL_BACKEND}/openapi.json", timeout=30)
        assert r.status_code == 200, f"openapi crashed: {r.status_code} {r.text[:500]}"
        data = r.json()
        assert "openapi" in data, f"not a valid openapi doc: {list(data.keys())[:10]}"
        assert "paths" in data
        # /api/contracts/{contract_id}/html was the offender — confirm it appears now.
        # Any of the contract-html routes is fine; we just need *no crash*.
        paths = data["paths"]
        assert isinstance(paths, dict) and len(paths) > 50, f"paths too small: {len(paths)}"


# ------------------------------------------------------------ auth dev code

class TestAuthOTPDevMode:
    """AUTH_OTP_DEV_MODE=true: /api/auth/send-code must include `dev_code`."""

    def test_send_code_returns_dev_code(self, session):
        email = f"TEST_devmode_{uuid.uuid4().hex[:8]}@atlas.dev"
        r = session.post(
            f"{PREVIEW_URL}/api/auth/send-code",
            json={"email": email},
            timeout=30,
        )
        assert r.status_code == 200, f"send-code failed: {r.status_code} {r.text}"
        body = r.json()
        assert "dev_code" in body, f"dev_code missing in dev mode: {body}"
        code = body["dev_code"]
        assert isinstance(code, str) and code.isdigit() and len(code) in (4, 5, 6), \
            f"dev_code shape wrong: {code!r}"


# ------------------------------------------------------------ tester surface (stage 4)

@pytest.fixture(scope="module")
def tasks(tester_auth):
    r = tester_auth.get(f"{PREVIEW_URL}/api/tester/validation-tasks", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list)
    return data


class TestTesterStage4Seed:
    def test_at_least_five_validations(self, tasks):
        assert len(tasks) >= 5, f"expected >=5 seeded validation tasks (per TESTER SEED), got {len(tasks)}: {tasks}"

    def test_status_mix_present(self, tasks):
        statuses = [t.get("status") for t in tasks]
        s = set(statuses)
        # Seed: 2 mine (pending+in_progress), 1 passed, 1 failed, 1 unclaimed pending
        assert "in_progress" in s, f"missing in_progress: {statuses}"
        assert "passed" in s, f"missing passed: {statuses}"
        assert "failed" in s, f"missing failed: {statuses}"
        assert "pending" in s, f"missing pending: {statuses}"

    def test_issues_endpoint_has_high_severity(self, tester_auth):
        r = tester_auth.get(f"{PREVIEW_URL}/api/tester/issues", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list), f"issues not a list: {type(data)}"
        assert len(data) >= 1, f"expected >=1 demo issue, got {len(data)}"
        severities = [i.get("severity") for i in data]
        assert "high" in severities, f"expected severity=high in seeded issue, got {severities}"


# ------------------------------------------------------------ client workspace top-level status

class TestClientWorkspaceStatus:
    """GET /api/client/project/{id}/workspace must include top-level `status`."""

    def test_workspace_has_top_level_status(self, client_auth, session):
        # No /api/client/projects listing — discover a project via admin (which exists).
        admin_login = session.post(
            f"{PREVIEW_URL}/api/mobile/auth/login",
            json={"email": "admin@atlas.dev", "password": "admin123"},
            timeout=30,
        )
        assert admin_login.status_code == 200, admin_login.text
        admin_token = admin_login.json()["token"]
        r = requests.get(
            f"{PREVIEW_URL}/api/admin/projects?limit=5",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30,
        )
        if r.status_code != 200:
            pytest.skip(f"/api/admin/projects unavailable: {r.status_code}")
        projects = r.json()
        if not isinstance(projects, list) or not projects:
            pytest.skip("no projects to test workspace against")
        # Pick one owned by client@atlas.dev so client_auth can read its workspace.
        client_login = session.post(
            f"{PREVIEW_URL}/api/mobile/auth/login",
            json={"email": "client@atlas.dev", "password": "client123"},
            timeout=30,
        )
        client_uid = client_login.json()["user"].get("user_id")
        pid = None
        for p in projects:
            if p.get("client_id") == client_uid:
                pid = p.get("project_id")
                break
        if not pid:
            pid = projects[0].get("project_id")
        assert pid, f"no project id: {projects[0]}"

        r2 = client_auth.get(f"{PREVIEW_URL}/api/client/project/{pid}/workspace", timeout=30)
        assert r2.status_code == 200, f"workspace failed: {r2.status_code} {r2.text}"
        ws = r2.json()
        # Top-level project object
        project = ws.get("project") or ws
        assert "status" in project, f"top-level project.status missing. keys={list(project.keys())}"
        # back-compat: deposit.project_status must still exist
        deposit = ws.get("deposit") or {}
        # not strict if deposit absent — but if present, project_status should remain
        if deposit:
            assert "project_status" in deposit, f"deposit.project_status back-compat missing: {deposit.keys()}"


# ------------------------------------------------------------ regression: estimate

class TestEstimateRegression:
    def test_estimate_endpoint_returns_200(self, session):
        payload = {
            "description": (
                "TEST_ Build a B2B SaaS analytics dashboard for SMB e-commerce stores. "
                "Users: store owners (~5000 monthly active). Features: Stripe billing with "
                "monthly subscription, Google OAuth login, dashboard with sales charts, "
                "Shopify and WooCommerce integrations, daily email reports via Resend, "
                "admin panel for support team. Tech: React, FastAPI, Postgres. Scale 10k users."
            ),
        }
        r = session.post(f"{PREVIEW_URL}/api/estimate", json=payload, timeout=60)
        assert r.status_code == 200, f"estimate failed: {r.status_code} {r.text}"
        body = r.json()
        # Either price returned OR a clarity gate response — both are valid 200 shapes.
        flat_keys = ["price", "amount", "estimate", "estimated_price", "total", "price_min", "price_max"]
        nested = body.get("estimate") if isinstance(body.get("estimate"), dict) else None
        priced = any(k in body for k in flat_keys) or (nested and any(k in nested for k in flat_keys))
        clarity_gate = body.get("clarity") in ("low", "medium") and "suggestions" in body
        assert priced or clarity_gate, f"unexpected estimate response shape: {body}"
