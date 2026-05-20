import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import { useAuth } from './auth';
import T from './theme';

export default function GlobalControlBar() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<any>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.get('/global/status');
      setData(res.data);
    } catch {}
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const iv = setInterval(load, 30000); return () => clearInterval(iv); }, [load]);

  if (!data || !user) return null;

  const items = [
    { label: 'Projects', value: data.active_projects, icon: 'folder-open', color: T.primary, route: null },
    ...(data.blocked_projects > 0 ? [{ label: 'Blocked', value: data.blocked_projects, icon: 'alert-circle', color: T.danger, route: null }] : []),
    { label: 'Actions', value: data.pending_actions, icon: 'flash', color: data.pending_actions > 0 ? T.risk : T.textMuted, route: '/inbox' },
    { label: 'Cashflow', value: `$${data.cashflow.toLocaleString()}`, icon: 'cash', color: T.primary, route: null },
    ...(data.alerts > 0 ? [{ label: 'Alerts', value: data.alerts, icon: 'warning', color: T.danger, route: '/inbox' }] : []),
  ];

  return (
    <View testID="global-control-bar" style={s.container}>
      <Text style={s.logo}>ATLAS</Text>
      <View style={s.metricsRow}>
        {items.map((item) => (
          <TouchableOpacity
            key={item.label}
            testID={`gcb-${item.label.toLowerCase()}`}
            style={s.metric}
            onPress={() => item.route ? router.push(item.route as any) : null}
            activeOpacity={item.route ? 0.7 : 1}
          >
            <Text style={[s.metricVal, { color: item.color }]}>{item.value}</Text>
            <Text style={s.metricLabel}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {data.pending_actions > 0 && (
        <TouchableOpacity testID="gcb-inbox-btn" style={s.inboxBtn} onPress={() => router.push('/inbox' as any)}>
          <Ionicons name="flash" size={14} color={T.bg} />
          <Text style={s.inboxBtnText}>{data.pending_actions}</Text>
        </TouchableOpacity>
      )}
      {data.role === 'admin' && (
        <TouchableOpacity testID="gcb-operator-btn" style={s.operatorBtn} onPress={() => router.push('/operator' as any)}>
          <Ionicons name="pulse" size={14} color={T.primary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { backgroundColor: T.surface1, paddingHorizontal: T.md, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: T.border },
  logo: { color: T.primary, fontSize: 14, fontWeight: '800', letterSpacing: 3, marginRight: T.md },
  metricsRow: { flex: 1, flexDirection: 'row', gap: 2 },
  metric: { alignItems: 'center', paddingHorizontal: 8 },
  metricVal: { fontSize: 13, fontWeight: '800' },
  metricLabel: { fontSize: 9, color: T.textMuted, marginTop: 1 },
  inboxBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.risk, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, gap: 3 },
  inboxBtnText: { color: T.bg, fontSize: 11, fontWeight: '800' },
  operatorBtn: { marginLeft: 6, padding: 6, backgroundColor: T.primaryBgStrong, borderRadius: 12 },
});
