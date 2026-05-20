/**
 * Request orchestrator.
 *
 * Composes middleware in the canonical order:
 *
 *     dedup → capability-gate → retry → compat-route-tracker → transport
 *
 * Each middleware decides whether to proceed (`next()`) and may transform
 * the response or throw an ApiError. `transport()` is the terminal step.
 */
import type {
  RequestConfig,
  ApiResponse,
  RuntimeClientConfig,
  PlatformAdapter,
  Middleware,
  MiddlewareContext,
} from './types';
import { transport } from './transport';

const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isIdempotent(method: string | undefined): boolean {
  return IDEMPOTENT.has((method || 'GET').toUpperCase());
}

function buildCtx(config: RequestConfig, runtime: RuntimeClientConfig): MiddlewareContext {
  return {
    config: {
      url: config.url,
      method: (config.method || 'GET') as RequestConfig['method'] & string,
      timeoutMs: config.timeoutMs ?? runtime.defaultTimeoutMs ?? 15_000,
      retries: config.retries ?? runtime.defaultRetries ?? 0,
      // pass-through fields preserved as-is
      params: config.params,
      body: config.body,
      headers: config.headers,
      signal: config.signal,
      idempotencyKey: config.idempotencyKey,
      capability: config.capability,
      noDedup: config.noDedup,
    } as MiddlewareContext['config'],
    startTime: Date.now(),
    attempt: 0,
  };
}

/** Compose middleware list into a single chain ending with transport(). */
export function compose(
  middlewares: Middleware[],
  runtime: RuntimeClientConfig,
  adapter: PlatformAdapter,
): (config: RequestConfig) => Promise<ApiResponse> {
  return async (config) => {
    const ctx = buildCtx(config, runtime);
    let i = 0;
    const dispatch = async (): Promise<ApiResponse> => {
      if (i >= middlewares.length) {
        // Terminal step: transport.
        const cfg: RequestConfig = { ...ctx.config };
        return transport(cfg, runtime, adapter);
      }
      const mw = middlewares[i++];
      return mw(ctx, dispatch);
    };
    return dispatch();
  };
}
