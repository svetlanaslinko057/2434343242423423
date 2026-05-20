import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../../src/api';
import T from '../../src/theme';

export default function OperatorHistoryScreen() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.get('/operator/history'); setData(r.data); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const sevColor = (s: string) => s === 'critical' ? T.danger : s === 'high' ? T.risk : s === 'medium' ? T.info : T.textMuted;
  const typeIcon = (tp: string) => tp === 'payment_risk' ? 'card' : tp === 'low_liquidity' ? 'trending-down' : tp === 'slow_bidding' ? 'time' : tp === 'underpriced' ? 'pricetag' : tp === 'qa_bottleneck' ? 'search' : tp === 'idle_developer' ? 'person' : 'flash';
  const prettyDate = (d: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (d === today) return 'Today';
    if (d === yest) return 'Yesterday';
    return d;
  };
  const prettyTime = (ts: string) => {
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        style={s.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={T.primary} />}
      >
        <View style={s.header}>
          <TouchableOpacity testID="history-back" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={22} color={T.textMuted} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Execution History</Text>
            <Text style={s.subtitle}>{data?.total || 0} action(s) executed</Text>
          </View>
        </View>

        {data && (
          <View style={s.summary}>
            <View style={s.summaryItem}>
              <Text style={[s.summaryVal, { color: T.primary }]}>{data.by_trigger?.system || 0}</Text>
              <Text style={s.summaryLabel}>By System</Text>
            </View>
            <View style={s.summaryItem}>
              <Text style={[s.summaryVal, { color: T.info }]}>{data.by_trigger?.user || 0}</Text>
              <Text style={s.summaryLabel}>By Admin</Text>
            </View>
            <View style={s.summaryItem}>
              <Text style={s.summaryVal}>{data.total || 0}</Text>
              <Text style={s.summaryLabel}>Total</Text>
            </View>
          </View>
        )}

        {(data?.groups || []).map((g: any) => (
          <View key={g.date} style={s.group}>
            <Text style={s.dateLabel}>{prettyDate(g.date)}</Text>
            {g.items.map((it: any) => (
              <View key={it.history_id} testID={`history-item-${it.type}`} style={s.item}>
                <View style={[s.iconWrap, { backgroundColor: sevColor(it.severity) + '15' }]}>
                  <Ionicons name={typeIcon(it.type) as any} size={16} color={sevColor(it.severity)} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={s.itemHeader}>
                    <Text style={s.itemTitle}>{it.title}</Text>
                    <View style={[s.trigger, it.triggered_by === 'system' ? s.triggerSystem : s.triggerUser]}>
                      <Ionicons name={it.triggered_by === 'system' ? 'flash' : 'person'} size={10} color={it.triggered_by === 'system' ? T.primary : T.info} />
                      <Text style={[s.triggerText, { color: it.triggered_by === 'system' ? T.primary : T.info }]}>
                        {it.triggered_by === 'system' ? 'SYSTEM' : 'ADMIN'}
                      </Text>
                    </View>
                  </View>
                  <Text style={s.itemProject}>{it.project || '—'}</Text>
                  {it.result?.details && <Text style={s.itemResult}>{it.result.details}</Text>}
                  <Text style={s.itemTime}>{prettyTime(it.created_at)}</Text>
                </View>
              </View>
            ))}
          </View>
        ))}

        {(data?.groups || []).length === 0 && (
          <View style={s.empty}>
            <Ionicons name="time-outline" size={48} color={T.textMuted} />
            <Text style={s.emptyTitle}>No actions yet</Text>
            <Text style={s.emptyDesc}>System actions will appear here as they are executed.</Text>
          </View>
        )}
        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: T.md, gap: T.sm },
  backBtn: { padding: 4 },
  title: { color: T.text, fontSize: T.h1, fontWeight: '800' },
  subtitle: { color: T.textMuted, fontSize: T.small },
  summary: { flexDirection: 'row', gap: T.sm, paddingHorizontal: T.md, marginBottom: T.md },
  summaryItem: { flex: 1, backgroundColor: T.surface1, borderRadius: T.radiusSm, padding: T.md, alignItems: 'center', borderWidth: 1, borderColor: T.border },
  summaryVal: { color: T.text, fontSize: T.h2, fontWeight: '800' },
  summaryLabel: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },
  group: { marginBottom: T.md },
  dateLabel: { color: T.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 2, paddingHorizontal: T.md, marginBottom: T.sm },
  item: { flexDirection: 'row', backgroundColor: T.surface1, borderRadius: T.radiusSm, padding: T.md, marginHorizontal: T.md, marginBottom: 6, borderWidth: 1, borderColor: T.border, gap: 10 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  itemTitle: { color: T.text, fontSize: T.small, fontWeight: '700', flex: 1 },
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  triggerSystem: { backgroundColor: T.primaryBgStrong },
  triggerUser: { backgroundColor: T.infoBgStrong },
  triggerText: { fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  itemProject: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },
  itemResult: { color: T.success, fontSize: T.small, marginTop: 4, fontWeight: '600' },
  itemTime: { color: T.textMuted, fontSize: T.tiny, marginTop: 4 },
  empty: { alignItems: 'center', paddingVertical: T.xl * 2, gap: 8 },
  emptyTitle: { color: T.text, fontSize: T.h2, fontWeight: '700' },
  emptyDesc: { color: T.textMuted, fontSize: T.body, textAlign: 'center', paddingHorizontal: T.lg },
});
