/**
 * Core transport — single fetch call. Pure TS, no React, no platform APIs.
 *
 * Responsibilities:
 *  - Build URL from baseURL + path + query
 *  - Apply adapter decoration (auth, credentials)
 *  - Compose AbortSignal (timeout + caller-provided)
 *  - Parse response into either ApiResponse or ApiError
 *  - Surface compat-route metadata via headers
 *
 * Does NOT do: retries, dedup, capability gating, request-id generation.
 * Those are middleware concerns wrapping `transport()`.
 */
import type {
  RequestConfig,
  ApiResponse,
  PlatformAdapter,
  RuntimeClientConfig,
} from './types';
import { ApiError, clientError, ApiErrorPayload } from '../errors/ApiError';
import { ErrorCode } from '../errors/codes';

const DEFAULT_TIMEOUT_MS = 15_000;

function buildUrl(baseURL: string, path: string, params?: Record<string, unknown>): string {
  const base = baseURL.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${p}`;
  if (!params || Object.keys(params).length === 0) return url;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    search.append(k, String(v));
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

function composeSignal(timeoutMs: number, caller?: AbortSignal): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);
  if (caller) {
    if (caller.aborted) ctrl.abort(caller.reason);
    else caller.addEventListener('abort', () => ctrl.abort(caller.reason), { once: true });
  }
  return {
    signal: ctrl.signal,
    cancel: () => clearTimeout(timer),
  };
}

export async function transport(
  config: RequestConfig,
  runtimeConfig: RuntimeClientConfig,
  adapter: PlatformAdapter,
): Promise<ApiResponse> {
  const method = (config.method || 'GET').toUpperCase() as RequestConfig['method'];
  const url = buildUrl(runtimeConfig.baseURL, config.url, config.params);
  const timeoutMs = config.timeoutMs ?? runtimeConfig.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { signal, cancel } = composeSignal(timeoutMs, config.signal);

  const headers: Record<string, string> = {
    'accept': 'application/json',
    ...(config.headers || {}),
  };
  let bodyInit: BodyInit | undefined;
  if (config.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    // Pass FormData / Blob / ArrayBuffer / URLSearchParams as-is (fetch handles
    // content-type correctly). Only stringify plain objects.
    const b = config.body as unknown;
    const isBinary =
      (typeof FormData !== 'undefined' && b instanceof FormData) ||
      (typeof Blob !== 'undefined' && b instanceof Blob) ||
      (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) ||
      (typeof ArrayBuffer !== 'undefined' && b instanceof ArrayBuffer);
    if (isBinary) {
      bodyInit = b as BodyInit;
      // Let fetch set multipart/form-data boundary etc — don't override.
    } else {
      headers['content-type'] = 'application/json';
      bodyInit = JSON.stringify(b);
    }
  }
  if (config.idempotencyKey && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
    headers['idempotency-key'] = config.idempotencyKey;
  }

  let init: RequestInit = {
    method,
    headers,
    body: bodyInit,
    signal,
  };
  init = adapter.decorateInit(init, config);

  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch (err: unknown) {
    cancel();
    if ((err as { name?: string })?.name === 'AbortError' || (err as { name?: string })?.name === 'TimeoutError') {
      throw clientError(
        config.signal?.aborted ? ErrorCode.ABORTED : ErrorCode.TIMEOUT,
        config.signal?.aborted ? 'Request was cancelled' : `Request timed out after ${timeoutMs}ms`,
      );
    }
    throw clientError(ErrorCode.NETWORK_ERROR, (err as Error)?.message || 'Network error');
  } finally {
    cancel();
  }

  const requestId = resp.headers.get('x-request-id') || '-';
  const compatRoute = resp.headers.get('x-compat-route') === 'true';
  const canonicalPath = resp.headers.get('x-canonical-path') || undefined;

  // 204 No Content
  if (resp.status === 204) {
    return { data: null as unknown, status: 204, requestId, fromCompatRoute: compatRoute, canonicalPath };
  }

  let parsed: unknown;
  const text = await resp.text();
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text.slice(0, 1000) };
  }

  if (!resp.ok) {
    // Backend canonical error shape
    const p = parsed as Partial<ApiErrorPayload>;
    if (p && typeof p === 'object' && p.ok === false && typeof p.code === 'string') {
      throw new ApiError({
        ok: false,
        code: p.code,
        message: p.message || resp.statusText,
        status: p.status ?? resp.status,
        retryable: !!p.retryable,
        request_id: p.request_id || requestId,
        capability: p.capability,
        mode: p.mode,
        hint: p.hint,
        details: p.details,
      });
    }
    // Legacy shape ({"detail":"..."}) — synthesise
    const msg = (parsed as { detail?: string })?.detail || resp.statusText || 'Request failed';
    throw new ApiError({
      ok: false,
      code: resp.status === 401 ? ErrorCode.UNAUTHORIZED :
            resp.status === 403 ? ErrorCode.FORBIDDEN :
            resp.status === 404 ? ErrorCode.NOT_FOUND :
            resp.status === 409 ? ErrorCode.CONFLICT :
            resp.status === 429 ? ErrorCode.RATE_LIMITED :
            resp.status >= 500 ? ErrorCode.UPSTREAM_ERROR :
            ErrorCode.INVALID_INPUT,
      message: msg,
      status: resp.status,
      retryable: resp.status === 429 || resp.status >= 500,
      request_id: requestId,
    });
  }

  return {
    data: parsed,
    status: resp.status,
    requestId,
    fromCompatRoute: compatRoute,
    canonicalPath,
  };
}
