#!/usr/bin/env python3
"""
Stage 3.2.5 — Parity Probes

For each surface where canonical was created or aligned, this probe
calls BOTH the legacy alias and the canonical endpoint with the same
auth, then asserts:

  1. Both respond 200.
  2. Canonical response shape ⊇ legacy shape (no missing legacy fields).
  3. Field values match where they should match exactly.
  4. Legacy carries `x-compat-route` + `x-canonical-path` headers.
  5. Canonical carries NO `x-compat-route` header.
  6. Both carry `x-request-id`.

Run:  python3 audit/parity/parity_probe.py
"""
import json
import sys
import urllib.parse
from typing import Any
import requests

BASE = "http://localhost:8001"
SESS_DEV = requests.Session()
SESS_CLIENT = requests.Session()


def login(session: requests.Session, email: str, pw: str) -> bool:
    r = session.post(
        f"{BASE}/api/auth/login",
        json={"email": email, "password": pw},
    )
    if r.status_code != 200:
        return False
    # Cookie is `Secure` + `SameSite=none`, requests on http won't auto-store
    # it. Extract from Set-Cookie header and inject manually for subsequent
    # calls in this session.
    set_cookie = r.headers.get("set-cookie", "")
    for piece in set_cookie.split(";"):
        piece = piece.strip()
        if piece.startswith("session_token="):
            token = piece.split("=", 1)[1]
            session.cookies.set("session_token", token)
            return True
    return False


def hdr(r: requests.Response, name: str) -> str:
    return r.headers.get(name, "")


def fail(msg: str) -> None:
    print(f"  FAIL: {msg}")


def ok(msg: str) -> None:
    print(f"  OK:   {msg}")


def shape_keys(d: Any) -> set:
    if isinstance(d, dict):
        return set(d.keys())
    return set()


def probe_marketplace_feed_vs_modules() -> bool:
    """A1 — /marketplace/feed vs /marketplace/modules"""
    print("\n[A1] /marketplace/feed (legacy)  vs  /marketplace/modules (canonical)")
    leg = SESS_DEV.get(f"{BASE}/api/marketplace/feed")
    can = SESS_DEV.get(f"{BASE}/api/marketplace/modules?status=open,open_for_bids")

    all_ok = True
    if leg.status_code != 200:
        fail(f"legacy status={leg.status_code}"); all_ok = False
    else:
        ok(f"legacy 200")
    if can.status_code != 200:
        fail(f"canonical status={can.status_code}"); all_ok = False
    else:
        ok(f"canonical 200")

    if not all_ok:
        return False

    leg_j, can_j = leg.json(), can.json()
    leg_keys = shape_keys(leg_j)
    can_keys = shape_keys(can_j)

    # Canonical must have all legacy top-level keys
    missing = leg_keys - can_keys
    if missing:
        fail(f"canonical missing legacy keys: {missing}"); all_ok = False
    else:
        ok(f"top-level keys ⊇: {sorted(leg_keys)}")

    # Each module must have bid_count + already_bid + project_id
    for src, j in [("legacy", leg_j), ("canonical", can_j)]:
        mods = j.get("modules", [])
        if mods:
            m0 = mods[0]
            for needed in ("bid_count", "already_bid", "module_id", "title", "price"):
                if needed not in m0:
                    fail(f"{src}.modules[0] missing '{needed}'"); all_ok = False
                else:
                    ok(f"{src}.modules[0].{needed} present")
        else:
            ok(f"{src}.modules is empty (data state, not parity issue)")

    # Capacity must exist
    if "capacity" not in can_j:
        fail("canonical missing 'capacity' field"); all_ok = False
    else:
        ok(f"canonical.capacity = {can_j.get('capacity')}")

    # Header parity
    if hdr(leg, "x-compat-route") != "true":
        fail("legacy missing x-compat-route header"); all_ok = False
    else:
        ok(f"legacy x-compat-route=true, x-canonical-path={hdr(leg, 'x-canonical-path')}")
    if hdr(can, "x-compat-route"):
        fail(f"canonical wrongly carries x-compat-route={hdr(can, 'x-compat-route')}"); all_ok = False
    else:
        ok("canonical does NOT carry x-compat-route (correct)")
    if not hdr(leg, "x-request-id") or not hdr(can, "x-request-id"):
        fail("missing x-request-id"); all_ok = False
    else:
        ok("both carry x-request-id")

    return all_ok


def probe_developer_rank() -> bool:
    """A2 — /developer/rank vs /developer/intelligence/rank"""
    print("\n[A2] /developer/rank (legacy)  vs  /developer/intelligence/rank (canonical)")
    leg = SESS_DEV.get(f"{BASE}/api/developer/rank")
    can = SESS_DEV.get(f"{BASE}/api/developer/intelligence/rank")

    all_ok = True
    if leg.status_code != 200 or can.status_code != 200:
        fail(f"legacy={leg.status_code}, canonical={can.status_code}")
        return False
    ok("both 200")

    leg_j, can_j = leg.json(), can.json()

    # Byte-identical (same shared helper produces both)
    if leg_j != can_j:
        fail("legacy != canonical body — should be byte-identical")
        print(f"    legacy: {json.dumps(leg_j, sort_keys=True)[:200]}")
        print(f"    canon:  {json.dumps(can_j, sort_keys=True)[:200]}")
        all_ok = False
    else:
        ok(f"bodies byte-identical: rank={leg_j.get('rank')}, total_devs={leg_j.get('total_devs')}")

    # Required shape fields
    for k in ("rank", "total_devs", "stats", "milestones"):
        if k not in leg_j:
            fail(f"legacy missing '{k}'"); all_ok = False
        if k not in can_j:
            fail(f"canonical missing '{k}'"); all_ok = False
    for k in ("win_rate", "qa_rate", "total_earned", "completed"):
        if k not in (leg_j.get("stats") or {}):
            fail(f"legacy.stats missing '{k}'"); all_ok = False

    # Headers
    if hdr(leg, "x-compat-route") != "true":
        fail("legacy missing x-compat-route"); all_ok = False
    else:
        ok(f"legacy → canonical={hdr(leg, 'x-canonical-path')}")
    if hdr(can, "x-compat-route"):
        fail("canonical wrongly carries x-compat-route"); all_ok = False
    else:
        ok("canonical clean (no compat headers)")

    return all_ok


def probe_client_notifications() -> bool:
    """A3 — /client/notifications IS canonical (no compat alias)"""
    print("\n[A3] /client/notifications — declared canonical (Magic Pull domain)")
    can = SESS_CLIENT.get(f"{BASE}/api/client/notifications")
    other = SESS_CLIENT.get(f"{BASE}/api/notifications/my")

    all_ok = True
    if can.status_code != 200:
        fail(f"/client/notifications status={can.status_code}"); all_ok = False
    else:
        ok("200 OK")

    if other.status_code != 200:
        fail(f"/notifications/my status={other.status_code}"); all_ok = False
    else:
        ok("/notifications/my (sibling canonical) also 200")

    # /client/notifications must NOT carry compat headers (it IS canonical now)
    if hdr(can, "x-compat-route"):
        fail(f"/client/notifications wrongly carries x-compat-route={hdr(can, 'x-compat-route')} — D2 label fix not applied?")
        all_ok = False
    else:
        ok("/client/notifications carries NO x-compat-route (canonical, not alias)")

    if not hdr(can, "x-request-id"):
        fail("missing x-request-id"); all_ok = False
    else:
        ok(f"x-request-id={hdr(can, 'x-request-id')[:16]}...")

    # Shape: {notifications: [...], count: N}
    can_j = can.json()
    for k in ("notifications", "count"):
        if k not in can_j:
            fail(f"missing '{k}'"); all_ok = False
        else:
            ok(f"shape contains '{k}'")

    return all_ok


def probe_aspirational_labels_removed() -> bool:
    """A4 — verify aspirational compat_decorator labels were removed
    from /modules/{id}/bid and /modules/{id}/assign (no real canonical exists)."""
    print("\n[A4] Aspirational labels removed from /modules/{id}/bid + /assign")
    # POST a clearly-bad body so handler 422s before any DB call. We're
    # only inspecting headers — body validation is fine.
    bid_resp = SESS_DEV.post(
        f"{BASE}/api/modules/probe-no-such-module/bid",
        json={"proposed_price": 1, "delivery_days": 1, "message": "probe"},
    )
    assign_resp = SESS_DEV.post(
        f"{BASE}/api/modules/probe-no-such-module/assign",
        json={"developer_id": "probe"},
    )

    all_ok = True
    if hdr(bid_resp, "x-canonical-path"):
        fail(f"/bid still has x-canonical-path={hdr(bid_resp, 'x-canonical-path')} — aspirational label not removed")
        all_ok = False
    else:
        ok(f"/bid no longer carries x-canonical-path (status={bid_resp.status_code})")
    if hdr(assign_resp, "x-canonical-path"):
        fail(f"/assign still has x-canonical-path={hdr(assign_resp, 'x-canonical-path')}")
        all_ok = False
    else:
        ok(f"/assign no longer carries x-canonical-path (status={assign_resp.status_code})")
    return all_ok


def main() -> int:
    print("=" * 70)
    print("Stage 3.2.5 — Canonical Parity Probes")
    print("=" * 70)

    if not login(SESS_DEV, "john@atlas.dev", "dev123"):
        print("FATAL: dev login failed")
        return 1
    if not login(SESS_CLIENT, "client@atlas.dev", "client123"):
        print("FATAL: client login failed")
        return 1
    print("Logged in: dev + client")

    results = {
        "A1 marketplace": probe_marketplace_feed_vs_modules(),
        "A2 developer/rank": probe_developer_rank(),
        "A3 client/notifications": probe_client_notifications(),
        "A4 aspirational labels": probe_aspirational_labels_removed(),
    }

    print("\n" + "=" * 70)
    print("Summary")
    print("=" * 70)
    for name, passed in results.items():
        marker = "PASS" if passed else "FAIL"
        print(f"  [{marker}] {name}")

    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
