/**
 * Admin · Project Re-price — preview-first revision flow.
 *
 * Iteration 3 (Pricing Reality Layer charter Rule 2):
 *   Two-step UI. No "save on change". The friction is the feature.
 *
 *   Step 1 — Preview: pick project + axes, see live delta + narrative-chip
 *            diff. Backend = POST /api/admin/projects/{id}/reprice-preview
 *            which does NOT write. Snapshot stays intact (Rule 3).
 *   Step 2 — Commit: explicit "Commit re-price" button + reason field.
 *            Backend = POST /api/admin/projects/{id}/reprice which pushes
 *            the current snapshot into pricing_history and bumps revision.
 *
 * No "Apply suggestion" shortcut from calibration — admin must come here
 * and select the new axes manually. Conservative on purpose.
 */
import { useEffect, useMemo, useState } from 'react';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import { useToast } from '@/components/Toast';
import { Loader2, ArrowRight, AlertTriangle, RefreshCw, History } from 'lucide-react';

const fmtMoney = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;
const fmtPct = (mult) => `×${Number(mult || 1).toFixed(2)}`;

export default function AdminProjectReprice() {
  const { toast } = useToast();
  const [pricingConfig, setPricingConfig] = useState(null);
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [project, setProject] = useState(null);
  const [axes, setAxes] = useState({}); // { axis: level }
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [bootErr, setBootErr] = useState(null);

  // Boot — fetch pricing config (for axes/levels) and project list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfg, list] = await Promise.all([
          runtime.get('/api/admin/pricing-config'),
          runtime.get('/api/admin/projects'),
        ]);
        if (cancelled) return;
        setPricingConfig(cfg?.data?.effective || null);
        setProjects(Array.isArray(list?.data) ? list.data : []);
      } catch (e) {
        if (cancelled) return;
        setBootErr(e instanceof ApiError ? e.message : 'Failed to load pricing data');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // When project selected — fetch its snapshot + seed axes from existing snapshot.
  useEffect(() => {
    if (!selectedId) { setProject(null); setAxes({}); setPreview(null); return; }
    const p = projects.find((x) => x.project_id === selectedId || x.id === selectedId);
    setProject(p || null);
    const seeded = (p?.reality_layer?.axes) || {};
    setAxes({ ...seeded });
    setPreview(null);
  }, [selectedId, projects]);

  const realityLayer = pricingConfig?.reality_layer || {};
  const axesList = useMemo(() => Object.entries(realityLayer), [realityLayer]);

  const handlePreview = async () => {
    if (!selectedId) return;
    setLoadingPreview(true);
    setPreview(null);
    try {
      const { data } = await runtime.post(
        `/api/admin/projects/${selectedId}/reprice-preview`,
        { axes }
      );
      setPreview(data);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Preview failed';
      toast.error('Preview failed', { description: msg });
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleCommit = async () => {
    if (!preview || !selectedId) return;
    setCommitting(true);
    try {
      await runtime.post(
        `/api/admin/projects/${selectedId}/reprice`,
        { axes, reason: reason.trim() || undefined }
      );
      toast.success('Re-price committed', {
        description: `Revision bumped. Previous snapshot pushed to pricing_history.`,
      });
      // Refresh project list so next preview sees the new revision.
      const list = await runtime.get('/api/admin/projects');
      setProjects(Array.isArray(list?.data) ? list.data : []);
      setPreview(null);
      setReason('');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Commit failed';
      toast.error('Commit failed', { description: msg });
    } finally {
      setCommitting(false);
    }
  };

  if (bootErr) {
    return (
      <div className="app-card p-4 flex gap-3"
           style={{ background: 'var(--token-danger-tint)', borderColor: 'var(--token-danger-border)' }}>
        <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--token-danger)' }} />
        <p className="text-sm" style={{ color: 'var(--token-danger)' }}>{bootErr}</p>
      </div>
    );
  }

  if (!pricingConfig) {
    return <div className="p-4 text-sm text-muted-foreground">Loading pricing config…</div>;
  }

  const currentSnapshot = project?.pricing || {};
  const currentReality = project?.reality_layer || {};
  const currentRevision = currentReality.revision || 1;

  return (
    <div className="space-y-6" data-testid="admin-project-reprice">
      {/* Project selector */}
      <div className="app-card p-4">
        <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-2">
          Select project
        </label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          data-testid="reprice-project-select"
          className="w-full px-3 py-2 rounded-lg text-sm"
          style={{
            background: 'var(--token-surface)',
            border: '1px solid var(--token-border)',
            color: 'var(--token-text-primary)',
          }}
        >
          <option value="">— choose a project to re-price —</option>
          {projects.map((p) => {
            const pid = p.project_id || p.id;
            const name = p.name || p.title || pid;
            const price = p.pricing?.final_price;
            const rev = p.reality_layer?.revision || 1;
            return (
              <option key={pid} value={pid}>
                {name} {price ? `· ${fmtMoney(price)} · rev ${rev}` : ''}
              </option>
            );
          })}
        </select>
      </div>

      {project && (
        <>
          {/* Current snapshot */}
          <div className="app-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Current snapshot</h3>
              <span
                className="px-2 py-0.5 rounded text-xs"
                style={{ background: 'var(--token-surface-secondary)', color: 'var(--token-text-secondary)' }}
                data-testid="reprice-current-revision"
              >
                <History className="inline w-3 h-3 mr-1" />
                revision {currentRevision}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Stat label="Implementation" value={fmtMoney(currentSnapshot.implementation_price)} />
              <Stat label="Reality multiplier" value={fmtPct(currentReality.reality_multiplier || currentSnapshot.reality_multiplier)} />
              <Stat label="Final" value={fmtMoney(currentSnapshot.final_price)} highlight />
            </div>
            {(currentReality.narrative_chips || []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2" data-testid="reprice-current-chips">
                {currentReality.narrative_chips.map((chip, i) => (
                  <Chip key={`cur-${i}`}>{chip}</Chip>
                ))}
              </div>
            )}
          </div>

          {/* Axes dropdowns */}
          <div className="app-card p-4">
            <h3 className="text-sm font-semibold mb-3">New axes (preview)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {axesList.map(([axisKey, axisCfg]) => (
                <div key={axisKey}>
                  <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">
                    {axisCfg.label || axisKey}
                  </label>
                  <select
                    value={axes[axisKey] || axisCfg.default_level || ''}
                    onChange={(e) => setAxes({ ...axes, [axisKey]: e.target.value })}
                    data-testid={`reprice-axis-${axisKey}`}
                    className="w-full px-3 py-2 rounded text-sm"
                    style={{
                      background: 'var(--token-surface)',
                      border: '1px solid var(--token-border)',
                      color: 'var(--token-text-primary)',
                    }}
                  >
                    {Object.entries(axisCfg.levels || {}).map(([lvlKey, lvl]) => (
                      <option key={lvlKey} value={lvlKey}>
                        {lvlKey} · {fmtPct(lvl.multiplier)} {lvl.narrative ? `· "${lvl.narrative}"` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <button
              onClick={handlePreview}
              disabled={loadingPreview}
              data-testid="reprice-preview-btn"
              className="mt-4 w-full py-3 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: 'var(--token-surface-elevated)', border: '1px solid var(--token-border-strong)', color: 'var(--token-text-primary)' }}
            >
              {loadingPreview ? <><Loader2 className="w-4 h-4 animate-spin" />Computing preview…</> : <><RefreshCw className="w-4 h-4" />Preview new price</>}
            </button>
          </div>

          {/* Preview result */}
          {preview && (
            <div
              className="app-card p-4"
              data-testid="reprice-preview-result"
              style={{ borderColor: 'var(--token-primary-accent)' }}
            >
              <h3 className="text-sm font-semibold mb-3">Preview — not committed yet</h3>
              <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                <Stat label="Current final" value={fmtMoney(preview.previous?.final_price)} />
                <Stat label="New final" value={fmtMoney(preview.preview?.final_price)} highlight />
                <Stat
                  label="Delta"
                  value={`${(preview.delta?.final_price ?? 0) >= 0 ? '+' : ''}${fmtMoney(preview.delta?.final_price)}`}
                  tone={(preview.delta?.final_price ?? 0) >= 0 ? 'warn' : 'good'}
                />
              </div>
              <div className="grid grid-cols-2 gap-4 mb-3 text-xs">
                <div>
                  <p className="text-muted-foreground mb-1">Current chips</p>
                  <div className="flex flex-wrap gap-1">
                    {(preview.previous?.narrative_chips || []).map((c, i) => (
                      <Chip key={`cn-${i}`} dim>{c}</Chip>
                    ))}
                    {(preview.previous?.narrative_chips || []).length === 0 && (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">New chips</p>
                  <div className="flex flex-wrap gap-1">
                    {(preview.preview?.narrative_chips || []).map((c, i) => (
                      <Chip key={`nn-${i}`}>{c}</Chip>
                    ))}
                    {(preview.preview?.narrative_chips || []).length === 0 && (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground mb-3">
                Multiplier: {fmtPct(preview.previous?.reality_multiplier)} → {fmtPct(preview.preview?.reality_multiplier)}
                {' · '}Revision: {preview.previous?.revision || currentRevision} → {(preview.previous?.revision || currentRevision) + 1}
              </div>

              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1 mt-3">
                Reason (audit trail, optional but recommended)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, 240))}
                placeholder="e.g. client confirmed realtime requirement during scope call"
                rows={2}
                data-testid="reprice-reason"
                className="w-full px-3 py-2 rounded text-sm"
                style={{
                  background: 'var(--token-surface)',
                  border: '1px solid var(--token-border)',
                  color: 'var(--token-text-primary)',
                }}
              />
              <button
                onClick={handleCommit}
                disabled={committing}
                data-testid="reprice-commit-btn"
                className="mt-3 w-full py-3 rounded-lg font-semibold text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: 'var(--token-primary)', color: 'var(--token-primary-ink)' }}
              >
                {committing ? <><Loader2 className="w-4 h-4 animate-spin" />Committing…</> : <>Commit re-price<ArrowRight className="w-4 h-4" /></>}
              </button>
              <p className="text-[10px] text-muted-foreground mt-2 text-center">
                Pushes current snapshot to pricing_history. Cannot be undone in-place — only re-priced again to a new revision.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, highlight, tone }) {
  const color = tone === 'warn'
    ? 'var(--token-warning)'
    : tone === 'good'
    ? 'var(--token-success)'
    : highlight
    ? 'var(--token-primary-accent)'
    : 'var(--token-text-primary)';
  return (
    <div
      className="p-3 rounded"
      style={{ background: 'var(--token-surface-secondary)', border: '1px solid var(--token-border)' }}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-bold mt-1" style={{ color }}>{value}</p>
    </div>
  );
}

function Chip({ children, dim }) {
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={{
        background: dim ? 'transparent' : 'var(--token-primary-accent-soft)',
        color: dim ? 'var(--token-text-secondary)' : 'var(--token-primary-accent)',
        border: '1px solid var(--token-border)',
      }}
    >
      {children}
    </span>
  );
}
