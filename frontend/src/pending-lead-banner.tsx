import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import T from './theme';

/**
 * Client-home banner that resurrects an unclaimed lead.
 *
 * When a visitor described a product but closed the browser before claiming,
 * the lead stays in Mongo under their email. Once they authenticate (for any
 * reason, at any time), we show a banner here so the product plan isn't lost.
 *
 * Silent when there are no pending leads — this is a soft re-capture, not a
 * modal interrupt.
 */
type PendingLead = {
  lead_id: string;
  email: string;
  goal: string;
  mode: string;
  created_at: string;
  estimate?: any;
};

export default function PendingLeadBanner() {
  const router = useRouter();
  const [leads, setLeads] = useState<PendingLead[]>([]);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await api.get('/leads/by-email/pending');
        if (cancel) return;
        setLeads(Array.isArray(r.data?.leads) ? r.data.leads : []);
      } catch { /* silent — nothing to show */ }
    })();
    return () => { cancel = true; };
  }, []);

  if (!leads.length) return null;

  const top = leads[0];
  const est = top.estimate || {};
  const price = typeof est?.estimate?.final_price === 'number'
    ? est.estimate.final_price
    : (typeof est?.final_price === 'number' ? est.final_price : null);
  const mode =
    top.mode === 'ai' ? 'AI Build' :
    top.mode === 'dev' ? 'Full Engineering' : 'AI + Engineering';
  const goalPreview = (top.goal || '').slice(0, 90) + ((top.goal || '').length > 90 ? '…' : '');

  const onContinue = async () => {
    setClaiming(true); setError('');
    try {
      const r = await api.post(`/leads/${top.lead_id}/claim`);
      router.push(`/workspace/${r.data.project_id}` as any);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not open your plan.');
      setClaiming(false);
    }
  };

  return (
    <View testID="pending-lead-banner" style={s.wrap}>
      <View style={s.header}>
        <Ionicons name="sparkles" size={14} color={T.primary} />
        <Text style={s.headerText}>We found your previous product plan</Text>
      </View>
      <Text style={s.goal} numberOfLines={2} testID="pending-lead-goal">{goalPreview}</Text>
      <View style={s.metaRow}>
        {price !== null ? (
          <Text style={s.price}>${price.toLocaleString()}</Text>
        ) : (
          <Text style={s.price}>Plan saved</Text>
        )}
        <View style={s.dot} />
        <Text style={s.meta}>{mode}</Text>
        {leads.length > 1 ? (
          <>
            <View style={s.dot} />
            <Text style={s.meta}>+{leads.length - 1} more</Text>
          </>
        ) : null}
      </View>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <TouchableOpacity
        testID="pending-lead-continue"
        style={[s.cta, claiming && { opacity: 0.7 }]}
        onPress={onContinue}
        activeOpacity={0.9}
        disabled={claiming}
      >
        {claiming ? (
          <>
            <ActivityIndicator color={T.bg} />
            <Text style={[s.ctaText, { marginLeft: 8 }]}>Opening workspace…</Text>
          </>
        ) : (
          <>
            <Text style={s.ctaText}>Continue building</Text>
            <Ionicons name="arrow-forward" size={16} color={T.bg} />
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginBottom: T.lg,
    borderWidth: 1, borderColor: T.primaryBorder,
    borderRadius: T.radius,
    backgroundColor: T.primaryBg,
    padding: T.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  headerText: { color: T.primary, fontSize: T.small, fontWeight: '800', letterSpacing: 0.3 },
  goal: { color: T.text, fontSize: T.body, lineHeight: 20, marginBottom: T.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: T.sm },
  price: { color: T.text, fontSize: T.h3, fontWeight: '800' },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: T.textMuted, opacity: 0.6 },
  meta: { color: T.textMuted, fontSize: T.small },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: T.primary, borderRadius: T.radiusSm,
    paddingVertical: 12,
  },
  ctaText: { color: T.bg, fontWeight: '800', fontSize: T.small, letterSpacing: 0.3 },
  error: { color: T.danger, fontSize: T.tiny, marginBottom: 6 },
});
