import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { runtime } from '../../src/runtime';
import DevRecommendedModules from '../../src/dev-recommended-modules';
import DevMotivation from '../../src/dev-motivation';
import DevOpportunitiesPressure from '../../src/dev-opportunities-pressure';
import DevRetentionLayer from '../../src/dev-retention-layer';
import { QualityBadge } from '../../src/quality-badge';
import { ReliabilityBadge } from '../../src/reliability-badge';
import { SystemActionsFeed } from '../../src/system-actions-feed';
import NotificationBell from '../../src/notification-bell';
import DeveloperOnboardingCard from '../../src/developer-onboarding-card';
import T from '../../src/theme';

export default function DevHome() {
  const [data, setData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  // ARCHITECTURE.md: UI is a projection. /api/dev/work is the canonical contract.
  // Empty catch preserved verbatim — read-only screens recover on next refresh.
  const load = useCallback(async () => {
    try {
      const { data: payload } = await runtime.get('/api/dev/work');
      setData(payload);
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const summary = data?.summary || {};
  const activeList = data?.active || [];
  const qaList = data?.qa || [];
  const blockedList = data?.blocked || [];
  // Render all three status buckets as one "Active Modules" list — but DO NOT
  // aggregate totals here; total_count comes straight from summary.
  const modulesToRender = [...activeList, ...qaList, ...blockedList];
  const statusColor = (s: string) => {
    const map: Record<string, string> = {
      open: T.info, reserved: T.textMuted, in_progress: T.primary,
      qa_review: T.risk, review: T.risk, paused: T.risk,
      done: T.success, qa_done: T.success,
    };
    return map[s] || T.textMuted;
  };

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={T.primary} />}>
      <View testID="developer-home" style={s.content}>
        <View style={s.titleRow}>
          {/* Bell is provided by the global app-header — no inline duplicate here. */}
          <Text style={s.title}>Execution Hub</Text>
        </View>

        {/* Onboarding card for new developers — auto-dismisses after first earnings */}
        <DeveloperOnboardingCard
          userId={data?.developer?.developer_id}
          hasZeroActivity={
            (summary.earned || 0) === 0 &&
            (summary.active_count || 0) === 0 &&
            (summary.qa_count || 0) === 0
          }
        />

        <QualityBadge />
        <ReliabilityBadge />
        <SystemActionsFeed limit={3} />

        <DevMotivation />
        <DevOpportunitiesPressure />
        <DevRecommendedModules />

        <View style={s.earningsRow}>
          <View style={[s.earningCard, { borderLeftColor: T.success }]}>
            <Text style={s.earningVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>${summary.earned || 0}</Text>
            <Text style={s.earningLabel}>Total Earned</Text>
          </View>
          <View style={[s.earningCard, { borderLeftColor: T.risk }]}>
            <Text style={s.earningVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>${summary.pending || 0}</Text>
            <Text style={s.earningLabel}>Pending QA</Text>
          </View>
          <View style={[s.earningCard, { borderLeftColor: T.info }]}>
            <Text style={s.earningVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>${summary.paid || 0}</Text>
            <Text style={s.earningLabel}>Paid</Text>
          </View>
        </View>

        {/* Retention layer: money pressure + today earnings + focus now.
            Живой слой эмоций поверх аналитики — не заменяет, а усиливает. */}
        <DevRetentionLayer />

        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Active Modules ({summary.active_count || 0}/{(summary.active_count || 0) + (summary.qa_count || 0) + (summary.blocked_count || 0)})</Text>
            {data?.headline ? <Text style={s.headline}>{data.headline}</Text> : null}
          </View>
          {modulesToRender.map((m: any) => (
            <TouchableOpacity key={m.module_id} testID={`dev-home-module-${m.module_id}`} style={s.moduleCard}
              onPress={() => router.push(`/developer/module/${m.module_id}`)}>
              <View style={[s.statusDot, { backgroundColor: statusColor(m.status) }]} />
              <View style={s.moduleInfo}>
                <Text style={s.moduleName}>{m.title || m.module_title}</Text>
                <Text style={s.moduleMeta}>${m.final_price || m.price || 0} · {m.estimated_hours || 0}h</Text>
              </View>
              <View style={s.statusBadge}>
                <Text style={[s.statusText, { color: statusColor(m.status) }]}>{String(m.status || '').replace('_', ' ')}</Text>
              </View>
            </TouchableOpacity>
          ))}
          {modulesToRender.length === 0 && (
            <TouchableOpacity style={s.emptyAction} onPress={() => router.push('/developer/market')}>
              <Text style={s.emptyText}>No active modules</Text>
              <Text style={s.emptyLink}>Browse Marketplace</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Available ({(data?.available || []).length})</Text>
          {(data?.available || []).slice(0, 3).map((m: any) => (
            <View key={m.module_id} style={s.moduleCard}>
              <View style={[s.statusDot, { backgroundColor: T.info }]} />
              <View style={s.moduleInfo}>
                <Text style={s.moduleName}>{m.title}</Text>
                <Text style={s.moduleMeta}>${m.final_price || m.price || 0} · {m.estimated_hours || 0}h</Text>
              </View>
            </View>
          ))}
          {(data?.available || []).length === 0 && (
            <Text style={s.emptyText}>No open modules available right now</Text>
          )}
        </View>

        {data?.rank ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Rank</Text>
            <View style={s.growthGrid}>
              <View style={s.growthItem}><Text style={s.growthVal}>#{data.rank.rank || '-'}</Text><Text style={s.growthLabel}>Position</Text></View>
              <View style={s.growthItem}><Text style={s.growthVal}>{data.rank.combined_score ?? '-'}</Text><Text style={s.growthLabel}>Score</Text></View>
              <View style={s.growthItem}><Text style={s.growthVal}>{data.rank.band || '-'}</Text><Text style={s.growthLabel}>Band</Text></View>
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md },
  title: { color: T.text, fontSize: T.h1, fontWeight: '800', marginBottom: T.lg },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: T.lg },
  earningsRow: { flexDirection: 'row', gap: T.sm, marginBottom: T.lg },
  earningCard: { flex: 1, backgroundColor: T.surface1, borderRadius: T.radiusSm, padding: T.md, borderLeftWidth: 3, borderWidth: 1, borderColor: T.border },
  earningVal: { color: T.text, fontSize: T.h3, fontWeight: '700' },
  earningLabel: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },
  section: { marginBottom: T.lg },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: T.sm },
  sectionTitle: { color: T.textMuted, fontSize: T.small, textTransform: 'uppercase', letterSpacing: 2 },
  moduleCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface1, borderRadius: T.radiusSm, padding: T.md, marginBottom: T.sm, borderWidth: 1, borderColor: T.border },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: T.sm },
  moduleInfo: { flex: 1 },
  moduleName: { color: T.text, fontSize: T.body, fontWeight: '600' },
  moduleMeta: { color: T.textMuted, fontSize: T.small, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: T.tiny, fontWeight: '600', textTransform: 'capitalize' },
  emptyAction: { backgroundColor: T.surface1, borderRadius: T.radiusSm, padding: T.lg, alignItems: 'center', borderWidth: 1, borderColor: T.border, borderStyle: 'dashed' },
  emptyText: { color: T.textMuted, fontSize: T.body },
  emptyLink: { color: T.primary, fontSize: T.body, fontWeight: '600', marginTop: T.sm },
  growthGrid: { flexDirection: 'row', gap: T.sm },
  growthItem: { flex: 1, backgroundColor: T.surface1, borderRadius: T.radiusSm, padding: T.md, alignItems: 'center', borderWidth: 1, borderColor: T.border },
  growthVal: { color: T.text, fontSize: T.h3, fontWeight: '700' },
  growthLabel: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },
  marketBanner: { backgroundColor: T.primaryBg, borderRadius: T.radiusSm, padding: T.md, flexDirection: 'row', alignItems: 'center', gap: T.sm, borderWidth: 1, borderColor: T.primaryBorder },
  marketText: { color: T.primary, fontSize: T.body, fontWeight: '600', flex: 1 },
});
