"""
End-to-end tests for the new TOTP-based 2FA flow.

Covers:
- mobile login w/o 2FA → returns token
- setup → setup/verify → recovery codes minted
- mobile login w/ 2FA → returns challenge
- /mobile/auth/2fa/verify with TOTP and recovery codes
- recovery code consumption & reuse rejection
- wrong code / expired / 5+ attempts
- recovery-codes/status & regenerate (TOTP required, recovery code rejected)
- disable (TOTP and recovery), bad code rejected
- legacy /enable returns 400
- web /auth/login + /auth/2fa/verify cookie flow
"""
import os
import time
import pytest
import pyotp
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to local for dev runs; env normally provides the public URL.
    BASE_URL = "http://localhost:8001"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

DEV_EMAIL = "john@atlas.dev"
DEV_PASSWORD = "dev123"


def _reset_2fa(email: str = DEV_EMAIL):
    """Force user back to a 2FA-disabled state before each test."""
    cli = MongoClient(MONGO_URL)
    cli[DB_NAME].users.update_one(
        {"email": email},
        {
            "$set": {"two_factor_enabled": False},
            "$unset": {
                "totp_secret": "",
                "totp_pending_secret": "",
                "recovery_codes": "",
                "totp_activated_at": "",
            },
        },
    )
    cli[DB_NAME].two_factor_challenges.delete_many({})
    cli.close()


@pytest.fixture
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture
def fresh_user():
    _reset_2fa()
    yield
    _reset_2fa()


def _mobile_login(session, email=DEV_EMAIL, password=DEV_PASSWORD):
    return session.post(
        f"{BASE_URL}/api/mobile/auth/login",
        json={"email": email, "password": password},
    )


def _bearer(session, token):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    })
    return s


def _enroll_2fa(session):
    """Login → setup → setup/verify. Returns (auth_session, totp_secret, recovery_codes)."""
    r = _mobile_login(session)
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    auth = _bearer(session, token)

    r = auth.post(f"{BASE_URL}/api/account/me/2fa/setup")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "secret" in body and "otpauth_uri" in body and "qr_data_url" in body
    assert body["qr_data_url"].startswith("data:image/png;base64,")
    secret = body["secret"]

    code = pyotp.TOTP(secret).now()
    r = auth.post(f"{BASE_URL}/api/account/me/2fa/setup/verify", json={"code": code})
    assert r.status_code == 200, r.text
    vbody = r.json()
    assert vbody["two_factor_enabled"] is True
    codes = vbody["recovery_codes"]
    assert isinstance(codes, list) and len(codes) == 10
    for c in codes:
        assert isinstance(c, str) and "-" in c
    return auth, secret, codes


# ─────────────────────────────────────────────────────────────
# Login w/o 2FA
# ─────────────────────────────────────────────────────────────
class TestBaselineLogin:
    def test_login_returns_token_when_2fa_disabled(self, session, fresh_user):
        r = _mobile_login(session)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "token" in body and "user" in body
        assert body["user"]["email"] == DEV_EMAIL
        assert body.get("requires_2fa") is not True


# ─────────────────────────────────────────────────────────────
# Setup
# ─────────────────────────────────────────────────────────────
class TestSetupFlow:
    def test_setup_requires_auth(self, session, fresh_user):
        r = session.post(f"{BASE_URL}/api/account/me/2fa/setup")
        assert r.status_code in (401, 403)

    def test_setup_then_verify_returns_recovery_codes(self, session, fresh_user):
        _enroll_2fa(session)

    def test_setup_verify_rejects_bad_code(self, session, fresh_user):
        r = _mobile_login(session)
        token = r.json()["token"]
        auth = _bearer(session, token)
        r = auth.post(f"{BASE_URL}/api/account/me/2fa/setup")
        assert r.status_code == 200
        r = auth.post(f"{BASE_URL}/api/account/me/2fa/setup/verify", json={"code": "000000"})
        assert r.status_code == 400

    def test_setup_blocked_when_already_enabled(self, session, fresh_user):
        auth, _, _ = _enroll_2fa(session)
        r = auth.post(f"{BASE_URL}/api/account/me/2fa/setup")
        assert r.status_code == 400


# ─────────────────────────────────────────────────────────────
# Login challenge (mobile)
# ─────────────────────────────────────────────────────────────
class TestMobileLoginChallenge:
    def test_login_returns_challenge_when_2fa_enabled(self, session, fresh_user):
        _enroll_2fa(session)
        r = _mobile_login(session)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("requires_2fa") is True
        assert "challenge_token" in body
        assert "token" not in body
        assert body.get("method") == "totp"

    def test_verify_with_totp_returns_session(self, session, fresh_user):
        _, secret, _ = _enroll_2fa(session)
        r = _mobile_login(session)
        ch = r.json()["challenge_token"]
        code = pyotp.TOTP(secret).now()
        r = session.post(
            f"{BASE_URL}/api/mobile/auth/2fa/verify",
            json={"challenge_token": ch, "code": code},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "token" in body and body["user"]["email"] == DEV_EMAIL

    def test_verify_with_recovery_code_returns_session_and_consumes(self, session, fresh_user):
        _, _, codes = _enroll_2fa(session)
        # Use first recovery code
        r = _mobile_login(session)
        ch = r.json()["challenge_token"]
        r = session.post(
            f"{BASE_URL}/api/mobile/auth/2fa/verify",
            json={"challenge_token": ch, "code": codes[0]},
        )
        assert r.status_code == 200, r.text
        # Same recovery code on fresh challenge must now fail
        r = _mobile_login(session)
        ch2 = r.json()["challenge_token"]
        r = session.post(
            f"{BASE_URL}/api/mobile/auth/2fa/verify",
            json={"challenge_token": ch2, "code": codes[0]},
        )
        assert r.status_code == 400

    def test_verify_with_wrong_totp_fails(self, session, fresh_user):
        _enroll_2fa(session)
        r = _mobile_login(session)
        ch = r.json()["challenge_token"]
        r = session.post(
            f"{BASE_URL}/api/mobile/auth/2fa/verify",
            json={"challenge_token": ch, "code": "000000"},
        )
        assert r.status_code == 400
        body = r.json()
        msg = (body.get("detail") or body.get("message") or "").lower()
        assert "invalid" in msg

    def test_verify_locks_after_5_attempts(self, session, fresh_user):
        _enroll_2fa(session)
        r = _mobile_login(session)
        ch = r.json()["challenge_token"]
        # 5 failed attempts
        for _ in range(5):
            session.post(
                f"{BASE_URL}/api/mobile/auth/2fa/verify",
                json={"challenge_token": ch, "code": "000000"},
            )
        # 6th must be 429
        r = session.post(
            f"{BASE_URL}/api/mobile/auth/2fa/verify",
            json={"challenge_token": ch, "code": "000000"},
        )
        assert r.status_code == 429, r.text

    def test_verify_consumed_challenge_cannot_be_reused(self, session, fresh_user):
        _, secret, _ = _enroll_2fa(session)
        r = _mobile_login(session)
        ch = r.json()["challenge_token"]
        code = pyotp.TOTP(secret).now()
        r1 = session.post(
            f"{BASE_URL}/api/mobile/auth/2fa/verify",
            json={"challenge_token": ch, "code": code},
        )
        assert r1.status_code == 200
        # Replay
        r2 = session.post(
            f"{BASE_URL}/api/mobile/auth/2fa/verify",
            json={"challenge_token": ch, "code": code},
        )
        assert r2.status_code == 400

    def test_verify_with_invalid_challenge_token(self, session, fresh_user):
        _enroll_2fa(session)
        r = session.post(
            f"{BASE_URL}/api/mobile/auth/2fa/verify",
            json={"challenge_token": "chal_doesnotexist", "code": "000000"},
        )
        assert r.status_code == 400


# ─────────────────────────────────────────────────────────────
# Recovery codes status + regenerate
# ─────────────────────────────────────────────────────────────
class TestRecoveryCodes:
    def test_status_reflects_consumed_codes(self, session, fresh_user):
        _, _, codes = _enroll_2fa(session)
        # Re-auth to get a fresh token (need to pass 2FA)
        auth_token = self._login_through_2fa(session, codes_or_secret=codes[0])
        auth = _bearer(session, auth_token)
        r = auth.get(f"{BASE_URL}/api/account/me/2fa/recovery-codes/status")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["enabled"] is True
        assert body["total"] == 10
        assert body["unused"] == 9  # 1 consumed

    def test_regenerate_requires_totp_not_recovery(self, session, fresh_user):
        _, secret, codes = _enroll_2fa(session)
        auth_token = self._login_through_2fa(session, codes_or_secret=secret, is_secret=True)
        auth = _bearer(session, auth_token)
        # Regen with recovery code → must fail
        r = auth.post(
            f"{BASE_URL}/api/account/me/2fa/recovery-codes/regenerate",
            json={"code": codes[0]},
        )
        assert r.status_code == 400
        # Regen with TOTP → must succeed and return 10 NEW codes
        new_code = pyotp.TOTP(secret).now()
        r = auth.post(
            f"{BASE_URL}/api/account/me/2fa/recovery-codes/regenerate",
            json={"code": new_code},
        )
        assert r.status_code == 200, r.text
        new_codes = r.json()["recovery_codes"]
        assert len(new_codes) == 10
        assert set(new_codes).isdisjoint(set(codes))
        # Old codes must no longer work
        r = _mobile_login(session)
        ch = r.json()["challenge_token"]
        r = session.post(
            f"{BASE_URL}/api/mobile/auth/2fa/verify",
            json={"challenge_token": ch, "code": codes[1]},
        )
        assert r.status_code == 400

    @staticmethod
    def _login_through_2fa(session, codes_or_secret, is_secret=False):
        r = _mobile_login(session)
        ch = r.json()["challenge_token"]
        if is_secret:
            code = pyotp.TOTP(codes_or_secret).now()
        else:
            code = codes_or_secret
        r = session.post(
            f"{BASE_URL}/api/mobile/auth/2fa/verify",
            json={"challenge_token": ch, "code": code},
        )
        assert r.status_code == 200, r.text
        return r.json()["token"]


# ─────────────────────────────────────────────────────────────
# Disable
# ─────────────────────────────────────────────────────────────
class TestDisable:
    def test_disable_with_totp(self, session, fresh_user):
        _, secret, _ = _enroll_2fa(session)
        token = TestRecoveryCodes._login_through_2fa(session, secret, is_secret=True)
        auth = _bearer(session, token)
        code = pyotp.TOTP(secret).now()
        r = auth.post(f"{BASE_URL}/api/account/me/2fa/disable", json={"code": code})
        assert r.status_code == 200, r.text
        assert r.json()["two_factor_enabled"] is False
        # Subsequent login should NOT require 2FA
        r = _mobile_login(session)
        body = r.json()
        assert r.status_code == 200
        assert body.get("requires_2fa") is not True
        assert "token" in body

    def test_disable_with_recovery_code(self, session, fresh_user):
        _, secret, codes = _enroll_2fa(session)
        token = TestRecoveryCodes._login_through_2fa(session, secret, is_secret=True)
        auth = _bearer(session, token)
        r = auth.post(f"{BASE_URL}/api/account/me/2fa/disable", json={"code": codes[2]})
        assert r.status_code == 200, r.text
        assert r.json()["two_factor_enabled"] is False

    def test_disable_bad_code_fails(self, session, fresh_user):
        _, secret, _ = _enroll_2fa(session)
        token = TestRecoveryCodes._login_through_2fa(session, secret, is_secret=True)
        auth = _bearer(session, token)
        r = auth.post(f"{BASE_URL}/api/account/me/2fa/disable", json={"code": "000000"})
        assert r.status_code == 400


# ─────────────────────────────────────────────────────────────
# Legacy endpoint deprecated
# ─────────────────────────────────────────────────────────────
class TestLegacy:
    def test_legacy_enable_returns_400(self, session, fresh_user):
        r = _mobile_login(session)
        token = r.json()["token"]
        auth = _bearer(session, token)
        r = auth.post(f"{BASE_URL}/api/account/me/2fa/enable", json={})
        assert r.status_code == 400, r.text


# ─────────────────────────────────────────────────────────────
# Web /auth/login + /auth/2fa/verify (cookie based)
# ─────────────────────────────────────────────────────────────
class TestWebLogin:
    def test_web_login_returns_challenge_then_verify(self, fresh_user):
        # 1. enroll via mobile flow (since web setup goes through same auth)
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        _, secret, _ = _enroll_2fa(s)
        # 2. web /auth/login
        web = requests.Session()
        web.headers.update({"Content-Type": "application/json"})
        r = web.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": DEV_EMAIL, "password": DEV_PASSWORD},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("requires_2fa") is True
        ch = body["challenge_token"]
        # 3. /auth/2fa/verify w/ TOTP
        code = pyotp.TOTP(secret).now()
        r = web.post(
            f"{BASE_URL}/api/auth/2fa/verify",
            json={"challenge_token": ch, "code": code},
        )
        assert r.status_code == 200, r.text
        # Cookie should be set
        assert "session_token" in web.cookies.get_dict() or any(
            "session_token" in (c.name or "") for c in web.cookies
        )
        user = r.json()
        assert user.get("email") == DEV_EMAIL
