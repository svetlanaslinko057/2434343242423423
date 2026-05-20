import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import api from '../src/api';
import { useMe } from '../src/use-me';
import { useAuth } from '../src/auth';
import { StatusDot, ProgressBar, PressScale, FadeSlideIn, SystemStateCard } from '../src/ui';
import { motion } from '../src/motion';
import T from '../src/theme';
import { useAppStatePolling } from '../src/hooks/useAppStatePolling';

/**
 * L0 Smart Hub — the single entry point for every user, regardless of states.
 *
 * NO routing away from here based on role. This screen MERGES:
 *   • Client section     — shown if states.includes('client')
 *   • Developer section  — shown if states.includes('developer')
 *   • Admin section      — shown if states.includes('admin')
 *   • Create section     — always shown (so existing clients can order more)
 *
 * Sections are merged, not switched. A user who is both client + developer sees
 * both sections on one screen. Role-specific stacks (/client/*, /developer/*,
 * /admin/*) live ABOVE this — the hub opens them on demand, it doesn't replace them.
 */

type Mode = 'ai' | 'hybrid' | 'dev';

type Pricing = {
  mode: Mode;
  base_estimate: number;
  price_multiplier: number;
  final_price: number;
  speed_multiplier: number;
  quality_band: string;
};

type ClientProject = {
  project_id: string;
  name: string;
  current_stage?: string;
  progress?: number;
  status?: string;
};

type DevModule = {
  module_id: string;
  module_title: string;
  project_title?: string;
  status: string;
  paused_by_system?: boolean;
  progress_pct?: number;
  budget?: number;
};

type DevWork = {
  summary: {
    paid: number;
    earned: number;
    pending: number;
    active_count: number;
    qa_count: number;
    blocked_count: number;
    available_count?: number;
  };
  headline?: string;
  active: DevModule[];
  qa: DevModule[];
  blocked: DevModule[];
};

const MODES: { id: Mode; label: string; sub: string; icon: any; accent: string }[] = [
  { id: 'ai',     label: 'Fast build',     sub: 'Fastest, lowest cost',          icon: 'flash',       accent: T.info },
  { id: 'hybrid', label: 'Balanced build', sub: 'Balanced speed & quality',      icon: 'git-network', accent: T.primaryAccent },
  { id: 'dev',    label: 'Full build',     sub: 'Maximum quality — human team',  icon: 'ribbon',      accent: T.warning },
];

export default function Home() {
  const router = useRouter();
  const { me, refresh } = useMe();
  const { logout } = useAuth();

  const states: string[] = me?.states || [];
  const isClient = states.includes('client');
  const isDeveloper = states.includes('developer');
  const isAdmin = states.includes('admin');
  const isVisitor = states.length === 0;

  const [clientProjects, setClientProjects] = useState<ClientProject[] | null>(null);
  const [devWork, setDevWork] = useState<DevWork | null>(null);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<Mode>('hybrid');
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load section data based on who the user already is. Sections load in parallel.
  const loadSections = useCallback(async () => {
    if (!me) return;
    setSectionsLoading(true);
    const tasks: Promise<any>[] = [];
    if (isClient) {
      tasks.push(
        api.get('/projects/mine')
          .then((r) => setClientProjects(r.data || []))
          .catch(() => setClientProjects([])),
      );
    }
    if (isDeveloper) {
      tasks.push(
        api.get('/dev/work')
          .then((r) => setDevWork(r.data))
          .catch(() => setDevWork(null)),
      );
    }
    await Promise.all(tasks);
    setSectionsLoading(false);
  }, [me, isClient, isDeveloper]);

  useEffect(() => {
    loadSections();
  }, [loadSections]);

  // Live pricing preview for the Create section.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        setPricingLoading(true);
        const r = await api.post('/pricing/preview', { goal, mode });
        setPricing(r.data);
      } catch {
        setPricing(null);
      } finally {
        setPricingLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [goal, mode]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refresh(), loadSections()]);
    setRefreshing(false);
  };

  const fasterPct = useMemo(() => {
    if (!pricing) return null;
    const pct = Math.round((1 - pricing.speed_multiplier) * 100);
    return pct > 0 ? `${pct}% faster` : 'baseline speed';
  }, [pricing]);

  const createProject = async () => {
    try {
      setBusy('create');
      const title = goal.trim() ? goal.trim().slice(0, 80) : 'New project';
      const r = await api.post('/projects', { title, goal: goal.trim() || null, mode });
      await refresh();
      router.replace(`/project-booting?id=${r.data.project_id}` as any);
    } catch (e: any) {
      Alert.alert('Could not start project', e?.response?.data?.detail || String(e));
    } finally {
      setBusy(null);
    }
  };

  /**
   * New flow: "we already calculated your product" pre-commit experience.
   * Instead of creating a project immediately, we hit POST /api/estimate
   * (pure, no DB writes) and jump to /estimate-result where the user sees
   * price + timeline + module list. Only after they confirm we create.
   *
   * If goal is too thin (< 20 chars) backend returns clarity='low' and we
   * stop the flow with an inline hint — no bogus estimate shown.
   */
  const estimateProduct = async () => {
    try {
      setBusy('create');
      const g = goal.trim();
      if (g.length < 10) {
        Alert.alert(
          'Tell us more',
          'Describe what you want to build in a sentence or two so we can give you a real estimate.',
        );
        return;
      }
      const r = await api.post('/estimate', { goal: g, mode });
      if (r.data?.clarity === 'low') {
        // Redirect to improve flow instead of surfacing an error-style Alert —
        // a thin brief isn't an error, it's a conversation starter.
        router.push({
          pathname: '/estimate-improve',
          params: {
            goal: g,
            mode,
            message: r.data.message || '',
            suggestions: JSON.stringify(r.data.suggestions || []),
          },
        } as any);
        return;
      }
      router.push({
        pathname: '/estimate-result',
        params: { data: JSON.stringify(r.data), goal: g, mode },
      } as any);
    } catch (e: any) {
      Alert.alert('Could not calculate', e?.response?.data?.detail || String(e));
    } finally {
      setBusy(null);
    }
  };

  const applyDev = async () => {
    try {
      setBusy('dev');
      await api.post('/developer/apply');
      await refresh();
      await loadSections();
    } catch (e: any) {
      Alert.alert('Could not apply', e?.response?.data?.detail || String(e));
    } finally {
      setBusy(null);
    }
  };

  const contextBadge = useMemo(() => {
    if (isAdmin) return 'ADMIN';
    if (isClient && isDeveloper) return 'CLIENT · DEVELOPER';
    if (isClient) return 'CLIENT';
    if (isDeveloper) return 'DEVELOPER';
    return 'VISITOR';
  }, [isClient, isDeveloper, isAdmin]);

  // Primary CTA — one decision per visit. Priority:
  //   1. client has a last project → "Continue <project>"
  //   2. developer has active work → "Open active work"
  //   3. visitor → "Start building your product" (scrolls to create)
  //   4. fallback → null (hero + create already on screen)
  type Cta = { label: string; sub?: string; onPress: () => void } | null;
  const primaryCta: Cta = useMemo(() => {
    const activeWork = (devWork?.summary.active_count || 0) + (devWork?.summary.qa_count || 0);
    if (isClient && me?.last_project_id) {
      return {
        label: `Continue ${me.last_project_title || 'project'}`,
        sub: 'Open active workspace',
        onPress: () => router.push(`/workspace/${me.last_project_id}` as any),
      };
    }
    if (isDeveloper && activeWork > 0) {
      return {
        label: 'Open active work',
        sub: `${devWork?.summary.active_count || 0} active · ${devWork?.summary.qa_count || 0} QA`,
        onPress: () => router.push('/developer/work' as any),
      };
    }
    if (isVisitor) {
      return {
        label: 'Start building your product',
        sub: 'Describe it below · we produce',
        onPress: () => scrollRef.current?.scrollTo({ y: 260, animated: true }),
      };
    }
    return null;
  }, [isClient, isDeveloper, isVisitor, me?.last_project_id, me?.last_project_title, devWork, router]);

  const scrollRef = useRef<ScrollView>(null);

  /** Light haptic tap before any project/work navigation. Ignored on web. */
  const tap = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  };

  // System State — live snapshot of the user's most recent project. Polled
  // every 12s while screen is focused & app foregrounded (paused otherwise).
  type SysState = { active: number; qa: number; done: number; total: number; progress: number };
  const [sysState, setSysState] = useState<SysState | null>(null);
  const lastPid = me?.last_project_id;
  const fetchSysState = useCallback(async () => {
    if (!lastPid) return;
    try {
      const r = await api.get(`/client/project/${lastPid}/workspace`);
      const mods = Array.isArray(r.data?.modules) ? r.data.modules : [];
      const total = mods.length;
      const active = mods.filter((m: any) => m.status === 'in_progress').length;
      const qa = mods.filter((m: any) => m.status === 'review').length;
      const done = mods.filter((m: any) => m.status === 'done').length;
      const progress = total > 0 ? Math.round((done / total) * 100) : 0;
      setSysState({ active, qa, done, total, progress });
    } catch {
      /* silent — not critical enough to nag the user */
    }
  }, [lastPid]);
  useEffect(() => {
    if (!lastPid) { setSysState(null); return; }
    fetchSysState();
  }, [lastPid, fetchSysState]);
  useAppStatePolling(fetchSysState, 12_000, { enabled: !!lastPid });

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        ref={scrollRef}
        style={s.container}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} />}
        testID="home-screen"
      >
        {/* ============ SYSTEM STATE — hero (centre of gravity) ============ */}
        {sysState && sysState.total > 0 && (
          <FadeSlideIn style={{ marginBottom: T.lg }}>
            <SystemStateCard
              active={sysState.active}
              done={sysState.done}
              progress={sysState.progress / 100}
              testID="home-system-state"
            />
          </FadeSlideIn>
        )}

        {/* ============ PRIMARY CTA (single decision per visit) ============ */}
        {primaryCta && (
          <FadeSlideIn delay={motion.staggerStep}>
            <PressScale
              testID="home-primary-cta"
              style={s.primaryCta2}
              onPress={() => { tap(); primaryCta.onPress(); }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.primaryCta2Label}>{primaryCta.label}</Text>
                  {primaryCta.sub && <Text style={s.primaryCta2Sub}>{primaryCta.sub}</Text>}
                </View>
                <Ionicons name="arrow-forward" size={20} color={T.bg} />
              </View>
            </PressScale>
          </FadeSlideIn>
        )}

        {/* ============ VISITOR HERO (only if truly new) ============ */}
        {isVisitor && (
          <View style={s.hero} testID="home-visitor-hero">
            <Text style={s.heroTitle}>Build products.{'\n'}Not tickets.</Text>
            <Text style={s.heroSub}>
              Describe what you want. Pick how fast. We produce.
            </Text>
          </View>
        )}

        {/* ============ CLIENT SECTION ============ */}
        {isClient && (
          <View testID="home-client-section">
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Your projects</Text>
              {clientProjects && clientProjects.length > 3 && (
                <TouchableOpacity onPress={() => router.push('/client/projects')}>
                  <Text style={s.sectionLink}>All →</Text>
                </TouchableOpacity>
              )}
            </View>
            {sectionsLoading && !clientProjects ? (
              <ActivityIndicator color={T.primary} />
            ) : clientProjects && clientProjects.length > 0 ? (
              <View style={{ gap: T.sm }}>
                {clientProjects.slice(0, 3).map((p, i) => (
                  <FadeSlideIn key={p.project_id} delay={i * motion.staggerStep}>
                    <PressScale
                      testID={`home-client-project-${p.project_id}`}
                      style={s.projectCard}
                      onPress={() => {
                        tap();
                        router.push(`/workspace/${p.project_id}` as any);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.projectTitle} numberOfLines={1}>
                          {p.name || 'Untitled'}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.xs, marginTop: 4 }}>
                          <StatusDot status="active" pulse size={6} />
                          <Text style={s.projectMeta}>
                            {(p.current_stage || 'active').toString()}
                            {typeof p.progress === 'number' ? ` · ${p.progress}%` : ''}
                          </Text>
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
                    </PressScale>
                  </FadeSlideIn>
                ))}
              </View>
            ) : (
              <View style={s.emptyCard}>
                <Text style={s.emptyText}>You don't have projects yet</Text>
                <Text style={[s.emptyText, { marginTop: 4, color: T.textMuted }]}>
                  Start by describing what you want below.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ============ DEVELOPER SECTION ============ */}
        {isDeveloper && (
          <View style={{ marginTop: T.xl }} testID="home-developer-section">
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Your work</Text>
              <TouchableOpacity onPress={() => router.push('/developer/work')}>
                <Text style={s.sectionLink}>Queue →</Text>
              </TouchableOpacity>
            </View>
            {sectionsLoading && !devWork ? (
              <ActivityIndicator color={T.primary} />
            ) : devWork ? (
              <>
                <View style={s.devStatsRow}>
                  <View style={s.statChip}>
                    <Text style={s.statNum}>{devWork.summary.active_count}</Text>
                    <Text style={s.statLabel}>Active</Text>
                  </View>
                  <View style={s.statChip}>
                    <Text style={s.statNum}>{devWork.summary.qa_count}</Text>
                    <Text style={s.statLabel}>QA</Text>
                  </View>
                  <View style={s.statChip}>
                    <Text style={[s.statNum, devWork.summary.blocked_count ? { color: T.danger } : null]}>
                      {devWork.summary.blocked_count}
                    </Text>
                    <Text style={s.statLabel}>Blocked</Text>
                  </View>
                  <View style={s.statChip}>
                    <Text style={[s.statNum, { color: T.success }]}>
                      ${Math.round(devWork.summary.earned).toLocaleString()}
                    </Text>
                    <Text style={s.statLabel}>Earned</Text>
                  </View>
                </View>
                {[...devWork.active, ...devWork.qa].slice(0, 2).map((m) => (
                  <TouchableOpacity
                    key={m.module_id}
                    testID={`home-dev-module-${m.module_id}`}
                    style={s.moduleRow}
                    onPress={() => router.push('/developer/work')}
                    activeOpacity={0.85}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.moduleTitle} numberOfLines={1}>{m.module_title}</Text>
                      <Text style={s.moduleMeta} numberOfLines={1}>
                        {m.project_title || ''} · {m.status}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={T.textMuted} />
                  </TouchableOpacity>
                ))}
                {devWork.active.length === 0 && devWork.qa.length === 0 && (
                  <View style={s.emptyCard}>
                    <Text style={s.emptyText}>
                      {devWork.summary.blocked_count > 0
                        ? `${devWork.summary.blocked_count} module(s) paused — open queue`
                        : 'No active work — browse marketplace'}
                    </Text>
                    <TouchableOpacity
                      style={s.emptyBtn}
                      onPress={() => router.push(devWork.summary.blocked_count > 0 ? '/developer/work' : '/developer/market')}
                    >
                      <Text style={s.emptyBtnText}>
                        {devWork.summary.blocked_count > 0 ? 'Open queue' : 'Open marketplace'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            ) : null}
          </View>
        )}

        {/* ============ ADMIN SECTION (shortcut only — admin has its own cockpit) ============ */}
        {isAdmin && (
          <View style={{ marginTop: T.xl }} testID="home-admin-section">
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Admin cockpit</Text>
            </View>
            <TouchableOpacity
              testID="home-admin-enter-btn"
              style={s.adminCard}
              onPress={() => router.push('/admin/home')}
              activeOpacity={0.85}
            >
              <Ionicons name="shield-checkmark" size={20} color={T.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.adminTitle}>Open Control Center</Text>
                <Text style={s.adminSub}>Platform · Finance · Teams · Autonomy</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* ============ CREATE SECTION (always visible) ============ */}
        <View style={{ marginTop: T.xl }} testID="home-create-section">
          <Text style={s.sectionTitle}>
            {isClient ? 'Start a new project' : 'What do you want to build?'}
          </Text>
          <TextInput
            testID="home-goal-input"
            value={goal}
            onChangeText={setGoal}
            placeholder="e.g. Dashboard for SaaS metrics with auth"
            placeholderTextColor={T.textMuted}
            multiline
            style={s.goalInput}
          />
          <View style={{ gap: T.sm }}>
            {MODES.map((m) => {
              const selected = mode === m.id;
              return (
                <TouchableOpacity
                  key={m.id}
                  testID={`home-mode-${m.id}`}
                  activeOpacity={0.85}
                  style={[
                    s.modeCard,
                    { borderLeftColor: m.accent },
                    selected && { borderColor: m.accent, backgroundColor: m.accent + '12' },
                  ]}
                  onPress={() => setMode(m.id)}
                >
                  <View style={[s.modeIconBox, { backgroundColor: m.accent + '22' }]}>
                    <Ionicons name={m.icon} size={20} color={m.accent} />
                  </View>
                  <View style={s.modeInfo}>
                    <Text style={s.modeLabel}>{m.label}</Text>
                    <Text style={s.modeSub}>{m.sub}</Text>
                  </View>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={22} color={m.accent} />
                  ) : (
                    <Ionicons name="ellipse-outline" size={22} color={T.textMuted} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={s.pricingCard} testID="home-pricing-card">
            {pricingLoading && !pricing ? (
              <ActivityIndicator color={T.primary} />
            ) : pricing ? (
              <>
                <View style={s.pricingRow}>
                  <View>
                    <Text style={s.pricingLabel}>Estimated price</Text>
                    <Text style={s.pricingValue} testID="home-pricing-value">
                      ${pricing.final_price.toLocaleString()}
                    </Text>
                  </View>
                  <View style={s.pricingBadge}>
                    <Text style={s.pricingBadgeText}>{pricing.quality_band}</Text>
                  </View>
                </View>
                <View style={s.pricingMetaRow}>
                  <Text style={s.pricingMeta}>base ${pricing.base_estimate.toLocaleString()}</Text>
                  <Text style={s.pricingMetaDot}>·</Text>
                  <Text style={s.pricingMeta}>×{pricing.price_multiplier}</Text>
                  {fasterPct && (
                    <>
                      <Text style={s.pricingMetaDot}>·</Text>
                      <Text style={s.pricingMeta}>{fasterPct}</Text>
                    </>
                  )}
                </View>
              </>
            ) : (
              <Text style={s.pricingMeta}>Pricing unavailable</Text>
            )}
          </View>

          <PressScale
            testID="home-create-project-btn"
            style={[s.primaryCta, busy ? s.disabled : null]}
            onPress={estimateProduct}
            disabled={!!busy}
          >
            {busy === 'create' ? (
              <ActivityIndicator color={T.bg} />
            ) : (
              <Text style={s.primaryCtaText}>Estimate my product</Text>
            )}
          </PressScale>
        </View>

        {/* ============ DEVELOPER APPLY (only if not yet dev) ============ */}
        {!isDeveloper && (
          <PressScale
            testID="home-apply-developer-btn"
            style={s.devApplyCta}
            onPress={applyDev}
            disabled={!!busy}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.md }}>
              <Ionicons name="code-slash" size={20} color={T.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.devApplyTitle}>Join as developer</Text>
                <Text style={s.devApplySub}>Pick modules · get paid for results</Text>
              </View>
              {busy === 'dev' ? (
                <ActivityIndicator color={T.primary} />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
              )}
            </View>
          </PressScale>
        )}

        <TouchableOpacity
          testID="home-logout-btn"
          style={s.logoutRow}
          onPress={async () => {
            await logout();
            router.replace('/auth');
          }}
        >
          <Text style={s.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.lg, paddingTop: T.xl, paddingBottom: T.xl * 3 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: T.lg,
  },
  brand: {
    color: T.primary,
    fontSize: T.h1,
    fontWeight: '800',
    letterSpacing: 1,
  },
  brandSub: {
    color: T.textMuted,
    fontSize: T.tiny,
    letterSpacing: 3,
    fontWeight: '700',
    marginTop: 2,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: T.surface1,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: T.text, fontWeight: '800', fontSize: T.body },

  // Hero (visitor-only)
  hero: { marginBottom: T.xl },
  heroTitle: { color: T.text, fontSize: 28, fontWeight: '800', lineHeight: 34 },
  heroSub: { color: T.textMuted, fontSize: T.body, marginTop: T.sm, lineHeight: 22 },

  // Section chrome
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: T.sm,
  },
  sectionTitle: {
    color: T.textMuted,
    fontSize: T.tiny,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: T.sm,
  },
  sectionLink: { color: T.primary, fontSize: T.small, fontWeight: '700' },

  // Client
  projectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.surface1,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: T.radius,
    padding: T.md,
    gap: T.sm,
  },
  projectTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  projectMeta: { color: T.textMuted, fontSize: T.small, marginTop: 2, textTransform: 'capitalize' },

  emptyCard: {
    backgroundColor: T.surface1,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: T.radius,
    padding: T.md,
    alignItems: 'flex-start',
  },
  emptyText: { color: T.textMuted, fontSize: T.small },
  emptyBtn: {
    marginTop: T.sm,
    borderWidth: 1,
    borderColor: T.primary,
    borderRadius: T.radiusSm,
    paddingHorizontal: T.md,
    paddingVertical: 8,
  },
  emptyBtnText: { color: T.primary, fontWeight: '700', fontSize: T.small },

  // Developer
  devStatsRow: {
    flexDirection: 'row',
    gap: T.sm,
    marginBottom: T.sm,
  },
  statChip: {
    flex: 1,
    backgroundColor: T.surface1,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: T.radius,
    padding: T.sm,
    alignItems: 'center',
  },
  statNum: { color: T.text, fontSize: T.h3, fontWeight: '800' },
  statLabel: { color: T.textMuted, fontSize: T.tiny, textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 },

  moduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.surface1,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: T.radius,
    padding: T.md,
    marginTop: T.xs,
    gap: T.sm,
  },
  moduleTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  moduleMeta: { color: T.textMuted, fontSize: T.small, marginTop: 2 },

  // Admin
  adminCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.surface1,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: T.radius,
    padding: T.md,
    gap: T.sm,
  },
  adminTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  adminSub: { color: T.textMuted, fontSize: T.small, marginTop: 2 },

  // Create
  goalInput: {
    minHeight: 64,
    color: T.text,
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor: T.surface1,
    borderRadius: T.radius,
    padding: T.md,
    fontSize: T.body,
    textAlignVertical: 'top',
    marginBottom: T.md,
  },

  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.md,
    backgroundColor: T.surface1,
    borderRadius: T.radius,
    padding: T.md,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: T.border,
  },
  modeIconBox: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  modeInfo: { flex: 1 },
  modeLabel: { color: T.text, fontSize: T.body, fontWeight: '700' },
  modeSub: { color: T.textMuted, fontSize: T.small, marginTop: 2 },

  pricingCard: {
    marginTop: T.md,
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor: T.surface2,
    borderRadius: T.radius,
    padding: T.md,
    minHeight: 64,
    justifyContent: 'center',
  },
  pricingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pricingLabel: {
    color: T.textMuted,
    fontSize: T.tiny,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  pricingValue: { color: T.text, fontSize: 26, fontWeight: '800', marginTop: 4 },
  pricingBadge: {
    borderWidth: 1,
    borderColor: T.primary,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pricingBadgeText: {
    color: T.primary,
    fontSize: T.tiny,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  pricingMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: T.sm, flexWrap: 'wrap' },
  pricingMeta: { color: T.textMuted, fontSize: T.small },
  pricingMetaDot: { color: T.textMuted, fontSize: T.small, marginHorizontal: T.xs },

  primaryCta: {
    marginTop: T.md,
    backgroundColor: T.primary,
    borderRadius: T.radius,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryCta2: {
    marginBottom: T.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.md,
    backgroundColor: T.primary,
    borderRadius: T.radius,
    paddingVertical: 16,
    paddingHorizontal: T.md,
  },
  primaryCta2Label: { color: T.bg, fontSize: T.h3, fontWeight: '800' },
  primaryCta2Sub: { color: T.bg, opacity: 0.75, fontSize: T.small, marginTop: 2 },
  sysCard: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.lg, marginBottom: T.xl,
  },
  sysRow: { flexDirection: 'row', alignItems: 'center', gap: T.sm },
  sysTitle: { color: T.text, fontSize: T.body, fontWeight: '600' },
  sysSub: { color: T.textSecondary, fontSize: 13, marginTop: T.sm },
  sysBarWrap: { marginTop: T.md },
  primaryCtaText: { color: T.bg, fontSize: T.body, fontWeight: '800', letterSpacing: 0.5 },
  disabled: { opacity: 0.6 },

  devApplyCta: {
    marginTop: T.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.md,
    backgroundColor: T.surface1,
    borderRadius: T.radius,
    padding: T.md,
    borderWidth: 1,
    borderColor: T.border,
  },
  devApplyTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  devApplySub: { color: T.textMuted, fontSize: T.small, marginTop: 2 },

  logoutRow: { marginTop: T.xl, alignItems: 'center' },
  logoutText: { color: T.textMuted, fontSize: T.small },
});
