"""
Stage 3.1 — Playwright baseline runner.

Captures, for each of the 4 pilots:
  - all /api/* request/response (status, request-id, compat headers)
  - all browser console errors / warnings (filtered to runtime-relevant)
  - a screenshot artefact

Strict scope:
  - DOES NOT migrate, change, or even touch app code.
  - Read-only observation. The only side effect is files in /app/audit/baseline/.

Usage:
    /opt/plugins-venv/bin/python tools/stage_3_1_baseline.py
"""
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
from playwright.async_api import async_playwright

BASE = "https://681ec133-7045-47dc-8d28-9f6ca9049c50.preview.emergentagent.com"
WEB = f"{BASE}/api/web-ui"
OUT = Path("/app/audit/baseline")
OUT.mkdir(parents=True, exist_ok=True)

ACCOUNTS = {
    "admin":     ("admin@atlas.dev",   "admin123"),
    "client":    ("client@atlas.dev",  "client123"),
    "developer": ("john@atlas.dev",    "dev123"),
}

PILOTS = [
    # name, role,        web url path,                     description
    ("p1_admin_finance",     "admin",     "/admin/earnings-control",       "Pilot #1 — admin finance / earnings"),
    ("p2_client_billing",    "client",    "/client/billing-os",            "Pilot #2 — client billing OS"),
    ("p3_developer_earnings","developer", "/developer/earnings",           "Pilot #3 — developer earnings"),
    # Pilot #4 is Expo, handled separately
]


async def http_login(email: str, password: str) -> dict:
    """Login via API; web uses cookie auth (POST /api/auth/login + withCredentials)."""
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as c:
        r = await c.post(f"{BASE}/api/auth/login", json={"email": email, "password": password})
        r.raise_for_status()
        return {"cookies": [{"name": k, "value": v, "domain": BASE.split("//")[1], "path": "/"}
                            for k, v in r.cookies.items()],
                "user": r.json()}


async def mobile_login(email: str, password: str) -> str:
    """Expo uses Bearer token from /api/mobile/auth/login."""
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.post(f"{BASE}/api/mobile/auth/login", json={"email": email, "password": password})
        r.raise_for_status()
        return r.json()["token"]


def _classify(msg: str) -> str:
    low = (msg or "").lower()
    if "compat_route_hit" in low: return "compat_hit"
    if "request_failed" in low: return "request_failed"
    if "capability_gate_blocked" in low: return "capability_blocked"
    if "react" in low and "warning" in low: return "react_warning"
    if "error" in low: return "error"
    if "warn" in low: return "warning"
    return "info"


async def run_web_pilot(playwright, name: str, role: str, path: str, desc: str) -> dict:
    email, password = ACCOUNTS[role]
    auth = await http_login(email, password)

    browser = await playwright.chromium.launch(headless=True, args=["--no-sandbox"])
    ctx = await browser.new_context(
        viewport={"width": 1440, "height": 900},
        ignore_https_errors=True,
    )
    # Inject session cookies
    cookie_objs = []
    for c in auth["cookies"]:
        cookie_objs.append({
            "name": c["name"], "value": c["value"],
            "url": BASE,  # let playwright derive domain
        })
    if cookie_objs:
        await ctx.add_cookies(cookie_objs)

    page = await ctx.new_page()

    api_calls = []
    console_msgs = []
    pageerrors = []

    def on_response(resp):
        try:
            url = resp.url
            if "/api/" not in url:
                return
            headers = resp.headers
            api_calls.append({
                "method": resp.request.method,
                "url": url.replace(BASE, ""),
                "status": resp.status,
                "request_id": headers.get("x-request-id"),
                "compat": headers.get("x-compat-route"),
                "canonical": headers.get("x-canonical-path"),
            })
        except Exception:
            pass

    def on_console(msg):
        try:
            text = msg.text
            console_msgs.append({
                "type": msg.type,
                "text": text[:400],
                "kind": _classify(text),
            })
        except Exception:
            pass

    def on_pageerror(err):
        pageerrors.append({"text": str(err)[:600]})

    page.on("response", on_response)
    page.on("console", on_console)
    page.on("pageerror", on_pageerror)

    target = f"{WEB}{path}"
    nav_status = "ok"
    try:
        await page.goto(target, wait_until="networkidle", timeout=45000)
        # Settle: wait a bit for delayed XHRs after networkidle.
        await page.wait_for_timeout(2500)
    except Exception as e:
        nav_status = f"error: {e}"

    shot_path = OUT / f"{name}.jpg"
    try:
        await page.screenshot(path=str(shot_path), quality=30, full_page=False, type="jpeg")
    except Exception:
        shot_path = None

    await browser.close()

    return {
        "pilot": name,
        "description": desc,
        "role": role,
        "url": target,
        "nav_status": nav_status,
        "api_calls": api_calls,
        "console": console_msgs,
        "pageerrors": pageerrors,
        "screenshot": str(shot_path) if shot_path else None,
    }


async def run_expo_pilot(playwright) -> dict:
    """Expo wallet smoke — loads /developer/wallet under expo router and observes
    the runtime behaviour. Auth is set in localStorage via 'atlas_token' (matches
    src/runtime-client/adapters/expo.ts tokenKey)."""
    email, password = ACCOUNTS["developer"]
    token = await mobile_login(email, password)

    browser = await playwright.chromium.launch(headless=True, args=["--no-sandbox"])
    ctx = await browser.new_context(
        viewport={"width": 412, "height": 915},  # mobile-ish viewport
        ignore_https_errors=True,
        user_agent="Mozilla/5.0 (Linux; Android 14) Mobile",
    )
    page = await ctx.new_page()

    api_calls, console_msgs, pageerrors = [], [], []

    def on_response(resp):
        try:
            url = resp.url
            if "/api/" not in url:
                return
            api_calls.append({
                "method": resp.request.method,
                "url": url.replace(BASE, ""),
                "status": resp.status,
                "request_id": resp.headers.get("x-request-id"),
                "compat": resp.headers.get("x-compat-route"),
                "canonical": resp.headers.get("x-canonical-path"),
            })
        except Exception:
            pass

    def on_console(msg):
        try:
            console_msgs.append({"type": msg.type, "text": msg.text[:400], "kind": _classify(msg.text)})
        except Exception:
            pass

    page.on("response", on_response)
    page.on("console", on_console)
    page.on("pageerror", lambda e: pageerrors.append({"text": str(e)[:600]}))

    # Inject token BEFORE loading the route, so the runtime adapter picks it up
    # (the adapter reads AsyncStorage; on web Expo Router, AsyncStorage is
    # backed by localStorage).
    await page.add_init_script(f"window.localStorage.setItem('atlas_token', {json.dumps(token)});")

    target = f"{BASE}/developer/wallet"
    nav_status = "ok"
    try:
        await page.goto(target, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(4000)
    except Exception as e:
        nav_status = f"error: {e}"

    shot = OUT / "p4_expo_wallet.jpg"
    try:
        await page.screenshot(path=str(shot), quality=30, full_page=False, type="jpeg")
    except Exception:
        shot = None

    await browser.close()
    return {
        "pilot": "p4_expo_wallet",
        "description": "Pilot #4 — Expo developer wallet (smoke)",
        "role": "developer",
        "url": target,
        "nav_status": nav_status,
        "api_calls": api_calls,
        "console": console_msgs,
        "pageerrors": pageerrors,
        "screenshot": str(shot) if shot else None,
    }


def aggregate(results: list) -> dict:
    total_api = sum(len(r["api_calls"]) for r in results)
    request_ids = set()
    compat_hits = []
    failures = []
    for r in results:
        for c in r["api_calls"]:
            if c["request_id"]:
                request_ids.add(c["request_id"])
            if c["compat"]:
                compat_hits.append({"pilot": r["pilot"], "url": c["url"], "canonical": c["canonical"]})
            if c["status"] >= 400:
                failures.append({"pilot": r["pilot"], "method": c["method"], "url": c["url"], "status": c["status"], "request_id": c["request_id"]})
    return {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "totals": {
            "pilots": len(results),
            "api_calls": total_api,
            "unique_request_ids": len(request_ids),
            "compat_hits": len(compat_hits),
            "http_failures": len(failures),
            "page_errors": sum(len(r["pageerrors"]) for r in results),
        },
        "compat_hits": compat_hits,
        "http_failures": failures,
    }


async def main():
    async with async_playwright() as p:
        results = []
        for name, role, path, desc in PILOTS:
            print(f"=== running {name} ({role}) ===", flush=True)
            try:
                r = await run_web_pilot(p, name, role, path, desc)
            except Exception as e:
                r = {"pilot": name, "description": desc, "role": role, "url": None,
                     "nav_status": f"runner_error: {e}",
                     "api_calls": [], "console": [], "pageerrors": [], "screenshot": None}
            results.append(r)
            (OUT / f"{name}.json").write_text(json.dumps(r, indent=2))

        print("=== running p4_expo_wallet (developer) ===", flush=True)
        try:
            r = await run_expo_pilot(p)
        except Exception as e:
            r = {"pilot": "p4_expo_wallet", "description": "Pilot #4 — Expo developer wallet (smoke)",
                 "role": "developer", "url": None,
                 "nav_status": f"runner_error: {e}",
                 "api_calls": [], "console": [], "pageerrors": [], "screenshot": None}
        results.append(r)
        (OUT / "p4_expo_wallet.json").write_text(json.dumps(r, indent=2))

        agg = aggregate(results)
        (OUT / "summary.json").write_text(json.dumps(agg, indent=2))

        print("\n=== SUMMARY ===")
        print(json.dumps(agg, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
