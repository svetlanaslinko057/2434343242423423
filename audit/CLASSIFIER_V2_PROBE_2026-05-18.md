# Classifier v2 Probe — Hypothesis A test (2026-05-18T18:48:02Z)

> Read-only diagnostic. Re-classifies BOTH pre-graft and post-graft scope-benchmark corpora using a v2 keyword set that extends only `reliability_recovery` and `qa_edge_cases`. No LLM calls, no engine changes.

**Hypothesis A**: v1 keywords too strict — model did surface these, classifier missed them.
**Hypothesis B**: generator-mode reviewer-only — model can't surface these even when invited.

## 1. Aggregate v1 vs v2 by run

| Run | Category | v1 | v2 | Δ |
|-----|----------|----|----|---|
| pre_graft | `reliability_recovery` | 0/10 | 1/10 | +1 |
| pre_graft | `qa_edge_cases` | 0/10 | 0/10 | +0 |
| post_graft | `reliability_recovery` | 0/10 | 0/10 | +0 |
| post_graft | `qa_edge_cases` | 0/10 | 0/10 | +0 |

**Pre-graft total Δ across both target categories: +1**
**Post-graft total Δ across both target categories: +0**

## 2. Verdict

**Hypothesis B LIKELY confirmed.** Even broad v2 keywords picked up nothing. The model genuinely does not produce reliability or QA modules in generator mode, even with the explicit graft prompt invitation. These two categories are **reviewer-only recoverable**. Next step: either accept that the graft handles 5 of 7 categories and stop, OR introduce a structured-output slot for reliability/QA, OR wire the reviewer probe as a Pass-2 production call (the original tradeoff we deferred).

## 3. Post-graft per-archetype detail

Each row shows: did v2 surface the category that v1 missed?

### `reliability_recovery`

| Archetype | v1 | v2 | v2-new keywords | Sample evidence |
|-----------|----|----|--------|----|
| slack | ○ | ○ |  |  |
| linear | ○ | ○ |  |  |
| stripe_for_x | ○ | ○ |  |  |
| b2b_crm | ○ | ○ |  |  |
| ai_copilot | ○ | ○ |  |  |
| infra_observability | ○ | ○ |  |  |
| marketplace | ○ | ○ |  |  |
| multiplayer | ○ | ○ |  |  |
| banking_dashboard | ○ | ○ |  |  |
| enterprise_erp | ○ | ○ |  |  |

### `qa_edge_cases`

| Archetype | v1 | v2 | v2-new keywords | Sample evidence |
|-----------|----|----|--------|----|
| slack | ○ | ○ |  |  |
| linear | ○ | ○ |  |  |
| stripe_for_x | ○ | ○ |  |  |
| b2b_crm | ○ | ○ |  |  |
| ai_copilot | ○ | ○ |  |  |
| infra_observability | ○ | ○ |  |  |
| marketplace | ○ | ○ |  |  |
| multiplayer | ○ | ○ |  |  |
| banking_dashboard | ○ | ○ |  |  |
| enterprise_erp | ○ | ○ |  |  |

## 4. Pre-graft per-archetype detail (control)

### `reliability_recovery`

| Archetype | v1 | v2 | v2-new keywords |
|-----------|----|----|----------------|
| slack | ○ | ○ |  |
| linear | ○ | ○ |  |
| stripe_for_x | ○ | ○ |  |
| b2b_crm | ○ | ○ |  |
| ai_copilot | ○ | ○ |  |
| infra_observability | ○ | ● | `failover`, `reliability` |
| marketplace | ○ | ○ |  |
| multiplayer | ○ | ○ |  |
| banking_dashboard | ○ | ○ |  |
| enterprise_erp | ○ | ○ |  |

### `qa_edge_cases`

| Archetype | v1 | v2 | v2-new keywords |
|-----------|----|----|----------------|
| slack | ○ | ○ |  |
| linear | ○ | ○ |  |
| stripe_for_x | ○ | ○ |  |
| b2b_crm | ○ | ○ |  |
| ai_copilot | ○ | ○ |  |
| infra_observability | ○ | ○ |  |
| marketplace | ○ | ○ |  |
| multiplayer | ○ | ○ |  |
| banking_dashboard | ○ | ○ |  |
| enterprise_erp | ○ | ○ |  |

## 5. Methodology + reproducibility

- No LLM calls. Re-classifies existing JSON corpora.
- v2 keywords are additive only — original v1 keywords remain. No keyword removed.
- Only `reliability_recovery` and `qa_edge_cases` modified. Other 14 categories untouched.
- All keyword matches use the same word-boundary regex as v1.
- v2 extra keyword counts:
  - `reliability_recovery`: +26 keywords
  - `qa_edge_cases`: +31 keywords

**Repro**: `python3 /app/scripts/classifier-v2-probe.py`

---

_Raw data: `/app/audit/classifier-v2-probe.json`._