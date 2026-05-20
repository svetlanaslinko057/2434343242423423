#!/usr/bin/env python3
"""
Operational Reviewer Probe — generator → reviewer two-pass evaluation.

See `/app/docs/operational-reviewer-probe-charter.md` for full charter. TL;DR:

    Does the LLM perceive operational obligations when EXPLICITLY put into
    operator mode, even though it doesn't volunteer them in its natural
    production tendency?

Mechanics:
    Pass 1 — live POST /api/estimate (unchanged production)
    Pass 2 — direct LLM call with reviewer prompt + 16-item checklist
             returns structured JSON marking presence + required-or-not + suggested module

The reviewer's output is NEVER pushed back into pricing or any DB write.
We compute delta classification + hallucination flags + cost-if-applied
purely as observation.

Usage:
    python3 scripts/scope-reviewer-probe.py
    python3 scripts/scope-reviewer-probe.py --archetypes slack,linear
    python3 scripts/scope-reviewer-probe.py --json-only
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request

# Make backend importable so we can reuse emergentintegrations + active key resolver
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from _operational_obligations import CATEGORIES  # noqa: E402

# Import the same archetype briefs as Pass-1 corpus runner
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
import importlib.util
_spec = importlib.util.spec_from_file_location(
    "scope_benchmark_corpus",
    os.path.join(os.path.dirname(__file__), "scope-benchmark-corpus.py"),
)
_corpus_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_corpus_mod)
ARCHETYPES = _corpus_mod.ARCHETYPES
flatten_response_text = _corpus_mod.flatten_response_text
find_keyword_hits = _corpus_mod.find_keyword_hits
classify_response = _corpus_mod.classify_response


# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

API_BASE = os.environ.get("BENCHMARK_API_BASE", "http://localhost:8001")
ESTIMATE_PATH = "/api/estimate"
DEFAULT_MODE = "hybrid"
RATE_PER_HOUR = 65  # informational only — for "cost-if-applied" delta

AUDIT_DIR = "/app/audit"
JSON_PATH = os.path.join(AUDIT_DIR, "scope-reviewer-corpus.json")
TODAY = dt.date.today().isoformat()
MD_PATH = os.path.join(AUDIT_DIR, f"SCOPE_REVIEWER_{TODAY}.md")


# -----------------------------------------------------------------------------
# Pass 1 — live /api/estimate
# -----------------------------------------------------------------------------


def pass1_estimate(brief: str, timeout: int = 90) -> dict:
    body = json.dumps({"goal": brief, "mode": DEFAULT_MODE, "infer_axes": True}).encode("utf-8")
    req = urllib.request.Request(
        f"{API_BASE}{ESTIMATE_PATH}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    elapsed = round(time.time() - t0, 2)
    payload = json.loads(raw)
    payload["_elapsed_seconds"] = elapsed
    return payload


# -----------------------------------------------------------------------------
# Pass 2 — direct LLM reviewer call
# -----------------------------------------------------------------------------


def _load_backend_env():
    """Load /app/backend/.env into os.environ so admin_llm_settings can see keys."""
    try:
        with open("/app/backend/.env") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except OSError:
        pass


def _resolve_llm_key() -> dict:
    """Resolve active LLM key via existing backend mechanism (so probe inherits same provider)."""
    _load_backend_env()
    try:
        import asyncio
        from admin_llm_settings import get_active_llm_key  # type: ignore
        return asyncio.run(get_active_llm_key())
    except Exception:
        key = os.environ.get("EMERGENT_LLM_KEY", "")
        return {"key": key, "provider": "emergent", "source": "env", "model": "gpt-4o-mini"}


def _build_reviewer_prompts(brief: str, pass1_modules: list) -> tuple:
    """Return (system_message, user_message). Reviewer is told to be honest, not exhaustive."""
    checklist_lines = []
    for cat, cfg in CATEGORIES.items():
        checklist_lines.append(f"- `{cat}` ({cfg['audience']}): {cfg['description']}")
    checklist = "\n".join(checklist_lines)

    modules_text = "\n".join(
        f"  {i+1}. {m.get('title', '')} ({m.get('hours', 0)}h) — {m.get('description', '')}"
        for i, m in enumerate(pass1_modules or [])
    ) or "  (no modules in draft)"

    system_message = (
        "You are a senior production engineer reviewing a project scope for OPERATIONAL completeness. "
        "Your job is NOT to expand scope. Your job is to honestly evaluate whether the draft scope "
        "covers responsibility classes that emerge in PRODUCTION operations — not user-facing features.\n\n"
        "For each item in the 16-category checklist, you decide TWO things:\n"
        "  1. `present_in_draft`: bool — does the draft already cover this category?\n"
        "  2. `required_for_archetype`: bool — is this category genuinely needed for THIS specific product?\n"
        "  3. `gap_severity`: 'critical' | 'important' | 'nice_to_have' | 'not_applicable'\n"
        "If present_in_draft=false AND required_for_archetype=true, suggest a module: {title, description, hours}\n"
        "  (title ≤ 4 words, description ≤ 15 words, hours = integer estimate)\n"
        "If a category is genuinely NOT applicable to this archetype, mark required_for_archetype=false. "
        "DO NOT pad the checklist with irrelevant categories. Honesty about non-applicability is more "
        "valuable than checklist completeness.\n\n"
        "Return ONLY valid JSON with this exact shape:\n"
        '{"review": [{"category": "...", "present_in_draft": bool, "required_for_archetype": bool, '
        '"gap_severity": "...", "suggested_module": {"title": "...", "description": "...", "hours": N} | null, '
        '"note": "1 sentence rationale"}], '
        '"summary_note": "1-2 sentences on overall operational maturity"}'
    )

    user_message = (
        f"BRIEF:\n{brief}\n\n"
        f"DRAFT SCOPE (from Pass 1 generator):\n{modules_text}\n\n"
        f"CHECKLIST — 16 operational obligation categories:\n{checklist}\n\n"
        f"REVIEW. Return JSON only."
    )
    return system_message, user_message


def pass2_reviewer(brief: str, pass1_modules: list, llm_config: dict, timeout: int = 90) -> dict:
    """Direct out-of-band LLM call. Returns parsed JSON or raises."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore

    key = llm_config.get("key") or ""
    if not key:
        raise RuntimeError("No LLM key resolved for reviewer pass")
    model = llm_config.get("model") or "gpt-4o-mini"

    system_message, user_message = _build_reviewer_prompts(brief, pass1_modules)

    chat = LlmChat(
        api_key=key,
        session_id=f"reviewer_{int(time.time()*1000)}",
        system_message=system_message,
    ).with_model("openai", model)

    t0 = time.time()
    # emergentintegrations LlmChat is async — run in event loop
    import asyncio
    raw = asyncio.run(chat.send_message(UserMessage(text=user_message)))
    elapsed = round(time.time() - t0, 2)
    if isinstance(raw, dict):
        text = raw.get("text") or raw.get("content") or str(raw)
    else:
        text = str(raw)

    # Strip code fences if model wrapped JSON in markdown
    t = text.strip()
    if t.startswith("```"):
        # remove the first line
        t = "\n".join(t.split("\n")[1:])
        if t.endswith("```"):
            t = t[: -3]
    t = t.strip()
    try:
        parsed = json.loads(t)
    except json.JSONDecodeError as e:
        return {"_raw": text, "_error": f"JSON decode failed: {e}", "_elapsed_seconds": elapsed}
    parsed["_elapsed_seconds"] = elapsed
    parsed["_raw_chars"] = len(text)
    return parsed


# -----------------------------------------------------------------------------
# Comparison + classification
# -----------------------------------------------------------------------------


def build_combined_modules(pass1_modules: list, pass2_review: dict) -> list:
    """Concatenate Pass 1 modules with Pass 2 suggested modules for combined classification."""
    out = list(pass1_modules or [])
    for entry in (pass2_review or {}).get("review", []):
        sm = entry.get("suggested_module")
        if sm:
            out.append({
                "title": sm.get("title", ""),
                "description": sm.get("description", ""),
                "hours": int(sm.get("hours", 0) or 0),
                "_source": "pass2_reviewer",
            })
    return out


def compare_classifications(pass1_cls: dict, combined_cls: dict, pass2_review: dict) -> dict:
    """Compute delta + reviewer-vs-classifier agreement + hallucination flags."""
    delta = {}
    reviewer_index = {entry["category"]: entry for entry in (pass2_review or {}).get("review", []) if entry.get("category") in CATEGORIES}
    hallucinated_categories = []
    classifier_vs_reviewer_disagreement = []
    suggested_hours_total = 0

    for cat in CATEGORIES:
        p1 = pass1_cls.get(cat, {})
        pc = combined_cls.get(cat, {})
        r = reviewer_index.get(cat, {})

        p1_recog = bool(p1.get("recognized"))
        combined_recog = bool(pc.get("recognized"))
        closed_by_pass2 = (not p1_recog) and combined_recog

        # Reviewer's own claims
        r_present = bool(r.get("present_in_draft", False))
        r_required = bool(r.get("required_for_archetype", False))
        r_severity = r.get("gap_severity", "")
        r_suggested = r.get("suggested_module") or {}

        # Hallucination = reviewer suggested a module but ALSO said it's not required
        hallucinated = bool(r_suggested) and not r_required
        if hallucinated:
            hallucinated_categories.append(cat)

        # Disagreement between classifier (p1) and reviewer (r_present)
        disagreement = p1_recog != r_present
        if disagreement:
            classifier_vs_reviewer_disagreement.append({
                "category": cat,
                "classifier_says_recognized": p1_recog,
                "reviewer_says_present": r_present,
            })

        # Sum hours for "cost if applied"
        if r_suggested and r_required:
            suggested_hours_total += int(r_suggested.get("hours", 0) or 0)

        delta[cat] = {
            "pass1_recognized": p1_recog,
            "combined_recognized": combined_recog,
            "closed_by_pass2": closed_by_pass2,
            "reviewer_present_in_draft": r_present,
            "reviewer_required_for_archetype": r_required,
            "reviewer_gap_severity": r_severity,
            "reviewer_suggested_module": r_suggested or None,
            "hallucinated": hallucinated,
            "classifier_reviewer_disagreement": disagreement,
        }

    closed_count = sum(1 for d in delta.values() if d["closed_by_pass2"])
    return {
        "per_category": delta,
        "closed_by_pass2_count": closed_count,
        "hallucinated_categories": hallucinated_categories,
        "classifier_vs_reviewer_disagreements": classifier_vs_reviewer_disagreement,
        "suggested_hours_total": suggested_hours_total,
        "suggested_cost_if_applied_usd": round(suggested_hours_total * RATE_PER_HOUR, 2),
    }


# -----------------------------------------------------------------------------
# Markdown report
# -----------------------------------------------------------------------------


def render_markdown(corpus: dict) -> str:
    rows = corpus["rows"]
    n = len(rows)
    lines = []
    lines.append(f"# Scope Reviewer Probe — {corpus['generated_at']}")
    lines.append("")
    lines.append(
        "> Pass 1 = live `/api/estimate` (unchanged generator). Pass 2 = out-of-band LLM reviewer call. "
        "Charter: `/app/docs/operational-reviewer-probe-charter.md`."
    )
    lines.append("")
    lines.append(f"- Endpoint: `POST {API_BASE}{ESTIMATE_PATH}` (Pass 1)")
    lines.append(f"- Reviewer model: same key/provider as Pass 1, separate LlmChat session")
    lines.append(f"- Archetypes: **{n}**")
    lines.append(f"- Categories: **{len(CATEGORIES)}** operational obligations")
    lines.append("")

    # --- Section 1: Perception ceiling per category --------------------------
    lines.append("## 1. Perception ceiling — what Pass 2 closed that Pass 1 missed")
    lines.append("")
    lines.append("| Category | Pass 1 (corpus) | Pass 2 closed | Combined | Audience |")
    lines.append("|----------|-----------------|---------------|----------|----------|")
    for cat in CATEGORIES:
        p1_hits = sum(1 for r in rows if r["delta"]["per_category"][cat]["pass1_recognized"])
        closed = sum(1 for r in rows if r["delta"]["per_category"][cat]["closed_by_pass2"])
        combined = sum(1 for r in rows if r["delta"]["per_category"][cat]["combined_recognized"])
        lines.append(
            f"| `{cat}` | {p1_hits}/{n} | +{closed} | {combined}/{n} | {CATEGORIES[cat]['audience']} |"
        )
    lines.append("")

    # --- Section 2: Required-for-archetype matrix ----------------------------
    lines.append("## 2. Reviewer's required-for-archetype matrix")
    lines.append("")
    lines.append(
        "`R` = reviewer says required for this archetype, `-` = not required, `?` = no answer. "
        "Read across to see which categories the reviewer thinks each archetype actually needs."
    )
    lines.append("")
    short_names = [c.split("_")[0][:6] for c in CATEGORIES]
    lines.append("| Archetype | " + " | ".join(short_names) + " |")
    lines.append("|" + "|".join(["---"] * (len(CATEGORIES) + 1)) + "|")
    for r in rows:
        cells = []
        for cat in CATEGORIES:
            d = r["delta"]["per_category"][cat]
            if d["reviewer_required_for_archetype"]:
                cells.append("R")
            elif d["reviewer_present_in_draft"] or d["combined_recognized"]:
                cells.append("·")
            else:
                cells.append("-")
        lines.append(f"| {r['archetype_id']} | " + " | ".join(cells) + " |")
    lines.append("")
    lines.append("Category short-keys: " + ", ".join(f"`{c.split('_')[0][:6]}`=`{c}`" for c in CATEGORIES))
    lines.append("")

    # --- Section 3: Hallucination flags --------------------------------------
    lines.append("## 3. Hallucination check (suggested module + not_required)")
    lines.append("")
    lines.append(
        "These are categories where the reviewer suggested a module BUT ALSO marked the category as "
        "not required for the archetype. Forced compliance answers, not real perception."
    )
    lines.append("")
    any_hall = False
    for r in rows:
        cats = r["delta"]["hallucinated_categories"]
        if not cats:
            continue
        any_hall = True
        lines.append(f"- `{r['archetype_id']}`: {', '.join(f'`{c}`' for c in cats)}")
    if not any_hall:
        lines.append("_No hallucination flags fired. Reviewer was internally consistent across the corpus._")
    lines.append("")

    # --- Section 4: Classifier vs Reviewer agreement -------------------------
    lines.append("## 4. Classifier vs Reviewer disagreement")
    lines.append("")
    lines.append(
        "Where the deterministic Pass-1 classifier sees a category as recognized but the reviewer says "
        "`present_in_draft: false` — or vice versa. Calibrates how much to trust each."
    )
    lines.append("")
    total_disagreements = 0
    for r in rows:
        d = r["delta"]["classifier_vs_reviewer_disagreements"]
        if not d:
            continue
        total_disagreements += len(d)
        lines.append(f"### `{r['archetype_id']}`")
        for entry in d:
            cls_label = "classifier=●" if entry["classifier_says_recognized"] else "classifier=○"
            rev_label = "reviewer=●" if entry["reviewer_says_present"] else "reviewer=○"
            lines.append(f"- `{entry['category']}` — {cls_label} / {rev_label}")
        lines.append("")
    lines.append(f"**Total disagreements across corpus: {total_disagreements}**")
    lines.append("")

    # --- Section 5: Cost if applied ------------------------------------------
    lines.append("## 5. Cost of operator-awareness if applied (informational only)")
    lines.append("")
    lines.append("**This is NOT pushed into the pricing engine.** It's the back-of-envelope number for discussion.")
    lines.append("")
    lines.append("| Archetype | Pass 1 hours | Suggested hours | Δ hours | Pass 1 impl. price | Δ cost @ $65/h |")
    lines.append("|-----------|--------------|-----------------|---------|---------------------|----------------|")
    total_p1_h = 0
    total_sug_h = 0
    for r in rows:
        p1_h = (r.get("pass1", {}).get("estimate") or {}).get("estimated_hours") or 0
        sug_h = r["delta"]["suggested_hours_total"]
        p1_price = (r.get("pass1", {}).get("estimate") or {}).get("implementation_price") or 0
        delta_cost = r["delta"]["suggested_cost_if_applied_usd"]
        total_p1_h += p1_h
        total_sug_h += sug_h
        lines.append(
            f"| {r['archetype_id']} | {p1_h} | +{sug_h} | +{sug_h} | ${p1_price:,.0f} | +${delta_cost:,.0f} |"
        )
    lines.append(
        f"| **total** | **{total_p1_h}** | **+{total_sug_h}** | **+{total_sug_h}** | — | **+${total_sug_h * RATE_PER_HOUR:,.0f}** |"
    )
    if total_p1_h > 0:
        inflation = total_sug_h / total_p1_h * 100
        lines.append("")
        lines.append(f"**Corpus-wide cost inflation if Pass-2 adopted: +{inflation:.1f}%**")
    lines.append("")

    # --- Section 6: Per-archetype detail -------------------------------------
    lines.append("## 6. Per-archetype detail")
    lines.append("")
    for r in rows:
        p1 = r.get("pass1", {})
        rev = r.get("pass2_review", {})
        lines.append(f"### `{r['archetype_id']}` — {r['archetype_name']}")
        lines.append(f"- Reviewer summary: *{rev.get('summary_note', '—')}*")
        lines.append(f"- Pass 1 hours: **{(p1.get('estimate') or {}).get('estimated_hours') or '—'}** · Pass 2 suggested: **+{r['delta']['suggested_hours_total']}h**")
        closed = [c for c, d in r["delta"]["per_category"].items() if d["closed_by_pass2"]]
        if closed:
            lines.append(f"- Pass 2 closed: " + ", ".join(f"`{c}`" for c in closed))
        # Notable suggested modules (required + suggested)
        notable = []
        for cat, d in r["delta"]["per_category"].items():
            sm = d.get("reviewer_suggested_module") or {}
            if sm and d.get("reviewer_required_for_archetype"):
                notable.append((cat, sm))
        if notable:
            lines.append(f"- Required+suggested modules ({len(notable)}):")
            for cat, sm in notable[:8]:
                t = sm.get("title", "")
                h = sm.get("hours", 0)
                lines.append(f"  - `{cat}` → **{t}** ({h}h)")
        lines.append("")

    # --- Section 7: Aggregate verdict ----------------------------------------
    lines.append("## 7. Aggregate verdict (probe outcomes)")
    lines.append("")
    # Categories where Pass 2 closed >= 80% of remaining gap
    cat_close = {}
    for cat in CATEGORIES:
        p1_hits = sum(1 for r in rows if r["delta"]["per_category"][cat]["pass1_recognized"])
        gap = n - p1_hits
        closed = sum(1 for r in rows if r["delta"]["per_category"][cat]["closed_by_pass2"])
        cat_close[cat] = (closed, gap)

    fully_closed = [c for c, (cl, gap) in cat_close.items() if gap > 0 and cl == gap]
    mostly_closed = [c for c, (cl, gap) in cat_close.items() if gap > 0 and cl / gap >= 0.5 and cl < gap]
    stubborn = [c for c, (cl, gap) in cat_close.items() if gap > 0 and cl / gap < 0.5]

    lines.append(f"**Fully closed by Pass 2** ({len(fully_closed)}): " + (", ".join(f"`{c}`" for c in fully_closed) if fully_closed else "_none_"))
    lines.append("")
    lines.append(f"**Mostly closed (≥50% of gap)** ({len(mostly_closed)}): " + (", ".join(f"`{c}`" for c in mostly_closed) if mostly_closed else "_none_"))
    lines.append("")
    lines.append(f"**Stubborn (Pass 2 didn't help)** ({len(stubborn)}): " + (", ".join(f"`{c}`" for c in stubborn) if stubborn else "_none_"))
    lines.append("")
    total_hall = sum(len(r["delta"]["hallucinated_categories"]) for r in rows)
    lines.append(f"**Total hallucination flags**: {total_hall}")
    lines.append(f"**Total classifier-reviewer disagreements**: {total_disagreements}")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("_Raw data: `/app/audit/scope-reviewer-corpus.json`._")
    return "\n".join(lines)


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archetypes", type=str, default="", help="Comma-separated subset")
    parser.add_argument("--json-only", action="store_true")
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()

    selected_ids = set([s.strip() for s in args.archetypes.split(",") if s.strip()])
    archetypes = [a for a in ARCHETYPES if not selected_ids or a["id"] in selected_ids]
    if not archetypes:
        print(f"No archetypes match: {selected_ids}", file=sys.stderr)
        return 2

    llm_config = _resolve_llm_key()
    if not llm_config.get("key"):
        print("FATAL: no LLM key resolved (check EMERGENT_LLM_KEY or /admin/integrations)", file=sys.stderr)
        return 3

    print(f"=== Operational Reviewer Probe ===")
    print(f"  archetypes: {len(archetypes)}")
    print(f"  categories: {len(CATEGORIES)}")
    print(f"  endpoint:   {API_BASE}{ESTIMATE_PATH}")
    print(f"  reviewer:   {llm_config.get('provider')}/{llm_config.get('model')} (source={llm_config.get('source')})")
    print()

    rows = []
    for i, arch in enumerate(archetypes, 1):
        print(f"[{i:>2}/{len(archetypes)}] {arch['id']:<22}", end="", flush=True)

        # Pass 1
        try:
            p1 = pass1_estimate(arch["brief"], timeout=args.timeout)
        except Exception as e:
            print(f"  PASS1 FAIL {type(e).__name__}: {e}")
            continue
        if p1.get("clarity") != "good":
            print(f"  PASS1 SKIP clarity={p1.get('clarity')!r}")
            continue

        # Pass 1 classifier
        pass1_cls = classify_response(p1)

        # Pass 2
        try:
            p2 = pass2_reviewer(
                arch["brief"], p1.get("modules_detailed") or [],
                llm_config, timeout=args.timeout,
            )
        except Exception as e:
            print(f"  PASS2 FAIL {type(e).__name__}: {e}")
            continue
        if p2.get("_error"):
            print(f"  PASS2 PARSE_FAIL  raw={p2.get('_raw', '')[:80]!r}...")
            continue

        # Build combined modules + reclassify
        combined_modules = build_combined_modules(p1.get("modules_detailed") or [], p2)
        combined_response = dict(p1)
        combined_response["modules_detailed"] = combined_modules
        combined_cls = classify_response(combined_response)

        delta = compare_classifications(pass1_cls, combined_cls, p2)

        # Logging
        n_closed = delta["closed_by_pass2_count"]
        n_hall = len(delta["hallucinated_categories"])
        sug_h = delta["suggested_hours_total"]
        print(
            f"  p1={p1.get('_elapsed_seconds'):.1f}s p2={p2.get('_elapsed_seconds'):.1f}s  "
            f"closed={n_closed:>2}/16  hall={n_hall}  +{sug_h}h"
        )

        rows.append({
            "archetype_id": arch["id"],
            "archetype_name": arch["name"],
            "brief": arch["brief"],
            "pass1": {
                "estimate": p1.get("estimate"),
                "reality_layer": p1.get("reality_layer"),
                "modules_detailed": p1.get("modules_detailed"),
                "tech_stack": p1.get("tech_stack"),
                "ai_generated": p1.get("ai_generated"),
                "confidence": p1.get("confidence"),
                "elapsed_seconds": p1.get("_elapsed_seconds"),
            },
            "pass1_classification": pass1_cls,
            "pass2_review": p2,
            "combined_classification": combined_cls,
            "delta": delta,
        })

    corpus = {
        "generated_at": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "endpoint": f"{API_BASE}{ESTIMATE_PATH}",
        "mode": DEFAULT_MODE,
        "llm_provider": llm_config.get("provider"),
        "llm_model": llm_config.get("model"),
        "llm_source": llm_config.get("source"),
        "rate_per_hour_usd": RATE_PER_HOUR,
        "archetype_count": len(rows),
        "category_count": len(CATEGORIES),
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
