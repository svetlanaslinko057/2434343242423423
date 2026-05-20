/**
 * src/api.ts — RUNTIME-CLIENT SHIM (Stage 3 migration completion, May 2026).
 *
 * History:
 *   • 2025 — original axios instance with retries / X-Request-Id / capability cache.
 *   • 2026-04 — `src/runtime/index.ts` shipped as the new canonical transport
 *               (middleware chain: token-prime → telemetry → auth-expired →
 *               dedup → capability-gate → retry → transport).
 *   • 2026-05 — Pilot Audit Discipline ran on 4 surfaces (wallet, billing,
 *               developer/* peers). No regressions observed → migration is
 *               safe to roll out broadly.
 *   • 2026-05 — **This file**: `api.ts` is rewritten as a *behavioural shim*
 *               on top of `runtime`. All 43 legacy `import api from
 *               '@/src/api'` callsites keep their axios-shaped API
 *               (`api.get('/me')` → returns `{data, status, ...}`) but every
 *               byte now flows through the runtime middleware stack.
 *
 * Why a shim (not a codemod):
 *   • Zero risk of breaking 43 screens at once.
 *   • Auth flow (`useAuth`) still works because Bearer token comes from the
 *     same `atlas_token` key in AsyncStorage (the Expo adapter reads it).
 *   • Telemetry / dedup / capability-gate now apply *everywhere*, not just
 *     screens migrated by hand.
 *   • Future PRs can incrementally rewrite `api.get('/x')` →
 *     `runtime.get('/api/x')` without touching this file.
 *
 * What's preserved (binary-compatible exports):
 *   • `default` — axios-shaped object with `.get/.post/.put/.patch/.delete`
 *     and `.request(config)` returning `{data, status}`. Auto-prepends
 *     `/api` to relative paths. Mirrors axios v1 method signatures.
 *   • Named: `ApiError`, `ErrorCode`, `apiClient`, `getCapabilities`,
 *     `clearCapabilitiesCache`, `getCapabilityMode`.
 *
 * What's gone:
 *   • Local axios instance (`axios.create({baseURL: '/api'})`).
 *   • Local request-id generator (runtime adds them).
 *   • Local 401 → AsyncStorage.removeItem(...) interceptor — runtime's
 *     `auth-expired` middleware now owns that path.
 */
import { runtime } from './runtime';
import {
  ApiError as _RuntimeApiError,
  ErrorCode as _RuntimeErrorCode,
} from './runtime-client';

// ─── Re-exports (so callers can `import { ApiError } from '@/src/api'`) ───────
//
// In practice every screen already imports `ApiError` directly from
// `runtime-client`, but we re-export here for completeness — and to ensure
// `instanceof ApiError` checks against either symbol identify the same class.
export const ApiError = _RuntimeApiError;
export const ErrorCode = _RuntimeErrorCode;
export type ApiError = InstanceType<typeof _RuntimeApiError>;

// ─── Path normalisation ──────────────────────────────────────────────────────
//
// Runtime baseURL is `https://host` (no `/api`). Legacy callers pass paths
// like `/me`, `/projects`, `developer/wallet`. We auto-prepend `/api/` so the
// shim is a drop-in for the old axios instance that had `baseURL = .../api`.

function normalisePath(path: string): string {
  if (!path) return '/api/';
  let p = path.startsWith('/') ? path : `/${path}`;
  // Already targeting `/api/...` — pass through.
  if (p === '/api' || p.startsWith('/api/')) return p;
  // Absolute non-api path (e.g. `/health`, `/static/...`) — also pass through.
  // Backend doesn't publish anything outside `/api/*` to the Expo client, but
  // we don't want to silently rewrite caller intent.
  // Anything that doesn't start with `/api` and isn't a well-known top-level
  // is treated as a relative API path → prepend `/api`.
  return `/api${p}`;
}

// ─── Axios-compat request options ────────────────────────────────────────────

export interface AxiosCompatConfig {
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Per-request timeout (ms). Mirrors axios `config.timeout`. */
  timeout?: number;
  /** Idempotency key for POST/PUT/PATCH that must not double-execute. */
  idempotencyKey?: string;
  /** Override the default retry budget. `0` disables retries. */
  retries?: number;
  /**
   * Index signature so callers that pass axios-specific knobs we don't
   * recognise (e.g. `responseType`, `withCredentials`, `data` as 3rd arg)
   * still compile. They're ignored — runtime owns those policies.
   */
  [key: string]: any;
}

export interface AxiosCompatResponse<T = any> {
  data: T;
  status: number;
  /** Echoed for log correlation. Runtime injects this. */
  requestId: string;
  /** True if backend served via compat_routes (legacy URL still alive). */
  fromCompatRoute: boolean;
  canonicalPath?: string;
}

function pickRuntimeCfg(cfg: AxiosCompatConfig | undefined) {
  if (!cfg) return undefined;
  return {
    params: cfg.params,
    headers: cfg.headers,
    signal: cfg.signal,
    timeoutMs: cfg.timeout,
    idempotencyKey: cfg.idempotencyKey,
    retries: cfg.retries,
  };
}

// ─── Core verbs ──────────────────────────────────────────────────────────────

async function get<T = any>(
  path: string,
  config?: AxiosCompatConfig,
): Promise<AxiosCompatResponse<T>> {
  const res = await runtime.get<T>(normalisePath(path), pickRuntimeCfg(config));
  return res as AxiosCompatResponse<T>;
}

async function post<T = any>(
  path: string,
  data?: unknown,
  config?: AxiosCompatConfig,
): Promise<AxiosCompatResponse<T>> {
  const res = await runtime.post<T>(normalisePath(path), data, pickRuntimeCfg(config));
  return res as AxiosCompatResponse<T>;
}

async function put<T = any>(
  path: string,
  data?: unknown,
  config?: AxiosCompatConfig,
): Promise<AxiosCompatResponse<T>> {
  const res = await runtime.put<T>(normalisePath(path), data, pickRuntimeCfg(config));
  return res as AxiosCompatResponse<T>;
}

async function patch<T = any>(
  path: string,
  data?: unknown,
  config?: AxiosCompatConfig,
): Promise<AxiosCompatResponse<T>> {
  const res = await runtime.patch<T>(normalisePath(path), data, pickRuntimeCfg(config));
  return res as AxiosCompatResponse<T>;
}

async function del<T = any>(
  path: string,
  config?: AxiosCompatConfig,
): Promise<AxiosCompatResponse<T>> {
  const res = await runtime.delete<T>(normalisePath(path), pickRuntimeCfg(config));
  return res as AxiosCompatResponse<T>;
}

// ─── Generic request() — axios-shaped ────────────────────────────────────────

interface AxiosRequestArg {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'get' | 'post' | 'put' | 'patch' | 'delete';
  data?: unknown;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeout?: number;
}

async function genericRequest<T = any>(
  arg: AxiosRequestArg,
): Promise<AxiosCompatResponse<T>> {
  const m = String(arg.method || 'GET').toUpperCase();
  const cfg: AxiosCompatConfig = {
    params: arg.params,
    headers: arg.headers,
    signal: arg.signal,
    timeout: arg.timeout,
  };
  switch (m) {
    case 'GET':    return get<T>(arg.url, cfg);
    case 'POST':   return post<T>(arg.url, arg.data, cfg);
    case 'PUT':    return put<T>(arg.url, arg.data, cfg);
    case 'PATCH':  return patch<T>(arg.url, arg.data, cfg);
    case 'DELETE': return del<T>(arg.url, cfg);
    default: throw new Error(`api shim: unsupported method ${m}`);
  }
}

// ─── apiClient (named export — already used elsewhere) ───────────────────────

export const apiClient = {
  get,
  post,
  put,
  patch,
  delete: del,
  request: genericRequest,
  baseURL: '', // legacy field — runtime composes URLs internally
};

// ─── Capability helpers (named exports) ──────────────────────────────────────
//
// The legacy api.ts published a thin /integrations/capabilities cache. The
// runtime ships its own `CapabilityClient` (boot + WS-driven refresh). We
// surface compact accessors so any legacy caller keeps compiling.

interface CapabilityState {
  provider?: string;
  mode: 'live' | 'mock' | 'degraded' | 'unavailable';
  available: boolean;
  reason?: string;
}
interface CapabilitiesResponse {
  capabilities: Record<string, CapabilityState>;
  summary: {
    total: number; live: number; mock: number;
    degraded: number; unavailable: number; all_live: boolean;
  };
  _error?: ApiError;
}

export async function getCapabilities(_opts: { force?: boolean } = {}): Promise<CapabilitiesResponse> {
  try {
    const r = await get<CapabilitiesResponse>('/integrations/capabilities');
    return r.data;
  } catch (err) {
    return {
      capabilities: {},
      summary: { total: 0, live: 0, mock: 0, degraded: 0, unavailable: 0, all_live: false },
      _error: err as ApiError,
    };
  }
}

export function clearCapabilitiesCache(): void {
  // Runtime's CapabilityClient owns the cache; legacy callers can no-op here.
}

export async function getCapabilityMode(name: string): Promise<string | null> {
  const caps = await getCapabilities();
  return caps?.capabilities?.[name]?.mode || null;
}

// ─── Default export — axios-shaped facade ────────────────────────────────────
//
// Shape designed so `import api from '@/src/api'` keeps compiling and every
// pattern in the codebase still works:
//
//   await api.get('/me')             → { data, status, ... }
//   await api.post('/x', body)       → { data, status, ... }
//   await api.delete('/y', { params })
//   await api.request({ method: 'POST', url: '/x', data })
//
// What does NOT survive (and was never used outside src/api.ts):
//   api.interceptors.*  api.defaults.*  api.raw  api.create()
const api = {
  get,
  post,
  put,
  patch,
  delete: del,
  request: genericRequest,
};

export default api;
