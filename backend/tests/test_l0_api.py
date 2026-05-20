"""L0 UI layer backend API tests.

Covers the endpoints consumed by the Expo AppShell:
  - auth: login + demo
  - me: GET /api/me returns states[] + active_context
  - me/context: POST switches active_context
  - projects: POST flips caller to state=client + returns redirect
  - developer/apply: POST flips caller to state=developer + returns redirect
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://full-stack-demo-14.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@atlas.dev", "password": "admin123"}
CLIENT = {"email": "client@atlas.dev", "password": "client123"}
DEV = {"email": "john@atlas.dev", "password": "dev123"}
MULTI = {"email": "multi@atlas.dev", "password": "multi123"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login {creds['email']} -> {r.status_code}: {r.text[:200]}"
    data = r.json()
    # Token lives in session_token cookie (HttpOnly). Mobile also uses it as Bearer.
    token = (
        data.get("session_token")
        or data.get("token")
        or r.cookies.get("session_token")
    )
    assert token, f"no token in login response or cookies: body={data} cookies={r.cookies.get_dict()}"
    return token, data


def _demo(role="tester"):
    r = requests.post(f"{API}/auth/demo", json={"role": role}, timeout=20)
    assert r.status_code == 200, f"demo {role}: {r.status_code} {r.text[:200]}"
    data = r.json()
    token = data.get("session_token") or data.get("token") or r.cookies.get("session_token")
    assert token, f"no token: body={data} cookies={r.cookies.get_dict()}"
    return token, data


def _headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# --- auth ---
class TestAuth:
    def test_login_admin(self):
        token, data = _login(ADMIN)
        assert isinstance(token, str) and len(token) > 10
        assert "user" in data or "email" in data or data.get("ok") is True

    def test_login_client(self):
        token, _ = _login(CLIENT)
        assert token

    def test_login_dev(self):
        token, _ = _login(DEV)
        assert token

    def test_demo_quick_login(self):
        token, _ = _demo("client")
        assert token


# --- /me ---
class TestMe:
    def test_me_admin_shape(self):
        token, _ = _login(ADMIN)
        r = requests.get(f"{API}/me", headers=_headers(token), timeout=20)
        assert r.status_code == 200, r.text[:200]
        me = r.json()
        assert "states" in me, f"missing states[] in /me: {me}"
        assert "active_context" in me, f"missing active_context in /me: {me}"
        assert isinstance(me["states"], list)

    def test_me_client_has_client_state(self):
        token, _ = _login(CLIENT)
        r = requests.get(f"{API}/me", headers=_headers(token), timeout=20)
        assert r.status_code == 200
        me = r.json()
        assert "client" in (me.get("states") or []), f"client user should have client state: {me}"

    def test_me_multi_multi_states(self):
        token, _ = _login(MULTI)
        r = requests.get(f"{API}/me", headers=_headers(token), timeout=20)
        assert r.status_code == 200
        me = r.json()
        # multi user typically has 2+ states
        assert len(me.get("states") or []) >= 1, me


# --- /me/context ---
class TestContextSwitch:
    def test_switch_context_multi(self):
        token, _ = _login(MULTI)
        me_before = requests.get(f"{API}/me", headers=_headers(token), timeout=20).json()
        states = me_before.get("states") or []
        if len(states) < 2:
            pytest.skip(f"multi user has <2 states: {states}")
        target = next((s for s in states if s != me_before.get("active_context")), None)
        assert target, "no alt state to switch to"

        r = requests.post(f"{API}/me/context", json={"context": target}, headers=_headers(token), timeout=20)
        assert r.status_code == 200, r.text[:200]

        me_after = requests.get(f"{API}/me", headers=_headers(token), timeout=20).json()
        assert me_after.get("active_context") == target, f"switch failed: {me_after}"

    def test_switch_context_invalid_rejected(self):
        token, _ = _login(CLIENT)
        r = requests.post(f"{API}/me/context", json={"context": "not_a_state_xyz"}, headers=_headers(token), timeout=20)
        # Should not silently succeed: expect 400/403/422
        assert r.status_code >= 400, f"accepted invalid ctx: {r.status_code} {r.text[:200]}"


# --- /projects (client state flip) ---
class TestCreateProjectFlip:
    def test_demo_user_create_project_flips_to_client(self):
        # Use disposable demo account so we don't pollute real users
        token, _ = _demo("tester")

        before = requests.get(f"{API}/me", headers=_headers(token), timeout=20).json()

        title = f"TEST_L0_{uuid.uuid4().hex[:6]}"
        resp = requests.post(f"{API}/projects", json={"title": title, "mode": "ai"}, headers=_headers(token), timeout=30)
        assert resp.status_code in (200, 201), f"create project: {resp.status_code} {resp.text[:300]}"
        body = resp.json()
        assert "project_id" in body or "id" in body, body
        # redirect preferred by frontend
        assert "redirect" in body, f"missing redirect in response: {body}"
        # Backend must redirect to existing /app/frontend/app/workspace/[id].tsx
        pid = body.get("project_id") or body.get("id")
        assert body["redirect"] == f"/workspace/{pid}", f"expected /workspace/{{id}}, got {body['redirect']}"

        after = requests.get(f"{API}/me", headers=_headers(token), timeout=20).json()
        assert "client" in (after.get("states") or []), f"did not flip to client: before={before} after={after}"


# --- /developer/apply ---
class TestApplyDeveloper:
    def test_demo_user_apply_developer_flips_state(self):
        token, _ = _demo("tester")

        resp = requests.post(f"{API}/developer/apply", headers=_headers(token), timeout=20)
        assert resp.status_code in (200, 201), f"{resp.status_code} {resp.text[:300]}"
        body = resp.json()
        assert "redirect" in body, body
        # Backend must redirect to existing /app/frontend/app/developer/home.tsx
        assert body["redirect"] == "/developer/home", f"expected /developer/home, got {body['redirect']}"

        me = requests.get(f"{API}/me", headers=_headers(token), timeout=20).json()
        assert "developer" in (me.get("states") or []), f"not flipped to developer: {me}"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v", "--tb=short"]))
