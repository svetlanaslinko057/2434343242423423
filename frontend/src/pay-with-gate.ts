/**
 * Smart Gate UI — Phase 2.5.
 *
 * Wraps `POST /api/client/invoices/:id/pay` so that a 409 with
 * `detail.code === 'contract_required'` is converted from "error toast" into
 * "soft redirect into the signing flow".
 *
 * Behavior:
 *   - 200/201 → returns { ok: true, paid: true }
 *   - 409 contract_required:
 *       a) if backend returned a contract_id → router.push(`/contract/${id}/sign`)
 *       b) otherwise we POST /contracts/prepare with project_id (when known)
 *          and redirect to the freshly created contract.
 *   - other errors → re-thrown so callers can show their existing toast.
 *
 * The whole point is that no call site has to know about the contract
 * gate — it's automatic.
 */

import api from './api';

export type PayWithGateResult =
  | { ok: true; paid: true }
  | { ok: false; redirected: true; contract_id: string }
  | { ok: false; redirected: false; error: any };

export async function payInvoiceWithGate(
  invoiceId: string,
  opts: {
    projectId?: string | null;
    router: { push: (href: any) => void };
  },
): Promise<PayWithGateResult> {
  try {
    await api.post(`/client/invoices/${invoiceId}/pay`);
    return { ok: true, paid: true };
  } catch (e: any) {
    const detail = e?.response?.data?.detail;
    const isGate =
      e?.response?.status === 409 &&
      detail &&
      typeof detail === 'object' &&
      detail.code === 'contract_required';

    if (!isGate) {
      return { ok: false, redirected: false, error: e };
    }

    let contractId: string | null = detail?.contract_id || null;
    const projectId: string | null =
      opts.projectId || detail?.project_id || null;

    if (!contractId && projectId) {
      try {
        const r = await api.post('/contracts/prepare', { project_id: projectId });
        contractId = r.data?.contract?.contract_id || null;
      } catch (prepErr) {
        return { ok: false, redirected: false, error: prepErr };
      }
    }

    if (!contractId) {
      return { ok: false, redirected: false, error: e };
    }

    opts.router.push(`/contract/${contractId}/sign` as any);
    return { ok: false, redirected: true, contract_id: contractId };
  }
}
