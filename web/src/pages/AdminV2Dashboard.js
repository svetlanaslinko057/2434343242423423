/**
 * Admin · Dashboard — web version of mobile home.
 *
 * Themed via design tokens (dark / light). Single overview screen.
 * Source: GET /api/admin/mobile/home  — all aggregates from backend.
 */
import { useEffect, useState, useCallback } from 'react';
import { API } from '@/App';
import { Link } from 'react-router-dom';
import axios from 'axios';
import {
  ShieldCheck, Wallet, Layers, Activity, Flame, XCircle, ArrowRight, RefreshCw,
} from 'lucide-react';
import { AppCard, CardHeader } from '@/components/ui/AppCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

export default function AdminV2Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const r = await axios.get(`${API}/admin/mobile/home`, { withCredentials: true });
      setData(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 max-w-7xl mx-auto" data-testid="admin-dashboard">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-h1">Dashboard</h1>
          <p className="text-small-token mt-1">System pulse · live operations</p>
        </div>
        <button
          onClick={load}
          className="btn-token-ghost flex items-center gap-2"
          data-testid="refresh-btn"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {err && (
        <AppCard className="mb-4" style={{ background: 'var(--token-danger-tint)', borderColor: 'var(--token-danger-border)' }}>
          <p style={{ color: 'var(--token-danger)' }}>{err}</p>
        </AppCard>
      )}

      {!data && !err && (
        <div data-testid="dashboard-skeleton">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Skeleton.Card />
            <Skeleton.Card />
            <Skeleton.Card />
          </div>
          <AppCard className="mb-6">
            <Skeleton className="h-3 w-20 mb-3" />
            <Skeleton className="h-5 w-48 mb-5" />
            <div className="grid grid-cols-3 gap-6">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </AppCard>
          <AppCard>
            <Skeleton.Text lines={2} />
          </AppCard>
        </div>
      )}

      {data && (
        <>
          {/* Alerts — money-actionable */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <AlertCard
              icon={<ShieldCheck className="w-5 h-5" />}
              label="QA pending"
              count={data.alerts.qa_pending}
              tone={data.alerts.qa_pending > 0 ? 'warning' : 'success'}
              to="/admin/qa"
              testid="alert-qa"
            />
            <AlertCard
              icon={<Wallet className="w-5 h-5" />}
              label="Withdrawals"
              count={data.alerts.withdrawals_pending}
              tone={data.alerts.withdrawals_pending > 0 ? 'warning' : 'success'}
              to="/admin/finance"
              testid="alert-withdrawals"
            />
            <AlertCard
              icon={<Layers className="w-5 h-5" />}
              label="Payout batches"
              count={data.alerts.payout_batches_pending}
              tone={data.alerts.payout_batches_pending > 0 ? 'warning' : 'success'}
              to="/admin/finance"
              testid="alert-batches"
            />
          </div>

          {/* Snapshot */}
          <AppCard className="mb-6" testId="snapshot">
            <CardHeader kicker="Snapshot" title="Current operations" />
            <div className="grid grid-cols-3 gap-6">
              <SnapshotItem label="Active developers" value={data.snapshot.active_devs} />
              <SnapshotItem label="Active modules" value={data.snapshot.active_modules} />
              <SnapshotItem
                label="QA pending"
                value={data.snapshot.qa_pending}
                tone={data.snapshot.qa_pending > 0 ? 'warning' : 'neutral'}
              />
            </div>
          </AppCard>

          {/* Quick actions */}
          {data.quick_actions.length > 0 && (
            <div className="mb-6">
              <h2 className="text-token-kicker mb-3">Quick actions</h2>
              <div className="space-y-2">
                {data.quick_actions.map((a) => (
                  <Link
                    key={a.key}
                    to={a.route}
                    data-testid={`quick-${a.key}`}
                    className="btn-token-primary flex items-center gap-3 px-5 py-4 rounded-xl"
                    style={{ textDecoration: 'none' }}
                  >
                    <span className="font-bold flex-1">{a.label}</span>
                    {a.count > 0 && (
                      <span
                        className="px-3 py-1 rounded-full text-sm font-bold"
                        style={{ background: 'rgba(0,0,0,0.18)', color: 'var(--token-primary-ink)' }}
                      >
                        {a.count}
                      </span>
                    )}
                    <ArrowRight className="w-5 h-5" />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {data.quick_actions.length === 0 && (
            <AppCard className="mb-6 text-center" testId="all-clear">
              <ShieldCheck className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--token-success)' }} />
              <p className="text-h3">All clear</p>
              <p className="text-small-token mt-1">Nothing pending right now.</p>
            </AppCard>
          )}

          {/* Advanced */}
          <AppCard testId="advanced">
            <CardHeader kicker="Advanced signals" title="System health" />
            <div className="grid grid-cols-2 gap-4">
              <AdvancedItem
                icon={<Flame className="w-4 h-4" style={{ color: 'var(--token-warning)' }} />}
                label="Overloaded devs"
                value={data.advanced.overloaded_devs}
              />
              <AdvancedItem
                icon={<XCircle className="w-4 h-4" style={{ color: 'var(--token-danger)' }} />}
                label="Blocked modules"
                value={data.advanced.blocked_modules}
              />
            </div>
            <Link
              to="/admin/workflow"
              className="flex items-center justify-center gap-2 mt-4 text-sm font-medium"
              style={{ color: 'var(--token-primary)' }}
            >
              <Activity className="w-4 h-4" />
              Open Workflow
            </Link>
          </AppCard>
        </>
      )}
    </div>
  );
}

function AlertCard({ icon, label, count, tone, to, testid }) {
  // Tone is purely visual: success = clean, warning = attention. No semantic ambiguity.
  const tintVar = tone === 'warning' ? 'var(--token-warning-tint)' : 'var(--token-success-tint)';
  const borderVar = tone === 'warning' ? 'var(--token-warning-border)' : 'var(--token-success-border)';
  const textVar = tone === 'warning' ? 'var(--token-warning)' : 'var(--token-success)';
  return (
    <Link
      to={to}
      data-testid={testid}
      className="app-card app-card-interactive p-5 block"
      style={{
        background: tintVar,
        borderColor: borderVar,
        textDecoration: 'none',
      }}
    >
      <div style={{ color: textVar }}>{icon}</div>
      <p className="text-4xl font-bold mt-3" style={{ color: textVar }}>{count}</p>
      <div className="flex items-center justify-between mt-1">
        <p className="text-small-token">{label}</p>
        <StatusBadge tone={tone}>{count > 0 ? 'pending' : 'clear'}</StatusBadge>
      </div>
    </Link>
  );
}

function SnapshotItem({ label, value, tone = 'neutral' }) {
  const colour = tone === 'warning' ? 'var(--token-warning)' : 'var(--token-text-primary)';
  return (
    <div className="text-center">
      <p className="text-3xl font-bold" style={{ color: colour }}>{value}</p>
      <p className="text-small-token mt-1">{label}</p>
    </div>
  );
}

function AdvancedItem({ icon, label, value }) {
  return (
    <div className="flex items-center gap-3">
      {icon}
      <span className="text-small-token flex-1">{label}</span>
      <span className="font-bold text-token-primary">{value}</span>
    </div>
  );
}
