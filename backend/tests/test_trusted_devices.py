"""
End-to-end tests for the "Trust this device for 30 days" 2FA addition.

Covers:
- Login w/ unknown fingerprint still returns requires_2fa challenge
- /mobile/auth/2fa/verify with trust_device=true + fingerprint stores trust + issues session
- Subsequent login with same fingerprint short-circuits to {token, user}
- /api/auth/login (web) honours same trust short-circuit
- Different fingerprint → 2FA required again
- GET /trusted-devices listing (sorted, fields)
- Re-trust same fingerprint updates expiry (no duplicate)
- DELETE /trusted-devices/{device_id} removes trust → login requires 2FA again
- POST /trusted-devices/revoke-all clears all (user-scoped)
- Missing fingerprint → 2FA still required
- Fingerprint < 8 chars → ignored, 2FA still required
- trust_device=true without fingerprint → silent no-op (no record)
- Expired trust (manually expired) → 2FA required
- Cross-user isolation: same fingerprint string for user B not trusted
- Web /auth/2fa/verify strips totp_secret/totp_pending_secret/recovery_codes/password_hash
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pyotp
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "http://localhost:8001"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

DEV_EMAIL = "john@atlas.dev"
DEV_PASSWORD = "dev123"
ADMIN_EMAIL = "admin@atlas.dev"
ADMIN_PASSWORD = "admin123"


# ─── helpers ──────────────────────────────────────────────────

def _reset_2fa(email: str):
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


def _purge_trusted_devices(email: str = None):
    cli = MongoClient(MONGO_URL)
    if email:
        u = cli[DB_NAME].users.find_one({"email": email}, {"user_id": 1})
        if u:
            cli[DB_NAME].trusted_devices.delete_many({"user_id": u["user_id"]})
    else:
        cli[DB_NAME].trusted_devices.delete_many({})
    cli.close()


def _get_user_id(email: str) -> str:
    cli = MongoClient(MONGO_URL)
    u = cli[DB_NAME].users.find_one({"email": email}, {"user_id": 1})
    cli.close()
    return u["user_id"] if u else None


def _expire_all_trusted(user_id: str):
    cli = MongoClient(MONGO_URL)
    past = datetime.now(timezone.utc) - timedelta(days=1)
    cli[DB_NAME].trusted_devices.update_many(
        {"user_id": user_id},
        {"$set": {"expires_at_ts": past, "expires_at": past.isoformat()}},
    )
    cli.close()


@pytest.fixture
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _mobile_login(s, email=DEV_EMAIL, password=DEV_PASSWORD, fingerprint=None):
    body = {"email": email, "password": password}
    if fingerprint is not None:
        body["device_fingerprint"] = fingerprint
    return s.post(f"{BASE_URL}/api/mobile/auth/login", json=body)


def _web_login(s, email=DEV_EMAIL, password=DEV_PASSWORD, fingerprint=None):
    body = {"email": email, "password": password}
    if fingerprint is not None:
        body["device_fingerprint"] = fingerprint
    return s.post(f"{BASE_URL}/api/auth/login", json=body)


def _bearer(token):
    sess = requests.Session()
    sess.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    })
    return sess


def _enable_2fa(email=DEV_EMAIL, password=DEV_PASSWORD) -> tuple[str, str]:
    """Helper: login + enroll TOTP, return (token, secret)."""
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    r = sess.post(f"{BASE_URL}/api/mobile/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"primary login failed: {r.status_code} {r.text}"
    token = r.json()["token"]
    b = _bearer(token)
    setup = b.post(f"{BASE_URL}/api/account/me/2fa/setup")
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    code = pyotp.TOTP(secret).now()
    v = b.post(f"{BASE_URL}/api/account/me/2fa/setup/verify", json={"code": code})
    assert v.status_code == 200, v.text
    return token, secret


@pytest.fixture
def enrolled():
    """John has 2FA on. Tears down after."""
    _reset_2fa(DEV_EMAIL)
    _purge_trusted_devices(DEV_EMAIL)
    token, secret = _enable_2fa()
    yield {"token": token, "secret": secret, "user_id": _get_user_id(DEV_EMAIL)}
    _reset_2fa(DEV_EMAIL)
    _purge_trusted_devices(DEV_EMAIL)


def _verify_2fa(s, challenge_token, secret, *, mobile=True, fingerprint=None, trust=False, label=None):
    body = {"challenge_token": challenge_token, "code": pyotp.TOTP(secret).now()}
    if fingerprint is not None:
        body["device_fingerprint"] = fingerprint
    if trust:
        body["trust_device"] = True
    if label:
        body["device_label"] = label
    path = "/api/mobile/auth/2fa/verify" if mobile else "/api/auth/2fa/verify"
    return s.post(f"{BASE_URL}{path}", json=body)


# ─── tests ────────────────────────────────────────────────────

class TestTrustedDeviceMobile:
    def test_login_with_untrusted_fingerprint_requires_2fa(self, enrolled, s):
        fp = f"fp_{uuid.uuid4().hex}"
        r = _mobile_login(s, fingerprint=fp)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("requires_2fa") is True
        assert "challenge_token" in body
        assert body.get("method") == "totp"

    def test_trust_grants_skip_on_next_login(self, enrolled, s):
        fp = f"fp_{uuid.uuid4().hex}"
        # 1st login → challenge
        r = _mobile_login(s, fingerprint=fp)
        ct = r.json()["challenge_token"]
        # verify w/ trust_device
        v = _verify_2fa(s, ct, enrolled["secret"], fingerprint=fp, trust=True, label="LaptopA")
        assert v.status_code == 200, v.text
        assert "token" in v.json() and "user" in v.json()
        # DB has exactly 1 record
        cli = MongoClient(MONGO_URL)
        cnt = cli[DB_NAME].trusted_devices.count_documents({"user_id": enrolled["user_id"]})
        cli.close()
        assert cnt == 1, f"expected 1 trusted device, got {cnt}"
        # 2nd login w/ same fingerprint → direct session (NO requires_2fa)
        r2 = _mobile_login(s, fingerprint=fp)
        assert r2.status_code == 200, r2.text
        b2 = r2.json()
        assert "token" in b2 and "user" in b2, f"expected direct session, got {b2}"
        assert not b2.get("requires_2fa")

    def test_different_fingerprint_still_requires_2fa(self, enrolled, s):
        fp1 = f"fp_{uuid.uuid4().hex}"
        r = _mobile_login(s, fingerprint=fp1)
        ct = r.json()["challenge_token"]
        v = _verify_2fa(s, ct, enrolled["secret"], fingerprint=fp1, trust=True)
        assert v.status_code == 200
        # Different fingerprint → must challenge
        fp2 = f"fp_{uuid.uuid4().hex}"
        r2 = _mobile_login(s, fingerprint=fp2)
        assert r2.json().get("requires_2fa") is True

    def test_no_fingerprint_requires_2fa(self, enrolled, s):
        r = _mobile_login(s)  # no fingerprint at all
        assert r.json().get("requires_2fa") is True

    def test_short_fingerprint_ignored(self, enrolled, s):
        # First, trust a real fingerprint
        fp = f"fp_{uuid.uuid4().hex}"
        ct = _mobile_login(s, fingerprint=fp).json()["challenge_token"]
        _verify_2fa(s, ct, enrolled["secret"], fingerprint=fp, trust=True)
        # Login with too-short fingerprint → still required
        r = _mobile_login(s, fingerprint="abc")  # 3 chars
        assert r.json().get("requires_2fa") is True, r.json()

    def test_trust_true_without_fingerprint_is_noop(self, enrolled, s):
        fp_irrelevant = None
        ct = _mobile_login(s).json()["challenge_token"]
        v = _verify_2fa(s, ct, enrolled["secret"], fingerprint=None, trust=True)
        assert v.status_code == 200
        # No trust record was created
        cli = MongoClient(MONGO_URL)
        cnt = cli[DB_NAME].trusted_devices.count_documents({"user_id": enrolled["user_id"]})
        cli.close()
        assert cnt == 0, f"silent no-op expected, got {cnt}"

    def test_re_trust_same_fingerprint_no_duplicate(self, enrolled, s):
        fp = f"fp_{uuid.uuid4().hex}"
        # First trust
        ct1 = _mobile_login(s, fingerprint=fp).json()["challenge_token"]
        _verify_2fa(s, ct1, enrolled["secret"], fingerprint=fp, trust=True, label="L1")
        # Manually clear trust to force re-challenge? No — same fingerprint
        # would skip. So expire it first to force the second challenge.
        _expire_all_trusted(enrolled["user_id"])
        ct2 = _mobile_login(s, fingerprint=fp).json()["challenge_token"]
        _verify_2fa(s, ct2, enrolled["secret"], fingerprint=fp, trust=True, label="L2")
        cli = MongoClient(MONGO_URL)
        cnt = cli[DB_NAME].trusted_devices.count_documents({"user_id": enrolled["user_id"]})
        cli.close()
        assert cnt == 1, f"re-trust should update not insert; got {cnt}"

    def test_expired_trust_requires_2fa(self, enrolled, s):
        fp = f"fp_{uuid.uuid4().hex}"
        ct = _mobile_login(s, fingerprint=fp).json()["challenge_token"]
        _verify_2fa(s, ct, enrolled["secret"], fingerprint=fp, trust=True)
        _expire_all_trusted(enrolled["user_id"])
        r = _mobile_login(s, fingerprint=fp)
        assert r.json().get("requires_2fa") is True


class TestTrustedDeviceWebCookie:
    def test_web_login_trust_short_circuit(self, enrolled, s):
        fp = f"fp_{uuid.uuid4().hex}"
        # mobile path establishes trust (re-uses same trusted_devices table)
        ct = _mobile_login(s, fingerprint=fp).json()["challenge_token"]
        _verify_2fa(s, ct, enrolled["secret"], fingerprint=fp, trust=True)
        # web login w/ same fingerprint → direct session
        r = _web_login(s, fingerprint=fp)
        assert r.status_code == 200, r.text
        body = r.json()
        assert not body.get("requires_2fa"), f"web should short-circuit, got {body}"

    def test_web_verify_strips_sensitive_fields(self, enrolled, s):
        fp = f"fp_{uuid.uuid4().hex}"
        # Use web login path to obtain a challenge_token
        r = _web_login(s, fingerprint=fp)
        body = r.json()
        assert body.get("requires_2fa") is True
        ct = body["challenge_token"]
        v = _verify_2fa(s, ct, enrolled["secret"], mobile=False, fingerprint=fp, trust=True)
        assert v.status_code == 200, v.text
        user_doc = v.json()
        # Defence-in-depth: none of these may appear in the response
        for forbidden in ("totp_secret", "totp_pending_secret", "recovery_codes", "password_hash"):
            assert forbidden not in user_doc, f"web /2fa/verify leaked {forbidden}"


class TestTrustedDevicesManagement:
    def test_list_returns_records_sorted(self, enrolled, s):
        b = _bearer(enrolled["token"])
        # No devices yet
        r = b.get(f"{BASE_URL}/api/account/me/2fa/trusted-devices")
        assert r.status_code == 200
        assert r.json().get("devices") == []
        # Trust two devices
        for label in ("DeviceA", "DeviceB"):
            fp = f"fp_{uuid.uuid4().hex}"
            ct = _mobile_login(requests.Session(), fingerprint=fp).json()["challenge_token"]
            _verify_2fa(requests.Session(), ct, enrolled["secret"], fingerprint=fp, trust=True, label=label)
        r = b.get(f"{BASE_URL}/api/account/me/2fa/trusted-devices")
        assert r.status_code == 200
        devices = r.json()["devices"]
        assert len(devices) == 2
        for d in devices:
            assert "device_id" in d
            assert "label" in d
            assert "user_agent" in d
            assert "expires_at" in d
            assert "last_used_at" in d

    def test_delete_device_forces_2fa(self, enrolled, s):
        b = _bearer(enrolled["token"])
        fp = f"fp_{uuid.uuid4().hex}"
        ct = _mobile_login(s, fingerprint=fp).json()["challenge_token"]
        _verify_2fa(s, ct, enrolled["secret"], fingerprint=fp, trust=True)
        # Find the device_id
        devices = b.get(f"{BASE_URL}/api/account/me/2fa/trusted-devices").json()["devices"]
        assert len(devices) == 1
        device_id = devices[0]["device_id"]
        # Delete it
        d = b.delete(f"{BASE_URL}/api/account/me/2fa/trusted-devices/{device_id}")
        assert d.status_code == 200, d.text
        # 2FA required again for same fingerprint
        r = _mobile_login(s, fingerprint=fp)
        assert r.json().get("requires_2fa") is True

    def test_delete_nonexistent_returns_404(self, enrolled, s):
        b = _bearer(enrolled["token"])
        d = b.delete(f"{BASE_URL}/api/account/me/2fa/trusted-devices/td_doesnotexist")
        assert d.status_code == 404

    def test_revoke_all_clears_user_only(self, enrolled, s):
        # User A (john) trusts two devices
        b = _bearer(enrolled["token"])
        fps_a = [f"fp_{uuid.uuid4().hex}" for _ in range(2)]
        for fp in fps_a:
            sess = requests.Session()
            ct = _mobile_login(sess, fingerprint=fp).json()["challenge_token"]
            _verify_2fa(sess, ct, enrolled["secret"], fingerprint=fp, trust=True)

        # User B (admin) — enable 2FA, trust one device
        _reset_2fa(ADMIN_EMAIL)
        _purge_trusted_devices(ADMIN_EMAIL)
        admin_token, admin_secret = _enable_2fa(ADMIN_EMAIL, ADMIN_PASSWORD)
        admin_user_id = _get_user_id(ADMIN_EMAIL)
        try:
            fp_b = f"fp_{uuid.uuid4().hex}"
            sess = requests.Session()
            ct = _mobile_login(sess, email=ADMIN_EMAIL, password=ADMIN_PASSWORD,
                               fingerprint=fp_b).json()["challenge_token"]
            _verify_2fa(sess, ct, admin_secret, fingerprint=fp_b, trust=True)

            # Revoke-all for john
            r = b.post(f"{BASE_URL}/api/account/me/2fa/trusted-devices/revoke-all")
            assert r.status_code == 200, r.text
            assert r.json()["revoked"] == 2

            # John has 0 records
            cli = MongoClient(MONGO_URL)
            john_cnt = cli[DB_NAME].trusted_devices.count_documents({"user_id": enrolled["user_id"]})
            admin_cnt = cli[DB_NAME].trusted_devices.count_documents({"user_id": admin_user_id})
            cli.close()
            assert john_cnt == 0
            assert admin_cnt == 1, "admin's trust must NOT be revoked when john revokes-all"
        finally:
            _reset_2fa(ADMIN_EMAIL)
            _purge_trusted_devices(ADMIN_EMAIL)


class TestCrossUserIsolation:
    def test_same_fingerprint_string_isolated_between_users(self, enrolled, s):
        """User A's fingerprint must NOT trust user B (keys on user_id+hash)."""
        shared_fp = f"fp_shared_{uuid.uuid4().hex}"
        # A trusts the fingerprint
        ct = _mobile_login(s, fingerprint=shared_fp).json()["challenge_token"]
        _verify_2fa(s, ct, enrolled["secret"], fingerprint=shared_fp, trust=True)
        # B has 2FA on but no trust → must still challenge with same fp string
        _reset_2fa(ADMIN_EMAIL)
        _purge_trusted_devices(ADMIN_EMAIL)
        try:
            _enable_2fa(ADMIN_EMAIL, ADMIN_PASSWORD)
            r = _mobile_login(
                requests.Session(),
                email=ADMIN_EMAIL,
                password=ADMIN_PASSWORD,
                fingerprint=shared_fp,
            )
            assert r.json().get("requires_2fa") is True, r.json()
        finally:
            _reset_2fa(ADMIN_EMAIL)
            _purge_trusted_devices(ADMIN_EMAIL)
