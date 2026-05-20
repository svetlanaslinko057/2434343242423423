/**
 * Client · Transparency Hub
 *
 * The single page a client opens when they want to know:
 *   "Is my project healthy? What's happening? Why?"
 *
 * Strict design rules (the inverse of the admin / dev cabinets):
 *   ✗ NO tasks / internal statuses
 *   ✗ NO developer ratings / decay / balancer mechanics
 *   ✗ NO raw severity scores or AI confidence percentages
 *
 *   ✓ Health (one badge, plain words)
 *   ✓ Progress (completed / total + percent bar)
 *   ✓ Team (how many people are working — for trust)
 *   ✓ Activity (last few human-readable events)
 *   ✓ Why-explanation (one sentence the client can quote)
 *
 * Data: GET /api/client/transparency  — single aggregator across all projects.
 */
import { useEffect, useState, useCallback } from 'react';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import { API } from '@/App';
import {
  RefreshCw, ShieldCheck, AlertTriangle, ShieldAlert,
  CheckCircle2, RotateCw, Sparkles, Clock, Inbox,
  Users, TrendingUp, ArrowRight, Zap,
} from 'lucide-react';
import { AppCard, CardHeader } from '@/components/ui/AppCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/Toast';

const HEALTH_LABEL = {
  stable:  { tone: 'success', label: 'Stable',           icon: <ShieldCheck className="w-5 h-5" /> },
  warning: { tone: 'warning', label: 'Attention needed', icon: <AlertTriangle className="w-5 h-5" /> },
  risk:    { tone: 'danger',  label: 'At risk',          icon: <ShieldAlert className="w-5 h-5" /> },
};

// Activity icon → tone + glyph. Every icon name comes from the backend.
const ACTIVITY_ICON = {
  completed: { tone: 'success', glyph: <CheckCircle2 className="w-4 h-4" /> },
  approved:  { tone: 'success', glyph: <CheckCircle2 className="w-4 h-4" /> },
  started:   { tone: 'info',    glyph: <Sparkles      className="w-4 h-4" /> },
  review:    { tone: 'warning', glyph: <RotateCw      className="w-4 h-4" /> },
  adjusted:  { tone: 'info',    glyph: <RotateCw      className="w-4 h-4" /> },
  info:      { tone: 'neutral', glyph: <Clock         className="w-4 h-4" /> },
};

const fmtAgo = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const diffMin = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
    if (diffMin < 1)    return 'just now';
    if (diffMin < 60)   return `${diffMin}m ago`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
    return `${Math.floor(diffMin / 1440)}d ago`;
  } catch { return ''; }
};

export default function ClientTransparency() {
  const [data, setData]     = useState(null);
  const [billing, setBill]  = useState(null);
  const [loading, setLoad]  = useState(true);
  const [err, setErr]       = useState(null);
  const [pendingPay, setPendingPay] = useState(false);
  const [busy, setBusy]     = useState(false);
  const { push }            = useToast();

  const load = useCallback(async () => {
    try {
      setErr(null);
      const [transp, bill] = await Promise.all([
        runtime.get(`/api/client/transparency`),
        runtime.get(`/api/client/billing/summary`),
      ]);
      setData(transp.data);
      setBill(bill.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Could not load transparency snapshot.');
    } finally {
      setLoad(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onContinue = async () => {
    setBusy(true);
    try {
      const r = await runtime.post(`/api/client/billing/continue`, {});
      if (r.data?.mode === 'redirect' && r.data?.payment_url) {
        // Hand off to the payment provider's hosted page.
        window.location.href = r.data.payment_url;
        return;
      }
      // MOCK fallback (DEV) — invoice marked paid server-side.
      push({ tone: 'success', text: 'Payment received. Team continues work.' });
      await load();
    } catch (e) {
      push({ tone: 'error', text: e?.response?.data?.detail || 'Could not continue right now.' });
    } finally {
      setBusy(false);
      setPendingPay(false);
    }
  };

  const onAutoChargeToggle = async () => {
    if (!billing) return;
    const next = !billing.auto_charge;
    setBill({ ...billing, auto_charge: next });
    try {
      await runtime.post(`/api/client/billing/auto-charge`, { enabled: next });
      push({ tone: 'success', text: next ? 'Auto-continue enabled.' : 'Auto-continue paused.' });
    } catch (e) {
      setBill({ ...billing, auto_charge: !next }); // revert on error
      push({ tone: 'error', text: 'Could not update preference.' });
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto" data-testid="client-transparency">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-h1">Project pulse</h1>
          <p className="text-small-token mt-1">Live, plain-English status of your work.</p>
        </div>
        <button
          onClick={load}
          className="btn-token-ghost flex items-center gap-2"
          data-testid="transparency-refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {err && (
        <div
          className="app-card p-4 mb-4 flex gap-3"
          style={{ background: 'var(--token-danger-tint)', borderColor: 'var(--token-danger-border)' }}
          data-testid="transparency-error"
        >
          <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--token-danger)' }} />
          <p className="text-sm" style={{ color: 'var(--token-danger)' }}>{err}</p>
        </div>
      )}

      {loading && !data && (
        <div className="space-y-4" data-testid="transparency-skeleton">
          <Skeleton.Card />
          <Skeleton.Card />
          <AppCard>
            <Skeleton className="h-3 w-20 mb-3" />
            <Skeleton.Text lines={3} />
          </AppCard>
        </div>
      )}

      {data && data.projects_count === 0 && (
        <EmptyState
          icon={<Inbox className="w-7 h-7" />}
          title="No active projects yet"
          description="Once a project starts, this page will show live progress, team activity, and clear explanations."
          tone="neutral"
        />
      )}

      {data && data.projects_count > 0 && (
        <div className="space-y-6">
          <HealthCard
            health={data.health}
            message={data.status_message}
            billing={billing}
            busy={busy}
            onContinueClick={() => setPendingPay(true)}
            onAutoChargeToggle={onAutoChargeToggle}
          />
          <ProgressCard progress={data.progress} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TeamCard team={data.team} />
            <PortfolioCard count={data.projects_count} progress={data.progress} />
          </div>
          <ActivityCard activity={data.activity} />
        </div>
      )}

      {/* Confirm — wording is product-flow, not finance. */}
      <ConfirmDialog
        open={pendingPay}
        onOpenChange={(v) => { if (!v) setPendingPay(false); }}
        title="Continue to next milestone?"
        description={
          billing?.next_payment
            ? `${billing.next_payment.reason}. This unlocks the next stage of development.`
            : 'This will unlock the next stage of development.'
        }
        confirmLabel={
          billing?.next_payment
            ? `Continue · $${Math.round(billing.next_payment.amount)}`
            : 'Continue'
        }
        onConfirm={onContinue}
      />
    </div>
  );
}

/* ---------- HEALTH ---------------------------------------------------------- */
function HealthCard({ health, message, billing, busy, onContinueClick, onAutoChargeToggle }) {
  const cfg = HEALTH_LABEL[health] || HEALTH_LABEL.stable;
  const tintMap = {
    success: 'var(--token-success-tint)',
    warning: 'var(--token-warning-tint)',
    danger:  'var(--token-danger-tint)',
  };
  const borderMap = {
    success: 'var(--token-success-border)',
    warning: 'var(--token-warning-border)',
    danger:  'var(--token-danger-border)',
  };
  const colourMap = {
    success: 'var(--token-success)',
    warning: 'var(--token-warning)',
    danger:  'var(--token-danger)',
  };

  // Product-first CTA: only when system is calm AND there's a real next step.
  const next = billing?.next_payment;
  const canContinue = health === 'stable' && next && next.ready;
  const showAutoCharge = !!next; // toggle is meaningful only if there's something to continue

  return (
    <div
      className="app-card p-6"
      data-testid="health-card"
      style={{
        background: tintMap[cfg.tone],
        borderColor: borderMap[cfg.tone],
      }}
    >
      <div className="flex items-start gap-4">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
          style={{
            background: 'var(--token-surface)',
            border: `1px solid ${borderMap[cfg.tone]}`,
            color: colourMap[cfg.tone],
          }}
        >
          {cfg.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-token-kicker">Project health</span>
            <StatusBadge tone={cfg.tone}>{cfg.label}</StatusBadge>
          </div>
          <p className="text-h3 mt-2" style={{ color: colourMap[cfg.tone] }}>
            {message}
          </p>

          {/* Continue CTA — only when stable + next milestone is ready */}
          {canContinue && (
            <div className="mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <button
                onClick={onContinueClick}
                disabled={busy}
                data-testid="continue-milestone-btn"
                className="btn-token-primary flex items-center gap-2 disabled:opacity-60"
              >
                <span>
                  Continue to next milestone <span className="opacity-90 mx-1">·</span> ${Math.round(next.amount)}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
              {showAutoCharge && (
                <label
                  className="flex items-center gap-2 cursor-pointer text-small-token select-none"
                  data-testid="auto-charge-toggle-wrap"
                >
                  <input
                    type="checkbox"
                    checked={!!billing?.auto_charge}
                    onChange={onAutoChargeToggle}
                    data-testid="auto-charge-toggle"
                    className="w-4 h-4"
                    style={{ accentColor: 'var(--token-primary)' }}
                  />
                  <Zap className="w-3 h-3" style={{ color: 'var(--token-primary)' }} />
                  Auto-continue milestones
                </label>
              )}
            </div>
          )}

          {/* When health is NOT stable but there IS a milestone — explain, don't ask. */}
          {!canContinue && next && (
            <p className="text-small-token mt-3" data-testid="hold-milestone-msg">
              The next milestone (<span className="font-medium">{next.reason}</span>) will be ready to continue once the team clears the current items.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- PROGRESS -------------------------------------------------------- */
function ProgressCard({ progress }) {
  const { completed = 0, total = 0, percent = 0, in_review = 0, blocked = 0 } = progress || {};
  return (
    <AppCard testId="progress-card">
      <CardHeader
        kicker="Progress"
        title={total > 0 ? `${completed} of ${total} modules completed` : 'Setting up'}
        subtitle="What's been delivered so far"
      />
      <div
        className="w-full h-2 rounded-full overflow-hidden"
        style={{ background: 'var(--token-surface-elevated)' }}
        data-testid="progress-bar"
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${percent}%`,
            background: 'var(--token-primary)',
          }}
        />
      </div>
      <div className="flex items-center justify-between mt-3">
        <span className="text-small-token">{percent}% complete</span>
        <div className="flex items-center gap-3 text-small-token">
          {in_review > 0 && (
            <span className="flex items-center gap-1">
              <RotateCw className="w-3 h-3" style={{ color: 'var(--token-warning)' }} />
              {in_review} in review
            </span>
          )}
          {blocked > 0 && (
            <span className="flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" style={{ color: 'var(--token-danger)' }} />
              {blocked} need attention
            </span>
          )}
        </div>
      </div>
    </AppCard>
  );
}

/* ---------- TEAM ------------------------------------------------------------ */
function TeamCard({ team }) {
  const active = team?.active || 0;
  const names = team?.names || [];
  return (
    <AppCard testId="team-card">
      <CardHeader
        kicker="Team"
        title={active > 0 ? `${active} ${active === 1 ? 'developer' : 'developers'} active` : 'Team standing by'}
        subtitle={active > 0 ? "People working on your project right now" : 'Nobody is actively coding at this moment.'}
      />
      {names.length > 0 && (
        <div className="flex items-center gap-2 mt-1" data-testid="team-avatars">
          <div className="flex -space-x-2">
            {names.map((n, i) => (
              <div
                key={i}
                className="w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm"
                style={{
                  background: 'var(--token-success-tint)',
                  color: 'var(--token-primary)',
                  border: '2px solid var(--token-surface)',
                }}
                title={n}
              >
                {(n || '?').charAt(0).toUpperCase()}
              </div>
            ))}
          </div>
          <span className="text-small-token ml-2 truncate">{names.slice(0, 3).join(' · ')}</span>
        </div>
      )}
      {active === 0 && (
        <Users className="w-5 h-5 mt-2" style={{ color: 'var(--token-text-muted)' }} />
      )}
    </AppCard>
  );
}

/* ---------- PORTFOLIO summary ---------------------------------------------- */
function PortfolioCard({ count, progress }) {
  const { in_review = 0, blocked = 0 } = progress || {};
  return (
    <AppCard testId="portfolio-card">
      <CardHeader
        kicker="Portfolio"
        title={`${count} ${count === 1 ? 'project' : 'projects'}`}
        subtitle="Your current engagement footprint"
      />
      <div className="grid grid-cols-2 gap-4 mt-2">
        <div>
          <p className="text-2xl font-bold text-token-primary">{progress?.completed || 0}</p>
          <p className="text-small-token mt-1 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> shipped
          </p>
        </div>
        <div>
          <p className="text-2xl font-bold text-token-primary">{in_review + blocked}</p>
          <p className="text-small-token mt-1 flex items-center gap-1">
            <RotateCw className="w-3 h-3" /> in motion
          </p>
        </div>
      </div>
    </AppCard>
  );
}

/* ---------- ACTIVITY -------------------------------------------------------- */
function ActivityCard({ activity }) {
  if (!activity || activity.length === 0) {
    return (
      <EmptyState
        icon={<Clock className="w-6 h-6" />}
        title="No recent activity"
        description="As soon as your team ships, it shows up here."
        tone="neutral"
        compact
        testId="activity-empty"
      />
    );
  }
  return (
    <AppCard testId="activity-card">
      <CardHeader kicker="Activity" title="What happened recently" subtitle="Last few events on your projects" />
      <ul className="space-y-3" data-testid="activity-list">
        {activity.map((evt, i) => {
          const cfg = ACTIVITY_ICON[evt.icon] || ACTIVITY_ICON.info;
          const colourMap = {
            success: 'var(--token-success)',
            warning: 'var(--token-warning)',
            danger:  'var(--token-danger)',
            info:    'var(--token-info)',
            neutral: 'var(--token-text-muted)',
          };
          return (
            <li key={i} className="flex items-start gap-3" data-testid={`activity-${i}`}>
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                style={{
                  background: 'var(--token-surface-elevated)',
                  color: colourMap[cfg.tone],
                  border: '1px solid var(--token-border)',
                }}
              >
                {cfg.glyph}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-body-token">{evt.text}</p>
                {evt.ts && <p className="text-small-token mt-0.5">{fmtAgo(evt.ts)}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </AppCard>
  );
}
