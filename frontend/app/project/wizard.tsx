import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform, TextInput, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/api';
import { track } from '../../src/metrics';
import T from '../../src/theme';

/**
 * Onboarding Wizard 2.0 — operational entry, not a form.
 *
 * Flow: idea → system understands → system builds → I'm inside.
 *
 *   Step 1   Type            (Landing / Web / Mobile / Custom)
 *   Step 2   Describe        (text + live AI preview of modules)
 *   Step 3   Build strategy  (Fast / Balanced / Full)
 *   Step 4   Confirm         (summary + price + delivery → Start building)
 *   Step 5   Transition      (Setting up... → /workspace/<id>)
 *
 * State continuity: every step after 1 shows what was picked before
 * ("Building: Web App · Balanced"). Autosave persists draft in AsyncStorage.
 * Exit confirms on steps 2–4. Deep links jump back to step 1 if state is empty.
 *
 * Backend uses /api/estimate (real preview) + /api/projects (real create).
 * The dead /api/projects/wizard endpoints from the previous wizard are gone.
 */

type ProjectType = 'landing' | 'web_app' | 'mobile_app' | 'custom';
type ProjectSubtype =
  | 'saas' | 'crm' | 'telegram_mini_app' | 'marketplace' | 'ai_product'
  | 'payments' | 'analytics_dashboard' | 'blockchain' | 'internal_tools';
type Mode = 'ai' | 'hybrid' | 'dev';

const TYPES: { id: ProjectType; title: string; sub: string; emoji: string }[] = [
  { id: 'landing',    title: 'Landing page',  sub: 'Launch fast · validate idea',     emoji: '🚀' },
  { id: 'web_app',    title: 'Web app',       sub: 'Dashboard · users · backend',     emoji: '🖥' },
  { id: 'mobile_app', title: 'Mobile app',    sub: 'iOS + Android product',           emoji: '📱' },
  { id: 'custom',     title: 'Custom product',sub: 'Something more complex',          emoji: '✨' },
];

// Inline "More ways to build" — same Step 1, deeper choice. Each subtype
// resolves to one of the 4 base types so downstream pricing/modules logic
// stays unchanged, but `subtype` is persisted so module suggestions and
// AI chat can be sharper.
const SUBTYPES: {
  id: ProjectSubtype; title: string; sub: string; icon: any;
  parent: ProjectType;
}[] = [
  { id: 'saas',                title: 'SaaS platform',          sub: 'Subscriptions · multi-tenant',          icon: 'cube-outline',         parent: 'web_app' },
  { id: 'crm',                 title: 'CRM system',             sub: 'Contacts · pipelines · deals',          icon: 'people-outline',       parent: 'web_app' },
  { id: 'telegram_mini_app',   title: 'Telegram mini app',      sub: 'WebApp inside Telegram',                icon: 'paper-plane-outline',  parent: 'mobile_app' },
  { id: 'marketplace',         title: 'Marketplace',            sub: 'Two-sided · escrow · reviews',          icon: 'storefront-outline',   parent: 'custom' },
  { id: 'ai_product',          title: 'AI product',             sub: 'LLM · agents · automation',             icon: 'sparkles-outline',     parent: 'custom' },
  { id: 'payments',            title: 'Payments system',        sub: 'Wallets · transfers · KYC',             icon: 'card-outline',         parent: 'web_app' },
  { id: 'analytics_dashboard', title: 'Analytics dashboard',    sub: 'Charts · metrics · reports',            icon: 'stats-chart-outline',  parent: 'web_app' },
  { id: 'blockchain',          title: 'Blockchain · smart contracts', sub: 'On-chain · Web3 · tokens',        icon: 'link-outline',         parent: 'custom' },
  { id: 'internal_tools',      title: 'Internal tools',         sub: 'Admin · ops · workflows',               icon: 'construct-outline',    parent: 'web_app' },
];

const MODES: { id: Mode; title: string; sub: string; icon: any; accent: string }[] = [
  { id: 'ai',     title: 'Speed focus',   sub: 'Ship quickly · lower cost',          icon: 'flash',       accent: T.info },
  { id: 'hybrid', title: 'Balanced',      sub: 'Best speed / quality balance',       icon: 'git-network', accent: T.primaryAccent },
  { id: 'dev',    title: 'Quality focus', sub: 'Maximum quality · longer build',     icon: 'ribbon',      accent: T.warning },
];

const TYPE_HINTS: Record<ProjectType, string> = {
  landing:    'Landing page for a new SaaS — hero, features, pricing, signup form, Stripe checkout, mobile responsive.',
  web_app:    'SaaS dashboard with auth, user management, analytics, Stripe subscriptions, admin panel.',
  mobile_app: 'Mobile app for iOS and Android with auth, profile, push notifications, in-app payments.',
  custom:     'Marketplace with two-sided users, search, messaging, escrow payments, reviews, admin moderation.',
};

const STORAGE_KEY = 'atlas_wizard_draft_v2';
const MIN_DESC = 30;

type Estimate = {
  estimate: { final_price: number; timeline: string; estimated_hours: number; quality_band: string };
  modules_preview: string[];
  modules_detailed: { title: string; description: string; hours: number }[];
  tech_stack: string[];
};

export default function WizardScreen() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);  const [ptype, setPtype] = useState<ProjectType | null>(null);
  const [psubtype, setPsubtype] = useState<ProjectSubtype | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<Mode | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Human Validation Layer add-on — optional, no commitment.
  // null = not selected; 'basic' | 'pro' | 'managed' = chosen tier.
  const [hvlTier, setHvlTier] = useState<'basic' | 'pro' | 'managed' | null>(null);

  // Transition step animation state — 3 sequential checks, ~1.5s total.
  const [transitionStage, setTransitionStage] = useState(0); // 0..3

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRef = useRef(false);

  // ─────────── autosave & hydration ───────────
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const draft = JSON.parse(raw);
          if (draft.ptype) setPtype(draft.ptype);
          if (draft.psubtype) setPsubtype(draft.psubtype);
          if (typeof draft.description === 'string') setDescription(draft.description);
          if (draft.mode) setMode(draft.mode);
        }
      } catch {/* ignore */}
      hydratedRef.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ptype, psubtype, description, mode })).catch(() => {});
  }, [ptype, psubtype, description, mode]);

  // ─────────── deep-link protection ───────────
  // If user lands on step ≥2 without state, send them back to step 1.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (step >= 2 && !ptype) setStep(1);
    if (step >= 3 && description.trim().length < MIN_DESC) setStep(2);
    if (step >= 4 && !mode) setStep(3);
  }, [step, ptype, description, mode]);

  // ─────────── live AI preview on step 2 ───────────
  useEffect(() => {
    if (step !== 2) return;
    if (description.trim().length < MIN_DESC) { setEstimate(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        setEstimateLoading(true);
        const r = await api.post('/estimate', {
          goal: description.trim(),
          mode: mode || 'hybrid',
        });
        if (r.data?.clarity === 'invalid' || r.data?.clarity === 'low') {
          setEstimate(null);
        } else {
          setEstimate(r.data);
        }
      } catch {
        setEstimate(null);
      } finally {
        setEstimateLoading(false);
      }
    }, 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [step, description, mode]);

  // ─────────── navigation ───────────
  const hasUnsaved = !!(ptype || description.trim() || mode);

  const smartBack = () => {
    if (step === 5) return; // can't go back during create
    if (step >= 2 && step <= 4) {
      setStep((step - 1) as any);
      setError('');
      return;
    }
    if (hasUnsaved) {
      Alert.alert(
        'Leave setup?',
        "You'll lose your progress.",
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Leave', style: 'destructive', onPress: () => { clearDraft(); router.back(); } },
        ],
      );
      return;
    }
    router.back();
  };

  const clearDraft = () => { AsyncStorage.removeItem(STORAGE_KEY).catch(() => {}); };

  const pickType = (id: ProjectType) => {
    setPtype(id);
    setPsubtype(null);
    setError('');
    void track('wizard_started', { type: id });
    setStep(2);
  };

  const pickSubtype = (sub: typeof SUBTYPES[number]) => {
    setPtype(sub.parent);
    setPsubtype(sub.id);
    setError('');
    void track('wizard_started', { type: sub.parent, subtype: sub.id });
    setStep(2);
  };

  const goStep3 = () => {
    if (description.trim().length < MIN_DESC) {
      setError(`Describe your idea in a bit more detail (${MIN_DESC - description.trim().length} more characters).`);
      return;
    }
    setError('');
    setStep(3);
  };

  const goStep4 = () => {
    if (!mode) { setError('Pick how to build it.'); return; }
    setError('');
    setStep(4);
  };

  // ─────────── final create + transition ───────────
  const startBuilding = async () => {
    if (!ptype || !mode || description.trim().length < MIN_DESC) return;
    setBusy(true); setError('');
    setStep(5);
    setTransitionStage(0);

    // Pace the checkmarks so the transition feels real, not fake.
    const stageTimer = setInterval(() => {
      setTransitionStage((v) => (v < 3 ? v + 1 : v));
    }, 500);

    try {
      const title = description.trim().slice(0, 80);
      const r = await api.post('/projects', {
        title,
        goal: description.trim(),
        mode,
        type: ptype,
        subtype: psubtype || undefined,
        hvl_tier: hvlTier || undefined,
      });
      void track('wizard_completed', {
        type: ptype, subtype: psubtype, mode, hours: estimate?.estimate?.estimated_hours,
        modules: estimate?.modules_preview?.length,
      });

      // Wait for stage animation to finish (min 1.5s) before redirect.
      await new Promise((res) => setTimeout(res, 1500));
      clearInterval(stageTimer);
      clearDraft();
      // Chat-first start: backend seeded a kickoff system message and returns
      // `redirect: /chat?project_id=...`. The user lands inside a conversation,
      // not on a blank workspace. Workspace is one tap away from inside chat.
      const dest = (r.data?.redirect as string) || `/chat?project_id=${r.data.project_id}`;
      router.replace(dest as any);
    } catch (e: any) {
      clearInterval(stageTimer);
      setError(e?.response?.data?.detail || 'Could not start project. Try again.');
      setStep(4);
    } finally {
      setBusy(false);
    }
  };

  // ─────────── continuity context line ───────────
  const subLabel = psubtype ? SUBTYPES.find(s => s.id === psubtype)?.title : null;
  const typeLabel = subLabel || (ptype ? TYPES.find(t => t.id === ptype)?.title : null);
  const modeLabel = mode ? MODES.find(m => m.id === mode)?.title : null;
  const contextLine = step === 1 || step === 5
    ? null
    : [typeLabel, modeLabel].filter(Boolean).join(' · ');

  // Refine-via-chat shortcut from Step 4. Carries draft into chat as a prefill
  // AND auto-sends so the conversation actually starts (no idle input box).
  const openChatPrefill = () => {
    const product = subLabel || typeLabel || 'my product';
    const prefill = `I want to refine my ${product}.`;
    void track('wizard_chat_prefill_tap', { type: ptype, subtype: psubtype });
    router.push({ pathname: '/chat', params: { prefill, send: '1' } } as any);
  };

  // ─────────── render ───────────
  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
        {step !== 5 && (
          <>
            <View style={s.header}>
              <TouchableOpacity onPress={smartBack} testID="wizard-back-btn" style={s.backBtn}>
                <Text style={s.back}>← Back</Text>
              </TouchableOpacity>
              <Text style={s.stepIndicator}>Step {step} of 4</Text>
            </View>
            <View style={s.progressTrack} testID="wizard-progress-track">
              <View style={[s.progressFill, { width: `${(step / 4) * 100}%` }]} />
            </View>
            {contextLine ? (
              <View style={s.contextLine} testID="wizard-context">
                <Ionicons name="cube-outline" size={12} color={T.primary} />
                <Text style={s.contextText}>Building: <Text style={s.contextStrong}>{contextLine}</Text></Text>
              </View>
            ) : null}
          </>
        )}

        {/* ─── STEP 1: pick type ─── */}
        {step === 1 && (
          <View>
            <Text style={s.h1}>What are you building?</Text>
            <Text style={s.sub}>Pick a starting point — you can evolve it later.</Text>
            <View style={s.grid}>
              {TYPES.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  testID={`wizard-type-${t.id}`}
                  style={[s.typeCard, ptype === t.id && !psubtype && s.typeCardActive]}
                  onPress={() => pickType(t.id)}
                  activeOpacity={0.85}
                >
                  <Text style={s.typeEmoji}>{t.emoji}</Text>
                  <Text style={s.typeTitle}>{t.title}</Text>
                  <Text style={s.typeSub}>{t.sub}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── inline "More ways to build" — same step, deeper choice ── */}
            <TouchableOpacity
              testID="wizard-more-toggle"
              style={s.moreToggle}
              onPress={() => setMoreOpen((v) => !v)}
              activeOpacity={0.7}
            >
              <Text style={s.moreToggleText}>More ways to build</Text>
              <Ionicons
                name={moreOpen ? 'chevron-up' : 'chevron-forward'}
                size={16}
                color={T.primary}
              />
            </TouchableOpacity>

            {moreOpen && (
              <View style={s.moreList} testID="wizard-more-list">
                {SUBTYPES.map((sub) => {
                  const active = psubtype === sub.id;
                  return (
                    <TouchableOpacity
                      key={sub.id}
                      testID={`wizard-subtype-${sub.id}`}
                      style={[s.subRow, active && s.subRowActive]}
                      onPress={() => pickSubtype(sub)}
                      activeOpacity={0.8}
                    >
                      <View style={s.subIcon}>
                        <Ionicons name={sub.icon} size={18} color={T.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.subTitle}>{sub.title}</Text>
                        <Text style={s.subSub}>{sub.sub}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={T.textMuted} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ─── STEP 2: describe + live AI preview ─── */}
        {step === 2 && ptype && (
          <View>
            <Text style={s.h1}>Describe your idea</Text>
            <Text style={s.sub}>We'll turn it into a real product plan.</Text>

            <Text style={s.sectionLabel}>Your product</Text>
            <TextInput
              testID="wizard-description-input"
              style={s.descInput}
              placeholder={`e.g. ${TYPE_HINTS[ptype]}`}
              placeholderTextColor={T.textMuted}
              value={description}
              onChangeText={(v) => { setDescription(v); if (error) setError(''); }}
              multiline
              autoFocus
              textAlignVertical="top"
            />
            <Text style={[s.charHint, description.trim().length > 0 && description.trim().length < MIN_DESC && { color: T.danger }]}>
              {description.trim().length === 0
                ? `min ${MIN_DESC} chars`
                : description.trim().length < MIN_DESC
                  ? `${MIN_DESC - description.trim().length} more to go`
                  : '✓ Ready'}
            </Text>

            {/* Live preview — Decision Engine starts here */}
            <View style={s.previewBox} testID="wizard-preview-box">
              <Text style={s.previewLabel}>System will build</Text>
              {description.trim().length < MIN_DESC ? (
                <Text style={s.previewEmpty}>
                  Tell us a bit more above to see what the system will produce.
                </Text>
              ) : estimateLoading && !estimate ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator size="small" color={T.primary} />
                  <Text style={s.previewMeta}>Reading your idea…</Text>
                </View>
              ) : estimate ? (
                <>
                  {(estimate.modules_preview || []).slice(0, 6).map((m, i) => (
                    <View key={i} style={s.previewRow} testID={`wizard-preview-module-${i}`}>
                      <View style={s.previewDot} />
                      <Text style={s.previewItem}>{m}</Text>
                    </View>
                  ))}
                  <View style={s.previewMetaRow}>
                    <Text style={s.previewMeta}>
                      {estimate.modules_preview?.length || 0} modules · ~{estimate.estimate?.estimated_hours || 0}h
                    </Text>
                  </View>
                </>
              ) : (
                <Text style={s.previewEmpty}>System couldn't read this yet — keep typing.</Text>
              )}
            </View>

            {error ? <Text style={s.error}>{error}</Text> : null}

            <TouchableOpacity
              testID="wizard-step2-continue-btn"
              style={[s.ctaBtn, description.trim().length < MIN_DESC && s.ctaBtnDisabled]}
              onPress={goStep3}
              disabled={description.trim().length < MIN_DESC}
            >
              <Text style={s.ctaBtnText}>Continue →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ─── STEP 3: build strategy ─── */}
        {step === 3 && ptype && (
          <View>
            <Text style={s.h1}>How should we build it?</Text>
            <Text style={s.sub}>Affects price and delivery time.</Text>

            <View style={{ gap: T.sm, marginTop: T.md }}>
              {MODES.map((m) => {
                const active = mode === m.id;
                return (
                  <TouchableOpacity
                    key={m.id}
                    testID={`wizard-mode-${m.id}`}
                    style={[s.modeCard, active && { borderColor: m.accent, backgroundColor: m.accent + '14' }]}
                    onPress={() => setMode(m.id)}
                    activeOpacity={0.85}
                  >
                    <View style={[s.modeIcon, { backgroundColor: m.accent + '22' }]}>
                      <Ionicons name={m.icon} size={18} color={m.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.modeTitle}>{m.title}</Text>
                      <Text style={s.modeSub}>{m.sub}</Text>
                    </View>
                    <Ionicons
                      name={active ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={active ? m.accent : T.textMuted}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>

            {error ? <Text style={s.error}>{error}</Text> : null}

            <TouchableOpacity
              testID="wizard-step3-continue-btn"
              style={[s.ctaBtn, !mode && s.ctaBtnDisabled]}
              onPress={goStep4}
              disabled={!mode}
            >
              <Text style={s.ctaBtnText}>Continue →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ─── STEP 4: confirm ─── */}
        {step === 4 && ptype && mode && (
          <View>
            <Text style={s.h1}>Your product is ready to start</Text>
            <Text style={s.sub}>Review — then we'll bring it to life.</Text>

            <View style={s.summaryCard} testID="wizard-summary-card">
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>Product</Text>
                <Text style={s.summaryValue}>
                  {psubtype
                    ? SUBTYPES.find(x => x.id === psubtype)?.title
                    : TYPES.find(t => t.id === ptype)?.title}
                </Text>
              </View>
              <View style={s.summaryDivider} />
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>Mode</Text>
                <Text style={s.summaryValue}>{MODES.find(m => m.id === mode)?.title}</Text>
              </View>
              {estimate && (
                <>
                  <View style={s.summaryDivider} />
                  <View style={s.summaryRow}>
                    <Text style={s.summaryLabel}>Modules</Text>
                    <Text style={s.summaryValue}>{estimate.modules_preview?.length || 0} planned</Text>
                  </View>
                  <View style={s.summaryDivider} />
                  <View style={s.summaryRow}>
                    <Text style={s.summaryLabel}>Delivery</Text>
                    <Text style={s.summaryValue}>{estimate.estimate?.timeline || '—'}</Text>
                  </View>
                </>
              )}
            </View>

            {estimate && (
              <View style={s.priceBox}>
                <Text style={s.priceLabel}>Estimated total</Text>
                <Text style={s.priceValue} testID="wizard-price-value">
                  ${Math.round(estimate.estimate?.final_price || 0).toLocaleString()}
                </Text>
                <Text style={s.priceFootnote}>
                  Pay-as-you-go · You approve and pay per module, not upfront.
                </Text>
              </View>
            )}

            {(estimate?.modules_preview || []).length > 0 && (
              <View style={{ marginTop: T.lg }}>
                <Text style={s.sectionLabel}>What you'll get</Text>
                {(estimate?.modules_detailed || []).slice(0, 6).map((m, i) => (
                  <View key={i} style={s.moduleRow} testID={`wizard-confirm-module-${i}`}>
                    <View style={s.moduleDot} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.moduleTitle}>{m.title}</Text>
                      {m.description ? <Text style={s.moduleDesc} numberOfLines={2}>{m.description}</Text> : null}
                    </View>
                    <Text style={s.moduleHours}>{m.hours}h</Text>
                  </View>
                ))}
              </View>
            )}

            {/* ── Trust layer: guided process, not "vague estimate" ── */}
            <View style={s.nextBox} testID="wizard-next-box">
              <View style={s.nextHeaderRow}>
                <Ionicons name="people-outline" size={14} color={T.primary} />
                <Text style={s.nextHeaderText}>You're not alone — we guide you through the process</Text>
              </View>
              <Text style={s.sectionLabel}>What happens next</Text>
              <NextRow n={1} title="We generate your project structure and modules" />
              <NextRow
                n={2}
                title="You refine details in chat"
                trailingIcon="chatbubble-ellipses-outline"
                onPress={openChatPrefill}
              />
              <NextRow n={3} title="We confirm scope with you" />
              <NextRow n={4} title="Development begins" />
              <View style={s.nextHint}>
                <Ionicons name="call-outline" size={13} color={T.textMuted} />
                <Text style={s.nextHintText}>Optional call with the team — if you want to go deeper</Text>
              </View>
            </View>

            {/* ── HVL add-on (optional) ──
                Capability-aligned with Human Validation Layer v2: this is NOT
                a QA contract. Client selects a tier; admin orchestrates the
                actual review campaign post-build from /admin/validation. */}
            <View style={s.hvlBox} testID="wizard-hvl-box">
              <View style={s.hvlHeaderRow}>
                <Ionicons name="eye-outline" size={14} color={T.primary} />
                <Text style={s.hvlHeaderText}>Optional add-on</Text>
              </View>
              <Text style={s.hvlTitle}>Human Validation Layer</Text>
              <Text style={s.hvlSub}>
                Independent reviewers will explore your product and report visual or usability issues before launch.{' '}
                <Text style={s.hvlSubBold}>Not engineering QA.</Text>
              </Text>

              {([
                { id: 'basic',   title: 'Basic',   detail: '3 reviewers · post-build session' },
                { id: 'pro',     title: 'Pro',     detail: '5 reviewers · broader coverage' },
                { id: 'managed', title: 'Managed', detail: 'Admin-curated review round' },
              ] as const).map((tier) => {
                const selected = hvlTier === tier.id;
                return (
                  <TouchableOpacity
                    key={tier.id}
                    testID={`wizard-hvl-${tier.id}`}
                    activeOpacity={0.85}
                    onPress={() => setHvlTier(selected ? null : tier.id)}
                    style={[s.hvlTierRow, selected && s.hvlTierRowActive]}
                  >
                    <View style={[s.hvlRadio, selected && s.hvlRadioActive]}>
                      {selected && <View style={s.hvlRadioDot} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.hvlTierTitle, selected && s.hvlTierTitleActive]}>{tier.title}</Text>
                      <Text style={s.hvlTierDetail}>{tier.detail}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}

              <Text style={s.hvlFinePrint}>
                You can skip this and add it later from the project page. Reviewers don't approve or block your launch — admins decide what's useful.
              </Text>
            </View>

            {error ? <Text style={s.error}>{error}</Text> : null}

            <TouchableOpacity
              testID="wizard-start-building-btn"
              style={[s.ctaBtn, busy && s.ctaBtnDisabled]}
              onPress={startBuilding}
              disabled={busy}
            >
              {busy ? <ActivityIndicator color={T.bg} /> : (
                <Text style={s.ctaBtnText}>Start my project →</Text>
              )}
            </TouchableOpacity>
            <Text style={s.ctaHint}>Your workspace will be ready instantly</Text>
          </View>
        )}

        {/* ─── STEP 5: transition ─── */}
        {step === 5 && (
          <View style={s.transitionWrap} testID="wizard-transition">
            <ActivityIndicator size="large" color={T.primary} />
            <Text style={s.transitionTitle}>Setting up your project…</Text>
            <Text style={s.transitionSub}>System is taking it from here.</Text>

            <View style={s.transitionStages}>
              <TransitionRow done={transitionStage >= 1} label="Structure created" />
              <TransitionRow done={transitionStage >= 2} label="Modules planned" />
              <TransitionRow done={transitionStage >= 3} label="Team assigned" />
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function TransitionRow({ done, label }: { done: boolean; label: string }) {
  return (
    <View style={s.transRow}>
      <View style={[s.transCheck, done && s.transCheckDone]}>
        {done ? <Ionicons name="checkmark" size={14} color={T.bg} /> : null}
      </View>
      <Text style={[s.transLabel, done && { color: T.text }]}>{label}</Text>
    </View>
  );
}

function NextRow({ n, title, trailingIcon, onPress }: { n: number; title: string; trailingIcon?: any; onPress?: () => void }) {
  const Body = (
    <>
      <View style={s.nextNum}>
        <Text style={s.nextNumText}>{n}</Text>
      </View>
      <Text style={s.nextTitle}>{title}</Text>
      {trailingIcon ? (
        <Ionicons name={trailingIcon} size={16} color={T.primary} style={{ marginLeft: 6 }} />
      ) : null}
      {onPress ? (
        <Ionicons name="chevron-forward" size={14} color={T.primary} style={{ marginLeft: 4 }} />
      ) : null}
    </>
  );
  if (onPress) {
    return (
      <TouchableOpacity
        style={[s.nextRow, s.nextRowTappable]}
        onPress={onPress}
        activeOpacity={0.75}
        testID={`wizard-next-step-${n}`}
      >
        {Body}
      </TouchableOpacity>
    );
  }
  return (
    <View style={s.nextRow} testID={`wizard-next-step-${n}`}>
      {Body}
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  container: { padding: T.lg, paddingTop: T.xl + T.md, paddingBottom: T.xl * 2 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: T.sm },
  backBtn: { paddingVertical: 4, paddingRight: 8 },
  back: { color: T.primary, fontSize: T.body, fontWeight: '600' },
  stepIndicator: { color: T.textMuted, fontSize: T.small, fontWeight: '700', letterSpacing: 0.5 },

  progressTrack: {
    height: 4, borderRadius: 2,
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    overflow: 'hidden', marginBottom: T.md,
  },
  progressFill: { height: '100%', backgroundColor: T.primary, borderRadius: 2 },

  contextLine: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, paddingHorizontal: 10,
    backgroundColor: T.primaryBg,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginBottom: T.lg,
  },
  contextText: { color: T.textMuted, fontSize: T.tiny, fontWeight: '600' },
  contextStrong: { color: T.primary, fontWeight: '800' },

  h1: { color: T.text, fontSize: T.h1, fontWeight: '800', marginBottom: T.xs, lineHeight: 36 },
  sub: { color: T.textMuted, fontSize: T.body, marginBottom: T.xl, lineHeight: 22 },
  sectionLabel: { color: T.textMuted, fontSize: T.tiny, fontWeight: '800', letterSpacing: 2, marginBottom: T.sm, marginTop: T.md },

  // STEP 1
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  typeCard: {
    width: '48%',
    backgroundColor: T.surface1, borderRadius: T.radiusLg, padding: T.md,
    borderWidth: 1, borderColor: T.border, minHeight: 130,
    justifyContent: 'flex-start',
    marginBottom: T.md,
  },
  typeCardActive: { borderColor: T.primary, backgroundColor: T.primaryBg },
  typeEmoji: { fontSize: 28, marginBottom: T.sm },
  typeIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: T.primaryBgStrong,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: T.sm,
  },
  typeTitle: { color: T.text, fontSize: T.h3, fontWeight: '700', marginBottom: 4 },
  typeSub: { color: T.textMuted, fontSize: T.small, lineHeight: 18 },

  // STEP 1 — inline "More ways to build"
  moreToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: T.md, paddingHorizontal: T.md - 2,
    borderTopWidth: 1, borderTopColor: T.border,
    marginTop: T.xs,
  },
  moreToggleText: { color: T.primary, fontSize: T.body, fontWeight: '700' },
  moreList: {
    backgroundColor: T.surface1,
    borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    overflow: 'hidden',
    marginTop: 2,
  },
  subRow: {
    flexDirection: 'row', alignItems: 'center', gap: T.md,
    paddingVertical: T.sm + 4, paddingHorizontal: T.md,
    borderBottomWidth: 1, borderBottomColor: T.border,
  },
  subRowActive: { backgroundColor: T.primaryBg },
  subIcon: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: T.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  subTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  subSub: { color: T.textMuted, fontSize: T.tiny, marginTop: 2, lineHeight: 16 },

  // STEP 2
  descInput: {
    backgroundColor: T.surface1, borderRadius: T.radius, borderWidth: 1, borderColor: T.border,
    color: T.text, fontSize: T.body, padding: T.md, minHeight: 110,
  },
  charHint: { color: T.textMuted, fontSize: T.tiny, marginTop: 6, fontWeight: '600' },

  previewBox: {
    marginTop: T.lg,
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border, padding: T.md, minHeight: 140,
  },
  previewLabel: { color: T.primary, fontSize: T.tiny, fontWeight: '800', letterSpacing: 2, marginBottom: T.sm },
  previewEmpty: { color: T.textMuted, fontSize: T.small, fontStyle: 'italic', lineHeight: 20 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: T.sm, paddingVertical: 4 },
  previewDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: T.primary },
  previewItem: { color: T.text, fontSize: T.small, fontWeight: '600' },
  previewMetaRow: { marginTop: T.sm, paddingTop: T.sm, borderTopWidth: 1, borderTopColor: T.border },
  previewMeta: { color: T.textMuted, fontSize: T.tiny, fontWeight: '600' },

  // STEP 3
  modeCard: {
    flexDirection: 'row', alignItems: 'center', gap: T.md,
    backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md,
    borderWidth: 1, borderColor: T.border,
  },
  modeIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  modeTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  modeSub: { color: T.textMuted, fontSize: T.small, marginTop: 2 },

  // STEP 4
  summaryCard: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border, padding: T.md, marginTop: T.md,
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8,
  },
  summaryLabel: { color: T.textMuted, fontSize: T.small, fontWeight: '600' },
  summaryValue: { color: T.text, fontSize: T.body, fontWeight: '700' },
  summaryDivider: { height: 1, backgroundColor: T.border, opacity: 0.6 },

  priceBox: {
    marginTop: T.lg,
    backgroundColor: T.primaryBg,
    borderWidth: 1, borderColor: T.primary,
    borderRadius: T.radius, padding: T.lg,
    alignItems: 'center',
  },
  priceLabel: { color: T.primary, fontSize: T.tiny, fontWeight: '800', letterSpacing: 2 },
  priceValue: { color: T.text, fontSize: 38, fontWeight: '800', marginTop: 6 },
  priceFootnote: { color: T.textMuted, fontSize: T.tiny, marginTop: T.sm, textAlign: 'center', lineHeight: 16 },

  moduleRow: {
    flexDirection: 'row', alignItems: 'center', gap: T.sm,
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    borderWidth: 1, borderColor: T.border,
    padding: T.sm + 2, marginTop: 6,
  },
  moduleDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.primary },
  moduleTitle: { color: T.text, fontSize: T.small, fontWeight: '700' },
  moduleDesc: { color: T.textMuted, fontSize: T.tiny, marginTop: 2, lineHeight: 16 },
  moduleHours: { color: T.primary, fontSize: T.tiny, fontWeight: '800' },

  // STEP 4 — "What happens next" trust block
  nextBox: {
    marginTop: T.lg,
    backgroundColor: T.surface1,
    borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.md,
  },
  nextHeaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingBottom: T.sm + 2,
    marginBottom: T.sm + 2,
    borderBottomWidth: 1, borderBottomColor: T.border,
  },
  nextHeaderText: { color: T.text, fontSize: T.small, fontWeight: '700' },
  nextRow: {
    flexDirection: 'row', alignItems: 'center', gap: T.sm + 2,
    paddingVertical: 8,
  },
  nextRowTappable: {
    paddingHorizontal: T.sm,
    marginHorizontal: -T.sm,
    borderRadius: 8,
  },
  nextNum: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: T.primaryBgStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  nextNumText: { color: T.primary, fontSize: T.tiny, fontWeight: '800' },
  nextTitle: { color: T.text, fontSize: T.small, fontWeight: '600', flex: 1 },
  nextHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: T.sm + 2,
    paddingTop: T.sm + 2,
    borderTopWidth: 1, borderTopColor: T.border,
  },
  nextHintText: { color: T.textMuted, fontSize: T.tiny, fontWeight: '600' },

  // HVL add-on (Step 4)
  hvlBox: {
    marginTop: T.lg,
    backgroundColor: T.surface1,
    borderRadius: T.radius,
    padding: T.md,
    borderWidth: 1,
    borderColor: T.border,
  },
  hvlHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: T.xs },
  hvlHeaderText: { color: T.primary, fontSize: 10, letterSpacing: 2, fontWeight: '700' },
  hvlTitle: { color: T.text, fontSize: T.body + 1, fontWeight: '800', marginBottom: 4 },
  hvlSub: { color: T.textMuted, fontSize: T.small, lineHeight: 18, marginBottom: T.sm + 2 },
  hvlSubBold: { color: T.textSecondary || T.text, fontWeight: '700' },
  hvlTierRow: {
    flexDirection: 'row', alignItems: 'center', gap: T.sm,
    paddingVertical: T.sm, paddingHorizontal: T.sm,
    borderRadius: T.radiusSm,
    borderWidth: 1, borderColor: T.border,
    backgroundColor: 'transparent',
    marginBottom: T.xs,
  },
  hvlTierRowActive: { borderColor: T.primary, backgroundColor: T.primary + '15' },
  hvlRadio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 1.5, borderColor: T.border,
    alignItems: 'center', justifyContent: 'center',
  },
  hvlRadioActive: { borderColor: T.primary },
  hvlRadioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.primary },
  hvlTierTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  hvlTierTitleActive: { color: T.primary },
  hvlTierDetail: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },
  hvlFinePrint: { color: T.textMuted, fontSize: T.tiny, lineHeight: 15, marginTop: T.xs },

  ctaHint: {
    color: T.textMuted, fontSize: T.tiny, fontWeight: '600',
    textAlign: 'center', marginTop: T.sm + 2,
  },

  // CTA
  ctaBtn: {
    backgroundColor: T.primary, borderRadius: T.radius,
    padding: 18, alignItems: 'center', marginTop: T.xl,
  },
  ctaBtnDisabled: { opacity: 0.45 },
  ctaBtnText: { color: T.bg, fontSize: T.body + 1, fontWeight: '800' },

  error: { color: T.danger, fontSize: T.small, textAlign: 'center', marginTop: T.md },

  // STEP 5 — transition
  transitionWrap: { alignItems: 'center', paddingVertical: T.xl * 3 },
  transitionTitle: { color: T.text, fontSize: T.h2, fontWeight: '800', marginTop: T.lg },
  transitionSub: { color: T.textMuted, fontSize: T.small, marginTop: T.sm, textAlign: 'center' },
  transitionStages: { marginTop: T.xl + T.md, gap: T.md, alignSelf: 'stretch', paddingHorizontal: T.xl },
  transRow: { flexDirection: 'row', alignItems: 'center', gap: T.md },
  transCheck: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 1.5, borderColor: T.border,
    alignItems: 'center', justifyContent: 'center',
  },
  transCheckDone: { backgroundColor: T.primary, borderColor: T.primary },
  transLabel: { color: T.textMuted, fontSize: T.body, fontWeight: '600' },
});
