import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import T from './theme';

// Wave 9 + 9.5 — Dev Traffic Control block for developer home.
// Shows modules tailored to this developer (skill + payout + invited by admin).
// Wave 9.5 enhancements: competition visibility ("X bids, Y invited"), explicit Place Bid CTA.

export default function DevRecommendedModules() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);

  const load = useCallback(async () => {
    try { const r = await api.get('/developer/recommended-modules'); setData(r.data); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!data || (data.recommended_modules || []).length === 0) return null;

  const goToMarket = () => router.push('/developer/market' as any);

  return (
    <View testID="dev-recommended-modules" style={s.wrap}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.iconWrap}><Ionicons name="flash" size={12} color={T.primary} /></View>
          <Text style={s.title}>Recommended for you</Text>
          {data.invitations_count > 0 && (
            <View style={s.inviteBadge} testID="invites-count-badge">
              <Ionicons name="mail" size={9} color={T.bg} />
              <Text style={s.inviteBadgeText}>{data.invitations_count} INVITE{data.invitations_count > 1 ? 'S' : ''}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity testID="browse-all-btn" onPress={goToMarket}>
          <Text style={s.viewAll}>Browse all →</Text>
        </TouchableOpacity>
      </View>

      {(data.recommended_modules || []).slice(0, 3).map((m: any) => (
        <View
          key={m.module_id}
          testID={`recommended-${m.module_id}`}
          style={[s.card, m.invited && s.cardInvited]}
        >
          <TouchableOpacity activeOpacity={0.85} onPress={goToMarket}>
            <View style={s.cardHeaderRow}>
              <View style={{ flex: 1 }}>
                <View style={s.titleRow}>
                  <Text style={s.modTitle}>{m.title}</Text>
                  {m.invited && <View style={s.invPill}><Ionicons name="mail-open" size={10} color={T.bg} /><Text style={s.invPillText}>INVITED</Text></View>}
                  {m.boosted && <View style={s.boostPill}><Ionicons name="rocket" size={10} color={T.bg} /><Text style={s.boostPillText}>BOOSTED +20%</Text></View>}
                </View>
                <Text style={s.modMeta}>{m.type} · ${m.final_price}</Text>
              </View>
              <View style={s.scoreCircle}>
                <Text style={s.scoreVal}>{m.score_for_you}</Text>
                <Text style={s.scoreLabel}>fit</Text>
              </View>
            </View>

            {/* Competition context — Wave 9.5 */}
            <View style={s.compRow} testID={`competition-${m.module_id}`}>
              <View style={s.compItem}>
                <Ionicons name="people" size={11} color={m.bids_count === 0 ? T.success : T.textMuted} />
                <Text style={[s.compText, m.bids_count === 0 && { color: T.success }]}>
                  {m.bids_count === 0 ? 'No bids yet' : `${m.bids_count} bid${m.bids_count > 1 ? 's' : ''}`}
                </Text>
              </View>
              {m.invitees_count > 0 && (
                <View style={s.compItem}>
                  <Ionicons name="mail" size={11} color={T.risk} />
                  <Text style={[s.compText, { color: T.risk }]}>
                    {m.invitees_count} invited{m.invited ? ' (you included)' : ''}
                  </Text>
                </View>
              )}
            </View>

            {/* WHY YOU reasons */}
            <View style={s.whyBlock}>
              <Text style={s.whyLabel}>WHY YOU:</Text>
              <View style={s.whyRow}>
                {(m.why || []).slice(0, 4).map((r: string, i: number) => (
                  <View key={i} style={s.whyChip}>
                    <Ionicons name="checkmark" size={9} color={T.success} />
                    <Text style={s.whyText}>{r}</Text>
                  </View>
                ))}
              </View>
            </View>
          </TouchableOpacity>

          {/* Explicit Place Bid CTA — Wave 9.5 */}
          <TouchableOpacity
            testID={`place-bid-${m.module_id}`}
            style={[s.cta, m.invited && s.ctaInvited]}
            onPress={goToMarket}>
            <Ionicons name="hammer" size={14} color={T.bg} />
            <Text style={s.ctaText}>{m.invited ? 'Respond to invite · Place Bid' : 'Place Bid'}</Text>
            <Ionicons name="arrow-forward" size={14} color={T.bg} />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: T.lg, backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md, borderWidth: 1, borderColor: T.primaryBorder },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: T.sm },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  iconWrap: { width: 22, height: 22, borderRadius: 11, backgroundColor: T.primaryBgStrong, alignItems: 'center', justifyContent: 'center' },
  title: { color: T.text, fontSize: T.body, fontWeight: '700' },
  inviteBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: T.risk, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  inviteBadgeText: { color: T.bg, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  viewAll: { color: T.primary, fontSize: T.small, fontWeight: '600' },

  card: { backgroundColor: T.surface2, borderRadius: T.radiusSm, padding: T.md, marginBottom: 8, borderWidth: 1, borderColor: T.border },
  cardInvited: { borderColor: T.risk, backgroundColor: T.riskBg },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: T.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  modTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  modMeta: { color: T.textMuted, fontSize: T.small, marginTop: 2 },
  invPill: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: T.risk, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  invPillText: { color: T.bg, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  boostPill: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: T.primary, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  boostPillText: { color: T.bg, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  scoreCircle: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: T.primary, alignItems: 'center', justifyContent: 'center' },
  scoreVal: { color: T.primary, fontSize: T.body, fontWeight: '800' },
  scoreLabel: { color: T.textMuted, fontSize: 8, letterSpacing: 1 },

  compRow: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 4 },
  compItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  compText: { color: T.textMuted, fontSize: T.tiny, fontWeight: '600' },

  whyBlock: { marginTop: 6 },
  whyLabel: { color: T.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  whyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  whyChip: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: T.successBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  whyText: { color: T.textMuted, fontSize: 10 },

  cta: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: T.primary, paddingVertical: 9, borderRadius: T.radiusSm },
  ctaInvited: { backgroundColor: T.risk },
  ctaText: { color: T.bg, fontWeight: '800', fontSize: T.small, letterSpacing: 0.3 },
});
