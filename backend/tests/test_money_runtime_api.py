"""
Этап 6.1 — Money Runtime API end-to-end tests.

Verifies the exact features listed in the review request:
 - POST /api/auth/login for all 4 demo accounts (cookie-based session)
 - GET /api/money/runtime/state (public) with demo counts
 - GET /api/admin/money/ledger (8 events) + filter by event_type
 - GET /api/admin/money/overview (admin only)
 - GET /api/client/billing/overview (client@evax.demo)
 - GET /api/developer/wallet (developer@evax.demo)
 - Idempotency invariant: ledger total_events == 8
 - Web SPA / Expo HTML reachable
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://mobile-web-stack-10.preview.emergentagent.com").rstrip("/")

ACCOUNTS = {
    "admin":     ("admin@evax.demo",     "Admin123!",     "demo_admin_001"),
    "client":    ("client@evax.demo",    "Client123!",    "demo_client_001"),
    "developer": ("developer@evax.demo", "Developer123!", "demo_dev_001"),
    "tester":    ("tester@evax.demo",    "Tester123!",    "demo_tester_001"),
}


def _login(role: str) -> requests.Session:
    email, password, expected_uid = ACCOUNTS[role]
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
        timeout=30,
    )
    assert r.status_code == 200, f"login {role} failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("user_id") == expected_uid, f"unexpected user_id for {role}: {body}"
    assert "session_token" in s.cookies, f"no session_token cookie set for {role}"
    return s


# ── Auth ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("role", list(ACCOUNTS.keys()))
def test_login_all_demo_accounts(role):
    """All 4 demo accounts authenticate and receive a session cookie."""
    s = _login(role)
    assert s.cookies.get("session_token", "").startswith("sess_")


# ── Public money runtime state ──────────────────────────────────────────────

def test_money_runtime_state_public():
    r = requests.get(f"{BASE_URL}/api/money/runtime/state", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert {"payment_capability", "stages", "diagnostics", "checked_at"} <= set(body.keys())
    stages = body["stages"]
    assert set(stages.keys()) == {"invoices", "escrows", "earnings", "payouts"}
    # Demo chain must be visible (non-zero counts)
    assert stages["invoices"].get("paid", 0) >= 1, f"expected >=1 paid invoice: {stages}"
    assert stages["escrows"].get("total", 0) >= 1
    # mock mode must be honest (not 'live')
    assert body["payment_capability"]["mode"] in {"mock", "degraded", "unavailable"}


# ── Admin ledger ────────────────────────────────────────────────────────────

EXPECTED_EVENT_TYPES = {
    "invoice_paid", "escrow_funded", "qa_approved", "earning_approved",
    "escrow_released", "payout_batched", "payout_approved", "payout_paid",
}


def test_admin_money_ledger_has_8_events():
    s = _login("admin")
    r = s.get(f"{BASE_URL}/api/admin/money/ledger", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "events" in body or "items" in body or isinstance(body, list), body
    events = body.get("events") if isinstance(body, dict) else body
    if events is None:
        events = body.get("items", [])
    assert isinstance(events, list)
    assert len(events) >= 8, f"expected at least 8 ledger events, got {len(events)}"
    types_seen = {e.get("event_type") for e in events}
    missing = EXPECTED_EVENT_TYPES - types_seen
    assert not missing, f"missing ledger event types: {missing}; saw {types_seen}"
    # Verify amounts on canonical events
    by_type = {e["event_type"]: e for e in events if e.get("event_type") in EXPECTED_EVENT_TYPES}
    assert float(by_type["invoice_paid"].get("amount") or 0) == 1000.0
    assert float(by_type["escrow_funded"].get("amount") or 0) == 1000.0
    assert float(by_type["payout_paid"].get("amount") or 0) == 700.0
    assert float(by_type["earning_approved"].get("amount") or 0) == 700.0


def test_admin_money_ledger_filter_by_event_type():
    s = _login("admin")
    r = s.get(f"{BASE_URL}/api/admin/money/ledger", params={"event_type": "invoice_paid"}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    events = body.get("events") if isinstance(body, dict) else body
    if events is None:
        events = body.get("items", [])
    assert len(events) >= 1
    for e in events:
        assert e["event_type"] == "invoice_paid", f"filter leaked: {e}"


def test_admin_money_ledger_requires_admin():
    s = _login("client")
    r = s.get(f"{BASE_URL}/api/admin/money/ledger", timeout=30)
    assert r.status_code in (401, 403), f"non-admin should be rejected, got {r.status_code}"


# ── Admin overview ──────────────────────────────────────────────────────────

def test_admin_money_overview():
    s = _login("admin")
    r = s.get(f"{BASE_URL}/api/admin/money/overview", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "ledger" in body
    assert "stages" in body
    led = body["ledger"]
    # by_event_type aggregate must contain canonical events
    by_type = led.get("by_event_type") or led.get("counts_by_event_type") or {}
    if isinstance(by_type, list):
        by_type = {x.get("event_type") or x.get("_id"): x for x in by_type}
    for et in EXPECTED_EVENT_TYPES:
        assert et in by_type, f"missing event type {et} in overview ledger.by_event_type: {by_type}"
    stages = body["stages"]
    assert "invoices" in stages and "escrows" in stages and "wallet_totals" in stages
    assert stages["wallet_totals"].get("earned_lifetime", 0) >= 700
    assert stages["wallet_totals"].get("withdrawn_lifetime", 0) >= 700


# ── Client billing overview ─────────────────────────────────────────────────

def test_client_billing_overview():
    s = _login("client")
    r = s.get(f"{BASE_URL}/api/client/billing/overview", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("client_id") == "demo_client_001"
    assert body.get("total_invoices") == 1, body
    assert float(body.get("total_paid_amount") or 0) == 1000.0


# ── Developer wallet ────────────────────────────────────────────────────────

def test_developer_wallet():
    s = _login("developer")
    r = s.get(f"{BASE_URL}/api/developer/wallet", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert float(body.get("earned_lifetime") or 0) == 700.0, body
    assert float(body.get("withdrawn_lifetime") or 0) == 700.0, body
    history = body.get("history") or body.get("transactions") or body.get("ledger") or []
    # At least one entry tied to the demo module
    matches = [
        h for h in history
        if "demo_module_money_001" in str(h.get("module_id") or "")
        or "demo_module_money_001" in str(h.get("reference") or "")
        or "demo_module_money_001" in str(h.get("ref") or "")
    ]
    assert len(matches) >= 1, f"no history entry for demo_module_money_001 in {history}"


# ── Idempotency check (by counting events twice) ────────────────────────────

def test_ledger_idempotency_count_is_8():
    """The seed has been run; count must remain exactly 8 canonical events."""
    s = _login("admin")
    r = s.get(f"{BASE_URL}/api/admin/money/ledger", params={"limit": 500}, timeout=30)
    assert r.status_code == 200
    body = r.json()
    events = body.get("events") if isinstance(body, dict) else body
    if events is None:
        events = body.get("items", [])
    # Demo chain emits exactly 8 canonical events. Count each type — must be 1 each.
    by_type = {}
    for e in events:
        et = e.get("event_type")
        if et in EXPECTED_EVENT_TYPES:
            by_type[et] = by_type.get(et, 0) + 1
    for et in EXPECTED_EVENT_TYPES:
        assert by_type.get(et, 0) == 1, f"idempotency violation: {et} count={by_type.get(et,0)} (expected 1); full counts={by_type}"
    assert sum(by_type.values()) == 8, f"expected exactly 8 canonical events, got {sum(by_type.values())}"


# ── Static surfaces ─────────────────────────────────────────────────────────

def test_web_spa_loads():
    r = requests.get(f"{BASE_URL}/api/web-ui/", timeout=30)
    assert r.status_code == 200, r.status_code
    assert "html" in r.headers.get("content-type", "").lower()


def test_expo_mobile_loads():
    r = requests.get(f"{BASE_URL}/", timeout=30)
    assert r.status_code == 200
