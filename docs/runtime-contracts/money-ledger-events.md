# Money Ledger Events

**Frozen contract.** Owner: `backend/money_ledger.py`.

The money ledger is the **single source of truth** for every state change
that affects money. It does NOT replace `invoices`, `escrow`, `earnings`,
or `payouts` collections — it sits ABOVE them, append-only, so any auditor
can answer *"where did this dollar go?"* in one query.

## Event types (frozen, ordered)

The canonical chain, in order of natural occurrence per project module:

| # | Event type | Entity | Triggered by |
|---|------------|--------|--------------|
| 1 | `invoice_paid` | `invoice_id` | Successful payment webhook OR admin mark-paid. |
| 2 | `escrow_funded` | `escrow_id` | Funds moved into escrow once invoice paid. |
| 3 | `earning_reserved` | `earning_id` | (Optional) Pre-QA reservation. |
| 4 | `qa_approved` | `module_id` | QA verifier approves the module. |
| 5 | `earning_approved` | `earning_id` | Developer earning credited. Idempotent per module. |
| 6 | `escrow_released` | `escrow_id` | Escrow released to team. |
| 7 | `payout_batched` | `earning_id` | Earning included in a payout batch. |
| 8 | `payout_approved` | `payout_id` | Admin approves the batch. |
| 9 | `payout_paid` | `payout_id` | Admin marks the batch paid (real wire / Stripe). |

### Adding new events

Adding new events is **allowed** and does not bump the contract version. Old
readers must ignore unknown `event_type` values (the ledger logs a warning and
records the event anyway — see `record_event` in `money_ledger.py`).

Renaming or **removing** an existing event type is a breaking change.

## Document shape (frozen)

```jsonc
{
  "event_id":         "evt_a1b2c3d4e5f6g7",   // unique, server-generated
  "event_type":       "invoice_paid",          // one of ALL_EVENTS
  "entity_id":        "inv_2024_001",          // the primary entity (invoice/escrow/earning/payout/module)
  "project_id":       "prj_xyz",               // optional but populated when applicable
  "actor_id":         "user_71e3...",          // who caused this event (admin / system / webhook)
  "amount":           420.00,                  // float, optional. Always positive.
  "currency":         "USD",                   // ISO 4217. Default USD.
  "mode":             "live",                  // capability mode at write time. live|mock|degraded|unavailable
  "payload":          { ... },                 // free-form, vendor-neutral. NOT for business logic.
  "idempotency_key":  "stripe:evt_1Aa...",     // optional but strongly recommended
  "created_at":       "2026-05-08T22:14:24Z"   // ISO-8601 UTC
}
```

### Indexed fields (must remain indexed)

- `event_id` — unique
- `(event_type, idempotency_key)` — unique sparse (idempotency)
- `created_at` — descending (timeline reads)
- `entity_id` — entity-scoped queries
- `project_id` — project-scoped audits

## Idempotency contract (frozen)

Every writer SHOULD pass `idempotency_key`. Repeats with the same
`(event_type, idempotency_key)` are silently de-duplicated and return:

```python
{"recorded": False, "duplicate": True, "event_id": "<existing>"}
```

A successful first write returns:

```python
{"recorded": True, "duplicate": False, "event_id": "<new>"}
```

### Idempotency key conventions

| Source | Recommended key |
|--------|-----------------|
| Stripe webhook | `stripe:<stripe_event_id>` |
| WayForPay webhook | `wayforpay:<order_reference>:<status>` |
| Admin manual mark-paid | `admin:<actor_id>:<invoice_id>:<status>` |
| QA approval | `qa:<module_id>:<verifier_id>` |
| Payout transitions | `payout:<payout_id>:<status>` |

The same `idempotency_key` may legally be used for **different** event types
(e.g. `invoice_paid` and `escrow_funded` triggered by the same webhook). The
unique constraint is `(event_type, idempotency_key)`, not just `idempotency_key`.

## Money runtime invariants (frozen)

1. **Append-only.** No `update`, no `delete`. Mistakes are corrected by writing
   a compensating event.
2. **Money values are positive.** Direction is encoded by `event_type`, not by sign.
3. **`mode` is recorded at write time.** A live `payout_paid` for a `mock`
   invoice_paid is a real audit signal — keep both modes.
4. **Vendor-neutral payload.** Never store raw vendor fields as ledger keys.
   Stripe-specific blobs go inside `payload.raw`, normalized fields go at the top.
5. **Webhook handlers MUST be idempotent** — duplicate webhook delivery is
   normal. The ledger absorbs the duplicate; downstream side effects must
   re-check the duplicate flag before issuing notifications.

## Money event vs. capability mode

Capability `payment.mode = mock` ⇒ all writes carry `mode: "mock"`. The
ledger is the only honest record of which money flowed in mock vs. live.
Aggregation queries that only sum `mode === "live"` give the **real** balance.

## Reading the ledger

Use `money_ledger.list_events(db, ...)` — it returns the canonical projection
(no Mongo `_id`).

```jsonc
{
  "events": [ {event_id, event_type, ...}, ... ],
  "count": 17
}
```

Filterable by `event_type`, `entity_id`, `project_id`, `actor_id`, with
cursorable `limit` + `skip`.

## Forbidden

- ❌ Writing to `db.money_ledger_events` directly. Always go through `record_event`.
- ❌ Returning Mongo `_id` to clients (use the canonical projection).
- ❌ Storing wallet balances in the ledger. Balances are computed from events.
- ❌ Compensating mistakes by mutating the original event.

## Migration policy

- Adding fields: backward-compatible. Old readers ignore unknown fields.
- Renaming fields, changing index keys, or changing the idempotency tuple:
  treat as breaking. Bump a `version` field (currently implicit `v1`).
