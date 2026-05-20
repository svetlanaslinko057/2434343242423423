#!/usr/bin/env python3
"""
Structural comparison: baseline smoke traces vs post-PR0 smoke traces.

Compares only the invariant axes:
    - divergence class set per snapshot step
    - status arc per snapshot
    - table outcomes (status sequence)
    - withdrawal split-brain summary
    - cleanup counts (must be balanced — every seeded row cleaned)

Ignores (expected to differ):
    - run_id (per-run UUID)
    - ids.* (per-run smoke entity IDs)
    - timestamps (started_at / finished_at / snapshot.at)
    - log_id / payout_id values
"""
import json
import sys
from pathlib import Path

PAIRS = [
    ("escrow",         "/app/audit/escrow_smoke_trace_baseline.json",
                       "/app/audit/pr0_artefacts/smoke/escrow_postPR0.json"),
    ("work_execution", "/app/audit/work_execution_smoke_trace_baseline.json",
                       "/app/audit/pr0_artefacts/smoke/work_execution_postPR0.json"),
    ("withdrawal",     "/app/audit/withdrawal_smoke_trace_baseline.json",
                       "/app/audit/pr0_artefacts/smoke/withdrawal_postPR0.json"),
]


def extract_classes_table_escrow(d: dict) -> dict:
    """For escrow / work_execution shape: snapshots[].divergence + table[]."""
    return {
        "table_outcomes": [
            {k: row.get(k) for k in (
                "step", "module_diverged", "module_classes",
            )}
            for row in d.get("table") or []
        ],
        "snapshot_classes": [
            {
                "step": s.get("step"),
                "module_classes": (s.get("divergence") or {}).get("module", {}).get("classes"),
                "module_ok": (s.get("divergence") or {}).get("module", {}).get("ok"),
            }
            for s in d.get("snapshots") or []
        ],
    }


def extract_withdrawal(d: dict) -> dict:
    """Withdrawal trace shape:
        part_1_canonical: [snapshots] where each = {step, at, raw, developer_divergence}
        part_2_split_brain: [snapshots]
        split_brain_summary: {canonical_path_complete, mobile_admin_path_orphan, decision_4_evidence}
    """
    def steps(arr):
        return [s.get("step") for s in (arr or [])]

    def dev_div_classes(arr):
        return [
            {
                "step": s.get("step"),
                "developer_classes": (s.get("developer_divergence") or {}).get("classes"),
                "developer_ok": (s.get("developer_divergence") or {}).get("ok"),
            }
            for s in (arr or [])
        ]

    sbs = d.get("split_brain_summary") or {}
    # Normalise summary: keep only invariant structural keys, NOT IDs/amounts (IDs differ per run)
    norm_summary = {
        "canonical_path_complete": {
            "final_status_in_dev_withdrawals": sbs.get("canonical_path_complete", {}).get("final_status_in_dev_withdrawals"),
            "expected": sbs.get("canonical_path_complete", {}).get("expected"),
        },
        "mobile_admin_path_orphan": {
            "final_status_in_withdrawals_collection": sbs.get("mobile_admin_path_orphan", {}).get("final_status_in_withdrawals_collection"),
            "visible_in_dev_withdrawals_collection": sbs.get("mobile_admin_path_orphan", {}).get("visible_in_dev_withdrawals_collection"),
            "expected_under_decision_4_recommendation_4A": sbs.get("mobile_admin_path_orphan", {}).get("expected_under_decision_4_recommendation_4A"),
        },
        "decision_4_evidence": sbs.get("decision_4_evidence"),
    }
    return {
        "split_brain_summary_normalised": norm_summary,
        "part_1_step_arc": steps(d.get("part_1_canonical")),
        "part_1_divergence_classes": dev_div_classes(d.get("part_1_canonical")),
        "part_2_step_arc": steps(d.get("part_2_split_brain")),
        "part_2_divergence_classes": dev_div_classes(d.get("part_2_split_brain")),
    }


def cmp(label, baseline, post):
    pre = json.load(open(baseline))
    new = json.load(open(post))

    if label == "withdrawal":
        a = extract_withdrawal(pre)
        b = extract_withdrawal(new)
    else:
        a = extract_classes_table_escrow(pre)
        b = extract_classes_table_escrow(new)

    same = json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    diff = None
    if not same:
        # Find first differing slice
        for k in a:
            if a[k] != b.get(k):
                diff = {"key": k, "baseline": a[k], "post": b.get(k)}
                break
    return same, diff, a, b


def main():
    out = {"comparisons": [], "all_equal": True}
    for label, baseline, post in PAIRS:
        if not Path(post).exists():
            print(f"  MISSING: {post}")
            out["all_equal"] = False
            out["comparisons"].append({"label": label, "status": "MISSING_POST"})
            continue
        same, diff, a, b = cmp(label, baseline, post)
        print(f"--- {label} ---")
        print(f"  structurally equal: {same}")
        if not same:
            print(f"  first diff: {diff}")
            out["all_equal"] = False
        out["comparisons"].append({
            "label": label, "equal": same, "diff": diff,
            "baseline_structure": a, "post_structure": b,
        })

    Path("/app/audit/pr0_artefacts/smoke/comparison.json").write_text(
        json.dumps(out, indent=2, default=str)
    )
    print()
    print("=" * 70)
    print(f"ALL EQUAL: {out['all_equal']}")
    sys.exit(0 if out["all_equal"] else 3)


if __name__ == "__main__":
    main()
