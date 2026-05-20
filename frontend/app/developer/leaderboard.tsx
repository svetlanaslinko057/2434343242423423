/**
 * Developer Intelligence — LEADERBOARD
 *
 * Where you stand among developers. Projection of dev economy score.
 *
 * Source: GET /api/developer/intelligence/leaderboard
 * Access: Profile → Developer insights → Leaderboard (not a tab)
 *
 * States:
 *  - loading   → spinner
 *  - forming   → honest "not enough activity" + Go to Work CTA
 *  - ready     → top 5 + your position
 *  - error     → retry
 *
 * Hard rules: no mock data, no fake names, no empty "No data" screen.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { runtime } from '../../src/runtime';
import T from '../../src/theme';

type TopRow = {
  rank: number;
  name: string;
  score: number;
  tier: string;
  tier_label: string;
  qa_pass_rate: number;
  completed_modules: number;
  is_me: boolean;
};

type MeRow = {
  user_id: string;
  rank: number | null;
  score: number;
  tier: string;
  tier_label: string;
};

type LeaderboardResp = {
  status: 'ready' | 'forming';
  me: MeRow;
  top: TopRow[];
  total_developers: number;
  reason?: string;
  generated_at: string;
};

export default function DeveloperLeaderboard() {
  const router = useRouter();
  const [data, setData] = useState<LeaderboardResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const r = await runtime.get<LeaderboardResp>('/api/developer/intelligence/leaderboard');
      setData(r.data);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Failed to load leaderboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); void load(); };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} />}
        testID="leaderboard-screen"
      >
        {/* Header */}
        <View style={s.head}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="leaderboard-back">
            <Ionicons name="chevron-back" size={24} color={T.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.h1} testID="leaderboard-title">Leaderboard</Text>
            <Text style={s.subtitle}>Where you stand among developers</Text>
          </View>
        </View>

        {loading && (
          <View style={s.center} testID="leaderboard-loading">
            <ActivityIndicator color={T.primary} />
          </View>
        )}

        {err && !loading && (
          <View style={s.errBox} testID="leaderboard-error">
            <Text style={s.errText}>{err}</Text>
            <TouchableOpacity style={s.retry} onPress={() => { setLoading(true); void load(); }}>
              <Text style={s.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {data && data.status === 'forming' && (
          <View style={s.formingBox} testID="leaderboard-forming">
            <Ionicons name="trending-up" size={28} color={T.primary} />
            <Text style={s.formingTitle}>Leaderboard is forming</Text>
            <Text style={s.formingText}>
              {data.reason || 'You\u2019re one of the first developers. Start completing modules to shape the ranking.'}
            </Text>
            <TouchableOpacity
              style={s.cta}
              onPress={() => router.push('/developer/work' as any)}
              testID="leaderboard-go-work"
            >
              <Text style={s.ctaText}>Go to Work</Text>
              <Ionicons name="arrow-forward" size={18} color={T.bg} />
            </TouchableOpacity>
          </View>
        )}

        {data && data.status === 'ready' && (
          <>
            {/* Your position card */}
            <View style={s.meCard} testID="leaderboard-me">
              <Text style={s.meEyebrow}>YOU</Text>
              <View style={s.meRow}>
                <Text style={s.meRank}>#{data.me.rank ?? '-'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.meTier}>{data.me.tier_label}</Text>
                  <Text style={s.meScore}>{Math.round(data.me.score)} score</Text>
                </View>
                <View style={s.meBadge}>
                  <Text style={s.meBadgeText}>of {data.total_developers}</Text>
                </View>
              </View>
            </View>

            {/* Top list */}
            <Text style={s.sectionLabel}>TOP DEVELOPERS</Text>
            <View style={s.list}>
              {data.top.map((row) => (
                <LeaderRow key={row.rank} row={row} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}

function LeaderRow({ row }: { row: TopRow }) {
  const medal =
    row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : null;
  return (
    <View style={[s.row, row.is_me && s.rowMe]} testID={`leaderboard-row-${row.rank}`}>
      <View style={s.rankWrap}>
        {medal ? (
          <Text style={s.medal}>{medal}</Text>
        ) : (
          <Text style={s.rank}>{row.rank}</Text>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.name} numberOfLines={1}>{row.name}{row.is_me ? '  · you' : ''}</Text>
        <Text style={s.meta}>
          {row.tier_label} · QA {row.qa_pass_rate}% · {row.completed_modules} modules
        </Text>
      </View>
      <Text style={s.score}>{Math.round(row.score)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md, paddingBottom: T.xxl * 2 },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: T.lg, gap: T.sm },
  backBtn: { width: 32, height: 32, alignItems: 'flex-start', justifyContent: 'center' },
  h1: { color: T.text, fontSize: T.h1, fontWeight: '800', letterSpacing: -0.3 },
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
  formingBox: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.xl, alignItems: 'center', gap: T.sm,
  },
  formingTitle: { color: T.text, fontSize: T.h2, fontWeight: '700', marginTop: T.sm },
  formingText: { color: T.textSecondary, fontSize: T.body, textAlign: 'center', lineHeight: 22 },
  cta: {
    marginTop: T.md, flexDirection: 'row', alignItems: 'center', gap: T.sm,
    backgroundColor: T.primary, paddingVertical: T.md, paddingHorizontal: T.xl,
    borderRadius: T.radius,
  },
  ctaText: { color: T.bg, fontWeight: '800', fontSize: T.body },
  meCard: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.primaryBorder,
    padding: T.md, gap: T.sm, marginBottom: T.lg,
  },
  meEyebrow: { color: T.primary, fontSize: T.tiny, fontWeight: '800', letterSpacing: 1.4 },
  meRow: { flexDirection: 'row', alignItems: 'center', gap: T.md },
  meRank: { color: T.text, fontSize: 38, fontWeight: '800', minWidth: 72 },
  meTier: { color: T.text, fontSize: T.h3, fontWeight: '700' },
  meScore: { color: T.textSecondary, fontSize: T.small, marginTop: 2 },
  meBadge: {
    backgroundColor: T.surface2, borderRadius: T.radiusSm,
    paddingHorizontal: T.sm, paddingVertical: 4,
  },
  meBadgeText: { color: T.textSecondary, fontSize: T.tiny, fontWeight: '700' },
  sectionLabel: {
    color: T.textMuted, fontSize: T.tiny, fontWeight: '800',
    letterSpacing: 1.4, marginBottom: T.sm,
  },
  list: { gap: T.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: T.md,
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.md,
  },
  rowMe: { borderColor: T.primaryBorder, backgroundColor: T.primaryBg },
  rankWrap: { width: 36, alignItems: 'center' },
  medal: { fontSize: 22 },
  rank: { color: T.textSecondary, fontSize: T.body, fontWeight: '800' },
  name: { color: T.text, fontSize: T.body, fontWeight: '700' },
  meta: { color: T.textSecondary, fontSize: T.tiny, marginTop: 2 },
  score: { color: T.text, fontSize: T.h3, fontWeight: '800' },
});
