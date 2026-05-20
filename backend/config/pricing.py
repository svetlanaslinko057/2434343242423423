"""
Dynamic Pricing config — single source of truth for tier rates.

NOT a marketplace. NOT client-facing. Internal economy only.

Developer reward per module:
    dev_reward = module_price × TIER_RATES[tier]

Platform margin is the delta. Client always pays `module_price`.
"""
# base rate per developer tier (share of client price paid to dev)
TIER_RATES = {
    "junior": 0.60,
    "middle": 0.75,
    "senior": 0.85,
    "lead":   0.90,
    "elite":  0.92,
}

# fallback for unknown / empty tier
DEFAULT_RATE = 0.75
