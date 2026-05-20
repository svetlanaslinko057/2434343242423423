/**
 * Auth-expired middleware — bridges 401 responses to the adapter's
 * `onAuthExpired` hook.
 *
 * Without this middleware, transport throws `ApiError(code:'unauthorized')`
 * on 401 but no code path notifies the adapter — so stale-token recovery
 * (clear AsyncStorage + listener-driven UI redirect to /auth) never fires.
 * The result is a silent retry storm: every subsequent request returns
 * 401 with no recovery.
 *
 * Behaviour:
 *   - Catches `ApiError` with code 'unauthorized' or 'session_expired'.
 *   - Calls `adapter.onAuthExpired()` — adapter decides whether to retry.
 *   - If retry === true, repeats the request ONCE (no infinite loop).
 *   - If retry === false (default), re-throws the original error.
 *
 * Mounted AFTER `telemetry` (so failed-auth events are still logged) and
 * BEFORE `dedup` / `capability-gate` / `retry` (so the auth recovery
 * runs ONCE per request, not per retry attempt).
 */
import type { Middleware, PlatformAdapter } from '../core/types';
import { ApiError } from '../errors/ApiError';
import { ErrorCode } from '../errors/codes';

export function makeAuthExpiredMiddleware(adapter: PlatformAdapter): Middleware {
  return async (ctx, next) => {
    try {
      return await next();
    } catch (err) {
      const isAuthErr =
        err instanceof ApiError &&
        (err.code === ErrorCode.UNAUTHORIZED ||
         err.code === ErrorCode.SESSION_EXPIRED);
      if (!isAuthErr || !adapter.onAuthExpired) throw err;

      let shouldRetry = false;
      try {
        shouldRetry = await adapter.onAuthExpired();
      } catch {
        shouldRetry = false;
      }
      if (!shouldRetry) throw err;
      // Adapter says it recovered (refreshed token, etc) — retry ONCE.
      return await next();
    }
  };
}
