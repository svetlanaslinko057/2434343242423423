/**
 * Client Versions — slice #2 mobile parity surface.
 *
 * Semantic parity with web ClientVersionsPage (NOT visual identity).
 *
 * Authority model (frozen — see /app/audit/SUBSTRATE_CONTRACT.md):
 *   - Endpoint family: /api/projects/{id}/versions
 *     (canonical-within-mixed per registry §1.3, D-1B slice #2 audit;
 *      full family migration deferred to slice #3 ClientCabinet).
 *   - Canonical status enum: pending_approval → approved | rejected.
 *     Legacy read-side mapping:
 *       pending             → pending_approval
 *       revision_requested  → rejected
 *   - Chronology authority: backend (`.sort("created_at", -1)`).
 *     Implicit-coupling debt BD-12 tolerated because:
 *       backend ordering is stable,
 *       single-consumer,
 *       read-only,
 *       non-interactive chronology.
 *   - Read-only surface: no mutations, no optimistic state.
 *   - No mobile-native chronology semantics introduced:
 *       no collapsible groups, no month sections, no "recent" buckets,
 *       no swipe chronology, no optimistic insert animations.
 *     Parity means same authority model, not same pixels.
 *   - Loading / error / empty separated structurally as inline branches.
 *   - Project name fetched via singular /api/projects/{id} (V-7 fix):
 *     do NOT consume the project list contract to synthesize a singular authority.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../../../src/api';
import T from '../../../src/theme';

type VersionItem = {
  deliverable_id: string;
  version?: string;
  title?: string;
  status: string;
  created_at?: string;
  blocks_count?: number;
};

type ProjectSummary = {
  project_id: string;
  name?: string;
};

// Inline, surface-owned, non-exported normalization.
// Same pattern as slice #1 ClientDeliverableScreen. Do NOT extract a shared
// helper: status semantics are not globally frozen yet.
function normalizeStatus(raw?: string): string {
  if (raw === 'pending') return 'pending_approval';
  if (raw === 'revision_requested') return 'rejected';
  return raw || '';
}

const STATUS_LABEL: Record<string, string> = {
  pending_approval: 'pending approval',
  approved: 'approved',
  rejected: 'changes requested',
};

function statusStyle(status: string): { dot: string; tagBg: string; tagFg: string; icon: keyof typeof Ionicons.glyphMap } {
  if (status === 'approved') {
    return { dot: '#22c55e', tagBg: 'rgba(34, 197, 94, 0.1)', tagFg: '#22c55e', icon: 'checkmark-circle' };
  }
  if (status === 'pending_approval') {
    return { dot: '#f59e0b', tagBg: 'rgba(245, 158, 11, 0.1)', tagFg: '#f59e0b', icon: 'time' };
  }
  if (status === 'rejected') {
    return { dot: '#3b82f6', tagBg: 'rgba(59, 130, 246, 0.1)', tagFg: '#3b82f6', icon: 'alert-circle' };
  }
  return { dot: T.textMuted, tagBg: T.surface, tagFg: T.textMuted, icon: 'time' };
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}

export default function ClientVersionsScreen() {
  const { project_id } = useLocalSearchParams<{ project_id: string }>();
  const router = useRouter();

  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!project_id) return;
    setError(null);
    try {
      // Two independent backend contracts composed in parallel (I-09).
      // Singular project endpoint, NOT the list — see V-7.
      const [versionsRes, projectRes] = await Promise.all([
        api.get<VersionItem[]>(`/projects/${project_id}/versions`),
        api.get<ProjectSummary>(`/projects/${project_id}`),
      ]);
      setVersions(Array.isArray(versionsRes.data) ? versionsRes.data : []);
      setProject(projectRes.data || null);
    } catch (e: any) {
      setError(
        e?.response?.data?.message ||
        e?.response?.data?.detail ||
        'Could not load version history.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [project_id]);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); void load(); };

  // ─── STRUCTURAL STATES ──────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.centered} testID="versions-loading">
          <ActivityIndicator size="large" color={T.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.centered} testID="versions-error">
          <Ionicons name="alert-circle" size={48} color={T.danger} />
          <Text style={s.errorTitle}>Couldn't load version history</Text>
          <Text style={s.errorBody}>{error}</Text>
          <TouchableOpacity
            onPress={load}
            style={s.retryBtn}
            testID="versions-retry"
          >
            <Text style={s.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} />
        }
        testID="client-versions-screen"
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.backRow}
          testID="versions-back"
        >
          <Ionicons name="chevron-back" size={20} color={T.textMuted} />
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>

        <View style={s.headerBlock}>
          <View style={s.headerRow}>
            <Ionicons name="git-branch" size={18} color={T.primary} />
            <Text style={s.headerLabel}>Version History</Text>
          </View>
          <Text style={s.title}>{project?.name || 'Project'}</Text>
          <Text style={s.subtitle}>All delivered versions of your product</Text>
        </View>

        {versions.length === 0 ? (
          <View style={s.emptyCard} testID="versions-empty">
            <Ionicons name="cube-outline" size={40} color={T.textMuted} />
            <Text style={s.emptyTitle}>No deliveries yet</Text>
            <Text style={s.emptyBody}>Versions will appear here as they are delivered.</Text>
          </View>
        ) : (
          <View style={s.list}>
            {/*
              Render top → bottom in backend-supplied order.
              No client-side ordering (no .sort, no .reverse).
              No grouping, bucketing, or section headers.
            */}
            {versions.map((version) => {
              const status = normalizeStatus(version.status);
              const st = statusStyle(status);
              return (
                <TouchableOpacity
                  key={version.deliverable_id}
                  onPress={() => router.push(`/client/deliverable/${version.deliverable_id}`)}
                  style={s.card}
                  testID={`version-card-${version.deliverable_id}`}
                >
                  <View style={[s.dot, { backgroundColor: st.dot }]} />
                  <View style={s.cardBody}>
                    <View style={s.cardTopRow}>
                      <Ionicons name={st.icon} size={18} color={st.tagFg} />
                      <Text style={s.versionLabel}>{version.version || 'v—'}</Text>
                      <View style={[s.tag, { backgroundColor: st.tagBg }]}>
                        <Text style={[s.tagText, { color: st.tagFg }]}>
                          {STATUS_LABEL[status] || status || 'unknown'}
                        </Text>
                      </View>
                    </View>
                    <Text style={s.cardTitle} numberOfLines={2}>
                      {version.title || 'Untitled delivery'}
                    </Text>
                    <View style={s.metaRow}>
                      <Text style={s.metaText}>{version.blocks_count ?? 0} features</Text>
                      <Text style={s.metaDot}>•</Text>
                      <Text style={s.metaText}>{fmtDate(version.created_at)}</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  errorTitle: { color: T.danger, fontWeight: '600', fontSize: 16, marginTop: 8 },
  errorBody: { color: T.textMuted, fontSize: 13, textAlign: 'center', marginBottom: 8 },
  retryBtn: { paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: T.border, borderRadius: 12 },
  retryBtnText: { color: T.text, fontSize: 13, fontWeight: '500' },

  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  backText: { color: T.textMuted, fontSize: 14 },

  headerBlock: { marginBottom: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  headerLabel: { color: T.primary, fontSize: 13, fontWeight: '500' },
  title: { color: T.text, fontSize: 24, fontWeight: '700' },
  subtitle: { color: T.textMuted, fontSize: 13, marginTop: 4 },

  emptyCard: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: T.border, borderRadius: 16,
    padding: 32, alignItems: 'center', gap: 8,
  },
  emptyTitle: { color: T.text, fontSize: 15, fontWeight: '600', marginTop: 6 },
  emptyBody: { color: T.textMuted, fontSize: 13, textAlign: 'center' },

  list: { gap: 12 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: T.border, borderRadius: 16, padding: 14,
    backgroundColor: T.surface,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardBody: { flex: 1, gap: 6 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  versionLabel: { color: T.text, fontSize: 15, fontWeight: '600' },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 11, fontWeight: '500' },
  cardTitle: { color: T.text, fontSize: 14, lineHeight: 19 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  metaText: { color: T.textMuted, fontSize: 12 },
  metaDot: { color: T.textMuted, fontSize: 12 },
});
