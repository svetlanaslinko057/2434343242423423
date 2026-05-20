/**
 * Execution Intelligence Console — Stage P1/R1
 *
 * Surfaces the cognition that already happens inside EVA-X autonomous
 * loops. Read-only — no actions, no mutations, no fake data.
 *
 * Four layers:
 *   1. Live Flow         — what the orchestration is doing right now
 *   2. Why               — rationale for recent suppression / execution
 *   3. Conviction        — composite confidence with trend + components
 *   4. Memory            — past decisions traced to outcomes
 *
 * Every empty/forming state is honest (no mock).
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../src/api';
import T from '../../src/theme';
import { useAppStatePolling } from '../../src/hooks/useAppStatePolling';

// ─── Types ───────────────────────────────────────────────────────────────
type LiveFlow = {
  pipeline: Record<string, number>;
  velocity_60m: { new_bids: number };
  decisions_24h: { executed: number; suppressed: number; pending_human: number };
  open_events: number;
  stream: Array<{
    log_id?: string;
    action_type?: string;
    entity_type?: string;
    entity_id?: string;
    mode?: string;
    status?: string;
    result?: string;
    created_at?: string;
  }>;
  generated_at: string;
};

type WhyEntry = {
  log_id?: string;
  action: string;
  entity: string;
  decided_at?: string;
  reasons: string[];
  verdict: 'EXECUTED' | 'SUPPRESSED';
};

type Why = {
  status: 'active' | 'forming';
  reason?: string;
  suppressed: WhyEntry[];
  executed: WhyEntry[];
};

type Conviction = {
  score: number;
  trend: 'building' | 'collapsing' | 'stable';
  trend_arrow: 'up' | 'down' | 'flat';
  components: Array<{ label: string; value: number; delta: number }>;
  samples: Record<string, number>;
};

type Memory = {
  status: 'active' | 'forming';
  reason?: string;
  summary?: Record<string, number>;
  decisions: Array<{
    log_id?: string;
    action?: string;
    entity?: string;
    decided_at?: string;
    mode?: string;
    outcome: string;
    outcome_detail?: string | null;
  }>;
};

// ─── Theme tokens ────────────────────────────────────────────────────────
// Phase 3.1c: legacy local admin palette (13 hardcoded hex) replaced by
// aliases into the canonical T design system. All `C.xxx` consumers below
// keep working unchanged; the only difference is values now flow through
// the global theme (live on web via CSS variables, static-at-load on native).
//
// Semantic mapping (no new tokens introduced):
//   bg/surface/border/text      → substrate tokens
//   accent  (was blue       5B8BFF) → T.info       (slate-info, observational)
//   exec    (was green      3DD68C) → T.success    (olive-shifted sage)
//   suppress(was amber      FFB547) → T.warning    (muted ochre)
//   block   (was red        FF6B7A) → T.danger     (restrained oxide)
//   observe (was gray       7A7A92) → T.textMuted
const C = {
  bg: T.bg,
  surface: T.surface1,
  surfaceAlt: T.surface2,
  border: T.border,
  borderHi: T.borderStrong,
  text: T.text,
  textDim: T.textSecondary,
  textFaint: T.textMuted,
  accent: T.info,
  exec: T.success,
  suppress: T.warning,
  block: T.danger,
  observe: T.textMuted,
};

export default function ExecutionConsole() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [flow, setFlow] = useState<LiveFlow | null>(null);
  const [why, setWhy] = useState<Why | null>(null);
  const [conviction, setConviction] = useState<Conviction | null>(null);
  const [memory, setMemory] = useState<Memory | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [f, w, c, m] = await Promise.all([
        api.get('/execution-intelligence/live-flow'),
        api.get('/execution-intelligence/why'),
        api.get('/execution-intelligence/conviction'),
        api.get('/execution-intelligence/memory'),
      ]);
      setFlow(f.data); setWhy(w.data); setConviction(c.data); setMemory(m.data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load execution intelligence');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Light auto-refresh — paused in background and when not focused.
  useAppStatePolling(load, 20000);

  if (loading) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator color={C.accent} />
        <Text style={s.dim}>Reading orchestration state…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 64 }}
      refreshControl={
        <RefreshControl
          tintColor={C.accent}
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
        />
      }
      testID="execution-console"
    >
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn} testID="execution-console-back">
          <Ionicons name="chevron-back" size={20} color={C.textDim} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>EVA-X · ATLAS</Text>
          <Text style={s.title}>Execution Intelligence</Text>
        </View>
        <View style={[s.pulse, conviction && conviction.score >= 65 ? s.pulseHot
                       : conviction && conviction.score < 40 ? s.pulseCold : s.pulseWarm]} />
      </View>

      {error && (
        <View style={[s.card, { borderColor: C.block }]} testID="execution-console-error">
          <Text style={[s.label, { color: C.block }]}>Error</Text>
          <Text style={s.text}>{error}</Text>
        </View>
      )}

      {/* ── LAYER 1 — LIVE FLOW ─────────────────────────────────────── */}
      {flow && <LiveFlowSection data={flow} />}

      {/* ── LAYER 3 — CONVICTION (above Why for hierarchy) ──────────── */}
      {conviction && <ConvictionSection data={conviction} />}

      {/* ── LAYER 2 — WHY ───────────────────────────────────────────── */}
      {why && <WhySection data={why} />}

      {/* ── LAYER 4 — MEMORY ────────────────────────────────────────── */}
      {memory && <MemorySection data={memory} />}

      <Text style={s.footer}>
        Read-only surface. Auto-refresh 20s.{'\n'}
        Source: system_actions_log · modules · bids · events · qa_decisions
      </Text>
    </ScrollView>
  );
}

// ─── LIVE FLOW ─────────────────────────────────────────────────────────
function LiveFlowSection({ data }: { data: LiveFlow }) {
  const p = data.pipeline;
  const stages: Array<[string, number, string]> = [
    ['Open',         p.open ?? 0,         C.accent],
    ['Evaluating',   p.evaluating ?? 0,   C.suppress],
    ['In progress',  p.in_progress ?? 0,  C.exec],
    ['Review',       p.review ?? 0,       T.primary],
    ['Completed',    p.completed ?? 0,    C.textDim],
    ['Failed',       p.failed ?? 0,       C.block],
  ];
  return (
    <View style={s.section} testID="execution-live-flow">
      <Text style={s.sectionTitle}>Live Flow</Text>
      <Text style={s.sectionSub}>What orchestration is doing right now</Text>

      <View style={s.pipelineRow}>
        {stages.map(([label, count, color]) => (
          <View key={label} style={s.pipelineCell}>
            <Text style={[s.pipelineCount, { color }]}>{count}</Text>
            <Text style={s.pipelineLabel}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={s.statRow}>
        <Stat label="Executed · 24h" value={data.decisions_24h.executed} color={C.exec} />
        <Stat label="Suppressed · 24h" value={data.decisions_24h.suppressed} color={C.suppress} />
        <Stat label="Awaiting human" value={data.decisions_24h.pending_human} color={C.block} />
        <Stat label="New bids · 60m" value={data.velocity_60m.new_bids} color={C.accent} />
      </View>

      <View style={[s.eventsBar, data.open_events > 0 && s.eventsBarHot]}>
        <Ionicons
          name={data.open_events > 0 ? 'pulse' : 'pulse-outline'}
          size={14}
          color={data.open_events > 0 ? C.suppress : C.textDim}
        />
        <Text style={[s.eventsText, data.open_events > 0 && { color: C.suppress }]}>
          {data.open_events} open detection events
        </Text>
      </View>

      {/* Action stream */}
      {data.stream.length > 0 ? (
        <View style={s.stream}>
          <Text style={s.streamHeader}>Recent actions</Text>
          {data.stream.map((row, i) => (
            <StreamRow key={row.log_id || i} row={row} />
          ))}
        </View>
      ) : (
        <View style={s.emptyMini}>
          <Text style={s.dimSm}>No actions logged yet — system in observe.</Text>
        </View>
      )}
    </View>
  );
}

function StreamRow({ row }: { row: LiveFlow['stream'][number] }) {
  const status = row.status || 'unknown';
  const color =
    status === 'executed' ? C.exec :
    status.includes('block') ? C.block :
    status === 'logged_only' ? C.observe :
    status === 'failed' ? C.block : C.suppress;
  const verdictLabel =
    status === 'executed' ? 'EXECUTED' :
    status === 'blocked_requires_manual' ? 'SUPPRESSED' :
    status === 'logged_only' ? 'OBSERVED' :
    status === 'awaiting_manual' ? 'AWAITING' :
    status.toUpperCase();
  return (
    <View style={s.streamRow}>
      <View style={[s.streamDot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <Text style={s.streamAction}>{row.action_type || '—'}</Text>
        <Text style={s.streamEntity}>
          {row.entity_type}:{(row.entity_id || '').slice(0, 12)}
          {row.mode ? ` · ${row.mode}` : ''}
        </Text>
      </View>
      <Text style={[s.streamVerdict, { color }]}>{verdictLabel}</Text>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

// ─── CONVICTION ────────────────────────────────────────────────────────
function ConvictionSection({ data }: { data: Conviction }) {
  const arrow = data.trend_arrow === 'up' ? '↑' : data.trend_arrow === 'down' ? '↓' : '→';
  const trendColor =
    data.trend === 'building' ? C.exec :
    data.trend === 'collapsing' ? C.block : C.textDim;
  return (
    <View style={s.section} testID="execution-conviction">
      <Text style={s.sectionTitle}>Conviction</Text>
      <Text style={s.sectionSub}>Composite confidence in current orchestration</Text>

      <View style={s.convictionMain}>
        <Text style={[s.convictionScore, { color: trendColor }]}>{data.score}</Text>
        <View>
          <Text style={[s.convictionTrend, { color: trendColor }]}>
            {arrow} {data.trend.toUpperCase()}
          </Text>
          <Text style={s.dimSm}>
            {data.samples.actions_24h} decisions · {data.samples.developers} devs · {data.samples.modules} modules
          </Text>
        </View>
      </View>

      <View style={s.componentsCol}>
        {data.components.map(c => (
          <View key={c.label} style={s.componentRow}>
            <Text style={s.componentLabel}>{c.label}</Text>
            <Text style={s.componentValue}>{c.value}%</Text>
            <Text style={[
              s.componentDelta,
              { color: c.delta > 0 ? C.exec : c.delta < 0 ? C.block : C.textDim },
            ]}>
              {c.delta > 0 ? '+' : ''}{c.delta}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── WHY ───────────────────────────────────────────────────────────────
function WhySection({ data }: { data: Why }) {
  if (data.status === 'forming') {
    return (
      <View style={s.section} testID="execution-why">
        <Text style={s.sectionTitle}>Why</Text>
        <Text style={s.sectionSub}>Rationale for recent suppression / execution</Text>
        <View style={s.empty}>
          <Ionicons name="time-outline" size={28} color={C.textFaint} />
          <Text style={s.dim}>{data.reason}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={s.section} testID="execution-why">
      <Text style={s.sectionTitle}>Why</Text>
      <Text style={s.sectionSub}>Rationale for recent suppression / execution</Text>

      {data.suppressed.length > 0 && (
        <>
          <Text style={[s.subhead, { color: C.suppress }]}>WHY BLOCKED</Text>
          {data.suppressed.map((e, i) => (
            <WhyCard key={e.log_id || i} entry={e} />
          ))}
        </>
      )}
      {data.executed.length > 0 && (
        <>
          <Text style={[s.subhead, { color: C.exec, marginTop: 16 }]}>WHY EXECUTED</Text>
          {data.executed.map((e, i) => (
            <WhyCard key={e.log_id || i} entry={e} />
          ))}
        </>
      )}
    </View>
  );
}

function WhyCard({ entry }: { entry: WhyEntry }) {
  const c = entry.verdict === 'EXECUTED' ? C.exec : C.suppress;
  return (
    <View style={[s.whyCard, { borderLeftColor: c }]}>
      <View style={s.whyHead}>
        <Text style={s.whyAction}>{entry.action}</Text>
        <Text style={[s.whyVerdict, { color: c }]}>{entry.verdict}</Text>
      </View>
      <Text style={s.whyEntity}>{entry.entity}</Text>
      {entry.reasons.map((r, i) => (
        <View key={i} style={s.bullet}>
          <Text style={s.bulletDot}>·</Text>
          <Text style={s.bulletText}>{r}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── MEMORY ────────────────────────────────────────────────────────────
function MemorySection({ data }: { data: Memory }) {
  if (data.status === 'forming') {
    return (
      <View style={s.section} testID="execution-memory">
        <Text style={s.sectionTitle}>Memory</Text>
        <Text style={s.sectionSub}>Past decisions and their realised outcomes</Text>
        <View style={s.empty}>
          <Ionicons name="archive-outline" size={28} color={C.textFaint} />
          <Text style={s.dim}>{data.reason}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={s.section} testID="execution-memory">
      <Text style={s.sectionTitle}>Memory</Text>
      <Text style={s.sectionSub}>Last 7 days · {data.decisions.length} decisions</Text>

      {data.summary && (
        <View style={s.memorySummary}>
          {Object.entries(data.summary).map(([k, v]) => (
            <View key={k} style={s.memorySummaryItem}>
              <Text style={s.memorySummaryValue}>{v as number}</Text>
              <Text style={s.memorySummaryLabel}>{k}</Text>
            </View>
          ))}
        </View>
      )}

      {data.decisions.map((d, i) => {
        const c =
          d.outcome === 'completed' ? C.exec :
          d.outcome === 'suppressed' ? C.suppress :
          d.outcome === 'failed' ? C.block :
          d.outcome === 'observed' ? C.observe : C.textDim;
        return (
          <View key={d.log_id || i} style={s.memoryRow}>
            <View style={[s.memoryBar, { backgroundColor: c }]} />
            <View style={{ flex: 1 }}>
              <Text style={s.memoryAction}>
                {d.action} <Text style={s.memoryMode}>· {d.mode || 'auto'}</Text>
              </Text>
              <Text style={s.memoryEntity}>{d.entity}</Text>
              {d.outcome_detail ? (
                <Text style={s.memoryDetail}>{d.outcome_detail}</Text>
              ) : null}
            </View>
            <Text style={[s.memoryOutcome, { color: c }]}>
              {d.outcome.toUpperCase()}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { justifyContent: 'center', alignItems: 'center', gap: 12 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, marginBottom: 24, gap: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.surface, justifyContent: 'center', alignItems: 'center',
  },
  eyebrow: { color: C.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: '600' },
  title: { color: C.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  pulse: { width: 10, height: 10, borderRadius: 5 },
  pulseHot: { backgroundColor: C.exec },
  pulseWarm: { backgroundColor: C.suppress },
  pulseCold: { backgroundColor: C.block },

  section: {
    marginHorizontal: 16, marginBottom: 18, padding: 18,
    backgroundColor: C.surface, borderRadius: 16,
    borderWidth: 1, borderColor: C.border,
  },
  sectionTitle: { color: C.text, fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  sectionSub: { color: C.textDim, fontSize: 12, marginBottom: 14, marginTop: 2 },
  subhead: { fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 8 },

  pipelineRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    backgroundColor: C.surfaceAlt, borderRadius: 12, padding: 12, marginBottom: 14,
  },
  pipelineCell: { width: '33.33%', alignItems: 'center', paddingVertical: 8 },
  pipelineCount: { fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  pipelineLabel: { color: C.textDim, fontSize: 11, marginTop: 2, letterSpacing: 0.5 },

  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  stat: {
    flexBasis: '48%', flexGrow: 1,
    backgroundColor: C.surfaceAlt, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: C.border,
  },
  statValue: { fontSize: 20, fontWeight: '700' },
  statLabel: { color: C.textDim, fontSize: 11, marginTop: 2, letterSpacing: 0.4 },

  eventsBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: C.surfaceAlt, borderRadius: 10, marginBottom: 14,
    borderWidth: 1, borderColor: C.border,
  },
  eventsBarHot: { borderColor: C.suppress },
  eventsText: { color: C.textDim, fontSize: 12, fontWeight: '600' },

  stream: { gap: 10 },
  streamHeader: {
    color: C.textFaint, fontSize: 11, letterSpacing: 1.5,
    fontWeight: '600', marginBottom: 4,
  },
  streamRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  streamDot: { width: 8, height: 8, borderRadius: 4 },
  streamAction: { color: C.text, fontSize: 13, fontWeight: '600' },
  streamEntity: { color: C.textDim, fontSize: 11, marginTop: 1 },
  streamVerdict: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },

  convictionMain: {
    flexDirection: 'row', alignItems: 'center', gap: 18,
    marginBottom: 18,
  },
  convictionScore: { fontSize: 56, fontWeight: '800', letterSpacing: -2 },
  convictionTrend: { fontSize: 14, fontWeight: '700', letterSpacing: 1 },

  componentsCol: { gap: 8 },
  componentRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, paddingHorizontal: 12,
    backgroundColor: C.surfaceAlt, borderRadius: 8,
  },
  componentLabel: { color: C.text, fontSize: 13, flex: 1 },
  componentValue: { color: C.textDim, fontSize: 12, marginRight: 12, fontVariant: ['tabular-nums'] },
  componentDelta: { fontSize: 12, fontWeight: '700', minWidth: 48, textAlign: 'right' },

  whyCard: {
    backgroundColor: C.surfaceAlt, borderRadius: 12, padding: 14,
    marginBottom: 10, borderLeftWidth: 3,
  },
  whyHead: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 4,
  },
  whyAction: { color: C.text, fontSize: 14, fontWeight: '700' },
  whyVerdict: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  whyEntity: { color: C.textDim, fontSize: 11, marginBottom: 8 },
  bullet: { flexDirection: 'row', gap: 8, marginTop: 4 },
  bulletDot: { color: C.textFaint, fontSize: 14, lineHeight: 18 },
  bulletText: { color: C.text, fontSize: 12, flex: 1, lineHeight: 18 },

  memorySummary: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    marginBottom: 14,
  },
  memorySummaryItem: {
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: C.surfaceAlt, borderRadius: 8,
  },
  memorySummaryValue: { color: C.text, fontSize: 16, fontWeight: '700' },
  memorySummaryLabel: { color: C.textDim, fontSize: 10, letterSpacing: 0.5 },
  memoryRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, gap: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  memoryBar: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  memoryAction: { color: C.text, fontSize: 13, fontWeight: '600' },
  memoryMode: { color: C.textFaint, fontSize: 11, fontWeight: '400' },
  memoryEntity: { color: C.textDim, fontSize: 11, marginTop: 1 },
  memoryDetail: { color: C.textFaint, fontSize: 10, marginTop: 2, fontStyle: 'italic' },
  memoryOutcome: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  empty: {
    alignItems: 'center', gap: 8, padding: 18,
    backgroundColor: C.surfaceAlt, borderRadius: 12,
  },
  emptyMini: {
    paddingVertical: 12, paddingHorizontal: 12,
    backgroundColor: C.surfaceAlt, borderRadius: 10, alignItems: 'center',
  },

  card: {
    marginHorizontal: 16, marginBottom: 12, padding: 12,
    borderRadius: 10, borderWidth: 1,
  },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  text: { color: C.text, fontSize: 13 },
  dim: { color: C.textDim, fontSize: 12 },
  dimSm: { color: C.textFaint, fontSize: 11 },
  footer: {
    color: C.textFaint, fontSize: 10, textAlign: 'center',
    marginHorizontal: 24, marginTop: 12, lineHeight: 14,
  },
});
