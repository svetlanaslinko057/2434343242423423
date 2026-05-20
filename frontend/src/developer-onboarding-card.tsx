/**
 * DeveloperOnboardingCard — one-time tip shown to new developers on /developer/home.
 *
 * Visible when:
 *  • Developer has 0 active modules AND 0 completed modules, OR
 *  • lifetime_earned is 0
 *
 * Dismissed permanently (per device) via `@/src/utils/storage` keyed by
 * `dev_onboarding_dismissed:{user_id}`.
 *
 * Goal: tell freshers where to find Marketplace, Leaderboard, Growth & QA Feedback
 * so they don't bounce off the home screen.
 */
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { storage } from './utils/storage';
import T from './theme';

type Props = {
  userId?: string;
  /** Heuristic: total modules earned + active. If 0 we show the card. */
  hasZeroActivity: boolean;
};

export default function DeveloperOnboardingCard({ userId, hasZeroActivity }: Props) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  const key = `dev_onboarding_dismissed:${userId || 'anon'}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await storage.getItem(key, '0');
        if (!cancelled) setDismissed(v === '1');
      } catch {
        if (!cancelled) setDismissed(false);
      }
    })();
    return () => { cancelled = true; };
  }, [key]);

  if (dismissed === null) return null;          // first paint, hide flicker
  if (dismissed) return null;
  if (!hasZeroActivity) return null;             // already onboarded by experience

  const dismiss = async () => {
    setDismissed(true);
    try { await storage.setItem(key, '1'); } catch { /* best-effort */ }
  };

  return (
    <View style={s.card} testID="developer-onboarding-card">
      <View style={s.head}>
        <View style={s.iconBox}>
          <Ionicons name="sparkles" size={18} color={T.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Welcome to your developer cockpit</Text>
          <Text style={s.sub}>Three things to know before you ship your first module:</Text>
        </View>
        <TouchableOpacity onPress={dismiss} hitSlop={10} testID="onboarding-dismiss">
          <Ionicons name="close" size={18} color={T.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={s.tipRow}>
        <Text style={s.tipNum}>1</Text>
        <Text style={s.tipText}>
          The <Text style={s.b}>Market</Text> tab shows modules available for bids. Win a bid to start earning.
        </Text>
      </View>
      <View style={s.tipRow}>
        <Text style={s.tipNum}>2</Text>
        <Text style={s.tipText}>
          Your <Text style={s.b}>Leaderboard</Text> rank (Profile → Insights) is calculated from QA-pass rate and delivery speed.
        </Text>
      </View>
      <View style={s.tipRow}>
        <Text style={s.tipNum}>3</Text>
        <Text style={s.tipText}>
          Stuck or need help? <Text style={s.b}>Support tickets</Text> + admin chat live in Profile → Support.
        </Text>
      </View>

      <View style={s.ctaRow}>
        <TouchableOpacity
          style={s.primaryBtn}
          onPress={() => router.push('/developer/market' as any)}
          testID="onboarding-go-market"
        >
          <Text style={s.primaryBtnText}>Browse marketplace →</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.ghostBtn}
          onPress={() => router.push('/developer/profile' as any)}
          testID="onboarding-go-profile"
        >
          <Text style={s.ghostBtnText}>Profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: T.primaryBg, borderWidth: 1, borderColor: T.primaryBorder,
    borderRadius: T.radius, padding: T.md, marginBottom: T.lg,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  iconBox: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: T.primaryBorder,
  },
  title: { color: T.text, fontSize: T.body, fontWeight: '800' },
  sub: { color: T.textSecondary, fontSize: T.tiny, marginTop: 2 },

  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 6 },
  tipNum: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: T.primary, color: T.primaryInk,
    fontWeight: '800', fontSize: 11, textAlign: 'center', lineHeight: 22,
  },
  tipText: { color: T.text, fontSize: 12, lineHeight: 18, flex: 1 },
  b: { fontWeight: '800', color: T.primary },

  ctaRow: { flexDirection: 'row', gap: 8, marginTop: T.md },
  primaryBtn: {
    flex: 1, backgroundColor: T.primary, borderRadius: T.radiusSm,
    paddingVertical: 12, alignItems: 'center',
  },
  primaryBtnText: { color: T.primaryInk, fontWeight: '800', fontSize: 13 },
  ghostBtn: {
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: T.radiusSm,
    borderWidth: 1, borderColor: T.primaryBorder,
  },
  ghostBtnText: { color: T.primary, fontWeight: '800', fontSize: 13 },
});
