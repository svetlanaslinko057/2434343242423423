import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import T from './theme';

// Wave 10 — Revenue Timeline block
// Shows: current spend · next expected payment · open opportunity value · retainer offer · LTV estimate · segment

const SEG_META: Record<string, { label: string; color: string; icon: string }> = {
  expansion_ready: { label: 'Expansion Ready', color: T.success, icon: 'trending-up' },
  premium_ready: { label: 'Premium Ready', color: T.primary, icon: 'diamond' },
  stable_core: { label: 'Stable', color: T.info, icon: 'shield-checkmark' },
  slow_payer: { label: 'Slow Payer', color: T.risk, icon: 'time' },
  churn_risk: { label: 'Retention Risk', color: T.danger, icon: 'warning' },
};

export default function RevenueTimeline() {
  const [tl, setTl] = useState<any>(null);

  const load = useCallback(async () => {
    try { const r = await api.get('/client/revenue-timeline'); setTl(r.data); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!tl || tl.current_spend === undefined) return null;

  const seg = SEG_META[tl.segment] || SEG_META.stable_core;
  const nextDate = tl.next_expected_date ? new Date(tl.next_expected_date) : null;
  const dateStr = nextDate ? nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

  return (
    <View style={s.wrap} testID="revenue-timeline">
      <View style={s.headRow}>
        <Text style={s.title}>Revenue path</Text>
        <View style={[s.segPill, { borderColor: seg.color + '88', backgroundColor: seg.color + '15' }]}>
          <Ionicons name={seg.icon as any} size={11} color={seg.color} />
          <Text style={[s.segText, { color: seg.color }]}>{seg.label}</Text>
        </View>
      </View>

      <View style={s.grid}>
        <Cell label="Current investment" value={`$${tl.current_spend.toLocaleString()}`} color={T.text} testID="tl-current" />
        <Cell
          label={tl.next_expected_invoice_number ? `Next: ${tl.next_expected_invoice_number}` : 'Next expected'}
          value={tl.next_expected_payment ? `$${tl.next_expected_payment.toLocaleString()}` : '—'}
          sub={nextDate ? `by ${dateStr}` : undefined}
          color={T.info}
          testID="tl-next"
        />
        <Cell
          label="Open opportunities"
          value={tl.open_opportunities_value ? `+$${tl.open_opportunities_value.toLocaleString()}` : '—'}
          sub={tl.open_opportunities_count ? `${tl.open_opportunities_count} item${tl.open_opportunities_count > 1 ? 's' : ''}` : undefined}
          color={T.success}
          testID="tl-opps"
        />
        <Cell
          label="Retainer offer"
          value={tl.retainer_offer_value ? `$${tl.retainer_offer_value}/mo` : '—'}
          color={T.primary}
          testID="tl-retainer"
        />
      </View>

      <View style={s.ltvRow}>
        <Ionicons name="sparkles" size={14} color={T.primary} />
        <Text style={s.ltvLabel}>Potential lifetime value</Text>
        <Text style={s.ltvVal}>${tl.lifetime_value_estimate.toLocaleString()}</Text>
      </View>
    </View>
  );
}

function Cell({ label, value, sub, color, testID }: any) {
  return (
    <View style={s.cell} testID={testID}>
      <Text style={s.cellLabel}>{label}</Text>
      <Text style={[s.cellVal, { color }]}>{value}</Text>
      {sub && <Text style={s.cellSub}>{sub}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: T.md, backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md, borderWidth: 1, borderColor: T.primaryBorder },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: T.sm },
  title: { color: T.text, fontSize: T.h3, fontWeight: '700' },
  segPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  segText: { fontSize: T.tiny, fontWeight: '700', letterSpacing: 0.3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { flexBasis: '48%', backgroundColor: T.surface2, borderRadius: T.radiusSm, padding: 10, borderWidth: 1, borderColor: T.border },
  cellLabel: { color: T.textMuted, fontSize: T.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  cellVal: { color: T.text, fontSize: T.body, fontWeight: '800' },
  cellSub: { color: T.textMuted, fontSize: T.tiny, marginTop: 1 },
  ltvRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: T.sm, paddingTop: T.sm, borderTopWidth: 1, borderTopColor: T.border },
  ltvLabel: { color: T.textMuted, fontSize: T.small, flex: 1 },
  ltvVal: { color: T.primary, fontSize: T.body, fontWeight: '800' },
});
