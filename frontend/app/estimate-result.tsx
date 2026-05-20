import { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  Alert,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../src/api';
import { useAuth } from '../src/auth';
import {
  FadeSlideIn,
  PressScale,
  PulseDot,
  PrimaryButton,
} from '../src/ui';
import { motion } from '../src/motion';
import T from '../src/theme';

/**
 * Estimate Result — the most important screen in the funnel.
 *
 * UX rule (per product spec):
 *   "We don't compute the project. We've already designed it."
 *
 * Six blocks, in this exact order:
 *   1. "Ready to build" eyebrow + product summary  ← "you understood me"
 *   2. "What we will build"   — modules in product language (cards)
 *   3. "How it will happen"   — 3 phases (Foundation → Core → Launch-ready)
 *   4. "Total & payment"      — all 3 plans shown side-by-side, no dropdown
 *   5. "After you start"      — what happens next (kills "what now?" fear)
 *   6. CTA                    — "Start building this product →"
 *
 * Forbidden language: backend, API, infra, "approximate", "may change".
 *
 * Funnel split:
 *   • Authed user  → CTA → POST /api/projects → /project-booting
 *   • Visitor      → CTA → email capture → POST /api/leads/intake → /lead/workspace
 *     (NO account, NO password, NO payment up-front)
 */

type EstimateData = {
  clarity: 'good' | 'low';
  estimate: {
    base: number;
    multiplier: number;
    final_price: number;
    implementation_price?: number;
    reality_multiplier?: number;
    timeline: string;
    complexity: 'simple' | 'medium' | 'complex';
    quality_band: string;
    estimated_hours?: number | null;
  };
  reality_layer?: {
    axes: Record<string, string>;
    axes_source: string;
    multiplier: number;
    narrative_chips: string[];
  };
  modules_preview: string[];
  modules_detailed?: { title: string; description?: string; hours?: number }[];
  tech_stack?: string[];
  mode: 'ai' | 'hybrid' | 'dev';
  confidence: number;
  ai_generated?: boolean;
  matched_template?: { name: string; similarity: number } | null;
  generated_at: string;
};

const MODE_LABEL: Record<string, string> = {
  ai: 'AI Build',
  hybrid: 'AI + Engineering',
  dev: 'Full Engineering',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step = 'idle' | 'register' | 'saving';
type PaymentPlan = 'full' | 'half' | 'milestones';

const GUEST_MODULES_VISIBLE = 3;

/* ============================================================ */
/*  Pure helpers                                                 */
/* ============================================================ */

/** Build a friendly product summary from the user's raw goal text. */
function buildProductSummary(goal: string, modeLabel: string): string {
  const g = goal.trim();
  if (!g) return `A ${modeLabel.toLowerCase()} product, fully designed and ready to build.`;
  // First sentence, capped at 160 chars — keeps the headline tight.
  const firstSentence = g.split(/(?<=[.!?])\s+/)[0] || g;
  return firstSentence.length > 160
    ? firstSentence.slice(0, 157) + '…'
    : firstSentence;
}

/** Group modules into 3 product-language phases. Pure function, no state. */
function bucketModulesIntoPhases(
  modules: string[],
): { title: string; outcome: string; items: string[] }[] {
  if (modules.length === 0) return [];
  const total = modules.length;
  const a = Math.max(1, Math.ceil(total / 3));
  const b = Math.max(1, Math.ceil((total - a) / 2));
  return [
    {
      title: 'Phase 1 — Foundation',
      outcome: 'Your product has its core working end-to-end',
      items: modules.slice(0, a),
    },
    {
      title: 'Phase 2 — Core features',
      outcome: 'Real users can sign up and use the platform',
      items: modules.slice(a, a + b),
    },
    {
      title: 'Phase 3 — Launch-ready product',
      outcome: 'Polished, tested, ready to put in front of customers',
      items: modules.slice(a + b),
    },
  ].filter((p) => p.items.length > 0);
}

function fmtPrice(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

function priceForPlan(total: number, plan: PaymentPlan) {
  if (plan === 'full') {
    const discounted = Math.round(total * 0.9);
    return { headline: fmtPrice(discounted), sub: `Pay once · save ${fmtPrice(total - discounted)}` };
  }
  if (plan === 'half') {
    return { headline: fmtPrice(Math.round(total / 2)), sub: `Now · then ${fmtPrice(total - Math.round(total / 2))} on completion` };
  }
  // milestones 30/40/30
  const a = Math.round(total * 0.3);
  const b = Math.round(total * 0.4);
  const c = total - a - b;
  return {
    headline: fmtPrice(a),
    sub: `Start · ${fmtPrice(b)} mid · ${fmtPrice(c)} final`,
  };
}

/* ============================================================ */
/*  Component                                                    */
/* ============================================================ */

export default function EstimateResult() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    data: string;
    goal: string;
    mode: string;
    sourceUrl?: string;
    sourceTitle?: string;
  }>();
  const { user, register } = useAuth();

  const data: EstimateData | null = useMemo(() => {
    try {
      return params.data ? JSON.parse(params.data as string) : null;
    } catch {
      return null;
    }
  }, [params.data]);

  const goal = (params.goal as string) || '';
  const mode = (params.mode as string) || 'hybrid';
  const modeLabel = MODE_LABEL[mode] || 'AI + Engineering';
  const sourceUrl = (params.sourceUrl as string) || '';
  const sourceTitle = (params.sourceTitle as string) || '';
  const sourceHost = useMemo(() => {
    if (!sourceUrl) return '';
    try { return new URL(sourceUrl).hostname.replace(/^www\./, ''); }
    catch { return sourceUrl; }
  }, [sourceUrl]);

  const [step, setStep] = useState<Step>('idle');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<PaymentPlan>('half');

  // Inline register state — mirrors the web /estimate-result inline signup
  // pattern. No redirect to /auth; user fills name + password right here,
  // backend POST /api/mobile/auth/register auto-logs them in, useAuth.user
  // becomes truthy, and the gated module list rerenders unlocked in place.
  const [regName, setRegName] = useState('');
  const [regPassword, setRegPassword] = useState('');

  const isRealUser = !!user?.email && !user.email.startsWith('demo_');

  const summary = useMemo(() => buildProductSummary(goal, modeLabel), [goal, modeLabel]);
  const phases = useMemo(
    () => bucketModulesIntoPhases(data?.modules_preview || []),
    [data?.modules_preview],
  );

  if (!data || !data.estimate) {
    return (
      <View style={s.errorWrap}>
        <Text style={s.errorText}>Estimate expired.</Text>
        <PressScale style={s.backBtn} onPress={() => router.replace('/describe' as any)}>
          <Text style={s.backBtnText}>Start a new plan</Text>
        </PressScale>
      </View>
    );
  }

  const totalPrice = data.estimate.final_price;

  /**
   * Authed user: skip lead bridge, create project directly.
   */
  const createProjectDirect = async () => {
    setStep('saving');
    try {
      const title = goal.trim().slice(0, 80) || 'New product';
      // Pass axes back to the backend so the price the client SAW
      // becomes the price they PAY (immutable snapshot in projects.reality_layer).
      const r = await api.post('/projects', {
        title,
        goal: goal.trim() || null,
        mode,
        payment_plan: selectedPlan,
        axes: data.reality_layer?.axes,
        axes_source: data.reality_layer?.axes_source,
      });
      router.replace(`/project-booting?id=${r.data.project_id}` as any);
    } catch (e: any) {
      Alert.alert('Could not start', e?.response?.data?.detail || String(e));
      setStep('idle');
    }
  };

  /**
   * Visitor path — save the estimate as a lead and send to lead workspace.
   */
  const saveAsLead = async () => {
    const emailClean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(emailClean)) {
      setError('Enter a valid email, e.g. you@company.com');
      return;
    }
    setError('');
    setStep('saving');
    try {
      const r = await api.post('/leads/intake', {
        email: emailClean,
        goal: goal.trim(),
        mode,
        estimate: data,
        payment_plan: selectedPlan,
      });
      await AsyncStorage.setItem('atlas_pending_lead_id', r.data.lead_id);
      router.replace({
        pathname: '/lead/workspace',
        params: { id: r.data.lead_id },
      } as any);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not save your plan. Try again.');
      setStep('idle');
    }
  };

  const onMainCta = () => {
    if (isRealUser) createProjectDirect();
    else setStep('register');
  };

  /**
   * Inline register — guest fills name + email + password right on the
   * estimate-result screen. We call useAuth().register() which hits
   * /api/mobile/auth/register, persists the token, flips useAuth.user →
   * truthy. That makes isRealUser true on the next render, the module
   * gate falls away, and the same CTA now goes straight to project
   * creation. No redirect to /auth, no lost estimate state.
   */
  const handleRegister = async () => {
    const emailClean = email.trim().toLowerCase();
    if (regName.trim().length < 2) {
      setError('Enter your name (2+ characters).');
      return;
    }
    if (!EMAIL_RE.test(emailClean)) {
      setError('Enter a valid email, e.g. you@company.com');
      return;
    }
    if (regPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setError('');
    setStep('saving');
    try {
      await register(emailClean, regPassword, regName.trim(), ['client']);
      // Register persists token & flips useAuth.user. Send a fire-and-forget
      // lead intake so the client's pre-signup estimate is still archived in
      // the lead workspace (operations analytics rely on this funnel record).
      try {
        await api.post('/leads/intake', {
          email: emailClean,
          goal: goal.trim(),
          mode,
          estimate: data,
          payment_plan: selectedPlan,
        });
      } catch {
        /* non-critical */
      }
      // Auto-trigger project creation — skip the extra "click again" step.
      // createProjectDirect() keeps step='saving' and replaces to
      // /project-booting on success. On failure it resets to 'idle' itself.
      await createProjectDirect();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Registration failed. Try a different email.');
      setStep('register');
    }
  };

  /* ========== SAVING interstitial ========== */
  if (step === 'saving') {
    return (
      <View style={s.creatingWrap} testID="estimate-saving">
        <PulseDot size={10} />
        <Text style={s.creatingTitle}>Saving your product plan…</Text>
        <Text style={s.creatingSub}>{phases.length} phases · plan will be waiting for you</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: T.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        testID="estimate-result-screen"
        keyboardShouldPersistTaps="handled"
      >
        {/* ===== BLOCK 1 — "Ready to build" + summary ===== */}
        <FadeSlideIn>
          <View style={s.readyChip} testID="estimate-ready-chip">
            <Ionicons name="flash" size={14} color={T.bg} />
            <Text style={s.readyChipText}>Your product is ready to build</Text>
          </View>
          <Text style={s.eyebrow}>YOUR PRODUCT</Text>
          <Text style={s.summaryTitle} testID="estimate-summary">{summary}</Text>
          <Text style={s.summaryNote}>
            We structured your idea into a buildable product.
          </Text>
          {!!sourceHost && (
            <View style={s.competitorBadge} testID="estimate-source-badge">
              <Ionicons name="link" size={12} color={T.textSecondary} />
              <Text style={s.competitorBadgeLabel}>Based on competitor:</Text>
              <Text
                style={s.competitorBadgeValue}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {sourceTitle ? `${sourceHost} — ${sourceTitle}` : sourceHost}
              </Text>
            </View>
          )}
        </FadeSlideIn>

        {/* ===== BLOCK 2 — What we will build ===== */}
        <FadeSlideIn delay={motion.staggerStep}>
          <Text style={[s.eyebrow, { marginTop: T.xl }]}>
            WHAT WE WILL BUILD{!isRealUser && data.modules_preview.length > GUEST_MODULES_VISIBLE ? ` · ${data.modules_preview.length} MODULES` : ''}
          </Text>
        </FadeSlideIn>
        <View style={s.moduleGrid}>
          {(isRealUser
            ? data.modules_preview
            : data.modules_preview.slice(0, GUEST_MODULES_VISIBLE)
          ).map((m, i) => (
            <FadeSlideIn key={`mod-${i}`} delay={motion.staggerStep * (1 + i)}>
              <View style={s.moduleCard} testID={`estimate-module-${i}`}>
                <View style={s.moduleIcon}>
                  <Ionicons name="cube-outline" size={18} color={T.primary} />
                </View>
                <Text style={s.moduleCardTitle}>{m}</Text>
              </View>
            </FadeSlideIn>
          ))}
          {!isRealUser && data.modules_preview.length > GUEST_MODULES_VISIBLE && (
            <FadeSlideIn delay={motion.staggerStep * (1 + GUEST_MODULES_VISIBLE)}>
              <TouchableOpacity
                style={s.lockedModuleCard}
                onPress={() => setStep('register')}
                activeOpacity={0.85}
                testID="estimate-modules-locked"
              >
                <Ionicons name="lock-closed" size={20} color={T.primary} />
                <Text style={s.lockedModuleTitle}>
                  {data.modules_preview.length - GUEST_MODULES_VISIBLE} more modules
                </Text>
                <Text style={s.lockedModuleSub}>Sign up to unlock the full scope</Text>
              </TouchableOpacity>
            </FadeSlideIn>
          )}
        </View>

        {/* ===== BLOCK 3 — How it will happen ===== */}
        <FadeSlideIn delay={motion.staggerStep * 2}>
          <Text style={[s.eyebrow, { marginTop: T.xl }]}>HOW IT WILL HAPPEN</Text>
        </FadeSlideIn>
        {phases.map((p, i) => (
          <FadeSlideIn key={p.title} delay={motion.staggerStep * (3 + i)}>
            <View style={s.phaseCard} testID={`estimate-phase-${i}`}>
              <Text style={s.phaseTitle}>{p.title}</Text>
              <Text style={s.phaseOutcome}>{p.outcome}</Text>
              <View style={s.phaseItems}>
                {p.items.map((it) => (
                  <View key={it} style={s.phaseItemRow}>
                    <Ionicons name="checkmark" size={14} color={T.primary} />
                    <Text style={s.phaseItemText}>{it}</Text>
                  </View>
                ))}
              </View>
            </View>
          </FadeSlideIn>
        ))}

        {/* ===== BLOCK 4 — Total & payment ===== */}
        <FadeSlideIn delay={motion.staggerStep * 4}>
          <Text style={[s.eyebrow, { marginTop: T.xl }]}>TOTAL & PAYMENT</Text>
          <View style={s.totalCard}>
            <Text style={s.totalLabel}>Total</Text>
            <Text style={s.totalValue} testID="estimate-price">
              {fmtPrice(totalPrice)}
            </Text>
            <Text style={s.totalMeta}>
              {modeLabel} · {data.estimate.timeline}
            </Text>
            {data.reality_layer?.narrative_chips && data.reality_layer.narrative_chips.length > 0 && (
              // Reality Layer narrative chips — production-aware context for the
              // client. Shows the WHY behind the price ("Production-grade · Realtime")
              // without exposing internal multipliers. Source of trust, not a tooltip.
              <View style={s.chipsRow} testID="estimate-reality-chips">
                {data.reality_layer.narrative_chips.slice(0, 5).map((chip, i) => (
                  <View key={`chip-${i}`} style={s.chip} testID={`reality-chip-${i}`}>
                    <Text style={s.chipText}>{chip}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </FadeSlideIn>

        <Text style={s.payChooseLabel}>Choose how to pay:</Text>
        {(['full', 'half', 'milestones'] as PaymentPlan[]).map((p, i) => {
          const info = priceForPlan(totalPrice, p);
          const active = selectedPlan === p;
          const meta = {
            full: { name: 'Pay in full', tag: 'Save 10%' },
            half: { name: '50 / 50', tag: 'Most popular' },
            milestones: { name: 'Milestones', tag: '30 / 40 / 30' },
          }[p];
          return (
            <FadeSlideIn key={p} delay={motion.staggerStep * (5 + i)}>
              <TouchableOpacity
                style={[s.payCard, active && s.payCardActive]}
                onPress={() => setSelectedPlan(p)}
                activeOpacity={0.85}
                testID={`pay-plan-${p}`}
              >
                <View style={s.payTopRow}>
                  <Text
                    style={[s.payName, active && { color: T.primary }]}
                    numberOfLines={1}
                  >
                    {meta.name}
                  </Text>
                  <View style={[s.payTag, active && s.payTagActive]}>
                    <Text
                      style={[s.payTagText, active && { color: T.bg }]}
                      numberOfLines={1}
                    >
                      {meta.tag}
                    </Text>
                  </View>
                </View>
                <Text style={s.payHeadline}>{info.headline}</Text>
                <Text style={s.paySub}>{info.sub}</Text>
                {active && (
                  <View style={s.payCheck}>
                    <Ionicons name="checkmark-circle" size={20} color={T.primary} />
                  </View>
                )}
              </TouchableOpacity>
            </FadeSlideIn>
          );
        })}

        {/* ===== BLOCK 5 — After you start ===== */}
        <FadeSlideIn delay={motion.staggerStep * 8}>
          <Text style={[s.eyebrow, { marginTop: T.xl }]}>AFTER YOU START</Text>
          <View style={s.afterCard} testID="estimate-after-card">
            {[
              'You get a working system, not tasks',
              'We handle the entire build process',
              'You track real progress in your dashboard',
              'Fixed scope, fixed price — no surprises',
            ].map((line) => (
              <View key={line} style={s.afterRow}>
                <Ionicons name="checkmark-circle" size={16} color={T.primary} />
                <Text style={s.afterText}>{line}</Text>
              </View>
            ))}
          </View>
        </FadeSlideIn>

        {/* ===== STEP: inline register — replaces email-only lead capture.
            Guest fills name + email + password; backend register persists
            token, useAuth.user flips truthy, isRealUser becomes true,
            module gate falls away, CTA changes to "Start building". No
            redirect to /auth. ===== */}
        {step === 'register' && (
          <FadeSlideIn>
            <View style={s.captureCard} testID="capture-step-register">
              <Text style={s.captureTitle}>Unlock the full breakdown</Text>
              <Text style={s.captureSub}>
                10 seconds. No payment yet. After signup the rest of your{' '}
                {data.modules_preview.length} modules unlock, and you can lock the
                price with a 10% deposit.
              </Text>
              <TextInput
                testID="capture-name"
                style={[s.input, error && !regName ? s.inputErr : null]}
                placeholder="Your name"
                placeholderTextColor={T.textMuted}
                autoCapitalize="words"
                autoFocus
                value={regName}
                onChangeText={(v) => { setRegName(v); if (error) setError(''); }}
                returnKeyType="next"
              />
              <TextInput
                testID="capture-email"
                style={[s.input, error && !EMAIL_RE.test(email) ? s.inputErr : null, { marginTop: T.sm }]}
                placeholder="you@company.com"
                placeholderTextColor={T.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={(v) => { setEmail(v); if (error) setError(''); }}
                returnKeyType="next"
              />
              <TextInput
                testID="capture-password"
                style={[s.input, error && regPassword.length < 6 ? s.inputErr : null, { marginTop: T.sm }]}
                placeholder="Password (min 6 chars)"
                placeholderTextColor={T.textMuted}
                autoCapitalize="none"
                secureTextEntry
                value={regPassword}
                onChangeText={(v) => { setRegPassword(v); if (error) setError(''); }}
                onSubmitEditing={handleRegister}
                returnKeyType="go"
              />
              {error ? <Text style={s.fieldErr}>{error}</Text> : null}
              <PrimaryButton
                testID="capture-register-submit"
                title="Unlock my full estimate"
                onPress={handleRegister}
              />
              <Text style={s.noPaymentHint}>No payment now · Takes 10 seconds</Text>
              <TouchableOpacity
                testID="capture-register-back"
                style={s.tinyBtn}
                onPress={() => { setStep('idle'); setError(''); }}
              >
                <Text style={s.tinyBtnText}>← Back to plan</Text>
              </TouchableOpacity>
            </View>
          </FadeSlideIn>
        )}

        {/* ===== BLOCK 6 — Primary CTA ===== */}
        {step === 'idle' && (
          <FadeSlideIn delay={motion.staggerStep * 9}>
            <View style={{ marginTop: T.xl }}>
              <PrimaryButton
                testID="estimate-continue-btn"
                title={isRealUser ? 'Start building this product →' : 'Unlock full plan & start →'}
                onPress={onMainCta}
              />
              <Text style={s.postCtaHint}>
                {isRealUser
                  ? 'We start immediately. You watch progress in real time.'
                  : 'Sign up in 10 seconds to see all modules and lock the price.'}
              </Text>
              <PressScale
                style={s.secondaryBtn}
                onPress={() => router.back()}
                testID="estimate-refine-btn"
              >
                <Text style={s.secondaryText}>← Refine description</Text>
              </PressScale>
            </View>
          </FadeSlideIn>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ============================================================ */
/*  Styles                                                       */
/* ============================================================ */

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.lg, paddingTop: T.xl, paddingBottom: T.xl * 2 },

  /* Block 1 — Ready / Summary */
  readyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: T.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: T.md,
  },
  readyChipText: { color: T.bg, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  eyebrow: {
    color: T.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: T.sm,
  },
  summaryTitle: {
    color: T.text,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
    marginBottom: 6,
  },
  summaryNote: { color: T.textSecondary, fontSize: 13, lineHeight: 18 },

  /* Competitor source badge — institutional, single-row, monospaced label.
     Shown only when /describe forwarded sourceUrl. Stays muted: it is
     provenance metadata, not a CTA. */
  competitorBadge: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: T.borderSubtle,
    borderRadius: 4,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  competitorBadgeLabel: {
    fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
    fontSize: 10,
    letterSpacing: 0.8,
    color: T.textSecondary,
    textTransform: 'uppercase',
  },
  competitorBadgeValue: {
    fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
    fontSize: 11,
    color: T.textPrimary,
    flexShrink: 1,
  },

  /* Block 2 — Modules grid */
  moduleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: T.sm,
    marginTop: T.xs,
  },
  moduleCard: {
    flexBasis: '48%',
    flexGrow: 1,
    minWidth: 140,
    backgroundColor: T.surface1,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 12,
    padding: T.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.sm,
  },
  moduleIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: T.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleCardTitle: { color: T.text, fontSize: 13, fontWeight: '600', flex: 1 },
  lockedModuleCard: {
    flexBasis: '100%',
    minWidth: 140,
    backgroundColor: T.surface1,
    borderWidth: 1,
    borderColor: T.primary,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: T.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  lockedModuleTitle: {
    color: T.primary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  lockedModuleSub: {
    color: T.textMuted,
    fontSize: 12,
  },

  /* Block 3 — Phases */
  phaseCard: {
    backgroundColor: T.surface1,
    borderWidth: 1,
    borderColor: T.border,
    borderLeftWidth: 3,
    borderLeftColor: T.primary,
    borderRadius: 12,
    padding: T.md,
    marginTop: T.sm,
  },
  phaseTitle: { color: T.text, fontSize: 15, fontWeight: '800' },
  phaseOutcome: { color: T.textSecondary, fontSize: 13, marginTop: 4, lineHeight: 18 },
  phaseItems: { marginTop: T.sm, gap: 4 },
  phaseItemRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  phaseItemText: { color: T.textMuted, fontSize: 12 },

  /* Block 4 — Total + payment */
  totalCard: {
    backgroundColor: T.surface1,
    borderRadius: 16,
    padding: T.lg,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    marginTop: T.xs,
  },
  totalLabel: {
    color: T.textMuted,
    fontSize: T.tiny,
    letterSpacing: 1.4,
    fontWeight: '700',
  },
  totalValue: {
    color: T.text,
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1,
    marginTop: 4,
  },
  totalMeta: { color: T.textSecondary, fontSize: 13, marginTop: 4 },

  // Reality Layer chips — production-aware context under the price.
  // Style intentionally subtle: explains, does not advertise.
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: T.sm,
    maxWidth: '100%',
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor: T.bg,
  },
  chipText: {
    color: T.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  payChooseLabel: {
    color: T.text,
    fontSize: 14,
    fontWeight: '700',
    marginTop: T.lg,
    marginBottom: T.sm,
  },
  payCard: {
    backgroundColor: T.surface1,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 12,
    padding: T.md,
    marginBottom: T.sm,
    position: 'relative',
  },
  payCardActive: {
    borderColor: T.primary,
    backgroundColor: T.surface2,
  },
  payTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
    // payCheck (absolute, top-right) reserves ~28px of space — give the
    // badge enough room to never collide with it when active.
    paddingRight: 28,
  },
  payName: {
    color: T.text,
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,   // long names ("Milestones") yield space to the badge
    minWidth: 0,
  },
  payTag: {
    backgroundColor: T.surface2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    flexShrink: 0,   // badge text always shows in full — never clipped
    maxWidth: '60%', // hard ceiling so a stray long tag can't push the name off
  },
  payTagActive: { backgroundColor: T.primary },
  payTagText: { color: T.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  payHeadline: { color: T.text, fontSize: 22, fontWeight: '800' },
  paySub: { color: T.textSecondary, fontSize: 12, marginTop: 2 },
  payCheck: { position: 'absolute', top: 10, right: 10 },

  /* Block 5 — After you start */
  afterCard: {
    backgroundColor: T.surface1,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 12,
    padding: T.md,
    marginTop: T.xs,
    gap: 8,
  },
  afterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  afterText: { color: T.text, fontSize: 13, flex: 1 },

  /* Email capture */
  captureCard: {
    marginTop: T.xl,
    backgroundColor: T.surface1,
    borderRadius: T.radius,
    padding: T.lg,
    borderWidth: 1,
    borderColor: T.border,
  },
  captureTitle: { color: T.text, fontSize: T.h3, fontWeight: '700' },
  captureSub: {
    color: T.textSecondary,
    fontSize: 13,
    marginTop: 4,
    marginBottom: T.md,
    lineHeight: 18,
  },
  input: {
    backgroundColor: T.bg,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 10,
    padding: 14,
    color: T.text,
    fontSize: 15,
    marginBottom: T.sm,
  },
  inputErr: { borderColor: T.danger },
  fieldErr: {
    color: T.danger,
    fontSize: T.tiny,
    marginTop: -T.xs,
    marginBottom: T.sm,
    marginLeft: 4,
  },

  postCtaHint: {
    color: T.textSecondary,
    fontSize: 13,
    marginTop: T.sm,
    textAlign: 'center',
    lineHeight: 18,
  },
  noPaymentHint: { color: T.textMuted, fontSize: 12, marginTop: 6, textAlign: 'center' },

  secondaryBtn: { marginTop: T.md, alignItems: 'center', paddingVertical: T.sm },
  secondaryText: { color: T.textSecondary, fontSize: 14 },
  tinyBtn: { marginTop: T.sm, alignItems: 'center', paddingVertical: T.xs },
  tinyBtnText: { color: T.textMuted, fontSize: 13 },

  creatingWrap: {
    flex: 1,
    backgroundColor: T.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.md,
  },
  creatingTitle: { color: T.text, fontSize: 18, fontWeight: '600' },
  creatingSub: { color: T.textSecondary, fontSize: 13 },

  errorWrap: {
    flex: 1,
    backgroundColor: T.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: T.lg,
  },
  errorText: { color: T.textMuted, fontSize: 15, marginBottom: T.md },
  backBtn: {
    borderWidth: 1,
    borderColor: T.primary,
    borderRadius: T.radiusSm,
    paddingHorizontal: T.lg,
    paddingVertical: T.sm,
  },
  backBtnText: { color: T.primary, fontWeight: '700' },
});
