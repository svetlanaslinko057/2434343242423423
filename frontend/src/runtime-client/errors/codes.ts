/**
 * Stable error codes — single source of truth shared with backend.
 *
 * Backend defines these in `backend/middleware/error_shape.py::ErrorCode`.
 * UI dispatches off `code`, NEVER off `message`.
 */
export const ErrorCode = {
  // Auth
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  SESSION_EXPIRED: 'session_expired',
  // Validation
  INVALID_INPUT: 'invalid_input',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  // Business
  CONTRACT_REQUIRED: 'contract_required',
  PAYMENT_FAILED: 'payment_failed',
  INSUFFICIENT_FUNDS: 'insufficient_funds',
  ESCROW_LOCKED: 'escrow_locked',
  // Runtime
  CAPABILITY_OFFLINE: 'capability_offline',
  CAPABILITY_DEGRADED: 'capability_degraded',
  RATE_LIMITED: 'rate_limited',
  // Internal
  INTERNAL_ERROR: 'internal_error',
  UPSTREAM_ERROR: 'upstream_error',
  // Client-side only
  NETWORK_ERROR: 'network_error',
  TIMEOUT: 'timeout',
  ABORTED: 'aborted',
} as const;

export type ErrorCodeValue = typeof ErrorCode[keyof typeof ErrorCode];
