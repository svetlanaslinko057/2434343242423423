import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from './api';
import T from './theme';

// Wave 9.5 — Developer Brain · Motivation Layer
// Surfaces tier progress, leaderboard rank, missed opportunity cost, and streak.
// Principle: System shapes what the developer sees — not just lists.

type Motivation = {
  tier_progress: {
    current: string;
    next: string | null;
    completed: number;
    needed: number;
    qa_pct: number;
    qa_needed: number;
    eligible: boolean;
    earnings_multiplier_on_unlock: number;
  };
  rank: number;
  total_devs: number;
  missed_opportunity: {
    count: number;
    total_value: number;
    modules: { module_id: string; project_id: string; title: string; price: number; type: string }[];
  };
  streak: { completed_7d: number };
  capacity: { active: number; max: number; at_capacity: boolean };
};

export default function DevMotivation() {
  const router = useRouter();
  const [m, setM] = useState<Motivation | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/developer/motivation');
      setM(r.data);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!m) return null;

  const tier = m.tier_progress ?? { current: 'junior', next: 'middle', needed: 0, eligible: false };
  const missed = m.missed_opportunity ?? { count: 0 };
  const isElite = tier.current === 'elite';
  const showTierCta = !isElite && tier.needed > 0;
  const showUnlockReady = !isElite && tier.eligible;
  const showMissed = missed.count > 0;

  return (
    <View testID="dev-motivation" style={s.wrap}>
      {/* Tier progress */}
      {showUnlockReady && (
        <View style={[s.card, s.cardElite]} testID="motivation-elite-ready">
          <View style={s.cardHeadRow}>
            <Ionicons name="trophy" size={18} color={T.primary} />
            <Text style={s.cardTitlePrimary}>Elite unlock ready</Text>
          </View>
          <Text style={s.cardSub}>You meet all criteria. Contact admin to apply for +{Math.round(tier.earnings_multiplier_on_unlock * 100)}% earnings multiplier.</Text>
        </View>
      )}

      {showTierCta && (
        <View style={[s.card, s.cardAccent]} testID="motivation-tier-progress">
          <View style={s.cardHeadRow}>
            <Ionicons name="flame" size={16} color={T.risk} />
            <Text style={s.cardTitle}>You're close to Elite</Text>
          </View>
          <View style={s.progressRow}>
            <View style={s.progressBarOuter}>
              <View style={[s.progressBarFill, { width: `${Math.min(100, (tier.completed / Math.max(1, tier.completed + tier.needed)) * 100)}%` }]} />
            </View>
            <Text style={s.progressText}>{tier.completed}/{tier.completed + tier.needed}</Text>
          </View>
          <View style={s.pillRow}>
            <View style={s.tinyPill}><Text style={s.tinyPillText}>{tier.needed} module{tier.needed !== 1 ? 's' : ''} → Elite</Text></View>
            <View style={[s.tinyPill, tier.qa_pct >= tier.qa_needed ? s.tinyPillOk : s.tinyPillWarn]}>
              <Text style={[s.tinyPillText, { color: tier.qa_pct >= tier.qa_needed ? T.success : T.risk }]}>QA {tier.qa_pct}% / {tier.qa_needed}%</Text>
            </View>
            <View style={[s.tinyPill, s.tinyPillAccent]}><Text style={[s.tinyPillText, { color: T.primary }]}>+{Math.round(tier.earnings_multiplier_on_unlock * 100)}% unlock</Text></View>
          </View>
        </View>
      )}

      {/* Rank + Streak */}
      <View style={s.statsRow}>
        <View style={s.statCard} testID="motivation-rank">
          <Ionicons name="podium" size={16} color={T.primary} />
          <Text style={s.statVal}>#{m.rank}</Text>
          <Text style={s.statLbl}>of {m.total_devs} devs</Text>
        </View>
        <View style={s.statCard} testID="motivation-streak">
          <Ionicons name="trending-up" size={16} color={T.success} />
          <Text style={s.statVal}>{m.streak.completed_7d}</Text>
          <Text style={s.statLbl}>done in 7d</Text>
        </View>
        <View style={s.statCard} testID="motivation-capacity">
          <Ionicons name="battery-half" size={16} color={m.capacity.at_capacity ? T.danger : T.info} />
          <Text style={[s.statVal, { color: m.capacity.at_capacity ? T.danger : T.text }]}>{m.capacity.active}/{m.capacity.max}</Text>
          <Text style={s.statLbl}>capacity</Text>
        </View>
      </View>

      {/* Missed opportunity */}
      {showMissed && (
        <TouchableOpacity
          testID="motivation-missed"
          activeOpacity={0.85}
          onPress={() => router.push('/developer/market' as any)}
          style={[s.card, s.cardMissed]}>
          <View style={s.cardHeadRow}>
            <Ionicons name="cash" size={16} color={T.risk} />
            <Text style={s.cardTitleWarn}>Missed opportunity</Text>
            <Ionicons name="chevron-forward" size={14} color={T.risk} style={{ marginLeft: 'auto' }} />
          </View>
          <Text style={s.missedLine}>
            You haven't bid on <Text style={s.missedValue}>{m.missed_opportunity.count} high-value module{m.missed_opportunity.count !== 1 ? 's' : ''}</Text> matching your skills
          </Text>
          <Text style={s.missedValue2}>~${m.missed_opportunity.total_value.toLocaleString()} on the table</Text>
          <View style={s.missedListRow}>
            {m.missed_opportunity.modules.map(mod => (
              <View key={mod.module_id} style={s.missedChip}>
                <Text style={s.missedChipTitle} numberOfLines={1}>{mod.title}</Text>
                <Text style={s.missedChipPrice}>${mod.price}</Text>
              </View>
            ))}
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: T.md, gap: T.sm },
  card: { backgroundColor: T.surface1, borderRadius: T.radiusSm, padding: T.md, borderWidth: 1, borderColor: T.border },
  cardAccent: { borderColor: T.riskBorder },
  cardElite: { borderColor: T.primaryBorderStrong, backgroundColor: T.primaryBg },
  cardMissed: { borderColor: T.riskBorder, backgroundColor: T.riskBg },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  cardTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  cardTitlePrimary: { color: T.primary, fontSize: T.body, fontWeight: '700' },
  cardTitleWarn: { color: T.risk, fontSize: T.body, fontWeight: '700' },
  cardSub: { color: T.textMuted, fontSize: T.small },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  progressBarOuter: { flex: 1, height: 6, backgroundColor: T.surface3, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: 6, backgroundColor: T.risk },
  progressText: { color: T.textMuted, fontSize: T.tiny, fontWeight: '700' },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tinyPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface2 },
  tinyPillOk: { borderColor: T.successBorder, backgroundColor: T.successBg },
  tinyPillWarn: { borderColor: T.riskBorder, backgroundColor: T.riskBg },
  tinyPillAccent: { borderColor: T.primaryBorder, backgroundColor: T.primaryBg },
  tinyPillText: { color: T.textMuted, fontSize: T.tiny, fontWeight: '600' },

  statsRow: { flexDirection: 'row', gap: T.sm },
  statCard: { flex: 1, alignItems: 'center', backgroundColor: T.surface1, borderRadius: T.radiusSm, paddingVertical: 10, borderWidth: 1, borderColor: T.border, gap: 2 },
  statVal: { color: T.text, fontSize: T.h3, fontWeight: '800' },
  statLbl: { color: T.textMuted, fontSize: T.tiny },

  missedLine: { color: T.text, fontSize: T.small, marginBottom: 2 },
  missedValue: { color: T.risk, fontWeight: '700' },
  missedValue2: { color: T.risk, fontSize: T.h3, fontWeight: '800', marginBottom: 8 },
  missedListRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  missedChip: { backgroundColor: T.surface2, borderWidth: 1, borderColor: T.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 180 },
  missedChipTitle: { color: T.text, fontSize: T.tiny, fontWeight: '600', flexShrink: 1 },
  missedChipPrice: { color: T.primary, fontSize: T.tiny, fontWeight: '700' },
});
