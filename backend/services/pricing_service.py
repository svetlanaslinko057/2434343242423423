"""
Pricing service — pure, side-effect-free dev reward calculator.

Single point of tier-based pricing. Used by _credit_module_reward and
by /developer/intelligence/growth for the "you earn ~X%" UI hint.
"""
from config.pricing import TIER_RATES, DEFAULT_RATE


def get_tier_rate(tier: str | None) -> float:
    """Return the developer's share-of-price for a tier."""
    if not tier:
        return DEFAULT_RATE
    return TIER_RATES.get(tier.lower(), DEFAULT_RATE)


def calculate_dev_reward(module_price: float, tier: str | None) -> dict:
    """Pure: compute dev reward + platform margin for a module price.

    Args:
        module_price: full client-facing price of the module (USD).
        tier: developer tier string (junior/middle/senior/lead/elite).

    Returns:
        {
          "rate": float,              # 0.0 - 1.0
          "dev_reward": float,        # rounded to cents
          "platform_margin": float,   # rounded to cents
        }
    """
    price = max(0.0, float(module_price or 0))
    rate = get_tier_rate(tier)
    dev_reward = round(price * rate, 2)
    platform_margin = round(price - dev_reward, 2)
    return {
        "rate": rate,
        "dev_reward": dev_reward,
        "platform_margin": platform_margin,
    }
