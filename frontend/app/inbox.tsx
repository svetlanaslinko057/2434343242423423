import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../src/api';
import { useAuth } from '../src/auth';
import RecommendedActionHero from '../src/recommended-action';
import T from '../src/theme';

export default function InboxScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [pressure, setPressure] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [actRes, presRes] = await Promise.all([
        api.get('/global/actions'),
        api.get('/global/pressure'),
      ]);
      setData(actRes.data);
      setPressure(presRes.data);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const sevColor = (s: string) => s === 'critical' ? T.danger : s === 'high' ? T.risk : s === 'medium' ? T.info : T.textMuted;
  const sevIcon = (t: string) => t === 'pay_invoice' ? 'card' : t === 'review_qa' ? 'search' : t === 'approve_deliverable' ? 'checkmark-done' : t === 'start_work' ? 'code-working' : t === 'sign_contract' ? 'create' : t === 'price_cr' ? 'pricetag' : t === 'submit_work' ? 'cloud-upload' : t === 'overdue_alert' ? 'alert-circle' : t === 'support_tickets' ? 'chatbubble-ellipses' : 'flash';

  const handleAction = (action: any) => {
    if (action.project_id) {
      router.push(`/workspace/${action.project_id}` as any);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} />}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity testID="inbox-back" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={22} color={T.textMuted} />
          </TouchableOpacity>
          <View>
            <Text style={s.title}>Action Center</Text>
            <Text style={s.subtitle}>{data?.total || 0} items need attention</Text>
          </View>
        </View>

        {/* Recommended Action */}
        {data?.recommended && (
          <View style={s.section}>
            <RecommendedActionHero action={data.recommended} onPress={() => handleAction(data.recommended)} />
          </View>
        )}

        {/* All Actions */}
        <View style={s.section}>
          <Text style={s.sLabel}>YOU NEED TO ACT</Text>
          {(data?.actions || []).filter((a: any) => a !== data?.recommended).map((action: any, i: number) => (
            <TouchableOpacity key={i} testID={`action-item-${i}`} style={[s.actionCard, { borderLeftColor: sevColor(action.severity) }]} onPress={() => handleAction(action)}>
              <View style={[s.actionIcon, { backgroundColor: sevColor(action.severity) + '15' }]}>
                <Ionicons name={sevIcon(action.type) as any} size={18} color={sevColor(action.severity)} />
              </View>
              <View style={s.actionInfo}>
                <Text style={s.actionTitle}>{action.title}</Text>
                <Text style={s.actionSub}>{action.subtitle}</Text>
                <Text style={[s.actionImpact, { color: sevColor(action.severity) }]}>{action.impact}</Text>
              </View>
              {action.amount != null && <Text style={[s.actionAmount, { color: sevColor(action.severity) }]}>${action.amount}</Text>}
              <Ionicons name="chevron-forward" size={16} color={T.textMuted} />
            </TouchableOpacity>
          ))}
          {(data?.actions || []).length <= 1 && !data?.recommended && <Text style={s.empty}>No pending actions</Text>}
        </View>

        {/* Cross-Project Pressure */}
        {pressure && (
          <View style={s.section}>
            <Text style={s.sLabel}>SYSTEM PRESSURE</Text>
            <View style={s.pressureGrid}>
              <View style={[s.pressureItem, pressure.summary.blocked > 0 && { borderColor: T.dangerBorder }]}>
                <Text style={[s.pressureVal, pressure.summary.blocked > 0 && { color: T.danger }]}>{pressure.summary.blocked}</Text>
                <Text style={s.pressureLabel}>Blocked</Text>
              </View>
              <View style={[s.pressureItem, pressure.summary.at_risk > 0 && { borderColor: T.riskBorder }]}>
                <Text style={[s.pressureVal, pressure.summary.at_risk > 0 && { color: T.risk }]}>{pressure.summary.at_risk}</Text>
                <Text style={s.pressureLabel}>At Risk</Text>
              </View>
              <View style={s.pressureItem}>
                <Text style={[s.pressureVal, pressure.summary.total_overdue > 0 ? { color: T.danger } : {}]}>${pressure.summary.total_overdue}</Text>
                <Text style={s.pressureLabel}>Overdue</Text>
              </View>
              <View style={s.pressureItem}>
                <Text style={s.pressureVal}>{pressure.summary.total_qa_queue}</Text>
                <Text style={s.pressureLabel}>QA Queue</Text>
              </View>
            </View>

            {/* Project Cards sorted by risk */}
            {pressure.projects.map((pc: any) => {
              const tColor = pc.trust_score >= 85 ? T.primary : pc.trust_score >= 70 ? T.info : pc.trust_score >= 40 ? T.risk : T.danger;
              const hColor = pc.health === 'on_track' ? T.success : pc.health === 'attention' ? T.risk : pc.health === 'blocked' ? T.danger : T.info;
              return (
                <TouchableOpacity key={pc.project_id} testID={`pressure-project-${pc.project_id}`} style={[s.projectCard, { borderLeftColor: tColor }]} onPress={() => router.push(`/workspace/${pc.project_id}` as any)}>
                  <View style={s.projectHeader}>
                    <Text style={s.projectTitle}>{pc.title}</Text>
                    <View style={[s.trustBadge, { backgroundColor: tColor + '15' }]}>
                      <Text style={[s.trustScore, { color: tColor }]}>{pc.trust_score}</Text>
                      <Ionicons name={pc.trust_trend === 'up' ? 'trending-up' : pc.trust_trend === 'down' ? 'trending-down' : 'remove'} size={12} color={tColor} />
                    </View>
                  </View>
                  <View style={s.projectMeta}>
                    <View style={[s.healthDot, { backgroundColor: hColor }]} />
                    <Text style={[s.healthText, { color: hColor }]}>{pc.health?.replace('_', ' ')}</Text>
                    <Text style={s.projectProgress}>{pc.progress}%</Text>
                    <Text style={s.projectModules}>{pc.modules_done}/{pc.modules_total}</Text>
                  </View>
                  <Text style={s.projectRisk}>{pc.top_risk}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  container: { flex: 1, backgroundColor: T.bg },
  header: { flexDirection: 'row', alignItems: 'center', padding: T.md, gap: T.sm },
  backBtn: { padding: 4 },
  title: { color: T.text, fontSize: T.h1, fontWeight: '800' },
  subtitle: { color: T.textMuted, fontSize: T.small },
  section: { paddingHorizontal: T.md, marginBottom: T.lg },
  sLabel: { color: T.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: T.sm },
  actionCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface1, borderRadius: T.radiusSm, padding: T.md, marginBottom: 6, borderLeftWidth: 3, borderWidth: 1, borderColor: T.border, gap: T.sm },
  actionIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionInfo: { flex: 1 },
  actionTitle: { color: T.text, fontSize: T.body, fontWeight: '600' },
  actionSub: { color: T.textMuted, fontSize: T.small, marginTop: 1 },
  actionImpact: { fontSize: T.tiny, fontWeight: '600', marginTop: 2 },
  actionAmount: { fontSize: T.h3, fontWeight: '800' },
  empty: { color: T.textMuted, textAlign: 'center', paddingVertical: T.xl },
  pressureGrid: { flexDirection: 'row', gap: T.sm, marginBottom: T.md },
  pressureItem: { flex: 1, backgroundColor: T.surface1, borderRadius: T.radiusSm, padding: T.md, alignItems: 'center', borderWidth: 1, borderColor: T.border },
  pressureVal: { color: T.text, fontSize: T.h2, fontWeight: '800' },
  pressureLabel: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },
  projectCard: { backgroundColor: T.surface1, borderRadius: T.radiusSm, padding: T.md, marginBottom: 6, borderLeftWidth: 3, borderWidth: 1, borderColor: T.border },
  projectHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  projectTitle: { color: T.text, fontSize: T.body, fontWeight: '700', flex: 1 },
  trustBadge: { flexDirection: 'row', alignItems: 'center', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, gap: 4 },
  trustScore: { fontSize: T.small, fontWeight: '800' },
  projectMeta: { flexDirection: 'row', alignItems: 'center', gap: T.sm, marginTop: 4 },
  healthDot: { width: 8, height: 8, borderRadius: 4 },
  healthText: { fontSize: T.tiny, fontWeight: '600', textTransform: 'capitalize' },
  projectProgress: { color: T.textMuted, fontSize: T.tiny },
  projectModules: { color: T.textMuted, fontSize: T.tiny },
  projectRisk: { color: T.risk, fontSize: T.tiny, marginTop: 4, fontStyle: 'italic' },
});
