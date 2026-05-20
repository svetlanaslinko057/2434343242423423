import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../src/api';
import T from '../src/theme';

const LEVELS: { key: 'manual' | 'assisted' | 'auto'; label: string; desc: string }[] = [
  { key: 'manual', label: 'Manual', desc: 'System only suggests — you decide' },
  { key: 'assisted', label: 'Assisted', desc: 'Bulk Auto-Run available on demand' },
  { key: 'auto', label: 'Auto', desc: 'System executes every 5 min automatically' },
];

export default function OperatorScreen() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [level, setLevel] = useState<'manual' | 'assisted' | 'auto'>('manual');
  const [refreshing, setRefreshing] = useState(false);
  const [expandedWhy, setExpandedWhy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const r = await api.get('/operator/feed');
      setData(r.data);
      if (r.data.automation_level) setLevel(r.data.automation_level);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const changeLevel = async (newLevel: 'manual' | 'assisted' | 'auto') => {
    const prev = level;
    setLevel(newLevel);
    try {
      await api.post('/operator/automation', { level: newLevel });
    } catch (e: any) {
      setLevel(prev);
      Alert.alert('Error', e.response?.data?.detail || 'Failed to change level');
    }
  };

  const executeAction = async (actionId: string, title: string) => {
    try {
      const r = await api.post(`/operator/execute/${encodeURIComponent(actionId)}`);
      Alert.alert('Executed', r.data.details || `${title} — done`);
      load();
    } catch (e: any) { Alert.alert('Error', e.response?.data?.detail || 'Failed'); }
  };

  const autoRun = async () => {
    try {
      const r = await api.post('/operator/auto-run');
      Alert.alert('Auto-Run Complete', `${r.data.count} action(s) executed, ${r.data.skipped} skipped`);
      load();
    } catch (e: any) { Alert.alert('Error', e.response?.data?.detail || 'Failed'); }
  };

  const sevColor = (s: string) => s === 'critical' ? T.danger : s === 'high' ? T.risk : s === 'medium' ? T.info : T.textMuted;
  const sevIcon = (t: string) => t === 'payment_risk' ? 'card' : t === 'low_liquidity' ? 'trending-down' : t === 'slow_bidding' ? 'time' : t === 'underpriced' ? 'pricetag' : t === 'qa_bottleneck' ? 'search' : t === 'idle_developer' ? 'person' : 'flash';
  const statusColor = data?.system_status === 'critical' ? T.danger : data?.system_status === 'attention' ? T.risk : T.success;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        style={s.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={T.primary} />}
      >
        <View style={s.header}>
          <TouchableOpacity testID="operator-back" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={22} color={T.textMuted} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>System Intelligence</Text>
            <Text style={s.subtitle}>{data?.total || 0} issues detected</Text>
          </View>
          <TouchableOpacity testID="operator-history-btn" onPress={() => router.push('/operator/history' as any)} style={s.historyBtn}>
            <Ionicons name="time" size={18} color={T.primary} />
          </TouchableOpacity>
          <View style={[s.statusBadge, { backgroundColor: statusColor + '22' }]}>
            <View style={[s.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[s.statusText, { color: statusColor }]}>{data?.system_status || 'scanning'}</Text>
          </View>
        </View>

        {/* AUTOMATION LEVEL TOGGLE */}
        <View style={s.autoWrap}>
          <Text style={s.sLabel}>AUTOMATION</Text>
          <View style={s.segRow}>
            {LEVELS.map((l) => {
              const active = level === l.key;
              return (
                <TouchableOpacity
                  key={l.key}
                  testID={`automation-${l.key}`}
                  style={[s.segBtn, active && s.segActive]}
                  onPress={() => changeLevel(l.key)}
                >
                  <Text style={[s.segText, active && s.segTextActive]}>{l.label}</Text>
                  {l.key === 'auto' && !active && <Text style={s.segHint}>rec.</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={s.autoDesc}>
            {LEVELS.find(l => l.key === level)?.desc}
          </Text>
          {level === 'auto' && (
            <View style={s.autoNote}>
              <Ionicons name="flash" size={12} color={T.primary} />
              <Text style={s.autoNoteText}>Scheduler running every 5 min — actions log to History</Text>
            </View>
          )}
        </View>

        {/* Summary */}
        {data && (
          <View style={s.summaryRow}>
            <View style={[s.summaryItem, data.critical > 0 && { borderColor: T.dangerBorder }]}>
              <Text style={[s.summaryVal, data.critical > 0 && { color: T.danger }]}>{data.critical}</Text>
              <Text style={s.summaryLabel}>Critical</Text>
            </View>
            <View style={s.summaryItem}>
              <Text style={s.summaryVal}>{data.total}</Text>
              <Text style={s.summaryLabel}>Total</Text>
            </View>
            <View style={s.summaryItem}>
              <Text style={[s.summaryVal, { color: T.primary }]}>{data.auto_eligible}</Text>
              <Text style={s.summaryLabel}>Auto</Text>
            </View>
          </View>
        )}

        {/* Auto-Run CTA */}
        {data?.auto_eligible > 0 && level !== 'manual' && (
          <TouchableOpacity testID="operator-auto-run" style={s.autoRunBtn} onPress={autoRun}>
            <Ionicons name="flash" size={18} color={T.bg} />
            <Text style={s.autoRunText}>Auto-Execute {data.auto_eligible} Action{data.auto_eligible > 1 ? 's' : ''}</Text>
          </TouchableOpacity>
        )}
        {data?.auto_eligible > 0 && level === 'manual' && (
          <View style={s.autoRunDisabled}>
            <Ionicons name="lock-closed" size={14} color={T.textMuted} />
            <Text style={s.autoRunDisabledText}>Switch to Assisted or Auto to enable bulk execution</Text>
          </View>
        )}

        {/* Actions Feed */}
        <Text style={[s.sLabel, { marginTop: T.md }]}>OPERATOR ACTIONS</Text>
        {(data?.actions || []).map((action: any) => {
          const whyOpen = expandedWhy[action.id];
          return (
            <View key={action.id} testID={`operator-action-${action.type}`} style={[s.actionCard, { borderLeftColor: sevColor(action.severity) }]}>
              <View style={s.actionHeader}>
                <View style={[s.actionIconWrap, { backgroundColor: sevColor(action.severity) + '15' }]}>
                  <Ionicons name={sevIcon(action.type) as any} size={18} color={sevColor(action.severity)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.actionTitle}>{action.title}</Text>
                  <Text style={s.actionProject}>{action.project}</Text>
                </View>
                <TouchableOpacity
                  testID={`confidence-${action.type}`}
                  style={s.confidenceBadge}
                  onPress={() => setExpandedWhy(prev => ({ ...prev, [action.id]: !prev[action.id] }))}
                >
                  <Text style={s.confidenceVal}>{action.confidence}%</Text>
                  <Ionicons name={whyOpen ? 'chevron-up' : 'chevron-down'} size={10} color={T.textMuted} />
                </TouchableOpacity>
              </View>

              <Text style={s.actionDesc}>{action.description}</Text>

              {/* WHY breakdown */}
              {whyOpen && action.why && (
                <View style={s.whyBox}>
                  <Text style={s.whyLabel}>WHY</Text>
                  {action.why.map((reason: string, i: number) => (
                    <View key={i} style={s.whyRow}>
                      <View style={s.whyDot} />
                      <Text style={s.whyText}>{reason}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={s.suggestionBox}>
                <Ionicons name="bulb" size={14} color={T.primary} />
                <Text style={s.suggestionText}>{action.suggestion}</Text>
              </View>

              {action.expected_impact && (
                <View style={s.impactBox}>
                  <Text style={s.impactLabel}>EXPECTED IMPACT</Text>
                  {Object.entries(action.expected_impact).map(([key, val]) => (
                    <View key={key} style={s.impactRow}>
                      <Text style={s.impactKey}>{key.replace(/_/g, ' ')}</Text>
                      <Text style={s.impactVal}>{String(val)}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={s.actionBtns}>
                {action.auto_eligible && (
                  <TouchableOpacity testID={`execute-${action.type}`} style={s.executeBtn} onPress={() => executeAction(action.id, action.title)}>
                    <Ionicons name="flash" size={14} color={T.bg} />
                    <Text style={s.executeBtnText}>Execute</Text>
                  </TouchableOpacity>
                )}
                {!action.auto_eligible && (
                  <TouchableOpacity testID={`execute-${action.type}`} style={s.executeBtn} onPress={() => executeAction(action.id, action.title)}>
                    <Ionicons name="checkmark" size={14} color={T.bg} />
                    <Text style={s.executeBtnText}>Run</Text>
                  </TouchableOpacity>
                )}
                {action.project_id && (
                  <TouchableOpacity style={s.viewBtn} onPress={() => router.push(`/workspace/${action.project_id}` as any)}>
                    <Text style={s.viewBtnText}>View Project</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}

        {(data?.actions || []).length === 0 && (
          <View style={s.emptyState}>
            <Ionicons name="checkmark-circle" size={48} color={T.success} />
            <Text style={s.emptyTitle}>System Healthy</Text>
            <Text style={s.emptyDesc}>No issues detected</Text>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: T.md, gap: T.sm },
  backBtn: { padding: 4 },
  historyBtn: { backgroundColor: T.primaryBg, padding: 8, borderRadius: 10 },
  title: { color: T.text, fontSize: T.h1, fontWeight: '800' },
  subtitle: { color: T.textMuted, fontSize: T.small },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: T.small, fontWeight: '700', textTransform: 'capitalize' },

  autoWrap: { marginHorizontal: T.md, marginBottom: T.md, backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md, borderWidth: 1, borderColor: T.border },
  sLabel: { color: T.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: T.sm, paddingHorizontal: T.md },
  segRow: { flexDirection: 'row', backgroundColor: T.surface2, borderRadius: T.radiusSm, padding: 3, gap: 3 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 6, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 },
  segActive: { backgroundColor: T.primary },
  segText: { color: T.textMuted, fontWeight: '600', fontSize: T.small },
  segTextActive: { color: T.bg, fontWeight: '800' },
  segHint: { color: T.primary, fontSize: 9, fontWeight: '700' },
  autoDesc: { color: T.textMuted, fontSize: T.small, marginTop: T.sm, textAlign: 'center' },
  autoNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: T.sm, backgroundColor: T.primaryBg, borderRadius: 6, padding: 8 },
  autoNoteText: { color: T.primary, fontSize: T.tiny, fontWeight: '600', flex: 1 },

  summaryRow: { flexDirection: 'row', gap: T.sm, paddingHorizontal: T.md, marginBottom: T.md },
  summaryItem: { flex: 1, backgroundColor: T.surface1, borderRadius: T.radiusSm, padding: T.md, alignItems: 'center', borderWidth: 1, borderColor: T.border },
  summaryVal: { color: T.text, fontSize: T.h2, fontWeight: '800' },
  summaryLabel: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },

  autoRunBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: T.primary, borderRadius: T.radiusSm, padding: 14, marginHorizontal: T.md, marginBottom: T.lg },
  autoRunText: { color: T.bg, fontWeight: '700', fontSize: T.body },
  autoRunDisabled: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: T.surface2, borderRadius: T.radiusSm, padding: 12, marginHorizontal: T.md, marginBottom: T.lg, borderWidth: 1, borderColor: T.border },
  autoRunDisabledText: { color: T.textMuted, fontSize: T.small },

  actionCard: { backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md, marginHorizontal: T.md, marginBottom: T.sm, borderLeftWidth: 3, borderWidth: 1, borderColor: T.border },
  actionHeader: { flexDirection: 'row', alignItems: 'center', gap: T.sm },
  actionIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  actionProject: { color: T.textMuted, fontSize: T.tiny },
  confidenceBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: T.surface2, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  confidenceVal: { color: T.text, fontSize: T.small, fontWeight: '700' },

  actionDesc: { color: T.textMuted, fontSize: T.small, marginTop: T.sm },

  whyBox: { backgroundColor: T.surface3, borderRadius: T.radiusSm, padding: 10, marginTop: T.sm, borderLeftWidth: 2, borderLeftColor: T.info },
  whyLabel: { color: T.info, fontSize: 9, fontWeight: '800', letterSpacing: 2, marginBottom: 4 },
  whyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  whyDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: T.info },
  whyText: { color: T.text, fontSize: T.small, flex: 1 },

  suggestionBox: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: T.sm, backgroundColor: T.primaryBg, borderRadius: T.radiusSm, padding: 10 },
  suggestionText: { color: T.primary, fontSize: T.small, fontWeight: '600', flex: 1 },
  impactBox: { backgroundColor: T.surface2, borderRadius: T.radiusSm, padding: 10, marginTop: T.sm },
  impactLabel: { color: T.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 2, marginBottom: 4 },
  impactRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  impactKey: { color: T.textMuted, fontSize: T.small, textTransform: 'capitalize' },
  impactVal: { color: T.success, fontSize: T.small, fontWeight: '700' },
  actionBtns: { flexDirection: 'row', gap: T.sm, marginTop: T.sm },
  executeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: T.primary, borderRadius: T.radiusSm, paddingHorizontal: 16, paddingVertical: 10 },
  executeBtnText: { color: T.bg, fontWeight: '700', fontSize: T.small },
  viewBtn: { backgroundColor: T.surface2, borderRadius: T.radiusSm, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: T.border },
  viewBtnText: { color: T.text, fontWeight: '600', fontSize: T.small },
  emptyState: { alignItems: 'center', paddingVertical: T.xl * 2 },
  emptyTitle: { color: T.success, fontSize: T.h2, fontWeight: '700', marginTop: T.md },
  emptyDesc: { color: T.textMuted, fontSize: T.body },
});
