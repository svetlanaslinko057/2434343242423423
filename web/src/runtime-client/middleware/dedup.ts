/**
 * Dedup middleware — collapses identical in-flight idempotent requests
 * into a single network call.
 *
 * Key = method + url + sorted(params). POST/PATCH/PUT are NEVER deduped
 * (different semantics — even if body is identical, calling twice may be
 * intentional, e.g. two distinct pay-clicks).
 *
 * `noDedup: true` on RequestConfig opts out per-call.
 *
 * Emits `dedup_hit` telemetry on every coalesced call so observability can
 * count concurrent-refresh collapses (Probe 6 in runtime hardening doctrine).
 */
import type { Middleware, ApiResponse, RuntimeClientConfig, TelemetryEvent } from '../core/types';
import { isIdempotent } from '../core/request';

const inflight = new Map<string, Promise<ApiResponse>>();

function keyFor(method: string, url: string, params?: Record<string, unknown>): string {
  if (!params) return `${method} ${url}`;
  const keys = Object.keys(params).sort();
  const qs = keys.map((k) => `${k}=${String(params[k])}`).join('&');
  return `${method} ${url}?${qs}`;
}

export function makeDedupMiddleware(runtime: RuntimeClientConfig): Middleware {
  return async (ctx, next) => {
    const { method, url, params, noDedup } = ctx.config;
    if (noDedup || !isIdempotent(method)) return next();

    const key = keyFor(method, url, params);
    const existing = inflight.get(key);
    if (existing) {
      const ev: TelemetryEvent = {
        type: 'dedup_hit',
        url,
        method: method as TelemetryEvent['method'],
      };
      runtime.onTelemetry?.(ev);
      return existing;
    }
    const p = next().finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, p);
    return p;
  };
}

/** Back-compat export for callers that imported the legacy singleton. */
export const dedupMiddleware: Middleware = async (ctx, next) => {
  const { method, url, params, noDedup } = ctx.config;
  if (noDedup || !isIdempotent(method)) return next();
  const key = keyFor(method, url, params);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = next().finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
};
