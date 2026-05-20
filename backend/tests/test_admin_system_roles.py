"""
Backend tests for Identity Layer — Admin System roles endpoints.
Endpoints under test:
  POST /api/admin/system/roles/assign
  POST /api/admin/system/roles/remove
  GET  /api/admin/system/users
"""
import os
import pytest
import requests
from datetime import datetime

BASE_URL = os.environ.get("EXPO_BACKEND_URL",
                          "https://expo-react-stack.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

CREDS = {
    "admin":    {"email": "admin@atlas.dev",  "password": "admin123"},
    "dev":      {"email": "john@atlas.dev",   "password": "dev123"},
    "client":   {"email": "client@atlas.dev", "password": "client123"},
    "multi":    {"email": "multi@atlas.dev",  "password": "multi123"},
}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return s


# -------- fixtures --------

@pytest.fixture(scope="module")
def admin_session():
    return _login(CREDS["admin"])


@pytest.fixture(scope="module")
def dev_session():
    return _login(CREDS["dev"])


@pytest.fixture(scope="module")
def client_session():
    return _login(CREDS["client"])


# -------- GET /admin/system/users --------

class TestListUsers:
    def test_list_users_as_admin(self, admin_session):
        r = admin_session.get(f"{API}/admin/system/users", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data and "count" in data and "generated_at" in data
        assert isinstance(data["items"], list)
        assert data["count"] == len(data["items"])
        # Validate expected seed accounts present
        emails = {u.get("email") for u in data["items"]}
        for e in ("admin@atlas.dev", "john@atlas.dev", "client@atlas.dev", "multi@atlas.dev"):
            assert e in emails, f"missing seed account {e}"
        # Each row has required keys
        for row in data["items"]:
            assert "roles" in row and isinstance(row["roles"], list)
            assert "states" in row and isinstance(row["states"], list)
            assert "email" in row
            # ISO datetime
            if row.get("created_at"):
                datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))

    def test_list_users_as_developer_forbidden(self, dev_session):
        r = dev_session.get(f"{API}/admin/system/users", timeout=15)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"

    def test_list_users_as_client_forbidden(self, client_session):
        r = client_session.get(f"{API}/admin/system/users", timeout=15)
        assert r.status_code == 403

    def test_list_users_unauthenticated(self):
        r = requests.get(f"{API}/admin/system/users", timeout=15)
        assert r.status_code in (401, 403)


# -------- POST /admin/system/roles/assign --------

class TestAssignRole:
    def test_assign_tester_to_multi(self, admin_session):
        payload = {"email": "multi@atlas.dev", "role": "tester"}
        r = admin_session.post(f"{API}/admin/system/roles/assign", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["email"] == "multi@atlas.dev"
        assert body["role"] == "tester"
        assert "tester" in body["roles"]
        assert "primary_role" in body
        # GET verify
        lst = admin_session.get(f"{API}/admin/system/users", timeout=15).json()["items"]
        target = next(u for u in lst if u["email"] == "multi@atlas.dev")
        assert "tester" in target["roles"]
        assert "tester" in target["states"]

    def test_assign_idempotent(self, admin_session):
        payload = {"email": "multi@atlas.dev", "role": "tester"}
        r = admin_session.post(f"{API}/admin/system/roles/assign", json=payload, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body.get("already_had") is True
        # Ensure roles still has single 'tester' (no duplicates)
        lst = admin_session.get(f"{API}/admin/system/users", timeout=15).json()["items"]
        target = next(u for u in lst if u["email"] == "multi@atlas.dev")
        assert target["roles"].count("tester") == 1

    def test_assign_invalid_role(self, admin_session):
        r = admin_session.post(f"{API}/admin/system/roles/assign",
                                json={"email": "multi@atlas.dev", "role": "ghost"}, timeout=15)
        assert r.status_code == 400

    def test_assign_empty_email(self, admin_session):
        r = admin_session.post(f"{API}/admin/system/roles/assign",
                                json={"email": "", "role": "tester"}, timeout=15)
        assert r.status_code == 400

    def test_assign_unknown_user(self, admin_session):
        r = admin_session.post(f"{API}/admin/system/roles/assign",
                                json={"email": "ghost@atlas.dev", "role": "tester"}, timeout=15)
        assert r.status_code == 404

    def test_assign_forbidden_for_dev(self, dev_session):
        r = dev_session.post(f"{API}/admin/system/roles/assign",
                              json={"email": "multi@atlas.dev", "role": "tester"}, timeout=15)
        assert r.status_code == 403

    def test_assign_forbidden_for_client(self, client_session):
        r = client_session.post(f"{API}/admin/system/roles/assign",
                                 json={"email": "multi@atlas.dev", "role": "tester"}, timeout=15)
        assert r.status_code == 403


# -------- POST /admin/system/roles/remove --------

class TestRemoveRole:
    def test_remove_tester_from_multi(self, admin_session):
        # ensure tester present first (assign idempotent)
        admin_session.post(f"{API}/admin/system/roles/assign",
                            json={"email": "multi@atlas.dev", "role": "tester"}, timeout=15)
        r = admin_session.post(f"{API}/admin/system/roles/remove",
                                json={"email": "multi@atlas.dev", "role": "tester"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert "tester" not in body["roles"]
        # GET verify persistence
        lst = admin_session.get(f"{API}/admin/system/users", timeout=15).json()["items"]
        target = next(u for u in lst if u["email"] == "multi@atlas.dev")
        assert "tester" not in target["roles"]
        assert "tester" not in target["states"]

    def test_remove_idempotent(self, admin_session):
        r = admin_session.post(f"{API}/admin/system/roles/remove",
                                json={"email": "multi@atlas.dev", "role": "tester"}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body.get("already_gone") is True

    def test_remove_invalid_role(self, admin_session):
        r = admin_session.post(f"{API}/admin/system/roles/remove",
                                json={"email": "multi@atlas.dev", "role": "ghost"}, timeout=15)
        assert r.status_code == 400

    def test_remove_unknown_user(self, admin_session):
        r = admin_session.post(f"{API}/admin/system/roles/remove",
                                json={"email": "ghost@atlas.dev", "role": "tester"}, timeout=15)
        assert r.status_code == 404

    def test_remove_forbidden_for_dev(self, dev_session):
        r = dev_session.post(f"{API}/admin/system/roles/remove",
                              json={"email": "multi@atlas.dev", "role": "tester"}, timeout=15)
        assert r.status_code == 403


# -------- Safety: cannot remove last admin --------

class TestLastAdminSafety:
    def test_cannot_remove_last_admin(self, admin_session):
        """
        Ensures the safety rule triggers. We first compute current admin
        count. If there are multiple admins, we strip them down to one
        (admin@atlas.dev) then try to self-remove → 409. Finally we
        restore the previous admins so we never leave DB in broken state.
        """
        lst_before = admin_session.get(f"{API}/admin/system/users", timeout=15).json()["items"]
        admins = [u["email"] for u in lst_before if "admin" in (u.get("roles") or [])]
        # pick a canonical survivor
        survivor = "admin@atlas.dev"
        assert survivor in admins, "seed admin missing"
        others = [e for e in admins if e != survivor]

        # strip other admins so survivor is the last one
        for e in others:
            r = admin_session.post(f"{API}/admin/system/roles/remove",
                                    json={"email": e, "role": "admin"}, timeout=15)
            assert r.status_code == 200, f"stripping {e}: {r.text}"

        try:
            # now attempt to remove admin from survivor → must fail 409
            r = admin_session.post(f"{API}/admin/system/roles/remove",
                                    json={"email": survivor, "role": "admin"}, timeout=15)
            assert r.status_code == 409, f"expected 409, got {r.status_code}: {r.text}"
            detail = r.json().get("detail", "")
            assert "cannot_remove_last_admin" in detail
        finally:
            # restore admin on the others we stripped
            for e in others:
                admin_session.post(f"{API}/admin/system/roles/assign",
                                    json={"email": e, "role": "admin"}, timeout=15)


# -------- Audit trail --------

class TestAuditTrail:
    def test_audit_log_written_for_assign_remove(self, admin_session):
        """Perform assign+remove then verify db.system_actions_log was written
        with source='admin_system' (per CONTRACTS.md)."""
        # Load env and connect to mongo directly (contract: db.system_actions_log)
        from pathlib import Path
        env = {}
        for line in Path("/app/backend/.env").read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
        try:
            from pymongo import MongoClient
            mc = MongoClient(env.get("MONGO_URL") or os.environ.get("MONGO_URL"))
            db = mc[env.get("DB_NAME") or os.environ.get("DB_NAME")]
        except Exception as e:
            pytest.skip(f"cannot reach mongo for audit verification: {e}")

        # Count rows before
        before_assign = db.system_actions_log.count_documents({
            "source": "admin_system", "action": "role_assigned",
            "entity_id": "multi@atlas.dev", "role": "tester"
        })
        before_remove = db.system_actions_log.count_documents({
            "source": "admin_system", "action": "role_removed",
            "entity_id": "multi@atlas.dev", "role": "tester"
        })

        r1 = admin_session.post(f"{API}/admin/system/roles/assign",
                                 json={"email": "multi@atlas.dev", "role": "tester"}, timeout=15)
        assert r1.status_code == 200
        r2 = admin_session.post(f"{API}/admin/system/roles/remove",
                                 json={"email": "multi@atlas.dev", "role": "tester"}, timeout=15)
        assert r2.status_code == 200

        after_assign = db.system_actions_log.count_documents({
            "source": "admin_system", "action": "role_assigned",
            "entity_id": "multi@atlas.dev", "role": "tester"
        })
        after_remove = db.system_actions_log.count_documents({
            "source": "admin_system", "action": "role_removed",
            "entity_id": "multi@atlas.dev", "role": "tester"
        })
        assert after_assign == before_assign + 1, "role_assigned audit row missing"
        assert after_remove == before_remove + 1, "role_removed audit row missing"

        # Check payload shape on most recent rows
        latest_assign = db.system_actions_log.find_one({
            "source": "admin_system", "action": "role_assigned",
            "entity_id": "multi@atlas.dev", "role": "tester"
        }, sort=[("created_at", -1)])
        assert latest_assign["admin_email"] == "admin@atlas.dev"
        assert "previous_roles" in latest_assign["payload"]
        assert "new_roles" in latest_assign["payload"]
        assert "primary_role" in latest_assign["payload"]


# -------- Primary role promotion/demotion --------

class TestPrimaryRolePromotion:
    def test_promote_and_demote_primary(self, admin_session):
        """Give john@atlas.dev admin (higher than developer) → primary becomes admin.
        Remove admin → primary reverts to developer."""
        r = admin_session.post(f"{API}/admin/system/roles/assign",
                                json={"email": "john@atlas.dev", "role": "admin"}, timeout=15)
        assert r.status_code == 200
        assert r.json().get("primary_role") == "admin"
        # verify via list
        lst = admin_session.get(f"{API}/admin/system/users", timeout=15).json()["items"]
        john = next(u for u in lst if u["email"] == "john@atlas.dev")
        assert john.get("role") == "admin"

        # demote back
        r2 = admin_session.post(f"{API}/admin/system/roles/remove",
                                 json={"email": "john@atlas.dev", "role": "admin"}, timeout=15)
        assert r2.status_code == 200
        assert r2.json().get("primary_role") == "developer"
        lst2 = admin_session.get(f"{API}/admin/system/users", timeout=15).json()["items"]
        john2 = next(u for u in lst2 if u["email"] == "john@atlas.dev")
        assert john2.get("role") == "developer"
        assert "admin" not in (john2.get("roles") or [])
