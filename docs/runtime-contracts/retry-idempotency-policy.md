# Retry & Idempotency Policy

**Frozen contract.** Owners: `packages/runtime-client/src/middleware/retry.ts`,
`packages/runtime-client/src/middleware/dedup.ts`, `backend/middleware/error_shape.py`.

The single most dangerous regression vector in this system is "an HTTP call
got retried and accidentally double-charged a card / double-credited a
developer / sent two emails". This document defines the rules every layer
must obey to make that impossible.

## The retry rule (frozen)

> **A request may be retried only if BOTH:**
> 1. The error is `retryable: true` on the wire, AND
> 2. The HTTP method is idempotent OR the caller supplied an explicit
>    `idempotencyKey`.

Any layer (runtime-client middleware, server-side worker, manual UI button,
background job) MUST follow this rule. **There are no exceptions.**

## Method retry table (frozen)

| Method | Idempotent? | Retry without `idempotencyKey`? | Retry with explicit `idempotencyKey`? |
|--------|-------------|--------------------------------|---------------------------------------|
| `GET` | yes | ✅ always (per `retryable`) | ✅ always |
| `HEAD` | yes | ✅ always | ✅ always |
| `OPTIONS` | yes | ✅ always | ✅ always |
| `DELETE` | yes (idempotent by HTTP semantics) | ✅ always | ✅ always |
| `PUT` | yes (idempotent by HTTP semantics) | ✅ always | ✅ always |
| `PATCH` | **no** (partial update) | ❌ **NEVER** | ✅ only with key |
| `POST` | **no** | ❌ **NEVER** | ✅ only with key |

The runtime-client enforces this in `retry.ts::eligible`:

```ts
const eligible = isIdempotent(method) || !!idempotencyKey;
```

`isIdempotent` is true for `GET | HEAD | OPTIONS | DELETE | PUT`.

## What is `idempotencyKey`?

A caller-controlled string that the **server** uses to deduplicate a
non-idempotent operation. Two requests with the same `(endpoint,
idempotencyKey)` MUST produce the same outcome — the second one returns the
result of the first, with no side effects re-applied.

### When to use one

| Scenario | Required? |
|----------|-----------|
| Submit invoice (POST) | **yes** — accidental double click is normal |
| Approve payout (POST) | **yes** |
| Fund escrow (POST) | **yes** |
| Approve QA (POST) | **yes** — dedup also catches webhook duplicates |
| Submit time entry (POST) | recommended |
| Send chat message (POST) | recommended |
| Patch project description (PATCH) | optional |
| Login (POST) | not needed — natural idempotence is fine |

### How to mint one

| Source | Recommended key |
|--------|-----------------|
| User action with a unique form id | `<form_id>` |
| Money operation tied to an entity | `<actor_id>:<entity_id>:<operation>` |
| Webhook | provided by vendor: `stripe:<event.id>`, `wayforpay:<orderRef>:<status>` |

The runtime-client never auto-generates an `idempotencyKey` for POST. The
caller must mint one explicitly. This is a **deliberate** ergonomic friction
to prevent careless retries.

## Backoff (implementation, not frozen)

Current default in `retry.ts`:

- Attempt 1: ~200 ms ± 20 % jitter
- Attempt 2: ~600 ms ± 20 %
- Attempt 3: ~1.4 s, capped at 2 s

Numbers are tuneable. The behaviour ("exponential with jitter, capped at 2s")
is what surfaces in the contract.

## Dedup (frozen)

In addition to retries, the runtime-client deduplicates **idempotent
in-flight** requests. Two identical `GET`s issued ~simultaneously collapse
into a single network call. POST/PATCH/PUT are **never** deduped — they may
look identical but carry distinct user intent (e.g. two pay clicks).

Per-call opt-out: `RequestConfig.noDedup = true`.

Key formula (frozen):

```ts
key = `${method} ${url}?${sorted(params).join('&')}`
```

If two callers pass differently-keyed params (different ordering of the same
fields), they collapse correctly — sorted keys ensure dedup keys are stable.

## Webhook semantics (frozen)

Every webhook the system accepts MUST be:

1. **Idempotent in handler** — handler reads vendor event id and short-circuits if already seen.
2. **Recorded in `money_ledger`** with `idempotency_key = "<provider>:<event.id>"`.
3. **Safe to replay** — vendor delivery semantics are at-least-once.

The HTTP webhook endpoint does NOT enforce idempotency at the transport
layer. Every business handler is expected to treat duplicate inputs as a
no-op.

## Money event semantics (frozen)

Every money-state-changing operation MUST:

1. Carry an `idempotency_key`.
2. Use `money_ledger.record_event` (which deduplicates on
   `(event_type, idempotency_key)`).
3. Tolerate `{"recorded": false, "duplicate": true}` as a non-error outcome.

Side effects (notifications, payouts, emails) MUST be guarded by the
ledger result — fire only when `recorded` is True. Otherwise duplicate
webhook deliveries spam users.

## Server-side rule for `retryable`

A response is `retryable: true` iff the failure can be safely retried with
the same input AND probably resolves on its own:

| Code | Retryable | Why |
|------|-----------|-----|
| `rate_limited` | ✅ | resets on its own |
| `upstream_error` | ✅ | provider may recover |
| `capability_degraded` | ✅ | may recover |
| `internal_error` | ✅ | best effort, with caps |
| `network_error` (client) | ✅ | usually transient |
| `timeout` (client) | ✅ | request may have completed; only retry if idempotent |
| `unauthorized` / `session_expired` | ❌ | adapter handles auth |
| `forbidden` | ❌ | input is the problem |
| `invalid_input` / `not_found` / `conflict` | ❌ | input is the problem |
| `payment_failed` / `insufficient_funds` | ❌ | money decision was final |
| `escrow_locked` / `contract_required` | ❌ | business state requires user action |
| `capability_offline` | ❌ | will not change without admin |

## Anti-patterns (forbidden)

| ❌ Don't | ✅ Do |
|---------|------|
| `axios.post(...).catch(() => axios.post(...))` | Use runtime-client; let middleware decide. |
| Auto-retry POST without `idempotencyKey`. | Mint a key, or accept non-retry. |
| Decide retry based on `error.message`. | Decide on `error.code` and `error.retryable`. |
| Retry `unauthorized`. | Refresh / re-login flow. |
| Skip `money_ledger.record_event` for "small" events. | All money state goes through ledger. |
| Treat `{duplicate:true}` as an error. | It's the contract. |

## Migration policy

- The retry rule itself is frozen. Tweaks to backoff curves are not.
- The dedup key formula is frozen — changing it changes correctness.
- Adding new retryable codes follows the procedure in
  `canonical-error-shape.md`.
