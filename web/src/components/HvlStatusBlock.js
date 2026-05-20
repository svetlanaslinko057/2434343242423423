/**
 * HvlStatusBlock — Human Validation Layer status for any project member
 * (client viewing their own project, developer viewing one they're assigned to).
 *
 * Backend: GET /api/projects/{projectId}/hvl-status
 *
 * States:
 *   - hvl_tier === null  →  "Not purchased" upsell (link to checkout / plans)
 *   - tier set, no campaign  →  "Awaiting admin launch" + suggested params
 *   - active campaign  →  live status, validators_count / max_validators, stats
 */
import { useEffect, useState } from 'react';
import { runtime } from '@/runtime';
import { Sparkles, Loader2, Users, CheckCircle2, Clock } from 'lucide-react';

const TIER_LABEL = { basic: 'Basic', pro: 'Pro', managed: 'Managed' };

const HvlStatusBlock = ({ projectId }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await runtime.get(`/api/projects/${projectId}/hvl-status`);
        if (!cancelled) setData(r.data);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) {
    return (
      <div className="border border-border rounded-lg p-5 mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading Human Validation status…
      </div>
    );
  }
  if (!data) return null;

  const { hvl_tier, tier_defaults, campaign, viewer_role } = data;

  // ── State A: client never purchased HVL — soft upsell (only show to client) ──
  if (!hvl_tier) {
    if (viewer_role !== 'client') return null;
    return (
      <div
        className="border border-dashed border-border rounded-lg p-5 mb-6 flex items-start gap-4"
        data-testid="hvl-status-empty"
      >
        <div className="w-10 h-10 rounded-lg bg-signal/10 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-signal" />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-foreground mb-1">Add Human Validation</div>
          <p className="text-sm text-muted-foreground mb-3 max-w-xl">
            Get 3–7 independent reviewers to spot real issues on your product before release.
            Pre-purchase a tier (Basic / Pro / Managed) and we'll launch a review session as soon
            as your preview build is ready.
          </p>
          <a
            href="/api/web-ui/checkout?addon=hvl"
            className="text-sm font-semibold text-signal hover:underline"
          >
            See HVL tiers →
          </a>
        </div>
      </div>
    );
  }

  // ── State B: tier purchased but admin hasn't created the campaign yet ──
  if (!campaign) {
    return (
      <div
        className="border border-border rounded-lg p-5 mb-6"
        data-testid="hvl-status-waiting"
      >
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-signal/10 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-signal" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-semibold text-foreground">Human Validation Layer</span>
              <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-signal/15 text-signal border border-signal/30">
                {TIER_LABEL[hvl_tier] || hvl_tier}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {viewer_role === 'client'
                ? `Your ${TIER_LABEL[hvl_tier]} tier is reserved. We'll launch the review session as soon as your preview is ready.`
                : `Client purchased ${TIER_LABEL[hvl_tier]} tier. Admin will launch a review session before release.`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pl-13">
          <span><b className="text-foreground font-semibold">{tier_defaults?.max_validators}</b> reviewers</span>
          <span>·</span>
          <span><b className="text-foreground font-semibold">{tier_defaults?.reward_pool_credits}</b> credit pool</span>
          <span>·</span>
          <span><b className="text-foreground font-semibold">{tier_defaults?.deadline_hours}h</b> window</span>
        </div>
      </div>
    );
  }

  // ── State C: live or completed campaign ──
  const isActive = campaign.status === 'active';
  const progress = campaign.max_validators
    ? Math.min(100, Math.round((campaign.validators_count / campaign.max_validators) * 100))
    : 0;
  const hoursLeft = campaign.deadline_at
    ? Math.max(0, Math.round((new Date(campaign.deadline_at).getTime() - Date.now()) / 36e5))
    : null;

  return (
    <div
      className="border border-signal/30 bg-signal/5 rounded-lg p-5 mb-6"
      data-testid="hvl-status-active"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-signal/15 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-signal" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-semibold text-foreground">Human Validation Layer</span>
            <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-signal/15 text-signal border border-signal/30">
              {TIER_LABEL[hvl_tier] || hvl_tier}
            </span>
            <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
              isActive
                ? 'bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/30'
                : 'bg-muted text-muted-foreground border border-border'
            }`}>
              {isActive ? '● Live' : campaign.status}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {viewer_role === 'client'
              ? `Your product is being reviewed by ${campaign.validators_count}/${campaign.max_validators} validators.`
              : `Open review session — ${campaign.validators_count}/${campaign.max_validators} validators have weighed in.`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <Stat label="Validators" value={`${campaign.validators_count}/${campaign.max_validators}`} icon={Users} />
        <Stat label="Submissions" value={campaign.stats.total} />
        <Stat label="Useful" value={campaign.stats.useful} accent="#10B981" icon={CheckCircle2} />
        <Stat label="Time left" value={hoursLeft != null ? formatTime(hoursLeft) : '—'} icon={Clock} />
      </div>

      {/* progress bar */}
      <div className="h-1.5 bg-background rounded-full overflow-hidden">
        <div
          className="h-full bg-signal transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      {viewer_role === 'developer' && (
        <div className="mt-3 text-xs text-muted-foreground">
          💡 Want to earn credits reviewing other teams' products?{' '}
          <a href="/api/web-ui/developer/validation" className="text-signal font-semibold hover:underline">
            Open validation missions
          </a>
        </div>
      )}
    </div>
  );
};

const Stat = ({ label, value, accent, icon: Icon }) => (
  <div className="bg-card border border-border rounded-lg p-3">
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
      {Icon && <Icon className="w-3 h-3" />}
      {label}
    </div>
    <div className="text-lg font-bold text-foreground" style={accent ? { color: accent } : {}}>
      {value}
    </div>
  </div>
);

function formatTime(hours) {
  if (hours < 1) return '<1h';
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export default HvlStatusBlock;
