/**
 * Admin · Pressure Topology (P2.4) — spatial projection of organizational pressure.
 *
 * NOT a monitoring dashboard.  NOT a heatmap.  NOT a force-graph.
 *
 * Topology is a tertiary cognition layer.  It must read as:
 *     where organizational pressure is accumulating
 * not as:
 *     where many events happened.
 *
 * Hard guardrails baked into this surface:
 *   • Band-first, never numbers-first.  Numeric `occurrences` exists in the
 *     payload for tooltip-grade calibration but is never the headline.
 *   • Sparse > dense.  Empty lanes stay empty — no synthetic clustering,
 *     no "fill the screen" interpolation.  Empty IS the institutional signal.
 *   • One projection axis active at a time.  Switching reloads.  No morphing
 *     animations, no transition theater.
 *   • No glow, no pulse, no orbits, no particles.  Cold structural layout.
 *   • No "Suggested action" / no auto-recommendations.  Operators decide.
 *   • Provenance ribbon is *quieter* than Pattern Memory's — topology is
 *     tertiary, so its honesty subline is one line of muted text, never a box.
 *
 * Refresh: 60s.  Slower than live-flow on purpose — pressure is structural,
 * not telemetric.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API } from '@/App';
import {
  Activity, AlertTriangle, ArrowUpRight, History, Layers,
  Loader2, Map as MapIcon, MoveDown, RefreshCw,
} from 'lucide-react';

const TOPOLOGY_POLL_MS = 60_000;

// Band colour palette is intentionally austere.  No saturation theatre.
const BAND_META = {
  high:     { color: 'var(--t-danger)', label: 'HIGH PRESSURE',
              sub: 'cognition repeatedly struggles here' },
  elevated: { color: 'var(--t-warning)', label: 'ELEVATED',
              sub: 'organizational signal accumulating' },
  forming:  { color: 'var(--t-signal)', label: 'FORMING',
              sub: 'early signal — institutional context still thin' },
  quiet:    { color: 'var(--token-muted)', label: 'QUIET',
              sub: 'no contributing pressure in window' },
};

const SEV_COLOR = {
  high:   'var(--t-danger)',
  medium: 'var(--t-warning)',
  low:    'var(--t-signal)',
};

// Axis switcher.  `projects` is the institutional default for P2.4.
// The other three axes are reachable but resolve to a `forming` payload
// — surfaced to the operator as `axis forming`, never as broken.
const AXES = [
  { key: 'projects',     label: 'Projects',
    note: 'institutional default · governance-centric' },
  { key: 'skill_stacks', label: 'Skill stacks',
    note: 'axis forming · awaiting cross-skill structure' },
  { key: 'developers',   label: 'Developers',
    note: 'axis forming · people-surveillance guardrails pending' },
  { key: 'action_types', label: 'Action types',
    note: 'axis forming · awaiting cross-action attribution depth' },
];

/* ─── tiny atoms ──────────────────────────────────────────────────────── */
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
  <span
    className="text-[10px] uppercase tracking-[0.18em] font-semibold"
    style={{ color: color || 'var(--token-muted)' }}
  >
    {children}
  </span>
);

const SevDot = ({ severity, title }) => (
  <span
    title={title}
    className="inline-block w-1.5 h-1.5 rounded-full"
    style={{ background: SEV_COLOR[severity] || 'var(--token-muted)' }}
  />
);

/* ─── node card ────────────────────────────────────────────────────────── */
function PressureNode({ node, onOpen }) {
  const band = BAND_META[node.band] || BAND_META.quiet;
  const dom = node.dominant_driver;
  return (
    <button
      type="button"
      data-testid={`topology-node-${node.node_id}`}
      onClick={() => onOpen?.(node)}
      className="text-left w-[230px] p-3 rounded-lg transition-colors"
      style={{
        background: 'var(--token-surface)',
        border: '1px solid var(--token-border)',
        borderLeft: `2px solid ${band.color}`,
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <Kicker color={band.color}>{band.label}</Kicker>
      </div>
      <h4
        className="text-[13px] font-medium text-token-primary leading-tight mb-1.5"
        style={{ overflow: 'hidden', display: '-webkit-box',
                 WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
      >
        {node.label}
      </h4>
      {dom ? (
        <p className="text-[10px] text-token-muted mb-1.5">
          <span className="font-mono uppercase tracking-wider">dominant:</span>{' '}
          <span style={{ color: SEV_COLOR[dom.severity] || 'var(--token-muted)' }}>
            {dom.label || dom.driver}
          </span>
        </p>
      ) : (
        <p className="text-[10px] text-token-muted mb-1.5 italic">
          no dominant driver
        </p>
      )}
      {/* Contributing drivers — severity dots, never numbers up front.
          Driver names are tooltip-only to keep the card scannable. */}
      {node.drivers?.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 mt-1.5">
          {node.drivers.map((d) => (
            <span key={d.driver} className="flex items-center gap-1">
              <SevDot
                severity={d.severity}
                title={`${d.label || d.driver} · ${d.severity} · ${d.occurrences}×`}
              />
              <span className="text-[10px] text-token-muted">
                {(d.label || d.driver).split(' ')[0].toLowerCase()}
              </span>
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

/* ─── one swimlane ─────────────────────────────────────────────────────── */
function Swimlane({ lane }) {
  const meta = BAND_META[lane.band] || BAND_META.quiet;
  const isEmpty = lane.count === 0;
  return (
    <div
      data-testid={`topology-lane-${lane.band}`}
      className="grid gap-4 py-3"
      style={{
        gridTemplateColumns: '180px 1fr',
        borderTop: '1px solid var(--token-border)',
      }}
    >
      {/* Lane header — band label + sub.  No counts in the headline. */}
      <div className="pl-1">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: meta.color }}
          />
          <Kicker color={meta.color}>{meta.label}</Kicker>
        </div>
        <p className="text-[10px] text-token-muted mt-1 italic leading-tight">
          {meta.sub}
        </p>
      </div>

      {/* Nodes — wrapped, alphabetically ordered by backend. */}
      <div className="flex flex-wrap gap-3 items-start">
        {isEmpty ? (
          <p
            className="text-[11px] text-token-muted italic font-mono pt-1"
            data-testid={`topology-lane-empty-${lane.band}`}
          >
            — no projects at this band —
          </p>
        ) : (
          lane.nodes.map((n) => (
            <PressureNode
              key={n.node_id}
              node={n}
              onOpen={(node) => {
                if (node.representative_module_id) {
                  window.location.hash = `module=${node.representative_module_id}`;
                  window.location.pathname =
                    '/api/web-ui/admin/execution-intelligence';
                }
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ─── axis switcher ────────────────────────────────────────────────────── */
function AxisSwitcher({ current, onChange }) {
  return (
    <div
      className="flex items-center gap-1 p-1 rounded-lg"
      style={{
        background: 'var(--token-surface)',
        border: '1px solid var(--token-border)',
      }}
      data-testid="topology-axis-switcher"
    >
      {AXES.map((a) => {
        const active = a.key === current;
        return (
          <button
            key={a.key}
            type="button"
            title={a.note}
            data-testid={`topology-axis-${a.key}`}
            onClick={() => onChange(a.key)}
            className="px-3 py-1.5 text-[11px] rounded-md transition-colors"
            style={{
              background: active ? 'var(--token-surface-elevated)' : 'transparent',
              color: active ? 'var(--token-primary)' : 'var(--token-muted)',
              border: active
                ? '1px solid var(--token-border)'
                : '1px solid transparent',
              fontWeight: active ? 500 : 400,
            }}
          >
            {a.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─── page ─────────────────────────────────────────────────────────────── */
export default function AdminPressureTopology() {
  const [axis, setAxis] = useState('projects');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const fetchTopology = useCallback(async (a) => {
    try {
      const res = await axios.get(`${API}/execution-intelligence/topology`,
                                  { params: { axis: a }, withCredentials: true });
      setData(res.data);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.message || e.message || 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchTopology(axis);
    const id = setInterval(() => fetchTopology(axis), TOPOLOGY_POLL_MS);
    return () => clearInterval(id);
  }, [axis, fetchTopology]);

  const provenance = data?.provenance;
  const showReplaySubline = (provenance?.replay_share ?? 0) >= 0.5
                            && (provenance?.replayed ?? 0) > 0;

  const status = data?.status;
  const lanes  = useMemo(() => data?.swimlanes || [], [data]);
  const isFormingAxis = status === 'forming' && axis !== 'projects';

  return (
    <div
      className="px-6 py-6 max-w-[1400px] mx-auto"
      data-testid="pressure-topology-page"
    >
      {/* Header — title + axis + window indicator + tiny provenance subline.
          Subline lives directly under the title, never as a banner.  Topology
          is tertiary; provenance must be visible but secondary to the map. */}
      <div className="mb-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <MapIcon className="w-4 h-4 text-token-primary" />
              <h1 className="text-[18px] font-medium text-token-primary leading-tight">
                Pressure Topology
              </h1>
            </div>
            <p className="text-[11px] text-token-muted mt-1 leading-relaxed">
              Spatial projection of organizational pressure · accumulation, not events
            </p>
          </div>
          <div className="flex items-center gap-3">
            <AxisSwitcher current={axis} onChange={setAxis} />
            <button
              type="button"
              data-testid="topology-refresh"
              onClick={() => fetchTopology(axis)}
              className="p-1.5 rounded-md hover:bg-token-surface text-token-muted"
              title="Refresh now"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] text-token-muted font-mono">
              last {data?.window_days || 14}d · refreshes every 60s
            </span>
          </div>
        </div>

        {showReplaySubline && (
          <p
            className="text-[10px] text-token-muted italic mt-2 flex items-center gap-1.5"
            data-testid="topology-replay-subline"
          >
            <History className="w-3 h-3 opacity-60" />
            pressure partially derived from replayed cognition traces
          </p>
        )}
      </div>

      {/* Body */}
      {loading && !data && (
        <Card className="p-8 text-center">
          <Loader2 className="w-4 h-4 mx-auto animate-spin text-token-muted" />
          <p className="text-[11px] text-token-muted mt-2">
            loading topology…
          </p>
        </Card>
      )}

      {error && (
        <Card className="p-4" testid="topology-error">
          <div className="flex items-center gap-2 text-[12px] text-token-primary">
            <AlertTriangle className="w-4 h-4 text-[var(--t-danger)]" />
            {error}
          </div>
        </Card>
      )}

      {!loading && !error && isFormingAxis && (
        <Card className="p-10 text-center" testid="topology-axis-forming">
          <Layers className="w-5 h-5 mx-auto text-token-muted opacity-60" />
          <p className="text-[12px] text-token-primary mt-3">
            {AXES.find((a) => a.key === axis)?.label} axis is forming
          </p>
          <p className="text-[11px] text-token-muted mt-1 italic max-w-[480px] mx-auto leading-relaxed">
            {data?.reason
              || 'This projection will activate when organizational signal accumulates enough cross-axis structure.'}
          </p>
        </Card>
      )}

      {!loading && !error && status === 'active' && lanes.length > 0 && (
        <Card className="px-2 py-1" testid="topology-swimlanes">
          {lanes.map((l) => <Swimlane key={l.band} lane={l} />)}
          {/* Bottom return-to-cognition link — topology is tertiary,
              cognition is the surface where decisions actually live. */}
          <div
            className="px-4 py-3 flex items-center justify-end gap-1.5"
            style={{ borderTop: '1px solid var(--token-border)' }}
          >
            <button
              type="button"
              onClick={() => navigate('/admin/execution-intelligence')}
              className="text-[10px] text-token-muted hover:text-token-primary flex items-center gap-1 font-mono"
            >
              return to cognition console
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </Card>
      )}

      {/* Sparse note when active but zero pressure — empty IS the signal. */}
      {!loading && !error && status === 'active'
        && lanes.every((l) => l.count === 0) && (
        <Card className="p-10 text-center" testid="topology-quiet">
          <MoveDown className="w-4 h-4 mx-auto text-token-muted opacity-60" />
          <p className="text-[12px] text-token-primary mt-3">
            Topology is quiet
          </p>
          <p className="text-[11px] text-token-muted mt-1 italic">
            no contributing organizational pressure across the {data?.window_days || 14}-day window
          </p>
        </Card>
      )}
    </div>
  );
}
