import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import T from './theme';

// Compact operator hints inserted at the top of /workspace/[id]
// Shows max 3 critical/high actions scoped to the project, with Execute CTA.

export default function WorkspaceOperatorHints({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [hints, setHints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/projects/${projectId}/operator-hints`);
      setHints(r.data.hints || []);
    } catch {} finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return null;
  if (hints.length === 0) return null;

  const sevColor = (sv: string) => sv === 'critical' ? T.danger : sv === 'high' ? T.risk : T.info;
  const typeIcon = (tp: string) => tp === 'payment_risk' ? 'card' : tp === 'low_liquidity' ? 'trending-down' : tp === 'slow_bidding' ? 'time' : tp === 'underpriced' ? 'pricetag' : tp === 'qa_bottleneck' ? 'search' : tp === 'idle_developer' ? 'person' : 'flash';

  const onExecute = async (h: any) => {
    setExecuting(h.id);
    try {
      const r = await api.post(`/operator/execute/${encodeURIComponent(h.id)}`);
      Alert.alert('Executed', r.data.details || `${h.title} — done`);
      load();
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed');
    } finally { setExecuting(null); }
  };

  return (
    <View testID="workspace-operator-hints" style={s.wrap}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.pulse}><Ionicons name="flash" size={12} color={T.primary} /></View>
          <Text style={s.title}>System suggests</Text>
          <View style={s.countBadge}><Text style={s.countText}>{hints.length}</Text></View>
        </View>
        <TouchableOpacity testID="workspace-hints-open" onPress={() => router.push('/operator' as any)}>
          <Text style={s.viewAll}>View all →</Text>
        </TouchableOpacity>
      </View>

      {hints.slice(0, expanded ? 3 : 2).map((h) => (
        <View key={h.id} testID={`hint-${h.type}`} style={[s.hintCard, { borderLeftColor: sevColor(h.severity) }]}>
          <View style={s.hintRow}>
            <View style={[s.iconWrap, { backgroundColor: sevColor(h.severity) + '15' }]}>
              <Ionicons name={typeIcon(h.type) as any} size={14} color={sevColor(h.severity)} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.hintTitle}>{h.suggestion}</Text>
              <Text style={s.hintDesc}>{h.description}</Text>
              {h.expected_impact && (
                <View style={s.impactRow}>
                  {Object.entries(h.expected_impact).slice(0, 2).map(([k, v]) => (
                    <Text key={k} style={s.impactChip}>
                      <Text style={s.impactChipKey}>{k.replace(/_/g, ' ')}: </Text>
                      <Text style={s.impactChipVal}>{String(v)}</Text>
                    </Text>
                  ))}
                </View>
              )}
            </View>
            {h.auto_eligible && (
              <TouchableOpacity
                testID={`hint-apply-${h.type}`}
                style={s.applyBtn}
                onPress={() => onExecute(h)}
                disabled={executing === h.id}
              >
                {executing === h.id
                  ? <ActivityIndicator color={T.bg} size="small" />
                  : <Text style={s.applyText}>Apply</Text>}
              </TouchableOpacity>
            )}
          </View>
        </View>
      ))}

      {hints.length > 2 && !expanded && (
        <TouchableOpacity testID="workspace-hints-expand" onPress={() => setExpanded(true)} style={s.expandBtn}>
          <Text style={s.expandText}>Show 1 more</Text>
          <Ionicons name="chevron-down" size={14} color={T.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginHorizontal: T.md, marginBottom: T.md, backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md, borderWidth: 1, borderColor: T.primaryBorder },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: T.sm },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pulse: { width: 22, height: 22, borderRadius: 11, backgroundColor: T.primaryBgStrong, alignItems: 'center', justifyContent: 'center' },
  title: { color: T.text, fontSize: T.body, fontWeight: '700' },
  countBadge: { backgroundColor: T.primaryBgStrong, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  countText: { color: T.primary, fontSize: T.tiny, fontWeight: '700' },
  viewAll: { color: T.primary, fontSize: T.small, fontWeight: '600' },
  hintCard: { backgroundColor: T.surface2, borderRadius: T.radiusSm, padding: 10, marginTop: 6, borderLeftWidth: 3 },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  iconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  hintTitle: { color: T.text, fontSize: T.small, fontWeight: '700' },
  hintDesc: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },
  impactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  impactChip: { color: T.textMuted, fontSize: T.tiny },
  impactChipKey: { color: T.textMuted },
  impactChipVal: { color: T.success, fontWeight: '700' },
  applyBtn: { backgroundColor: T.primary, borderRadius: T.radiusSm, paddingHorizontal: 14, paddingVertical: 8, minWidth: 60, alignItems: 'center', justifyContent: 'center' },
  applyText: { color: T.bg, fontWeight: '700', fontSize: T.small },
  expandBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 6, paddingVertical: 6 },
  expandText: { color: T.textMuted, fontSize: T.small },
});
