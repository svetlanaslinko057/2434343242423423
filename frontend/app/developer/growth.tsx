/**
 * Developer Intelligence — GROWTH
 *
 * How you grow. Projection of dev economy (Q/S/T/E breakdown + tier progress).
 *
 * Source: GET /api/developer/intelligence/growth
 * Access: Profile → Developer insights → Growth (not a tab)
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

type GrowthResp = {
  score: number;
  tier: string;
  tier_label: string;
  next_tier: string | null;
  next_tier_label: string | null;
  remaining_to_next: number;
  progress_pct: number;
  components: {
    quality: number;
    speed: number;
    trust: number;
    earnings: number;
  };
  stats: {
    completed_modules: number;
    active_modules: number;
    qa_pass_rate: number;
    revisions: number;
    earned_lifetime: number;
  };
  economics: {
    tier_rate: number;
    tier_rate_pct: number;
    avg_module_earning: number;
  };
  hints_to_next_tier: string[];
  generated_at: string;
};

export default function DeveloperGrowth() {
  const router = useRouter();
  const [data, setData] = useState<GrowthResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const r = await runtime.get<GrowthResp>('/api/developer/intelligence/growth');
      setData(r.data);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Failed to load growth data');
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
        testID="growth-screen"
      >
        <View style={s.head}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="growth-back">
            <Ionicons name="chevron-back" size={24} color={T.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.h1}>Growth</Text>
            <Text style={s.subtitle}>How close you are to the next tier</Text>
          </View>
        </View>

        {loading && <View style={s.center}><ActivityIndicator color={T.primary} /></View>}

        {err && !loading && (
          <View style={s.errBox} testID="growth-error">
            <Text style={s.errText}>{err}</Text>
            <TouchableOpacity style={s.retry} onPress={() => { setLoading(true); void load(); }}>
              <Text style={s.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {data && (
          <>
            {/* Tier hero */}
            <View style={s.tierCard} testID="growth-tier">
              <Text style={s.tierLabel}>{data.tier_label.toUpperCase()}</Text>
              <Text style={s.tierScore}>{Math.round(data.score)}</Text>
              <Text style={s.tierScoreLabel}>score</Text>

              <View style={s.progressTrack}>
                <View style={[s.progressFill, { width: `${data.progress_pct}%` }]} />
              </View>
              {data.next_tier_label ? (
                <Text style={s.tierNext}>
                  {data.next_tier_label} in {data.remaining_to_next} pts
                </Text>
              ) : (
                <Text style={s.tierNext}>Top tier — keep defending your position</Text>
              )}
            </View>

            {/* Economics — Dynamic Pricing (internal, dev-only) */}
            {data.economics && (
              <View style={s.econBox} testID="growth-economics">
                <View style={s.econRow}>
                  <Ionicons name="cash-outline" size={18} color={T.primary} />
                  <Text style={s.econLine}>
                    You earn <Text style={s.econStrong}>~{data.economics.tier_rate_pct}%</Text> per module
                  </Text>
                </View>
                {data.economics.avg_module_earning > 0 && (
                  <Text style={s.econSub}>
                    Average module earning: ${Math.round(data.economics.avg_module_earning)}
                  </Text>
                )}
                <Text style={s.econHint}>Higher tier → higher payout</Text>
              </View>
            )}

            {/* Components */}
            <Text style={s.sectionLabel}>COMPONENTS</Text>
            <View style={s.componentsGrid}>
              <CompRow label="Quality" value={data.components.quality} suffix="%" good={85} warn={70} />
              <CompRow label="Speed" value={data.components.speed} suffix="%" good={85} warn={70} />
              <CompRow label="Trust" value={data.components.trust} suffix="%" good={80} warn={60} />
              <CompRow label="Earnings" value={data.components.earnings} prefix="$" good={2000} warn={500} />
            </View>

            {/* Stats */}
            <Text style={s.sectionLabel}>STATS</Text>
            <View style={s.statsBox}>
              <StatRow label="Completed modules" value={String(data.stats.completed_modules)} />
              <StatRow label="Active modules" value={String(data.stats.active_modules)} />
              <StatRow label="QA pass rate" value={`${data.stats.qa_pass_rate}%`} />
              <StatRow label="Revisions" value={String(data.stats.revisions)} />
              <StatRow label="Lifetime earned" value={`$${Math.round(data.stats.earned_lifetime)}`} />
            </View>

            {/* Hints */}
            {data.hints_to_next_tier?.length > 0 && data.next_tier_label && (
              <>
                <Text style={s.sectionLabel}>TO REACH {data.next_tier_label.toUpperCase()}</Text>
                <View style={s.hintsBox} testID="growth-hints">
                  {data.hints_to_next_tier.map((h, i) => (
                    <View key={i} style={s.hintRow}>
                      <Ionicons name="arrow-forward" size={14} color={T.primary} />
                      <Text style={s.hintText}>{h}</Text>
                    </View>
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

function colorFor(value: number, good: number, warn: number): string {
  if (value >= good) return T.success;
  if (value >= warn) return T.risk;
  return T.danger;
}

function CompRow({
  label, value, prefix, suffix, good, warn,
}: {
  label: string; value: number;
  prefix?: string; suffix?: string;
  good: number; warn: number;
}) {
  const c = colorFor(value, good, warn);
  return (
    <View style={s.compCard} testID={`growth-comp-${label.toLowerCase()}`}>
      <Text style={s.compLabel}>{label}</Text>
      <Text style={[s.compValue, { color: c }]}>
        {prefix || ''}{Math.round(value)}{suffix || ''}
      </Text>
    </View>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.statRow}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
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

  tierCard: {
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.primaryBorder,
    borderRadius: T.radius, padding: T.xl, alignItems: 'center', marginBottom: T.lg,
  },
  tierLabel: { color: T.primary, fontSize: T.tiny, fontWeight: '800', letterSpacing: 2 },
  tierScore: { color: T.text, fontSize: 56, fontWeight: '800', marginTop: T.sm },
  tierScoreLabel: { color: T.textMuted, fontSize: T.tiny, fontWeight: '700', letterSpacing: 1.4 },
  progressTrack: {
    height: 8, borderRadius: 4, backgroundColor: T.surface3,
    width: '100%', marginTop: T.lg, overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: T.primary, borderRadius: 4 },
  tierNext: { color: T.textSecondary, fontSize: T.small, marginTop: T.sm },

  econBox: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.primaryBorder,
    borderRadius: T.radius, padding: T.md, marginBottom: T.lg,
    gap: 4,
  },
  econRow: { flexDirection: 'row', alignItems: 'center', gap: T.sm },
  econLine: { color: T.text, fontSize: T.body, fontWeight: '600' },
  econStrong: { color: T.primary, fontWeight: '800' },
  econSub: { color: T.textSecondary, fontSize: T.small, marginLeft: 26 },
  econHint: { color: T.textMuted, fontSize: T.tiny, marginLeft: 26, marginTop: 2 },

  sectionLabel: {
    color: T.textMuted, fontSize: T.tiny, fontWeight: '800',
    letterSpacing: 1.4, marginBottom: T.sm, marginTop: T.md,
  },

  componentsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: T.sm },
  compCard: {
    flexGrow: 1, flexBasis: '47%',
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius, padding: T.md, gap: T.xs,
  },
  compLabel: { color: T.textSecondary, fontSize: T.small, fontWeight: '600' },
  compValue: { fontSize: T.h2, fontWeight: '800' },

  statsBox: {
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius, padding: T.md, gap: T.sm,
  },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { color: T.textSecondary, fontSize: T.body },
  statValue: { color: T.text, fontSize: T.body, fontWeight: '700' },

  hintsBox: {
    backgroundColor: T.primaryBg,
    borderRadius: T.radius, borderWidth: 1, borderColor: T.primaryBorder,
    padding: T.md, gap: T.sm,
  },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: T.sm },
  hintText: { color: T.text, fontSize: T.body, flex: 1 },
});
