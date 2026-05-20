"""Wave 11.5 — Hidden Performance Weighting.

Invisible to developers (they only see consequences in their flow).
Visible to admin as a performance tier label.

Principle: Guide flow — never ban. No public ranking, no hard blocks.
High-rank devs → more high-value flow + invite priority.
Low-rank devs → still can compete for everything, just see fewer high-value modules.

Inputs (all retrievable from existing collections):
  - qa_pass_rate        (0..100)
  - avg_delivery_days   (lower is better)
  - completed_count     (done modules)
  - revision_count_avg  (per module, lower is better)
  - idle_days           (since last completion/start)
  - accepted_bid_ratio  (accepted / (accepted + rejected); proxy = completion rate)

Hidden rank 0..100 · Tiers: bronze <40 · silver 40-59 · gold 60-79 · platinum 80+
"""


def compute_hidden_rank(stats: dict) -> int:
    """Return 0..100 — hidden performance score (not user-visible)."""
    qa = stats.get("qa_pass_rate", 90)                       # 0..100
    delivery = max(0, stats.get("avg_delivery_days") or 0)    # days, 0=no data
    completed = stats.get("completed_count", 0)               # absolute
    revisions = stats.get("revision_count_avg", 0)            # per module
    idle = max(0, stats.get("idle_days") or 0)                # days
    accepted_ratio = stats.get("accepted_bid_ratio", 0.7)     # 0..1 (proxy for bid quality)

    # QA component — dominant
    qa_c = qa  # already 0..100

    # Speed component — faster = higher
    # delivery=0 (no data) → neutral 60
    if delivery == 0:
        speed_c = 60
    elif delivery <= 1.0:
        speed_c = 100
    elif delivery <= 3.0:
        speed_c = 85
    elif delivery <= 7.0:
        speed_c = 65
    elif delivery <= 14.0:
        speed_c = 40
    else:
        speed_c = 20

    # Volume component — how many done
    vol_c = min(100, 40 + completed * 8)  # 1 done→48, 5 done→80, 10+→100

    # Revision loops penalty (avg)
    rev_c = max(0, 100 - revisions * 25)

    # Idle decay — linear, 0 idle=100, 7d idle=60, 14d=20, 21d+=0
    if idle <= 0:
        idle_c = 100
    elif idle <= 3:
        idle_c = 90
    elif idle <= 7:
        idle_c = 65
    elif idle <= 14:
        idle_c = 35
    else:
        idle_c = 0

    accepted_c = accepted_ratio * 100

    # Weighted composite
    raw = (
        0.30 * qa_c
        + 0.20 * speed_c
        + 0.15 * vol_c
        + 0.15 * rev_c
        + 0.10 * idle_c
        + 0.10 * accepted_c
    )
    return max(0, min(100, round(raw)))


def perf_tier(rank: int) -> str:
    if rank >= 80:
        return "platinum"
    if rank >= 60:
        return "gold"
    if rank >= 40:
        return "silver"
    return "bronze"


def high_value_gate(module_price: int) -> bool:
    return module_price >= 700


def rank_weight_for_module(rank: int, module_price: int) -> float:
    """Multiplier applied to flow score for (dev, module) — invisible to dev.
    Applied ONLY for high-value modules (>= $700).
    Non-high-value modules are unaffected (market stays open).
    """
    if not high_value_gate(module_price):
        return 1.0
    if rank >= 80:
        return 1.20   # platinum — boost visibility
    if rank >= 60:
        return 1.10   # gold
    if rank >= 40:
        return 0.95   # silver — slight dampen
    return 0.70       # bronze — reduced visibility on high-value


def rank_weight_for_invite(rank: int) -> float:
    """Weight used in admin's top-3 recommended developers sort."""
    if rank >= 80:
        return 1.25
    if rank >= 60:
        return 1.12
    if rank >= 40:
        return 1.0
    return 0.80
