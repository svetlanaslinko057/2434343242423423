/**
 * Admin · Finance · Pricing — runtime-tunable economics for /api/estimate.
 *
 * Source: GET/PUT/POST /api/admin/pricing-config[/reset]
 *
 *   Layer 1 — Implementation cost:
 *     • base_hourly_rate (USD/h) — base of AI-blended pricing
 *     • base_estimate_tiers — heuristic floor by brief length
 *     • modes.{ai,hybrid,dev}.price_multiplier — production-mode pricing
 *
 *   Layer 2 — Project Reality Layer (May 17, 2026):
 *     5 entropy axes that scale the price from "implementation effort" to
 *     "real production cost". Composed as a product:
 *         final_price = base × mode_multiplier × ∏(axis_multiplier)
 *
 *     • product_maturity — MVP / Beta / Production / Scaled
 *     • system_coupling — isolated / connected / platform / OS
 *     • unknowns — low / medium / high / research
 *     • realtime_pressure — none / async / collaborative / critical
 *     • longevity — prototype / startup_mvp / long_term / infrastructure
 *
 * Changes hit the next /api/estimate call (in-process cache busted on PUT).
 * Project.pricing is an immutable historical snapshot — never recomputed.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import { useToast } from '@/components/Toast';
import { DollarSign, RefreshCw, RotateCcw, Save, AlertTriangle, Layers } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const MODE_LABELS = {
  ai: 'AI build',
  hybrid: 'AI + Dev',
  dev: 'Full dev',
};

const AXIS_ORDER = [
  'product_maturity',
  'system_coupling',
  'unknowns',
  'realtime_pressure',
  'longevity',
];

const LEVEL_ORDER = {
  product_maturity: ['mvp', 'beta', 'production', 'scaled'],
  system_coupling: ['isolated', 'connected', 'platform', 'operating_system'],
  unknowns: ['low', 'medium', 'high', 'research'],
  realtime_pressure: ['none', 'async', 'collaborative', 'critical'],
  longevity: ['prototype', 'startup_mvp', 'long_term', 'infrastructure'],
};

const LEVEL_LABEL = {
  mvp: 'MVP',
  beta: 'Beta',
  production: 'Production',
  scaled: 'Scaled',
  isolated: 'Isolated app',
  connected: 'Connected',
  platform: 'Platform',
  operating_system: 'OS-level',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  research: 'Research',
  none: 'None',
  async: 'Async',
  collaborative: 'Collaborative',
  critical: 'Critical realtime',
  prototype: 'Prototype',
  startup_mvp: 'Startup MVP',
  long_term: 'Long-term',
  infrastructure: 'Infrastructure',
};

export default function AdminPricingConfigPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [effective, setEffective] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [draft, setDraft] = useState(null); // working copy
  const [confirmReset, setConfirmReset] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      setErr(null);
      setLoading(true);
      const { data } = await runtime.get('/api/admin/pricing-config');
      setEffective(data.effective);
      setDefaults(data.defaults);
      setDraft(JSON.parse(JSON.stringify(data.effective)));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to load pricing config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => {
    if (!effective || !draft) return false;
    if (Number(draft.base_hourly_rate) !== Number(effective.base_hourly_rate)) return true;
    for (const m of ['ai', 'hybrid', 'dev']) {
      if (
        Number(draft.modes[m].price_multiplier) !==
        Number(effective.modes[m].price_multiplier)
      ) return true;
    }
    for (const t of ['tiny', 'small', 'full']) {
      if (Number(draft.base_estimate_tiers[t].base_price) !== Number(effective.base_estimate_tiers[t].base_price)) return true;
    }
    if (draft.reality_layer && effective.reality_layer) {
      for (const axis of AXIS_ORDER) {
        const a = draft.reality_layer[axis];
        const b = effective.reality_layer[axis];
        if (!a || !b) continue;
        for (const lvl of LEVEL_ORDER[axis]) {
          if (Number(a.levels[lvl]?.multiplier) !== Number(b.levels[lvl]?.multiplier)) return true;
        }
      }
    }
    return false;
  }, [draft, effective]);

  const effectiveRate = (mode) => {
    if (!draft) return 0;
    return draft.base_hourly_rate * draft.modes[mode].price_multiplier;
  };

  // Worked example so admin sees the math impact of axis settings.
  // Uses the "small" base tier (a normal 120-char brief) priced with hybrid
  // mode, then applies the max-level multiplier of each axis. This makes the
  // "production cost vs implementation cost" gap visible at a glance.
  const realityExample = useMemo(() => {
    if (!draft?.reality_layer) return null;
    const base = Number(draft.base_estimate_tiers.small.base_price) * Number(draft.modes.hybrid.price_multiplier);
    let mult = 1;
    for (const axis of AXIS_ORDER) {
      const levels = draft.reality_layer[axis]?.levels || {};
      // Take the highest-numbered (worst-case) multiplier for this axis.
      let axisMax = 1;
      for (const lvl of LEVEL_ORDER[axis]) {
        const m = Number(levels[lvl]?.multiplier ?? 1);
        if (m > axisMax) axisMax = m;
      }
      mult *= axisMax;
    }
    return {
      base: Math.round(base),
      multiplier: Math.round(mult * 100) / 100,
      final: Math.round(base * mult),
    };
  }, [draft]);

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const payload = {
        base_hourly_rate: Number(draft.base_hourly_rate),
        modes: {
          ai:     { price_multiplier: Number(draft.modes.ai.price_multiplier) },
          hybrid: { price_multiplier: Number(draft.modes.hybrid.price_multiplier) },
          dev:    { price_multiplier: Number(draft.modes.dev.price_multiplier) },
        },
        base_estimate_tiers: {
          tiny:  { base_price: Number(draft.base_estimate_tiers.tiny.base_price) },
          small: { base_price: Number(draft.base_estimate_tiers.small.base_price) },
          full:  { base_price: Number(draft.base_estimate_tiers.full.base_price) },
        },
      };
      if (draft.reality_layer) {
        const rl = {};
        for (const axis of AXIS_ORDER) {
          const axisDraft = draft.reality_layer[axis];
          if (!axisDraft) continue;
          const levels = {};
          for (const lvl of LEVEL_ORDER[axis]) {
            const m = axisDraft.levels?.[lvl]?.multiplier;
            if (m !== undefined && m !== null && m !== '') {
              levels[lvl] = { multiplier: Number(m) };
            }
          }
          if (Object.keys(levels).length > 0) {
            rl[axis] = { levels };
          }
        }
        if (Object.keys(rl).length > 0) {
          payload.reality_layer = rl;
        }
      }
      const { data } = await runtime.put('/api/admin/pricing-config', payload);
      setEffective(data.effective);
      setDraft(JSON.parse(JSON.stringify(data.effective)));
      toast.success('Pricing updated', {
        description: `Effective from this moment. Base rate $${data.effective.base_hourly_rate}/h.`,
      });
    } catch (e) {
      if (e instanceof ApiError) {
        toast.error('Save failed', { description: `${e.message} (req: ${e.requestId})` });
      } else {
        toast.error('Save failed', { description: 'Network error. Please retry.' });
      }
    } finally {
      setSaving(false);
    }
  }, [draft, toast]);

  const reset = useCallback(async () => {
    setConfirmReset(false);
    setSaving(true);
    try {
      const { data } = await runtime.post('/api/admin/pricing-config/reset', {});
      setEffective(data.effective);
      setDraft(JSON.parse(JSON.stringify(data.effective)));
      toast.success('Reset to defaults', { description: `Base rate $${data.effective.base_hourly_rate}/h.` });
    } catch (e) {
      toast.error('Reset failed', { description: e instanceof ApiError ? e.message : 'Network error' });
    } finally {
      setSaving(false);
    }
  }, [toast]);

  if (loading) {
    return (
      <div className="p-6" data-testid="pricing-config-loading">
        <div className="text-token-secondary">Loading pricing config…</div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="app-card p-4 flex gap-3"
           style={{ background: 'var(--token-danger-tint)', borderColor: 'var(--token-danger-border)' }}>
        <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--token-danger)' }} />
        <div>
          <p className="text-sm font-bold" style={{ color: 'var(--token-danger)' }}>{err}</p>
          <button onClick={load} className="text-xs underline mt-1">Retry</button>
        </div>
      </div>
    );
  }

  if (!draft) return null;

  return (
    <div className="space-y-6" data-testid="pricing-config">
      {/* Header explains intent */}
      <div className="app-card p-4" style={{ background: 'var(--token-info-tint)', borderColor: 'var(--token-info-border)' }}>
        <p className="text-sm" style={{ color: 'var(--token-info)' }}>
          These knobs control how <code>/api/estimate</code> prices new projects.
          Changes take effect immediately for new estimates. Existing projects keep
          their original snapshot (pricing is historical, never recomputed retroactively).
        </p>
        {effective.updated_at && (
          <p className="text-xs mt-2 text-token-secondary">
            Last updated <strong>{new Date(effective.updated_at).toLocaleString()}</strong>
            {effective.updated_by ? ` by ${effective.updated_by}` : ''}
          </p>
        )}
      </div>

      {/* Base hourly rate */}
      <section className="app-card p-5">
        <h3 className="text-token-kicker mb-1">Base hourly rate</h3>
        <p className="text-xs text-token-secondary mb-3">
          Used in the AI-blended pricing path: <code>hours × rate × mode_multiplier</code>.
          Default $65/h is mid-market freelancer (EE/LATAM tier). For US/EU clients use $100-150/h.
        </p>
        <div className="flex items-center gap-3">
          <div className="flex items-center" style={{
            background: 'var(--token-surface)',
            border: '1px solid var(--token-border)',
            borderRadius: 8,
          }}>
            <span className="px-3 text-token-secondary">$</span>
            <input
              type="number"
              min="1"
              max="5000"
              step="5"
              value={draft.base_hourly_rate}
              onChange={(e) => setDraft({ ...draft, base_hourly_rate: e.target.value })}
              className="py-2 pr-3 text-lg font-bold bg-transparent outline-none w-28"
              data-testid="input-base-hourly-rate"
            />
            <span className="px-3 text-token-secondary text-sm">/h</span>
          </div>
          <span className="text-xs text-token-secondary">
            default ${defaults.base_hourly_rate}/h
          </span>
        </div>
      </section>

      {/* Mode multipliers */}
      <section className="app-card p-5">
        <h3 className="text-token-kicker mb-1">Production-mode multipliers</h3>
        <p className="text-xs text-token-secondary mb-4">
          Multiplied against base rate. Final $/h shown for each mode below.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {['ai', 'hybrid', 'dev'].map((m) => (
            <div key={m} className="app-card p-4" data-testid={`mode-card-${m}`}
                 style={{ background: 'var(--token-surface)' }}>
              <p className="text-sm font-bold text-token-primary">{MODE_LABELS[m]}</p>
              <p className="text-xs text-token-secondary mb-3 capitalize">mode = {m}</p>
              <label className="text-xs text-token-secondary">multiplier</label>
              <input
                type="number"
                min="0.01"
                max="5"
                step="0.05"
                value={draft.modes[m].price_multiplier}
                onChange={(e) => setDraft({
                  ...draft,
                  modes: { ...draft.modes, [m]: { ...draft.modes[m], price_multiplier: e.target.value } },
                })}
                className="block w-full mt-1 py-1.5 px-2 text-sm font-bold"
                style={{
                  background: 'var(--token-bg)',
                  border: '1px solid var(--token-border)',
                  borderRadius: 6,
                }}
                data-testid={`input-mode-${m}-multiplier`}
              />
              <p className="text-xs mt-2 text-token-secondary">
                default {defaults.modes[m].price_multiplier}
              </p>
              <p className="text-sm font-bold mt-3" style={{ color: 'var(--token-success)' }}>
                = ${effectiveRate(m).toFixed(2)}/h
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Base estimate tiers */}
      <section className="app-card p-5">
        <h3 className="text-token-kicker mb-1">Heuristic floor by goal length</h3>
        <p className="text-xs text-token-secondary mb-4">
          Deterministic base estimate used as a floor and as input to the blend
          (35% heuristic / 65% AI / 40% template if matched). Don't make these
          too high — they apply even when AI scope generation fails.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { k: 'tiny', label: 'Tiny brief', range: `< ${draft.base_estimate_tiers.tiny.max_chars} chars` },
            { k: 'small', label: 'Small brief', range: `${draft.base_estimate_tiers.tiny.max_chars}–${draft.base_estimate_tiers.small.max_chars} chars` },
            { k: 'full', label: 'Full brief', range: `≥ ${draft.base_estimate_tiers.small.max_chars} chars` },
          ].map(({ k, label, range }) => (
            <div key={k} className="app-card p-4" data-testid={`tier-card-${k}`}
                 style={{ background: 'var(--token-surface)' }}>
              <p className="text-sm font-bold text-token-primary">{label}</p>
              <p className="text-xs text-token-secondary mb-3">{range}</p>
              <label className="text-xs text-token-secondary">base price ($)</label>
              <div className="flex items-center mt-1" style={{
                background: 'var(--token-bg)',
                border: '1px solid var(--token-border)',
                borderRadius: 6,
              }}>
                <span className="px-2 text-token-secondary text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="100"
                  value={draft.base_estimate_tiers[k].base_price}
                  onChange={(e) => setDraft({
                    ...draft,
                    base_estimate_tiers: {
                      ...draft.base_estimate_tiers,
                      [k]: { ...draft.base_estimate_tiers[k], base_price: e.target.value },
                    },
                  })}
                  className="py-1.5 pr-2 text-sm font-bold bg-transparent outline-none w-full"
                  data-testid={`input-tier-${k}-base-price`}
                />
              </div>
              <p className="text-xs mt-2 text-token-secondary">
                default ${defaults.base_estimate_tiers[k].base_price}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* === REALITY LAYER (May 17, 2026) === */}
      {draft.reality_layer && (
        <section className="app-card p-5" data-testid="reality-layer-section">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="w-4 h-4" style={{ color: 'var(--token-accent)' }} />
            <h3 className="text-token-kicker m-0">Project Reality Layer (entropy multipliers)</h3>
          </div>
          <p className="text-xs text-token-secondary mb-3">
            Five axes that turn the estimator from "AI hours calculator" into a
            production-aware engine. The full formula is:
            <br />
            <code>final = base × mode_multiplier × ∏(axis_multiplier)</code>
          </p>
          <p className="text-xs text-token-secondary mb-4">
            Each axis has 4 levels (low → high). Per project, the LLM proposes
            axes from the brief; admin can override before sending the offer.
            Old projects without axes price unchanged (all multipliers = ×1.00).
          </p>

          {/* Worked example so admin sees impact */}
          {realityExample && (
            <div className="app-card p-3 mb-4" style={{ background: 'var(--token-warning-tint)', borderColor: 'var(--token-warning-border)' }}>
              <p className="text-xs" style={{ color: 'var(--token-warning)' }}>
                <strong>Worked example</strong> · small brief in hybrid mode, all axes at MAX level:&nbsp;
                <code>${realityExample.base.toLocaleString()} × {realityExample.multiplier} = ${realityExample.final.toLocaleString()}</code>
                <span className="ml-2 text-token-secondary">(production cost vs implementation cost)</span>
              </p>
            </div>
          )}

          <div className="space-y-4">
            {AXIS_ORDER.map((axis) => {
              const axisDraft = draft.reality_layer[axis];
              const axisDefaults = defaults?.reality_layer?.[axis];
              if (!axisDraft) return null;
              return (
                <div key={axis} className="app-card p-4"
                     style={{ background: 'var(--token-surface)' }}
                     data-testid={`reality-axis-${axis}`}>
                  <p className="text-sm font-bold text-token-primary mb-1">{axisDraft.label}</p>
                  <p className="text-xs text-token-secondary mb-3">
                    Default level: <code>{axisDraft.default_level}</code>
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {LEVEL_ORDER[axis].map((lvl) => {
                      const levelDraft = axisDraft.levels?.[lvl];
                      const levelDefault = axisDefaults?.levels?.[lvl];
                      if (!levelDraft) return null;
                      return (
                        <div key={lvl} className="p-3" style={{
                          background: 'var(--token-bg)',
                          border: '1px solid var(--token-border)',
                          borderRadius: 6,
                        }} data-testid={`reality-level-${axis}-${lvl}`}>
                          <p className="text-xs font-bold text-token-primary truncate" title={LEVEL_LABEL[lvl] || lvl}>
                            {LEVEL_LABEL[lvl] || lvl}
                          </p>
                          <label className="text-xs text-token-secondary">×multiplier</label>
                          <input
                            type="number"
                            min="0.01"
                            max="10"
                            step="0.05"
                            value={levelDraft.multiplier}
                            onChange={(e) => {
                              setDraft((d) => ({
                                ...d,
                                reality_layer: {
                                  ...d.reality_layer,
                                  [axis]: {
                                    ...d.reality_layer[axis],
                                    levels: {
                                      ...d.reality_layer[axis].levels,
                                      [lvl]: { ...d.reality_layer[axis].levels[lvl], multiplier: e.target.value },
                                    },
                                  },
                                },
                              }));
                            }}
                            className="block w-full mt-1 py-1 px-2 text-sm font-bold"
                            style={{
                              background: 'var(--token-surface)',
                              border: '1px solid var(--token-border)',
                              borderRadius: 4,
                            }}
                            data-testid={`input-reality-${axis}-${lvl}`}
                          />
                          {levelDefault && (
                            <p className="text-xs mt-1 text-token-secondary">
                              default ×{levelDefault.multiplier}
                            </p>
                          )}
                          {levelDraft.narrative && (
                            <p className="text-xs mt-1 italic" style={{ color: 'var(--token-accent)' }} title="Client-facing narrative chip">
                              "{levelDraft.narrative}"
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Sticky-ish action row */}
      <div className="flex items-center justify-between sticky bottom-0 py-3"
           style={{ background: 'var(--token-bg)', borderTop: '1px solid var(--token-border)' }}>
        <button
          onClick={() => setConfirmReset(true)}
          disabled={saving}
          data-testid="btn-reset-pricing"
          className="btn-token-ghost flex items-center gap-2 text-sm disabled:opacity-50"
        >
          <RotateCcw className="w-4 h-4" />
          Reset to defaults
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={saving}
            data-testid="btn-reload-pricing"
            className="btn-token-ghost flex items-center gap-2 text-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} />
            Reload
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            data-testid="btn-save-pricing"
            className="btn-token-primary flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={(v) => { if (!v) setConfirmReset(false); }}
        title="Reset pricing config?"
        description="All admin overrides cleared: base rate, tiers, mode multipliers, AND reality layer multipliers. Existing projects keep their historical pricing snapshots."
        confirmLabel="Reset"
        variant="danger"
        onConfirm={reset}
      />
    </div>
  );
}
