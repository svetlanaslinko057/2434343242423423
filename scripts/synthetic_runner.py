#!/usr/bin/env python3
"""
Synthetic Behavioral Simulation runner.

Прогоняет curated URL corpus через /api/estimate/analyze-url, измеряет:
- HTTP status / error_kind
- latency (request + server-side)
- cached: true|false
- chars (text length)
- narrative quality (has message + hint?)

НЕ создаёт fake accounts, НЕ симулирует growth, НЕ запускает scale-tests.
Пишет результаты в:
- /app/docs/synthetic_observation_matrix.md (markdown table)
- /app/docs/synthetic_observation_data.json (raw JSON для replay/aggregation)

Кеш-тест: после первого прогона повторяет 5 first-category URLs → ожидание hit_ratio≈100%, latency<150ms.
Admin reuse simulation: 2× copy_click + 2× insert_into_reply_click через telemetry endpoint.
"""

from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

import httpx

BACKEND = os.environ.get("BACKEND_URL", "http://localhost:8001")
TIMEOUT = 60.0
OUT_MD = "/app/docs/synthetic_observation_matrix.md"
OUT_JSON = "/app/docs/synthetic_observation_data.json"

CORPUS: list[dict[str, str]] = [
    # === Category 1: Clean SaaS (20) ===
    {"url": "https://stripe.com", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://linear.app", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://www.notion.so", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://slack.com", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://www.intercom.com", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://airtable.com", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://www.atlassian.com", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://www.dropbox.com", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://www.hubspot.com", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://www.salesforce.com", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://www.zendesk.com", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://www.twilio.com", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://www.cloudflare.com", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://www.digitalocean.com", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://www.heroku.com", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://www.mongodb.com", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://supabase.com", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://www.postman.com", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://www.datadoghq.com", "category": "1_clean_saas", "expected": "success"},
    {"url": "https://www.pipedrive.com", "category": "1_clean_saas", "expected": "success"},
    # === Category 2: Marketing-heavy / consumer brands (20) ===
    {"url": "https://www.apple.com", "category": "2_marketing", "expected": "success"},
    {"url": "https://www.airbnb.com", "category": "2_marketing", "expected": "success"},
    {"url": "https://www.coinbase.com", "category": "2_marketing", "expected": "success"},
    {"url": "https://www.shopify.com", "category": "2_marketing", "expected": "success"},
    {"url": "https://www.tesla.com", "category": "2_marketing", "expected": "success"},
    {"url": "https://www.nike.com", "category": "2_marketing", "expected": "success_or_blocks"},
    {"url": "https://www.adidas.com", "category": "2_marketing", "expected": "success_or_blocks"},
    {"url": "https://www.starbucks.com", "category": "2_marketing", "expected": "success"},
    {"url": "https://www.spotify.com", "category": "2_marketing", "expected": "success"},
    {"url": "https://www.netflix.com", "category": "2_marketing", "expected": "success"},
    {"url": "https://www.uber.com", "category": "2_marketing", "expected": "success"},
    {"url": "https://www.doordash.com", "category": "2_marketing", "expected": "success"},
    {"url": "https://www.lyft.com", "category": "2_marketing", "expected": "success"},
    {"url": "https://robinhood.com", "category": "2_marketing", "expected": "success"},
    {"url": "https://www.peloton.com", "category": "2_marketing", "expected": "success"},
    {"url": "https://www.gopro.com", "category": "2_marketing", "expected": "success"},
    {"url": "https://www.dyson.com", "category": "2_marketing", "expected": "success_or_blocks"},
    {"url": "https://www.glossier.com", "category": "2_marketing", "expected": "success"},
    {"url": "https://www.warbyparker.com", "category": "2_marketing", "expected": "success"},
    {"url": "https://www.allbirds.com", "category": "2_marketing", "expected": "success"},
    # === Category 3: JS-heavy / SPA (15) ===
    {"url": "https://vercel.com", "category": "3_js_heavy", "expected": "success_or_empty"},
    {"url": "https://www.figma.com", "category": "3_js_heavy", "expected": "success_or_empty"},
    {"url": "https://www.framer.com", "category": "3_js_heavy", "expected": "success_or_empty"},
    {"url": "https://www.canva.com", "category": "3_js_heavy", "expected": "success_or_empty"},
    {"url": "https://www.miro.com", "category": "3_js_heavy", "expected": "success_or_empty"},
    {"url": "https://www.webflow.com", "category": "3_js_heavy", "expected": "success_or_empty"},
    {"url": "https://www.loom.com", "category": "3_js_heavy", "expected": "success_or_empty"},
    {"url": "https://www.netlify.com", "category": "3_js_heavy", "expected": "success_or_empty"},
    {"url": "https://www.sentry.io", "category": "3_js_heavy", "expected": "success_or_empty"},
    {"url": "https://www.replit.com", "category": "3_js_heavy", "expected": "success_or_empty"},
    {"url": "https://www.codesandbox.io", "category": "3_js_heavy", "expected": "success_or_empty"},
    {"url": "https://www.duolingo.com", "category": "3_js_heavy", "expected": "success_or_empty"},
    {"url": "https://www.deepl.com", "category": "3_js_heavy", "expected": "success_or_empty"},
    {"url": "https://www.openai.com", "category": "3_js_heavy", "expected": "success_or_blocks"},
    {"url": "https://www.anthropic.com", "category": "3_js_heavy", "expected": "success_or_empty"},
    # === Category 4: Bot-protected / login-walls (15) ===
    {"url": "https://www.linkedin.com", "category": "4_bot_protected", "expected": "SITE_BLOCKS_BOTS"},
    {"url": "https://www.instagram.com", "category": "4_bot_protected", "expected": "SITE_BLOCKS_BOTS"},
    {"url": "https://medium.com", "category": "4_bot_protected", "expected": "success_or_blocks"},
    {"url": "https://www.facebook.com", "category": "4_bot_protected", "expected": "SITE_BLOCKS_BOTS"},
    {"url": "https://twitter.com", "category": "4_bot_protected", "expected": "SITE_BLOCKS_BOTS"},
    {"url": "https://x.com", "category": "4_bot_protected", "expected": "SITE_BLOCKS_BOTS"},
    {"url": "https://www.reddit.com", "category": "4_bot_protected", "expected": "success_or_blocks"},
    {"url": "https://www.pinterest.com", "category": "4_bot_protected", "expected": "SITE_BLOCKS_BOTS"},
    {"url": "https://www.tiktok.com", "category": "4_bot_protected", "expected": "SITE_BLOCKS_BOTS"},
    {"url": "https://www.snapchat.com", "category": "4_bot_protected", "expected": "SITE_BLOCKS_BOTS"},
    {"url": "https://www.quora.com", "category": "4_bot_protected", "expected": "success_or_blocks"},
    {"url": "https://www.glassdoor.com", "category": "4_bot_protected", "expected": "SITE_BLOCKS_BOTS"},
    {"url": "https://www.indeed.com", "category": "4_bot_protected", "expected": "success_or_blocks"},
    {"url": "https://www.zillow.com", "category": "4_bot_protected", "expected": "SITE_BLOCKS_BOTS"},
    {"url": "https://www.yelp.com", "category": "4_bot_protected", "expected": "success_or_blocks"},
    # === Category 5: Non-product garbage / malformed (12) ===
    {"url": "not-a-url", "category": "5_garbage", "expected": "INVALID_URL"},
    {"url": "ftp://example.com", "category": "5_garbage", "expected": "INVALID_URL"},
    {"url": "http://localhost:8080", "category": "5_garbage", "expected": "INVALID_URL"},
    {"url": "https://nonexistent-domain-xyz123abc.test", "category": "5_garbage", "expected": "SITE_UNREACHABLE"},
    {"url": "https://www.africau.edu/images/default/sample.pdf", "category": "5_garbage", "expected": "NOT_HTML"},
    {"url": "https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png", "category": "5_garbage", "expected": "NOT_HTML"},
    {"url": "https://raw.githubusercontent.com/git/git/master/README.md", "category": "5_garbage", "expected": "NOT_HTML_or_EMPTY"},
    {"url": "https://example.com", "category": "5_garbage", "expected": "success_or_empty"},
    {"url": "", "category": "5_garbage", "expected": "INVALID_URL"},
    {"url": "javascript:alert(1)", "category": "5_garbage", "expected": "INVALID_URL"},
    {"url": "https://", "category": "5_garbage", "expected": "INVALID_URL"},
    {"url": "https://192.168.1.1", "category": "5_garbage", "expected": "INVALID_URL_or_UNREACHABLE"},
    # === Category 6: Verbose / huge / docs (10) ===
    {"url": "https://en.wikipedia.org/wiki/Stripe_(company)", "category": "6_verbose", "expected": "success_or_blocks"},
    {"url": "https://docs.python.org/3/", "category": "6_verbose", "expected": "success_or_truncated"},
    {"url": "https://www.mit.edu", "category": "6_verbose", "expected": "success"},
    {"url": "https://aws.amazon.com", "category": "6_verbose", "expected": "success"},
    {"url": "https://kubernetes.io", "category": "6_verbose", "expected": "success"},
    {"url": "https://docs.github.com", "category": "6_verbose", "expected": "success"},
    {"url": "https://developer.mozilla.org", "category": "6_verbose", "expected": "success_or_truncated"},
    {"url": "https://nodejs.org/en", "category": "6_verbose", "expected": "success"},
    {"url": "https://reactjs.org", "category": "6_verbose", "expected": "success"},
    {"url": "https://www.stanford.edu", "category": "6_verbose", "expected": "success"},
    # === Category 7: Non-English / encoding / international (8) ===
    {"url": "https://www.baidu.com", "category": "7_intl", "expected": "success_or_empty"},
    {"url": "https://yandex.ru", "category": "7_intl", "expected": "success_or_blocks"},
    {"url": "https://www.rakuten.co.jp", "category": "7_intl", "expected": "success_or_blocks"},
    {"url": "https://www.spiegel.de", "category": "7_intl", "expected": "success"},
    {"url": "https://www.lemonde.fr", "category": "7_intl", "expected": "success_or_blocks"},
    {"url": "https://www.mercadolibre.com.ar", "category": "7_intl", "expected": "success_or_blocks"},
    {"url": "https://ozon.ru", "category": "7_intl", "expected": "success_or_blocks"},
    {"url": "https://wildberries.ru", "category": "7_intl", "expected": "success_or_blocks"},
]

CACHE_REPLAY_URLS = [
    "https://stripe.com",
    "https://linear.app",
    "https://www.notion.so",
    "https://www.airbnb.com",
    "https://www.apple.com",
    "https://www.dropbox.com",
    "https://www.hubspot.com",
    "https://vercel.com",
    "https://docs.python.org/3/",
    "https://kubernetes.io",
]


@dataclass
class Result:
    url: str
    category: str
    expected: str
    http_status: int
    error_kind: str | None
    message: str | None
    hint: str | None
    cached: bool | None
    chars: int | None
    title: str | None
    latency_ms: int
    narrative_quality: str  # "good" | "ok" | "bad"
    estimate_seed_quality: str  # "useful" | "weak" | "n/a"
    notes: str


def _narrative_quality(r: dict[str, Any]) -> str:
    """Адекватно ли описывает ошибку человеку?"""
    if r.get("text"):
        return "n/a"  # success path
    msg = r.get("message") or ""
    hint = r.get("hint") or ""
    if not msg:
        return "bad"
    # message should be human-language, not stack trace
    bad_signals = ["traceback", "exception", "<class", "object at 0x", "errno"]
    if any(s in (msg + hint).lower() for s in bad_signals):
        return "bad"
    if hint and len(hint) > 20:
        return "good"  # message + actionable hint
    return "ok"


def _estimate_seed_quality(r: dict[str, Any]) -> str:
    """Полезен ли текст как seed для estimator?"""
    txt = r.get("text") or ""
    if not txt:
        return "n/a"
    has_product = "## Product" in txt
    has_features = "## Core features" in txt or "## Features" in txt
    has_complexity = "## Complexity" in txt or "## Likely integrations" in txt
    score = sum([has_product, has_features, has_complexity])
    if score >= 3 and len(txt) > 600:
        return "useful"
    if score >= 2 and len(txt) > 300:
        return "useful"
    if score >= 1:
        return "weak"
    return "weak"


def analyze(client: httpx.Client, url: str, surface: str = "visitor", device: str = "desktop") -> tuple[dict[str, Any], int, int]:
    t0 = time.perf_counter()
    try:
        resp = client.post(
            f"{BACKEND}/api/estimate/analyze-url",
            json={"url": url, "surface": surface, "device": device},
            timeout=TIMEOUT,
        )
        elapsed = int((time.perf_counter() - t0) * 1000)
        try:
            body = resp.json()
        except Exception:
            body = {"_raw": resp.text[:200]}
        return body, resp.status_code, elapsed
    except httpx.TimeoutException:
        return {"_timeout": True}, 0, int((time.perf_counter() - t0) * 1000)
    except Exception as e:
        return {"_error": str(e)[:200]}, 0, int((time.perf_counter() - t0) * 1000)


def telemetry(client: httpx.Client, event: str, url: str, surface: str = "admin", device: str = "desktop") -> int:
    try:
        r = client.post(
            f"{BACKEND}/api/estimate/analyze-url/telemetry",
            json={"event": event, "url": url, "surface": surface, "device": device},
            timeout=10.0,
        )
        return r.status_code
    except Exception:
        return 0


def to_result(case: dict[str, str], body: dict[str, Any], status: int, elapsed_ms: int) -> Result:
    details = body.get("details") or {}
    if not isinstance(details, dict):
        details = {}
    kind = details.get("kind") or body.get("code") or (None if body.get("text") else "UNKNOWN")
    if body.get("_timeout"):
        kind = "CLIENT_TIMEOUT"
    return Result(
        url=case["url"],
        category=case["category"],
        expected=case["expected"],
        http_status=status,
        error_kind=kind if not body.get("text") else None,
        message=body.get("message"),
        hint=body.get("hint"),
        cached=body.get("cached") if body.get("text") else None,
        chars=body.get("chars") if body.get("text") else None,
        title=body.get("title"),
        latency_ms=elapsed_ms,
        narrative_quality=_narrative_quality(body),
        estimate_seed_quality=_estimate_seed_quality(body),
        notes="",
    )


def _match(expected: str, kind: str | None, text_present: bool) -> str:
    """Совпадает ли результат с ожиданием?"""
    expected = (expected or "").lower()
    if "success" in expected and text_present:
        return "match"
    if "success_or_empty" in expected:
        return "match"
    if "success_or_blocks" in expected:
        return "match"
    if "success_or_truncated" in expected and text_present:
        return "match"
    if not text_present and kind and kind.upper() in expected.upper():
        return "match"
    if not text_present and "invalid" in expected.lower() and kind and "invalid" in kind.lower():
        return "match"
    return "drift"


def main() -> int:
    print(f"[synthetic] backend={BACKEND}, corpus_size={len(CORPUS)}, cache_replay={len(CACHE_REPLAY_URLS)}")
    results: list[Result] = []
    with httpx.Client(headers={"User-Agent": "synthetic-runner/1.0"}) as client:
        # Health probe
        try:
            h = client.get(f"{BACKEND}/api/healthz", timeout=5.0).json()
            print(f"[synthetic] healthz={h}")
        except Exception as e:
            print(f"[synthetic] healthz FAILED: {e}", file=sys.stderr)
            return 1

        # === Phase 1: first pass over corpus ===
        for i, case in enumerate(CORPUS, 1):
            url = case["url"]
            body, status, ms = analyze(client, url)
            r = to_result(case, body, status, ms)
            results.append(r)
            ok = "✓" if r.error_kind is None else "✗"
            print(f"  [{i:02d}/{len(CORPUS)}] {ok} {status:3d} {ms:5d}ms cat={case['category']} kind={r.error_kind or 'OK'} chars={r.chars or 0} url={url[:60]}")

        # === Phase 2: cache replay ===
        print("\n[synthetic] === cache replay (expect hit_ratio≈100% on 2nd pass) ===")
        cache_pass: list[Result] = []
        for i, url in enumerate(CACHE_REPLAY_URLS, 1):
            body, status, ms = analyze(client, url)
            r = to_result({"url": url, "category": "_cache_replay", "expected": "success_cached"}, body, status, ms)
            r.notes = f"cache={r.cached}"
            cache_pass.append(r)
            print(f"  [{i}/{len(CACHE_REPLAY_URLS)}] {status:3d} {ms:5d}ms cached={r.cached} url={url[:60]}")

        # === Phase 3: admin reuse telemetry ===
        print("\n[synthetic] === admin reuse simulation ===")
        for event in ["copy_click", "copy_click", "insert_into_reply_click", "insert_into_reply_click"]:
            s = telemetry(client, event, "https://stripe.com")
            print(f"  {event}: HTTP {s}")

    # === Aggregate ===
    by_cat: dict[str, dict[str, int]] = {}
    drift: list[Result] = []
    success_count = 0
    error_dist: dict[str, int] = {}
    latencies: list[int] = []
    cache_hits = sum(1 for r in cache_pass if r.cached)
    cache_misses = sum(1 for r in cache_pass if r.cached is False)
    narrative_dist: dict[str, int] = {"good": 0, "ok": 0, "bad": 0, "n/a": 0}
    estimate_dist: dict[str, int] = {"useful": 0, "weak": 0, "n/a": 0}
    for r in results:
        by_cat.setdefault(r.category, {"n": 0, "success": 0, "error": 0})
        by_cat[r.category]["n"] += 1
        if r.error_kind is None:
            by_cat[r.category]["success"] += 1
            success_count += 1
        else:
            by_cat[r.category]["error"] += 1
            error_dist[r.error_kind] = error_dist.get(r.error_kind, 0) + 1
        if r.latency_ms > 0:
            latencies.append(r.latency_ms)
        narrative_dist[r.narrative_quality] = narrative_dist.get(r.narrative_quality, 0) + 1
        estimate_dist[r.estimate_seed_quality] = estimate_dist.get(r.estimate_seed_quality, 0) + 1
        if _match(r.expected, r.error_kind, r.chars is not None) == "drift":
            drift.append(r)

    latencies.sort()
    p50 = latencies[len(latencies) // 2] if latencies else 0
    p95 = latencies[int(len(latencies) * 0.95)] if len(latencies) >= 5 else (latencies[-1] if latencies else 0)
    p99 = latencies[int(len(latencies) * 0.99)] if len(latencies) >= 5 else (latencies[-1] if latencies else 0)
    max_lat = max(latencies) if latencies else 0

    # === Write JSON ===
    raw = {
        "ran_at": datetime.now(timezone.utc).isoformat(),
        "backend": BACKEND,
        "n_corpus": len(CORPUS),
        "n_cache_replay": len(CACHE_REPLAY_URLS),
        "results": [asdict(r) for r in results],
        "cache_replay": [asdict(r) for r in cache_pass],
        "aggregate": {
            "success_count": success_count,
            "error_count": len(CORPUS) - success_count,
            "by_category": by_cat,
            "error_kind_distribution": error_dist,
            "narrative_quality": narrative_dist,
            "estimate_seed_quality": estimate_dist,
            "latency_p50_ms": p50,
            "latency_p95_ms": p95,
            "latency_p99_ms": p99,
            "latency_max_ms": max_lat,
            "cache_hit_ratio_pct": int(100 * cache_hits / max(1, cache_hits + cache_misses)),
            "cache_hits": cache_hits,
            "cache_misses": cache_misses,
            "drift_count": len(drift),
        },
    }
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(raw, f, indent=2, ensure_ascii=False)
    print(f"\n[synthetic] wrote {OUT_JSON} ({len(results)} results)")

    # === Write Markdown matrix ===
    lines: list[str] = []
    lines.append("# Synthetic Observation Matrix")
    lines.append("")
    lines.append(f"**Ran:** `{raw['ran_at']}`  ")
    lines.append(f"**Backend:** `{BACKEND}`  ")
    lines.append(f"**Corpus size:** {len(CORPUS)}  ")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- success: **{success_count}/{len(CORPUS)}** ({100*success_count//len(CORPUS)}%)")
    lines.append(f"- latency p50/p95/p99/max: **{p50}ms / {p95}ms / {p99}ms / {max_lat}ms**")
    lines.append(f"- cache hit ratio on replay: **{raw['aggregate']['cache_hit_ratio_pct']}%** ({cache_hits}/{cache_hits+cache_misses})")
    lines.append(f"- drift from expected (corpus prediction wrong): **{len(drift)}**")
    lines.append("")
    lines.append("### Narrative quality (error messages)")
    for k, v in narrative_dist.items():
        lines.append(f"- `{k}`: {v}")
    lines.append("")
    lines.append("### Estimate-seed quality (text usable for estimator)")
    for k, v in estimate_dist.items():
        lines.append(f"- `{k}`: {v}")
    lines.append("")
    lines.append("### Error-kind distribution")
    if error_dist:
        for k, v in sorted(error_dist.items(), key=lambda x: -x[1]):
            lines.append(f"- `{k}`: {v}")
    else:
        lines.append("- _none_")
    lines.append("")
    lines.append("### By category")
    lines.append("")
    lines.append("| category | n | success | error | success_rate |")
    lines.append("|----------|---|---------|-------|--------------|")
    for cat, agg in sorted(by_cat.items()):
        sr = int(100 * agg["success"] / max(1, agg["n"]))
        lines.append(f"| {cat} | {agg['n']} | {agg['success']} | {agg['error']} | {sr}% |")
    lines.append("")
    lines.append("## Detail (sorted by category)")
    lines.append("")
    lines.append("| # | URL | cat | http | error_kind | latency_ms | cached | chars | narrative | est-seed | match |")
    lines.append("|---|-----|-----|------|------------|-----------:|--------|------:|-----------|----------|-------|")
    sorted_results = sorted(enumerate(results, 1), key=lambda x: (x[1].category, x[1].url))
    for idx, r in sorted_results:
        match = _match(r.expected, r.error_kind, r.chars is not None)
        match_em = "✅" if match == "match" else "⚠️"
        url_short = r.url if len(r.url) <= 50 else r.url[:47] + "..."
        lines.append(
            f"| {idx} | `{url_short}` | {r.category} | {r.http_status} | "
            f"{r.error_kind or '—'} | {r.latency_ms} | {r.cached if r.cached is not None else '—'} | "
            f"{r.chars or 0} | {r.narrative_quality} | {r.estimate_seed_quality} | {match_em} {match} |"
        )
    lines.append("")
    lines.append("## Cache replay results")
    lines.append("")
    lines.append("| # | URL | http | latency_ms | cached |")
    lines.append("|---|-----|------|-----------:|--------|")
    for idx, r in enumerate(cache_pass, 1):
        url_short = r.url if len(r.url) <= 50 else r.url[:47] + "..."
        lines.append(f"| {idx} | `{url_short}` | {r.http_status} | {r.latency_ms} | {r.cached} |")
    lines.append("")
    if drift:
        lines.append("## Drift (result ≠ expected)")
        lines.append("")
        lines.append("| URL | expected | got_kind | http | notes |")
        lines.append("|-----|----------|----------|------|-------|")
        for r in drift:
            url_short = r.url if len(r.url) <= 50 else r.url[:47] + "..."
            lines.append(f"| `{url_short}` | {r.expected} | {r.error_kind or 'OK'} | {r.http_status} | {(r.message or '')[:80]} |")
        lines.append("")

    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"[synthetic] wrote {OUT_MD}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
