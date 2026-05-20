/**
 * Admin · Finance — single point for money control.
 *
 * Tabs: Summary · Withdrawals · Earnings
 * Source: GET /api/admin/mobile/finance
 *
 * Action semantics (do NOT change):
 *   withdrawal/approve         = allow into next batch (NO money movement)
 *   withdrawal/reject          = denied, funds stay in dev wallet
 *   payout-batches/approve     = REAL money dispatch (danger)
 *
 * Confirm dialogs cover money-moving / destructive actions.
 * Successes / failures land in toast (no alert/confirm anywhere).
 */
import { useEffect, useState, useCallback } from 'react';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import { DollarSign, Wallet, AlertTriangle, RefreshCw, TrendingUp, Layers, GitBranch, Activity } from 'lucide-react';
import AdminEarningsControl from './AdminEarningsControl';
import AdminWithdrawalsPage from './AdminWithdrawalsPage';
import AdminPricingConfigPanel from './AdminPricingConfigPanel';
import AdminProjectReprice from './AdminProjectReprice';
import AdminPricingCalibration from './AdminPricingCalibration';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/Toast';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

export default function AdminV2Finance() {
  const [tab, setTab] = useState('summary');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);

  // Confirm dialog state
  const [pending, setPending] = useState(null); // { url, payload, kind, title, description, confirmLabel, variant, onSuccess }
  const { toast } = useToast();

  // ─── Step 6.2 Stage 2 — runtime-client migration ─────────────────────────
  // Finance reads are NOT tagged with `capability: 'payment'` so they pass
  // through capability-gate even when payment.mode === 'mock'. Only the
  // money-MOVING action (payout-batches/approve) is tagged — that's the
  // hard-gate boundary.
  const load = useCallback(async () => {
    try {
      setErr(null);
      const { data } = await runtime.get('/api/admin/mobile/finance');
      setSummary(data);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to load finance data';
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Action runner — `capability` is plumbed in from `pending` so payout-batch
  // approve gets hard-gated when payment is not live, but withdrawal
  // approve/reject (no money movement) stays soft.
  const doAction = useCallback(async (url, successMsg, capability) => {
    setBusy(url);
    try {
      // Idempotency key keeps server-side action exactly-once even if user
      // double-clicks — runtime-client sends `idempotency-key` header.
      const idempotencyKey = `${url}:${Date.now()}`;
      await runtime.post(url, {}, { capability, idempotencyKey });
      if (successMsg) toast.success(successMsg.title || 'Done', { description: successMsg.description });
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'capability_offline') {
          toast.error('Payment integration not live', {
            description: e.hint || 'Ask an admin to configure Stripe before dispatching real payouts.',
          });
        } else if (e.status === 409) {
          toast.warning('Already processed', { description: e.message });
          load();
        } else if (e.code === 'unauthorized' || e.code === 'forbidden') {
          toast.error('Not authorized', { description: e.message });
        } else {
          toast.error('Action failed', {
            description: `${e.message} (req: ${e.requestId})`,
          });
        }
      } else {
        toast.error('Action failed', { description: 'Network error. Please retry.' });
      }
    } finally {
      setBusy(null);
    }
  }, [toast, load]);

  // Run pending action (called from ConfirmDialog primary)
  const runPending = useCallback(async () => {
    if (!pending) return;
    const { url, successMsg, capability } = pending;
    setPending(null);
    await doAction(url, successMsg, capability);
  }, [pending, doAction]);

  // Action triggers — open ConfirmDialog with proper copy
  const askApproveBatch = (b) => {
    const total = Math.round(b.meta?.amount_total || 0).toLocaleString();
    const devs = b.meta?.developer_count ?? '?';
    setPending({
      url: `/api/admin/mobile/payout-batches/${b.id}/approve`,
      // ⚠ HARD GATE: actual money dispatch — blocked when payment.mode != 'live'.
      capability: 'payment',
      title: 'Approve payout batch?',
      description: `This will dispatch real payouts to ${devs} developers ($${total} total).`,
      confirmLabel: 'Approve & dispatch',
      variant: 'danger',
      successMsg: { title: 'Batch approved', description: `Payouts dispatched to ${devs} developers` },
    });
  };

  const askApproveWithdrawal = (w) => {
    setPending({
      url: `/api/admin/mobile/withdrawals/${w.id}/approve`,
      // No money movement — soft, no capability tag.
      title: 'Approve withdrawal?',
      description: 'This will allow the withdrawal to be included in the next payout batch. No funds are moved yet.',
      confirmLabel: 'Approve',
      variant: 'default',
      successMsg: { title: 'Withdrawal approved', description: 'Allowed into next batch.' },
    });
  };

  const askRejectWithdrawal = (w) => {
    setPending({
      url: `/api/admin/mobile/withdrawals/${w.id}/reject`,
      title: 'Reject withdrawal?',
      description: 'Withdrawal will be denied. Funds remain in the developer wallet.',
      confirmLabel: 'Reject',
      variant: 'danger',
      successMsg: { title: 'Withdrawal rejected', description: 'Funds returned to developer wallet.' },
    });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto" data-testid="admin-finance">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-h1">Finance</h1>
          <p className="text-small-token mt-1">Earnings · withdrawals · payout batches</p>
        </div>
        <button onClick={load} className="btn-token-ghost flex items-center gap-2">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Summary band — always visible */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <SummaryCard icon={<Wallet className="w-5 h-5" />} label="Withdrawals pending" value={summary.summary.withdrawals_pending} tone="amber" />
          <SummaryCard icon={<DollarSign className="w-5 h-5" />} label="Batches pending" value={summary.summary.batches_pending} tone="amber" />
          <SummaryCard icon={<DollarSign className="w-5 h-5" />} label="Total pending" value={`$${Math.round(summary.summary.total_pending_amount).toLocaleString()}`} tone="emerald" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 mb-6 w-fit rounded-lg" data-testid="finance-tabs"
           style={{ background: 'var(--token-surface)', border: '1px solid var(--token-border)' }}>
        {[
          { k: 'summary', l: 'Summary', icon: <DollarSign className="w-4 h-4" /> },
          { k: 'withdrawals', l: 'Withdrawals', icon: <Wallet className="w-4 h-4" /> },
          { k: 'earnings', l: 'Earnings', icon: <TrendingUp className="w-4 h-4" /> },
          { k: 'pricing', l: 'Pricing', icon: <Layers className="w-4 h-4" /> },
          { k: 'reprice', l: 'Re-price', icon: <GitBranch className="w-4 h-4" /> },
          { k: 'calibration', l: 'Calibration', icon: <Activity className="w-4 h-4" /> },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            data-testid={`tab-${t.k}`}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded transition-colors font-medium"
            style={tab === t.k
              ? { background: 'var(--token-primary)', color: 'var(--token-primary-ink)' }
              : { background: 'transparent', color: 'var(--token-text-secondary)' }}
          >
            {t.icon}
            {t.l}
          </button>
        ))}
      </div>

      {err && (
        <div className="app-card p-4 mb-4 flex gap-3"
             style={{ background: 'var(--token-danger-tint)', borderColor: 'var(--token-danger-border)' }}>
          <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--token-danger)' }} />
          <p className="text-sm" style={{ color: 'var(--token-danger)' }}>{err}</p>
        </div>
      )}

      {/* Summary tab */}
      {tab === 'summary' && summary && (
        <div className="space-y-6" data-testid="finance-summary">
          {summary.withdrawals.length === 0 && summary.payout_batches.length === 0 && (
            <EmptyState
              icon={<DollarSign className="w-6 h-6" />}
              title="No pending finance actions"
              description="Withdrawals and payout batches are clear."
              tone="success"
            />
          )}

          {summary.withdrawals.length > 0 && (
            <section>
              <h2 className="text-token-kicker mb-3">
                Withdrawals · approve = allowed into next batch, no funds move
              </h2>
              <div className="space-y-2">
                {summary.withdrawals.map((w) => (
                  <div key={w.id} className="app-card p-4 flex items-center gap-4" data-testid={`wd-${w.id}`}>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-token-primary">{w.title}</p>
                      <p className="text-small-token capitalize mt-1">{w.subtitle}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => askApproveWithdrawal(w)}
                        disabled={busy !== null}
                        data-testid={`wd-approve-${w.id}`}
                        className="btn-token-primary text-xs"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => askRejectWithdrawal(w)}
                        disabled={busy !== null}
                        data-testid={`wd-reject-${w.id}`}
                        className="px-3 py-1.5 text-xs font-bold rounded border disabled:opacity-50"
                        style={{
                          background: 'var(--token-danger-tint)',
                          color: 'var(--token-danger)',
                          borderColor: 'var(--token-danger-border)',
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {summary.payout_batches.length > 0 && (
            <section>
              <h2 className="text-token-kicker flex items-center gap-2 mb-3" style={{ color: 'var(--token-danger)' }}>
                <AlertTriangle className="w-4 h-4" />
                Payout batches · approving dispatches REAL money
              </h2>
              <div className="space-y-2">
                {summary.payout_batches.map((b) => (
                  <div key={b.id} className="app-card p-4" style={{ borderColor: 'var(--token-danger-border)' }} data-testid={`batch-${b.id}`}>
                    <div className="flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-token-primary">{b.title}</p>
                        <p className="text-small-token capitalize mt-1">{b.subtitle}</p>
                        <p className="text-2xl font-bold mt-2" style={{ color: 'var(--token-success)' }}>
                          ${Math.round(b.meta?.amount_total || 0).toLocaleString()}
                        </p>
                      </div>
                      <button
                        onClick={() => askApproveBatch(b)}
                        disabled={busy !== null}
                        data-testid={`batch-approve-${b.id}`}
                        className="px-5 py-2 font-bold rounded disabled:opacity-50 text-white"
                        style={{ background: 'var(--token-danger)' }}
                      >
                        Approve & dispatch
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Embedded existing pages as deeper tabs */}
      {tab === 'withdrawals' && (
        <div data-testid="finance-withdrawals-embed">
          <AdminWithdrawalsPage />
        </div>
      )}
      {tab === 'earnings' && (
        <div data-testid="finance-earnings-embed">
          <AdminEarningsControl />
        </div>
      )}
      {tab === 'pricing' && (
        <div data-testid="finance-pricing-embed">
          <AdminPricingConfigPanel />
        </div>
      )}
      {tab === 'reprice' && (
        <div data-testid="finance-reprice-embed">
          <AdminProjectReprice />
        </div>
      )}
      {tab === 'calibration' && (
        <div data-testid="finance-calibration-embed">
          <AdminPricingCalibration onJumpToPricingConfig={() => setTab('pricing')} />
        </div>
      )}

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(v) => { if (!v) setPending(null); }}
        title={pending?.title || ''}
        description={pending?.description || ''}
        confirmLabel={pending?.confirmLabel || 'Confirm'}
        variant={pending?.variant || 'default'}
        onConfirm={runPending}
      />
    </div>
  );
}

function SummaryCard({ icon, label, value, tone }) {
  const toneMap = {
    amber: {
      tint: 'var(--token-warning-tint)',
      border: 'var(--token-warning-border)',
      text: 'var(--token-warning)',
    },
    emerald: {
      tint: 'var(--token-success-tint)',
      border: 'var(--token-success-border)',
      text: 'var(--token-success)',
    },
  };
  const c = toneMap[tone] || toneMap.emerald;
  return (
    <div
      className="app-card p-4"
      style={{ background: c.tint, borderColor: c.border, color: c.text }}
    >
      <div>{icon}</div>
      <p className="text-3xl font-bold mt-2" style={{ color: c.text }}>{value}</p>
      <p className="text-small-token mt-1">{label}</p>
    </div>
  );
}
