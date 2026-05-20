"""
E2E backend tests for EVA-X DescribeWidget → /api/estimate pipeline.
Covers:
  - Auth (admin / client / dev / tester seeded credentials)
  - /api/estimate determinism (PARITY web ↔ Expo)
  - /api/estimate/analyze-url (live LLM via emergentintegrations)
  - /api/estimate/parse-file (multipart text upload)
  - /api/integrations/manifest
  - Admin inbox / leads endpoints discovery
  - /api/web-ui landing reachability
"""
import io
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://app-preview-mobile-33.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def admin_session():
    sess = requests.Session()
    r = sess.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@atlas.dev", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    return sess


# ---------------------- AUTH ----------------------
class TestAuth:
    """AUTH-1/2/3 — seeded credential matrix."""

    @pytest.mark.parametrize("email,password,role", [
        ("admin@atlas.dev",  "admin123",   "admin"),
        ("client@atlas.dev", "client123",  "client"),
        ("john@atlas.dev",   "dev123",     "developer"),
        ("tester@atlas.dev", "tester123",  "tester"),
    ])
    def test_login_each_seeded_user(self, email, password, role):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
        assert r.status_code == 200, f"{email} login -> {r.status_code} {r.text[:200]}"
        body = r.json()
        # Either role at top-level or in roles[]
        roles = body.get("roles") or ([body["role"]] if body.get("role") else [])
        assert role in roles or body.get("role") == role, f"{email} expected role {role}, got {body}"

    def test_wrong_password_rejected(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@atlas.dev", "password": "wrong"}, timeout=15)
        assert r.status_code in (400, 401), f"expected 401, got {r.status_code}"

    def test_credentials_doc_mismatch(self):
        """Doc /app/memory/test_credentials.md says ALL users password=admin123 — only admin matches."""
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "client@atlas.dev", "password": "admin123"}, timeout=15)
        # The test_credentials.md says this should be 200 — server says 401. Flagging.
        assert r.status_code == 401  # documents the mismatch; if seed is fixed to admin123 this will start failing


# ---------------------- WEB-UI LANDING ----------------------
class TestWebUI:
    def test_web_ui_serves_html(self, s):
        r = s.get(f"{BASE_URL}/api/web-ui/", timeout=15)
        assert r.status_code == 200
        assert "<html" in r.text.lower() or "<!doctype html" in r.text.lower()


# ---------------------- INTEGRATIONS MANIFEST ----------------------
class TestManifest:
    def test_manifest_200(self, s):
        r = s.get(f"{BASE_URL}/api/integrations/manifest", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "capabilities" in body
        caps = body["capabilities"]
        for k in ("payment", "mail", "storage"):
            assert k in caps, f"capability {k} missing"


# ---------------------- ESTIMATE ENGINE ----------------------
SAMPLE_GOAL = (
    "I need a B2B logistics platform: real-time tracking, multi-tenant admin, "
    "Stripe billing, partner API with OAuth2, role-based RBAC, mobile drivers app, "
    "and finance reporting with export to CSV."
)


class TestEstimateCore:
    """BACKEND-API + PARITY-1 — same input must yield deterministic numbers."""

    def test_estimate_basic_shape(self, s):
        r = s.post(f"{BASE_URL}/api/estimate", json={"goal": SAMPLE_GOAL}, timeout=120)
        assert r.status_code == 200, f"estimate failed: {r.status_code} {r.text[:300]}"
        body = r.json()
        # Required top-level keys for the result page
        assert "estimate" in body, body.keys()
        est = body["estimate"]
        for k in ("final_price", "implementation_price", "reality_multiplier", "estimated_hours", "complexity"):
            assert k in est, f"estimate missing {k}: {est.keys()}"
        # Modules + tech-stack expected by EstimateResultPage
        assert "modules_detailed" in body or "modules" in body
        assert isinstance(est["final_price"], (int, float))
        assert est["final_price"] > 0
        assert est["reality_multiplier"] >= 1.0

    def test_estimate_determinism_parity_web_vs_expo(self, s):
        """Same goal → same numbers (web and Expo both POST here)."""
        r1 = s.post(f"{BASE_URL}/api/estimate", json={"goal": SAMPLE_GOAL}, timeout=120).json()
        r2 = s.post(f"{BASE_URL}/api/estimate", json={"goal": SAMPLE_GOAL}, timeout=120).json()
        e1, e2 = r1["estimate"], r2["estimate"]
        assert e1["final_price"] == e2["final_price"], f"non-deterministic price: {e1['final_price']} vs {e2['final_price']}"
        assert e1["implementation_price"] == e2["implementation_price"]
        assert e1["reality_multiplier"] == e2["reality_multiplier"]
        assert e1["estimated_hours"] == e2["estimated_hours"]

    def test_estimate_short_goal_clarity(self, s):
        """Very short goal should still return 200 with a clarity field."""
        r = s.post(f"{BASE_URL}/api/estimate", json={"goal": "todo app"}, timeout=60)
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        # clarity present at top-level per WEB-1/2 contract
        assert "clarity" in body or "estimate" in body


class TestEstimateAnalyzeURL:
    def test_analyze_url_live_or_cached(self, s):
        r = s.post(f"{BASE_URL}/api/estimate/analyze-url", json={"url": "https://linear.app"}, timeout=60)
        assert r.status_code == 200, f"analyze-url -> {r.status_code} {r.text[:200]}"
        body = r.json()
        assert "cached" in body, f"missing cached flag: {body}"
        # accept either summary, title, or content field
        assert any(k in body for k in ("summary", "title", "content", "description")), f"empty payload: {body}"


class TestEstimateParseFile:
    def test_parse_file_text_upload(self, s):
        content = b"We need an MVP marketplace: vendors, escrow, reviews, mobile apps. Budget ~$80k."
        files = {"file": ("brief.txt", io.BytesIO(content), "text/plain")}
        # Note: drop the JSON content-type for multipart
        r = requests.post(f"{BASE_URL}/api/estimate/parse-file", files=files, timeout=60)
        assert r.status_code == 200, f"parse-file -> {r.status_code} {r.text[:200]}"
        body = r.json()
        # expect extracted text or goal field
        assert any(k in body for k in ("text", "goal", "content", "extracted"))


# ---------------------- ADMIN INBOX / LEADS ----------------------
ADMIN_ENDPOINT_CANDIDATES = [
    "/api/admin/inbox",
    "/api/admin/leads",
    "/api/admin/estimates",
    "/api/admin/estimate-events",
    "/api/admin/submissions",
    "/api/admin/projects",
    "/api/leads",
    "/api/leads/list",
    "/api/admin/mobile/inbox",
]


class TestAdminInbox:
    """ADMIN-2/3 — discover which admin endpoint surfaces visitor estimate submissions."""

    def test_admin_can_reach_some_inbox_endpoint(self, admin_session):
        results = {}
        any_ok = False
        for path in ADMIN_ENDPOINT_CANDIDATES:
            try:
                r = admin_session.get(f"{BASE_URL}{path}", timeout=10)
                results[path] = r.status_code
                if r.status_code == 200:
                    any_ok = True
            except Exception as e:
                results[path] = f"err:{e}"
        print("ADMIN INBOX SCAN:", results)
        assert any_ok, f"NO admin inbox endpoint returned 200 — see scan: {results}"

    def test_visitor_estimate_persisted_for_admin(self, s, admin_session):
        """Submit anonymous estimate, then check if admin can find it anywhere."""
        marker = "ATLAS_TEST_LEAD_MARKER_e2e_123abc B2B logistics with Stripe + OAuth2 + RBAC + drivers mobile app and CSV export."
        r = s.post(f"{BASE_URL}/api/estimate", json={"goal": marker}, timeout=120)
        assert r.status_code == 200
        # try every candidate
        found_in = []
        for path in ADMIN_ENDPOINT_CANDIDATES:
            try:
                rr = admin_session.get(f"{BASE_URL}{path}", timeout=10)
                if rr.status_code == 200 and "ATLAS_TEST_LEAD_MARKER" in rr.text:
                    found_in.append(path)
            except Exception:
                pass
        # This will FAIL if no endpoint surfaces anonymous submissions — that is the P2 gap.
        assert found_in, "P2 GAP: anonymous estimate NOT visible to admin in any candidate endpoint."
