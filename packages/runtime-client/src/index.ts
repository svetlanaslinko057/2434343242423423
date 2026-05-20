/**
 * @evax/runtime-client — public API.
 *
 * Two factory entry points:
 *   - `createWebRuntimeClient(config)` — for the React/CRA web app
 *   - `createExpoRuntimeClient(config)` — for the Expo mobile app
 *
 * Both return the same `RuntimeClient` interface. UI code never imports
 * adapters/middleware directly — only the interface.
 *
 * Middleware chain (canonical order, top → bottom):
 *   token-prime  → awaits adapter.ensureTokenReady() on every request (cheap after warm-up)
 *   telemetry    → emits request_completed / request_failed / compat_route_hit
 *   auth-expired → catches 401/session_expired → adapter.onAuthExpired() (P0 #1)
 *   dedup        → coalesces concurrent identical GETs; emits dedup_hit
 *   capability-gate → enforces hard/soft capability policy
 *   retry        → backoff for retryable errors; emits retry_attempt
 *   transport    → terminal fetch call
 */
import type {
  RuntimeClientConfig,
  RequestConfig,
  ApiResponse,
  PlatformAdapter,
  Middleware,
} from './core/types';
import { compose } from './core/request';
import { createWebAdapter } from './adapters/web';
import { createExpoAdapter, ExpoAdapterOptions } from './adapters/expo';
import { makeDedupMiddleware } from './middleware/dedup';
import { makeRetryMiddleware } from './middleware/retry';
import { capabilityGateMiddleware } from './middleware/capability-gate';
import { makeTelemetryMiddleware } from './middleware/telemetry';
import { makeAuthExpiredMiddleware } from './middleware/auth-expired';
import { makeTokenPrimeMiddleware } from './middleware/token-prime';
import { CapabilityClient } from './capabilities/client';
import { capabilityStore } from './capabilities/store';

export { ApiError, clientError } from './errors/ApiError';
export { ErrorCode } from './errors/codes';
export type {
  RuntimeClientConfig,
  RequestConfig,
  ApiResponse,
  PlatformAdapter,
  CapabilityName,
  CapabilityState,
  CapabilityMode,
  CapabilityPolicy,
  CapabilityManifest,
  TelemetryEvent,
  HttpMethod,
  Middleware,
} from './core/types';
export type { ApiErrorPayload } from './errors/ApiError';

export interface RuntimeClient {
  /** Single canonical request entry point. */
  request<T = unknown>(config: RequestConfig): Promise<ApiResponse<T>>;
  /** Convenience helpers (sugar over `request()`). */
  get<T = unknown>(url: string, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<ApiResponse<T>>;
  post<T = unknown>(url: string, body?: unknown, config?: Omit<RequestConfig, 'url' | 'method' | 'body'>): Promise<ApiResponse<T>>;
  put<T = unknown>(url: string, body?: unknown, config?: Omit<RequestConfig, 'url' | 'method' | 'body'>): Promise<ApiResponse<T>>;
  patch<T = unknown>(url: string, body?: unknown, config?: Omit<RequestConfig, 'url' | 'method' | 'body'>): Promise<ApiResponse<T>>;
  delete<T = unknown>(url: string, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<ApiResponse<T>>;
  /** Capability sub-client. */
  capabilities: CapabilityClient;
  /** Direct store access for hooks. */
  capabilityStore: typeof capabilityStore;
  /**
   * Force re-read of auth token from persistent storage. Call this from
   * the auth layer after login/logout so the runtime tracks the current
   * token. Web adapter: no-op (cookies). Expo adapter: re-reads atlas_token.
   */
  primeToken(): Promise<void>;
}

function buildClient(
  config: RuntimeClientConfig,
  adapter: PlatformAdapter,
): RuntimeClient {
  const middlewares: Middleware[] = [
    makeTokenPrimeMiddleware(adapter),
    makeTelemetryMiddleware(config),
    makeAuthExpiredMiddleware(adapter),
    makeDedupMiddleware(config),
    capabilityGateMiddleware,
    makeRetryMiddleware(config),
  ];
  const exec = compose(middlewares, config, adapter);

  const capabilities = new CapabilityClient(config, adapter);
  void capabilities.boot();

  const request = <T = unknown>(req: RequestConfig) =>
    exec(req) as Promise<ApiResponse<T>>;

  return {
    request,
    get: (url, c) => request({ ...(c || {}), url, method: 'GET' }),
    post: (url, body, c) => request({ ...(c || {}), url, method: 'POST', body }),
    put: (url, body, c) => request({ ...(c || {}), url, method: 'PUT', body }),
    patch: (url, body, c) => request({ ...(c || {}), url, method: 'PATCH', body }),
    delete: (url, c) => request({ ...(c || {}), url, method: 'DELETE' }),
    capabilities,
    capabilityStore,
    primeToken: async () => {
      if (adapter.primeToken) await adapter.primeToken();
    },
  };
}

export function createWebRuntimeClient(config: RuntimeClientConfig): RuntimeClient {
  return buildClient(config, createWebAdapter());
}

export function createExpoRuntimeClient(
  config: RuntimeClientConfig,
  adapterOptions?: ExpoAdapterOptions,
): RuntimeClient {
  return buildClient(config, createExpoAdapter(adapterOptions));
}
