"""
Conversion chain + deposit flow regression tests for iteration 8.

Flow under test:
  visitor → POST /api/estimate (creates anonymous_lead)
         → POST /api/auth/register
         → POST /api/leads/{lead_id}/claim (auto-creates project, awaiting_deposit, 10% deposit)
         → admin sees converted lead via /api/admin/leads?status=converted
         → admin PATCH /api/admin/leads/{lead_id}
         → claimer hits GET /api/client/project/{id}/workspace (returns deposit block)
         → claimer POSTs /api/client/projects/{id}/deposit/checkout (mock provider)
         → claimer GET /api/client/attention (awaiting_deposit surfaced)
"""

import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL")
            or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or "https://expo-mobile-app-17.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "admin@atlas.dev"
ADMIN_PASSWORD = "admin123"


# -------------------- shared fixtures --------------------

@pytest.fixture(scope="module")
def state():
    return {}


@pytest.fixture(scope="module")
def client_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    tok = body.get("token") or body.get("access_token") or body.get("bearer_token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s


# -------------------- 1. /api/estimate creates anonymous_lead --------------------

def test_01_estimate_creates_anonymous_lead(client_session, state):
    goal = (
        f"ATLAS_TEST_ITER8 {uuid.uuid4().hex[:8]} — Build a B2B SaaS dashboard "
        "for solar fleet operators to monitor inverter health, track ROI, and "
        "auto-schedule maintenance with role-based access control and webhook alerts."
    )
    r = client_session.post(f"{BASE_URL}/api/estimate", json={"goal": goal}, timeout=120)
    assert r.status_code == 200, f"/api/estimate -> {r.status_code} {r.text[:400]}"
    body = r.json()
    assert "lead_id" in body, f"missing lead_id; keys={list(body.keys())}"
    assert body["lead_id"], "empty lead_id"
    est = body.get("estimate") or {}
    final_price = est.get("final_price") or body.get("final_price")
    assert final_price and float(final_price) > 0, f"final_price not positive: {final_price}"
    state["goal"] = goal
    state["lead_id"] = body["lead_id"]
    state["final_price"] = float(final_price)
    print(f"lead_id={state['lead_id']} final_price={state['final_price']}")


# -------------------- 2. register fresh user --------------------

def test_02_register_fresh_client(client_session, state):
    suffix = uuid.uuid4().hex[:10]
    email = f"test_iter8_{suffix}@atlas.test"
    password = f"Pw_{suffix}!9"
    r = client_session.post(f"{BASE_URL}/api/auth/register",
                            json={"email": email, "password": password,
                                  "role": "client", "name": "ITER8 Tester"},
                            timeout=30)
    assert r.status_code in (200, 201), f"register -> {r.status_code} {r.text[:400]}"
    body = r.json()
    tok = body.get("token") or body.get("access_token") or body.get("bearer_token")
    if tok:
        client_session.headers["Authorization"] = f"Bearer {tok}"
    # session cookie should also be set
    cookies = client_session.cookies.get_dict()
    assert tok or cookies, f"no auth token nor cookie; body keys={list(body.keys())}"
    user_id = body.get("user_id") or (body.get("user") or {}).get("id") or body.get("id")
    state["email"] = email
    state["password"] = password
    state["user_id"] = user_id
    state["has_token"] = bool(tok)
    print(f"registered {email} user_id={user_id} token={bool(tok)}")


# -------------------- 3. claim lead → auto-create project (awaiting_deposit) --------------------

def test_03_claim_lead_creates_awaiting_deposit_project(client_session, state):
    assert state.get("lead_id"), "prerequisite test_01 failed"
    lead_id = state["lead_id"]
    r = client_session.post(f"{BASE_URL}/api/leads/{lead_id}/claim",
                            json={}, timeout=30)
    assert r.status_code == 200, f"claim -> {r.status_code} {r.text[:400]}"
    body = r.json()
    project_id = body.get("project_id") or (body.get("project") or {}).get("id")
    assert project_id, f"no project_id in claim response: {body}"
    state["project_id"] = project_id

    # project status / deposit
    project = body.get("project") or {}
    status = project.get("status") or body.get("status")
    deposit_amount = (project.get("deposit_amount")
                      or body.get("deposit_amount"))
    assert status == "awaiting_deposit", f"expected awaiting_deposit, got {status}"
    expected_dep = round(state["final_price"] * 0.10, 2)
    assert deposit_amount is not None, "missing deposit_amount"
    # allow 1% tolerance
    assert abs(float(deposit_amount) - expected_dep) <= max(1.0, expected_dep * 0.02), (
        f"deposit_amount {deposit_amount} not ~10% of final_price {state['final_price']} "
        f"(expected ~{expected_dep})"
    )
    state["deposit_amount"] = float(deposit_amount)
    print(f"project_id={project_id} status={status} deposit={deposit_amount}")


# -------------------- 4. admin sees converted lead --------------------

def test_04_admin_sees_converted_lead(admin_session, state):
    assert state.get("lead_id")
    r = admin_session.get(f"{BASE_URL}/api/admin/leads",
                          params={"status": "converted"}, timeout=30)
    assert r.status_code == 200, f"admin/leads -> {r.status_code} {r.text[:300]}"
    data = r.json()
    leads = data if isinstance(data, list) else (data.get("leads") or data.get("items") or [])
    matched = [l for l in leads if (l.get("lead_id") == state["lead_id"]
                                    or l.get("id") == state["lead_id"])]
    assert matched, (f"converted lead {state['lead_id']} not found in admin/leads; "
                     f"count={len(leads)}")
    L = matched[0]
    assert L.get("status") == "converted", f"lead status {L.get('status')}"
    assert L.get("project_id") == state["project_id"], (
        f"lead.project_id={L.get('project_id')} != {state['project_id']}")


# -------------------- 5. admin PATCH lead notes/status --------------------

def test_05_admin_patch_lead(admin_session, state):
    note = f"ITER8 admin note {uuid.uuid4().hex[:6]}"
    r = admin_session.patch(f"{BASE_URL}/api/admin/leads/{state['lead_id']}",
                            json={"admin_notes": note, "status": "contacted"},
                            timeout=30)
    assert r.status_code == 200, f"patch -> {r.status_code} {r.text[:300]}"
    body = r.json()
    lead = body.get("lead") or body
    assert lead.get("admin_notes") == note or note in str(lead), (
        f"admin_notes not persisted: {lead}")
    assert lead.get("contacted_at"), f"contacted_at missing in {lead}"


# -------------------- 6. workspace returns deposit block --------------------

def test_06_workspace_returns_deposit_block(client_session, state):
    pid = state.get("project_id")
    assert pid
    r = client_session.get(f"{BASE_URL}/api/client/project/{pid}/workspace", timeout=30)
    assert r.status_code == 200, f"workspace -> {r.status_code} {r.text[:400]}"
    body = r.json()
    dep = body.get("deposit")
    assert dep, f"no 'deposit' block in workspace: keys={list(body.keys())}"
    assert dep.get("required") is True, f"deposit.required={dep.get('required')}"
    assert dep.get("paid") is False, f"deposit.paid={dep.get('paid')}"
    assert abs(float(dep.get("amount", 0)) - state["deposit_amount"]) < 1.0, (
        f"deposit.amount={dep.get('amount')} != {state['deposit_amount']}")
    assert dep.get("final_price"), "deposit.final_price missing"
    ps = (dep.get("project_status")
          or body.get("project_status")
          or (body.get("project") or {}).get("status"))
    assert ps == "awaiting_deposit", f"project_status={ps}"


# -------------------- 7. deposit/checkout idempotent mock --------------------

def test_07_deposit_checkout_mock_idempotent(client_session, state):
    pid = state["project_id"]
    r1 = client_session.post(
        f"{BASE_URL}/api/client/projects/{pid}/deposit/checkout",
        json={}, timeout=30)
    assert r1.status_code == 200, f"checkout1 -> {r1.status_code} {r1.text[:400]}"
    b1 = r1.json()
    assert b1.get("payment_url"), f"no payment_url: {b1}"
    assert b1.get("mode") == "mock", f"expected mode=mock, got {b1.get('mode')}"
    assert b1.get("provider") in ("mock-payment", "mock"), f"provider={b1.get('provider')}"
    assert abs(float(b1.get("amount", 0)) - state["deposit_amount"]) < 1.0
    inv1 = b1.get("invoice_id")
    assert inv1, "invoice_id missing"

    # idempotency
    r2 = client_session.post(
        f"{BASE_URL}/api/client/projects/{pid}/deposit/checkout",
        json={}, timeout=30)
    assert r2.status_code == 200
    inv2 = r2.json().get("invoice_id")
    assert inv2 == inv1, f"non-idempotent invoice: {inv1} vs {inv2}"


# -------------------- 8. /client/attention surfaces awaiting_deposit --------------------

def test_08_client_attention_awaiting_deposit(client_session, state):
    r = client_session.get(f"{BASE_URL}/api/client/attention", timeout=30)
    assert r.status_code == 200, f"attention -> {r.status_code} {r.text[:400]}"
    body = r.json()
    awd = body.get("awaiting_deposit")
    assert awd is not None and int(awd) >= 1, f"awaiting_deposit={awd} body keys={list(body.keys())}"
    projects = body.get("awaiting_deposit_projects") or []
    assert any((p.get("project_id") == state["project_id"]
                or p.get("id") == state["project_id"]) for p in projects), (
        f"project not surfaced; projects={projects}")
    total = body.get("total")
    if total is not None:
        assert int(total) >= 1, f"total={total}"
