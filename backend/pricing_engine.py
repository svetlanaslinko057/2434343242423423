"""
Pricing Engine — single source of truth for production_mode → price/speed/quality
+ admin-tunable economics + Project Reality Layer (entropy multipliers).

Invariants:
  • mode does NOT change UI. mode changes economy + downstream behaviour.
  • Only this module owns price math. Callers must import from here.
  • Project.pricing is a snapshot taken at creation time (historical record).
  • Do NOT duplicate PRODUCTION_MODES anywhere else.

Runtime config:
  • DEFAULTS live in this file (works without DB / works on first boot).
  • Admin overrides live in `system_config` collection under `_id="pricing_config"`.
  • `get_pricing_config()` reads with a 30s in-process cache to avoid DB hammering
    on every /api/estimate call. Cache is invalidated by `bust_pricing_cache()`
    which the admin PUT handler calls after a successful write.

Reality Layer (May 17, 2026):
  • Five entropy axes layered ON TOP of mode_multiplier, NOT replacing it.
  • Final formula:
        final_price = base_estimate × mode_multiplier × ∏(axis_multipliers)
    Old projects without axes → all multipliers = 1.00 (backwards compatible).
  • Axes are an immutable snapshot per estimate/project (like `pricing`).
  • Admin can override LLM-inferred axes from cockpit before sending the offer.
  • Client never sees raw multipliers — only a human narrative
    ("Production-grade · Platform complexity · Realtime").
"""
from datetime import datetime, timezone
from typing import Optional
import time
import hashlib as _hashlib


# === DEFAULTS (single source of truth for first boot / DB-less env) ===
DEFAULT_BASE_HOURLY_RATE = 65.0  # $/h — used in /api/estimate AI-blended pricing
DEFAULT_BASE_ESTIMATE_TIERS = {
    "tiny": {"max_chars": 40, "base_price": 800.0},
    "small": {"max_chars": 120, "base_price": 1500.0},
    "full": {"max_chars": None, "base_price": 2500.0},  # >= 120 chars
}
DEFAULT_PRODUCTION_MODES = {
    "ai": {
        "label": "AI build",
        "price_multiplier": 0.60,
        "speed_multiplier": 0.60,
        "quality_band": "standard",
    },
    "hybrid": {
        "label": "AI + Dev",
        "price_multiplier": 0.75,
        "speed_multiplier": 0.80,
        "quality_band": "enhanced",
    },
    "dev": {
        "label": "Full dev",
        "price_multiplier": 1.00,
        "speed_multiplier": 1.00,
        "quality_band": "premium",
    },
}

# Back-compat constant for callers that still import it directly.
PRODUCTION_MODES = DEFAULT_PRODUCTION_MODES


# === REALITY LAYER (entropy multipliers, May 17, 2026) ===
# Order matters for the human-readable narrative. Axis values default to the
# lowest-impact level so legacy projects without explicit axes price unchanged.
REALITY_AXIS_ORDER = (
    "product_maturity",
    "system_coupling",
    "unknowns",
    "realtime_pressure",
    "longevity",
    "validation_layer",
)

DEFAULT_REALITY_LAYER = {
    # Each axis: levels (ordered low→high) + multipliers + human-readable label
    # used when building the client-facing narrative.
    "product_maturity": {
        "label": "Product maturity",
        "default_level": "mvp",
        "levels": {
            "mvp":        {"multiplier": 1.00, "narrative": "MVP"},
            "beta":       {"multiplier": 1.30, "narrative": "Beta"},
            "production": {"multiplier": 1.80, "narrative": "Production-grade"},
            "scaled":     {"multiplier": 2.50, "narrative": "Scaled production"},
        },
    },
    "system_coupling": {
        "label": "System coupling",
        "default_level": "isolated",
        "levels": {
            "isolated":         {"multiplier": 1.00, "narrative": "Isolated app"},
            "connected":        {"multiplier": 1.20, "narrative": "Connected system"},
            "platform":         {"multiplier": 1.60, "narrative": "Platform complexity"},
            "operating_system": {"multiplier": 2.20, "narrative": "Operating-system scope"},
        },
    },
    "unknowns": {
        "label": "Unknowns",
        "default_level": "low",
        "levels": {
            "low":      {"multiplier": 1.00, "narrative": ""},  # baseline — no narrative chip
            "medium":   {"multiplier": 1.25, "narrative": "Discovery work"},
            "high":     {"multiplier": 1.60, "narrative": "High uncertainty"},
            "research": {"multiplier": 2.20, "narrative": "Research-grade"},
        },
    },
    "realtime_pressure": {
        "label": "Realtime pressure",
        "default_level": "none",
        "levels": {
            "none":          {"multiplier": 1.00, "narrative": ""},
            "async":         {"multiplier": 1.15, "narrative": ""},
            "collaborative": {"multiplier": 1.40, "narrative": "Collaboration"},
            "critical":      {"multiplier": 1.80, "narrative": "Realtime"},
        },
    },
    "longevity": {
        "label": "Longevity",
        "default_level": "prototype",
        "levels": {
            "prototype":      {"multiplier": 1.00, "narrative": ""},
            "startup_mvp":    {"multiplier": 1.20, "narrative": ""},
            "long_term":      {"multiplier": 1.50, "narrative": "Long-term product"},
            "infrastructure": {"multiplier": 2.00, "narrative": "Infrastructure"},
        },
    },
    # ─── Validation layer (Human Validation Layer surcharge) ────────────────
    # HVL is NOT a flat add-on — it's a production stabilization surface.
    # Coordination, review cycles, issue triage and polish iterations scale
    # WITH project complexity, so HVL is modelled as a complexity multiplier
    # that rides ON TOP of the mode-priced + reality-adjusted base. Tiers map
    # directly onto wizard checkout (`hvl_tier`) and admin `/admin/validation`.
    #   none    → ×1.00 — no HVL selected (default for legacy projects)
    #   basic   → ×1.06 — 3 reviewers, single post-build session
    #   pro     → ×1.12 — 5 reviewers, broader coverage
    #   managed → ×1.20 — admin-curated review round
    "validation_layer": {
        "label": "Human validation layer",
        "default_level": "none",
        "levels": {
            "none":    {"multiplier": 1.00, "narrative": ""},  # no chip when absent
            "basic":   {"multiplier": 1.06, "narrative": "Human-reviewed"},
            "pro":     {"multiplier": 1.12, "narrative": "Multi-review validation"},
            "managed": {"multiplier": 1.20, "narrative": "Managed release review"},
        },
    },
}


def default_axes_snapshot() -> dict:
    """Default axes selection — all axes at their lowest level (×1.00).

    Used for legacy projects without explicit axes AND as the safe baseline
    when admin has not yet selected anything in the cockpit. Math is unchanged
    vs the pre-reality-layer era (multiplier product = 1.00).
    """
    return {axis: cfg["default_level"] for axis, cfg in DEFAULT_REALITY_LAYER.items()}


# === RUNTIME CONFIG (DB-backed, in-process cached) ===
_CACHE: dict = {"data": None, "expires_at": 0.0}
_CACHE_TTL_SEC = 30.0


def _defaults_snapshot() -> dict:
    return {
        "base_hourly_rate": DEFAULT_BASE_HOURLY_RATE,
        "base_estimate_tiers": {k: dict(v) for k, v in DEFAULT_BASE_ESTIMATE_TIERS.items()},
        "modes": {k: dict(v) for k, v in DEFAULT_PRODUCTION_MODES.items()},
        "reality_layer": {
            axis: {
                "label": cfg["label"],
                "default_level": cfg["default_level"],
                "levels": {lvl: dict(v) for lvl, v in cfg["levels"].items()},
            }
            for axis, cfg in DEFAULT_REALITY_LAYER.items()
        },
        "updated_at": None,
        "updated_by": None,
    }


def _merge_overrides(base: dict, override: Optional[dict]) -> dict:
    """Merge admin override on top of defaults — keeps unknown keys safe."""
    if not override:
        return base
    out = dict(base)
    if isinstance(override.get("base_hourly_rate"), (int, float)) and override["base_hourly_rate"] > 0:
        out["base_hourly_rate"] = float(override["base_hourly_rate"])
    if isinstance(override.get("base_estimate_tiers"), dict):
        tiers = dict(out["base_estimate_tiers"])
        for tier_name, tier_val in override["base_estimate_tiers"].items():
            if tier_name not in tiers:
                continue
            if isinstance(tier_val, dict):
                bp = tier_val.get("base_price")
                mc = tier_val.get("max_chars")
                if isinstance(bp, (int, float)) and bp >= 0:
                    tiers[tier_name] = {**tiers[tier_name], "base_price": float(bp)}
                if mc is None or (isinstance(mc, int) and mc > 0):
                    tiers[tier_name] = {**tiers[tier_name], "max_chars": mc}
        out["base_estimate_tiers"] = tiers
    if isinstance(override.get("modes"), dict):
        modes = {k: dict(v) for k, v in out["modes"].items()}
        for mode_name, mode_val in override["modes"].items():
            if mode_name not in modes or not isinstance(mode_val, dict):
                continue
            for field in ("price_multiplier", "speed_multiplier"):
                v = mode_val.get(field)
                if isinstance(v, (int, float)) and v > 0:
                    modes[mode_name][field] = float(v)
            if isinstance(mode_val.get("label"), str) and mode_val["label"].strip():
                modes[mode_name]["label"] = mode_val["label"].strip()[:40]
            if isinstance(mode_val.get("quality_band"), str) and mode_val["quality_band"].strip():
                modes[mode_name]["quality_band"] = mode_val["quality_band"].strip()[:20]
        out["modes"] = modes
    if isinstance(override.get("reality_layer"), dict):
        rl = {axis: {
            "label": cfg["label"],
            "default_level": cfg["default_level"],
            "levels": {lvl: dict(v) for lvl, v in cfg["levels"].items()},
        } for axis, cfg in out["reality_layer"].items()}
        for axis_name, axis_val in override["reality_layer"].items():
            if axis_name not in rl or not isinstance(axis_val, dict):
                continue
            if isinstance(axis_val.get("levels"), dict):
                for lvl_name, lvl_val in axis_val["levels"].items():
                    if lvl_name not in rl[axis_name]["levels"] or not isinstance(lvl_val, dict):
                        continue
                    m = lvl_val.get("multiplier")
                    if isinstance(m, (int, float)) and m > 0:
                        rl[axis_name]["levels"][lvl_name]["multiplier"] = float(m)
                    narr = lvl_val.get("narrative")
                    if isinstance(narr, str):
                        rl[axis_name]["levels"][lvl_name]["narrative"] = narr.strip()[:60]
        out["reality_layer"] = rl
    if isinstance(override.get("updated_at"), str):
        out["updated_at"] = override["updated_at"]
    if isinstance(override.get("updated_by"), str):
        out["updated_by"] = override["updated_by"]
    return out


def bust_pricing_cache() -> None:
    """Called by admin PUT handler after a successful write."""
    _CACHE["data"] = None
    _CACHE["expires_at"] = 0.0


async def get_pricing_config(db=None) -> dict:
    """Resolve current pricing config. 30s in-process cache."""
    now = time.monotonic()
    if _CACHE["data"] is not None and now < _CACHE["expires_at"]:
        return _CACHE["data"]
    base = _defaults_snapshot()
    if db is not None:
        try:
            doc = await db.system_config.find_one(
                {"_id": "pricing_config"},
                {"_id": 0},
            )
        except Exception:
            doc = None
        merged = _merge_overrides(base, doc)
    else:
        merged = base
    _CACHE["data"] = merged
    _CACHE["expires_at"] = now + _CACHE_TTL_SEC
    return merged


def get_pricing_config_sync() -> dict:
    """Sync fallback for callers that can't await — returns defaults only."""
    return _defaults_snapshot()


# === BASE ESTIMATE (deterministic, no AI) ===
def estimate_base_price(goal: Optional[str], config: Optional[dict] = None) -> float:
    tiers = (config or {}).get("base_estimate_tiers") or DEFAULT_BASE_ESTIMATE_TIERS
    if not goal:
        return float(tiers["tiny"]["base_price"])
    n = len(goal.strip())
    if n < int(tiers["tiny"]["max_chars"] or 40):
        return float(tiers["tiny"]["base_price"])
    small_max = tiers["small"]["max_chars"]
    if small_max is not None and n < int(small_max):
        return float(tiers["small"]["base_price"])
    return float(tiers["full"]["base_price"])


# === CORE PRICING FUNCTION ===
def calculate_project_pricing(
    base_estimate: float,
    mode: str,
    config: Optional[dict] = None,
) -> dict:
    """Canonical pricing snapshot for a given base estimate + production mode.

    Reality Layer is NOT applied here — that's done by `apply_reality_layer()`
    on top of the resulting `final_price` so the math stays composable and
    auditable.
    """
    modes = (config or {}).get("modes") or DEFAULT_PRODUCTION_MODES
    if mode not in modes:
        raise ValueError(f"Invalid mode: {mode}")
    cfg = modes[mode]
    final_price = round(float(base_estimate) * cfg["price_multiplier"], 2)
    return {
        "mode": mode,
        "base_estimate": round(float(base_estimate), 2),
        "price_multiplier": cfg["price_multiplier"],
        "final_price": final_price,
        "speed_multiplier": cfg["speed_multiplier"],
        "quality_band": cfg["quality_band"],
    }


# === REALITY LAYER APPLICATION ===
def _normalize_axes(axes: Optional[dict], rl_config: dict) -> dict:
    """Coerce axes dict to a valid selection — unknown keys/levels fall back
    to each axis's default_level. Never raises."""
    normalized = {}
    for axis_name in REALITY_AXIS_ORDER:
        axis_cfg = rl_config.get(axis_name) or {}
        levels = axis_cfg.get("levels") or {}
        default_level = axis_cfg.get("default_level")
        chosen = (axes or {}).get(axis_name) if isinstance(axes, dict) else None
        if isinstance(chosen, str) and chosen in levels:
            normalized[axis_name] = chosen
        elif isinstance(default_level, str) and default_level in levels:
            normalized[axis_name] = default_level
        elif levels:
            normalized[axis_name] = next(iter(levels))
    return normalized


def apply_reality_layer(
    base_price: float,
    axes: Optional[dict],
    config: dict,
) -> dict:
    """Apply Reality Layer multipliers on top of a mode-priced base.

    Returns:
        {
          "input_price": float,           # base × mode_multiplier (already)
          "final_price": float,           # input × ∏(axis_multipliers)
          "axes": dict,                   # normalized {axis: level}
          "reality_multiplier": float,    # ∏ of all axis multipliers
          "breakdown": [                  # for admin transparency
              {"axis": str, "level": str, "multiplier": float, "delta": float},
              ...
          ],
          "narrative_chips": [str, ...],  # for client UI ("Production-grade" etc)
        }
    """
    rl_config = config.get("reality_layer") or {}
    normalized = _normalize_axes(axes, rl_config)

    breakdown = []
    chips = []
    running_price = float(base_price)
    reality_mult = 1.0

    for axis_name in REALITY_AXIS_ORDER:
        axis_cfg = rl_config.get(axis_name) or {}
        levels = axis_cfg.get("levels") or {}
        chosen_level = normalized.get(axis_name)
        level_cfg = levels.get(chosen_level) or {}
        m = float(level_cfg.get("multiplier") or 1.0)
        before = running_price
        running_price = round(running_price * m, 2)
        reality_mult = round(reality_mult * m, 4)
        breakdown.append({
            "axis": axis_name,
            "label": axis_cfg.get("label") or axis_name,
            "level": chosen_level,
            "multiplier": m,
            "delta": round(running_price - before, 2),
        })
        narr = (level_cfg.get("narrative") or "").strip()
        if narr:
            chips.append(narr)

    return {
        "input_price": round(float(base_price), 2),
        "final_price": running_price,
        "axes": normalized,
        "reality_multiplier": reality_mult,
        "breakdown": breakdown,
        "narrative_chips": chips,
    }


# === LLM AXES INFERENCE ===
async def infer_axes_via_llm(goal: str, modules: Optional[list] = None) -> dict:
    """Infer Reality Layer axes from the project brief using the configured LLM.

    Hybrid mode: LLM proposes axes, admin can override from cockpit before
    sending the offer. Returns axes-only (no multipliers — those are resolved
    against the current config at apply time).

    Safe fallback: on any failure → default axes (all-baseline ×1.00).
    """
    fallback = default_axes_snapshot()
    if not goal or not goal.strip():
        return fallback
    try:
        from admin_llm_settings import get_active_llm_key  # local import to avoid cycles
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        import json as _json
        active = await get_active_llm_key()
        key = (active or {}).get("key") or ""
        if not key:
            return fallback
        model = (active or {}).get("model") or "gpt-4o-mini"
        # The LLM only infers the 5 ENTROPY axes — `validation_layer` is a
        # client-driven add-on (HVL), never inferred. Exclude it from both
        # the prompt-side documentation and the result-merge loop below.
        LLM_INFERRED_AXES = tuple(a for a in REALITY_AXIS_ORDER if a != "validation_layer")
        levels_doc = {
            axis: list(DEFAULT_REALITY_LAYER[axis]["levels"].keys())
            for axis in LLM_INFERRED_AXES
        }
        system = (
            "You are a senior product engineer estimating the REAL cost to ship a product, "
            "not just the implementation hours. Classify the project along 5 entropy axes. "
            "Return STRICT JSON only. Each value MUST be one of the allowed levels for that axis.\n\n"
            f"Allowed levels: {_json.dumps(levels_doc)}\n\n"
            "Definitions:\n"
            "• product_maturity: shipping target (mvp = pre-revenue, beta = early users, production = paying users, scaled = > 10k users)\n"
            "• system_coupling: architectural surface (isolated = single app, connected = a few integrations, platform = multi-surface product, operating_system = OS-level orchestration)\n"
            "• unknowns: discovery work (low = well-understood domain, medium = some novel parts, high = many novel parts, research = research-grade work)\n"
            "• realtime_pressure: latency contract (none = batch/async OK, async = eventual consistency, collaborative = multi-user same screen, critical = sub-second realtime)\n"
            "• longevity: build horizon (prototype = throwaway, startup_mvp = 6-12 months, long_term = 2+ years, infrastructure = decade-scale)\n\n"
            'Return ONLY this JSON: {"product_maturity":"...","system_coupling":"...","unknowns":"...","realtime_pressure":"...","longevity":"..."}'
        )
        prompt_modules = ""
        if modules:
            titles = [m.get("title", "") if isinstance(m, dict) else str(m) for m in modules[:8]]
            prompt_modules = "\nModules: " + ", ".join(t for t in titles if t)
        chat = LlmChat(
            api_key=key,
            session_id="axes_" + _hashlib.sha256((goal or "").encode("utf-8")).hexdigest()[:16],
            system_message=system,
        ).with_model("openai", model).with_params(max_tokens=200, temperature=0)
        response = await chat.send_message(UserMessage(text=goal[:4000] + prompt_modules))
        raw = (response or "").strip()
        if raw.startswith("```"):
            raw = raw.strip("`")
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
            if raw.endswith("```"):
                raw = raw[:-3].strip()
        parsed = _json.loads(raw)
        result = dict(fallback)
        # Only merge LLM-inferred axes — validation_layer stays at its
        # client-driven default ("none") so an over-eager LLM can't surcharge.
        for axis in LLM_INFERRED_AXES:
            v = parsed.get(axis)
            if isinstance(v, str) and v in DEFAULT_REALITY_LAYER[axis]["levels"]:
                result[axis] = v
        return result
    except Exception:
        return fallback


# === PUBLIC HELPER (used by endpoints) ===
async def build_pricing_preview(goal: Optional[str], mode: str, db=None) -> dict:
    """Used by POST /api/pricing/preview to preview price before project creation.

    Does NOT apply Reality Layer (axes are not known at this gating stage).
    """
    config = await get_pricing_config(db)
    base_estimate = estimate_base_price(goal, config)
    pricing = calculate_project_pricing(base_estimate, mode, config)
    return {
        **pricing,
        "base_hourly_rate": config["base_hourly_rate"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
