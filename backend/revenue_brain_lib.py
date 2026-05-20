"""Wave 10 — Client Revenue Brain: scoring + segments + opportunity generator.

Principle: System detects revenue opportunity and guides client forward.
Not selling harder — showing the next logical step for growth with reasons.
"""
from datetime import datetime, timezone, timedelta


def _iso(s):
    try:
        return datetime.fromisoformat((s or "").replace("Z", "+00:00"))
    except Exception:
        return None


def payment_velocity_score(invoices: list[dict]) -> dict:
    """Higher = pays faster and without overdue.
    score = 100 - overdue*20 - avg_delay_days*3 (clamp 0..100)
    """
    if not invoices:
        return {"score": 50, "overdue": 0, "avg_delay_days": 0, "paid_count": 0}
    overdue = sum(1 for i in invoices if i.get("status") == "overdue")
    delays = []
    paid_count = 0
    for i in invoices:
        if i.get("status") == "paid" and i.get("paid_at") and i.get("due_date"):
            paid = _iso(i["paid_at"])
            due = _iso(i["due_date"])
            if paid and due:
                delay = (paid - due).total_seconds() / 86400
                delays.append(max(0, delay))
                paid_count += 1
    avg_delay = round(sum(delays) / len(delays), 1) if delays else 0
    raw = 100 - overdue * 20 - avg_delay * 3
    return {"score": max(0, min(100, round(raw))), "overdue": overdue, "avg_delay_days": avg_delay, "paid_count": paid_count}


def approval_speed_score(deliverables: list[dict]) -> dict:
    """Higher = approves/rejects quickly."""
    if not deliverables:
        return {"score": 50, "avg_approval_days": 0, "pending_over_3d": 0}
    delays = []
    pending_over_3d = 0
    now_ts = datetime.now(timezone.utc)
    for d in deliverables:
        if d.get("status") == "approved" and d.get("approved_at") and d.get("created_at"):
            a = _iso(d["approved_at"])
            c = _iso(d["created_at"])
            if a and c:
                delays.append(max(0, (a - c).total_seconds() / 86400))
        elif d.get("status") in ("under_review", "submitted") and d.get("created_at"):
            c = _iso(d["created_at"])
            if c and (now_ts - c).total_seconds() / 86400 > 3:
                pending_over_3d += 1
    avg = round(sum(delays) / len(delays), 1) if delays else 1.0
    raw = 100 - avg * 4 - pending_over_3d * 10
    return {"score": max(0, min(100, round(raw))), "avg_approval_days": avg, "pending_over_3d": pending_over_3d}


def expansion_readiness(pv: int, asp: int, modules_done_ratio: float, trust: int, recent_engagement: int) -> int:
    raw = pv * 0.30 + asp * 0.20 + modules_done_ratio * 100 * 0.20 + trust * 0.20 + recent_engagement * 0.10
    return max(0, min(100, round(raw)))


def retention_risk(pv_info: dict, low_activity: int, asp_info: dict, trust_delta: int) -> int:
    overdue_behavior = min(100, pv_info.get("overdue", 0) * 35 + pv_info.get("avg_delay_days", 0) * 5)
    slow_approvals = min(100, asp_info.get("avg_approval_days", 0) * 10 + asp_info.get("pending_over_3d", 0) * 20)
    trust_drop = max(0, -trust_delta)
    raw = overdue_behavior * 0.35 + low_activity * 0.20 + slow_approvals * 0.20 + trust_drop * 0.25
    return max(0, min(100, round(raw)))


def classify_segment(expansion: int, retention: int, pv: int, total_spend: int) -> str:
    if retention >= 60:
        return "churn_risk"
    if pv < 50:
        return "slow_payer"
    if expansion >= 75 and total_spend >= 2000:
        return "premium_ready"
    if expansion >= 65:
        return "expansion_ready"
    return "stable_core"


def adjacent_module_suggestions(done_modules: list[dict], open_catalog: list[dict] = None) -> list[dict]:
    """Return synthetic adjacent upsells based on what the client already has.

    Deterministic catalog — avoids LLM dependency. Real system could swap in AI-driven.
    """
    titles = {m.get("title", "").lower() for m in done_modules}
    suggestions: list[dict] = []

    def _push(key_hit, new_title, price, eta, reasons, upsell_type="upsell_module", impact=None):
        if any(key_hit in t for t in titles):
            # avoid offering what they already have
            if not any(new_title.lower() in t for t in titles):
                suggestions.append({
                    "type": upsell_type,
                    "title": new_title,
                    "price": price,
                    "eta_days": eta,
                    "reason": reasons,
                    "expected_impact": impact or {},
                })

    _push("auth", "Two-Factor Authentication", 400, 3, ["You already have Auth System", "Industry standard next step", "Reduces fraud risk"], impact={"security": "+30%"})
    _push("dashboard", "Alerts & Monitoring", 300, 2, ["Dashboard already active", "Reduces manual monitoring", "Catches incidents early"], impact={"ops_time_saved": "4h/week"})
    _push("payment", "Refund Automation", 500, 4, ["You process payments", "Reduces support load", "Common next step"], impact={"support_tickets": "-25%"})
    _push("onboarding", "Email Drip Campaign", 350, 3, ["You onboard users", "Lifts activation rate", "Runs on autopilot"], impact={"activation": "+15%"})
    _push("notification", "In-App Messaging", 600, 5, ["Already sending pushes", "Higher engagement channel", "Same infra reused"], impact={"engagement": "+20%"})
    _push("chat", "AI Reply Assistant", 800, 6, ["Chat system active", "Automates frequent questions", "Scales support"], impact={"response_time": "-40%"})

    return suggestions[:4]


def speed_upgrade_offer(project: dict) -> dict | None:
    """Offer a paid timeline compression if project is mid-flight."""
    progress = project.get("progress_percentage", 0)
    if 20 <= progress <= 70:
        return {
            "type": "speed_upgrade",
            "title": "Priority Timeline — cut delivery by ~30%",
            "price": 499,
            "eta_days": 0,
            "reason": ["Project is mid-flight", "Dedicated elite dev pool", "Reduces risk of delay"],
            "expected_impact": {"timeline": "-30%"},
        }
    return None


def retainer_template(project: dict, total_spend: int) -> dict:
    """Return a retainer tier appropriate to total spend."""
    if total_spend >= 5000:
        return {"type": "priority_support", "monthly_price": 999, "included": ["Priority bug fixes", "24h response SLA", "Weekly review call", "Infra monitoring"]}
    if total_spend >= 2500:
        return {"type": "growth_support", "monthly_price": 599, "included": ["Bug fixes", "48h response SLA", "Small improvements", "Monthly review"]}
    return {"type": "starter_support", "monthly_price": 299, "included": ["Bug fixes", "Priority support", "Small updates"]}
