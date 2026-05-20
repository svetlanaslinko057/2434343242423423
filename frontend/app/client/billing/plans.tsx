// Productization Layer — Pricing Plans
//
// Three fixed tiers (Starter / Growth / Scale). Subscribe is mocked — flips a
// flag on the user record. Real Stripe checkout would replace `api.post` once
// a key is provided; the rest of the flow stays the same.

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
// ─── Runtime-client migration (Batch 2 — Expo Client Cabinet) ───────────
// Transport-swap only. Local loading/acting state preserved (doctrine).
// `/client/subscribe` is currently a MOCK flag-flip on the user record (real
// Stripe checkout slated for later). We do NOT add `capability: 'payment'`
// here because today's endpoint does not move money. Idempotency stays
// regardless so admin double-tap protection is in place when the real
// checkout lands.
import { runtime } from '../../../src/runtime';
import { ApiError } from '../../../src/runtime-client';
import T from '../../../src/theme';

type Plan = {
  slug: string;
  name: string;
  price_monthly: number;
  tagline: string;
  features: string[];
  highlighted?: boolean;
};

export default function PricingPlansScreen() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [current, setCurrent] = useState<string>('none');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        runtime.get('/api/billing/plans'),
        runtime.get('/api/client/subscription'),
      ]);
      setPlans(p.data?.plans || []);
      setCurrent(c.data?.slug || 'none');
    } catch {
      /* silent — preserves original telemetry surface */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const subscribe = async (plan: Plan) => {
    setActing(plan.slug);
    try {
      // Today this just flips a flag on the user record (no money movement);
      // when real Stripe checkout replaces this endpoint, we'll add
      // `capability: 'payment'`. Idempotency is here today already so
      // double-tap doesn't double-flip on slow networks.
      await runtime.post('/api/client/subscribe', { slug: plan.slug }, {
        idempotencyKey: `subscribe:${plan.slug}`,
      });
      Alert.alert(
        'Welcome to ' + plan.name,
        `Your product is now on ${plan.name} — operator will pick up faster, and your add-ons get priority.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
      setCurrent(plan.slug);
    } catch (e: any) {
      const msg = e instanceof ApiError ? (e.message || e.code) : 'Could not change plan';
      Alert.alert('Error', msg);
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[s.flex, s.center]} edges={['top']}>
        <ActivityIndicator color={T.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.flex} edges={['top']}>
      <View style={s.topBar}>
        <TouchableOpacity testID="plans-back" onPress={() => router.back()} style={s.backIcon} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={T.text} />
          <Text style={s.backLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={s.topTitle} numberOfLines={1}>Your product. Managed.</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={s.flex} contentContainerStyle={s.container} testID="plans-screen">
        <Text style={s.intro}>
          You don't pay for "developer hours". You pay for a product that's actively
          managed, expanded, and delivered to your door — month after month.
        </Text>

        {plans.map((plan) => {
          const isCurrent = plan.slug === current;
          return (
            <View
              key={plan.slug}
              style={[s.card, plan.highlighted && s.cardHighlight, isCurrent && s.cardCurrent]}
              testID={`plan-card-${plan.slug}`}
            >
              {plan.highlighted && !isCurrent && (
                <View style={s.badge}><Text style={s.badgeText}>RECOMMENDED</Text></View>
              )}
              {isCurrent && (
                <View style={[s.badge, s.badgeCurrent]}><Text style={s.badgeText}>CURRENT PLAN</Text></View>
              )}

              <Text style={s.planName}>{plan.name}</Text>
              <Text style={s.planTagline}>{plan.tagline}</Text>

              <View style={s.priceRow}>
                <Text style={s.priceCurrency}>$</Text>
                <Text style={s.price}>{plan.price_monthly}</Text>
                <Text style={s.priceSuffix}>/mo</Text>
              </View>

              {plan.features.map((f, i) => (
                <View key={i} style={s.feature}>
                  <Ionicons name="checkmark-circle" size={16} color={T.primary} />
                  <Text style={s.featureText}>{f}</Text>
                </View>
              ))}

              <TouchableOpacity
                testID={`plan-subscribe-${plan.slug}`}
                style={[
                  s.cta,
                  plan.highlighted ? s.ctaPrimary : s.ctaGhost,
                  isCurrent && s.ctaDisabled,
                  acting === plan.slug && { opacity: 0.6 },
                ]}
                onPress={() => !isCurrent && subscribe(plan)}
                disabled={!!acting || isCurrent}
                activeOpacity={0.85}
              >
                <Text style={[s.ctaText, plan.highlighted ? s.ctaPrimaryText : s.ctaGhostText]}>
                  {isCurrent ? 'Active'
                    : acting === plan.slug ? 'Activating…'
                    : `Choose ${plan.name}`}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}

        <Text style={s.footer}>
          Module payments stay the same — you only pay when each delivered piece
          is approved. The plan covers operator priority, capacity and routing.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  center: { justifyContent: 'center', alignItems: 'center' },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: T.md, paddingVertical: T.sm,
    borderBottomWidth: 1, borderBottomColor: T.border,
    backgroundColor: T.surface1,
  },
  backIcon: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 60 },
  backLabel: { color: T.text, fontSize: T.small, fontWeight: '600' },
  topTitle: { color: T.text, fontSize: T.body, fontWeight: '700', flex: 1, textAlign: 'center', marginHorizontal: 8 },

  container: { padding: T.lg, paddingBottom: 100 },
  intro: { color: T.textSecondary, fontSize: T.small, marginBottom: T.lg, lineHeight: 20 },

  card: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius,
    padding: T.lg,
    marginBottom: T.md,
  },
  cardHighlight: { borderColor: T.primaryBorderStrong, backgroundColor: T.primaryBg },
  cardCurrent:   { borderColor: T.primary, backgroundColor: T.primaryBg },

  badge: {
    position: 'absolute' as const, top: -10, right: 16,
    backgroundColor: T.primary,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 8,
  },
  badgeCurrent: { backgroundColor: T.success },
  badgeText: { color: T.bg, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },

  planName: { color: T.text, fontSize: T.h2, fontWeight: '900' },
  planTagline: { color: T.textMuted, fontSize: T.small, marginTop: 4 },

  priceRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: T.md, marginBottom: T.md },
  priceCurrency: { color: T.text, fontSize: T.body, fontWeight: '700', marginRight: 2, marginBottom: 6 },
  price: { color: T.text, fontSize: 38, fontWeight: '900', lineHeight: 40 },
  priceSuffix: { color: T.textMuted, fontSize: T.small, marginBottom: 8, marginLeft: 4 },

  feature: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginVertical: 4 },
  featureText: { color: T.text, fontSize: T.small, flex: 1, lineHeight: 20 },

  cta: {
    marginTop: T.md,
    paddingVertical: 12,
    borderRadius: T.radiusSm,
    alignItems: 'center',
  },
  ctaPrimary: { backgroundColor: T.primary },
  ctaGhost:   { backgroundColor: 'transparent', borderWidth: 1, borderColor: T.primary },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontSize: T.body, fontWeight: '800' },
  ctaPrimaryText: { color: T.bg },
  ctaGhostText:   { color: T.primary },

  footer: { color: T.textMuted, fontSize: T.tiny, textAlign: 'center', marginTop: T.lg, lineHeight: 16 },
});
