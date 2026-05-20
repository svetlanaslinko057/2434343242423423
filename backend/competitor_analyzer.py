"""
Competitor / reference site analyzer.

Used by `/describe` when a visitor pastes a URL of a competitor / inspiration
site and asks "build me something like this". Pipeline:

  1. Fetch the HTML with a real-browser User-Agent (httpx, 8s timeout).
  2. Parse with BeautifulSoup, pull title / description / headings / main
     visible text / outbound script hosts / form count / link sample.
  3. Feed the compact signal-set to the active LLM provider (admin-configured
     in /admin/integrations) and ask for a structured product brief:
        - one-line summary of what the site does
        - target audience guess
        - 6-12 key features observed
        - rough complexity tier  (simple / mid / complex / enterprise)
        - whether it looks transactional (payments / auth / marketplace …)
  4. Return that brief as plain markdown text — the caller drops it into the
     `goal` textarea exactly like the voice transcript, so the visitor can
     edit it before hitting "See my product plan".

We deliberately do NOT run JS, sandbox the worker, or follow more than one
hop — this is a public, unauthenticated endpoint and the LLM is the
intelligence layer, not the scraper.
"""
from __future__ import annotations

import ipaddress
import logging
import re
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from emergentintegrations.llm.chat import UserMessage

from admin_llm_settings import build_chat, get_active_llm_key

logger = logging.getLogger("competitor_analyzer")


class AnalyzerUnavailable(RuntimeError):
    """Raised when the LLM provider is not configured."""


class FetchError(RuntimeError):
    """Network / HTTP / content-type problem reaching the URL."""


# ─────────────────────────────────────────────────────────────────────────────
# Tiny telemetry — appends one document per usage event so we can answer
# "is this real workflow or a curiosity?" without standing up an analytics
# platform. Fire-and-forget: never block the request on a write failure.
#
# Events written to `competitor_url_events`:
#   • analyze_url_call          — endpoint hit (always, before resolution)
#   • cache_hit / cache_miss    — once analyze_url() resolves
#   • analyze_url_error         — endpoint resolved with HTTPException
#                                 (error_kind = classified bucket, not raw msg)
#   • copy_click                — admin clicked copy in the inbox panel
#   • insert_into_reply_click   — admin clicked "Insert into reply"
#
# Shape: { event, url, surface(visitor|admin|unknown), error_kind?, occurred_at }
# ─────────────────────────────────────────────────────────────────────────────
VALID_SURFACES = {"visitor", "admin", "unknown"}


def _coerce_surface(raw: Optional[str]) -> str:
    s = (raw or "unknown").strip().lower()[:32]
    return s if s in VALID_SURFACES else "unknown"


async def log_event(
    db,
    event: str,
    *,
    url: str = "",
    surface: str = "unknown",
    device: Optional[str] = None,
    error_kind: Optional[str] = None,
    duration_ms: Optional[int] = None,
    success: Optional[bool] = None,
) -> None:
    if db is None:
        return
    try:
        doc = {
            "event": event,
            "url": (url or "")[:512],
            "surface": _coerce_surface(surface),
            "occurred_at": datetime.now(timezone.utc),
        }
        # Optional fields — only stored when actually provided so existing
        # aggregations stay clean. `device` is free-form (frontend sends
        # 'mobile' or 'desktop'); we only trim/lowercase.
        if device is not None:
            doc["device"] = str(device).strip().lower()[:16] or None
        if error_kind is not None:
            doc["error_kind"] = error_kind
        if duration_ms is not None:
            doc["duration_ms"] = int(duration_ms)
        if success is not None:
            doc["success"] = bool(success)
        await db.competitor_url_events.insert_one(doc)
    except Exception as e:  # pragma: no cover — never block on telemetry
        logger.warning(f"COMPETITOR_ANALYZER: event log failed: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Graceful failure narratives — map raw exception text into stable error
# kinds with human explanations. UI prefers `message` (one line, what
# happened) + `hint` (one line, what the user can do). `detail` is the raw
# technical string, kept for debugging.
# ─────────────────────────────────────────────────────────────────────────────
def classify_url_error(raw: str) -> dict:
    """ValueError from _normalize_url → user-facing payload."""
    msg = (raw or "").lower()
    if "empty" in msg:
        return {
            "kind": "INVALID_URL",
            "message": "Paste a website link first.",
            "hint": "Example: stripe.com or https://airbnb.com/host",
            "detail": raw,
        }
    if "public" in msg or "internal address" in msg or "private network" in msg:
        return {
            "kind": "INVALID_URL",
            "message": "That link points to an internal address we can't read.",
            "hint": "Use a public URL — something you could open in an incognito browser.",
            "detail": raw,
        }
    if "not a regular web page" in msg or "looks like a file" in msg:
        return {
            "kind": "NOT_HTML",
            "message": "That link looks like a file, not a web page.",
            "hint": "Paste the homepage or a marketing page URL (not a PDF, image, or download link).",
            "detail": raw,
        }
    # generic "URL doesn't look valid"
    return {
        "kind": "INVALID_URL",
        "message": "That doesn't look like a website address.",
        "hint": "Check the spelling — try the homepage URL of the site you want to analyze.",
        "detail": raw,
    }


def classify_fetch_error(raw: str) -> dict:
    """FetchError → user-facing payload. Buckets:
        SITE_BLOCKS_BOTS   — 401/403/429 → the site refused our reader
        SITE_UNREACHABLE   — DNS/timeout/connection/5xx → couldn't get a page
        NOT_HTML           — content-type isn't HTML/XML (PDF, JSON, image …)
        EMPTY_ANALYSIS     — fetch fine, LLM returned blank
    """
    msg = (raw or "").strip()
    lower = msg.lower()

    if "returned http 401" in lower or "returned http 403" in lower or "returned http 429" in lower:
        return {
            "kind": "SITE_BLOCKS_BOTS",
            "message": "This site blocks automated reading.",
            "hint": "Try another page on the same site (often an /about or /pricing URL works), or paste the brief by hand.",
            "detail": msg,
        }
    if "couldn't reach the site" in lower or lower.startswith("site returned http") or "name or service not known" in lower or "timed out" in lower:
        return {
            "kind": "SITE_UNREACHABLE",
            "message": "We couldn't reach that site.",
            "hint": "Double-check the address, or try again in a minute — the site may be temporarily down.",
            "detail": msg,
        }
    if "not an html page" in lower:
        return {
            "kind": "NOT_HTML",
            "message": "That link doesn't look like a regular web page.",
            "hint": "Paste the URL of the site's homepage or a marketing page (not a PDF, image, or download).",
            "detail": msg,
        }
    if "empty analysis" in lower or "empty" in lower:
        return {
            "kind": "EMPTY_ANALYSIS",
            "message": "We reached the site but couldn't summarize it.",
            "hint": "Try a different page that has more visible text — landing or pricing pages usually work best.",
            "detail": msg,
        }
    return {
        "kind": "SITE_UNREACHABLE",
        "message": "We couldn't read that site.",
        "hint": "Try a different page — the homepage usually works best.",
        "detail": msg,
    }


_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.4 Safari/605.1.15"
)
_TIMEOUT = httpx.Timeout(8.0, connect=4.0)
_MAX_HTML_BYTES = 1_500_000          # ≈1.5 MB — most marketing sites well under
_MAX_VISIBLE_CHARS = 6000            # what we send to the LLM


# File extensions that are NOT regular web pages — reject pre-fetch to
# avoid (a) wasting a network roundtrip and (b) feeding bytes of a PDF /
# image / archive into the HTML parser. A Sucuri/Cloudflare captcha page
# served at a `.pdf` URL with `content-type: text/html` will otherwise
# fool the analyzer into hallucinating a "## Product" summary from
# captcha boilerplate.
_NON_HTML_EXTENSIONS = frozenset({
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp", ".tiff",
    ".mp3", ".mp4", ".wav", ".flac", ".ogg", ".m4a", ".avi", ".mov", ".mkv", ".webm",
    ".zip", ".tar", ".gz", ".7z", ".rar", ".dmg", ".exe", ".msi", ".pkg", ".deb", ".rpm",
    ".csv", ".tsv", ".json", ".xml", ".yaml", ".yml", ".txt", ".md", ".log",
    ".js", ".css", ".map", ".woff", ".woff2", ".ttf", ".otf", ".eot",
})

# Captcha / bot-wall fingerprints that may sneak past the `content-type`
# header check (Sucuri, Cloudflare turnstile, hCaptcha, AWS WAF, …).
# If we see one of these in the first ~8 KB of response body, treat the
# fetch as `SITE_BLOCKS_BOTS` rather than letting the LLM hallucinate.
_CAPTCHA_FINGERPRINTS = (
    "sucuri_cloudproxy_js",
    "sg-captcha",
    "cf-chl-",
    "challenge-platform",
    "/cdn-cgi/challenge-platform",
    "just a moment",
    "checking your browser",
    "please enable javascript and cookies",
    "captcha-delivery",
    "hcaptcha.com",
    "www.google.com/recaptcha",
    "aws-waf-token",
    "datadome",
    "perimeterx",
    "_imperva_",
)


def _is_private_host(host: str) -> bool:
    """True if `host` is loopback / private / link-local — must be blocked
    on a public endpoint (SSRF + saves users from 4s timeouts on RFC1918)."""
    if not host:
        return False
    host = host.lower().strip("[]")  # IPv6 literal
    if host in {"localhost", "0", "0.0.0.0"} or host.endswith(".local") or host.endswith(".internal"):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def _normalize_url(raw: str) -> str:
    """Accept `example.com`, `www.example.com`, full URLs — return https://…
    Raises ValueError for obviously bad input."""
    s = (raw or "").strip()
    if not s:
        raise ValueError("URL is empty")
    # Reject schemes other than http(s) before adding https:// (so
    # `javascript:alert(1)` / `ftp://...` / `file://...` fail fast).
    if re.match(r"^[a-z][a-z0-9+.\-]*:", s, re.I):
        scheme = s.split(":", 1)[0].lower()
        if scheme not in {"http", "https"}:
            raise ValueError(f"URL scheme '{scheme}' is not supported (use http or https)")
    else:
        s = "https://" + s
    p = urlparse(s)
    if not p.netloc or "." not in p.netloc or " " in p.netloc:
        raise ValueError("URL doesn't look valid")
    host = (p.hostname or "").lower()
    if _is_private_host(host):
        raise ValueError("URL points to an internal/private network address")
    # Reject file-type URLs before fetch — see _NON_HTML_EXTENSIONS comment.
    path = (p.path or "").lower()
    if path and "." in path.rsplit("/", 1)[-1]:
        ext = "." + path.rsplit(".", 1)[-1]
        if ext in _NON_HTML_EXTENSIONS:
            raise ValueError(f"URL looks like a file ({ext}), not a regular web page")
    return s


async def _fetch_html(url: str) -> str:
    try:
        async with httpx.AsyncClient(
            timeout=_TIMEOUT,
            follow_redirects=True,
            headers={"User-Agent": _UA, "Accept-Language": "en,ru;q=0.8"},
            max_redirects=4,
        ) as client:
            r = await client.get(url)
    except httpx.HTTPError as e:
        raise FetchError(f"Couldn't reach the site: {e}")

    if r.status_code >= 400:
        raise FetchError(f"Site returned HTTP {r.status_code}")

    ctype = (r.headers.get("content-type") or "").lower()
    if "html" not in ctype and "xml" not in ctype:
        raise FetchError(f"Not an HTML page ({ctype or 'unknown content-type'})")

    body = r.content[:_MAX_HTML_BYTES]
    # Captcha walls (Sucuri/Cloudflare/hCaptcha/Datadome/...) often serve a
    # text/html challenge page that would otherwise feed garbage to the LLM.
    # Sniff the first 8 KB for known fingerprints — cheap, no false-positives
    # observed on the 100-URL synthetic corpus (Clean SaaS / Verbose / Intl
    # all pass through).
    head_lc = body[:8192].decode("utf-8", errors="ignore").lower()
    for marker in _CAPTCHA_FINGERPRINTS:
        if marker in head_lc:
            raise FetchError(f"Site returned HTTP 403 (bot wall: {marker})")

    try:
        return body.decode(r.encoding or "utf-8", errors="replace")
    except Exception:
        return body.decode("utf-8", errors="replace")


def _extract_signals(html: str, url: str) -> dict:
    """Reduce a full HTML doc to a compact signal-set suitable for the LLM."""
    soup = BeautifulSoup(html, "lxml")

    # Strip noise so .get_text() actually returns content, not scripts.
    for tag in soup(["script", "style", "noscript", "svg", "template"]):
        tag.decompose()

    title = (soup.title.string.strip() if soup.title and soup.title.string else "").strip()

    def _meta(name_or_property: str, attr: str = "name") -> str:
        el = soup.find("meta", attrs={attr: name_or_property})
        return (el.get("content") or "").strip() if el else ""

    description = _meta("description") or _meta("og:description", "property")
    og_title = _meta("og:title", "property")
    keywords = _meta("keywords")

    headings = []
    for level in ("h1", "h2", "h3"):
        for el in soup.find_all(level)[:10]:
            t = el.get_text(" ", strip=True)
            if t and 3 <= len(t) <= 180:
                headings.append(f"{level.upper()}: {t}")

    # Visible text — collapse whitespace, drop anything left from menus etc.
    visible = soup.get_text(" ", strip=True)
    visible = re.sub(r"\s+", " ", visible)
    if len(visible) > _MAX_VISIBLE_CHARS:
        visible = visible[:_MAX_VISIBLE_CHARS].rstrip() + " …"

    # Forms and external script hosts give a strong hint about transactional
    # complexity (Stripe / Auth0 / Intercom …).
    form_count = len(soup.find_all("form"))
    input_count = len(soup.find_all("input"))
    nav_links = []
    for a in soup.find_all("a", href=True)[:60]:
        label = a.get_text(" ", strip=True)
        if label and 2 <= len(label) <= 40 and "/" in a["href"]:
            nav_links.append(label)
    nav_links = list(dict.fromkeys(nav_links))[:25]

    # Re-parse to find scripts — we stripped them above. Cheap: 1 more parse.
    soup2 = BeautifulSoup(html, "lxml")
    third_party_hosts = set()
    for s in soup2.find_all("script", src=True):
        try:
            host = urlparse(s["src"]).hostname or ""
        except Exception:
            continue
        if host and host not in (urlparse(url).hostname or ""):
            third_party_hosts.add(host)
    third_party_hosts = sorted(third_party_hosts)[:20]

    return {
        "url": url,
        "title": title or og_title,
        "description": description,
        "keywords": keywords,
        "headings": headings[:25],
        "nav_links": nav_links,
        "form_count": form_count,
        "input_count": input_count,
        "third_party_hosts": third_party_hosts,
        "visible_text": visible,
    }


def _build_prompt(signals: dict) -> str:
    return f"""Below is a structured snapshot of a website a prospective
customer pasted as inspiration. They want us to build something similar.
Produce a SHORT product brief (markdown) that we will feed into our own
estimation engine.

Required sections (use these exact headings, in this order):

  ## Product
  One sentence: what the site does and who it's for.

  ## Core features
  6 to 12 bullets — concrete capabilities you can infer from the structure
  (auth, payments, search, dashboard, marketplace, messaging, CMS, etc.).
  Be specific; do NOT invent features that have no evidence.

  ## Complexity
  One of: simple / mid / complex / enterprise. One sentence justifying it
  (e.g. "complex — clear marketplace mechanics with payments + reviews +
  multi-role auth").

  ## Likely integrations
  Bullets, based on third-party hosts and form counts. Examples: Stripe,
  Auth0, Intercom, SendGrid, Mapbox, Algolia. Use "—" if none obvious.

  ## Notes for the estimator
  Anything tricky or risky (real-time, geo, KYC, regulated, AI/ML, mobile
  app needed, internationalisation, etc.). Keep to 1-3 bullets.

Do NOT include marketing fluff, brand copy, or speculation about revenue.
Reply in the user's language if the snapshot is non-English, otherwise
English. Keep total length under 220 words.

WEBSITE SNAPSHOT
----------------
URL: {signals['url']}
Title: {signals['title'] or '—'}
Meta description: {signals['description'] or '—'}
Keywords: {signals['keywords'] or '—'}

Headings (first 25):
{chr(10).join('  - ' + h for h in signals['headings']) or '  —'}

Navigation labels:
  {', '.join(signals['nav_links']) or '—'}

Forms on landing: {signals['form_count']}    Inputs: {signals['input_count']}
Third-party script hosts:
  {', '.join(signals['third_party_hosts']) or '—'}

Visible text excerpt (truncated):
{signals['visible_text'] or '—'}
""".strip()


async def analyze_url(raw_url: str, *, db=None) -> dict:
    """Main entry. Returns:
        {
          url: normalized,
          title: str,
          summary: markdown,
          provider: "openai"|"emergent",
          model: str,
          cached: bool,
        }

    If `db` is provided, results are cached in `competitor_url_cache` with
    a 24h TTL — repeat requests for the same URL skip both the HTTP fetch
    and the LLM call. Cache is keyed on the normalized URL.
    """
    url = _normalize_url(raw_url)

    # 1. Cache hit? — 24h TTL is enforced by Mongo via an index, but we also
    #    double-check the timestamp here so a missing index doesn't silently
    #    serve stale rows.
    if db is not None:
        try:
            doc = await db.competitor_url_cache.find_one({"_id": url}, {"_id": 0})
        except Exception as e:
            logger.warning(f"COMPETITOR_ANALYZER: cache lookup failed: {e}")
            doc = None
        if doc:
            from datetime import datetime, timedelta, timezone as _tz
            created = doc.get("created_at")
            if isinstance(created, datetime):
                age = datetime.now(_tz.utc) - (
                    created if created.tzinfo else created.replace(tzinfo=_tz.utc)
                )
                if age < timedelta(hours=24):
                    logger.info(
                        f"COMPETITOR_ANALYZER: cache HIT url={url} age={int(age.total_seconds())}s"
                    )
                    return {
                        "url": url,
                        "title": doc.get("title") or "",
                        "summary": doc.get("summary") or "",
                        "provider": doc.get("provider"),
                        "model": doc.get("model"),
                        "cached": True,
                    }

    # 2. Miss → fetch + LLM.
    active = await get_active_llm_key()
    if not active.get("key"):
        raise AnalyzerUnavailable(
            "LLM provider is not configured. An admin must enable one in /admin/integrations."
        )

    html = await _fetch_html(url)
    signals = _extract_signals(html, url)

    chat = await build_chat(
        session_id=f"competitor_{abs(hash(url)) % 10_000_000:07d}",
        system_message=(
            "You are a senior product manager helping a delivery agency scope "
            "look-alike projects. Be concrete, terse, and never invent features."
        ),
        max_tokens=900,
    )
    if chat is None:
        raise AnalyzerUnavailable("LLM client could not be constructed.")

    prompt = _build_prompt(signals)
    response = await chat.send_message(UserMessage(text=prompt))
    summary = (response or "").strip()
    if not summary:
        raise FetchError("LLM returned an empty analysis")

    logger.info(
        f"COMPETITOR_ANALYZER: cache MISS url={url} provider={active.get('provider')} "
        f"source={active.get('source')} title={(signals['title'] or '')[:80]!r} "
        f"chars={len(summary)}"
    )

    # 3. Persist to cache (24h TTL is enforced by a Mongo index — see
    #    server.py startup). Best-effort: never block the response.
    if db is not None:
        from datetime import datetime, timezone as _tz
        try:
            await db.competitor_url_cache.replace_one(
                {"_id": url},
                {
                    "_id": url,
                    "title": signals["title"] or "",
                    "summary": summary,
                    "provider": active.get("provider"),
                    "model": active.get("model"),
                    "created_at": datetime.now(_tz.utc),
                },
                upsert=True,
            )
        except Exception as e:
            logger.warning(f"COMPETITOR_ANALYZER: cache write failed: {e}")

    return {
        "url": url,
        "title": signals["title"],
        "summary": summary,
        "provider": active.get("provider"),
        "model": active.get("model"),
        "cached": False,
    }
