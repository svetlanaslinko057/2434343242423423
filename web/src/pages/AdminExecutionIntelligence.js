/**
 * Admin · Execution Intelligence — web cognition surface.
 *
 * 3-column live operational stream:
 *   LEFT   — live module flow (from /api/execution-intelligence/live-flow)
 *   CENTER — selected module cognition (/why/:id, structured drivers, conviction band)
 *   RIGHT  — parallel universes (/parallel-universes/:id, naive vs protected)
 *   TOP    — system-wide conviction band + suppression block (the moat)
 *
 * Pure projection: UI never aggregates, never sorts, never computes derived state.
 * Refresh: 15s polling per panel — direction over precision.
 * No fake quant precision: conviction is shown as band, not %.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { API } from '@/App';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight,
  Ban, Brain, ChevronRight, CircleAlert, CircuitBoard, Clock, Eye, Flame,
  GitBranch, Hammer, History, Layers, Loader2, Network, Radio, RefreshCw,
  RotateCcw, Scale, Shield, ShieldOff, Sparkles, Target, TrendingDown,
  TrendingUp, Undo2, UserCheck, Workflow, X, Zap,
} from 'lucide-react';

const POLL_MS = 15_000;
const PATTERNS_POLL_MS = 60_000;

/* ─── colour helpers — bound to design-system semantic tokens ─────────────
   Was bright dashboard alarms (var(--t-danger) / var(--t-warning) / var(--t-success) / var(--t-signal)).
   Now restrained oxide / muted ochre / olive-shifted sage / slate-info so
   cognition surfaces read as observational, not incident-center. */
const sevColor = (s) =>
  s === 'high' ? 'var(--t-danger)' : s === 'medium' ? 'var(--t-warning)' :
  s === 'low' ? 'var(--t-success)' : 'var(--t-text-muted)';

const bandStyle = (band) => ({
  collapsing: { color: 'var(--t-danger)',  glow: 'var(--t-danger-bg-soft)',  icon: TrendingDown,
                label: 'COLLAPSING', sub: 'system protecting itself' },
  weak:       { color: 'var(--t-warning)', glow: 'var(--t-warning-bg-soft)', icon: ArrowDownRight,
                label: 'WEAK',       sub: 'cognition recovering' },
  building:   { color: 'var(--t-info)',    glow: 'var(--t-info-bg-soft)',    icon: ArrowUpRight,
                label: 'BUILDING',   sub: 'confidence rising' },
  strong:     { color: 'var(--t-success)', glow: 'var(--t-success-bg-soft)', icon: TrendingUp,
                label: 'STRONG',     sub: 'orchestration aligned' },
}[band] || {
  color: 'var(--t-text-muted)', glow: 'transparent',
  icon: Activity, label: 'FORMING', sub: 'awaiting first signal',
});

const verdictStyle = (v) => ({
  ASSIGNED:   { color: 'var(--t-info)',    icon: Target },
  IN_FLIGHT:  { color: 'var(--t-info)',    icon: Workflow },
  COMPLETED:  { color: 'var(--t-success)', icon: Sparkles },
  SUPPRESSED: { color: 'var(--t-danger)',  icon: Ban },
  REJECTED:   { color: 'var(--t-danger)',  icon: ShieldOff },
  OPEN:       { color: 'var(--t-warning)', icon: CircuitBoard },
}[v] || { color: 'var(--t-text-muted)', icon: Activity });

/* ─── tiny atoms (presentational only) ──────────────────────────────────── */
const Card = ({ children, style, className = '', testid }) => (
  <div
    data-testid={testid}
    className={`rounded-xl ${className}`}
    style={{
      background: 'var(--token-surface-elevated)',
      border: '1px solid var(--token-border)',
      ...style,
    }}
  >
    {children}
  </div>
);

const Kicker = ({ children, color }) => (
  <div
    className="text-[10px] tracking-[2px] font-bold uppercase mb-2"
    style={{ color: color || 'var(--token-muted)' }}
  >
    {children}
  </div>
);

const Stat = ({ label, value, accent }) => (
  <div className="flex items-baseline justify-between py-1">
    <span className="text-[12px] text-token-muted">{label}</span>
    <span
      className="text-[14px] font-bold"
      style={{ color: accent || 'var(--token-primary)' }}
    >
      {value}
    </span>
  </div>
);

const fmtAgo = (iso) => {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
};

/* ─── Page ──────────────────────────────────────────────────────────────── */
export default function AdminExecutionIntelligence() {
  const [conviction, setConviction] = useState(null);
  const [flow, setFlow] = useState(null);
  const [suppressions, setSuppressions] = useState(null);
  const [memory, setMemory] = useState(null);
  const [overrides, setOverrides] = useState(null);   // P2.2
  const [patterns, setPatterns] = useState(null);     // P2.3-lite
  const [selected, setSelected] = useState(null);     // module_id
  const [why, setWhy] = useState(null);
  const [universes, setUniverses] = useState(null);
  const [timeline, setTimeline] = useState(null);     // P2.1
  const [overrideTarget, setOverrideTarget] = useState(null); // suppression item being overridden
  const [err, setErr] = useState(null);
  const [bump, setBump] = useState(0);
  const lastTickRef = useRef(Date.now());

  /* Top-level five feeds — independent fetches per ARCHITECTURE.md */
  const loadAll = useCallback(async () => {
    try {
      setErr(null);
      const opts = { withCredentials: true };
      const [c, f, s, m, ov] = await Promise.all([
        axios.get(`${API}/execution-intelligence/conviction`,   opts),
        axios.get(`${API}/execution-intelligence/live-flow`,    opts),
        axios.get(`${API}/execution-intelligence/suppressions`, opts),
        axios.get(`${API}/execution-intelligence/memory`,       opts),
        axios.get(`${API}/execution-intelligence/overrides`,    opts),
      ]);
      setConviction(c.data);
      setFlow(f.data);
      setSuppressions(s.data);
      setMemory(m.data);
      setOverrides(ov.data);
      lastTickRef.current = Date.now();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to load cognition feed');
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll, bump]);
  useEffect(() => {
    const id = setInterval(() => setBump((x) => x + 1), POLL_MS);
    return () => clearInterval(id);
  }, []);

  /* P2.3-lite — Pattern Memory feed.
     Independent 60s cadence: patterns are organizational memory, not a
     real-time stream. Polling them at 15s would create false sense of
     volatility — they should feel stable, like institutional context.   */
  const loadPatterns = useCallback(async () => {
    try {
      const res = await axios.get(
        `${API}/execution-intelligence/patterns`,
        { withCredentials: true },
      );
      setPatterns(res.data);
    } catch (e) {
      // Silent — patterns are secondary; main feeds drive the err state.
    }
  }, []);
  useEffect(() => { loadPatterns(); }, [loadPatterns]);
  useEffect(() => {
    const id = setInterval(loadPatterns, PATTERNS_POLL_MS);
    return () => clearInterval(id);
  }, [loadPatterns]);

  /* P3.1 — Causal Trace for the selected module.
     60s polling, parallel to Pattern Memory.  Compact panel sits between
     the 3-column stream and the suppression feed — adjacent to Module
     Cognition (CognitionPanel) without crowding the timeline ribbon.
     `forming` is a legitimate steady-state — chains only open when new
     cognition events fire, and we never invent missing phases.            */
  const [causalTrace, setCausalTrace] = useState(null);
  const loadCausalTrace = useCallback(async (mod) => {
    if (!mod) { setCausalTrace(null); return; }
    try {
      const res = await axios.get(
        `${API}/execution-intelligence/causal-trace/by-module/${mod}`,
        { withCredentials: true },
      );
      setCausalTrace(res.data);
    } catch (e) {
      // Silent — causal trace is tertiary, never blocks the main surface.
    }
  }, []);
  useEffect(() => { loadCausalTrace(selected); }, [selected, loadCausalTrace]);
  useEffect(() => {
    if (!selected) return undefined;
    const id = setInterval(() => loadCausalTrace(selected), PATTERNS_POLL_MS);
    return () => clearInterval(id);
  }, [selected, loadCausalTrace]);

  /* Module-centered cognition — refetch when selected changes or polled */
  useEffect(() => {
    if (!selected) { setWhy(null); setUniverses(null); setTimeline(null); return; }
    const opts = { withCredentials: true };
    Promise.all([
      axios.get(`${API}/execution-intelligence/why/${selected}`, opts),
      axios.get(`${API}/execution-intelligence/parallel-universes/${selected}`, opts),
      axios.get(`${API}/execution-intelligence/timeline/${selected}`, opts),
    ]).then(([w, u, t]) => {
      setWhy(w.data);
      setUniverses(u.data);
      setTimeline(t.data);
    }).catch((e) => {
      setErr(e?.response?.data?.detail || 'Failed to load module cognition');
    });
  }, [selected, bump]);

  /* When live-flow first lands, auto-pick the most recent module entity */
  useEffect(() => {
    if (selected || !flow?.stream) return;
    const firstModule = flow.stream.find(
      (s) => s.entity_type === 'module' && s.entity_id,
    );
    if (firstModule) setSelected(firstModule.entity_id);
  }, [flow, selected]);

  const stream = flow?.stream || [];
  const pipeline = flow?.pipeline || {};
  const decisions24h = flow?.decisions_24h || {};

  return (
    <div className="p-5 max-w-[1600px] mx-auto" data-testid="admin-execution-intelligence">
      {/* ─── Header / conviction band / suppression count ────────────── */}
      <Header
        conviction={conviction}
        suppressions={suppressions}
        decisions24h={decisions24h}
        onRefresh={() => setBump((x) => x + 1)}
        lastTick={lastTickRef.current}
      />

      {err && (
        <Card
          className="mt-4 px-4 py-3 flex items-center gap-2"
          style={{
            background: 'rgba(239,68,68,.08)',
            borderColor: 'rgba(239,68,68,.4)',
          }}
        >
          <AlertTriangle className="w-4 h-4" style={{ color: 'var(--t-danger)' }} />
          <span className="text-[13px]" style={{ color: 'var(--t-danger)' }}>{err}</span>
        </Card>
      )}

      {/* ─── 3-column operational stream ──────────────────────────────── */}
      <div className="grid grid-cols-12 gap-4 mt-4">
        {/* LEFT — live flow */}
        <div className="col-span-12 lg:col-span-4">
          <LiveFlowPanel
            pipeline={pipeline}
            stream={stream}
            decisions24h={decisions24h}
            selected={selected}
            onSelect={setSelected}
          />
        </div>

        {/* CENTER — module cognition + timeline ribbon */}
        <div className="col-span-12 lg:col-span-4">
          <CognitionPanel why={why} timeline={timeline} selected={selected} />
        </div>

        {/* RIGHT — parallel universes */}
        <div className="col-span-12 lg:col-span-4">
          <UniversesPanel universes={universes} selected={selected} />
        </div>
      </div>

      {/* ─── P3.1 — Causal Trace (compact, scoped to selected module) ── */}
      <div className="mt-4">
        <CausalTracePanel data={causalTrace} selected={selected} />
      </div>

      {/* ─── Bottom — suppression feed (moat) + AI memory ──────────── */}
      <div className="grid grid-cols-12 gap-4 mt-4">
        <div className="col-span-12 lg:col-span-7">
          <SuppressionsPanel
            data={suppressions}
            overrides={overrides}
            onOverride={(item) => setOverrideTarget(item)}
          />
        </div>
        <div className="col-span-12 lg:col-span-5">
          <MemoryPanel data={memory} overrides={overrides} />
        </div>
      </div>

      {/* ─── P2.3-lite — Pattern Memory (organizational memory layer) ── */}
      <div className="mt-4">
        <PatternMemoryPanel
          data={patterns}
          onOpenModule={(modId) => modId && setSelected(modId)}
        />
      </div>

      {/* ─── Override modal — P2.2 ─────────────────────────────────── */}
      {overrideTarget && (
        <OverrideModal
          target={overrideTarget}
          onClose={() => setOverrideTarget(null)}
          onSubmitted={() => {
            setOverrideTarget(null);
            setBump((x) => x + 1);
          }}
        />
      )}
    </div>
  );
}

/* ─── Header — conviction band + 24h pulse ──────────────────────────────── */
function Header({ conviction, suppressions, decisions24h, onRefresh, lastTick }) {
  const band = conviction?.band || 'forming';
  const bs = bandStyle(band);
  const Icon = bs.icon;
  const trendArrow = conviction?.trend_arrow;
  return (
    <Card
      className="px-5 py-4"
      testid="cognition-header"
      style={{
        boxShadow: '0 0 0 1px var(--token-border)',
      }}
    >
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: bs.glow, border: `1px solid ${bs.color}33` }}
          >
            <Brain className="w-6 h-6" style={{ color: bs.color }} />
          </div>
          <div>
            <Kicker color="var(--token-muted)">Execution Intelligence</Kicker>
            <div className="flex items-center gap-3">
              <h1 className="text-[22px] font-bold tracking-tight">
                Cognition is{' '}
                <span style={{ color: bs.color }}>{bs.label}</span>
              </h1>
              <span
                className="inline-flex items-center gap-1 px-2 py-[2px] rounded text-[10px] font-bold tracking-wider"
                style={{
                  color: bs.color,
                  background: bs.glow,
                  border: `1px solid ${bs.color}33`,
                }}
              >
                <Icon className="w-3 h-3" />
                {trendArrow === 'up'
                  ? 'BUILDING ↑'
                  : trendArrow === 'down'
                    ? 'COLLAPSING ↓'
                    : 'STABLE ⏤'}
              </span>
            </div>
            <p className="text-[12px] text-token-muted mt-1">
              {bs.sub} · {conviction?.samples?.actions_24h ?? 0} decisions in 24h
            </p>
          </div>
        </div>

        {/* Pulse — executed / suppressed / pending_human */}
        <div className="flex items-center gap-5">
          <Pulse
            label="Executed"
            value={decisions24h.executed ?? 0}
            color="var(--t-success)"
            icon={Zap}
          />
          <Pulse
            label="Suppressed"
            value={suppressions?.count ?? decisions24h.suppressed ?? 0}
            color="var(--t-danger)"
            icon={Ban}
          />
          <Pulse
            label="Awaiting human"
            value={decisions24h.pending_human ?? 0}
            color="var(--t-warning)"
            icon={Eye}
          />
          <button
            onClick={onRefresh}
            className="btn-token-ghost flex items-center gap-2 px-3 py-2 rounded-lg"
            data-testid="cognition-refresh-btn"
            title={`Last tick: ${fmtAgo(new Date(lastTick).toISOString())}`}
          >
            <RefreshCw className="w-4 h-4" />
            <span className="text-[12px]">Refresh</span>
          </button>
        </div>
      </div>

      {/* Conviction signal breakdown — direction, not numbers */}
      {Array.isArray(conviction?.components) && conviction.components.length > 0 && (
        <div
          className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 pt-3"
          style={{ borderTop: '1px solid var(--token-border)' }}
        >
          {conviction.components.map((c, i) => (
            <div
              key={`${c.label}-${i}`}
              className="flex items-center justify-between px-3 py-2 rounded-lg"
              style={{ background: 'var(--token-surface)' }}
            >
              <span className="text-[11px] text-token-muted">{c.label}</span>
              <span
                className="text-[12px] font-bold"
                style={{ color: c.delta > 0 ? 'var(--t-success)' : c.delta < 0 ? 'var(--t-danger)' : 'var(--token-muted)' }}
              >
                {c.delta > 0 ? '+' : ''}{c.delta}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const Pulse = ({ label, value, color, icon: Icon }) => (
  <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
       style={{ background: 'var(--token-surface)' }}>
    <Icon className="w-4 h-4" style={{ color }} />
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-token-muted">{label}</span>
      <span className="text-[18px] font-bold leading-none" style={{ color }}>{value}</span>
    </div>
  </div>
);

/* ─── LEFT — live flow stream ──────────────────────────────────────────── */
function LiveFlowPanel({ pipeline, stream, decisions24h, selected, onSelect }) {
  const buckets = [
    { key: 'open',        label: 'Open',        icon: CircuitBoard, color: 'var(--t-warning)' },
    { key: 'evaluating',  label: 'Evaluating',  icon: Workflow,     color: 'var(--t-signal)' },
    { key: 'in_progress', label: 'In progress', icon: Activity,     color: 'var(--t-signal)' },
    { key: 'review',      label: 'Review',      icon: Shield,       color: 'var(--t-info)' },
    { key: 'completed',   label: 'Completed',   icon: Sparkles,     color: 'var(--t-success)' },
    { key: 'failed',      label: 'Failed',      icon: Flame,        color: 'var(--t-danger)' },
  ];
  return (
    <Card className="p-4 h-full" testid="live-flow-panel">
      <div className="flex items-center justify-between mb-3">
        <Kicker color="var(--token-primary)">Live module flow</Kicker>
        <span className="text-[10px] text-token-muted">15s pulse</span>
      </div>

      {/* Pipeline counters — projection of /live-flow.pipeline */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {buckets.map(({ key, label, icon: Ic, color }) => (
          <div
            key={key}
            className="px-3 py-2 rounded-lg flex flex-col"
            style={{ background: 'var(--token-surface)', border: '1px solid var(--token-border)' }}
            data-testid={`pipeline-bucket-${key}`}
          >
            <div className="flex items-center gap-1">
              <Ic className="w-3 h-3" style={{ color }} />
              <span className="text-[10px] uppercase tracking-wider text-token-muted">{label}</span>
            </div>
            <span className="text-[20px] font-bold leading-tight" style={{ color }}>
              {pipeline[key] ?? 0}
            </span>
          </div>
        ))}
      </div>

      {/* Stream — last 12 actions, click any module to focus */}
      <div className="text-[11px] uppercase tracking-wider text-token-muted mb-2">
        Recent decisions
      </div>
      <div className="space-y-1.5 max-h-[480px] overflow-auto pr-1" data-testid="cognition-stream">
        {stream.length === 0 && (
          <div className="text-[12px] text-token-muted py-6 text-center">
            <Activity className="w-5 h-5 mx-auto mb-2 opacity-50" />
            No autonomous decisions yet — system is observing.
          </div>
        )}
        {stream.map((s) => {
          const isMod = s.entity_type === 'module';
          const isSelected = isMod && s.entity_id === selected;
          const status = (s.status || '').toLowerCase();
          const dotColor =
            status === 'executed' ? 'var(--t-success)' :
            status.includes('block') || status === 'logged_only' ? 'var(--t-danger)' :
            status === 'failed' ? 'var(--t-danger)' : 'var(--t-warning)';
          return (
            <button
              key={s.log_id}
              onClick={() => isMod && onSelect(s.entity_id)}
              disabled={!isMod}
              data-testid={`stream-item-${s.log_id}`}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-left transition-colors"
              style={{
                background: isSelected ? 'var(--token-primary-tint)' : 'transparent',
                border: `1px solid ${isSelected ? 'var(--token-primary-border)' : 'transparent'}`,
                cursor: isMod ? 'pointer' : 'default',
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ background: dotColor }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold truncate">{s.action_type || 'unknown'}</span>
                  <span
                    className="text-[9px] px-1.5 py-[1px] rounded uppercase tracking-wider font-bold shrink-0"
                    style={{ color: dotColor, background: `${dotColor}1a` }}
                  >
                    {status.replace(/_/g, ' ') || 'pending'}
                  </span>
                </div>
                <div className="text-[10px] text-token-muted truncate">
                  {s.entity_type}:{s.entity_id} · {fmtAgo(s.created_at)}
                </div>
              </div>
              {isMod && <ChevronRight className="w-3.5 h-3.5 text-token-muted shrink-0" />}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/* ─── CENTER — module cognition (WHY) + timeline ribbon ────────────────── */
function CognitionPanel({ why, timeline, selected }) {
  if (!selected) {
    return (
      <Card className="p-6 h-full flex items-center justify-center min-h-[400px]" testid="cognition-empty">
        <div className="text-center">
          <Brain className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <Kicker>Select a module</Kicker>
          <p className="text-[12px] text-token-muted mt-1">
            Pick a decision from the stream<br />to inspect its cognition.
          </p>
        </div>
      </Card>
    );
  }
  if (!why) {
    return (
      <Card className="p-6 h-full flex items-center justify-center min-h-[400px]">
        <div className="text-[12px] text-token-muted">Loading cognition…</div>
      </Card>
    );
  }
  if (why.status === 'not_found') {
    return (
      <Card className="p-6 h-full">
        <Kicker color="var(--t-danger)">Module not found</Kicker>
        <p className="text-[12px] text-token-muted mt-1">{selected}</p>
      </Card>
    );
  }
  const verdict = why.verdict || 'OPEN';
  const vs = verdictStyle(verdict);
  const VIcon = vs.icon;
  const bs = bandStyle(why.confidence_band || 'forming');
  return (
    <Card className="p-4 h-full" testid="cognition-panel">
      <div className="flex items-center justify-between mb-2">
        <Kicker color="var(--token-primary)">Module cognition</Kicker>
        <span
          className="inline-flex items-center gap-1 px-2 py-[2px] rounded text-[10px] font-bold tracking-wider"
          style={{ color: vs.color, background: `${vs.color}1a`, border: `1px solid ${vs.color}33` }}
          data-testid="cognition-verdict"
        >
          <VIcon className="w-3 h-3" />
          {verdict}
        </span>
      </div>

      <h3 className="text-[15px] font-bold leading-tight">{why.module_name}</h3>
      <p className="text-[11px] text-token-muted mt-0.5">module:{why.module_id} · {why.module_status}</p>

      {/* Assignee strip */}
      {why.assignee && (
        <div
          className="mt-3 flex items-center gap-3 px-3 py-2 rounded-lg"
          style={{ background: 'var(--token-surface)', border: '1px solid var(--token-border)' }}
        >
          <div className="w-8 h-8 rounded-full flex items-center justify-center"
               style={{ background: 'var(--token-primary-tint)' }}>
            <span className="text-[12px] font-bold text-token-primary">
              {(why.assignee.name || '?').slice(0, 1).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-semibold truncate">{why.assignee.name}</div>
            <div className="text-[10px] text-token-muted truncate">
              {why.assignee.level || '—'} · rating {why.assignee.rating ?? '—'} · load {why.assignee.active_load ?? 0}h
            </div>
          </div>
        </div>
      )}

      {/* Confidence band */}
      <div
        className="mt-3 px-3 py-2 rounded-lg flex items-center gap-2"
        style={{ background: bs.glow, border: `1px solid ${bs.color}33` }}
      >
        <Brain className="w-3.5 h-3.5" style={{ color: bs.color }} />
        <span className="text-[10px] uppercase tracking-wider text-token-muted">
          Execution confidence
        </span>
        <span className="ml-auto text-[12px] font-bold" style={{ color: bs.color }}>
          {bs.label}
        </span>
      </div>

      {/* Drivers — structured */}
      <div className="mt-4">
        <Kicker>Why · structured drivers</Kicker>
        {why.drivers?.length ? (
          <div className="space-y-2" data-testid="why-drivers">
            {why.drivers.map((d, i) => (
              <DriverRow key={`${d.driver}-${i}`} d={d} />
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-token-muted">
            No drivers detected — orchestration treated this module as nominal.
          </p>
        )}
      </div>

      {/* P2.1 — Cognition continuity timeline ribbon */}
      <TimelineRibbon timeline={timeline} />
    </Card>
  );
}

/* ─── Timeline ribbon (P2.1) — vertical stepper of phases ──────────────── */
const PHASE_META = {
  created:         { label: 'Created',         icon: Sparkles,    band: 'building'   },
  evaluating:      { label: 'Evaluating',      icon: Workflow,    band: 'building'   },
  assigned:        { label: 'Assigned',        icon: UserCheck,   band: 'building'   },
  in_flight:       { label: 'In flight',       icon: Activity,    band: 'building'   },
  qa_review:       { label: 'QA review',       icon: Shield,      band: 'building'   },
  qa_passed:       { label: 'QA passed',       icon: ShieldOff,   band: 'strong'     },
  qa_rejected:     { label: 'QA rejected',     icon: ShieldOff,   band: 'weak'       },
  revision:        { label: 'Revision',        icon: RotateCcw,   band: 'weak'       },
  signal_collapse: { label: 'Signal collapse', icon: TrendingDown, band: 'collapsing' },
  suppressed:      { label: 'Suppressed',      icon: Ban,         band: 'collapsing' },
  reassigned:      { label: 'Reassigned',      icon: GitBranch,   band: 'weak'       },
  escalated:       { label: 'Escalated',       icon: AlertTriangle, band: 'collapsing' },
  completed:       { label: 'Completed',       icon: Sparkles,    band: 'strong'     },
  failed:          { label: 'Failed',          icon: Flame,       band: 'collapsing' },
  rejected:        { label: 'Rejected',        icon: ShieldOff,   band: 'collapsing' },
};

function TimelineRibbon({ timeline }) {
  if (!timeline) {
    return (
      <div className="mt-4">
        <Kicker>Continuity</Kicker>
        <p className="text-[12px] text-token-muted">Loading timeline…</p>
      </div>
    );
  }
  if (timeline.status !== 'active' || !timeline.timeline?.length) {
    return (
      <div className="mt-4">
        <Kicker>Continuity</Kicker>
        <div
          className="px-3 py-3 rounded-lg flex items-center gap-2 text-[12px] text-token-muted"
          style={{ background: 'var(--token-surface)', border: '1px solid var(--token-border)' }}
          data-testid="timeline-empty"
        >
          <Clock className="w-3.5 h-3.5 opacity-60" />
          {timeline.reason || 'Timeline forming — no phase signals yet.'}
        </div>
      </div>
    );
  }
  const events = timeline.timeline;
  return (
    <div className="mt-4" data-testid="timeline-ribbon">
      <div className="flex items-center justify-between mb-2">
        <Kicker>Continuity · reasoning evolution</Kicker>
        <span
          className="text-[9px] font-bold tracking-wider px-1.5 py-[1px] rounded uppercase"
          style={{
            color: bandStyle(PHASE_META[timeline.current_phase]?.band || 'forming').color,
            background: bandStyle(PHASE_META[timeline.current_phase]?.band || 'forming').glow,
          }}
        >
          {PHASE_META[timeline.current_phase]?.label || timeline.current_phase}
        </span>
      </div>
      <div className="relative pl-4 space-y-3" style={{
        borderLeft: '1px dashed var(--token-border)',
      }}>
        {events.map((ev, i) => {
          const meta = PHASE_META[ev.phase] || { label: ev.phase, icon: Radio, band: 'forming' };
          const bs = bandStyle(meta.band);
          const Ic = meta.icon;
          const isLast = i === events.length - 1;
          return (
            <div key={`${ev.phase}-${i}-${ev.at}`} className="relative" data-testid={`timeline-phase-${ev.phase}`}>
              <span
                className="absolute -left-[21px] top-[2px] w-3 h-3 rounded-full flex items-center justify-center"
                style={{
                  background: bs.color,
                  boxShadow: isLast ? '0 0 0 4px var(--token-surface-elevated)' : 'none',
                  border: '2px solid var(--token-surface-elevated)',
                }}
              />
              <div className="flex items-center gap-2 flex-wrap">
                <Ic className="w-3.5 h-3.5" style={{ color: bs.color }} />
                <span className="text-[12px] font-semibold">{meta.label}</span>
                {ev.source === 'cognition_event' && (
                  <span
                    className="text-[9px] font-bold tracking-wider px-1.5 py-[1px] rounded uppercase"
                    style={{
                      color: 'var(--t-danger)',
                      background: 'rgba(239,68,68,.12)',
                      border: '1px solid rgba(239,68,68,.3)',
                    }}
                    title="Persisted cognition event (not derived)"
                  >
                    detected
                  </span>
                )}
                {ev.trigger && (
                  <span className="text-[10px] text-token-muted font-mono">
                    trigger: {ev.trigger}
                  </span>
                )}
                <span className="text-[10px] text-token-muted ml-auto">{fmtAgo(ev.at)}</span>
              </div>
              {ev.drivers?.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {ev.drivers.slice(0, 4).map((d, di) => (
                    <span
                      key={di}
                      className="text-[10px] px-1.5 py-[1px] rounded font-mono"
                      style={{
                        color: sevColor(d.severity),
                        background: 'var(--token-surface)',
                        border: '1px solid var(--token-border)',
                      }}
                    >
                      {d.driver}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const DriverRow = ({ d }) => {
  const c = sevColor(d.severity);
  const positive = (d.impact ?? 0) >= 0;
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-lg"
      style={{ background: 'var(--token-surface)', border: '1px solid var(--token-border)' }}
      data-testid={`driver-${d.driver}`}
    >
      <span className="w-2 h-2 rounded-full" style={{ background: c }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold">{d.label}</span>
          <span
            className="text-[9px] px-1.5 py-[1px] rounded uppercase tracking-wider font-bold"
            style={{ color: c, background: `${c}1a` }}
          >
            {d.severity}
          </span>
        </div>
        <div className="text-[10px] text-token-muted font-mono">
          {d.driver} · value {String(d.value)}
        </div>
      </div>
      <span
        className="text-[12px] font-bold tabular-nums"
        style={{ color: positive ? 'var(--t-success)' : 'var(--t-danger)' }}
      >
        {positive ? '+' : ''}{(d.impact ?? 0).toFixed(2)}
      </span>
    </div>
  );
};

/* ─── RIGHT — Parallel Universes ───────────────────────────────────────── */
function UniversesPanel({ universes, selected }) {
  if (!selected) {
    return (
      <Card className="p-6 h-full flex items-center justify-center min-h-[400px]" testid="universes-empty">
        <div className="text-center">
          <GitBranch className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <Kicker>Parallel universes</Kicker>
          <p className="text-[12px] text-token-muted mt-1">
            Select a module to compare<br />naive vs protected staffing.
          </p>
        </div>
      </Card>
    );
  }
  if (!universes) {
    return (
      <Card className="p-6 h-full flex items-center justify-center min-h-[400px]">
        <div className="text-[12px] text-token-muted">Computing universes…</div>
      </Card>
    );
  }
  if (universes.status !== 'active') {
    return (
      <Card className="p-6 h-full">
        <Kicker color="var(--t-warning)">Universes forming</Kicker>
        <p className="text-[12px] text-token-muted mt-1">
          {universes.reason || 'Insufficient developer pool to derive universes.'}
        </p>
      </Card>
    );
  }
  const a = universes.universe_a;
  const b = universes.universe_b;
  const diverged = universes.diverged;
  return (
    <Card className="p-4 h-full" testid="universes-panel">
      <div className="flex items-center justify-between mb-2">
        <Kicker color="var(--token-primary)">Parallel universes</Kicker>
        <span
          className="inline-flex items-center gap-1 px-2 py-[2px] rounded text-[10px] font-bold tracking-wider"
          style={{
            color: diverged ? 'var(--t-signal)' : 'var(--token-muted)',
            background: diverged ? 'rgba(6,182,212,.12)' : 'transparent',
            border: `1px solid ${diverged ? 'rgba(6,182,212,.4)' : 'var(--token-border)'}`,
          }}
        >
          <GitBranch className="w-3 h-3" />
          {diverged ? 'DIVERGED' : 'AGREED'}
        </span>
      </div>
      <p className="text-[11px] text-token-muted mb-3">
        {diverged
          ? 'Protected orchestration chose a different developer than the naive optimum.'
          : 'Naive pick already passes protective gates — same developer.'}
      </p>

      {/* Universe A — naive */}
      <UniverseCard
        kicker="Universe A · Naive"
        kickerColor="var(--t-warning)"
        title={a.pick.name}
        subtitle={`${a.pick.level || '—'} · rating ${a.pick.rating ?? '—'} · load ${a.pick.active_load ?? 0}h`}
        eta={a.estimated_completion_hours}
        risk={a.risk}
        items={a.risks}
        itemIcon={AlertTriangle}
        itemColor="var(--t-danger)"
        rawScore={a.raw_score}
        testid="universe-a"
      />

      <div className="my-2 flex items-center justify-center text-token-muted">
        <ArrowRight className="w-4 h-4" />
      </div>

      {/* Universe B — protected */}
      <UniverseCard
        kicker="Universe B · Protected"
        kickerColor="var(--t-success)"
        title={b.pick.name}
        subtitle={`${b.pick.level || '—'} · rating ${b.pick.rating ?? '—'} · load ${b.pick.active_load ?? 0}h`}
        eta={b.estimated_completion_hours}
        risk={null}
        items={b.protections}
        itemIcon={Shield}
        itemColor="var(--t-success)"
        rawScore={b.raw_score}
        testid="universe-b"
      />
    </Card>
  );
}

const UniverseCard = ({ kicker, kickerColor, title, subtitle, eta, risk,
                        items, itemIcon: ItemIcon, itemColor, rawScore, testid }) => (
  <div
    className="p-3 rounded-lg"
    style={{ background: 'var(--token-surface)', border: '1px solid var(--token-border)' }}
    data-testid={testid}
  >
    <div className="flex items-center justify-between">
      <Kicker color={kickerColor}>{kicker}</Kicker>
      {risk && (
        <span
          className="text-[9px] font-bold tracking-wider px-1.5 py-[1px] rounded uppercase"
          style={{
            color: risk === 'HIGH' ? 'var(--t-danger)' : risk === 'MEDIUM' ? 'var(--t-warning)' : 'var(--t-success)',
            background: risk === 'HIGH' ? 'rgba(239,68,68,.12)' : risk === 'MEDIUM' ? 'rgba(245,158,11,.12)' : 'rgba(16,185,129,.12)',
          }}
        >
          {risk} risk
        </span>
      )}
    </div>
    <div className="text-[14px] font-bold">{title}</div>
    <div className="text-[10px] text-token-muted mb-2">{subtitle}</div>
    <Stat label="Estimated completion" value={`${eta}h`} accent="var(--token-primary)" />
    <Stat label="Engine score" value={rawScore} accent="var(--token-muted)" />
    {items?.length > 0 && (
      <ul className="mt-2 space-y-1">
        {items.map((t, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px]" style={{ color: 'var(--token-secondary)' }}>
            <ItemIcon className="w-3 h-3 mt-0.5 shrink-0" style={{ color: itemColor }} />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
);

/* ─── BOTTOM — Suppression feed (the moat) ─────────────────────────────── */
function SuppressionsPanel({ data, overrides, onOverride }) {
  // Filter out suppressions that have been overridden — single source of truth.
  const overriddenActionIds = new Set(
    (overrides?.items || []).map((ov) => ov.action_id)
  );
  const items = (data?.items || []).filter(
    (it) => !overriddenActionIds.has(it.log_id)
  );
  const activeCount = items.length;
  return (
    <Card className="p-4" testid="suppressions-panel">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Ban className="w-4 h-4" style={{ color: 'var(--t-danger)' }} />
          <Kicker color="var(--t-danger)">Suppressed executions · what AI refused to do</Kicker>
        </div>
        <span
          className="text-[10px] font-bold px-2 py-[2px] rounded uppercase tracking-wider"
          style={{
            color: 'var(--t-danger)',
            background: 'rgba(239,68,68,.12)',
            border: '1px solid rgba(239,68,68,.3)',
          }}
        >
          {activeCount} active
        </span>
      </div>
      {(data?.status !== 'active' || activeCount === 0) && (
        <div className="text-[12px] text-token-muted py-6 text-center">
          <Shield className="w-5 h-5 mx-auto mb-2 opacity-50" />
          {activeCount === 0 && data?.status === 'active'
            ? 'All suppressions have been reviewed by an operator.'
            : (data?.reason || 'No suppressed decisions in window.')}
        </div>
      )}
      {data?.status === 'active' && activeCount > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2" data-testid="suppression-items">
          {items.map((it) => (
            <div
              key={it.log_id}
              className="p-3 rounded-lg flex flex-col"
              style={{
                background: 'var(--token-surface)',
                border: '1px solid var(--token-border)',
                borderLeft: '3px solid var(--t-danger)',
              }}
              data-testid={`suppression-${it.log_id}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold">{it.action}</span>
                <span className="text-[10px] text-token-muted">{fmtAgo(it.decided_at)}</span>
              </div>
              <div className="text-[10px] text-token-muted font-mono mb-2">{it.entity}</div>
              <div className="space-y-1 mb-3">
                {it.drivers.map((d, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: sevColor(d.severity) }} />
                    <span className="text-[11px]">{d.label}</span>
                    <span
                      className="ml-auto text-[9px] uppercase tracking-wider font-bold"
                      style={{ color: sevColor(d.severity) }}
                    >
                      {d.severity}
                    </span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => onOverride && onOverride(it)}
                className="mt-auto inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors"
                style={{
                  color: 'var(--t-warning)',
                  background: 'rgba(245,158,11,.08)',
                  border: '1px solid rgba(245,158,11,.3)',
                }}
                data-testid={`override-btn-${it.log_id}`}
              >
                <Hammer className="w-3 h-3" />
                Operator override
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ─── Override modal — P2.2 ────────────────────────────────────────────── */
function OverrideModal({ target, onClose, onSubmitted }) {
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  const reasonValid = reason.trim().length >= 20;
  const canSubmit = reasonValid && acknowledged && !submitting;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    try {
      await axios.post(
        `${API}/execution-intelligence/override/${target.log_id}`,
        { reason: reason.trim(), acknowledged_risk: true },
        { withCredentials: true },
      );
      onSubmitted();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Override failed.');
      setSubmitting(false);
    }
  }, [canSubmit, reason, target, onSubmitted]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.6)' }}
      onClick={onClose}
      data-testid="override-modal"
    >
      <div
        className="w-full max-w-lg rounded-xl"
        style={{
          background: 'var(--token-surface-elevated)',
          border: '1px solid var(--token-border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--token-border)' }}
        >
          <div className="flex items-center gap-2">
            <Hammer className="w-4 h-4" style={{ color: 'var(--t-warning)' }} />
            <h3 className="text-[15px] font-bold">Operator override</h3>
          </div>
          <button
            onClick={onClose}
            className="text-token-muted hover:text-token-primary"
            data-testid="override-close-btn"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Suppression context */}
          <div
            className="p-3 rounded-lg"
            style={{
              background: 'rgba(239,68,68,.06)',
              border: '1px solid rgba(239,68,68,.25)',
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold">{target.action}</span>
              <span className="text-[10px] text-token-muted font-mono">{target.entity}</span>
            </div>
            <div className="mt-2 space-y-1">
              {(target.drivers || []).map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: sevColor(d.severity) }} />
                  <span className="text-[11px]">{d.label}</span>
                  <span
                    className="ml-auto text-[9px] uppercase tracking-wider font-bold"
                    style={{ color: sevColor(d.severity) }}
                  >
                    {d.severity}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Reason */}
          <div>
            <Kicker>Override reason · required</Kicker>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="Why do you disagree with the suppression? Be specific — this is recorded as institutional memory."
              className="w-full px-3 py-2 rounded-lg text-[13px]"
              style={{
                background: 'var(--token-surface)',
                color: 'var(--token-primary)',
                border: `1px solid ${reason.length > 0 && !reasonValid ? 'var(--t-danger)' : 'var(--token-border)'}`,
                outline: 'none',
              }}
              data-testid="override-reason-input"
            />
            <p className="text-[10px] text-token-muted mt-1">
              {reason.length}/20 minimum chars{reasonValid ? ' ✓' : ''}
            </p>
          </div>

          {/* Risk acknowledgement */}
          <label
            className="flex items-start gap-2 cursor-pointer p-3 rounded-lg"
            style={{
              background: 'var(--token-surface)',
              border: '1px solid var(--token-border)',
            }}
          >
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-1"
              data-testid="override-ack-checkbox"
            />
            <div>
              <div className="text-[12px] font-semibold flex items-center gap-1.5">
                <CircleAlert className="w-3.5 h-3.5" style={{ color: 'var(--t-warning)' }} />
                I acknowledge the suppression risk
              </div>
              <p className="text-[10px] text-token-muted mt-0.5">
                The system flagged this action as risky. Outcome attribution will be recorded
                against me as the override operator.
              </p>
            </div>
          </label>

          {err && (
            <div
              className="px-3 py-2 rounded-lg text-[12px]"
              style={{
                color: 'var(--t-danger)',
                background: 'rgba(239,68,68,.08)',
                border: '1px solid rgba(239,68,68,.3)',
              }}
            >
              {err}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 px-5 py-3"
          style={{ borderTop: '1px solid var(--token-border)' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[12px] font-semibold"
            style={{ color: 'var(--token-muted)', background: 'transparent' }}
            data-testid="override-cancel-btn"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors"
            style={{
              color: canSubmit ? 'var(--t-warning-ink)' : 'var(--token-muted)',
              background: canSubmit ? 'var(--t-warning)' : 'var(--token-surface)',
              border: '1px solid ' + (canSubmit ? 'var(--t-warning)' : 'var(--token-border)'),
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
            data-testid="override-submit-btn"
          >
            {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Hammer className="w-3 h-3" />}
            {submitting ? 'Recording…' : 'Override suppression'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── BOTTOM — AI memory (with override attribution chain) ─────────────── */
function MemoryPanel({ data, overrides }) {
  const ovItems = (overrides?.items) || [];
  const memItems = (data?.decisions) || [];
  const hasAny = ovItems.length > 0 || memItems.length > 0;
  return (
    <Card className="p-4" testid="memory-panel">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-token-primary" />
        <Kicker color="var(--token-primary)">AI memory · last orchestration outcomes</Kicker>
      </div>
      {!hasAny && (
        <div className="text-[12px] text-token-muted py-6 text-center">
          {data?.reason || 'Memory is forming.'}
        </div>
      )}
      {hasAny && (
        <div className="space-y-1.5 max-h-[420px] overflow-auto pr-1" data-testid="memory-items">
          {/* Override attribution chain — first, because they carry institutional memory */}
          {ovItems.map((ov) => <OverrideMemoryRow key={ov.override_id} ov={ov} />)}
          {/* Standard system memory */}
          {memItems.map((d) => {
            const oc = (d.outcome || '').toLowerCase();
            const color =
              oc === 'completed' || oc === 'executed' ? 'var(--t-success)' :
              oc === 'failed' || oc === 'rejected' ? 'var(--t-danger)' :
              oc === 'suppressed' ? 'var(--t-warning)' :
              'var(--token-muted)';
            return (
              <div
                key={d.log_id}
                className="flex items-center gap-2 px-2 py-2 rounded-md"
                style={{ background: 'var(--token-surface)' }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold truncate">{d.action}</div>
                  <div className="text-[10px] text-token-muted truncate font-mono">{d.entity}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color }}>
                    {d.outcome}
                  </div>
                  <div className="text-[9px] text-token-muted">{fmtAgo(d.decided_at)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

const OverrideMemoryRow = ({ ov }) => {
  const verdict = ov.outcome?.verdict || 'pending';
  const verdictColor =
    verdict === 'operator_was_correct' ? 'var(--t-success)' :
    verdict === 'suppression_was_justified' ? 'var(--t-danger)' :
    verdict === 'neutral' ? 'var(--t-warning)' :
    'var(--token-muted)';
  const verdictLabel =
    verdict === 'operator_was_correct' ? 'Operator correct' :
    verdict === 'suppression_was_justified' ? 'Suppression justified' :
    verdict === 'neutral' ? 'Mixed outcome' :
    'Outcome pending';
  return (
    <div
      className="px-3 py-2.5 rounded-md"
      style={{
        background: 'var(--token-surface)',
        border: '1px solid var(--token-border)',
        borderLeft: `3px solid ${verdictColor}`,
      }}
      data-testid={`override-memory-${ov.override_id}`}
    >
      {/* Chain: AI suppressed → Operator overrode → Result */}
      <div className="flex items-center gap-1 text-[11px] flex-wrap">
        <span className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--t-danger)' }}>
          <Ban className="w-3 h-3" />AI suppressed
        </span>
        <ArrowRight className="w-3 h-3 text-token-muted" />
        <span className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--t-warning)' }}>
          <Hammer className="w-3 h-3" />Operator overrode
        </span>
        <ArrowRight className="w-3 h-3 text-token-muted" />
        <span className="inline-flex items-center gap-1 font-bold uppercase tracking-wider text-[10px]" style={{ color: verdictColor }}>
          <Undo2 className="w-3 h-3" />{verdictLabel}
        </span>
        <span className="ml-auto text-[9px] text-token-muted">{fmtAgo(ov.created_at)}</span>
      </div>
      <div className="mt-1.5 text-[11px] font-semibold">
        {ov.target?.action_type} <span className="text-token-muted font-mono">· {ov.target?.entity_type}:{ov.target?.entity_id}</span>
      </div>
      {ov.reason && (
        <div className="mt-1 text-[11px] text-token-muted italic line-clamp-2">
          "{ov.reason}"
        </div>
      )}
      {ov.outcome?.rationale?.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {ov.outcome.rationale.slice(0, 3).map((r, i) => (
            <li key={i} className="text-[10px] text-token-muted flex items-start gap-1">
              <span className="text-token-muted">•</span>{r}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1 text-[9px] text-token-muted font-mono">
        operator: {ov.operator?.email || '—'}
      </div>
    </div>
  );
};


/* ─── P2.3-lite — Pattern Memory ────────────────────────────────────────
 *
 * Cross-module organizational memory for recurring DECISION patterns.
 * NOT analytics. NOT charts. NOT KPIs. Decision-centered cards.
 *
 * Sort comes from backend (decision pressure: contested → operator_dominant
 * → ai_dominant → insufficient). UI never reorders.
 *
 * Attribution shown as BAND (primary). Raw counts surface as a small
 * calibration line at the bottom of each card — never as the headline.
 *
 * Each card carries a temporal humility frame so it never reads as
 * proven truth.
 */
const PATTERN_CATEGORY_META = {
  suppression: { icon: Ban,         label: 'SUPPRESSION', color: 'var(--t-danger)' },
  qa:          { icon: Shield,      label: 'QA',          color: 'var(--t-info)' },
  revision:    { icon: RotateCcw,   label: 'REVISION',    color: 'var(--t-warning)' },
  override:    { icon: Hammer,      label: 'OVERRIDE',    color: 'var(--t-warning)' },
  // NOTE: the `attribution` category was retired together with the backend
  // `_pattern_ai_attribution` detector. Override patterns already carry
  // attribution as their primary band — a separate card produced no new
  // organizational meaning, only duplicate cognition gravity.
};

const ATTRIBUTION_META = {
  contested:         { color: 'var(--t-danger)', label: 'CONTESTED',
                       sub: 'organizational cognition unstable' },
  operator_dominant: { color: 'var(--t-warning)', label: 'OPERATOR DOMINANT',
                       sub: 'operators systematically disagreeing' },
  ai_dominant:       { color: 'var(--t-signal)', label: 'AI DOMINANT',
                       sub: 'system suppression repeatedly upheld' },
  insufficient:      { color: 'var(--token-muted)', label: 'INSUFFICIENT SIGNAL',
                       sub: 'awaiting more outcomes' },
};

/* ─── P3.1 — Causal Trace (compact, scoped to selected module) ──────────
 *
 * Renders the institutional cause-effect chain for the currently-focused
 * module, when one has been opened.  Cardinality is tight by design:
 * usually 2-4 phases shown in a single horizontal row.  No prose, no
 * arrows-as-decoration, no recommendations.
 *
 * The interpretation line is rule-based and short.  `forming` is a
 * legitimate steady-state — chains only open when new cognition events
 * fire (no historical backfill in P3.1).
 *
 * Sits adjacent to Module Cognition / Timeline so the operator can read
 *   "what happened over time"   (Timeline)
 *   "what caused what"          (Causal Trace)
 * as complementary surfaces — not duplicates.
 */
const TRACE_PHASE_META = {
  signal_collapse:       { color: 'var(--t-danger)', label: 'signal collapse',
                           sub: 'cognition collapse detected' },
  suppressed:            { color: 'var(--t-warning)', label: 'suppressed',
                           sub: 'auto-action held pending review' },
  operator_override:     { color: 'var(--t-signal)', label: 'operator override',
                           sub: 'operator challenged the suppression' },
  outcome_pending:       { color: 'var(--token-muted)', label: 'outcome pending',
                           sub: 'no terminal signal yet' },
  outcome_ai_was_right:  { color: 'var(--t-success)', label: 'suppression upheld',
                           sub: 'system judgement vindicated' },
  outcome_operator_was_right: { color: 'var(--t-success)', label: 'operator vindicated',
                                sub: 'operator judgement vindicated' },
  outcome_neutral:       { color: 'var(--token-muted)', label: 'mixed outcome',
                           sub: 'terminal but ambiguous' },
};
function _tracePhaseMeta(phase) {
  return TRACE_PHASE_META[phase]
    || { color: 'var(--token-muted)', label: (phase || 'event').replace(/_/g, ' '),
         sub: '' };
}

function CausalTracePanel({ data, selected }) {
  // No module selected → render nothing.  Causal trace is a context
  // surface, not a standalone widget.
  if (!selected) return null;

  const status = data?.status;
  const chain = data?.chain || [];
  const interp = data?.interpretation;
  const participants = data?.participants || [];
  const closure = data?.closure;
  // P3.3 — Closure label map. Closure is NEVER framed as success/failure.
  // Each label is a single short institutional sentence. No celebration.
  const _closureLabels = {
    stabilized_without_intervention: 'stabilized · suppression held without operator action',
    pressure_cycle_resolved:         'pressure cycle resolved · module reached terminal state after intervention',
    override_produced_instability:   'override followed by downstream instability',
    pressure_dissipated:             'pressure dissipated · cognition collapse never escalated',
    outcome_unresolved:              'outcome unresolved · chain quieted without a clear signal',
  };

  // When the chain is closed we still want to show its accumulated phases
  // exactly as before. Treat "closed" as a render-equivalent of "active"
  // (chain is the surface; closure is a muted single-line annotation).
  const renderChain = status === 'active' || status === 'closed';

  return (
    <Card className="p-4" testid="causal-trace-panel">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-token-primary" />
          <Kicker color="var(--token-primary)">
            Causal trace · institutional cause-effect chain
          </Kicker>
        </div>
        <span className="text-[10px] text-token-muted font-mono">
          scope: this module · refreshes every 60s
        </span>
      </div>

      {/* P3.3 — Closure chip. Single muted line, never a banner, never
          green/red colored, never celebrated. Closure is a state transition,
          not a moral judgment. Hidden when the chain is still active. */}
      {closure && (
        <div
          className="mb-2 text-[10px] text-token-muted font-mono"
          data-testid={`causal-trace-closure-${closure.state}`}
          title={closure.decided_because || ''}
        >
          [ {_closureLabels[closure.state] || closure.state} ]
        </div>
      )}

      {status === 'forming' && (
        <p
          className="text-[11px] text-token-muted italic py-3"
          data-testid="causal-trace-forming"
        >
          {data?.reason
            || 'no causation chain for this module yet — chains open when a new cognition event fires.'}
        </p>
      )}

      {renderChain && chain.length > 0 && (
        <>
          {/* Horizontal phase row — small, dense, glanceable.
              Arrows are STATIC (no animation, no glow), just structural
              connective tissue. */}
          <div
            className="flex items-stretch gap-2 overflow-x-auto pb-1"
            data-testid="causal-trace-chain"
          >
            {chain.map((ev, i) => {
              const meta = _tracePhaseMeta(ev.phase);
              return (
                <div key={`${ev.phase}-${i}`} className="flex items-stretch gap-2">
                  <div
                    className="px-3 py-2 rounded-md min-w-[150px]"
                    data-testid={`causal-trace-phase-${ev.phase}`}
                    style={{
                      background: 'var(--token-surface)',
                      border: '1px solid var(--token-border)',
                      borderTop: `2px solid ${meta.color}`,
                    }}
                  >
                    <Kicker color={meta.color}>{meta.label}</Kicker>
                    {meta.sub && (
                      <p className="text-[10px] text-token-muted leading-tight mt-0.5 italic">
                        {meta.sub}
                      </p>
                    )}
                    {ev.drivers?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {ev.drivers.map((d, j) => (
                          <span key={j}
                                className="text-[9px] px-1 rounded-sm font-mono"
                                style={{
                                  background: 'var(--token-surface-elevated)',
                                  color: 'var(--token-muted)',
                                }}>
                            {d.driver}·{d.severity?.[0]}
                          </span>
                        ))}
                      </div>
                    )}
                    {ev.reason && (
                      <p
                        className="text-[10px] text-token-primary mt-1 leading-snug"
                        style={{
                          overflow: 'hidden', display: '-webkit-box',
                          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        }}
                        title={ev.reason}
                      >
                        “{ev.reason}”
                      </p>
                    )}
                  </div>
                  {i < chain.length - 1 && (
                    <ChevronRight
                      className="w-3.5 h-3.5 self-center text-token-muted opacity-50 flex-shrink-0"
                      aria-hidden
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Rule-based interpretation — short, factual, no AI prose. */}
          {interp && (
            <p
              className="mt-3 text-[11px] text-token-muted italic leading-relaxed"
              data-testid="causal-trace-interpretation"
            >
              {interp}
            </p>
          )}

          {/* P3.2 — Multi-Entity Causation (trace augmentation).
              Pressure propagated into adjacent organizational entities.
              Visual weight INTENTIONALLY lower than the chain — this is
              context, not the primary signal. No graph, no network, no
              expander. Just a flat list of explicit propagation edges.
              Hidden entirely when no participants attached. */}
          {participants.length > 0 && (
            <div
              className="mt-3 pt-3"
              style={{ borderTop: '1px dashed var(--token-border)' }}
              data-testid="causal-trace-participants"
            >
              <p className="text-[10px] uppercase tracking-wide text-token-muted mb-1.5 font-mono">
                pressure propagated into
              </p>
              <div className="flex flex-wrap gap-1.5">
                {participants.map((p, i) => (
                  <span
                    key={`${p.type}-${p.id}-${p.role}-${i}`}
                    className="text-[10px] px-2 py-0.5 rounded-sm font-mono inline-flex items-center gap-1.5"
                    style={{
                      background: 'var(--token-surface-elevated)',
                      color: 'var(--token-muted)',
                      border: '1px solid var(--token-border)',
                    }}
                    title={`${p.type} · ${p.role}`}
                    data-testid={`causal-participant-${p.type}-${p.role}`}
                  >
                    <span style={{ opacity: 0.55 }}>
                      {p.type === 'project' ? 'Project'
                        : p.type === 'developer' ? 'Developer'
                        : p.type === 'skill_stack' ? 'Skill cluster'
                        : p.type}
                      :
                    </span>
                    <span>{p.label || p.id}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}


function PatternMemoryPanel({ data, onOpenModule }) {
  const status = data?.status;
  const patterns = data?.patterns || [];
  const window = data?.window_days || 14;
  const suppressed = data?.suppressed_count || 0;
  // Provenance — surfaced honestly when replayed tissue dominates the
  // window. Below 0.5 the cognition rests mostly on organic signal and
  // the ribbon disappears on its own. Never shown as a percentage.
  const provenance = data?.provenance;
  const replayShare = provenance?.replay_share ?? 0;
  const showReplayRibbon = replayShare >= 0.5
    && (provenance?.replayed ?? 0) > 0;
  return (
    <Card className="p-4" testid="pattern-memory-panel">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-token-primary" />
          <Kicker color="var(--token-primary)">
            Pattern memory · cross-module organizational signals
          </Kicker>
        </div>
        <span className="text-[10px] text-token-muted font-mono">
          last {window}d · refreshes every 60s
        </span>
      </div>

      {/* Replay-provenance ribbon — institutional honesty layer.
          Surfaces only when the cognition layer rests mostly on
          replayed tissue. Visual weight is intentionally low so it
          reads as a footnote, not an alert. Never numeric — band only. */}
      {showReplayRibbon && (
        <div
          className="mb-3 px-3 py-1.5 rounded-md text-[10px] flex items-center gap-2"
          style={{
            background: 'var(--token-surface-elevated)',
            border: '1px dashed var(--token-border)',
            color: 'var(--token-muted)',
          }}
          data-testid="pattern-replay-ribbon"
        >
          <History className="w-3 h-3 opacity-60" />
          <span className="italic">
            derived from replayed cognition traces · institutional memory still forming
          </span>
        </div>
      )}

      {status !== 'active' && (
        <div className="text-[12px] text-token-muted py-8 text-center">
          <Layers className="w-5 h-5 mx-auto mb-2 opacity-50" />
          {data?.reason
            || `Pattern memory is forming — no recurring decision patterns yet across the last ${window} days.`}
        </div>
      )}

      {status === 'active' && patterns.length > 0 && (
        <>
          <div
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"
            data-testid="pattern-cards"
          >
            {patterns.map((p) => (
              <PatternCard key={p.pattern_id} p={p} onOpenModule={onOpenModule} />
            ))}
          </div>
          {/* Suppressed-count footer — intentionally muted, intentionally
              non-expandable. Pattern Memory is institutional cognition,
              not a list to scroll. Anything beyond the cap means the
              organization is producing more pressure than 7 cards can
              hold weight for; surfacing more would dilute meaning. */}
          {suppressed > 0 && (
            <p
              className="mt-3 text-[9px] text-token-muted italic font-mono"
              data-testid="pattern-suppressed-count"
            >
              +{suppressed} pattern{suppressed === 1 ? '' : 's'} under threshold
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function PatternCard({ p, onOpenModule }) {
  const cat  = PATTERN_CATEGORY_META[p.category]
            || { icon: Activity, label: p.category?.toUpperCase() || '—',
                 color: 'var(--token-muted)' };
  const attr = ATTRIBUTION_META[p.attribution?.band || 'insufficient'];
  const CatIcon = cat.icon;
  // Calibration tooltip — secondary only, never a headline.
  const calibration = (() => {
    const a = p.attribution || {};
    if (!a.total) return null;
    const parts = [];
    if (a.ai_was_right)      parts.push(`AI: ${a.ai_was_right} right`);
    if (a.operator_was_right) parts.push(`Operator: ${a.operator_was_right} right`);
    if (a.neutral)           parts.push(`${a.neutral} neutral`);
    if (a.pending)           parts.push(`${a.pending} pending`);
    return parts.join(' · ');
  })();

  return (
    <div
      className="p-3 rounded-lg flex flex-col"
      style={{
        background: 'var(--token-surface)',
        border: '1px solid var(--token-border)',
        borderLeft: `3px solid ${attr.color}`,
      }}
      data-testid={`pattern-${p.pattern_id}`}
    >
      {/* Header: category + occurrences (small, secondary) */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <CatIcon className="w-3.5 h-3.5" style={{ color: cat.color }} />
          <span
            className="text-[9px] uppercase tracking-wider font-bold"
            style={{ color: cat.color }}
          >
            {cat.label}
          </span>
        </div>
        <span
          className="text-[10px] text-token-muted font-mono"
          title={`${p.occurrences} occurrences in ${p.window_days || 14} days`}
        >
          {p.occurrences}× · {p.window_days || 14}d
        </span>
      </div>

      {/* Title — short, decision-centered, no prose */}
      <h4 className="text-[13px] font-bold mt-1.5 leading-tight">{p.title}</h4>

      {/* Temporal humility frame — never reads as proven truth */}
      <p className="text-[10px] text-token-muted italic mt-0.5">{p.humility}</p>

      {/* Attribution band — PRIMARY signal */}
      <div
        className="mt-2 px-2 py-1.5 rounded-md flex flex-col gap-0.5"
        style={{
          background: `${attr.color}14`,
          border: `1px solid ${attr.color}33`,
        }}
        title={calibration || ''}
        data-testid={`pattern-band-${p.attribution?.band || 'insufficient'}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-[10px] font-bold tracking-wider"
            style={{ color: attr.color }}
          >
            {attr.label}
          </span>
        </div>
        <span className="text-[9px] text-token-muted">{attr.sub}</span>
      </div>

      {/* Drivers — structured, NOT prose */}
      {p.drivers?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {p.drivers.map((d, i) => (
            <span
              key={i}
              className="text-[10px] px-1.5 py-[1px] rounded font-mono"
              style={{
                color: sevColor(d.severity),
                background: 'var(--token-surface-elevated)',
                border: '1px solid var(--token-border)',
              }}
            >
              {d.driver}
            </span>
          ))}
        </div>
      )}

      {/* Scope footer + deep-link back into cognition (representative module) */}
      <div className="mt-auto pt-2 flex items-center justify-between gap-2">
        <span className="text-[10px] text-token-muted font-mono truncate"
              title={`scope.type=${p.scope?.type} primary=${p.scope?.primary_id}`}>
          {p.scope?.type}: {p.scope?.primary_id}
        </span>
        {p.representative_module_id ? (
          <button
            onClick={() => onOpenModule && onOpenModule(p.representative_module_id)}
            className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-[2px] rounded"
            style={{
              color: 'var(--token-primary)',
              background: 'var(--token-primary-tint)',
              border: '1px solid var(--token-primary-border)',
            }}
            data-testid={`pattern-open-${p.pattern_id}`}
          >
            Open in cognition
            <ChevronRight className="w-3 h-3" />
          </button>
        ) : (
          <span className="text-[9px] text-token-muted italic">no module entry</span>
        )}
      </div>

      {/* Calibration line — secondary, tiny, only when attribution exists */}
      {calibration && (
        <div className="mt-1 text-[9px] text-token-muted font-mono truncate">
          {calibration}
        </div>
      )}
    </div>
  );
}
