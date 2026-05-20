# `x-request-id` Propagation

**Frozen contract.** Owner: `backend/middleware/request_id.py`.

A single `request_id` follows every operation across the runtime — through
HTTP, logs, errors, compat aliases, internal forwards, and money events.
It is the primary key for "give me everything that happened on this user
action".

## The header

| | |
|---|---|
| **Name** | `x-request-id` (lowercase, exact) |
| **Direction** | request → server, echoed in response |
| **Format** | If client supplies one: passed through unchanged. Otherwise: 16 hex chars (`uuid4().hex[:16]`). |
| **Lifetime** | One HTTP transaction. Never reused. |

The header name is **frozen**.

## Server contract

Implemented as Starlette middleware, mounted **after** CORS so the id covers
the full pipeline:

```python
fastapi_app.add_middleware(CORSMiddleware, ...)
fastapi_app.add_middleware(RequestIdMiddleware)
```

The middleware:

1. Reads `x-request-id` from the request, or generates a fresh one.
2. Stores it on `request.state.request_id` and in a `ContextVar`.
3. Echoes it back as `x-request-id` on the response.
4. Resets the ContextVar in `finally` to avoid leaking across requests.

A `RequestIdFilter` (logging filter) injects `record.request_id` on every
`LogRecord` emitted within the request scope. All standard log lines from
within request handlers carry the id automatically.

## Where the id MUST appear

| Surface | Field | How it gets there |
|---------|-------|-------------------|
| Response body — error envelope | `request_id` | `error_shape._envelope` reads `get_request_id()`. |
| Response body — success | `request_id` (optional, where useful) | Handler reads `request.state.request_id`. |
| Response headers | `x-request-id` | `RequestIdMiddleware`. |
| Server log lines | `request_id` field on `LogRecord` | `RequestIdFilter`. |
| Compat-route log line | `request_id` | `compat_observability.compat_decorator`. |
| Compat internal forward | `x-request-id` header passed downstream | `_forward()` in `compat_routes.py`. |
| Telemetry events (UI) | `requestId` | `runtime-client/middleware/telemetry.ts`. |
| Money ledger events | (recommended in `payload.request_id`) | Caller responsibility. |
| WebSocket emissions | (recommended on payload) | Caller responsibility. |

## UI contract

The runtime-client (`packages/runtime-client/src/core/transport.ts`):

1. **Generates** `x-request-id` per call **only if** the caller didn't supply one.
   In practice, the runtime-client lets the server generate it and reads
   `response.headers['x-request-id']` to surface it.
2. **Stores it** on `ApiResponse.requestId` and `ApiError.requestId`.
3. **Logs it** in every telemetry event (`request_completed`, `request_failed`,
   `compat_route_hit`).

UI components MUST surface `error.requestId` to support staff so logs can be
matched. The recommended pattern is a "Copy ID" affordance in error toasts.

## Distributed tracing on day-zero

If a client supplies `x-request-id`, the server uses **that** id. This means
external systems (mobile crash reporter, customer support tooling, OTel
collectors) can pin an id end-to-end without coordinating with the backend.

## Compat layer specifics

When a request hits a compat alias, the alias forwarder issues a localhost
HTTP call to the canonical handler. The forwarder MUST propagate the original
`x-request-id`:

```python
# from compat_routes.py::_forward
rid = getattr(req.state, "request_id", None)
if rid:
    headers["x-request-id"] = rid
```

This way the canonical handler logs and the compat log line share the same id.

## Anti-patterns (forbidden)

| ❌ Don't | ✅ Do |
|---------|------|
| Log "request to /admin/finance done" without id. | Use the standard logger (id auto-injected). |
| Generate a new id inside a handler "for tracing". | Read `request.state.request_id`. |
| Strip the header on internal forwards. | Always pass through. |
| Surface a different id name (`X-Trace-Id`, `correlation-id`). | Always `x-request-id` (lowercase). |

## Migration policy

The header name is frozen. If OTel `traceparent` is added later, it joins
`x-request-id`, never replaces it — until a planned breaking-change window.
