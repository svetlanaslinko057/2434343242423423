import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from './api';
import T from './theme';

type Notif = {
  notification_id: string;
  module_id: string;
  project_id?: string;
  title: string;
  message: string;
  cta_label: string;
  cta_route: string;
  bid_count: number;
  priority: 'high' | 'medium' | 'low';
};

type Recommendation = {
  recommendation_id: string;
  module_id: string;
  type: string;
  suggested_developer_id: string;
  suggested_developer_name?: string;
  suggested_price: number;
  suggested_days?: number;
  rationale: string;
};

export default function MagicClientPull() {
  const router = useRouter();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [recs, setRecs] = useState<Recommendation[]>([]);

  const load = useCallback(async () => {
    try {
      const [nR, rR] = await Promise.all([
        api.get('/client/notifications'),
        api.get('/client/recommendations'),
      ]);
      setNotifs(nR.data?.notifications || []);
      setRecs(rR.data?.recommendations || []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const acceptRecommendation = async (rec: Recommendation) => {
    try {
      const res = await api.post(`/modules/${rec.module_id}/assign`, {
        recommendation_id: rec.recommendation_id,
      });
      setRecs((prev) => prev.filter((r) => r.recommendation_id !== rec.recommendation_id));
      setNotifs((prev) => prev.filter((n) => n.module_id !== rec.module_id));
      Alert.alert(
        'Loop closed ✨',
        `${res.data?.assigned_developer?.name || rec.suggested_developer_name} assigned · $${res.data?.accepted_bid?.amount ?? rec.suggested_price} · module → in_progress`
      );
      // Refresh in case more notifs/recs came in
      load();
    } catch (e: any) {
      Alert.alert('Assign failed', e?.response?.data?.detail || 'Could not assign');
    }
  };

  if (notifs.length === 0 && recs.length === 0) return null;

  return (
    <View style={s.wrap} testID="magic-client-pull">
      {notifs.slice(0, 2).map((n) => (
        <TouchableOpacity
          key={n.notification_id}
          testID={`client-notification-${n.notification_id}`}
          style={[s.notifCard, n.priority === 'high' && s.notifHigh]}
          activeOpacity={0.85}
          onPress={() => n.cta_route && router.push(n.cta_route as any)}
        >
          <View style={s.notifHeader}>
            <Text style={s.notifIcon}>🔥</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.notifTitle}>{n.title}</Text>
              <Text style={s.notifMsg} numberOfLines={2}>{n.message}</Text>
            </View>
          </View>
          <View style={s.notifFooter}>
            <Text style={s.notifExpiry}>⏳ Offers may change in a few minutes</Text>
            <View style={s.notifCta}>
              <Text style={s.notifCtaText}>{n.cta_label}</Text>
              <Ionicons name="chevron-forward" size={16} color={T.primary} />
            </View>
          </View>
        </TouchableOpacity>
      ))}

      {recs.slice(0, 2).map((r) => (
        <View
          key={r.recommendation_id}
          testID={`recommendation-${r.recommendation_id}`}
          style={s.recCard}
        >
          <View style={s.recHeader}>
            <Text style={s.recLabel}>⚡ SUGGESTED DECISION</Text>
          </View>
          <Text style={s.recTitle}>
            Assign {r.suggested_developer_name || 'top bidder'} · ${r.suggested_price}
            {r.suggested_days ? ` · ${r.suggested_days}d` : ''}
          </Text>
          <Text style={s.recRationale}>{r.rationale}</Text>
          <Text style={s.recScarcity}>Only a few offers match — decide before others close</Text>
          <TouchableOpacity
            testID={`recommendation-accept-${r.recommendation_id}`}
            style={s.recBtn}
            onPress={() => acceptRecommendation(r)}
          >
            <Text style={s.recBtnText}>Accept suggestion</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10, marginBottom: 16 },
  notifCard: {
    backgroundColor: '#ef444415',
    borderLeftWidth: 4,
    borderLeftColor: '#ef4444',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ef444433',
  },
  notifHigh: { backgroundColor: '#ef444425' },
  notifHeader: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  notifIcon: { fontSize: 20, marginTop: -2 },
  notifTitle: { color: T.text, fontWeight: '700', fontSize: 14 },
  notifMsg: { color: T.textMuted, fontSize: 12, marginTop: 2 },
  notifFooter: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notifExpiry: { color: '#f59e0b', fontSize: 11, fontWeight: '600' },
  notifCta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  notifCtaText: { color: T.primary, fontWeight: '700', fontSize: 13 },
  recCard: {
    backgroundColor: T.primaryBg,
    borderLeftWidth: 4,
    borderLeftColor: T.primary,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: T.primaryBorder,
  },
  recHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  recLabel: { color: T.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  recTitle: { color: T.text, fontWeight: '700', fontSize: 14 },
  recRationale: { color: T.textMuted, fontSize: 12, marginTop: 4 },
  recScarcity: { color: '#f59e0b', fontSize: 11, marginTop: 6, fontWeight: '600' },
  recBtn: {
    backgroundColor: T.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  recBtnText: { color: '#000', fontWeight: '800', fontSize: 13 },
});
