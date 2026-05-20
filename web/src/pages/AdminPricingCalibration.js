/**
 * Admin · Pricing Calibration — observation-only suggestions.
 *
 * Iteration 3 (Pricing Reality Layer charter Rule 1):
 *   This UI is READ-ONLY by construction. Backend endpoint
 *   GET /api/admin/pricing/calibration-suggestions never mutates pricing.
 *
 *   Each suggestion exposes:
 *     • axis            — "unknowns.high"
 *     • current_multiplier
 *     • observed_delta  — e.g. "+38%"
 *     • sample_size
 *     • suggested_range — [low, high]
 *     • confidence      — low|medium|high
 *
 *   Admin can only "Open in pricing config" — there is NO "Apply" button
 *   that auto-writes the multiplier. Admin must manually edit it in
 *   AdminPricingConfigPanel. The friction is the feature.
 */
import { useEffect, useState, useCallback } from 'react';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import { useToast } from '@/components/Toast';
import { RefreshCw, Loader2, AlertTriangle, ExternalLink, Info } from 'lucide-react';

const CONFIDENCE_STYLES = {
  low:    { bg: 'var(--token-warning-tint)',  br: 'var(--token-warning-border)',  fg: 'var(--token-warning)' },
  medium: { bg: 'var(--token-info-tint)',     br: 'var(--token-info-border)',     fg: 'var(--token-info)'    },
  high:   { bg: 'var(--token-success-tint)',  br: 'var(--token-success-border)',  fg: 'var(--token-success)' },
};

export default function AdminPricingCalibration({ onJumpToPricingConfig }) {
  const { toast } = useToast();
  const [minSample, setMinSample] = useState(5);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data: resp } = await runtime.get(
        `/api/admin/pricing/calibration-suggestions?min_sample=${minSample}`
      );
      setData(resp);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to load calibration data';
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }, [minSample]);

  // No auto-fetch — admin clicks "Run analysis" to make the read-only-ness
  // explicit. Also avoids burning DB on every tab switch (Rule 1 spirit).

  const suggestions = data?.suggestions || [];
  const analysedAt = data?.analysed_at;
  const projectsAnalysed = data?.projects_analysed;

  return (
    <div className="space-y-6" data-testid="admin-pricing-calibration">
      {/* Header / invariant banner */}
      <div
        className="app-card p-4 flex gap-3"
        style={{ background: 'var(--token-info-tint)', borderColor: 'var(--token-info-border)' }}
      >
        <Info className="w-5 h-5 shrink-0" style={{ color: 'var(--token-info)' }} />
        <div className="text-sm" style={{ color: 'var(--token-info)' }}>
          <strong>Observation only.</strong> This view analyses completed projects and suggests
          multiplier ranges. It does <strong>not</strong> change pricing. To apply a suggestion,
          open <em>Pricing config</em> and edit the multiplier manually. The friction is the
          feature — pricing drift is impossible by construction.
        </div>
      </div>

      {/* Controls */}
      <div className="app-card p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Minimum sample size
          </label>
          <input
            type="number"
            min={1}
            max={500}
            value={minSample}
            onChange={(e) => setMinSample(Math.max(1, parseInt(e.target.value || '1', 10)))}
            data-testid="calibration-min-sample"
            className="px-3 py-2 rounded text-sm w-32"
            style={{
              background: 'var(--token-surface)',
              border: '1px solid var(--token-border)',
              color: 'var(--token-text-primary)',
            }}
          />
        </div>
        <button
          onClick={fetchSuggestions}
          disabled={loading}
          data-testid="calibration-run-btn"
          className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          style={{ background: 'var(--token-primary)', color: 'var(--token-primary-ink)' }}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {loading ? 'Analysing…' : 'Run analysis'}
        </button>
        {analysedAt && (
          <div className="text-xs text-muted-foreground ml-auto">
            Last analysed: {new Date(analysedAt).toLocaleString()}
            {typeof projectsAnalysed === 'number' && (
              <> · {projectsAnalysed} projects scanned</>
            )}
          </div>
        )}
      </div>

      {err && (
        <div
          className="app-card p-4 flex gap-3"
          style={{ background: 'var(--token-danger-tint)', borderColor: 'var(--token-danger-border)' }}
        >
          <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--token-danger)' }} />
          <p className="text-sm" style={{ color: 'var(--token-danger)' }}>{err}</p>
        </div>
      )}

      {data && suggestions.length === 0 && !loading && (
        <div
          className="app-card p-6 text-center"
          data-testid="calibration-empty"
        >
          <p className="text-sm text-muted-foreground">
            No axes have enough completed projects with logged hours to suggest a calibration.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Lower the minimum sample size, or wait for more projects to complete.
          </p>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-2" data-testid="calibration-suggestions-list">
          {suggestions.map((s, i) => (
            <SuggestionRow
              key={`${s.axis}-${i}`}
              s={s}
              onOpen={() => {
                if (onJumpToPricingConfig) {
                  onJumpToPricingConfig(s.axis);
                } else {
                  toast.info('Open Pricing config tab to edit the multiplier', {
                    description: `Axis: ${s.axis}`,
                  });
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionRow({ s, onOpen }) {
  const conf = CONFIDENCE_STYLES[s.confidence] || CONFIDENCE_STYLES.low;
  const deltaPositive = (s.observed_delta || '').trim().startsWith('+');
  return (
    <div
      className="app-card p-4 flex items-center gap-4"
      data-testid={`calibration-row-${s.axis}`}
    >
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <code className="text-sm font-mono">{s.axis}</code>
          <span
            className="px-2 py-0.5 rounded text-[10px] uppercase font-semibold"
            style={{ background: conf.bg, color: conf.fg, border: `1px solid ${conf.br}` }}
            data-testid={`calibration-confidence-${s.axis}`}
          >
            {s.confidence} · n={s.sample_size}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          Current: <strong>×{Number(s.current_multiplier).toFixed(2)}</strong>
          {' · '}Suggested range: <strong>×{s.suggested_range?.[0]}–×{s.suggested_range?.[1]}</strong>
          {' · '}Observed delta:{' '}
          <span style={{ color: deltaPositive ? 'var(--token-warning)' : 'var(--token-success)' }}>
            <strong>{s.observed_delta}</strong>
          </span>
        </div>
      </div>
      <button
        onClick={onOpen}
        data-testid={`calibration-open-${s.axis}`}
        className="px-3 py-2 rounded text-xs font-medium flex items-center gap-1.5"
        style={{ background: 'var(--token-surface-elevated)', border: '1px solid var(--token-border-strong)', color: 'var(--token-text-primary)' }}
      >
        <ExternalLink className="w-3 h-3" />
        Open in pricing config
      </button>
    </div>
  );
}
