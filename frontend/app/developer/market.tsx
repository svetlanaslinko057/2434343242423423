import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { runtime } from '../../src/runtime';
import { ApiError } from '../../src/runtime-client';
import T from '../../src/theme';

export default function DevMarket() {
  const [modules, setModules] = useState<any[]>([]);
  const [capacity, setCapacity] = useState({ used: 0, max: 2 });
  const [rank, setRank] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [bidModule, setBidModule] = useState<any>(null);
  const [bidPrice, setBidPrice] = useState('');
  const [bidDays, setBidDays] = useState('');
  const [bidMsg, setBidMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const [feedRes, rankRes] = await Promise.all([
        runtime.get('/api/marketplace/feed'),
        runtime.get('/api/developer/rank'),
      ]);
      setModules((feedRes.data as any).modules || []);
      setCapacity((feedRes.data as any).capacity || { used: 0, max: 2 });
      setRank(rankRes.data);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitBid = async () => {
    if (!bidModule || !bidPrice || !bidDays) { Alert.alert('Error', 'Price and delivery days required'); return; }
    try {
      // Idempotency: double-tap on Submit Bid creates only ONE bid.
      // No `capability: 'payment'` — bid placement is a marketplace
      // state-machine action; money moves only when client accepts.
      await runtime.post(
        `/api/modules/${bidModule.module_id}/bid`,
        { proposed_price: parseFloat(bidPrice), delivery_days: parseInt(bidDays), message: bidMsg },
        { idempotencyKey: `bid:${bidModule.module_id}` },
      );
      Alert.alert('Bid Submitted', 'Your bid has been submitted');
      setBidModule(null); setBidPrice(''); setBidDays(''); setBidMsg('');
      load();
    } catch (e: any) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : (e.response?.data?.detail || 'Failed');
      Alert.alert('Error', msg);
    }
  };

  const acceptDirect = async (id: string) => {
    try {
      // Idempotency: prevents capacity-grab race when user double-taps
      // Accept on a low-supply module. Same module_id within ~10s collapses.
      // No `capability: 'payment'` — accept reserves the slot; payment
      // is dispatched by backend on completion, not at accept-time.
      await runtime.post(`/api/marketplace/modules/${id}/accept`, {}, {
        idempotencyKey: `accept-module:${id}`,
      });
      Alert.alert('Accepted', 'Module reserved');
      load();
    } catch (e: any) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : (e.response?.data?.detail || 'Failed');
      Alert.alert('Error', msg);
    }
  };

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={T.primary} />}>
      <View testID="developer-marketplace" style={s.content}>
        <Text style={s.title}>Marketplace</Text>
        <Text style={s.cap}>Capacity: {capacity.used}/{capacity.max}</Text>

        {/* Ranking Banner */}
        {rank && (
          <View testID="dev-rank-banner" style={s.rankBanner}>
            <View style={s.rankRow}>
              <View style={s.rankItem}><Text style={s.rankVal}>#{rank.rank}</Text><Text style={s.rankLabel}>Rank</Text></View>
              <View style={s.rankItem}><Text style={s.rankVal}>{rank.stats.win_rate}%</Text><Text style={s.rankLabel}>Win Rate</Text></View>
              <View style={s.rankItem}><Text style={s.rankVal}>{rank.stats.qa_rate}%</Text><Text style={s.rankLabel}>QA Pass</Text></View>
              <View style={s.rankItem}><Text style={s.rankVal}>${rank.stats.total_earned}</Text><Text style={s.rankLabel}>Earned</Text></View>
            </View>
            {rank.milestones.to_elite > 0 && (
              <View style={s.milestoneBar}>
                <Ionicons name="trophy" size={14} color={T.primary} />
                <Text style={s.milestoneText}>+{rank.milestones.to_elite} deliveries to Elite</Text>
              </View>
            )}
          </View>
        )}

        {/* Bid Form */}
        {bidModule && (
          <View style={s.bidForm}>
            <View style={s.bidHeader}>
              <Text style={s.bidFormTitle}>Place Bid: {bidModule.title}</Text>
              <TouchableOpacity onPress={() => setBidModule(null)}><Ionicons name="close" size={22} color={T.textMuted} /></TouchableOpacity>
            </View>
            <Text style={s.bidHint}>Suggested: ${bidModule.suggested_min} – ${bidModule.suggested_max}</Text>
            <View style={s.bidInputRow}>
              <View style={s.bidInputWrap}>
                <Text style={s.bidInputLabel}>Price ($)</Text>
                <TextInput testID="bid-price-input" style={s.bidInput} placeholder={`${bidModule.price}`} placeholderTextColor={T.textMuted} value={bidPrice} onChangeText={setBidPrice} keyboardType="numeric" />
              </View>
              <View style={s.bidInputWrap}>
                <Text style={s.bidInputLabel}>Days</Text>
                <TextInput testID="bid-days-input" style={s.bidInput} placeholder="3" placeholderTextColor={T.textMuted} value={bidDays} onChangeText={setBidDays} keyboardType="numeric" />
              </View>
            </View>
            <TextInput testID="bid-message-input" style={[s.bidInput, { marginBottom: 12 }]} placeholder="Message (optional)" placeholderTextColor={T.textMuted} value={bidMsg} onChangeText={setBidMsg} />
            {/* Speed options */}
            <View style={s.speedRow}>
              <TouchableOpacity style={s.speedBtn} onPress={() => { setBidDays('1'); setBidPrice(String(Math.round(bidModule.price * 1.5))); }}>
                <Ionicons name="flash" size={14} color={T.risk} />
                <Text style={s.speedText}>1 day — ${Math.round(bidModule.price * 1.5)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.speedBtn} onPress={() => { setBidDays('3'); setBidPrice(String(bidModule.price)); }}>
                <Ionicons name="time" size={14} color={T.info} />
                <Text style={s.speedText}>3 days — ${bidModule.price}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity testID="submit-bid-btn" style={s.submitBidBtn} onPress={submitBid}>
              <Text style={s.submitBidText}>Submit Bid</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Modules */}
        {modules.map(m => (
          <View key={m.module_id} style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.cardTitle}>{m.title}</Text>
              {m.surge_pct !== 0 ? (
                <View>
                  <Text style={[s.price, m.surge_pct > 0 && { color: T.risk }]}>${m.market_price}</Text>
                  <Text style={[s.surgeTag, m.surge_pct > 0 ? { color: T.risk } : { color: T.success }]}>
                    {m.surge_pct > 0 ? '↑' : '↓'}{Math.abs(m.surge_pct)}%
                  </Text>
                </View>
              ) : (
                <Text style={s.price}>${m.price}</Text>
              )}
            </View>
            <Text style={s.desc}>{m.description}</Text>
            {/* Surge signal */}
            {m.surge_reason && (
              <View style={[s.surgeSignal, { backgroundColor: m.surge_signal === 'low_liquidity' || m.surge_signal === 'critical_shortage' ? T.riskBg : m.surge_signal === 'high_demand' ? T.successBg : T.infoBg }]}>
                <Ionicons name={m.surge_signal === 'high_demand' ? 'trending-up' : m.surge_signal === 'balanced' ? 'remove' : 'trending-down'} size={14} color={m.surge_signal === 'high_demand' ? T.success : m.surge_signal === 'balanced' ? T.info : T.risk} />
                <Text style={[s.surgeText, { color: m.surge_signal === 'high_demand' ? T.success : m.surge_signal === 'balanced' ? T.info : T.risk }]}>{m.surge_reason}</Text>
              </View>
            )}
            {m.is_boosted && (
              <View style={s.boostedTag}>
                <Ionicons name="rocket" size={12} color={T.primary} />
                <Text style={s.boostedText}>BOOSTED</Text>
              </View>
            )}
            <View style={s.meta}>
              <Text style={s.metaItem}>Type: {m.type}</Text>
              <Text style={s.metaItem}>Est: {m.hours_estimated}h</Text>
              <Text style={s.metaItem}>Tier: {m.tier_required}</Text>
            </View>
            <Text style={s.project}>Project: {m.project_title}</Text>

            {/* Bid count + Competition heat */}
            {m.bid_count > 0 && (
              <View style={s.bidCountRow}>
                <Ionicons name="people" size={14} color={T.info} />
                <Text style={s.bidCountText}>{m.bid_count} developer{m.bid_count > 1 ? 's' : ''} bidding</Text>
              </View>
            )}
            {m.bid_count >= 2 && (
              <View testID={`competition-badge-${m.module_id}`} style={s.hotRow}>
                <Text style={s.hotText}>🔥 {m.bid_count} developers competing</Text>
              </View>
            )}
            {m.bid_count >= 3 && (
              <Text testID={`urgency-${m.module_id}`} style={s.urgencyText}>⚡ High competition — act fast</Text>
            )}

            {/* My bid status */}
            {m.my_bid && (
              <View style={s.myBidTag}>
                <Ionicons name="checkmark-circle" size={14} color={T.primary} />
                <Text style={s.myBidText}>Your bid: ${m.my_bid.proposed_price} · {m.my_bid.delivery_days}d</Text>
              </View>
            )}

            {/* Actions */}
            {!m.my_bid && (
              <View style={s.actionRow}>
                <TouchableOpacity testID={`bid-module-${m.module_id}`} style={s.bidBtn} onPress={() => { setBidModule(m); setBidPrice(String(m.price)); setBidDays('3'); }}>
                  <Ionicons name="flash" size={16} color={T.bg} />
                  <Text style={s.bidBtnText}>Place Bid</Text>
                </TouchableOpacity>
                {m.status === 'open' && capacity.used < capacity.max && (
                  <TouchableOpacity testID={`accept-direct-${m.module_id}`} style={s.directBtn} onPress={() => acceptDirect(m.module_id)}>
                    <Text style={s.directBtnText}>Accept ${m.price}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        ))}
        {modules.length === 0 && <Text style={s.empty}>No modules available</Text>}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md },
  title: { color: T.text, fontSize: T.h1, fontWeight: '800', marginBottom: T.xs },
  cap: { color: T.textMuted, fontSize: T.small, marginBottom: T.md },
  rankBanner: { backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md, marginBottom: T.lg, borderWidth: 1, borderColor: T.primaryBorder },
  rankRow: { flexDirection: 'row', gap: T.sm },
  rankItem: { flex: 1, alignItems: 'center' },
  rankVal: { color: T.text, fontSize: T.h3, fontWeight: '800' },
  rankLabel: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },
  milestoneBar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: T.sm, backgroundColor: T.primaryBg, borderRadius: T.radiusSm, padding: 8 },
  milestoneText: { color: T.primary, fontSize: T.small, fontWeight: '600' },
  bidForm: { backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md, marginBottom: T.lg, borderWidth: 1, borderColor: T.primaryBorder },
  bidHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: T.sm },
  bidFormTitle: { color: T.text, fontSize: T.h3, fontWeight: '700' },
  bidHint: { color: T.textMuted, fontSize: T.small, marginBottom: T.md },
  bidInputRow: { flexDirection: 'row', gap: T.sm, marginBottom: T.sm },
  bidInputWrap: { flex: 1 },
  bidInputLabel: { color: T.textMuted, fontSize: T.tiny, marginBottom: 4 },
  bidInput: { backgroundColor: T.surface2, borderRadius: T.radiusSm, padding: 12, color: T.text, fontSize: T.body, borderWidth: 1, borderColor: T.border },
  speedRow: { flexDirection: 'row', gap: T.sm, marginBottom: T.md },
  speedBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: T.surface2, borderRadius: T.radiusSm, padding: 10, borderWidth: 1, borderColor: T.border },
  speedText: { color: T.text, fontSize: T.small },
  submitBidBtn: { backgroundColor: T.primary, borderRadius: T.radiusSm, padding: 14, alignItems: 'center' },
  submitBidText: { color: T.bg, fontWeight: '700', fontSize: T.body },
  card: { backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md, marginBottom: T.md, borderWidth: 1, borderColor: T.border },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: T.text, fontSize: T.h3, fontWeight: '700', flex: 1 },
  price: { color: T.success, fontSize: T.h3, fontWeight: '800' },
  desc: { color: T.textMuted, fontSize: T.small, marginTop: T.xs },
  meta: { flexDirection: 'row', gap: T.md, marginTop: T.sm },
  metaItem: { color: T.textMuted, fontSize: T.tiny },
  project: { color: T.info, fontSize: T.small, marginTop: T.sm },
  bidCountRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: T.sm },
  bidCountText: { color: T.info, fontSize: T.small, fontWeight: '600' },
  hotRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, backgroundColor: T.dangerBg, borderLeftWidth: 3, borderLeftColor: T.danger, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  hotText: { color: T.danger, fontSize: T.small, fontWeight: '800' },
  urgencyText: { color: T.warning, fontSize: T.tiny, fontWeight: '700', marginTop: 4, letterSpacing: 0.3 },
  myBidTag: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: T.sm, backgroundColor: T.primaryBg, borderRadius: T.radiusSm, padding: 8 },
  myBidText: { color: T.primary, fontSize: T.small, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: T.sm, marginTop: T.md },
  bidBtn: { flex: 1, backgroundColor: T.primary, borderRadius: T.radiusSm, padding: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  bidBtnText: { color: T.bg, fontWeight: '700', fontSize: T.body },
  directBtn: { flex: 1, backgroundColor: T.surface2, borderRadius: T.radiusSm, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: T.border },
  directBtnText: { color: T.text, fontWeight: '600', fontSize: T.body },
  empty: { color: T.textMuted, textAlign: 'center', marginTop: T.xl },
  surgeTag: { fontSize: T.tiny, fontWeight: '700', textAlign: 'right' },
  surgeSignal: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: T.sm, borderRadius: T.radiusSm, padding: 8 },
  surgeText: { fontSize: T.small, fontWeight: '600' },
  boostedTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  boostedText: { color: T.primary, fontSize: T.tiny, fontWeight: '800', letterSpacing: 1 },
});
