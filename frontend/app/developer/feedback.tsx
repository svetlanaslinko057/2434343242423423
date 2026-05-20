/**
 * Developer Intelligence — FEEDBACK
 *
 * QA feedback = list of blockers to growth. Grouped by status.
 *
 * Source: GET /api/developer/feedback
 * Access: Work → QA feedback (lives with work, not profile)
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { runtime } from '../../src/runtime';
import T from '../../src/theme';

type Item = {
  module_id: string;
  module_title: string;
  project_title: string;
  status: 'needs_revision' | 'resolved';
  severity: 'info' | 'medium' | 'high' | 'low';
  reason: string;
  created_at: string | null;
};

type FeedbackResp = {
  items: Item[];
  summary: {
    open_issues: number;
    resolved: number;
    total: number;
    last_feedback_at: string | null;
  };
  generated_at: string;
};

export default function DeveloperFeedback() {
  const router = useRouter();
  const [data, setData] = useState<FeedbackResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const r = await runtime.get<FeedbackResp>('/api/developer/feedback');
      setData(r.data);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Failed to load QA feedback');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = () => { setRefreshing(true); void load(); };

  // Render-only projection: backend returns items, we just partition
  const { needsRevision, resolved } = useMemo(() => {
    const items = data?.items || [];
    return {
      needsRevision: items.filter((i) => i.status === 'needs_revision'),
      resolved: items.filter((i) => i.status === 'resolved'),
    };
  }, [data]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} />}
        testID="feedback-screen"
      >
        <View style={s.head}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="feedback-back">
            <Ionicons name="chevron-back" size={24} color={T.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.h1}>QA feedback</Text>
            <Text style={s.subtitle}>What's blocking your growth</Text>
          </View>
        </View>

        {loading && <View style={s.center}><ActivityIndicator color={T.primary} /></View>}

        {err && !loading && (
          <View style={s.errBox} testID="feedback-error">
            <Text style={s.errText}>{err}</Text>
            <TouchableOpacity style={s.retry} onPress={() => { setLoading(true); void load(); }}>
              <Text style={s.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {data && (
          <>
            {/* Summary */}
            <View style={s.summaryRow} testID="feedback-summary">
              <SumCard label="Needs revision" value={data.summary.open_issues} tone="warn" />
              <SumCard label="Resolved" value={data.summary.resolved} tone="ok" />
            </View>

            {/* Empty state (no mocks — honest) */}
            {data.summary.total === 0 && (
              <View style={s.emptyBox} testID="feedback-empty">
                <Ionicons name="checkmark-done" size={28} color={T.success} />
                <Text style={s.emptyTitle}>No QA feedback yet</Text>
                <Text style={s.emptyText}>
                  Complete a module and QA will leave actionable notes here.
                </Text>
                <TouchableOpacity
                  style={s.cta}
                  onPress={() => router.push('/developer/work' as any)}
                  testID="feedback-go-work"
                >
                  <Text style={s.ctaText}>Go to Work</Text>
                  <Ionicons name="arrow-forward" size={18} color={T.bg} />
                </TouchableOpacity>
              </View>
            )}

            {/* Needs revision */}
            {needsRevision.length > 0 && (
              <>
                <Text style={s.sectionLabel}>NEEDS REVISION ({needsRevision.length})</Text>
                <View style={s.list}>
                  {needsRevision.map((i, idx) => (
                    <FeedbackCard key={i.module_id || idx} item={i} />
                  ))}
                </View>
              </>
            )}

            {/* Resolved */}
            {resolved.length > 0 && (
              <>
                <Text style={s.sectionLabel}>RESOLVED ({resolved.length})</Text>
                <View style={s.list}>
                  {resolved.map((i, idx) => (
                    <FeedbackCard key={i.module_id || idx} item={i} />
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

function SumCard({ label, value, tone }: { label: string; value: number; tone: 'warn' | 'ok' }) {
  const c = tone === 'ok' ? T.success : T.risk;
  return (
    <View style={[s.sumCard, { borderColor: c + '55' }]}>
      <Text style={s.sumLabel}>{label}</Text>
      <Text style={[s.sumValue, { color: c }]}>{value}</Text>
    </View>
  );
}

function FeedbackCard({ item }: { item: Item }) {
  const isRevision = item.status === 'needs_revision';
  const color = isRevision
    ? (item.severity === 'high' ? T.danger : T.risk)
    : T.success;
  return (
    <View
      style={[s.card, { borderColor: color + '55' }]}
      testID={`feedback-card-${item.module_id}`}
    >
      <View style={s.cardHead}>
        <Ionicons
          name={isRevision ? 'alert-circle' : 'checkmark-circle'}
          size={18}
          color={color}
        />
        <Text style={[s.cardBadge, { color }]}>
          {isRevision ? 'Revision required' : 'Passed'}
        </Text>
        <Text style={s.cardSeverity}>
          {item.severity === 'high' ? ' · HIGH' : ''}
        </Text>
      </View>
      <Text style={s.cardTitle}>{item.module_title || 'Module'}</Text>
      {item.project_title ? (
        <Text style={s.cardProject}>{item.project_title}</Text>
      ) : null}
      <Text style={s.cardReason}>{item.reason}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md, paddingBottom: T.xxl * 2 },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: T.lg, gap: T.sm },
  backBtn: { width: 32, height: 32, alignItems: 'flex-start', justifyContent: 'center' },
  h1: { color: T.text, fontSize: T.h1, fontWeight: '800' },
  subtitle: { color: T.textSecondary, fontSize: T.small, marginTop: 2 },
  center: { paddingVertical: T.xxl, alignItems: 'center' },
  errBox: {
    backgroundColor: T.dangerTint, borderWidth: 1, borderColor: T.dangerBorder,
    borderRadius: T.radius, padding: T.md, gap: T.sm,
  },
  errText: { color: T.danger, fontSize: T.body, fontWeight: '600' },
  retry: {
    alignSelf: 'flex-start', paddingHorizontal: T.md, paddingVertical: T.sm,
    backgroundColor: T.surface2, borderRadius: T.radiusSm,
  },
  retryText: { color: T.text, fontWeight: '700' },

  summaryRow: { flexDirection: 'row', gap: T.sm, marginBottom: T.lg },
  sumCard: {
    flex: 1, backgroundColor: T.surface1, borderWidth: 1,
    borderRadius: T.radius, padding: T.md, gap: T.xs,
  },
  sumLabel: { color: T.textSecondary, fontSize: T.small, fontWeight: '600' },
  sumValue: { fontSize: T.h1, fontWeight: '800' },

  emptyBox: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.xl, alignItems: 'center', gap: T.sm,
  },
  emptyTitle: { color: T.text, fontSize: T.h2, fontWeight: '700', marginTop: T.sm },
  emptyText: { color: T.textSecondary, fontSize: T.body, textAlign: 'center', lineHeight: 22 },
  cta: {
    marginTop: T.md, flexDirection: 'row', alignItems: 'center', gap: T.sm,
    backgroundColor: T.primary, paddingVertical: T.md, paddingHorizontal: T.xl,
    borderRadius: T.radius,
  },
  ctaText: { color: T.bg, fontWeight: '800', fontSize: T.body },

  sectionLabel: {
    color: T.textMuted, fontSize: T.tiny, fontWeight: '800',
    letterSpacing: 1.4, marginTop: T.md, marginBottom: T.sm,
  },
  list: { gap: T.sm },
  card: {
    backgroundColor: T.surface1, borderWidth: 1,
    borderRadius: T.radius, padding: T.md, gap: T.xs,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: T.xs },
  cardBadge: { fontSize: T.tiny, fontWeight: '800', letterSpacing: 1 },
  cardSeverity: { color: T.textMuted, fontSize: T.tiny, fontWeight: '700' },
  cardTitle: { color: T.text, fontSize: T.body, fontWeight: '700', marginTop: T.xs },
  cardProject: { color: T.textMuted, fontSize: T.tiny, fontWeight: '600' },
  cardReason: { color: T.textSecondary, fontSize: T.small, lineHeight: 20, marginTop: T.xs },
});
