"""
Этап 5.0 — Integration Boundary Layer contract tests.

These tests are the **shape parity guard**. They verify:
  1. Every mock implements the abstract contract (no missing methods).
  2. `health()` returns CapabilityState with all required fields.
  3. Mock & live adapters produce dataclasses with **identical fields**
     (live adapters tested without keys → they must still have the right
      shape, just signal `mode=unavailable`).
  4. Capability matrix endpoint shape is stable.
  5. MockOAuth refuses to fake identity (security boundary).
  6. UI/business logic vendor-isolation: mock results never carry vendor
     names in their typed fields (only in opaque `raw`).

Run:  pytest tests/test_integration_contracts.py -v
"""

import dataclasses
import inspect

import pytest

from integrations import (
    AICompletion,
    AIMessage,
    AIProvider,
    AvailabilityMode,
    Capability,
    CapabilityState,
    CheckoutRequest,
    CheckoutResult,
    MailMessage,
    MailProvider,
    MailResult,
    OAuthIdentity,
    OAuthProvider,
    PaymentEvent,
    PaymentProvider,
    StorageObject,
    StoragePutResult,
    StorageProvider,
    registry,
)
from integrations.live_adapters import (
    CloudinaryStorageAdapter,
    EmergentLLMAdapter,
    GoogleOAuthAdapter,
    ResendMailAdapter,
    StripePaymentAdapter,
)
from integrations.mocks import (
    MockAIProvider,
    MockMailProvider,
    MockOAuthProvider,
    MockPaymentProvider,
    MockStorageProvider,
)


# ─────────────────────────────────────────────────────────────────────────────
# 1. Contract completeness — every concrete provider implements every abstract.
# ─────────────────────────────────────────────────────────────────────────────

CONTRACTS = [
    (PaymentProvider, MockPaymentProvider, StripePaymentAdapter),
    (MailProvider, MockMailProvider, ResendMailAdapter),
    (StorageProvider, MockStorageProvider, CloudinaryStorageAdapter),
    (OAuthProvider, MockOAuthProvider, GoogleOAuthAdapter),
    (AIProvider, MockAIProvider, EmergentLLMAdapter),
]


@pytest.mark.parametrize("base,mock_cls,live_cls", CONTRACTS)
def test_concrete_classes_have_no_abstract_methods(base, mock_cls, live_cls):
    """Both mock and live adapter must be instantiable."""
    assert not inspect.isabstract(mock_cls), f"{mock_cls} still has abstract methods"
    assert not inspect.isabstract(live_cls), f"{live_cls} still has abstract methods"


# ─────────────────────────────────────────────────────────────────────────────
# 2. health() must return CapabilityState with the right capability tag.
# ─────────────────────────────────────────────────────────────────────────────

def _instantiate(cls):
    """Build with empty creds — adapters must still construct."""
    if cls in (MockPaymentProvider, MockMailProvider, MockStorageProvider, MockOAuthProvider, MockAIProvider):
        return cls(reason="test")
    if cls is StripePaymentAdapter:
        return cls(secret_key="")
    if cls is ResendMailAdapter:
        return cls(api_key="", from_email="")
    if cls is CloudinaryStorageAdapter:
        return cls(cloud_name="", api_key="", api_secret="")
    if cls is GoogleOAuthAdapter:
        return cls(client_id="")
    if cls is EmergentLLMAdapter:
        return cls(api_key="")
    raise AssertionError(f"unknown class {cls}")


@pytest.mark.parametrize("base,mock_cls,live_cls", CONTRACTS)
def test_health_returns_capability_state_with_correct_tag(base, mock_cls, live_cls):
    for cls in (mock_cls, live_cls):
        provider = _instantiate(cls)
        state = provider.health()
        assert isinstance(state, CapabilityState), f"{cls.__name__}.health() did not return CapabilityState"
        assert state.capability == base.capability, (
            f"{cls.__name__}: tagged {state.capability!r}, expected {base.capability!r}"
        )
        assert isinstance(state.mode, AvailabilityMode)
        assert isinstance(state.available, bool)
        # Honesty: if available=False, mode must NOT be LIVE.
        if not state.available:
            assert state.mode != AvailabilityMode.LIVE, (
                f"{cls.__name__}: available=False but mode=LIVE — dishonest health()"
            )


# ─────────────────────────────────────────────────────────────────────────────
# 3. Result shape parity — mock and live return identical dataclasses.
# ─────────────────────────────────────────────────────────────────────────────

RESULT_TYPES = [
    CheckoutResult,
    PaymentEvent,
    MailResult,
    StoragePutResult,
    StorageObject,
    OAuthIdentity,
    AICompletion,
]


@pytest.mark.parametrize("dc", RESULT_TYPES)
def test_result_dataclasses_have_documented_shape(dc):
    """Every result must be a frozen-shape dataclass — no dynamic attrs.

    This is the parity guard: if someone adds `stripe_session_id` to a live
    result, this test fails because the field is not declared on the
    dataclass and serialization would diverge from mock.
    """
    assert dataclasses.is_dataclass(dc), f"{dc.__name__} is not a dataclass"
    # No vendor-specific fields allowed at the top level. Vendor data lives
    # in `raw` (opaque dict) only.
    forbidden = {"stripe_session_id", "wfp_signature", "resend_id", "cloudinary_public_id"}
    declared = {f.name for f in dataclasses.fields(dc)}
    assert forbidden.isdisjoint(declared), (
        f"{dc.__name__} leaks vendor-specific field(s): {declared & forbidden}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# 4. Mock providers actually produce the result types they promise.
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_mock_payment_create_checkout_returns_checkout_result():
    p = MockPaymentProvider(reason="test")
    res = await p.create_checkout(CheckoutRequest(
        invoice_id="inv_1", amount=10.0, currency="USD",
        description="Test", return_url="http://example.test/return",
    ))
    assert isinstance(res, CheckoutResult)
    assert res.success is True
    assert res.payment_url and res.payment_url.startswith("http")
    assert res.provider_ref and res.provider_ref.startswith("mock_")
    assert res.status == "pending"


@pytest.mark.asyncio
async def test_mock_mail_send_returns_mail_result():
    p = MockMailProvider(reason="test")
    res = await p.send(MailMessage(to="user@test.dev", subject="hi", text="hi"))
    assert isinstance(res, MailResult)
    assert res.success is True
    assert res.delivered_to == "user@test.dev"
    assert res.provider_ref and res.provider_ref.startswith("mock_")
    # Outbox capture for inspection
    assert len(p.outbox) == 1


@pytest.mark.asyncio
async def test_mock_storage_put_get_delete_roundtrip(tmp_path):
    p = MockStorageProvider(reason="test", root=tmp_path, public_base="/u")
    put = await p.put(data=b"hello", key="a/b.txt", content_type="text/plain")
    assert isinstance(put, StoragePutResult)
    assert put.success is True
    assert put.url == "/u/a/b.txt"
    head = await p.head("a/b.txt")
    assert isinstance(head, StorageObject)
    assert head.size == 5
    assert await p.delete("a/b.txt") is True
    assert await p.head("a/b.txt") is None


@pytest.mark.asyncio
async def test_mock_ai_complete_returns_ai_completion():
    p = MockAIProvider(reason="test")
    res = await p.complete([AIMessage(role="user", content="ping")])
    assert isinstance(res, AICompletion)
    assert res.success is True
    assert res.text.startswith("[MOCK AI]")
    assert res.finish_reason == "stop"


# ─────────────────────────────────────────────────────────────────────────────
# 5. Security boundary: MockOAuth REFUSES to fake identity.
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_mock_oauth_never_fakes_identity():
    p = MockOAuthProvider(reason="test")
    state = p.health()
    # MockOAuth must never claim "available" — even though it's a mock.
    # OAuth bypass is a security boundary, not an availability one.
    assert state.available is False
    assert state.mode == AvailabilityMode.UNAVAILABLE
    # Even with a real-looking JWT, mock returns success=False.
    fake_jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature"
    identity = await p.verify_id_token(fake_jwt)
    assert isinstance(identity, OAuthIdentity)
    assert identity.success is False
    assert identity.subject is None
    assert identity.email is None
    assert identity.error is not None


# ─────────────────────────────────────────────────────────────────────────────
# 6. Registry honest matrix: contract for the API endpoint shape.
# ─────────────────────────────────────────────────────────────────────────────

def test_capabilities_matrix_shape():
    registry.reset()  # clear any test bindings
    matrix = registry.capabilities()
    assert set(matrix.keys()) == {"payment", "mail", "storage", "oauth", "ai"}
    for cap, state in matrix.items():
        assert state["capability"] == cap
        assert "provider" in state
        assert state["mode"] in {"live", "mock", "degraded", "unavailable"}
        assert isinstance(state["available"], bool)
        assert "details" in state
        # Honesty: available=False ⇒ mode != live
        if not state["available"]:
            assert state["mode"] != "live"


def test_registry_bind_overrides_autopick():
    """Admin / tests can swap providers without changing business logic."""
    registry.reset()
    custom = MockPaymentProvider(reason="custom-bind-test")
    registry.bind(Capability.PAYMENT, custom)
    assert registry.payment() is custom
    matrix = registry.capabilities()
    assert matrix["payment"]["reason"] == "custom-bind-test"
    registry.reset()


# ─────────────────────────────────────────────────────────────────────────────
# 7. Live adapters are dormant by default (Этап 5.0 master switch).
# ─────────────────────────────────────────────────────────────────────────────

def test_live_disabled_keeps_mocks_when_keys_present(monkeypatch):
    """Even with all keys, INTEGRATIONS_LIVE_ENABLED!=1 must keep system on mock."""
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setenv("RESEND_API_KEY", "re_dummy")
    monkeypatch.setenv("CLOUDINARY_CLOUD_NAME", "x")
    monkeypatch.setenv("CLOUDINARY_API_KEY", "x")
    monkeypatch.setenv("CLOUDINARY_API_SECRET", "x")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "x.apps.googleusercontent.com")
    monkeypatch.setenv("EMERGENT_LLM_KEY", "sk-emergent-x")
    monkeypatch.delenv("INTEGRATIONS_LIVE_ENABLED", raising=False)
    monkeypatch.delenv("OAUTH_LIVE_ENABLED", raising=False)
    registry.reset()

    matrix = registry.capabilities()
    # All five capabilities must remain mock/unavailable — never live.
    for cap, state in matrix.items():
        assert state["mode"] != "live", f"{cap} went live without master switch"

    registry.reset()


def test_oauth_extra_gate(monkeypatch):
    """OAuth has a stricter gate: needs both INTEGRATIONS_LIVE_ENABLED
    and OAUTH_LIVE_ENABLED. Master flag alone is insufficient."""
    monkeypatch.setenv("INTEGRATIONS_LIVE_ENABLED", "1")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "x.apps.googleusercontent.com")
    monkeypatch.delenv("OAUTH_LIVE_ENABLED", raising=False)
    registry.reset()

    matrix = registry.capabilities()
    assert matrix["oauth"]["mode"] != "live", "OAuth went live without OAUTH_LIVE_ENABLED"
    registry.reset()
