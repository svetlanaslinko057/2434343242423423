/**
 * Этап 6.2 — Unified API Client (Web).
 *
 * Single entry point for every UI → backend call. Replaces the ad-hoc
 * mix of `axios.get(${API}/...)` and `fetch(${BACKEND_URL}/api/...)` that
 * had grown to ~80 files. Goals:
 *
 *   1. ENV-based base URL — read once from REACT_APP_BACKEND_URL,
 *      fall back to same-origin (works on platform preview).
 *   2. AUTH — cookie-based (session_token). `withCredentials: true`
 *      is the default; callers never need to specify it.
 *   3. REQUEST IDs — every outgoing request gets a unique
 *      `X-Request-Id` header. Backend logs / errors quote this id back
 *      so we can trace any UI action across the stack.
 *   4. STANDARDIZED ERRORS — all errors thrown by this client are
 *      `ApiError` instances with `{ status, code, message, request_id,
 *      details, raw }`. UI never has to parse axios + fetch + native
 *      error shapes anymore.
 *   5. RETRIES — safe methods (GET, HEAD) get up to 2 retries with
 *      exponential backoff on transient failures (network errors, 502,
 *      503, 504). Mutating methods are NEVER retried — that's the
 *      contract.
 *   6. CAPABILITY AWARENESS — `getCapabilities()` reads
 *      `/api/integrations/capabilities` once per minute, cached. UI
 *      uses this to render honest states (mock/live/degraded/unavailable)
 *      without each page re-fetching.
 *
 * BACKWARD COMPAT: this module does NOT replace existing axios usage in
 * pages. It runs alongside. Pages can be migrated incrementally:
 *
 *   // Before:
 *   const r = await axios.get(`${API}/developer/wallet`, { withCredentials: true });
 *   setWallet(r.data);
 *
 *   // After:
 *   const wallet = await api.get('/developer/wallet');
 *
 * No business logic changes. No backend contract changes.
 */

import axios from 'axios';

// ─── ENV RESOLUTION ────────────────────────────────────────────────────────

/**
 * Compute the API base URL once at module load. Same-origin preview
 * deployments leave REACT_APP_BACKEND_URL empty and rely on the
 * platform ingress (which forwards `/api/*` to the backend pod). When
 * the env var IS set (production / split deploys) we use it directly.
 */
const RAW_BACKEND = process.env.REACT_APP_BACKEND_URL || '';
const BASE_URL = RAW_BACKEND ? `${RAW_BACKEND.replace(/\/$/, '')}/api` : '/api';

// ─── ERROR SHAPE ───────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor({ status, code, message, request_id, details, raw }) {
    super(message || code || 'Unknown API error');
    this.name = 'ApiError';
    this.status = status ?? 0;          // HTTP status (0 = network/abort)
    this.code = code || 'unknown';      // machine-readable string
    this.request_id = request_id || null;
    this.details = details || null;     // structured backend payload
    this.raw = raw;                     // original axios error / response
  }

  isAuth()      { return this.status === 401 || this.status === 403; }
  isNotFound()  { return this.status === 404; }
  isServer()    { return this.status >= 500; }
  isNetwork()   { return this.status === 0; }
}

function normalizeError(err) {
  if (err instanceof ApiError) return err;

  // axios error
  if (err && err.isAxiosError) {
    const status = err.response?.status ?? 0;
    const data = err.response?.data;
    const headers = err.response?.headers || {};
    const request_id =
      headers['x-request-id'] || err.config?.headers?.['X-Request-Id'] || null;

    let code = err.code || (status ? `http_${status}` : 'network_error');
    let message = err.message || 'Request failed';
    let details = null;

    if (data && typeof data === 'object') {
      code = data.code || code;
      message = data.detail || data.message || data.error || message;
      details = data;
    } else if (typeof data === 'string' && data.trim()) {
      message = data;
    }

    return new ApiError({ status, code, message, request_id, details, raw: err });
  }

  // unknown
  return new ApiError({
    status: 0,
    code: 'unknown',
    message: err?.message || String(err),
    raw: err,
  });
}

// ─── REQUEST ID ────────────────────────────────────────────────────────────

function genRequestId() {
  // RFC4122-ish, no extra deps. 8-4-12 hex.
  const r = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `req_${r()}_${Date.now().toString(16)}`;
}

// ─── RETRY POLICY ──────────────────────────────────────────────────────────

const SAFE_METHODS = new Set(['get', 'head']);
const RETRY_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [200, 500, 1500]; // up to 3 attempts total

function shouldRetry(method, err, attempt) {
  if (attempt >= RETRY_DELAYS_MS.length) return false;
  if (!SAFE_METHODS.has((method || '').toLowerCase())) return false;
  // Network failure → retry
  if (!err.response) return true;
  return RETRY_STATUSES.has(err.response.status);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── CORE AXIOS INSTANCE ───────────────────────────────────────────────────

const axiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,
  withCredentials: true, // cookie session_token is the canonical auth
});

// ─── PUBLIC API ────────────────────────────────────────────────────────────

/**
 * Generic request. Throws ApiError on failure. Returns data on success.
 *
 * @param {string} method  GET | POST | PUT | DELETE | PATCH | HEAD
 * @param {string} path    Path relative to /api (leading slash required).
 *                         e.g. '/developer/wallet'
 * @param {object} opts
 *   - data:    body for POST/PUT/PATCH
 *   - params:  query string params
 *   - headers: extra headers
 *   - signal:  AbortSignal
 *   - timeout: override default 20s
 *   - retry:   override default retry policy ({ enabled: bool })
 */
export async function request(method, path, opts = {}) {
  const m = (method || 'GET').toLowerCase();
  const url = path.startsWith('/') ? path : `/${path}`;
  const headers = {
    'X-Request-Id': genRequestId(),
    ...(opts.headers || {}),
  };

  const cfg = {
    method: m,
    url,
    data: opts.data,
    params: opts.params,
    headers,
    signal: opts.signal,
    timeout: opts.timeout,
  };

  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await axiosInstance.request(cfg);
      return res.data;
    } catch (err) {
      lastErr = err;
      const retryEnabled = opts.retry?.enabled !== false;
      if (retryEnabled && shouldRetry(m, err, attempt)) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        // Bump request id so retry has its own trace.
        cfg.headers['X-Request-Id'] = `${headers['X-Request-Id']}.r${attempt + 1}`;
        continue;
      }
      throw normalizeError(err);
    }
  }
  // Exhausted retries
  throw normalizeError(lastErr);
}

export const api = {
  get:    (path, opts)        => request('GET',    path, opts),
  post:   (path, data, opts)  => request('POST',   path, { ...(opts || {}), data }),
  put:    (path, data, opts)  => request('PUT',    path, { ...(opts || {}), data }),
  patch:  (path, data, opts)  => request('PATCH',  path, { ...(opts || {}), data }),
  delete: (path, opts)        => request('DELETE', path, opts),
  head:   (path, opts)        => request('HEAD',   path, opts),

  /** Underlying axios instance — for legacy callers that need the raw
   * response (status, headers). Avoid in new code. */
  raw: axiosInstance,
  baseURL: BASE_URL,
};

// ─── CAPABILITY AWARENESS ──────────────────────────────────────────────────

let _capCache = { value: null, expires_at: 0, in_flight: null };
const CAP_TTL_MS = 60_000;

/**
 * Returns the capability matrix from /api/integrations/capabilities.
 * Cached for 60 seconds. Safe to call frequently from many components.
 *
 * Shape (defined by backend integrations_api.py):
 *   {
 *     capabilities: {
 *       payment: { provider, mode: 'live'|'mock'|'degraded'|'unavailable',
 *                  available, reason },
 *       mail:    { ... },
 *       storage: { ... },
 *       oauth:   { ... },
 *       ai:      { ... },
 *     },
 *     summary: { total, live, mock, degraded, unavailable, all_live }
 *   }
 *
 * On error returns a degraded fallback so UI doesn't crash:
 *   { capabilities: {}, summary: { total: 0, live: 0, ... }, _error: ApiError }
 */
export async function getCapabilities({ force = false } = {}) {
  const now = Date.now();
  if (!force && _capCache.value && _capCache.expires_at > now) {
    return _capCache.value;
  }
  if (_capCache.in_flight) {
    return _capCache.in_flight;
  }
  const p = (async () => {
    try {
      const data = await request('GET', '/integrations/capabilities', {
        retry: { enabled: true },
      });
      _capCache = { value: data, expires_at: Date.now() + CAP_TTL_MS, in_flight: null };
      return data;
    } catch (err) {
      // Honest empty state — don't crash UI on capability fetch failure.
      const fallback = {
        capabilities: {},
        summary: { total: 0, live: 0, mock: 0, degraded: 0, unavailable: 0, all_live: false },
        _error: err,
      };
      _capCache = { value: fallback, expires_at: Date.now() + 5_000, in_flight: null };
      return fallback;
    }
  })();
  _capCache.in_flight = p;
  return p;
}

/** Force a refresh on next call (e.g. after admin changes integration keys). */
export function clearCapabilitiesCache() {
  _capCache = { value: null, expires_at: 0, in_flight: null };
}

/** Quick helper — `getCapabilityMode('payment')` → 'live'|'mock'|'degraded'|'unavailable'|null */
export async function getCapabilityMode(name) {
  const caps = await getCapabilities();
  return caps?.capabilities?.[name]?.mode || null;
}

export default api;
