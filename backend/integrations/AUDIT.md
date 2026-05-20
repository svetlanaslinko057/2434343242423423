# Vendor Isolation Audit — Этап 5.1 (post-migration)

> Single rule: **business logic and UI must never type a vendor name.**
> All external dependencies flow through `integrations.registry.*()`.

This file lists every place in the codebase that still bypasses the
boundary layer. Each entry is a known leak that **must** be migrated
before a capability can flip to LIVE in Этап 5.2+.

The static guard `tests/test_call_sites.py::test_no_vendor_module_imported_in_business_layer`
runs this scan automatically and fails on any **new** leak. Documented
leaks below are listed in its `KNOWN_LEAKS` set.

---

## Migration status — Этап 5.1

| Capability | Call site                                  | Status | Goes through              |
|------------|--------------------------------------------|--------|---------------------------|
| Mail       | `auth_otp.py` OTP send                     | ✅ done | `registry.mail().send()`  |
| Payments   | `server.py::_provider_create_payment`      | ✅ done | `registry.payment().create_checkout()` |
| Payments   | `server.py::continue_to_next_milestone`    | ✅ done | `registry.payment()` (via shim) |
| Storage    | `account_layer.py` avatar upload/delete    | ✅ done | `registry.storage().put/delete()` |
| OAuth      | `google_auth.py::google_signin`            | ✅ done | `registry.oauth().verify_id_token()` |
| AI         | `server.py::ai_generate_scope`             | ✅ done | `_ai_is_live()` gate + deterministic fallback |

---

## Documented residual leaks (Этап 5.2 removal targets)

### 1. Stripe webhook — `server.py:23480` and `server.py:23531`

```
from emergentintegrations.payments.stripe.checkout import StripeCheckout
```

Used in:
- `POST /api/webhook/stripe` — Stripe webhook receiver (signature verify)
- `GET  /api/payments/stripe/status/{session_id}` — frontend polling

**Why still here:** these endpoints implement Stripe-specific HMAC
signature verification and session polling. The new vendor-neutral
`POST /api/integrations/payments/webhook` exists in `integrations_api.py`
but doesn't yet implement HMAC verification.

**Removal plan (Этап 5.2):**
1. Move HMAC verification into `StripePaymentAdapter.verify_webhook()`.
2. Add a `get_status(provider_ref)` method to the `PaymentProvider`
   contract; implement it in Stripe adapter using `StripeCheckout.get_checkout_status`.
3. Delete the two endpoints; replace clients with the vendor-neutral one.

### 2. Mobile OAuth fallback — `mobile_adapter.py:362-363`

```
from google.oauth2 import id_token as _gid_token
from google.auth.transport import requests as _g_req
```

Used in: mobile auth fallback when the unified `/api/auth/google` route
is bypassed by a legacy mobile client.

**Removal plan (Этап 5.2):** delete the fallback path; mobile client
must hit `/api/auth/google` like the web client does.

### 3. Admin live-key probe — `admin_integrations.py:427,557`

```
import stripe as stripe_lib
```

Used in: admin "Test connection" buttons that probe vendor APIs to
validate keys before saving them.

**Status:** intentional & allowed. This is a meta-flow (admin testing
the boundary configuration) — not business logic. Marked in `ALLOWED`
list of the static guard.

---

## Forbidden patterns (caught by static test)

These appear **only** in `integrations/live_adapters.py` and the legacy
vendor-facade modules (`google_auth.py`, `cloudinary_service.py`,
`email_service.py`, `payment_providers/*`):

```python
# ❌ Never in business code
import stripe
from emergentintegrations.payments.stripe.checkout import StripeCheckout
import resend
import cloudinary
from google.oauth2 import id_token

# ✅ Always
from integrations import registry
result = await registry.payment().create_checkout(req)
event  = await registry.payment().verify_webhook(body, headers)
```

---

## Promotion checklist (per capability) — for Этап 5.2

Before flipping `mock` → `live`:

1. ☐ All call sites in this audit migrated to `registry.X()`.
2. ☐ Contract tests pass (`tests/test_integration_contracts.py`,
      `tests/test_call_sites.py`).
3. ☐ Live adapter implements **every** abstract method including
      `verify_webhook` for payments.
4. ☐ `health()` returns `LIVE` only when keys validate (not just present).
5. ☐ Webhook signature verification (HMAC) implemented and tested.
6. ☐ Failure path returns `Result(success=False, error=...)` — never raises.
7. ☐ `INTEGRATIONS_LIVE_ENABLED=1` set in deploy env.
8. ☐ For OAuth: also `OAUTH_LIVE_ENABLED=1`.
9. ☐ Updated `KNOWN_LEAKS` in `tests/test_call_sites.py` (entries removed
      as they're migrated).
