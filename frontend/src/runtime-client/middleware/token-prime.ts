/**
 * Token-prime preflight middleware.
 *
 * On the very first request after cold-start (and any subsequent request
 * until adapter.primeToken() has resolved), this middleware awaits
 * `adapter.ensureTokenReady()` so the synchronous `decorateInit` step
 * always has the up-to-date cached token in hand.
 *
 * Web adapter: no-op (no token cache).
 * Expo adapter: blocks for ≤1 AsyncStorage.getItem on the very first call,
 *   then becomes a no-op (the promise resolves once and stays resolved).
 *
 * Mounted FIRST in the chain so it runs before transport, dedup, etc.
 */
import type { Middleware, PlatformAdapter } from '../core/types';

export function makeTokenPrimeMiddleware(adapter: PlatformAdapter): Middleware {
  return async (_ctx, next) => {
    if (adapter.ensureTokenReady) {
      try { await adapter.ensureTokenReady(); } catch { /* non-fatal */ }
    }
    return next();
  };
}
