#!/usr/bin/env python3
"""
Classifier v2 probe — Hypothesis A test (read-only).

After Phase A graft, `reliability_recovery` and `qa_edge_cases` stayed at 0/10
in both pre-graft AND post-graft benchmark runs. Two hypotheses:

    A. Classifier keywords too strict — model emitted broader phrasing
       ("Quality Assurance", "Reliability Framework") that v1 keywords didn't match.
    B. Generator-mode reviewer-only — model genuinely can't surface these
       in generator mode even with explicit prompt invitation.

This probe re-classifies BOTH already-recorded corpora (pre-graft from
/app/audit/run1_pre_graft/ and post-graft from /app/audit/) using v2 keyword
set that extends only `reliability_recovery` and `qa_edge_cases`.

No LLM calls. No /api/estimate calls. No engine changes. Pure file IO + regex.

Outputs:
    /app/audit/classifier-v2-probe.json
    /app/audit/CLASSIFIER_V2_PROBE_<date>.md
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _operational_obligations import (  # noqa: E402
    CATEGORIES, CATEGORIES_V2_OVERRIDES, get_categories_v2,
)

# Reuse the same text-extraction + keyword-match helpers from the corpus runner
import importlib.util
_spec = importlib.util.spec_from_file_location(
    "scope_benchmark_corpus",
    os.path.join(os.path.dirname(__file__), "scope-benchmark-corpus.py"),
)
_corpus_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_corpus_mod)
flatten_response_text = _corpus_mod.flatten_response_text
find_keyword_hits = _corpus_mod.find_keyword_hits


PRE_GRAFT_JSON = "/app/audit/run1_pre_graft/scope-benchmark-corpus.json"
POST_GRAFT_JSON = "/app/audit/scope-benchmark-corpus.json"
TODAY = dt.date.today().isoformat()
OUT_JSON = "/app/audit/classifier-v2-probe.json"
OUT_MD = f"/app/audit/CLASSIFIER_V2_PROBE_{TODAY}.md"

# Categories whose v1 result we will compare against v2
TARGET_CATEGORIES = list(CATEGORIES_V2_OVERRIDES.keys())  # ['reliability_recovery','qa_edge_cases']


def classify_text_with(text: str, categories: dict) -> dict:
    """Run the same conservative classifier with a configurable category set."""
    out = {}
    for cat, cfg in categories.items():
        hits = find_keyword_hits(text, cfg["keywords"])
        out[cat] = {
            "recognized": bool(hits),
            "matched_keywords": sorted({kw for kw, _ in hits}),
            "hit_count": len(hits),
            "sample_evidence": (hits[0][1][:160] if hits else None),
        }
    return out


def load_corpus(path: str) -> dict:
    if not os.path.exists(path):
        raise FileNotFoundError(f"Corpus not found: {path}")
    with open(path) as f:
        return json.load(f)


def main() -> int:
    pre = load_corpus(PRE_GRAFT_JSON)
    post = load_corpus(POST_GRAFT_JSON)

    print(f"=== Classifier v2 probe (Hypothesis A test) ===")
    print(f"  pre-graft corpus:  {PRE_GRAFT_JSON}  ({len(pre['rows'])} rows)")
    print(f"  post-graft corpus: {POST_GRAFT_JSON}  ({len(post['rows'])} rows)")
    print(f"  target categories: {TARGET_CATEGORIES}")
    print(f"  v2 extra keywords:")
    for cat in TARGET_CATEGORIES:
        extras = CATEGORIES_V2_OVERRIDES[cat]["extra_keywords"]
        print(f"    {cat}: +{len(extras)} keywords")
    print()

    v2_categories = get_categories_v2()

    results = {
        "generated_at": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "pre_graft_source": PRE_GRAFT_JSON,
        "post_graft_source": POST_GRAFT_JSON,
        "target_categories": TARGET_CATEGORIES,
        "v2_extra_keyword_counts": {
            cat: len(CATEGORIES_V2_OVERRIDES[cat]["extra_keywords"])
            for cat in TARGET_CATEGORIES
        },
        "runs": {},
    }

    for run_name, corpus in (("pre_graft", pre), ("post_graft", post)):
        run_rows = []
        for row in corpus["rows"]:
            # Reconstruct the response-like dict so flatten_response_text works
            response_like = {
                "modules_detailed": row.get("modules_detailed"),
                "modules_preview": row.get("modules_preview"),
                "tech_stack": row.get("tech_stack"),
                "reality_layer": row.get("reality_layer"),
            }
            text = flatten_response_text(response_like)
            v1_per_cat = row.get("classification", {})
            v2_per_cat = classify_text_with(text, v2_categories)

            per_target = {}
            for cat in TARGET_CATEGORIES:
                v1 = v1_per_cat.get(cat, {})
                v2 = v2_per_cat.get(cat, {})
                per_target[cat] = {
                    "v1_recognized": bool(v1.get("recognized")),
                    "v2_recognized": bool(v2.get("recognized")),
                    "newly_recognized_v2": (not v1.get("recognized")) and v2.get("recognized"),
                    "v1_matched_keywords": v1.get("matched_keywords") or [],
                    "v2_matched_keywords": v2.get("matched_keywords") or [],
                    "v2_new_matches": sorted(
                        set(v2.get("matched_keywords") or []) - set(v1.get("matched_keywords") or [])
                    ),
                    "sample_evidence": v2.get("sample_evidence"),
                }
            run_rows.append({
                "archetype_id": row["archetype_id"],
                "archetype_name": row.get("archetype_name"),
                "ai_generated": row.get("ai_generated"),
                "per_target": per_target,
            })

        # Aggregate per-category v1 vs v2 counts
        agg = {}
        for cat in TARGET_CATEGORIES:
            v1_n = sum(1 for r in run_rows if r["per_target"][cat]["v1_recognized"])
            v2_n = sum(1 for r in run_rows if r["per_target"][cat]["v2_recognized"])
            agg[cat] = {
                "v1_recognized_count": v1_n,
                "v2_recognized_count": v2_n,
                "delta": v2_n - v1_n,
                "total_archetypes": len(run_rows),
            }
        results["runs"][run_name] = {"rows": run_rows, "aggregate": agg}
        print(f"  [{run_name}]")
        for cat, a in agg.items():
            print(f"    {cat}: v1={a['v1_recognized_count']}/{a['total_archetypes']} → v2={a['v2_recognized_count']}/{a['total_archetypes']} (Δ {a['delta']:+d})")
        print()

    # --- Verdict ---
    print("VERDICT:")
    pre_total_delta = sum(results["runs"]["pre_graft"]["aggregate"][c]["delta"] for c in TARGET_CATEGORIES)
    post_total_delta = sum(results["runs"]["post_graft"]["aggregate"][c]["delta"] for c in TARGET_CATEGORIES)
    print(f"  pre-graft  total v2-newly-recognized: +{pre_total_delta}")
    print(f"  post-graft total v2-newly-recognized: +{post_total_delta}")
    print()
    if post_total_delta > 0 and post_total_delta > pre_total_delta:
        print("  → Hypothesis A LIKELY: graft did surface these categories, v1 classifier missed them.")
    elif post_total_delta == 0:
        print("  → Hypothesis B LIKELY: even broad v2 keywords don't pick anything up — generator-mode genuinely doesn't produce these in any form.")
    elif post_total_delta > 0 and pre_total_delta > 0 and post_total_delta == pre_total_delta:
        print("  → MIXED: v2 picks things up evenly across pre and post, so graft didn't change anything but classifier was always too tight.")
    else:
        print("  → AMBIGUOUS: see per-archetype breakdown in report.")

    with open(OUT_JSON, "w") as f:
        json.dump(results, f, indent=2)
    print()
    print(f"JSON  → {OUT_JSON}  ({os.path.getsize(OUT_JSON):,} bytes)")

    # --- Markdown report ---
    lines = []
    lines.append(f"# Classifier v2 Probe — Hypothesis A test ({results['generated_at']})")
    lines.append("")
    lines.append(
        "> Read-only diagnostic. Re-classifies BOTH pre-graft and post-graft scope-benchmark corpora "
        "using a v2 keyword set that extends only `reliability_recovery` and `qa_edge_cases`. "
        "No LLM calls, no engine changes."
    )
    lines.append("")
    lines.append("**Hypothesis A**: v1 keywords too strict — model did surface these, classifier missed them.")
    lines.append("**Hypothesis B**: generator-mode reviewer-only — model can't surface these even when invited.")
    lines.append("")

    # Aggregate table
    lines.append("## 1. Aggregate v1 vs v2 by run")
    lines.append("")
    lines.append("| Run | Category | v1 | v2 | Δ |")
    lines.append("|-----|----------|----|----|---|")
    for run_name in ("pre_graft", "post_graft"):
        for cat in TARGET_CATEGORIES:
            a = results["runs"][run_name]["aggregate"][cat]
            lines.append(
                f"| {run_name} | `{cat}` | {a['v1_recognized_count']}/{a['total_archetypes']} | "
                f"{a['v2_recognized_count']}/{a['total_archetypes']} | {a['delta']:+d} |"
            )
    lines.append("")
    lines.append(f"**Pre-graft total Δ across both target categories: +{pre_total_delta}**")
    lines.append(f"**Post-graft total Δ across both target categories: +{post_total_delta}**")
    lines.append("")

    # Verdict block
    lines.append("## 2. Verdict")
    lines.append("")
    if post_total_delta > 0 and post_total_delta > pre_total_delta:
        verdict = (
            "**Hypothesis A LIKELY confirmed.** v2 keywords surfaced what v1 missed, "
            "especially in the post-graft corpus where the graft prompt should have invited these. "
            "Implication: the graft is stronger than the v1 classifier could measure, and the "
            "production diff should stay. Next step: bump max_tokens for stripe and re-run Phase B "
            "with v2 classifier baked into the benchmark runner."
        )
    elif post_total_delta == 0:
        verdict = (
            "**Hypothesis B LIKELY confirmed.** Even broad v2 keywords picked up nothing. "
            "The model genuinely does not produce reliability or QA modules in generator mode, "
            "even with the explicit graft prompt invitation. These two categories are "
            "**reviewer-only recoverable**. Next step: either accept that the graft handles 5 of 7 "
            "categories and stop, OR introduce a structured-output slot for reliability/QA, OR "
            "wire the reviewer probe as a Pass-2 production call (the original tradeoff we deferred)."
        )
    elif post_total_delta > 0 and pre_total_delta > 0 and post_total_delta == pre_total_delta:
        verdict = (
            "**MIXED.** v2 picks up roughly the same amount in both pre and post corpora. "
            "This means the v1 classifier was always too tight, AND the graft didn't move the "
            "needle on these two categories specifically. Both hypotheses partially true."
        )
    else:
        verdict = "**AMBIGUOUS.** See per-archetype breakdown below."
    lines.append(verdict)
    lines.append("")

    # Per-archetype breakdown for post-graft (the run where graft should have helped)
    lines.append("## 3. Post-graft per-archetype detail")
    lines.append("")
    lines.append("Each row shows: did v2 surface the category that v1 missed?")
    lines.append("")
    for cat in TARGET_CATEGORIES:
        lines.append(f"### `{cat}`")
        lines.append("")
        lines.append("| Archetype | v1 | v2 | v2-new keywords | Sample evidence |")
        lines.append("|-----------|----|----|--------|----|")
        for r in results["runs"]["post_graft"]["rows"]:
            pt = r["per_target"][cat]
            v1_mark = "●" if pt["v1_recognized"] else "○"
            v2_mark = "●" if pt["v2_recognized"] else "○"
            new_kw = ", ".join(f"`{k}`" for k in pt["v2_new_matches"][:3])
            ev = (pt["sample_evidence"] or "")[:80].replace("\n", " ")
            lines.append(
                f"| {r['archetype_id']} | {v1_mark} | {v2_mark} | {new_kw} | {ev} |"
            )
        lines.append("")

    # Pre-graft same breakdown but compact
    lines.append("## 4. Pre-graft per-archetype detail (control)")
    lines.append("")
    for cat in TARGET_CATEGORIES:
        lines.append(f"### `{cat}`")
        lines.append("")
        lines.append("| Archetype | v1 | v2 | v2-new keywords |")
        lines.append("|-----------|----|----|----------------|")
        for r in results["runs"]["pre_graft"]["rows"]:
            pt = r["per_target"][cat]
            v1_mark = "●" if pt["v1_recognized"] else "○"
            v2_mark = "●" if pt["v2_recognized"] else "○"
            new_kw = ", ".join(f"`{k}`" for k in pt["v2_new_matches"][:3])
            lines.append(f"| {r['archetype_id']} | {v1_mark} | {v2_mark} | {new_kw} |")
        lines.append("")

    # Methodology
    lines.append("## 5. Methodology + reproducibility")
    lines.append("")
    lines.append("- No LLM calls. Re-classifies existing JSON corpora.")
    lines.append("- v2 keywords are additive only — original v1 keywords remain. No keyword removed.")
    lines.append("- Only `reliability_recovery` and `qa_edge_cases` modified. Other 14 categories untouched.")
    lines.append("- All keyword matches use the same word-boundary regex as v1.")
    lines.append(f"- v2 extra keyword counts:")
    for cat in TARGET_CATEGORIES:
        lines.append(f"  - `{cat}`: +{len(CATEGORIES_V2_OVERRIDES[cat]['extra_keywords'])} keywords")
    lines.append("")
    lines.append("**Repro**: `python3 /app/scripts/classifier-v2-probe.py`")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("_Raw data: `/app/audit/classifier-v2-probe.json`._")
    with open(OUT_MD, "w") as f:
        f.write("\n".join(lines))
    print(f"MD    → {OUT_MD}  ({os.path.getsize(OUT_MD):,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
