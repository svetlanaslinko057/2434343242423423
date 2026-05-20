import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import T from './theme';

// Wave 10 — Retainer offer block
// Shown when a project near completion qualifies for a monthly retainer.

const TIER_META: Record<string, { label: string; icon: string }> = {
  starter_support: { label: 'Starter Support', icon: 'shield' },
  growth_support: { label: 'Growth Support', icon: 'trending-up' },
  priority_support: { label: 'Priority Support', icon: 'diamond' },
  support: { label: 'Support', icon: 'shield' },
};

export default function RetainerOffer() {
  const [offer, setOffer] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.get('/client/retainer-offer'); setOffer(r.data.offer); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!offer) return null;

  const tm = TIER_META[offer.type] || TIER_META.support;

  const accept = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/client/retainer/${offer.offer_id}/accept`);
      Alert.alert('Retainer started', `Invoice: ${r.data.invoice_number}\nMonthly: $${offer.monthly_price}`);
      load();
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed');
    } finally { setBusy(false); }
  };

  return (
    <View style={s.wrap} testID="retainer-offer">
      <View style={s.headRow}>
        <View style={s.headLeft}>
          <Ionicons name={tm.icon as any} size={18} color={T.primary} />
          <Text style={s.title}>Keep {offer.project_title} healthy</Text>
        </View>
        <View style={s.tierPill}><Text style={s.tierText}>{tm.label.toUpperCase()}</Text></View>
      </View>

      <View style={s.priceRow}>
        <Text style={s.price}>${offer.monthly_price}</Text>
        <Text style={s.priceUnit}>/ month</Text>
      </View>

      <View style={s.includedWrap}>
        <Text style={s.includedLbl}>Included:</Text>
        {(offer.included || []).map((it: string, i: number) => (
          <View key={i} style={s.inclRow}>
            <Ionicons name="checkmark-circle" size={12} color={T.success} />
            <Text style={s.inclText}>{it}</Text>
          </View>
        ))}
      </View>

      {(offer.reason || []).length > 0 && (
        <View style={s.reasonWrap}>
          <Text style={s.reasonLbl}>WHY NOW:</Text>
          {offer.reason.slice(0, 3).map((r: string, i: number) => (
            <Text key={i} style={s.reasonText}>• {r}</Text>
          ))}
        </View>
      )}

      <TouchableOpacity
        testID="start-retainer-btn"
        disabled={busy}
        onPress={accept}
        style={[s.cta, busy && { opacity: 0.6 }]}>
        {busy
          ? <ActivityIndicator color={T.bg} />
          : <><Ionicons name="rocket" size={14} color={T.bg} /><Text style={s.ctaText}>Start retainer</Text></>}
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: T.md, backgroundColor: T.primaryBg, borderRadius: T.radius, padding: T.md, borderWidth: 1, borderColor: T.primaryBorder },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: T.sm },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  title: { color: T.text, fontSize: T.h3, fontWeight: '700', flex: 1 },
  tierPill: { backgroundColor: T.primary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  tierText: { color: T.bg, fontSize: T.tiny, fontWeight: '800', letterSpacing: 0.5 },

  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: T.sm },
  price: { color: T.primary, fontSize: 30, fontWeight: '800' },
  priceUnit: { color: T.textMuted, fontSize: T.small, marginLeft: 4 },

  includedWrap: { marginBottom: T.sm },
  includedLbl: { color: T.textMuted, fontSize: 9, letterSpacing: 1, fontWeight: '700', marginBottom: 4 },
  inclRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  inclText: { color: T.text, fontSize: T.small },

  reasonWrap: { marginBottom: T.sm },
  reasonLbl: { color: T.textMuted, fontSize: 9, letterSpacing: 1, fontWeight: '700', marginBottom: 4 },
  reasonText: { color: T.textMuted, fontSize: T.small, marginBottom: 2 },

  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: T.primary, paddingVertical: 10, borderRadius: T.radiusSm },
  ctaText: { color: T.bg, fontWeight: '800', fontSize: T.body },
});
