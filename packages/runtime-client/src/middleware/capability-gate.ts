/**
 * Capability gate middleware — enforces hard/soft policy from the manifest.
 *
 * Policy comes from `/api/integrations/manifest`:
 *   - hard (payment, oauth): if mode != 'live' AND request is tagged with
 *     this capability → throw CAPABILITY_OFFLINE BEFORE the request leaves.
 *     UI catches this and renders an explainer + admin CTA.
 *   - soft (ai, storage, mail): always pass through; UI shows a badge based
 *     on the mode reported in the response or the cached manifest.
 *
 * If `request.capability` is undefined → gate doesn't apply.
 */
import type { Middleware, CapabilityName } from '../core/types';
import { capabilityStore } from '../capabilities/store';
import { ApiError } from '../errors/ApiError';
import { ErrorCode } from '../errors/codes';

export const capabilityGateMiddleware: Middleware = async (ctx, next) => {
  const cap = ctx.config.capability as CapabilityName | undefined;
  if (!cap) return next();

  const state = capabilityStore.peek(cap);
  if (!state) return next(); // Manifest not loaded yet → fail open.

  if (state.policy === 'hard' && state.mode !== 'live') {
    throw new ApiError({
      ok: false,
      code: ErrorCode.CAPABILITY_OFFLINE,
      message: `Capability "${cap}" is not live (mode: ${state.mode}). This action requires a live integration.`,
      status: 503,
      retryable: false,
      request_id: '-',
      capability: cap,
      mode: state.mode,
      hint: state.reason || 'Ask an admin to enable the integration.',
    });
  }
  return next();
};
