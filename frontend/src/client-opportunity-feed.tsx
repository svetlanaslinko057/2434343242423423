import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import T from './theme';

// Wave 10 — Client Opportunity Feed
// Shows expansion opportunities & speed upgrades with explicit "why now" + Accept / Dismiss.
// Principle: system shows the next logical step — doesn't force it.

const TYPE_META: Record<string, { icon: string; label: string; color: string }> = {
  upsell_module: { icon: 'cube', label: 'Add module', color: T.primary },
  speed_upgrade: { icon: 'flash', label: 'Speed upgrade', color: T.info },
  premium_support: { icon: 'shield', label: 'Premium support', color: T.success },
  retainer: { icon: 'refresh', label: 'Retainer', color: T.success },
};

export default function ClientOpportunityFeed({ compact }: { compact?: boolean }) {
  const [opps, setOpps] = useState<any[]>([]);
  const [segment, setSegment] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/client/opportunities');
      setOpps(r.data.opportunities || []);
      setSegment(r.data.segment || '');
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const accept = async (opp: any) => {
    setBusy(`a-${opp.opportunity_id}`);
    try {
      const r = await api.post(`/client/opportunities/${opp.opportunity_id}/accept`);
      Alert.alert('Accepted', `${opp.title}\nInvoice: ${r.data.invoice_number}\nAmount: $${r.data.amount}`);
      load();
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to accept');
    } finally { setBusy(null); }
  };

  const dismiss = async (opp: any) => {
    setBusy(`d-${opp.opportunity_id}`);
    try { await api.post(`/client/opportunities/${opp.opportunity_id}/dismiss`); load(); } catch {}
    finally { setBusy(null); }
  };

  if (opps.length === 0) return null;

  const pri = opps.filter(o => o.priority === 'high');
  const others = opps.filter(o => o.priority !== 'high');
  const visible = compact ? opps.slice(0, 1) : [...pri, ...others];

  return (
    <View style={s.wrap} testID="client-opportunity-feed">
      <View style={s.headRow}>
        <View style={s.headLeft}>
          <Ionicons name="trending-up" size={16} color={T.primary} />
          <Text style={s.title}>Recommended next move</Text>
        </View>
        <View style={s.countPill}><Text style={s.countText}>{opps.length}</Text></View>
      </View>

      {visible.map((o) => {
        const tm = TYPE_META[o.type] || TYPE_META.upsell_module;
        return (
          <View key={o.opportunity_id} style={[s.card, o.priority === 'high' && s.cardHigh]} testID={`opp-${o.opportunity_id}`}>
            <View style={s.cardHead}>
              <View style={[s.typePill, { backgroundColor: tm.color + '22', borderColor: tm.color + '55' }]}>
                <Ionicons name={tm.icon as any} size={11} color={tm.color} />
                <Text style={[s.typeText, { color: tm.color }]}>{tm.label}</Text>
              </View>
              {o.priority === 'high' && <View style={s.hiPill}><Text style={s.hiText}>PRIORITY</Text></View>}
              <Text style={s.price}>+${o.price}</Text>
            </View>

            <Text style={s.oppTitle}>{o.title}</Text>
            <Text style={s.oppDesc}>{o.description}</Text>

            <View style={s.whyWrap}>
              <Text style={s.whyLbl}>WHY NOW:</Text>
              {(o.reason || []).slice(0, 3).map((r: string, i: number) => (
                <View key={i} style={s.whyRow}>
                  <Ionicons name="arrow-forward" size={10} color={T.success} />
                  <Text style={s.whyText}>{r}</Text>
                </View>
              ))}
            </View>

            {o.expected_impact && Object.keys(o.expected_impact).length > 0 && (
              <View style={s.impactRow}>
                {Object.entries(o.expected_impact).map(([k, v]: any) => (
                  <View key={k} style={s.impactChip}>
                    <Text style={s.impactK}>{k.replace(/_/g, ' ')}:</Text>
                    <Text style={s.impactV}>{String(v)}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={s.ctaRow}>
              <TouchableOpacity
                testID={`opp-accept-${o.opportunity_id}`}
                disabled={busy === `a-${o.opportunity_id}`}
                onPress={() => accept(o)}
                style={[s.ctaPrimary, busy === `a-${o.opportunity_id}` && { opacity: 0.6 }]}>
                {busy === `a-${o.opportunity_id}`
                  ? <ActivityIndicator color={T.bg} size="small" />
                  : <><Ionicons name="add-circle" size={14} color={T.bg} /><Text style={s.ctaPrimaryText}>Add now · ${o.price}</Text></>}
              </TouchableOpacity>
              <TouchableOpacity
                testID={`opp-dismiss-${o.opportunity_id}`}
                disabled={busy === `d-${o.opportunity_id}`}
                onPress={() => dismiss(o)}
                style={[s.ctaGhost, busy === `d-${o.opportunity_id}` && { opacity: 0.6 }]}>
                <Text style={s.ctaGhostText}>Not now</Text>
              </TouchableOpacity>
            </View>
            {o.eta_days > 0 && <Text style={s.eta}>ETA · ~{o.eta_days} day{o.eta_days > 1 ? 's' : ''}</Text>}
          </View>
        );
      })}
      {compact && opps.length > 1 && (
        <Text style={s.more}>+{opps.length - 1} more opportunit{opps.length - 1 === 1 ? 'y' : 'ies'} in Expansion tab</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: T.md },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: T.sm },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: T.text, fontSize: T.h3, fontWeight: '700' },
  countPill: { backgroundColor: T.primaryBgStrong, borderColor: T.primaryBorder, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  countText: { color: T.primary, fontSize: T.tiny, fontWeight: '800' },

  card: { backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md, marginBottom: T.sm, borderWidth: 1, borderColor: T.border },
  cardHigh: { borderColor: T.primaryBorderStrong, backgroundColor: T.primaryBg },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  typePill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  typeText: { fontSize: T.tiny, fontWeight: '700' },
  hiPill: { backgroundColor: T.primary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  hiText: { color: T.bg, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  price: { marginLeft: 'auto', color: T.primary, fontSize: T.h3, fontWeight: '800' },

  oppTitle: { color: T.text, fontSize: T.body, fontWeight: '700', marginBottom: 2 },
  oppDesc: { color: T.textMuted, fontSize: T.small, marginBottom: T.sm },

  whyWrap: { marginBottom: 8 },
  whyLbl: { color: T.textMuted, fontSize: 9, letterSpacing: 1, fontWeight: '700', marginBottom: 4 },
  whyRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  whyText: { color: T.text, fontSize: T.small },

  impactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
  impactChip: { flexDirection: 'row', backgroundColor: T.successBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, gap: 4 },
  impactK: { color: T.textMuted, fontSize: T.tiny },
  impactV: { color: T.success, fontSize: T.tiny, fontWeight: '700' },

  ctaRow: { flexDirection: 'row', gap: 8 },
  ctaPrimary: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: T.primary, paddingVertical: 10, borderRadius: T.radiusSm },
  ctaPrimaryText: { color: T.bg, fontWeight: '800', fontSize: T.small },
  ctaGhost: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.surface2, borderWidth: 1, borderColor: T.border, paddingVertical: 10, borderRadius: T.radiusSm },
  ctaGhostText: { color: T.textMuted, fontWeight: '600', fontSize: T.small },

  eta: { color: T.textMuted, fontSize: T.tiny, marginTop: 6, textAlign: 'right', fontStyle: 'italic' },
  more: { color: T.textMuted, fontSize: T.tiny, textAlign: 'center', fontStyle: 'italic' },
});
