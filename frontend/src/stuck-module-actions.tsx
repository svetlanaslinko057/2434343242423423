import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import T from './theme';

// Wave 9 — Stuck module actions.
// Shown on modules detected as stuck (reserved >2h no start, in_progress >12h no activity, qa_review >24h).
// Offers: Reopen bidding (frees assignee, cancels pending bids), Boost +20% (price surge to re-attract devs).
// Principle: admin clicks — market decides. No auto-assign.

type Props = {
  moduleId: string;
  moduleTitle: string;
  status: string;
  price: number;
  stuckReason?: string | null;
  boosted?: boolean;
  onChanged?: () => void;
};

export default function StuckModuleActions({ moduleId, moduleTitle, status, price, stuckReason, boosted, onChanged }: Props) {
  const [busy, setBusy] = useState<null | 'reopen' | 'boost'>(null);

  const reopen = async () => {
    if (busy) return;
    setBusy('reopen');
    try {
      await api.post(`/modules/${moduleId}/reopen-bidding`);
      Alert.alert('Bidding reopened', `${moduleTitle} is back on the market.`);
      onChanged?.();
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to reopen');
    } finally { setBusy(null); }
  };

  const boost = async () => {
    if (busy || boosted) return;
    setBusy('boost');
    try {
      const r = await api.post(`/admin/modules/${moduleId}/boost`);
      Alert.alert('Boosted +20%', `New price: $${r.data?.new_price || Math.round(price * 1.2)}`);
      onChanged?.();
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Boost failed (module may not be boostable)');
    } finally { setBusy(null); }
  };

  return (
    <View style={s.wrap} testID={`stuck-actions-${moduleId}`}>
      <View style={s.head}>
        <Ionicons name="warning" size={16} color={T.risk} />
        <Text style={s.headText}>Module stuck</Text>
        {boosted && <View style={s.pill}><Text style={s.pillText}>BOOSTED</Text></View>}
      </View>
      {stuckReason ? <Text style={s.reason}>{stuckReason}</Text> : null}
      <Text style={s.hint}>System recommends — you decide. No auto-assign.</Text>
      <View style={s.row}>
        <TouchableOpacity
          testID={`reopen-bidding-${moduleId}`}
          style={[s.btn, s.btnPrimary, busy === 'reopen' && s.btnBusy]}
          onPress={reopen}
          disabled={!!busy}>
          {busy === 'reopen'
            ? <ActivityIndicator color={T.bg} size="small" />
            : <><Ionicons name="refresh" size={14} color={T.bg} /><Text style={s.btnPrimaryText}>Reopen bidding</Text></>
          }
        </TouchableOpacity>
        {!boosted && (
          <TouchableOpacity
            testID={`boost-module-${moduleId}`}
            style={[s.btn, s.btnGhost, busy === 'boost' && s.btnBusy]}
            onPress={boost}
            disabled={!!busy}>
            {busy === 'boost'
              ? <ActivityIndicator color={T.risk} size="small" />
              : <><Ionicons name="trending-up" size={14} color={T.risk} /><Text style={s.btnGhostText}>Boost +20%</Text></>
            }
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 10, padding: 10, backgroundColor: T.riskBg, borderRadius: T.radiusSm, borderWidth: 1, borderColor: T.riskBorder },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  headText: { color: T.risk, fontWeight: '700', fontSize: T.small },
  pill: { marginLeft: 'auto', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: T.riskBorder },
  pillText: { color: T.risk, fontSize: T.tiny, fontWeight: '700' },
  reason: { color: T.text, fontSize: T.small, marginBottom: 4 },
  hint: { color: T.textMuted, fontSize: T.tiny, fontStyle: 'italic', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: T.radiusSm },
  btnBusy: { opacity: 0.6 },
  btnPrimary: { backgroundColor: T.primary },
  btnPrimaryText: { color: T.bg, fontWeight: '700', fontSize: T.small },
  btnGhost: { backgroundColor: T.riskBgStrong, borderWidth: 1, borderColor: T.riskBorder },
  btnGhostText: { color: T.risk, fontWeight: '700', fontSize: T.small },
});
