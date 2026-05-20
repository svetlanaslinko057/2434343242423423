/**
 * ApiError — canonical client-side error class.
 *
 * Mirrors the backend envelope (`{ok:false,code,message,...}`).
 * UI catches errors as instances of this class — never as raw axios/fetch errors.
 */
import { ErrorCode, ErrorCodeValue } from './codes';
import type { CapabilityName, CapabilityMode } from '../core/types';

export interface ApiErrorPayload {
  ok: false;
  code: string;
  message: string;
  status: number;
  retryable: boolean;
  request_id: string;
  capability?: CapabilityName;
  mode?: CapabilityMode;
  hint?: string;
  details?: unknown;
}

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly retryable: boolean;
  public readonly requestId: string;
  public readonly capability?: CapabilityName;
  public readonly mode?: CapabilityMode;
  public readonly hint?: string;
  public readonly details?: unknown;

  constructor(payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiError';
    this.code = payload.code;
    this.status = payload.status;
    this.retryable = payload.retryable;
    this.requestId = payload.request_id;
    this.capability = payload.capability;
    this.mode = payload.mode;
    this.hint = payload.hint;
    this.details = payload.details;
  }

  /** True when the error indicates the user's session is no longer valid. */
  get isAuthExpired(): boolean {
    return (
      this.code === ErrorCode.SESSION_EXPIRED ||
      this.code === ErrorCode.UNAUTHORIZED
    );
  }

  /** True when the error indicates a degraded/offline capability. */
  get isCapabilityIssue(): boolean {
    return (
      this.code === ErrorCode.CAPABILITY_OFFLINE ||
      this.code === ErrorCode.CAPABILITY_DEGRADED
    );
  }
}

/** Build an ApiError for client-side conditions that never reached the server. */
export function clientError(
  code: ErrorCodeValue,
  message: string,
  extras: Partial<ApiErrorPayload> = {},
): ApiError {
  return new ApiError({
    ok: false,
    code,
    message,
    status: 0,
    retryable: code === ErrorCode.NETWORK_ERROR || code === ErrorCode.TIMEOUT,
    request_id: '-',
    ...extras,
  });
}
