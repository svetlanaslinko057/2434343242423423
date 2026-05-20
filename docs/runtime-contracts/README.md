# Runtime Contracts — README

This directory is the **frozen specification** of EVA-X / ATLAS DevOS runtime
contracts. Backend, web, and Expo all conform to these contracts.

## Purpose

> Lock the rules now, while the runtime is still small enough to keep
> consistent. Without these docs, in 2–3 weeks every new endpoint drifts
> into its own error shape, its own retry logic, its own capability bypass.

Anything documented here is **frozen**: changing a frozen contract requires
the procedure described in [Frozen Contracts](#frozen-contracts) below.
Anything **not** here is implementation detail and can evolve freely.

## Documents

| File | Owns |
|------|------|
| [`canonical-error-shape.md`](./canonical-error-shape.md) | Backend → UI error envelope. Stable codes. |
| [`capability-policy.md`](./capability-policy.md) | Capability manifest, modes, hard/soft policy. |
| [`money-ledger-events.md`](./money-ledger-events.md) | Money chain — event types, idempotency, ordering. |
| [`request-id-propagation.md`](./request-id-propagation.md) | `x-request-id` end-to-end. Logs, errors, compat, money events. |
| [`compat-route-lifecycle.md`](./compat-route-lifecycle.md) | Legacy URL alias layer. Header contract + retirement procedure. |
| [`retry-idempotency-policy.md`](./retry-idempotency-policy.md) | Which methods retry, when, what is `idempotencyKey`. |
| [`runtime-client-architecture.md`](./runtime-client-architecture.md) | UI ↔ backend transport — adapters, middleware order, telemetry. |

## Frozen Contracts

The following are **frozen** as of 2026-05-08. Changing any of them requires:

1. **Migration note** — append to the relevant doc with old → new diff.
2. **Compatibility review** — confirm both web and expo runtime-clients can handle old + new for at least one release window.
3. **Runtime-client review** — audit middleware (retry, dedup, capability-gate, telemetry) for assumption breaks.
4. **Bumped contract `version`** — every shape with a `version` field MUST bump it.

Frozen contracts:

- The error envelope keys: `ok`, `code`, `message`, `status`, `retryable`, `request_id` (+ optional `capability`, `mode`, `hint`, `details`).
- The full error code list in `backend/middleware/error_shape.py::ErrorCode` — codes can be **added**, never **renamed** or **removed**.
- The capability manifest top-level shape `{ capabilities, server_time, ttl_ms, version }`.
- The capability mode vocabulary: `live | mock | degraded | unavailable`.
- The capability policy vocabulary: `hard | soft`.
- The money ledger event type list (`money_ledger.ALL_EVENTS`).
- The money ledger idempotency key on `(event_type, idempotency_key)`.
- `x-request-id` header name + contract: 16 hex chars or client-supplied; backend echoes back unchanged.
- `x-compat-route` + `x-canonical-path` response header names + values.
- The retry semantics rule (see `retry-idempotency-policy.md`).

## Non-frozen (implementation detail)

- Internal middleware list ordering — can change as long as observable behavior is preserved.
- Backoff curves, dedup TTLs, telemetry batch sizes.
- Cosmetic message text.
- Internal Mongo collection schemas (the **API output** is frozen, the storage isn't).
