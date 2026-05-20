// Workspace (mobile) — canonical /api/client/project/{id}/workspace.
//
// 1 screen = 1 question: "What is happening with my project?"
// Shows header + KPI + modules list. Nothing else.
//
// Moved out (to stop drift):
//   - system_actions      → /client/operator
//   - opportunities       → /client/opportunities (future)
//   - module pause/resume/cancel → /client/operator (those are Operator actions)

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  ActivityIndicator, RefreshControl, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../src/api';
import T from '../../src/theme';
import { useAppStatePolling } from '../../src/hooks/useAppStatePolling';

type Mod = {
  module_id: string;
  module_title: string;
  status: string;
  paused_by_system?: boolean;
  progress: number;
  progress_pct: number;
  price: number;
  cost: number;
  earned: number;
  paid: number;
  cost_status: 'under_control' | 'warning' | 'over_budget' | 'unknown';
  developer_id?: string;
  developer_name?: string;
};

type Workspace = {
  project: { project_id: string; project_title: string; created_at?: string };
  summary: {
    revenue: number; cost: number; earned: number; paid: number; profit: number;
    active_modules: number; total_modules: number;
    over_budget_count: number; warning_count: number; paused_by_system_count: number;
  };
  status: 'healthy' | 'watch' | 'at_risk' | 'blocked';
  status_label: string;
  cause?: string | null;
  explanation: string;
  modules: Mod[];
  generated_at: string;
};

type ProjectRef = { project_id: string; name?: string };

export default function ClientWorkspace() {
  const params = useLocalSearchParams<{ projectId?: string }>();
  const router = useRouter();
  const [projectId, setProjectId] = useState<string | null>(params.projectId || null);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [ws, setWs] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const ensureProjectId = useCallback(async (): Promise<string | null> => {
    if (projectId) return projectId;
    try {
      const r = await api.get('/projects/mine');
      const list: ProjectRef[] = Array.isArray(r.data) ? r.data : [];
      setProjects(list);
      const first = list[0]?.project_id || null;
      if (first) setProjectId(first);
      return first;
    } catch {
      return null;
    }
  }, [projectId]);

  const load = useCallback(async () => {
    const pid = await ensureProjectId();
    if (!pid) {
      setWs(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const r = await api.get(`/client/project/${pid}/workspace`);
      setWs(r.data);
      if (projects.length === 0) {
        try {
          const rp = await api.get('/projects/mine');
          setProjects(Array.isArray(rp.data) ? rp.data : []);
        } catch { /* ignore */ }
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [ensureProjectId, projects.length]);

  useEffect(() => { load(); }, [load]);
  useAppStatePolling(load, 15000);

  if (loading) return <View style={[s.flex, s.center]}><ActivityIndicator color={T.primary} /></View>;

  if (!ws) {
    return (
      <SafeAreaView style={s.flex} edges={['top']}>
        <View style={[s.center, { flex: 1, padding: T.lg }]} testID="no-projects">
          <Ionicons name="folder-open-outline" size={32} color={T.textMuted} />
          <Text style={s.emptyTextLg}>No projects yet</Text>
          <Text style={s.emptySub}>Create a project to unlock your workspace.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.flex} edges={['top']}>
      <ScrollView
        style={s.flex}
        contentContainerStyle={s.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={T.primary}
          />
        }
      >
        {/* Header */}
        <View style={s.screenHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.screenTitle} numberOfLines={1}>{ws.project.project_title || 'Project'}</Text>
            <Text style={s.subtitle} numberOfLines={2}>{ws.explanation}</Text>
          </View>
          <View style={[s.statusPill, statusPillStyle(ws.status)]} testID="status-pill">
            <Text style={s.statusPillText}>{ws.status_label}</Text>
            {ws.cause ? <Text style={s.statusPillCause}>· {ws.cause}</Text> : null}
          </View>
        </View>

        {/* Project switcher (only if >1 project) */}
        {projects.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.switcherRow}
            testID="project-switcher"
          >
            {projects.map((p) => (
              <TouchableOpacity
                key={p.project_id}
                testID={`switch-${p.project_id}`}
                style={[s.switcherChip, projectId === p.project_id && s.switcherChipActive]}
                onPress={() => {
                  setProjectId(p.project_id);
                  setLoading(true);
                  setTimeout(() => load(), 0);
                }}
              >
                <Text style={[s.switcherText, projectId === p.project_id && { color: '#000' }]} numberOfLines={1}>
                  {p.name || p.project_id.slice(-6)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* KPI */}
        <View style={s.statsRow}>
          <Stat label="Profit"  value={`$${ws.summary.profit}`}  color={ws.summary.profit >= 0 ? T.success : T.danger} />
          <Stat label="Revenue" value={`$${ws.summary.revenue}`} color={T.text} />
          <Stat label="Cost"    value={`$${ws.summary.cost}`}    color={T.warning} />
          <Stat label="Paid"    value={`$${ws.summary.paid}`}    color={T.primary} />
        </View>

        {/* Modules */}
        <Text style={s.sectionTitle}>
          📦 Modules · {ws.summary.active_modules}/{ws.summary.total_modules}
          {ws.summary.over_budget_count > 0 && (
            <Text style={{ color: T.danger }}>  · {ws.summary.over_budget_count} over budget</Text>
          )}
          {ws.summary.paused_by_system_count > 0 && (
            <Text style={{ color: T.warning }}>  · {ws.summary.paused_by_system_count} paused by system</Text>
          )}
        </Text>
        {ws.modules.length === 0 && (
          <Text style={s.emptyText}>No modules yet</Text>
        )}
        {ws.modules.map((m) => (
          <View
            key={m.module_id}
            style={[
              s.moduleCard,
              m.status === 'paused' && s.moduleCardPaused,
              m.paused_by_system && s.moduleCardSystemPaused,
              m.cost_status === 'over_budget' && s.moduleCardOver,
              m.cost_status === 'warning' && s.moduleCardWarn,
            ]}
            testID={`module-${m.module_id}`}
          >
            <View style={s.moduleHeader}>
              <Text style={s.moduleTitle} numberOfLines={1}>{m.module_title}</Text>
              <Text style={s.modulePrice}>${m.price}</Text>
            </View>
            <Text style={s.moduleMeta}>
              {m.developer_name ? `${m.developer_name} · ` : 'Unassigned · '}
              {m.status.toUpperCase()}
              {m.paused_by_system ? ' · SYSTEM PAUSED' : ''}
              {m.cost_status === 'over_budget'
                ? ' · OVER BUDGET'
                : m.cost_status === 'warning' ? ' · NEAR LIMIT' : ''}
            </Text>
            <View style={s.progressBg}>
              <View style={[s.progressFill, progressColor(m.cost_status), { width: `${m.progress_pct}%` }]} />
            </View>
            <View style={s.moduleMetaRow}>
              <Text style={s.moduleMetaSmall}>
                Cost ${m.cost} · Earned ${m.earned} · {m.progress_pct}%
              </Text>
            </View>
          </View>
        ))}

        {/* Deep links — each answers its own question */}
        <View style={s.deepLinks}>
          <Text style={s.deepLinksTitle}>GO DEEPER</Text>
          <TouchableOpacity
            style={s.linkRow}
            testID="goto-operator"
            onPress={() => router.push('/operator')}
          >
            <Text style={s.linkLabel}>Operator</Text>
            <Text style={s.linkSub}>What the system did · what you can do</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.linkRow}
            testID="goto-billing"
            onPress={() => router.push('/client/billing')}
          >
            <Text style={s.linkLabel}>Economics</Text>
            <Text style={s.linkSub}>Where the money is going</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={s.statCard}>
      <Text style={[s.statValue, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function statusPillStyle(st: string) {
  if (st === 'healthy') return { backgroundColor: T.successBgStrong, borderColor: T.success };
  if (st === 'watch')   return { backgroundColor: T.infoBg,         borderColor: T.infoBorder };
  if (st === 'at_risk') return { backgroundColor: T.warningBg,      borderColor: T.warningBorder };
  if (st === 'blocked') return { backgroundColor: T.dangerBg,       borderColor: T.dangerBorder };
  return { backgroundColor: T.border, borderColor: T.border };
}

function progressColor(cs: string) {
  if (cs === 'over_budget') return { backgroundColor: T.danger };
  if (cs === 'warning')     return { backgroundColor: T.warning };
  return { backgroundColor: T.success };
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  container: { padding: T.lg, paddingBottom: 100 },
  screenHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: T.md },
  screenTitle: { color: T.text, fontSize: T.h2 ?? 24, fontWeight: '800' },
  subtitle: { color: T.textMuted, fontSize: 12, marginTop: 4 },
  statusPill: { borderWidth: 1, borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusPillText: { color: T.text, fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  statusPillCause: { color: T.textMuted, fontSize: 10 },
  switcherRow: { gap: 8, paddingVertical: 6, marginBottom: 8 },
  switcherChip: { backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12, maxWidth: 180 },
  switcherChipActive: { backgroundColor: T.primary, borderColor: T.primary },
  switcherText: { color: T.text, fontSize: 12, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: T.sm, marginBottom: T.lg, flexWrap: 'wrap' },
  statCard: { flex: 1, minWidth: 70, backgroundColor: T.surface1, borderRadius: 10, padding: T.md, borderWidth: 1, borderColor: T.border },
  statValue: { fontSize: 15, fontWeight: '800' },
  statLabel: { color: T.textMuted, fontSize: 10, marginTop: 2 },
  sectionTitle: { color: T.text, fontSize: 14, fontWeight: '800', marginTop: T.lg, marginBottom: T.sm },
  emptyText: { color: T.textMuted, fontSize: 12 },
  emptyTextLg: { color: T.text, fontSize: 16, fontWeight: '700', marginTop: 12 },
  emptySub: { color: T.textMuted, fontSize: 12, marginTop: 4 },
  moduleCard: { backgroundColor: T.surface1, borderRadius: 10, padding: T.md, marginBottom: T.sm, borderWidth: 1, borderColor: T.border },
  moduleCardPaused: { opacity: 0.6, borderColor: T.warning },
  moduleCardSystemPaused: { borderColor: T.danger },
  moduleCardOver: { borderColor: T.danger },
  moduleCardWarn: { borderColor: T.warning },
  moduleHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  moduleTitle: { color: T.text, fontSize: 13, fontWeight: '700', flex: 1, marginRight: 8 },
  modulePrice: { color: T.primary, fontSize: 13, fontWeight: '800' },
  moduleMeta: { color: T.textMuted, fontSize: 11, marginBottom: 8 },
  moduleMetaRow: { marginTop: 6 },
  moduleMetaSmall: { color: T.textMuted, fontSize: 10 },
  progressBg: { height: 4, backgroundColor: T.border, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4 },
  deepLinks: { marginTop: T.lg, paddingTop: T.md, borderTopWidth: 1, borderTopColor: T.border },
  deepLinksTitle: { color: T.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 8 },
  linkRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.border },
  linkLabel: { color: T.text, fontSize: 14, fontWeight: '700' },
  linkSub: { color: T.textMuted, fontSize: 11, marginTop: 2 },
});
