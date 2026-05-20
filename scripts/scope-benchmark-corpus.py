#!/usr/bin/env python3
"""
LLM Scope Perception Benchmark — corpus runner.

See `/app/docs/scope-benchmark-charter.md` for the full charter. TL;DR:

    The benchmark evaluates *perception*, not correctness.

For each of 10 canonical product archetypes, we feed `/api/estimate` a
natural-language brief and score the produced scope against 16 operational
obligation categories. Three detectors are layered on top:

    1. Coverage matrix   — which categories were recognized at all
    2. False simplicity  — recognized but trivialized ("simple X")
    3. Asymmetry         — user-facing rich vs operator-facing absent

No prompts are modified. No retries. No LLM-as-judge. Deterministic classifier
only.

Output:
    /app/audit/scope-benchmark-corpus.json   — raw responses + classification
    /app/audit/SCOPE_BENCHMARK_<date>.md     — human-readable report

Usage:
    python3 scripts/scope-benchmark-corpus.py
    python3 scripts/scope-benchmark-corpus.py --archetypes slack,linear
    python3 scripts/scope-benchmark-corpus.py --json-only
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

API_BASE = os.environ.get("BENCHMARK_API_BASE", "http://localhost:8001")
ESTIMATE_PATH = "/api/estimate"
DEFAULT_MODE = "hybrid"  # matches default `/describe` visitor flow

# Where artifacts land
AUDIT_DIR = "/app/audit"
JSON_PATH = os.path.join(AUDIT_DIR, "scope-benchmark-corpus.json")
TODAY = dt.date.today().isoformat()
MD_PATH = os.path.join(AUDIT_DIR, f"SCOPE_BENCHMARK_{TODAY}.md")


# -----------------------------------------------------------------------------
# 10 canonical archetype briefs
# -----------------------------------------------------------------------------
# These are written as a real client would write them — natural, slightly
# informal, no scope ladder, no architecture hints. They're tuned to be ~80-160
# characters so they pass the `len(goal) >= 40` clarity gate but don't pre-bake
# operational structure for the LLM. Each maps to a row in
# PRICING_REVIEW_2026-05-18 corpus.
# -----------------------------------------------------------------------------

ARCHETYPES = [
    {
        "id": "slack",
        "name": "Slack clone (team chat MVP)",
        "brief": (
            "Build a team chat app where companies create workspaces, "
            "users join channels and DMs, send messages with attachments, "
            "and stay connected in real-time. Production product, not a demo."
        ),
    },
    {
        "id": "linear",
        "name": "Linear clone (issue tracker)",
        "brief": (
            "Build a fast issue tracker for software teams. Users create issues, "
            "assign owners, move them through statuses on a board, and see updates "
            "live as teammates work. Long-term product, multiple companies use it."
        ),
    },
    {
        "id": "stripe_for_x",
        "name": "Stripe-for-X (vertical payments platform)",
        "brief": (
            "Build a payments platform for a specific industry (think: Stripe for "
            "law firms). Merchants onboard, accept cards, manage chargebacks, "
            "see settlements, and reconcile their books. Production, multi-year horizon."
        ),
    },
    {
        "id": "b2b_crm",
        "name": "B2B CRM",
        "brief": (
            "Build a CRM for B2B sales teams: contacts, accounts, deals in a pipeline, "
            "activity timeline, email integration, reports. Each company has 20-200 reps. "
            "Real product, paying customers expected."
        ),
    },
    {
        "id": "ai_copilot",
        "name": "AI copilot (LLM product)",
        "brief": (
            "Build an AI copilot inside a domain SaaS app (e.g. legal). Users chat with the "
            "assistant, it pulls from their documents, drafts responses, learns their style. "
            "Production-grade product with paying users."
        ),
    },
    {
        "id": "infra_observability",
        "name": "Infrastructure observability platform",
        "brief": (
            "Build an observability platform: customers send logs/metrics/traces from their "
            "infrastructure, we ingest at scale, run queries, build dashboards, fire alerts. "
            "Multi-tenant, production, infra-grade reliability."
        ),
    },
    {
        "id": "marketplace",
        "name": "Two-sided marketplace",
        "brief": (
            "Build an online marketplace where buyers find services and sellers list offers, "
            "messages and bookings happen on-platform, payments held in escrow until delivery, "
            "with reviews and dispute handling. Real production product."
        ),
    },
    {
        "id": "multiplayer",
        "name": "Realtime multiplayer experience",
        "brief": (
            "Build a realtime multiplayer collaborative whiteboard. Multiple users see each "
            "other's cursors, edit shapes together with no flicker, comment, share via link. "
            "Production product, teams use it daily."
        ),
    },
    {
        "id": "banking_dashboard",
        "name": "Banking-grade financial dashboard",
        "brief": (
            "Build a financial dashboard for a fintech: customers see accounts, transactions, "
            "transfer money between accounts, set up scheduled payments, view statements. "
            "Production banking-grade product, regulated environment."
        ),
    },
    {
        "id": "enterprise_erp",
        "name": "Enterprise ERP system",
        "brief": (
            "Build an ERP for mid-size manufacturers: inventory, purchase orders, invoices, "
            "general ledger, customer/vendor records, basic HR, role-based access. "
            "Used by 50-500 employees per company. Production, long-term contract."
        ),
    },
]


# -----------------------------------------------------------------------------
# Operational obligation categories
# -----------------------------------------------------------------------------
# Each category has:
#   keywords  — phrases that count as "recognized" when matched anywhere in
#               module titles + descriptions + tech_stack + narrative_chips.
#   audience  — "user" | "operator" | "both", used for asymmetry detection.
# Keywords are intentionally conservative — generic terms like "user" don't
# match. We want false negatives over false positives so missing categories
# carry signal.
# -----------------------------------------------------------------------------

CATEGORIES = {
    "authentication_identity": {
        "audience": "both",
        "keywords": [
            "authentication", "auth ", "sign up", "sign-up", "signup", "sign in",
            "sign-in", "signin", "login", "log in", "log-in", "registration", "register",
            "password reset", "forgot password", "account recovery", "session",
            "oauth", "social auth", "social login", "sso", "single sign-on",
            "magic link", "passwordless", "jwt", "credentials",
        ],
    },
    "authorization_rbac": {
        "audience": "both",
        "keywords": [
            "role-based", "rbac", "roles and permissions", "permission",
            "access control", "acl", "scoped access", "admin role", "tenant isolation",
            "multi-tenant", "multi tenant", "workspace permissions", "team permissions",
            "user roles",
        ],
    },
    "data_persistence": {
        "audience": "operator",
        "keywords": [
            "migration", "schema migration", "database schema", "data model",
            "consistency", "transaction", "acid", "data store", "persistence layer",
            "indexes", "indexing strategy", "data versioning",
        ],
    },
    "admin_operations": {
        "audience": "operator",
        "keywords": [
            "admin panel", "admin dashboard", "backoffice", "back office",
            "moderation", "manual intervention", "support tool", "operator console",
            "internal tooling", "admin tools", "admin interface", "ops dashboard",
            "moderator", "admin workflow", "manage users", "user management",
        ],
    },
    "observability_monitoring": {
        "audience": "operator",
        "keywords": [
            "logging", "logs ", "monitoring", "metrics", "telemetry",
            "error tracking", "error reporting", "alerting", "alert system",
            "audit log", "audit trail", "observability", "sentry", "datadog",
            "prometheus", "grafana", "tracing", "distributed tracing", "apm",
        ],
    },
    "deployment_infrastructure": {
        "audience": "operator",
        "keywords": [
            "ci/cd", "ci / cd", "continuous integration", "continuous deployment",
            "deployment pipeline", "deploy pipeline", "docker", "kubernetes",
            "infrastructure", "infra-as-code", "terraform", "ansible",
            "auto-scaling", "scaling strategy", "horizontal scale",
            "staging environment", "production environment", "hosting",
            "load balancer", "cdn", "cloudfront",
        ],
    },
    "payments_billing": {
        "audience": "both",
        "keywords": [
            "payment", "billing", "subscription", "invoicing", "invoice",
            "refund", "chargeback", "webhook", "stripe", "paypal", "checkout",
            "settlement", "reconciliation", "dunning", "payout", "escrow",
            "transaction fee", "tax handling", "vat",
        ],
    },
    "realtime_synchronization": {
        "audience": "user",
        "keywords": [
            "websocket", "web socket", "real-time", "realtime", "real time",
            "live update", "live sync", "presence", "presence indicator",
            "live state", "live cursor", "live cursors", "live notification",
            "push update", "pub/sub", "pubsub", "server-sent events",
            "socket.io", "ably", "pusher",
        ],
    },
    "integrations_external": {
        "audience": "operator",
        "keywords": [
            "third-party api", "third party api", "api integration",
            "webhook handler", "webhook handling", "webhook retry",
            "external integration", "vendor api", "rate limit handling",
            "integration retry", "retry policy", "circuit breaker",
            "webhook validation",
        ],
    },
    "ai_orchestration": {
        "audience": "operator",
        "keywords": [
            "prompt engineering", "prompt template", "context window",
            "embedding", "vector search", "vector store", "vector db",
            "model fallback", "model selection", "llm rate limit",
            "openai", "gpt-", "claude", "gemini", "llm orchestration",
            "rag ", "retrieval-augmented", "function calling",
        ],
    },
    "reliability_recovery": {
        "audience": "operator",
        "keywords": [
            "retry logic", "retry policy", "retries", "idempotency", "idempotent",
            "backup", "backup strategy", "disaster recovery", "failure recovery",
            "graceful degradation", "circuit breaker", "fallback strategy",
            "dead letter queue", "dlq", "outbox pattern",
        ],
    },
    "compliance_security": {
        "audience": "operator",
        "keywords": [
            "gdpr", "hipaa", "sox", "pci", "soc2", "soc 2", "compliance",
            "encryption at rest", "encryption in transit", "data privacy",
            "privacy policy", "consent management", "data retention",
            "data deletion", "right to be forgotten", "audit trail",
            "access logs", "security review",
        ],
    },
    "collaboration_multiplayer": {
        "audience": "user",
        "keywords": [
            "comments", "commenting", "comment thread", "shared editing",
            "co-editing", "concurrent editing", "optimistic locking",
            "conflict resolution", "operational transform", "crdt",
            "shared workspace", "shared document", "shared session",
            "@mention", "mentions", "reactions",
        ],
    },
    "notifications_delivery": {
        "audience": "both",
        "keywords": [
            "email notification", "push notification", "in-app notification",
            "notification center", "notification delivery", "transactional email",
            "email service", "sendgrid", "resend", "postmark",
            "expo notification", "fcm", "apn ", "delivery guarantee",
            "notification preference", "opt-out", "unsubscribe",
        ],
    },
    "analytics_reporting": {
        "audience": "both",
        "keywords": [
            "analytics", "dashboard", "report", "reporting", "business metric",
            "kpi", "data export", "csv export", "excel export", "bi integration",
            "tableau", "looker", "metabase", "mixpanel", "amplitude", "segment",
            "funnel analysis", "cohort analysis",
        ],
    },
    "qa_edge_cases": {
        "audience": "operator",
        "keywords": [
            "validation", "input validation", "form validation", "error handling",
            "error state", "race condition", "edge case", "malformed input",
            "unit test", "integration test", "e2e test", "end-to-end test",
            "test coverage", "qa process", "regression test",
        ],
    },
}


# Modifiers that, when found near a recognized keyword, flag "false simplicity"
FALSE_SIMPLICITY_TRIGGERS = [
    "simple", "basic", "minimal", "lightweight", "straightforward", "easy",
    "quick", "just ", "small ", "trivial",
]


# -----------------------------------------------------------------------------
# Core: hit /api/estimate, classify, aggregate
# -----------------------------------------------------------------------------


def call_estimate(brief: str, timeout: int = 60) -> dict:
    body = json.dumps({"goal": brief, "mode": DEFAULT_MODE, "infer_axes": True}).encode("utf-8")
    req = urllib.request.Request(
        f"{API_BASE}{ESTIMATE_PATH}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    elapsed = time.time() - started
    payload = json.loads(raw)
    payload["_elapsed_seconds"] = round(elapsed, 2)
    payload["_http_status"] = resp.status
    return payload


def flatten_response_text(response: dict) -> str:
    """Concatenate all the surfaces the classifier should inspect."""
    chunks = []
    for mod in response.get("modules_detailed", []) or []:
        chunks.append(str(mod.get("title", "")))
        chunks.append(str(mod.get("description", "")))
    for mod in response.get("modules_preview", []) or []:
        if isinstance(mod, str):
            chunks.append(mod)
    for stack in response.get("tech_stack", []) or []:
        chunks.append(str(stack))
    rl = response.get("reality_layer") or {}
    for chip in rl.get("narrative_chips", []) or []:
        chunks.append(str(chip))
    return "\n".join(chunks).lower()


def find_keyword_hits(text: str, keywords: list) -> list:
    """Return list of (keyword, context_snippet) tuples."""
    hits = []
    for kw in keywords:
        # Compile as case-insensitive substring with word-boundary on the right
        # when kw doesn't end in space. Left side is more lenient because some
        # keywords like 'auth ' already include trailing space.
        pattern = re.compile(r"(?<![a-z])" + re.escape(kw.strip()) + r"(?![a-z])", re.IGNORECASE)
        for m in pattern.finditer(text):
            start = max(0, m.start() - 40)
            end = min(len(text), m.end() + 40)
            hits.append((kw.strip(), text[start:end].strip()))
    return hits


def classify_response(response: dict) -> dict:
    text = flatten_response_text(response)
    per_category = {}
    for cat, cfg in CATEGORIES.items():
        hits = find_keyword_hits(text, cfg["keywords"])
        false_simplicity = False
        false_simplicity_evidence = None
        if hits:
            # Look at context windows for trivializing modifiers
            for kw, ctx in hits:
                for trig in FALSE_SIMPLICITY_TRIGGERS:
                    if trig in ctx:
                        # Make sure the trigger appears *before* the keyword, not
                        # arbitrary distance. Concretely, the keyword should be
                        # within 25 chars after the trigger in the snippet.
                        idx_trig = ctx.find(trig)
                        idx_kw = ctx.find(kw)
                        if 0 <= idx_trig < idx_kw and idx_kw - idx_trig <= 30:
                            false_simplicity = True
                            false_simplicity_evidence = ctx
                            break
                if false_simplicity:
                    break
        per_category[cat] = {
            "recognized": bool(hits),
            "audience": cfg["audience"],
            "matched_keywords": sorted({kw for kw, _ in hits}),
            "hit_count": len(hits),
            "false_simplicity": false_simplicity,
            "false_simplicity_evidence": false_simplicity_evidence,
        }
    return per_category


def compute_asymmetry(per_category: dict) -> dict:
    user_categories = [c for c, cfg in CATEGORIES.items() if cfg["audience"] in ("user", "both")]
    operator_categories = [c for c, cfg in CATEGORIES.items() if cfg["audience"] in ("operator", "both")]
    user_hits = sum(1 for c in user_categories if per_category[c]["recognized"])
    operator_hits = sum(1 for c in operator_categories if per_category[c]["recognized"])
    user_total = len(user_categories)
    operator_total = len(operator_categories)
    user_cov = user_hits / max(user_total, 1)
    operator_cov = operator_hits / max(operator_total, 1)
    # Asymmetry ratio with small epsilon to avoid div-by-zero
    asymmetry_ratio = user_cov / max(operator_cov, 0.01)
    return {
        "user_side_coverage": round(user_cov, 3),
        "operator_side_coverage": round(operator_cov, 3),
        "user_recognized": user_hits,
        "operator_recognized": operator_hits,
        "user_total": user_total,
        "operator_total": operator_total,
        "asymmetry_ratio": round(asymmetry_ratio, 3),
        "asymmetric_high": asymmetry_ratio > 1.5,
    }


# -----------------------------------------------------------------------------
# Markdown report
# -----------------------------------------------------------------------------


def render_markdown(corpus: dict) -> str:
    lines = []
    lines.append(f"# Scope Perception Benchmark — {corpus['generated_at']}")
    lines.append("")
    lines.append(
        "> Diagnostic corpus. Measures *operational perception*, not correctness. "
        "Charter: `/app/docs/scope-benchmark-charter.md`."
    )
    lines.append("")
    lines.append(f"- Endpoint: `POST {API_BASE}{ESTIMATE_PATH}` (mode `{DEFAULT_MODE}`, infer_axes=true)")
    lines.append(f"- Archetypes: **{len(corpus['rows'])}**")
    lines.append(f"- Categories: **{len(CATEGORIES)}** operational obligations")
    lines.append(f"- LLM-as-judge: ❌ (deterministic keyword classifier)")
    lines.append("")

    # --- Section 1: Recognition rate per category (aggregate) ----------------
    lines.append("## 1. Recognition rate per operational category")
    lines.append("")
    lines.append("Across all archetypes — fraction where the model surfaced at least one keyword.")
    lines.append("")
    lines.append("| Category | Recognized / Total | % | Audience |")
    lines.append("|----------|---------------------|---|----------|")
    n_rows = len(corpus["rows"])
    per_cat_agg = {}
    for cat in CATEGORIES:
        hits = sum(1 for row in corpus["rows"] if row["classification"][cat]["recognized"])
        per_cat_agg[cat] = hits
        pct = hits / max(n_rows, 1) * 100
        bar = "█" * int(round(pct / 10))
        lines.append(
            f"| `{cat}` | {hits}/{n_rows} | {pct:>5.1f}%  `{bar:<10}` | {CATEGORIES[cat]['audience']} |"
        )
    lines.append("")

    # --- Section 2: Coverage matrix per archetype ----------------------------
    lines.append("## 2. Coverage matrix (per archetype × category)")
    lines.append("")
    lines.append(
        "`●` = recognized, `○` = absent, `!` = recognized but flagged as **false simplicity**."
    )
    lines.append("")
    # Header
    short_names = [c.split("_")[0][:6] for c in CATEGORIES]
    lines.append("| Archetype | " + " | ".join(short_names) + " |")
    lines.append("|" + "|".join(["---"] * (len(CATEGORIES) + 1)) + "|")
    for row in corpus["rows"]:
        cells = []
        for cat in CATEGORIES:
            cls = row["classification"][cat]
            if cls["false_simplicity"]:
                cells.append("!")
            elif cls["recognized"]:
                cells.append("●")
            else:
                cells.append("○")
        lines.append(f"| {row['archetype_id']} | " + " | ".join(cells) + " |")
    lines.append("")
    lines.append("Category short-keys: " + ", ".join(f"`{c.split('_')[0][:6]}`=`{c}`" for c in CATEGORIES))
    lines.append("")

    # --- Section 3: Operational asymmetry ------------------------------------
    lines.append("## 3. Operational asymmetry (user-side vs operator-side coverage)")
    lines.append("")
    lines.append(
        "Asymmetry ratio = `user_coverage / operator_coverage`. "
        "Values > 1.5 indicate **builder-not-operator** cognition (rich user-facing scope, blind operator scope)."
    )
    lines.append("")
    lines.append("| Archetype | User cov | Operator cov | Ratio | Flag |")
    lines.append("|-----------|----------|--------------|-------|------|")
    for row in corpus["rows"]:
        a = row["asymmetry"]
        flag = "⚠ high" if a["asymmetric_high"] else ""
        lines.append(
            f"| {row['archetype_id']} | {a['user_side_coverage']:.2f} "
            f"({a['user_recognized']}/{a['user_total']}) | "
            f"{a['operator_side_coverage']:.2f} ({a['operator_recognized']}/{a['operator_total']}) | "
            f"{a['asymmetry_ratio']:.2f} | {flag} |"
        )
    lines.append("")

    # --- Section 4: False simplicity findings --------------------------------
    lines.append("## 4. False simplicity flags (complexity collapse)")
    lines.append("")
    lines.append(
        "The model **named** the responsibility but framed it with trivializing modifiers "
        "(\"simple\", \"basic\", \"minimal\", \"just\", ...). These are more dangerous than outright "
        "omissions because they create false confidence."
    )
    lines.append("")
    any_fs = False
    for row in corpus["rows"]:
        flagged = [
            (cat, cls)
            for cat, cls in row["classification"].items()
            if cls["false_simplicity"]
        ]
        if not flagged:
            continue
        any_fs = True
        lines.append(f"### `{row['archetype_id']}` — {row['archetype_name']}")
        for cat, cls in flagged:
            ev = cls.get("false_simplicity_evidence") or ""
            lines.append(f"- **`{cat}`** → evidence: *…{ev[:120]}…*")
        lines.append("")
    if not any_fs:
        lines.append("_No false-simplicity flags fired in this corpus run._")
        lines.append("")

    # --- Section 5: Per-archetype quick scope summary ------------------------
    lines.append("## 5. Per-archetype quick summary")
    lines.append("")
    for row in corpus["rows"]:
        lines.append(f"### `{row['archetype_id']}` — {row['archetype_name']}")
        est = row.get("estimate") or {}
        rl = row.get("reality_layer") or {}
        lines.append(
            f"- implementation_price: **${est.get('implementation_price', 0):,.0f}**  ·  "
            f"final_price: **${est.get('final_price', 0):,.0f}**  ·  "
            f"reality_multiplier: ×{est.get('reality_multiplier', 1.0):.2f}"
        )
        lines.append(
            f"- estimated_hours: **{est.get('estimated_hours') or '—'}**  ·  "
            f"complexity: **{est.get('complexity', '—')}**  ·  "
            f"confidence: **{row.get('confidence', '—')}**"
        )
        chips = rl.get("narrative_chips") or []
        lines.append(f"- narrative_chips: {', '.join(f'`{c}`' for c in chips) if chips else '_(none)_'}")
        modules = row.get("modules_detailed") or []
        if modules:
            lines.append("- modules:")
            for m in modules[:10]:
                title = m.get("title", "")
                desc = m.get("description", "")
                hrs = m.get("hours", 0)
                lines.append(f"  - **{title}** ({hrs}h) — {desc}")
        lines.append(
            f"- recognized categories: {row['asymmetry']['user_recognized'] + row['asymmetry']['operator_recognized']}/{len(CATEGORIES)}"
        )
        missing = [c for c, cls in row["classification"].items() if not cls["recognized"]]
        if missing:
            lines.append(f"- **missing categories ({len(missing)})**: " + ", ".join(f"`{m}`" for m in missing))
        lines.append("")

    # --- Section 6: Takeaways ------------------------------------------------
    lines.append("## 6. Aggregate takeaways")
    lines.append("")
    # Lowest-recognition categories
    sorted_cats = sorted(per_cat_agg.items(), key=lambda x: x[1])
    lines.append("**Most blind categories** (lowest recognition across corpus):")
    for cat, hits in sorted_cats[:5]:
        lines.append(f"- `{cat}` — {hits}/{n_rows} recognized")
    lines.append("")
    lines.append("**Best-perceived categories** (highest recognition):")
    for cat, hits in sorted_cats[-5:][::-1]:
        lines.append(f"- `{cat}` — {hits}/{n_rows} recognized")
    lines.append("")
    asym_count = sum(1 for row in corpus["rows"] if row["asymmetry"]["asymmetric_high"])
    lines.append(f"**Asymmetric archetypes (ratio > 1.5)**: {asym_count}/{n_rows}")
    fs_count = sum(
        1 for row in corpus["rows"]
        for cls in row["classification"].values()
        if cls["false_simplicity"]
    )
    lines.append(f"**False-simplicity flags fired**: {fs_count}")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("_This report is generated. Raw JSON: `/app/audit/scope-benchmark-corpus.json`._")

    return "\n".join(lines)


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--archetypes",
        type=str,
        default="",
        help="Comma-separated archetype IDs (default: all 10)",
    )
    parser.add_argument(
        "--json-only",
        action="store_true",
        help="Skip markdown render",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=90,
        help="HTTP timeout in seconds for each /api/estimate call",
    )
    args = parser.parse_args()

    selected_ids = set([s.strip() for s in args.archetypes.split(",") if s.strip()])
    archetypes = [a for a in ARCHETYPES if not selected_ids or a["id"] in selected_ids]
    if not archetypes:
        print(f"No archetypes match: {selected_ids}", file=sys.stderr)
        return 2

    print(f"=== Scope Perception Benchmark ===")
    print(f"  archetypes: {len(archetypes)}")
    print(f"  categories: {len(CATEGORIES)}")
    print(f"  endpoint: {API_BASE}{ESTIMATE_PATH}")
    print()

    rows = []
    for i, arch in enumerate(archetypes, 1):
        print(f"[{i}/{len(archetypes)}] {arch['id']:<22} ...", end="", flush=True)
        try:
            response = call_estimate(arch["brief"], timeout=args.timeout)
        except urllib.error.HTTPError as e:
            print(f" FAIL HTTP {e.code} — {e.read()[:200].decode('utf-8', 'replace')}")
            continue
        except Exception as e:
            print(f" FAIL {type(e).__name__}: {e}")
            continue

        if response.get("clarity") != "good":
            print(f" SKIP clarity={response.get('clarity')!r}")
            continue

        classification = classify_response(response)
        asymmetry = compute_asymmetry(classification)
        print(
            f" ok {response['_elapsed_seconds']:>5.1f}s   "
            f"impl=${response['estimate']['implementation_price']:>9,.0f}  "
            f"final=${response['estimate']['final_price']:>9,.0f}  "
            f"hrs={response['estimate'].get('estimated_hours') or '-'}  "
            f"recog={asymmetry['user_recognized']+asymmetry['operator_recognized']}/{len(CATEGORIES)}  "
            f"asym={asymmetry['asymmetry_ratio']:.2f}"
        )

        rows.append({
            "archetype_id": arch["id"],
            "archetype_name": arch["name"],
            "brief": arch["brief"],
            "estimate": response.get("estimate"),
            "reality_layer": response.get("reality_layer"),
            "modules_detailed": response.get("modules_detailed"),
            "modules_preview": response.get("modules_preview"),
            "tech_stack": response.get("tech_stack"),
            "complexity": response.get("estimate", {}).get("complexity"),
            "confidence": response.get("confidence"),
            "ai_generated": response.get("ai_generated"),
            "matched_template": response.get("matched_template"),
            "goal_length": response.get("goal_length"),
            "elapsed_seconds": response.get("_elapsed_seconds"),
            "classification": classification,
            "asymmetry": asymmetry,
        })

    corpus = {
        "generated_at": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "endpoint": f"{API_BASE}{ESTIMATE_PATH}",
        "mode": DEFAULT_MODE,
        "categories": {
            c: {"audience": cfg["audience"], "keyword_count": len(cfg["keywords"])}
            for c, cfg in CATEGORIES.items()
        },
        "archetype_count": len(rows),
        "rows": rows,
    }

    os.makedirs(AUDIT_DIR, exist_ok=True)
    with open(JSON_PATH, "w") as f:
        json.dump(corpus, f, indent=2)
    print()
    print(f"JSON  → {JSON_PATH}  ({os.path.getsize(JSON_PATH):,} bytes)")

    if not args.json_only:
        md = render_markdown(corpus)
        with open(MD_PATH, "w") as f:
            f.write(md)
        print(f"MD    → {MD_PATH}  ({os.path.getsize(MD_PATH):,} bytes)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
