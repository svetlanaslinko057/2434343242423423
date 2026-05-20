"""
Этап 5.1 — Call-site contract tests.

These tests reproduce the production call patterns of the boundary layer
in the migrated business code (auth_otp, server.py payment helper,
account_layer storage, google_auth, AI scope generator) and verify that:

  • the migration uses ONLY the contract types (no vendor leak)
  • mock and live adapter produce response dicts of the same shape
  • when capability mode != live, business logic returns honest fallback
    (not an exception, not a fake success)
  • the public capability-matrix API includes a webhook entrypoint that
    speaks the normalized event shape

Run:  pytest tests/test_call_sites.py -v
"""

import dataclasses

import pytest

from integrations import (
    AvailabilityMode,
    Capability,
    CheckoutRequest,
    PaymentEvent,
    registry,
)
from integrations.live_adapters import StripePaymentAdapter
from integrations.mocks import MockPaymentProvider


# ─────────────────────────────────────────────────────────────────────────────
# 1. Webhook normalization: PaymentEvent has the 5 canonical fields.
# ─────────────────────────────────────────────────────────────────────────────

def test_payment_event_has_normalized_shape():
    declared = {f.name for f in dataclasses.fields(PaymentEvent)}
    required = {"valid", "event_type", "provider_ref", "status", "amount", "currency"}
    missing = required - declared
    assert not missing, f"PaymentEvent missing canonical webhook fields: {missing}"


@pytest.mark.asyncio
async def test_mock_webhook_normalizes_event_type():
    p = MockPaymentProvider(reason="test")
    body = b'{"invoice_id":"inv_1","provider_ref":"mock_x","status":"paid","amount":42,"currency":"USD"}'
    ev = await p.verify_webhook(body, headers={"content-type": "application/json"})
    assert isinstance(ev, PaymentEvent)
    assert ev.valid is True
    assert ev.invoice_id == "inv_1"
    assert ev.provider_ref == "mock_x"
    assert ev.status == "paid"
    assert ev.event_type == "payment_paid"  # mock derives from status
    assert ev.amount == 42
    assert ev.currency == "USD"


@pytest.mark.asyncio
async def test_mock_webhook_rejects_invalid_body():
    p = MockPaymentProvider(reason="test")
    ev = await p.verify_webhook(b"not-json", headers={})
    assert ev.valid is False
    assert ev.error
    # Even on failure, the contract shape is preserved.
    assert hasattr(ev, "event_type")


# ─────────────────────────────────────────────────────────────────────────────
# 2. Stripe live adapter (no key) reports UNAVAILABLE — never fakes LIVE.
# ─────────────────────────────────────────────────────────────────────────────

def test_stripe_adapter_without_key_reports_unavailable():
    adapter = StripePaymentAdapter(secret_key="")
    state = adapter.health()
    assert state.capability == Capability.PAYMENT
    assert state.mode == AvailabilityMode.UNAVAILABLE
    assert state.available is False
    assert "STRIPE_SECRET_KEY" in (state.reason or "")


@pytest.mark.asyncio
async def test_stripe_adapter_without_key_returns_failed_result():
    """Even though the adapter has the LIVE class, calling it without
    config must NOT raise — must return a contract-shaped failure."""
    adapter = StripePaymentAdapter(secret_key="")
    res = await adapter.create_checkout(CheckoutRequest(
        invoice_id="inv_1", amount=10.0, currency="USD",
        description="Test", return_url="http://example.test/r",
    ))
    assert res.success is False
    assert res.payment_url is None
    assert res.error  # honest failure reason


# ─────────────────────────────────────────────────────────────────────────────
# 3. AI capability fallback — server.ai_generate_scope must not pretend.
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_ai_scope_fallback_is_explicit(monkeypatch):
    """When AI capability is mock/unavailable, the scope generator must
    return a deterministic dict with `mode` and `ai_confidence=0`."""
    # Force AI to mock.
    monkeypatch.setenv("AI_PROVIDER", "mock")
    registry.reset()

    import importlib
    import sys
    # server.py is huge — we test the helper in isolation by importing
    # the public function directly.
    if "server" in sys.modules:
        del sys.modules["server"]
    import server  # noqa: E402

    out = await server.ai_generate_scope("build a todo app")
    assert out["mode"] in {"mock", "unavailable"}
    assert out["ai_confidence"] == 0.0
    assert out["ai_reason"]
    # Schema fields preserved so UI doesn't crash.
    assert "name" in out and "tasks" in out and "tech_stack" in out
    assert isinstance(out["tasks"], list)
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    registry.reset()


# ─────────────────────────────────────────────────────────────────────────────
# 4. OAuth gate — google_auth refuses when capability != LIVE.
# ─────────────────────────────────────────────────────────────────────────────

def test_oauth_unavailable_state_is_honest():
    """In default state (no live keys, no master switch) registry.oauth()
    is unavailable. The /api/auth/google route depends on this — it must
    refuse with 503 instead of attempting a verification that would
    succeed-and-create accounts under fake identity."""
    registry.reset()
    state = registry.oauth().health()
    assert state.mode == AvailabilityMode.UNAVAILABLE
    assert state.available is False


# ─────────────────────────────────────────────────────────────────────────────
# 5. Vendor-leak guard at call-site level — contract types only.
# ─────────────────────────────────────────────────────────────────────────────

def test_no_vendor_module_imported_in_business_layer():
    """Static guard: business-layer files don't import vendor SDKs.

    The boundary layer (integrations/* + payment_providers/* + the legacy
    google_auth.py / cloudinary_service.py / email_service.py vendor
    modules themselves) is allowed to. Everyone else is not.

    KNOWN_LEAKS — pre-existing imports earmarked for Этап 5.2 removal.
    These exist because they implement vendor-specific webhook signature
    verification that the boundary layer doesn't handle yet (live adapters
    will subsume them). Each entry MUST also appear in
    integrations/AUDIT.md with a removal plan.
    """
    import pathlib
    import re

    BACKEND = pathlib.Path("/app/backend")
    forbidden = re.compile(
        r"^\s*(?:from|import)\s+"
        r"(stripe|resend|cloudinary|google\.oauth2|google\.auth|emergentintegrations\.payments)\b"
    )
    # Files allowed to keep direct vendor imports — they ARE the vendor
    # adapters or the legacy facade still wired as a live adapter target.
    ALLOWED = {
        "integrations/live_adapters.py",
        "payment_providers/stripe_provider.py",
        "payment_providers/wayforpay.py",
        "google_auth.py",          # contains the live adapter target
        "cloudinary_service.py",   # contains the live adapter target
        "email_service.py",        # template module, no business logic
        "admin_integrations.py",   # admin live-key probe (vendor test endpoint by design)
    }
    # Documented leaks to be removed in Этап 5.2 (Stripe webhook signature
    # verification — needs to move into StripePaymentAdapter.verify_webhook).
    # Format: by signature, not line number, so the guard is stable across
    # unrelated edits in the file.
    KNOWN_LEAK_SIGNATURES = {
        ("server.py", "from emergentintegrations.payments.stripe.checkout import StripeCheckout"),
        ("mobile_adapter.py", "from google.oauth2 import id_token as _gid_token"),
        ("mobile_adapter.py", "from google.auth.transport import requests as _g_req"),
    }

    leaks = []
    for py in BACKEND.rglob("*.py"):
        rel = py.relative_to(BACKEND).as_posix()
        if rel in ALLOWED or rel.startswith("integrations/") or rel.startswith("tests/"):
            continue
        try:
            text = py.read_text(encoding="utf-8")
        except Exception:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            if forbidden.match(line):
                stripped = line.strip()
                if (rel, stripped) in KNOWN_LEAK_SIGNATURES:
                    continue
                leaks.append(f"{rel}:{i}: {stripped}")

    assert not leaks, (
        "NEW vendor leak in business layer (not documented in KNOWN_LEAKS):\n"
        + "\n".join(leaks)
        + "\nAdd to KNOWN_LEAKS + integrations/AUDIT.md with removal plan, or migrate to registry.X()."
    )


# ─────────────────────────────────────────────────────────────────────────────
# 6. Mail call-site: auth_otp uses registry.mail(), not email_service.send.
# ─────────────────────────────────────────────────────────────────────────────

def test_auth_otp_imports_only_template_helper():
    """auth_otp must NOT import send_otp_email / is_configured anymore.
    Those were the vendor-coupled symbols. Only the HTML template helper
    `_otp_html` is allowed (vendor-neutral). We grep the import section
    only — module docstring may still mention the old names historically."""
    import re
    text = open("/app/backend/auth_otp.py").read()
    # Strip the leading docstring (everything up to the first triple-quote pair).
    body_after_docstring = re.sub(r"^\s*\"\"\".*?\"\"\"\s*", "", text, count=1, flags=re.DOTALL)
    # Find import lines only.
    import_lines = [
        ln for ln in body_after_docstring.splitlines()
        if ln.lstrip().startswith(("import ", "from "))
    ]
    blob = "\n".join(import_lines)
    assert "send_otp_email" not in blob, "auth_otp still imports send_otp_email"
    assert "is_configured" not in blob, "auth_otp still imports email_service.is_configured"
    assert "from integrations import registry" in blob, "auth_otp must import registry"
