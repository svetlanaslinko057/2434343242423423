// Client → Projects tab — Operator Console redesign
//
// Slice #3 (ClientCabinet) governance notes:
//   - Per-project module status counts: now read from
//     workspace.status_counts (BD-15 — backend-owned, slice #3, I-06 promotion
//     satisfied: this surface + project-detail share the same shape need).
//     No client-side `.filter().length` synthesis.
//   - Progress %: read from `p.progress` (backend-owned). Fallback removed.
//   - Silent catch closed (D-5): explicit error state.
//
// ─── Runtime-client migration (Batch 2 — Expo Client Cabinet) ───────────
// Transport-swap only. BD-15/D-5/I-06 invariants are NOT touched — this is
// substrate normalization, not authority repair. Per-project workspace
// fan-out is preserved with its inner try/catch so a single workspace error
// doesn't poison the whole list (legacy semantic, preserved verbatim).
import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { runtime } from '../../../src/runtime';
import { ApiError } from '../../../src/runtime-client';
import T from '../../../src/theme';
import { ScreenTitle, StatusPill, MiniProgress, EmptyState } from '../../../src/ui-client';
import { PressScale, FadeSlideIn } from '../../../src/ui';

type Project = {
  project_id: string;
  name?: string;
  title?: string;
  status?: string;
  current_stage?: string;
  progress?: number;
  production_mode?: string;
  created_at?: string;
};

type StatusCounts = {
  in_progress: number; review: number; done: number; paused: number; total: number;
};

const ZERO_COUNTS: StatusCounts = { in_progress: 0, review: 0, done: 0, paused: 0, total: 0 };

const STAGE: Record<string, { label: string; tone: 'success' | 'risk' | 'info' | 'neutral' | 'danger' }> = {
  development: { label: 'In development', tone: 'info' },
  delivered:   { label: 'Delivered',      tone: 'success' },
  review:      { label: 'In review',      tone: 'risk' },
  paused:      { label: 'Paused',         tone: 'danger' },
  draft:       { label: 'Planning',       tone: 'neutral' },
};

const MODE: Record<string, string> = {
  ai:     'AI Build',
  hybrid: 'AI + Engineering',
  dev:    'Full Engineering',
};

export default function ClientProjects() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  // BD-15 (slice #3, D-1): per-project counters now read from
  // workspace.status_counts (backend-owned). No FE synthesis.
  const [countsByProject, setCountsByProject] = useState<Record<string, StatusCounts>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const r = await runtime.get('/api/projects/mine');
      const list: Project[] = Array.isArray(r.data) ? r.data : [];
      setProjects(list);
      const next: Record<string, StatusCounts> = {};
      await Promise.all(list.map(async (p) => {
        try {
          const w = await runtime.get(`/api/client/project/${p.project_id}/workspace`);
          next[p.project_id] = w.data?.status_counts || ZERO_COUNTS;
        } catch { next[p.project_id] = ZERO_COUNTS; }
      }));
      setCountsByProject(next);
    } catch (e: any) {
      // Slice #3 D-5: explicit error state, no silent collapse. Source of
      // message changed only — runtime ApiError carries `.message`/`.hint`,
      // legacy axios used `response.data.detail`. Behaviour identical.
      const msg = e instanceof ApiError
        ? (e.message || (e as any).hint || 'Could not load your projects.')
        : (e?.response?.data?.message || e?.response?.data?.detail || 'Could not load your projects.');
      setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (error && projects.length === 0) {
    return (
      <SafeAreaView style={s.flex} edges={['top']}>
        <View style={s.errorBlock} testID="projects-error">
          <Ionicons name="alert-circle" size={40} color={T.danger} />
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity
            onPress={() => { setLoading(true); load(); }}
            style={s.retryBtn}
            testID="projects-retry"
          >
            <Text style={s.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.flex} edges={['top']}>
      <ScrollView
        style={s.flex}
        contentContainerStyle={s.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={T.primary} />}
      >
        <ScreenTitle
          title="Projects"
          subtitle={`${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`}
          testID="projects-title"
        />

        <PressScale onPress={() => router.push('/project/wizard' as any)} testID="projects-new-cta" style={s.cta}>
          <Ionicons name="add-circle" size={20} color={T.bg} />
          <Text style={s.ctaText}>Start new project</Text>
        </PressScale>

        {!loading && projects.length === 0 && (
          <EmptyState
            icon="folder-open-outline"
            title="No projects yet"
            sub='Tap "Start new project" — 4 questions, ready in 10 seconds.'
            testID="projects-empty"
          />
        )}

        {projects.map((p, i) => {
          const counts = countsByProject[p.project_id] || ZERO_COUNTS;
          const stage = STAGE[p.current_stage || ''] || { label: p.status || '—', tone: 'neutral' as const };
          const mode = MODE[p.production_mode || ''] || p.production_mode || '';
          const progress = p.progress ?? 0;

          return (
            <FadeSlideIn key={p.project_id} delay={i * 60}>
              <PressScale
                testID={`projects-card-${p.project_id}`}
                onPress={() => router.push(`/client/projects/${p.project_id}` as any)}
                style={s.card}
              >
                <View style={s.cardHeader}>
                  <Text style={s.cardTitle} numberOfLines={1}>{p.name || p.title || 'Untitled project'}</Text>
                  <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
                </View>

                <View style={s.metaRow}>
                  <StatusPill tone={stage.tone} label={stage.label} dot />
                  {mode ? <Text style={s.mode}>{mode}</Text> : null}
                </View>

                <View style={{ marginTop: T.md }}>
                  <MiniProgress pct={progress} />
                </View>
                <View style={s.statsRow}>
                  <Text style={s.statsLabel}>{progress}% complete</Text>
                  <Text style={s.statsLabel}>{counts.done}/{counts.total} modules</Text>
                </View>

                {(counts.in_progress + counts.review + counts.paused) > 0 && (
                  <View style={s.chipsRow}>
                    {counts.in_progress > 0 && <StatusPill tone="info"   label={`${counts.in_progress} in progress`} />}
                    {counts.review > 0      && <StatusPill tone="risk"   label={`${counts.review} in review`} />}
                    {counts.paused > 0      && <StatusPill tone="danger" label={`${counts.paused} paused`} />}
                  </View>
                )}
              </PressScale>
            </FadeSlideIn>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  container: { padding: T.md, paddingBottom: 100 },

  cta: {
    backgroundColor: T.primary,
    borderRadius: T.radiusLg,
    padding: T.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    marginBottom: T.md,
  },
  ctaText: { color: T.bg, fontSize: T.body, fontWeight: '800' },

  card: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radiusLg,
    padding: T.md,
    marginBottom: T.sm,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: T.text, fontSize: T.h3, fontWeight: '700', flex: 1, marginRight: 8 },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  mode: { color: T.textMuted, fontSize: T.tiny, fontWeight: '600', letterSpacing: 0.4 },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  statsLabel: { color: T.textMuted, fontSize: T.tiny, fontWeight: '600' },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: T.sm },

  errorBlock: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: T.lg, gap: T.sm,
  },
  errorText: { color: T.textMuted, fontSize: T.body, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: T.lg, paddingVertical: T.sm,
    borderWidth: 1, borderColor: T.border, borderRadius: T.radiusLg,
    marginTop: T.sm,
  },
  retryBtnText: { color: T.text, fontWeight: '600' },
});
