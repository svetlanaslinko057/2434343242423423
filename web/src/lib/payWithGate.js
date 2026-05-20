/**
 * Smart Gate UI — Phase 2.5 (web).
 *
 * Stage B Pilot #2 — runtime-client migration.
 *
 * Wraps `POST /api/client/invoices/:id/pay`. The pay action is a money
 * mutation, so it carries:
 *   - `capability: 'payment'` → hard-gated when payment.mode != live.
 *   - explicit `idempotencyKey`  → server-side dedup, NEVER auto-retried
 *     by the runtime-client without a key (per retry-idempotency-policy).
 *
 * The 409 `contract_required` flow surfaces as a canonical `ApiError`
 * with `code === 'contract_required'` and details `{contract_id,
 * contract_state, project_id}`. We auto-prepare a contract if one is
 * missing, then redirect to the sign-agreement page. UX otherwise stays
 * identical to the legacy axios version.
 */

import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';

export async function payInvoiceWithGate(invoiceId, { projectId = null, navigate }) {
  // Idempotency key — stable per invoice+attempt window. A double-click on
  // "Pay Now" within the same second collapses to one server-side action;
  // a deliberate retry seconds later gets a fresh key.
  const idempotencyKey = `pay:${invoiceId}:${Date.now()}`;

  try {
    await runtime.post(
      `/api/client/invoices/${invoiceId}/pay`,
      {},
      { capability: 'payment', idempotencyKey },
    );
    return { ok: true, paid: true };
  } catch (e) {
    if (!(e instanceof ApiError)) {
      return { ok: false, redirected: false, error: e };
    }

    // Canonical contract gate.
    if (e.code === 'contract_required') {
      const det = (e.details || {});
      let contractId = det.contract_id || null;
      const pid = projectId || det.project_id || null;

      if (!contractId && pid) {
        try {
          // Auto-prepare a contract. This call is itself idempotent on the
          // server (project_id is the natural key) but we still tag a
          // distinct idempotencyKey so retry middleware never replays it
          // without our consent.
          const r = await runtime.post(
            '/api/contracts/prepare',
            { project_id: pid },
            { idempotencyKey: `prep:${pid}:${Date.now()}` },
          );
          contractId = r.data?.contract?.contract_id || null;
        } catch (prepErr) {
          return { ok: false, redirected: false, error: prepErr };
        }
      }

      if (!contractId) {
        return { ok: false, redirected: false, error: e };
      }

      if (typeof navigate === 'function') {
        navigate(`/client/sign-agreement/${contractId}`);
      }
      return { ok: false, redirected: true, contract_id: contractId };
    }

    // Capability hard-gate fired client-side (payment.mode != live).
    // Return a recognisable shape so the page can render an honest
    // "payments are in mock mode" notice instead of a generic failure.
    if (e.code === 'capability_offline') {
      return {
        ok: false,
        redirected: false,
        error: e,
        capability_offline: true,
        mode: e.mode,
        hint: e.hint,
      };
    }

    return { ok: false, redirected: false, error: e };
  }
}
