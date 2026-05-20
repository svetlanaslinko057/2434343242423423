/**
 * Web runtime-client singleton.
 *
 * Single instance shared across the entire web app. UI code imports this
 * (NOT @evax/runtime-client directly) so we keep one configured client.
 *
 * Migration pattern (pilot page → bulk):
 *
 *   // OLD (legacy axios):
 *   const r = await axios.get(`${API}/admin/mobile/finance`, { withCredentials: true });
 *   const data = r.data;
 *
 *   // NEW (runtime-client):
 *   import { runtime } from '../runtime';
 *   const { data } = await runtime.get('/api/admin/mobile/finance');
 *
 * Both keep cookie auth (withCredentials / credentials:'include').
 * The new client adds: x-request-id, canonical errors, capability awareness,
 * dedup, retry-on-idempotent, compat-route observability.
 */
import { createWebRuntimeClient } from '../runtime-client';
import type { TelemetryEvent } from '../runtime-client';

const RAW_BACKEND = (process.env.REACT_APP_BACKEND_URL || '').replace(/\/+$/, '');

/**
 * Telemetry sink — for now: console + window event. When OTel is added,
 * swap this implementation; the rest of the app doesn't change.
 */
function onTelemetry(ev: TelemetryEvent): void {
  // Compat route hit deserves visibility — surface as warn.
  if (ev.type === 'compat_route_hit') {
    // eslint-disable-next-line no-console
    console.warn('[runtime] compat_route_hit', ev);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('runtime:compat_route_hit', { detail: ev }));
    }
    return;
  }
  if (ev.type === 'request_failed') {
    // eslint-disable-next-line no-console
    console.warn('[runtime] request_failed', ev);
  }
}

export const runtime = createWebRuntimeClient({
  baseURL: RAW_BACKEND, // empty string → same-origin (preview deploy)
  defaultTimeoutMs: 20_000,
  defaultRetries: 2, // applies only to idempotent methods, retryable errors
  onTelemetry,
});

// Expose on window for runtime debugging (console.log, manual capability refresh).
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__evax_runtime = runtime;
}
