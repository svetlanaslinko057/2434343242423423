# Canonical Error Shape

**Frozen contract.** Owners: `backend/middleware/error_shape.py`
(Python authority) ↔ `packages/runtime-client/src/errors/codes.ts` (TS mirror).

Every error returned by the backend to a UI client uses this exact envelope.
UI dispatches off `code` — **never** off `message`.

## Envelope

```jsonc
{
  "ok": false,             // ALWAYS false for an error response
  "code": "contract_required",   // stable machine-readable code (see registry)
  "message": "Sign the contract first.",  // human-readable; may be localised later
  "status": 409,           // mirrors HTTP status code
  "retryable": false,      // runtime-client retry middleware obeys this
  "request_id": "a3f9...", // 16-hex; tied to RequestIdMiddleware

  // Optional fields ↓
  "capability": "payment", // present when the failure is capability-tied
  "mode": "mock",          // capability mode at the moment of failure
  "hint": "Ask an admin to enable Stripe.",
  "details": [...]         // for invalid_input: per-field validation errors
}
```

## Code Registry (frozen — additive only)

Codes can be **added**, never **renamed** or **removed**. The web and Expo
runtime-client mirrors **must** match.

| Group | Code | Default status | Retryable |
|-------|------|----------------|-----------|
| Auth | `unauthorized` | 401 | no |
| Auth | `forbidden` | 403 | no |
| Auth | `session_expired` | 401 | no (adapter handles) |
| Validation | `invalid_input` | 400 / 422 | no |
| Validation | `not_found` | 404 | no |
| Validation | `conflict` | 409 | no |
| Business | `contract_required` | 409 | no |
| Business | `payment_failed` | 402 | no |
| Business | `insufficient_funds` | 402 | no |
| Business | `escrow_locked` | 409 | no |
| Runtime | `capability_offline` | 503 | no |
| Runtime | `capability_degraded` | 503 | yes |
| Runtime | `rate_limited` | 429 | yes |
| Internal | `internal_error` | 500 | yes |
| Internal | `upstream_error` | 502 | yes |
| Client-only | `network_error` | 0 | yes |
| Client-only | `timeout` | 0 | yes |
| Client-only | `aborted` | 0 | no |

### Adding a new code

1. Add it to `backend/middleware/error_shape.py::ErrorCode`.
2. Mirror it in `packages/runtime-client/src/errors/codes.ts::ErrorCode`.
3. Decide retryability and add to `_RETRYABLE_CODES` if applicable.
4. Document in this file with default status + retryable flag.
5. Bump no version — the list is additive.

## How handlers raise errors

### Preferred — `CanonicalHTTPError`

Carries code + capability metadata:

```python
from middleware.error_shape import CanonicalHTTPError, ErrorCode

raise CanonicalHTTPError(
    code=ErrorCode.CONTRACT_REQUIRED,
    status=409,
    message="Sign the contract first",
    capability="payment",
    mode="live",
    hint="Open /client/contract to sign.",
)
```

### Acceptable — plain `HTTPException`

When code/capability are not relevant. The handler synthesises a code from
status via `_STATUS_TO_CODE` (e.g. `401 → unauthorized`).

```python
raise HTTPException(status_code=404, detail="Project not found")
```

### Forbidden

- Returning `JSONResponse({"detail": "..."})` directly. Always raise.
- Returning `{"error": "..."}`. Use the envelope.
- Returning a 200 with `{"ok": false, ...}`. Errors must use the matching HTTP status.

## What the runtime-client guarantees on the UI side

- Every non-2xx response is parsed into an `ApiError` (see
  `packages/runtime-client/src/errors/ApiError.ts`).
- `error.code` matches the backend constant exactly.
- `error.requestId` is preserved for log correlation.
- `error.isAuthExpired` and `error.isCapabilityIssue` helpers exist as syntactic sugar.
- Network/timeout failures are surfaced as `network_error` / `timeout` (status 0).

## Rationale

> **Why a `code`?** UI conditional rendering and analytics break when text
> changes. Code is stable.
>
> **Why `retryable` on the wire?** The server knows whether retrying is
> safe (rate-limit reset vs. business conflict). Don't make the client guess.
>
> **Why `capability`/`mode` on errors?** Error UX often wants to render
> "feature is in mock mode" — without these fields the UI has to round-trip
> to the manifest endpoint just to format the error.

## Migration policy

If an error's `status` or `retryable` flag changes for an existing code, that
**is** a frozen-contract change (see `README.md`). Treat as a breaking change.
