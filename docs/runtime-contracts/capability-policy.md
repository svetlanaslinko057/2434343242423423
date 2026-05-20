# Capability Policy

**Frozen contract.** Owners: `backend/integrations_api.py` (Python authority,
`/api/integrations/manifest`) ↔ `packages/runtime-client/src/middleware/capability-gate.ts`,
`capabilities/store.ts` (TS authority).

Capabilities describe *honest system state* — what the system can really do
right now, not what it could do if all keys were configured. The runtime-client
uses the manifest to gate or warn before requests leave the device.

## Capability vocabulary

### Capability names (frozen, additive)

| Name | What it covers |
|------|----------------|
| `payment` | Card processing, escrow funding, payouts. |
| `oauth` | Third-party identity (Google, etc.). |
| `ai` | LLM calls (scope builder, summaries, intel). |
| `storage` | File uploads, image hosting (Cloudinary). |
| `mail` | Transactional email (Resend / SMTP). |

Adding a new capability is additive. Renaming or removing one is a breaking
change (frozen).

### Mode (frozen)

`mode` ∈ `{ live, mock, degraded, unavailable }`

| Mode | Meaning |
|------|---------|
| `live` | Real provider configured and reachable. |
| `mock` | Provider unconfigured; runs in fake mode (visible to admins). |
| `degraded` | Provider configured but currently failing health checks. |
| `unavailable` | Provider intentionally disabled. |

### Policy (frozen)

`policy` ∈ `{ hard, soft }`

| Policy | Hard rule | Default for |
|--------|-----------|-------------|
| `hard` | Block request if `mode != live`. UI shows "feature offline". | `payment`, `oauth` |
| `soft` | Always allow. UI may render a "MOCK" / "DEGRADED" badge. | `ai`, `storage`, `mail` |

The default mapping lives in `_CAPABILITY_POLICY` in `integrations_api.py`.
A capability MAY override its policy but the vocabulary itself is frozen.

## Manifest envelope (frozen, versioned)

`GET /api/integrations/manifest` (public, no auth):

```jsonc
{
  "capabilities": {
    "payment": {
      "mode": "mock",         // live | mock | degraded | unavailable
      "available": true,      // can be called at all
      "policy": "hard",       // hard | soft
      "provider": "stripe",   // optional, opaque label
      "reason": "STRIPE_SECRET_KEY not set"  // optional, human-readable
    },
    "oauth":   { "mode": "mock", "available": true, "policy": "hard", ... },
    "ai":      { "mode": "live", "available": true, "policy": "soft", "provider": "emergent" },
    "storage": { "mode": "mock", "available": true, "policy": "soft", ... },
    "mail":    { "mode": "mock", "available": true, "policy": "soft", ... }
  },
  "server_time": 1715200000000,   // epoch ms
  "ttl_ms": 300000,               // runtime-client TTL (5 min)
  "version": "1"                  // bump on breaking shape change
}
```

`server_time + ttl_ms` is the only freshness signal. The runtime-client
caches the manifest layer-by-layer:

1. **Memory** — current process.
2. **Persisted** — `AsyncStorage` (Expo) / `localStorage` (web).
3. **Network** — refresh once TTL expires, on app boot, and on demand.

## Gating semantics

### Hard policy

A request tagged `capability: 'payment'` (in the runtime-client `RequestConfig`)
is **blocked client-side** if the cached mode is not `live`. The block surfaces
as an `ApiError` with:

```
code:        capability_offline
status:      503
retryable:   false
capability:  payment
mode:        mock
hint:        <reason from manifest>
```

The request never leaves the device. UI catches it and shows an explainer +
admin CTA.

### Soft policy

The request always passes through. UI is responsible for rendering a badge
based on the cached mode. The runtime-client **does not** auto-decorate
responses; it only ensures the manifest is observable.

### Untagged requests

If `RequestConfig.capability` is `undefined`, the gate **does not apply**.
Most read endpoints don't need a capability tag. Tag a request **only** when
the call's success genuinely depends on a third-party integration.

## Inter-surface invariants

- The same manifest is served to web and Expo. There is **no** per-platform
  policy override.
- Backend handlers MAY also raise `capability_offline` server-side (e.g. when
  manifest cache is stale on the client). UI must handle both flows
  (client-side gate AND server-side error) identically.
- `_CAPABILITY_POLICY` and the `CapabilityName` TS union are kept in sync
  manually. A pre-deploy diff check is recommended once Stage 3 starts.

## Anti-patterns (forbidden)

| ❌ Don't | ✅ Do |
|---------|------|
| Branch UI on provider name (`if provider === 'stripe'`). | Branch on `mode === 'live'`. |
| Refresh manifest on every navigation. | Honour `ttl_ms`; refresh on `401` or explicit user action. |
| Inspect `process.env` for "is Stripe configured?". | Read `capabilityStore.peek('payment')`. |
| Encode policy in UI code. | Read `state.policy` from the manifest. |

## Migration policy

- **Adding a capability**: append to `CapabilityName` TS union AND to backend
  registry. Default to `policy: 'soft'` unless the failure mode involves money or identity.
- **Changing a capability's policy**: bump manifest `version`. Old runtime-clients
  that don't recognise the new policy must default to `'soft'`.
- **Adding a new mode value**: bump `version`. Old clients treat unknown modes as
  `unavailable` (safe default).
