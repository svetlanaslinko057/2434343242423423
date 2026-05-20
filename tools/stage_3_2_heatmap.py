"""
Stage 3.2 — Compat Heatmap.

Walks legacy / non-migrated surfaces (web + Expo) to surface every
x-compat-route hit. Builds a heatmap by:

    legacy_path → canonical → role → page → hit_count → severity

Strict scope:
  - DOES NOT touch app code.
  - DOES NOT migrate anything.
  - Read-only navigation + observation.

Output: /app/audit/heatmap/{per-page json, summary.json, heatmap.csv}
"""
import asyncio
import csv
import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import httpx
from playwright.async_api import async_playwright

BASE = "https://681ec133-7045-47dc-8d28-9f6ca9049c50.preview.emergentagent.com"
WEB = f"{BASE}/api/web-ui"
OUT = Path("/app/audit/heatmap")
OUT.mkdir(parents=True, exist_ok=True)

ACCOUNTS = {
    "admin":     ("admin@atlas.dev",   "admin123"),
    "client":    ("client@atlas.dev",  "client123"),
    "developer": ("john@atlas.dev",    "dev123"),
}

# ── Web surfaces NOT yet migrated to runtime-client.
# Pilots that ARE migrated (skip): AdminV2Finance, ClientBillingOS, DeveloperEarnings.
WEB_SURFACES = [
    # admin (admin role)
    ("admin",     "/admin/dashboard",                "AdminDashboard"),
    ("admin",     "/admin/integrations",             "AdminIntegrationsPage"),
    ("admin",     "/admin/contracts",                "AdminContractsPage"),
    ("admin",     "/admin/templates",                "AdminTemplatesPage"),
    ("admin",     "/admin/billing",                  "AdminBillingPage"),
    ("admin",     "/admin/system",                   "AdminSystemUsers"),
    ("admin",     "/admin/inbox",                    "AdminInboxPage"),
    ("admin",     "/admin/team",                     "AdminTeamPanel"),
    ("admin",     "/admin/operator",                 "AdminOperatorPanel"),
    ("admin",     "/admin/v2/dashboard",             "AdminV2Dashboard"),
    ("admin",     "/admin/v2/workflow",              "AdminV2Workflow"),
    ("admin",     "/admin/v2/team",                  "AdminV2Team"),
    ("admin",     "/admin/v2/system",                "AdminV2System"),
    ("admin",     "/admin/v2/profile",               "AdminV2Profile"),

    # client (client role)
    ("client",    "/client/dashboard",               "ClientDashboard"),
    ("client",    "/client/workspace",               "ClientWorkspace"),
    ("client",    "/client/operator",                "ClientOperator"),
    ("client",    "/client/leaderboard",             "ClientLeaderboardPage"),
    ("client",    "/client/versions",                "ClientVersionsPage"),

    # developer (developer role)
    ("developer", "/developer/dashboard",            "DeveloperDashboard"),
    ("developer", "/developer/assignments",          "DeveloperAssignments"),
    ("developer", "/developer/time-control",         "DeveloperTimeControl"),
    ("developer", "/developer/leaderboard",          "DeveloperLeaderboard"),
    ("developer", "/developer/intel/leaderboard",    "DeveloperIntelLeaderboard"),
    ("developer", "/developer/intel/feedback",       "DeveloperIntelFeedback"),
    ("developer", "/developer/intel/growth",         "DeveloperIntelGrowth"),
]

# ── Expo screens NOT yet migrated to runtime (still on src/api.ts).
# Migrated (skip): /developer/wallet.
EXPO_SCREENS = [
    ("client",    "/client/home",         "ClientHome"),
    ("client",    "/client/billing",      "ClientBilling"),
    ("client",    "/client/activity",     "ClientActivity"),
    ("client",    "/client/account",      "ClientAccount"),
    ("client",    "/client/profile",      "ClientProfile"),
    ("client",    "/client/support",      "ClientSupport"),
    ("client",    "/client/referrals",    "ClientReferrals"),
    ("client",    "/client/control",      "ClientControl"),
    ("developer", "/developer/home",      "DeveloperHomeMobile"),
    ("developer", "/developer/market",    "DeveloperMarket"),
    ("developer", "/developer/work",      "DeveloperWork"),
    ("developer", "/developer/earnings",  "DeveloperEarningsMobile"),
    ("developer", "/developer/time-logs", "DeveloperTimeLogs"),
    ("developer", "/developer/profile",   "DeveloperProfileMobile"),
    ("admin",     "/admin/home",          "AdminHomeMobile"),
    ("admin",     "/admin/qa",            "AdminQAMobile"),
    ("admin",     "/admin/finance",       "AdminFinanceMobile"),
    ("admin",     "/admin/profile",       "AdminProfileMobile"),
    ("developer", "/inbox",               "Inbox"),
    ("developer", "/operator",            "Operator"),
    ("client",    "/documents",           "Documents"),
    ("client",    "/hub",                 "Hub"),
    ("developer", "/profile",             "ProfileGlobal"),
    ("developer", "/settings",            "Settings"),
    ("developer", "/activity",            "ActivityGlobal"),
]


async def http_login_cookie(email: str, password: str):
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as c:
        r = await c.post(f"{BASE}/api/auth/login", json={"email": email, "password": password})
        r.raise_for_status()
        return [{"name": k, "value": v, "url": BASE} for k, v in r.cookies.items()]


async def http_login_token(email: str, password: str) -> str:
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.post(f"{BASE}/api/mobile/auth/login", json={"email": email, "password": password})
        r.raise_for_status()
        return r.json()["token"]


def severity_for(canonical: str | None, hits: int) -> str:
    if not canonical: return "unknown"
    # hot: >=3 hits, real canonical (not aggregator)
    is_aggregator = canonical.startswith("aggregator:")
    if hits >= 3:
        return "hot"
    if hits >= 1:
        return "warm" if not is_aggregator else "warm_agg"
    return "cold"


async def scan_web(p, page_path: str, role: str, page_name: str, cookies: list) -> dict:
    browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
    ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, ignore_https_errors=True)
    if cookies:
        await ctx.add_cookies(cookies)
    page = await ctx.new_page()
    compat_hits = []
    api_calls = []
    failures = []

    def on_response(resp):
        try:
            url = resp.url
            if "/api/" not in url:
                return
            short = url.replace(BASE, "")
            entry = {
                "method": resp.request.method,
                "url": short,
                "status": resp.status,
                "request_id": resp.headers.get("x-request-id"),
                "compat": resp.headers.get("x-compat-route"),
                "canonical": resp.headers.get("x-canonical-path"),
            }
            api_calls.append(entry)
            if entry["compat"]:
                compat_hits.append(entry)
            if resp.status >= 400:
                failures.append(entry)
        except Exception:
            pass

    page.on("response", on_response)
    page.on("pageerror", lambda e: failures.append({"pageerror": str(e)[:300]}))

    target = f"{WEB}{page_path}"
    nav = "ok"
    try:
        await page.goto(target, wait_until="networkidle", timeout=45000)
        await page.wait_for_timeout(2500)
    except Exception as e:
        nav = f"err: {str(e)[:120]}"
    await browser.close()
    return {
        "platform": "web",
        "role": role,
        "page": page_name,
        "url": page_path,
        "nav": nav,
        "api_calls": len(api_calls),
        "compat_hits": compat_hits,
        "failures": failures,
    }


async def scan_expo(p, page_path: str, role: str, page_name: str, token: str) -> dict:
    browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
    ctx = await browser.new_context(
        viewport={"width": 412, "height": 915},
        ignore_https_errors=True,
        user_agent="Mozilla/5.0 (Linux; Android 14) Mobile",
    )
    page = await ctx.new_page()
    compat_hits = []
    api_calls = []
    failures = []

    def on_response(resp):
        try:
            url = resp.url
            if "/api/" not in url:
                return
            entry = {
                "method": resp.request.method,
                "url": url.split("emergentagent.com", 1)[-1] if "emergentagent.com" in url else url,
                "status": resp.status,
                "request_id": resp.headers.get("x-request-id"),
                "compat": resp.headers.get("x-compat-route"),
                "canonical": resp.headers.get("x-canonical-path"),
            }
            api_calls.append(entry)
            if entry["compat"]:
                compat_hits.append(entry)
            if resp.status >= 400:
                failures.append(entry)
        except Exception:
            pass

    page.on("response", on_response)
    page.on("pageerror", lambda e: failures.append({"pageerror": str(e)[:300]}))

    await page.add_init_script(f"window.localStorage.setItem('atlas_token', {json.dumps(token)});")
    target = f"{BASE}{page_path}"
    nav = "ok"
    try:
        await page.goto(target, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(3500)
    except Exception as e:
        nav = f"err: {str(e)[:120]}"
    await browser.close()
    return {
        "platform": "expo",
        "role": role,
        "page": page_name,
        "url": page_path,
        "nav": nav,
        "api_calls": len(api_calls),
        "compat_hits": compat_hits,
        "failures": failures,
    }


async def main():
    # Pre-login per role to reuse cookies/tokens
    cookies_per_role, token_per_role = {}, {}
    for role, (email, pw) in ACCOUNTS.items():
        try:
            cookies_per_role[role] = await http_login_cookie(email, pw)
        except Exception as e:
            cookies_per_role[role] = []
            print(f"WARN: cookie login failed for {role}: {e}")
        try:
            token_per_role[role] = await http_login_token(email, pw)
        except Exception as e:
            token_per_role[role] = ""
            print(f"WARN: token login failed for {role}: {e}")

    results = []
    async with async_playwright() as p:
        # Web pass
        for role, path, name in WEB_SURFACES:
            print(f"[web] {role} {name} {path}", flush=True)
            try:
                r = await scan_web(p, path, role, name, cookies_per_role.get(role, []))
            except Exception as e:
                r = {"platform": "web", "role": role, "page": name, "url": path,
                     "nav": f"runner_err: {e}", "api_calls": 0,
                     "compat_hits": [], "failures": []}
            results.append(r)

        # Expo pass
        for role, path, name in EXPO_SCREENS:
            print(f"[expo] {role} {name} {path}", flush=True)
            try:
                r = await scan_expo(p, path, role, name, token_per_role.get(role, ""))
            except Exception as e:
                r = {"platform": "expo", "role": role, "page": name, "url": path,
                     "nav": f"runner_err: {e}", "api_calls": 0,
                     "compat_hits": [], "failures": []}
            results.append(r)

    (OUT / "raw_per_page.json").write_text(json.dumps(results, indent=2))

    # Aggregate by (legacy_path, canonical)
    bucket = defaultdict(lambda: {
        "legacy": None, "canonical": None, "hits": 0,
        "by_role": defaultdict(int), "by_platform": defaultdict(int),
        "pages": set(), "request_ids": set(),
    })
    for r in results:
        for h in r["compat_hits"]:
            # Strip query string for the bucket key
            legacy = (h["url"] or "").split("?", 1)[0]
            canonical = h["canonical"] or "(none)"
            key = (legacy, canonical)
            b = bucket[key]
            b["legacy"] = legacy
            b["canonical"] = canonical
            b["hits"] += 1
            b["by_role"][r["role"]] += 1
            b["by_platform"][r["platform"]] += 1
            b["pages"].add(f"{r['platform']}:{r['page']}")
            if h.get("request_id"):
                b["request_ids"].add(h["request_id"])

    rows = []
    for (legacy, canonical), b in bucket.items():
        rows.append({
            "legacy": legacy, "canonical": canonical, "hits": b["hits"],
            "severity": severity_for(canonical, b["hits"]),
            "by_role": dict(b["by_role"]),
            "by_platform": dict(b["by_platform"]),
            "pages": sorted(b["pages"]),
            "unique_request_ids": len(b["request_ids"]),
        })
    rows.sort(key=lambda x: -x["hits"])

    (OUT / "heatmap.json").write_text(json.dumps(rows, indent=2))

    with open(OUT / "heatmap.csv", "w") as f:
        w = csv.writer(f)
        w.writerow(["legacy", "canonical", "hits", "severity", "platforms", "roles", "pages"])
        for r in rows:
            w.writerow([
                r["legacy"], r["canonical"], r["hits"], r["severity"],
                ",".join(r["by_platform"].keys()),
                ",".join(r["by_role"].keys()),
                "; ".join(r["pages"]),
            ])

    summary = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "totals": {
            "surfaces_scanned": len(results),
            "navigated_ok": sum(1 for r in results if r["nav"] == "ok"),
            "total_api_calls": sum(r["api_calls"] for r in results),
            "compat_hits_total": sum(len(r["compat_hits"]) for r in results),
            "unique_legacy_routes": len(rows),
            "page_failures": sum(1 for r in results if r["nav"] != "ok"),
        },
        "by_severity": {
            sev: sum(r["hits"] for r in rows if r["severity"] == sev)
            for sev in ("hot", "warm", "warm_agg", "cold", "unknown")
        },
        "top10": rows[:10],
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    print("\n=== SUMMARY ===")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
