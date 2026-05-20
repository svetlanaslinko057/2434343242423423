import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../../src/api';
import { useAuth } from '../../src/auth';
import T from '../../src/theme';

/**
 * /lead/workspace — "your product is already in progress".
 *
 * Not a "saved estimate" screen. This is the *conversion layer*: show the
 * visitor the system is already producing their product, and that to keep
 * going they just need to unlock the workspace (= sign in with their email).
 *
 * Composition (top → bottom):
 *   1. Status strip: "System started building your product"
 *   2. Hero: "Your product is already in progress"
 *   3. Price + mode + timeline card
 *   4. Activity feed (pseudo-live): architecture generated, modules prepared,
 *      cost calculated, waiting for your unlock
 *   5. What's ready (modules preview)
 *   6. What you can't do yet (micro-loss: track / approve / receive updates)
 *   7. Primary CTA: "Continue to your product" — routes to /auth
 *   8. Reassurance: "We'll keep this plan ready for you"
 */
export default function LeadWorkspace() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const leadId = (params.id as string) || '';

  const [lead, setLead] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [claiming, setClaiming] = useState(false);

  // Pseudo-live activity: events tick in over a few seconds to reinforce
  // "system is working". No backend polling — purely client-side, so it
  // runs even without network activity after the lead loads.
  const [activityTick, setActivityTick] = useState(0);
  useEffect(() => {
    if (!lead || activityTick >= 3) return;
    const t = setTimeout(() => setActivityTick((n) => n + 1), 900);
    return () => clearTimeout(t);
  }, [lead, activityTick]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!leadId) { setError('No lead id'); setLoading(false); return; }
      try {
        const r = await api.get(`/leads/${leadId}`);
        if (cancelled) return;
        setLead(r.data);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.response?.data?.detail || 'Could not load your saved plan.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leadId]);

  // If user is already authed and the email matches, auto-claim.
  useEffect(() => {
    if (!user || !lead || claiming) return;
    const u = (user.email || '').trim().toLowerCase();
    const e = (lead.email || '').trim().toLowerCase();
    if (!u || u !== e) return;
    if (lead.claimed_project_id) {
      router.replace(`/workspace/${lead.claimed_project_id}` as any);
      return;
    }
    (async () => {
      try {
        setClaiming(true);
        const r = await api.post(`/leads/${leadId}/claim`);
        await AsyncStorage.removeItem('atlas_pending_lead_id');
        router.replace(`/workspace/${r.data.project_id}` as any);
      } catch {
        setClaiming(false);
      }
    })();
  }, [user, lead, leadId, claiming, router]);

  const unlockToAuth = () => {
    router.push({
      pathname: '/auth',
      params: { email: lead?.email || '', intent: 'client', lead_id: leadId },
    } as any);
  };

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color={T.primary} /></View>;
  }
  if (error || !lead) {
    return (
      <View style={s.center}>
        <Ionicons name="alert-circle-outline" size={36} color={T.textMuted} />
        <Text style={s.errorText}>{error || 'Plan not found'}</Text>
        <TouchableOpacity style={s.backBtn} onPress={() => router.replace('/describe' as any)}>
          <Text style={s.backBtnText}>Start a new plan</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const est = lead.estimate || {};
  const finalPrice = typeof est?.estimate?.final_price === 'number'
    ? est.estimate.final_price
    : (typeof est.final_price === 'number' ? est.final_price : null);
  const timeline: string | undefined = est?.estimate?.timeline || est?.timeline;
  const modules: string[] = Array.isArray(est?.modules_preview) ? est.modules_preview : [];
  const mode: string = lead.mode || 'hybrid';
  const modeLabel = mode === 'ai' ? 'AI Build' : mode === 'dev' ? 'Full Engineering' : 'AI + Engineering';

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} testID="lead-workspace">
      {/* Status strip — ongoing, not archived */}
      <View style={s.statusStrip} testID="lead-status-strip">
        <PulseDot />
        <Text style={s.statusText}>System started building your product</Text>
      </View>

      {/* Hero */}
      <Text style={s.heroTitle}>Your product is{"\n"}already in progress</Text>
      <Text style={s.heroSub}>
        We've generated architecture, modules, cost and timeline.{"\n"}
        One more step to unlock your workspace.
      </Text>

      {/* Summary card */}
      <View style={s.card} testID="lead-summary-card">
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 8 }}>
          <View style={s.progressPill}>
            <PulseDot size={5} />
            <Text style={s.progressPillText}>In progress</Text>
          </View>
        </View>
        {finalPrice !== null ? (
          <View>
            <Text style={s.priceLabel}>ESTIMATED PRICE</Text>
            <Text
              style={s.price}
              testID="lead-price"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
            >
              ${finalPrice.toLocaleString()}
            </Text>
            <Text style={s.priceMeta}>{modeLabel}{timeline ? ` · ${timeline}` : ''}</Text>
          </View>
        ) : (
          <Text style={s.priceMeta}>Plan prepared. Sign in to see breakdown.</Text>
        )}
      </View>

      {/* Activity feed — pseudo-live, one event every ~1s */}
      <Text style={s.sectionLabel}>LIVE ACTIVITY</Text>
      <View style={s.activityWrap} testID="lead-activity-feed">
        <ActivityRow done={activityTick >= 0} label="Architecture generated" age="just now" />
        <ActivityRow done={activityTick >= 1} label="Core modules prepared" age="moments ago" />
        <ActivityRow done={activityTick >= 2} label="Cost & timeline calculated" age="a few seconds ago" />
        <ActivityRow
          done={false}
          pending
          label="Waiting for your unlock to continue"
          age={null}
        />
      </View>

      {/* What's ready — modules */}
      {modules.length > 0 && (
        <>
          <Text style={s.sectionLabel}>READY TO BUILD · {modules.length} PARTS</Text>
          <View style={{ gap: 6 }}>
            {modules.map((m: string, i: number) => (
              <View key={`${i}-${m}`} style={s.moduleRow} testID={`lead-module-${i}`}>
                <Ionicons name="checkmark-circle" size={14} color={T.primary} />
                <Text style={s.moduleText}>{m}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* Goal */}
      <Text style={s.sectionLabel}>WHAT YOU DESCRIBED</Text>
      <View style={s.goalBox}>
        <Text style={s.goalText} testID="lead-goal">{lead.goal}</Text>
      </View>

      {/* Unlock benefits — "without account you can't" */}
      <Text style={s.sectionLabel}>UNLOCK TO CONTINUE</Text>
      <View style={s.benefitsCard}>
        <Benefit icon="git-pull-request" text="Track live build progress module by module" />
        <Benefit icon="checkmark-done" text="Approve deliverables and release payments" />
        <Benefit icon="notifications" text="Receive updates the moment something ships" />
        <Benefit icon="chatbubbles" text="Talk to the team building your product" />
      </View>

      {/* Reassurance before the CTA */}
      <View style={s.reassureRow}>
        <Ionicons name="shield-checkmark-outline" size={14} color={T.textMuted} />
        <Text style={s.reassureText}>
          We'll keep this plan ready for you — sign in anytime to continue.
        </Text>
      </View>

      {/* Primary CTA — continuation, not "sign in" */}
      {claiming ? (
        <View style={[s.primaryCta, { opacity: 0.7 }]}>
          <ActivityIndicator color={T.bg} />
          <Text style={[s.primaryCtaText, { marginLeft: 10 }]}>Unlocking your workspace…</Text>
        </View>
      ) : (
        <TouchableOpacity
          testID="lead-signin-cta"
          style={s.primaryCta}
          onPress={unlockToAuth}
          activeOpacity={0.9}
        >
          <Text style={s.primaryCtaText}>Continue to your product</Text>
          <Ionicons name="arrow-forward" size={18} color={T.bg} />
        </TouchableOpacity>
      )}
      <Text style={s.ctaHint}>
        Takes 10 seconds · No payment · Email-code or password — your choice
      </Text>

      <TouchableOpacity
        testID="lead-back-new"
        style={s.tinyBtn}
        onPress={() => router.replace('/describe' as any)}
      >
        <Text style={s.tinyBtnText}>← Describe a different product</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ────────────────── internal components ──────────────────

function PulseDot({ size = 8 }: { size?: number }) {
  const a = useMemo(() => new Animated.Value(0.5), []);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(a, { toValue: 0.5, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [a]);
  return (
    <Animated.View
      style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: T.primaryAccent, opacity: a,
      }}
    />
  );
}

function ActivityRow({
  done, pending, label, age,
}: { done: boolean; pending?: boolean; label: string; age: string | null }) {
  return (
    <View style={s.activityRow}>
      <View style={[s.activityIcon, done && s.activityIconDone, pending && s.activityIconPending]}>
        {done ? (
          <Ionicons name="checkmark" size={12} color={T.primaryInk} />
        ) : pending ? (
          <PulseDot size={6} />
        ) : (
          <Ionicons name="ellipse-outline" size={12} color={T.textMuted} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.activityLabel, !done && !pending && { color: T.textMuted }]}>{label}</Text>
        {age ? <Text style={s.activityAge}>{age}</Text> : null}
      </View>
    </View>
  );
}

function Benefit({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={s.benefitRow}>
      <View style={s.benefitIcon}>
        <Ionicons name={icon} size={14} color={T.primary} />
      </View>
      <Text style={s.benefitText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.lg, paddingBottom: T.xl * 3 },
  center: { flex: 1, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center', padding: T.lg, gap: T.md },

  statusStrip: {
    flexDirection: 'row', alignItems: 'center', gap: T.sm,
    paddingVertical: T.sm, paddingHorizontal: T.md,
    backgroundColor: T.primaryBg,
    borderRadius: 999,
    borderWidth: 1, borderColor: T.primaryBg,
    alignSelf: 'flex-start',
    marginTop: T.sm,
  },
  statusText: { color: T.success, fontSize: T.small, fontWeight: '700' },

  heroTitle: { color: T.text, fontSize: 32, fontWeight: '800', lineHeight: 38, marginTop: T.md },
  heroSub: { color: T.textMuted, fontSize: T.body, marginTop: T.sm, lineHeight: 22, marginBottom: T.lg },

  card: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: 18, padding: T.lg,
    marginBottom: T.lg,
  },
  priceLabel: { color: T.textMuted, fontSize: 11, letterSpacing: 2, fontWeight: '800' },
  price: { color: T.text, fontSize: 44, fontWeight: '800', marginTop: 6, letterSpacing: -0.5 },
  priceMeta: { color: T.textSecondary, fontSize: T.small, marginTop: 4 },

  progressPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: T.primaryBg, borderWidth: 1, borderColor: T.primaryBg,
  },
  progressPillText: { color: T.success, fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },

  sectionLabel: {
    color: T.textMuted, fontSize: 11, letterSpacing: 2,
    fontWeight: '800', marginTop: T.lg, marginBottom: T.sm,
  },

  activityWrap: {
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    borderRadius: 14, padding: T.md, gap: 2,
  },
  activityRow: {
    flexDirection: 'row', alignItems: 'center', gap: T.sm,
    paddingVertical: 10,
  },
  activityIcon: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: T.border,
    backgroundColor: T.surface2,
  },
  activityIconDone: { backgroundColor: T.success, borderColor: T.success },
  activityIconPending: { backgroundColor: T.surface2, borderColor: T.primaryBg },
  activityLabel: { color: T.text, fontSize: T.body, fontWeight: '600' },
  activityAge: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },

  moduleRow: {
    flexDirection: 'row', alignItems: 'center', gap: T.sm,
    paddingVertical: 8, paddingHorizontal: T.md,
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    borderRadius: 10,
  },
  moduleText: { color: T.text, fontSize: T.body, flex: 1 },

  goalBox: {
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    borderRadius: 12, padding: T.md,
  },
  goalText: { color: T.text, fontSize: T.body, lineHeight: 22 },

  benefitsCard: {
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    borderRadius: 14, padding: T.md, gap: 2,
  },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: T.sm, paddingVertical: 8 },
  benefitIcon: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: T.primaryBg, borderWidth: 1, borderColor: T.primaryBorder,
  },
  benefitText: { color: T.text, fontSize: T.small, flex: 1 },

  reassureRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingVertical: T.sm, paddingHorizontal: T.sm,
    marginTop: T.lg,
  },
  reassureText: { color: T.textMuted, fontSize: T.small, flex: 1, lineHeight: 18 },

  primaryCta: {
    marginTop: T.sm,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: T.primary, borderRadius: T.radius,
    paddingVertical: 16,
  },
  primaryCtaText: { color: T.bg, fontSize: T.body, fontWeight: '800', textAlign: 'center' },
  ctaHint: { color: T.textMuted, fontSize: T.tiny, textAlign: 'center', marginTop: T.sm, opacity: 0.85 },

  tinyBtn: { marginTop: T.lg, alignItems: 'center', paddingVertical: T.sm },
  tinyBtnText: { color: T.textMuted, fontSize: T.small },

  errorText: { color: T.textMuted, fontSize: T.body, textAlign: 'center' },
  backBtn: {
    paddingHorizontal: T.lg, paddingVertical: 10,
    borderRadius: T.radiusSm, borderWidth: 1, borderColor: T.primary,
  },
  backBtnText: { color: T.primary, fontWeight: '700' },
});
