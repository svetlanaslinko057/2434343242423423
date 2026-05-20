/**
 * Telemetry middleware — emits one event per completed request.
 *
 * Wraps the chain to measure duration, capture status/error code, and
 * forward to `runtimeConfig.onTelemetry`. Also fires a separate
 * `compat_route_hit` event when backend returned `x-compat-route: true`.
 *
 * Why a middleware (vs in transport): the orchestrator wants the
 * post-retry view (final status, total duration including backoff).
 */
import type { Middleware, RuntimeClientConfig, TelemetryEvent } from '../core/types';
import { ApiError } from '../errors/ApiError';

export function makeTelemetryMiddleware(runtime: RuntimeClientConfig): Middleware {
  return async (ctx, next) => {
    const t0 = Date.now();
    try {
      const resp = await next();
      const ev: TelemetryEvent = {
        type: 'request_completed',
        url: ctx.config.url,
        method: ctx.config.method as TelemetryEvent['method'],
        status: resp.status,
        durationMs: Date.now() - t0,
        requestId: resp.requestId,
        capability: ctx.config.capability,
        attempt: ctx.attempt,
      };
      runtime.onTelemetry?.(ev);
      if (resp.fromCompatRoute) {
        runtime.onTelemetry?.({
          type: 'compat_route_hit',
          url: ctx.config.url,
          method: ctx.config.method as TelemetryEvent['method'],
          status: resp.status,
          requestId: resp.requestId,
          canonicalPath: resp.canonicalPath,
        });
        runtime.logger?.warn('compat_route_hit', {
          legacy: ctx.config.url,
          canonical: resp.canonicalPath,
          requestId: resp.requestId,
        });
      }
      return resp;
    } catch (err) {
      const ev: TelemetryEvent = {
        type: 'request_failed',
        url: ctx.config.url,
        method: ctx.config.method as TelemetryEvent['method'],
        durationMs: Date.now() - t0,
        capability: ctx.config.capability,
        attempt: ctx.attempt,
      };
      if (err instanceof ApiError) {
        ev.status = err.status;
        ev.requestId = err.requestId;
        ev.errorCode = err.code;
      }
      runtime.onTelemetry?.(ev);
      throw err;
    }
  };
}
