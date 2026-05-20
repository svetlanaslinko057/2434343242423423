"""
Backend tests: OTP (email-code) auth — /api/auth/send-code + /api/auth/verify-code.

Covers:
  - send-code contract (ok, is_new_user, expires_in=600, dev_code 6 digits)
  - 30s resend cool-down (429) — same email throttled, different email not throttled
  - verify-code: happy path creates user (auth_methods=['code'], no password_hash)
  - verify-code: second use of same code → 400 "No active code" (consumed)
  - verify-code: wrong code → 400, 5 wrong attempts → 429
  - expired code (expires_at in past) → 400 "Code expired"
  - OTP-created user can claim a lead created under the same email
"""
import os
import time
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or "http://localhost:8001").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def db():
    c = MongoClient(MONGO_URL)
    return c[DB_NAME]


def _fresh_email(prefix="otp"):
    return f"TEST_{prefix}.{uuid.uuid4().hex[:10]}@test.io"


# ============ /api/auth/send-code ============
class TestSendCode:
    def test_send_code_contract_new_user(self, api):
        email = _fresh_email("new")
        r = api.post(f"{BASE_URL}/api/auth/send-code", json={"email": email})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert d.get("is_new_user") is True
        assert d.get("expires_in") == 600
        # DEV mode dev_code present and 6 digits
        assert "dev_code" in d, f"dev_code missing in DEV mode: {d}"
        assert d["dev_code"].isdigit() and len(d["dev_code"]) == 6

    def test_send_code_existing_user(self, api, db):
        # Clear any fresh auth_code for the seeded user to avoid cool-down from prior tests
        db.auth_codes.delete_many({"email": "client@atlas.dev"})
        r = api.post(f"{BASE_URL}/api/auth/send-code", json={"email": "client@atlas.dev"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_new_user"] is False

    def test_resend_cooldown_429(self, api):
        email = _fresh_email("cool")
        r1 = api.post(f"{BASE_URL}/api/auth/send-code", json={"email": email})
        assert r1.status_code == 200
        # Immediate resend → should be throttled
        r2 = api.post(f"{BASE_URL}/api/auth/send-code", json={"email": email})
        assert r2.status_code == 429, r2.text
        assert "wait" in r2.json().get("detail", "").lower()

    def test_cooldown_per_email_not_global(self, api):
        # Hit email A, then immediately hit email B → B must pass
        a = _fresh_email("a")
        b = _fresh_email("b")
        ra = api.post(f"{BASE_URL}/api/auth/send-code", json={"email": a})
        assert ra.status_code == 200
        rb = api.post(f"{BASE_URL}/api/auth/send-code", json={"email": b})
        assert rb.status_code == 200, rb.text

    def test_malformed_email_422(self, api):
        r = api.post(f"{BASE_URL}/api/auth/send-code", json={"email": "not-an-email"})
        assert r.status_code == 422


# ============ /api/auth/verify-code ============
class TestVerifyCode:
    def _send(self, api, email):
        r = api.post(f"{BASE_URL}/api/auth/send-code", json={"email": email})
        assert r.status_code == 200, r.text
        return r.json()["dev_code"]

    def test_happy_path_creates_new_user_code_only(self, api, db):
        email = _fresh_email("happy")
        code = self._send(api, email)
        r = api.post(f"{BASE_URL}/api/auth/verify-code",
                     json={"email": email, "code": code, "name": "Happy Tester"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("token", "").startswith("sess_")
        u = d.get("user") or {}
        assert u.get("email") == email.lower()
        assert u.get("role") == "client"
        # User doc in DB: auth_methods=['code'] and no password_hash
        doc = db.users.find_one({"email": email.lower()})
        assert doc is not None
        assert "code" in (doc.get("auth_methods") or [])
        assert doc.get("password_hash") in (None, "")

    def test_code_reuse_returns_400_no_active_code(self, api):
        email = _fresh_email("reuse")
        code = self._send(api, email)
        r1 = api.post(f"{BASE_URL}/api/auth/verify-code",
                      json={"email": email, "code": code})
        assert r1.status_code == 200
        # Second use — code consumed
        r2 = api.post(f"{BASE_URL}/api/auth/verify-code",
                      json={"email": email, "code": code})
        assert r2.status_code == 400, r2.text
        assert "no active code" in r2.json()["detail"].lower()

    def test_wrong_code_400_then_five_attempts_lock_429(self, api):
        email = _fresh_email("wrong")
        real_code = self._send(api, email)
        # Try 5 wrong codes (avoid colliding with real_code)
        wrong = "000000" if real_code != "000000" else "111111"
        statuses = []
        for _ in range(5):
            rr = api.post(f"{BASE_URL}/api/auth/verify-code",
                          json={"email": email, "code": wrong})
            statuses.append(rr.status_code)
        # First 5 wrong: 400 "Invalid code"
        assert all(s == 400 for s in statuses), f"wrong-code statuses: {statuses}"
        # 6th attempt (any code, even the right one) → 429 lockout
        rlock = api.post(f"{BASE_URL}/api/auth/verify-code",
                         json={"email": email, "code": real_code})
        assert rlock.status_code == 429, rlock.text
        assert "too many" in rlock.json()["detail"].lower()

    def test_expired_code_400(self, api, db):
        email = _fresh_email("exp")
        code = self._send(api, email)
        # Flip expires_at into the past
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        upd = db.auth_codes.update_one(
            {"email": email.lower(), "code": code, "consumed_at": None},
            {"$set": {"expires_at": past}},
        )
        assert upd.modified_count == 1
        r = api.post(f"{BASE_URL}/api/auth/verify-code",
                     json={"email": email, "code": code})
        assert r.status_code == 400, r.text
        assert "expired" in r.json()["detail"].lower()


# ============ E2E: lead intake → OTP auth → claim ============
class TestOtpLeadClaim:
    def test_otp_user_can_claim_their_lead(self, api):
        email = _fresh_email("claim")
        # 1) Intake a lead as visitor
        intake = api.post(f"{BASE_URL}/api/leads/intake", json={
            "email": email,
            "goal": "Build a booking platform for yoga studios with payments and waitlists",
            "mode": "hybrid",
            "estimate": {"final_price": 7777},
        })
        assert intake.status_code == 200, intake.text
        lead_id = intake.json()["lead_id"]

        # 2) OTP send + verify (cookie session)
        sess = requests.Session()
        sess.headers.update({"Content-Type": "application/json"})
        s = sess.post(f"{BASE_URL}/api/auth/send-code", json={"email": email})
        assert s.status_code == 200
        code = s.json()["dev_code"]
        v = sess.post(f"{BASE_URL}/api/auth/verify-code",
                      json={"email": email, "code": code, "name": "Claim Tester"})
        assert v.status_code == 200, v.text
        token = v.json()["token"]
        # Attach Bearer too — cookie might not pass through Session on some runners
        sess.headers["Authorization"] = f"Bearer {token}"

        # 3) Claim
        c = sess.post(f"{BASE_URL}/api/leads/{lead_id}/claim")
        assert c.status_code == 200, c.text
        cd = c.json()
        assert cd["project_id"].startswith("proj_")
        assert cd["redirect"] == f"/workspace/{cd['project_id']}"

        # 4) Lead should now be claimed
        g = api.get(f"{BASE_URL}/api/leads/{lead_id}").json()
        assert g["state"] == "claimed"
        assert g["claimed_project_id"] == cd["project_id"]
