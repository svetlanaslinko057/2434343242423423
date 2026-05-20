/**
 * Public type definitions for the runtime-client.
 * Pure types — no runtime values. Safe to import in any environment.
 */

// ─── HTTP primitives ─────────────────────────────────────────────────────────
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export interface RequestConfig {
  /** Path relative to baseURL. Always starts with `/`. Backend prefix `/api/...`. */
  url: string;
  method?: HttpMethod;
  /** Query parameters appended to the URL. */
  params?: Record<string, unknown>;
  /** JSON body for POST/PUT/PATCH. Auto-serialised. */
  body?: unknown;
  /** Override per-request timeout (ms). Default from config. */
  timeoutMs?: number;
  /** Caller-controlled cancellation. Composes with internal timeout signal. */
  signal?: AbortSignal;
  /**
   * For non-idempotent requests (POST creating a resource, payment, payout),
   * provide an idempotency key. Server treats requests with the same key as
   * one. NEVER auto-generated for POST — must be explicit (otherwise retry
   * could double-charge).
   */
  idempotencyKey?: string;
  /**
   * Capability this request belongs to. Capability gate uses this to decide
   * hard/soft block. Optional — calls without a capability tag always pass.
   */
  capability?: CapabilityName;
  /** Extra HTTP headers. */
  headers?: Record<string, string>;
  /**
   * Override the default retry budget. `0` disables retries entirely.
   * Retries only happen for explicitly-retryable errors AND idempotent methods.
   */
  retries?: number;
  /** Skip dedup for this single call (default: dedup applies to GETs). */
  noDedup?: boolean;
}

export interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  /** Backend's x-request-id, echoed for log correlation. */
  requestId: string;
  /** True if backend served via compat_routes layer (legacy URL still alive). */
  fromCompatRoute: boolean;
  /** If compat: canonical path the UI should migrate to. */
  canonicalPath?: string;
}

// ─── Capabilities ────────────────────────────────────────────────────────────
export type CapabilityName = 'payment' | 'mail' | 'storage' | 'oauth' | 'ai';
export type CapabilityMode = 'live' | 'mock' | 'degraded' | 'unavailable';
export type CapabilityPolicy = 'hard' | 'soft';

export interface CapabilityState {
  mode: CapabilityMode;
  available: boolean;
  policy: CapabilityPolicy;
  provider?: string;
  reason?: string;
}

export interface CapabilityManifest {
  capabilities: Record<CapabilityName, CapabilityState>;
  server_time: number;
  ttl_ms: number;
  version: string;
  /** Local timestamp when manifest was fetched (set by client). */
  fetched_at?: number;
}

// ─── Adapter contract ────────────────────────────────────────────────────────
/**
 * Platform adapter interface. Web/Expo each implement this to provide
 * platform-specific I/O (cookies, persistent storage, etc.).
 */
export interface PlatformAdapter {
  /** Persistent key-value store (used by capability cache). */
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;

  /**
   * Adapter-specific request decorator. Called BEFORE every request.
   * Used to inject Authorization header (expo) or set credentials:'include' (web).
   */
  decorateInit(init: RequestInit, config: RequestConfig): RequestInit;

  /**
   * Called when server returns 401 with `session_expired`. Adapter decides
   * whether to clear stored token, redirect to login, etc. Returns true if
   * the runtime-client should retry the request after the adapter handled it.
   */
  onAuthExpired?(): Promise<boolean>;

  /**
   * Optional: force re-read of the auth token from storage. Called by the
   * app layer after login/logout so the cached token tracks storage.
   * Web adapter: no-op (cookies, no in-memory token).
   */
  primeToken?(): Promise<void>;

  /**
   * Optional: awaited by the preflight middleware before every request.
   * Adapter implementations use this to guarantee the very first request
   * after cold-start has any token from storage in hand. Default: no-op.
   */
  ensureTokenReady?(): Promise<void>;
}

// ─── Runtime config ──────────────────────────────────────────────────────────
export interface RuntimeClientConfig {
  /**
   * Base URL for all requests. The runtime-client always prefixes `/api/...`,
   * so this should be the protocol+host only (e.g. `https://app.example.com`).
   */
  baseURL: string;
  /** Default timeout (ms). Per-request override via config.timeoutMs. */
  defaultTimeoutMs?: number;
  /** Default retry budget for retryable errors on idempotent methods. */
  defaultRetries?: number;
  /** Telemetry hook — called once per completed request (success or failure). */
  onTelemetry?: (event: TelemetryEvent) => void;
  /** Optional structured logger. Defaults to console. */
  logger?: {
    info: (msg: string, ctx?: Record<string, unknown>) => void;
    warn: (msg: string, ctx?: Record<string, unknown>) => void;
    error: (msg: string, ctx?: Record<string, unknown>) => void;
  };
}

export interface TelemetryEvent {
  type: 'request_completed' | 'request_failed' | 'compat_route_hit' |
        'capability_gate_blocked' | 'retry_attempt' | 'dedup_hit';
  url: string;
  method: HttpMethod;
  status?: number;
  durationMs?: number;
  requestId?: string;
  errorCode?: string;
  capability?: CapabilityName;
  canonicalPath?: string;
  attempt?: number;
}

// ─── Internal pipeline types ─────────────────────────────────────────────────
export interface MiddlewareContext {
  config: Required<Omit<RequestConfig, 'signal' | 'body' | 'params' | 'headers' |
                                        'idempotencyKey' | 'capability' | 'noDedup'>> &
          Pick<RequestConfig, 'signal' | 'body' | 'params' | 'headers' |
                              'idempotencyKey' | 'capability' | 'noDedup'>;
  startTime: number;
  attempt: number;
}

export type Middleware = (
  ctx: MiddlewareContext,
  next: () => Promise<ApiResponse>,
) => Promise<ApiResponse>;
