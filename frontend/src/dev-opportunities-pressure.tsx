import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import api from './api';
import T from './theme';

type Opp = {
  module_id: string;
  title: string;
  price?: number;
  final_price?: number;
  bid_count?: number;
  already_bid?: boolean;
};

export default function DevOpportunitiesPressure() {
  const router = useRouter();
  const [opps, setOpps] = useState<Opp[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/marketplace/feed');
      const mods = r.data?.modules || [];
      // Sort by bid_count desc → show the hottest first
      const sorted = [...mods]
        .filter((m: Opp) => !m.already_bid)
        .sort((a: Opp, b: Opp) => (b.bid_count || 0) - (a.bid_count || 0))
        .slice(0, 3);
      setOpps(sorted);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  if (opps.length === 0) return null;

  const hottest = opps[0]?.bid_count || 0;
  const showPressure = hottest >= 2;

  return (
    <View style={s.wrap} testID="dev-opportunities-pressure">
      <View style={s.header}>
        <Text style={s.title}>
          {showPressure ? '🚀 Opportunities moving fast' : '⚡ Fresh opportunities'}
        </Text>
        {showPressure && <Text style={s.subtitle}>Act before others close the gap</Text>}
      </View>

      {opps.map((o) => {
        const bc = o.bid_count || 0;
        const price = o.final_price ?? o.price ?? 0;
        const heat = bc >= 3 ? 'hot3' : bc >= 2 ? 'hot2' : 'warm';
        return (
          <TouchableOpacity
            key={o.module_id}
            testID={`opp-pressure-${o.module_id}`}
            style={[s.row, heat === 'hot3' && s.rowHot3, heat === 'hot2' && s.rowHot2]}
            activeOpacity={0.85}
            onPress={() => router.push('/developer/market')}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.oppTitle} numberOfLines={1}>{o.title}</Text>
              <View style={s.oppMeta}>
                <Text style={s.oppPrice}>${price}</Text>
                {bc >= 2 && (
                  <Text style={s.oppHot}>🔥 {bc} competing</Text>
                )}
                {bc >= 3 && (
                  <Text style={s.oppAlmostTaken}>Only a few slots left</Text>
                )}
              </View>
            </View>
            <Text style={s.oppCta}>Bid →</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    backgroundColor: '#f59e0b10',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#f59e0b33',
  },
  header: { marginBottom: 10 },
  title: { color: T.text, fontSize: 15, fontWeight: '800' },
  subtitle: { color: '#f59e0b', fontSize: 11, fontWeight: '600', marginTop: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.surface1,
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
    borderLeftWidth: 3,
    borderLeftColor: T.border,
  },
  rowHot2: { borderLeftColor: '#ef4444' },
  rowHot3: { borderLeftColor: '#ef4444', backgroundColor: '#ef444415' },
  oppTitle: { color: T.text, fontSize: 13, fontWeight: '700' },
  oppMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  oppPrice: { color: T.primary, fontSize: 12, fontWeight: '700' },
  oppHot: { color: '#ef4444', fontSize: 11, fontWeight: '700' },
  oppAlmostTaken: { color: '#f59e0b', fontSize: 10, fontWeight: '600' },
  oppCta: { color: T.primary, fontSize: 13, fontWeight: '700' },
});
