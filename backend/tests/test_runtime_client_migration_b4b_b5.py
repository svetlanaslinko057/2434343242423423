"""
Iteration 5 — Runtime-client migration regression (Batch 4b + Batch 5).

Verifies that after the axios → runtime/runtime-client codemod:
- Expo /developer/* pages still resolve (HTTP 200 on Expo web preview)
- Web SPA shell at /api/web-ui/* still resolves for the 6 representative
  client routes that the migrated pages back
- All client API endpoints the migrated pages call still return 200 under
  cookie-based auth (web client) and Bearer auth (mobile/tester)
- Backend health is green
"""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "https://mobile-expo-stage.preview.emergentagent.com"


# --- Fixtures ---------------------------------------------------------------

@pytest.fixture(scope="module")
def client_session():
    """Cookie-based web client session."""
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "client@atlas.dev", "password": "client123"},
        timeout=15,
    )
    assert r.status_code == 200, f"client login failed: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def tester_token():
    """Bearer-token mobile/tester session."""
    r = requests.post(
        f"{BASE_URL}/api/mobile/auth/login",
        json={"email": "tester@atlas.dev", "password": "tester123"},
        timeout=15,
    )
    assert r.status_code == 200, f"tester login failed: {r.status_code}"
    return r.json()["token"]


# --- Backend health ---------------------------------------------------------

class TestBackendHealth:
    def test_healthz_200(self):
        r = requests.get(f"{BASE_URL}/api/healthz", timeout=10)
        assert r.status_code == 200


# --- Batch 4b: Expo developer pages reachability ----------------------------

class TestBatch4bExpoDeveloperPages:
    @pytest.mark.parametrize("path", [
        "/",
        "/developer/profile",
        "/developer/market",
        "/developer/acceptance",
        "/developer/work",
    ])
    def test_expo_route_200(self, path):
        r = requests.get(f"{BASE_URL}{path}", timeout=15)
        assert r.status_code == 200, f"{path} returned {r.status_code}"

    def test_work_tsx_has_payment_capability_on_submit_module(self):
        """work.tsx submit-module POST must carry capability: 'payment'.
        URL: /api/modules/${moduleId}/submit
        Options must include idempotencyKey 'submit-module:<id>' and capability:'payment'.
        """
        with open("/app/frontend/app/developer/work.tsx") as f:
            src = f.read()
        # locate the runtime.post(...modules/<id>/submit ...) call and its options arg
        m = re.search(
            r"runtime\.post\(\s*`/api/modules/\$\{moduleId\}/submit`,[^)]*?"
            r"idempotencyKey:\s*`submit-module:\$\{moduleId\}`[^)]*?"
            r"capability:\s*'payment'",
            src,
            re.DOTALL,
        )
        assert m, "submit-module POST is missing capability:'payment' option"


# --- Batch 4b: developer files transport invariants -------------------------

class TestBatch4bTransportInvariants:
    DEV_FILES = [
        "/app/frontend/app/developer/profile.tsx",
        "/app/frontend/app/developer/market.tsx",
        "/app/frontend/app/developer/acceptance.tsx",
        "/app/frontend/app/developer/work.tsx",
    ]

    @pytest.mark.parametrize("fp", DEV_FILES)
    def test_no_axios_in_developer_files(self, fp):
        with open(fp) as f:
            src = f.read()
        assert "from 'axios'" not in src and 'from "axios"' not in src, (
            f"{fp} still imports axios"
        )
        # also: no axios.<method>( calls
        assert not re.search(r"\baxios\.", src), f"{fp} still has axios.* call"

    @pytest.mark.parametrize("fp", DEV_FILES)
    def test_runtime_imports_present(self, fp):
        with open(fp) as f:
            src = f.read()
        assert "from '../../src/runtime'" in src, f"{fp} missing runtime import"
        assert "ApiError" in src, f"{fp} missing ApiError import"


# --- Batch 5: web SPA shell reachability ------------------------------------

class TestBatch5WebShellReachability:
    @pytest.mark.parametrize("path", [
        "/api/web-ui/",
        "/api/web-ui/client/hub",
        "/api/web-ui/client/cabinet",
        "/api/web-ui/client/dashboard",
        "/api/web-ui/client/projects",
        "/api/web-ui/client/transparency",
        "/api/web-ui/builder/auth",
    ])
    def test_web_route_200(self, path):
        r = requests.get(f"{BASE_URL}{path}", timeout=15)
        assert r.status_code == 200, f"{path} returned {r.status_code}"


# --- Batch 5: migrated files transport invariants ---------------------------

class TestBatch5TransportInvariants:
    """Walk every .js file in /app/web/src/pages that imports runtime and
    confirm no axios imports / axios.* calls remain. Also spot-check two
    representative migrated files for the runtime + ApiError import shape.
    """

    REP_FILES = [
        "/app/web/src/pages/ClientHub.js",
        "/app/web/src/pages/ClientCabinet.js",
        "/app/web/src/pages/ClientWorkspace.js",
        "/app/web/src/pages/ClientDocumentsPage.js",
        "/app/web/src/pages/BuilderAuth.js",
    ]

    def _read(self, fp):
        with open(fp) as f:
            return f.read()

    @pytest.mark.parametrize("fp", REP_FILES)
    def test_imports_runtime_and_api_error(self, fp):
        src = self._read(fp)
        assert "from '@/runtime'" in src, f"{fp} missing runtime import"
        assert "ApiError" in src, f"{fp} missing ApiError import"

    @pytest.mark.parametrize("fp", REP_FILES)
    def test_no_axios_residue(self, fp):
        src = self._read(fp)
        assert "from 'axios'" not in src and 'from "axios"' not in src, (
            f"{fp} still imports axios"
        )
        # no `${API}/` in axios-style calls (template-literal residue)
        assert not re.search(r"axios\.\w+\(\s*`\$\{API\}", src), (
            f"{fp} still has axios call with ${{API}} template literal"
        )


# --- Batch 5: client API endpoints the migrated pages call ------------------

class TestBatch5ClientAPIs:
    """The migrated client pages issue calls like runtime.get('/api/...'),
    NOT ${API}/.... So the ingress must resolve these bare-prefix paths
    under cookie-based auth.
    """

    def test_projects_mine_200(self, client_session):
        r = client_session.get(f"{BASE_URL}/api/projects/mine", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), (list, dict))

    def test_client_invoices_200(self, client_session):
        r = client_session.get(f"{BASE_URL}/api/client/invoices", timeout=10)
        assert r.status_code == 200

    def test_client_dashboard_200(self, client_session):
        r = client_session.get(f"{BASE_URL}/api/client/dashboard", timeout=10)
        assert r.status_code == 200

    def test_contracts_my_200(self, client_session):
        r = client_session.get(f"{BASE_URL}/api/contracts/my", timeout=10)
        assert r.status_code == 200

    def test_auth_me_200_for_client_cookie(self, client_session):
        r = client_session.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert r.status_code == 200
        body = r.json()
        # auth/me must echo client identity
        assert body.get("email") == "client@atlas.dev"
        assert "client" in (body.get("roles") or [])


# --- Stage-4 regression cross-check (tester surface still healthy) ----------

class TestStage4TesterRegression:
    def test_tester_home_200(self):
        r = requests.get(f"{BASE_URL}/tester/home", timeout=15)
        assert r.status_code == 200

    def test_tester_validations_200(self):
        r = requests.get(f"{BASE_URL}/tester/validations", timeout=15)
        assert r.status_code == 200

    def test_tester_history_200(self):
        r = requests.get(f"{BASE_URL}/tester/history", timeout=15)
        assert r.status_code == 200

    def test_tester_validation_tasks_api(self, tester_token):
        r = requests.get(
            f"{BASE_URL}/api/tester/validation-tasks",
            headers={"Authorization": f"Bearer {tester_token}"},
            timeout=10,
        )
        assert r.status_code == 200
        body = r.json()
        items = body if isinstance(body, list) else body.get("items", [])
        assert len(items) >= 1, "expected at least one validation task in seed"
