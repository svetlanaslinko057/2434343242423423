// Client → Project Screen (single shell, no double nav)
//
// Lives inside the client tab bar — when the user opens a project from any
// client surface, they stay in the client shell. The page is just one screen
// with five vertical blocks:
//
//   1. Hero          — live status, money delivered/remaining, modules counter
//   2. Progress      — building / review / done counters, micro-rhythm
//   3. Decisions     — deliverables in `pending_approval` (Approve / Reject)
//   4. Modules       — operational cards (status + price + actions)
//   5. Activity      — inline live feed, scoped to this project
//
// Slice #3 (ClientCabinet) governance notes:
//   - Module status counters: now read from `ws.status_counts` (BD-15
//     promoted in slice #3 — backend additive on /client/project/{id}/workspace
//     per I-06 evidence threshold met across mobile detail + mobile list).
//   - Pending deliverables: rendered inline by status, no useMemo filter
//     (BD-04 closed via D-2 — backend already owns the status field;
//     frontend renders structurally, no synthesis).
//   - Invoice chronology: sorted by `created_at` desc (slice #3 D-3 hybrid E+).
//     Previously sorted by `invoice_id` lexicographic — fake authority proxy
//     for chronology, removed.
//   - BD-14 bounded debt: "one open invoice per module" aggregation remains
//     synthesized client-side. Tolerated because:
//       single-surface consumer,
//       presentation grouping decision,
//       not a true I-06 promotion candidate.
//     Re-evaluate if a second consumer needs invoice-by-module indexing or
//     if business rule "one open invoice per module" becomes contested.
//   - Upsell logic (lines below): NOT slice-#3 owned. Recommendation
//     authority, single surface, fails I-06. Deferred per D-4.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl,
  TouchableOpacity, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
// ─── Runtime-client migration (Batch 2 — Expo Client Cabinet) ───────────
// Transport-swap only. Polling interval (POLL_MS), BD-04/BD-15/D-5 invariants
// and `payInvoiceWithGate` (already pilot-migrated) are NOT touched. Each
// loader GET keeps its inner `.catch(() => fallback)` so the dashboard
// degrades gracefully when a single sub-resource 404s — verbatim semantic.
// Per-action POSTs get idempotency keys so taps during slow networks
// (the 4s polling tick may overlap with manual interactions) don't
// produce double-effects.
import { runtime } from '../../../src/runtime';
import { ApiError } from '../../../src/runtime-client';
import T from '../../../src/theme';
import { payInvoiceWithGate } from '../../../src/pay-with-gate';
import { useAppStatePolling } from '../../../src/hooks/useAppStatePolling';

type Module = {
  module_id: string;
  module_title: string;
  status: string;
  paused_by_system?: boolean;
  progress_pct: number;
  price: number;
  cost: number;
  earned: number;
  paid: number;
  cost_status: string;
  developer_name?: string;
};

type CatalogItem = {
  slug: string;
  title: string;
  description: string;
  price: number;
};

type Deposit = {
  required: boolean;
  paid: boolean;
  amount: number;
  final_price: number;
  project_status: string | null;
};

type Workspace = {
  project: { project_id: string; project_title: string };
  deposit?: Deposit;
  summary: {
    revenue: number; cost: number; earned: number; paid: number; profit: number;
    active_modules: number; total_modules: number;
  };
  // BD-15 (slice #3): backend-owned module status counts.
  status_counts?: {
    in_progress: number; review: number; done: number;
    paused: number; total: number;
  };
  status: 'healthy' | 'watch' | 'at_risk' | 'blocked';
  status_label: string;
  explanation: string;
  system_action?: { label: string; type: string; at: string } | null;
  modules: Module[];
};

type ActivityEvent = {
  at: string;
  module_title: string;
  project_title: string;
  project_id: string;
  verb: string;
  dot: 'green' | 'yellow' | 'blue' | 'purple';
  kind?: 'system';
};

type Deliverable = {
  deliverable_id: string;
  project_id: string;
  title: string;
  summary: string;
  status: string;
  price?: number;
  blocks?: any[];
  resources?: { type: string; label: string; url?: string }[];
  version?: string;
};

type Invoice = {
  invoice_id: string;
  module_id?: string;
  amount: number;
  status: string; // paid | pending_payment | draft
  title?: string;
  paid_at?: string;
  created_at?: string;
};

const POLL_MS = 8000;

const STATUS_HERO: Record<Workspace['status'], { label: string; tone: string }> = {
  healthy: { label: 'BUILDING',     tone: T.success },
  watch:   { label: 'MONITORING',   tone: T.info },
  at_risk: { label: 'AT RISK',      tone: T.warning },
  blocked: { label: 'BLOCKED',      tone: T.danger },
};

const MODULE_TONE: Record<string, string> = {
  pending:     T.textMuted,
  in_progress: T.info,
  review:      T.warning,
  done:        T.success,
  completed:   T.success,
  paused:      T.danger,
};

function fmt(n: number | undefined): string {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function relTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const DOT_COLOR: Record<ActivityEvent['dot'], string> = {
  green:  T.success,
  yellow: T.warning,
  blue:   T.info,
  purple: T.info,
};

export default function ClientProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [ws, setWs] = useState<Workspace | null>(null);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [payingDeposit, setPayingDeposit] = useState(false);
  const [addingSlug, setAddingSlug] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [w, d, a, inv, cat] = await Promise.all([
        runtime.get(`/api/client/project/${id}/workspace`),
        runtime.get(`/api/client/projects/${id}/deliverables`).catch(() => ({ data: [] as Deliverable[] })),
        // Block 9.5: project screen now consumes the same operator aggregator
        // as the Activity tab. One source of truth → events here, on tab,
        // and on home all match. Filter is server-side, no need to re-filter.
        runtime.get(`/api/client/activity/full?project_id=${encodeURIComponent(id)}`)
          .catch(() => ({ data: { events: [] } })),
        runtime.get('/api/client/invoices').catch(() => ({ data: [] as Invoice[] })),
        runtime.get('/api/client/modules/catalog').catch(() => ({ data: { items: [] as CatalogItem[] } })),
      ]);
      setWs(w.data);
      const dList: Deliverable[] = Array.isArray(d.data) ? d.data : (d.data?.deliverables || []);
      setDeliverables(dList);
      const projEvents: ActivityEvent[] = (a.data?.events || []).slice(0, 8);
      setEvents(projEvents);
      const invList: Invoice[] = Array.isArray(inv.data) ? inv.data : [];
      setInvoices(invList.filter(i => i.module_id));
      setCatalog(cat.data?.items || []);
    } catch (e: any) {
      // Slice #3 D-5: explicit error state, no silent collapse. Source of
      // message changed only.
      const msg = e instanceof ApiError
        ? (e.message || (e as any).hint || 'Could not load project workspace.')
        : (e?.response?.data?.message || e?.response?.data?.detail || 'Could not load project workspace.');
      setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useAppStatePolling(load, POLL_MS);

  // BD-04 (slice #3, D-2) — pending deliverables list:
  // No client-side filter synthesis. We render structurally below: a card
  // shows action buttons only when `d.status === 'pending_approval'`.
  // Backend owns the status field; frontend renders structurally.

  // BD-15 (slice #3, D-1) — module status counters are backend-owned.
  // `ws.status_counts` is populated by /client/project/{id}/workspace.
  const counters = ws?.status_counts ?? { in_progress: 0, review: 0, done: 0, paused: 0, total: 0 };

  const decide = async (d: Deliverable, action: 'approve' | 'reject') => {
    setActing(d.deliverable_id);
    try {
      await runtime.post(
        `/api/client/deliverables/${d.deliverable_id}/${action}`,
        action === 'reject' ? { reason: 'requesting changes' } : {},
        // Idempotency: client may double-tap the approve button while the
        // background poller is mid-flight refreshing the workspace.
        { idempotencyKey: `deliverable:${d.deliverable_id}:${action}` },
      );
      await load();
    } catch (e: any) {
      const msg = e instanceof ApiError ? (e.message || e.code) : (e.response?.data?.detail || 'Action failed');
      Alert.alert('Error', msg);
    } finally {
      setActing(null);
    }
  };

  const payInvoice = async (inv: Invoice) => {
    setPaying(inv.invoice_id);
    try {
      const r = await payInvoiceWithGate(inv.invoice_id, {
        projectId: id ? String(id) : null,
        router,
      });
      if (r.ok === true) {
        await load();
      } else if (r.ok === false && !r.redirected) {
        const err: any = (r as any).error;
        Alert.alert('Error', err?.response?.data?.detail || (err instanceof ApiError ? err.message : null) || 'Payment failed');
      }
      // If redirected — flow handed off to /contract/:id/sign
    } finally {
      setPaying(null);
    }
  };

  // Pay deposit — visitor→register→claim conversion flow.
  // Server creates a one-off invoice + checkout URL via the boundary layer.
  // In mock-payment mode, the URL is a stub success page. In LIVE mode
  // (admin/integrations → Stripe key set), this opens hosted Stripe checkout.
  const payDeposit = async () => {
    if (!id || !ws?.deposit?.required) return;
    setPayingDeposit(true);
    try {
      const r = await runtime.post(
        `/api/client/projects/${id}/deposit/checkout`,
        {},
        { idempotencyKey: `deposit:${id}` },
      );
      const url = r.data?.payment_url;
      if (!url) {
        Alert.alert('Could not start checkout', 'No payment URL returned. Please try again or contact support.');
        return;
      }
      const can = await Linking.canOpenURL(url);
      if (can) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Cannot open checkout', url);
      }
    } catch (e: any) {
      const msg = e instanceof ApiError
        ? (e.message || e.code)
        : (e?.response?.data?.detail || 'Could not start deposit checkout');
      Alert.alert('Error', String(msg));
    } finally {
      setPayingDeposit(false);
    }
  };

  // Expansion Engine — quick add from inline upsells (catalog screen does the same).
  const addModule = async (slug: string) => {
    if (!id) return;
    setAddingSlug(slug);
    try {
      await runtime.post(
        `/api/client/projects/${id}/modules/add`,
        { slug },
        // Idempotency: rapid taps on an upsell while poll-tick is in-flight.
        { idempotencyKey: `addmod:${id}:${slug}` },
      );
      await load();
    } catch (e: any) {
      const msg = e instanceof ApiError ? (e.message || e.code) : (e.response?.data?.detail || 'Could not add module');
      Alert.alert('Error', msg);
    } finally {
      setAddingSlug(null);
    }
  };

  // Pick the single most relevant upsell for this project, or null.
  // Hidden when the recommended module is already in the project (any status).
  const upsell = useMemo<CatalogItem | null>(() => {
    if (!ws || catalog.length === 0) return null;
    const titles = (ws.modules || []).map(m => (m.module_title || '').toLowerCase());
    const has = (q: string) => titles.some(t => t.includes(q));
    const hasAuth     = has('auth');
    const hasTwoFa    = has('two-factor') || has('2fa');
    const hasPay      = has('payment');
    const hasAnalytic = has('analytic');
    const bySlug = (s: string) => catalog.find(c => c.slug === s) || null;
    if (hasAuth && !hasTwoFa) return bySlug('2fa');
    if (!hasPay)              return bySlug('payments');
    if (!hasAnalytic)         return bySlug('analytics');
    return null;
  }, [ws, catalog]);

  // Slice #3 (D-3 hybrid E+) — invoice chronology fix.
  // Previously: sort by invoice_id lexicographic (fake authority proxy for time).
  // Now: sort by created_at desc (true chronology, backend-supplied field).
  //
  // BD-14 bounded debt (slice #3) — "one open invoice per module" aggregation
  // remains client-synthesized. Tolerated because:
  //   single-surface consumer (this screen only),
  //   presentation grouping decision,
  //   not a true I-06 promotion candidate.
  // Promote when a second consumer appears or business rule becomes contested.
  const invoiceByModule: Record<string, Invoice> = {};
  for (const inv of [...invoices].sort(
    (a, b) => (b.created_at || '').localeCompare(a.created_at || '')
  )) {
    if (inv.module_id && !invoiceByModule[inv.module_id]) invoiceByModule[inv.module_id] = inv;
  }

  if (loading) {
    return (
      <SafeAreaView style={[s.flex, s.center]} edges={['top']}>
        <ActivityIndicator color={T.primary} />
      </SafeAreaView>
    );
  }
  if (error) {
    return (
      <SafeAreaView style={[s.flex, s.center]} edges={['top']} testID="project-error">
        <Ionicons name="alert-circle" size={40} color={T.danger} />
        <Text style={[s.empty, { marginTop: 8 }]}>{error}</Text>
        <TouchableOpacity
          style={s.backBtn}
          onPress={() => { setLoading(true); load(); }}
          testID="project-retry"
        >
          <Text style={s.backBtnText}>Try again</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }
  if (!ws) {
    return (
      <SafeAreaView style={[s.flex, s.center]} edges={['top']}>
        <Text style={s.empty}>Project not found</Text>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backBtnText}>Back to Projects</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const hero = STATUS_HERO[ws.status];
  const delivered = ws.summary.paid;
  const remaining = Math.max(0, ws.summary.revenue - ws.summary.paid);

  return (
    <SafeAreaView style={s.flex} edges={['top']}>
      {/* ─── Inline header (← Back · Title · spacer) ─── */}
      <View style={s.topBar}>
        <TouchableOpacity
          testID="project-back"
          onPress={() => router.back()}
          style={s.backIcon}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color={T.text} />
          <Text style={s.backLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={s.topTitle} numberOfLines={1}>{ws.project.project_title}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        style={s.flex}
        contentContainerStyle={s.container}
        testID="client-project-screen"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={T.primary}
          />
        }
      >
        {/* ─── 0. DEPOSIT (visitor→register→claim conversion flow) ─── */}
        {ws.deposit?.required && !ws.deposit?.paid && (
          <View style={s.depositCard} testID="deposit-card">
            <View style={s.depositHeader}>
              <Ionicons name="lock-closed" size={16} color={T.warning} />
              <Text style={s.depositTitle}>Deposit required to start</Text>
            </View>
            <Text style={s.depositSub}>
              Pay 10% to lock developers, scope and timeline. Your deposit is held in
              escrow and released as each module is delivered.
            </Text>
            <View style={s.depositRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.depositAmount}>${fmt(ws.deposit.amount)}</Text>
                <Text style={s.depositMeta}>
                  10% of ${fmt(ws.deposit.final_price)} total
                </Text>
              </View>
              <TouchableOpacity
                testID="pay-deposit-btn"
                style={[s.depositBtn, payingDeposit && { opacity: 0.6 }]}
                onPress={payDeposit}
                disabled={payingDeposit}
                activeOpacity={0.85}
              >
                <Ionicons name="card" size={16} color={T.bg} />
                <Text style={s.depositBtnText}>
                  {payingDeposit ? 'Opening…' : 'Pay deposit'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ─── 1. HERO ─── */}
        <View style={s.hero}>
          <View style={s.heroBadge}>
            <View style={[s.pulseDot, { backgroundColor: hero.tone }]} />
            <Text style={[s.heroBadgeText, { color: hero.tone }]}>{hero.label}</Text>
          </View>
          <Text style={s.heroTitle} numberOfLines={2}>{ws.project.project_title}</Text>
          <Text style={s.heroSub} numberOfLines={2}>{ws.explanation}</Text>

          {/* Operator Layer — make the system feel like a teammate. */}
          {ws.system_action && (
            <View style={s.heroSysAction} testID="hero-system-action">
              <Ionicons name="hardware-chip" size={13} color={T.primary} />
              <Text style={s.heroSysActionText} numberOfLines={2}>
                System: {ws.system_action.label}
              </Text>
            </View>
          )}

          <View style={s.heroRow}>
            <View style={s.heroCell}>
              <Text style={s.heroVal}>${fmt(delivered)}</Text>
              <Text style={s.heroLab}>delivered</Text>
            </View>
            <View style={s.heroCell}>
              <Text style={s.heroVal}>${fmt(remaining)}</Text>
              <Text style={s.heroLab}>remaining</Text>
            </View>
            <View style={s.heroCell}>
              <Text style={s.heroVal}>{counters.total}</Text>
              <Text style={s.heroLab}>{counters.total === 1 ? 'module' : 'modules'}</Text>
            </View>
          </View>
        </View>

        {/* ─── 2. PROGRESS ENGINE ─── */}
        <View style={s.progress}>
          <Text style={s.sectionLabel}>PROGRESS</Text>
          <View style={s.counterRow}>
            <Counter dot={T.info} n={counters.in_progress} label="in progress" />
            <Counter dot={T.warning} n={counters.review}      label="in review" />
            <Counter dot={T.primary} n={counters.done}        label="done" />
          </View>
        </View>

        {/* ─── 3. DECISION ENGINE ─── */}
        {(() => {
          // BD-04 (slice #3, D-2): structural inline filter, no useMemo synthesis.
          // Backend already labels deliverable.status; frontend renders by status.
          const pending = (deliverables || []).filter(d => d.status === 'pending_approval');
          if (pending.length === 0) return null;
          return (
          <View style={s.decision} testID="decision-block">
            <View style={s.decisionHeader}>
              <Ionicons name="flash" size={16} color={T.warning} />
              <Text style={s.decisionTitle}>Action required</Text>
              <View style={s.decisionPill}>
                <Text style={s.decisionPillText}>{pending.length}</Text>
              </View>
            </View>
            {pending.map(d => (
              <View key={d.deliverable_id} style={s.decisionCard} testID={`decision-${d.deliverable_id}`}>
                <Text style={s.decisionCardTitle}>{d.title}</Text>
                <Text style={s.decisionCardSummary} numberOfLines={3}>{d.summary}</Text>
                {d.price ? <Text style={s.decisionCardPrice}>${fmt(d.price)}</Text> : null}
                <View style={s.decisionActions}>
                  <TouchableOpacity
                    testID={`approve-${d.deliverable_id}`}
                    style={[s.btn, s.btnPrimary, acting === d.deliverable_id && { opacity: 0.6 }]}
                    onPress={() => decide(d, 'approve')}
                    disabled={acting === d.deliverable_id}
                  >
                    <Text style={s.btnPrimaryText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID={`reject-${d.deliverable_id}`}
                    style={[s.btn, s.btnGhost, acting === d.deliverable_id && { opacity: 0.6 }]}
                    onPress={() => decide(d, 'reject')}
                    disabled={acting === d.deliverable_id}
                  >
                    <Text style={s.btnGhostText}>Request changes</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  testID={`view-deliverable-${d.deliverable_id}`}
                  style={s.decisionViewDetails}
                  onPress={() => router.push(`/client/deliverable/${d.deliverable_id}` as any)}
                >
                  <Text style={s.decisionViewDetailsText}>View details</Text>
                  <Ionicons name="chevron-forward" size={12} color={T.textMuted} />
                </TouchableOpacity>
              </View>
            ))}

            {/* Inline upsell — most conversionful spot: right next to a decision. */}
            {upsell && (
              <View style={s.upsell} testID="decision-upsell">
                <Text style={s.upsellLabel}>RECOMMENDED UPGRADE</Text>
                <Text style={s.upsellTitle}>{upsell.title} <Text style={s.upsellPrice}>+${fmt(upsell.price)}</Text></Text>
                <Text style={s.upsellDesc} numberOfLines={2}>{upsell.description}</Text>
                <TouchableOpacity
                  testID={`decision-upsell-add-${upsell.slug}`}
                  style={[s.upsellBtn, addingSlug === upsell.slug && { opacity: 0.6 }]}
                  onPress={() => addModule(upsell.slug)}
                  disabled={!!addingSlug}
                  activeOpacity={0.85}
                >
                  <Ionicons name="add-circle" size={16} color={T.bg} />
                  <Text style={s.upsellBtnText}>
                    {addingSlug === upsell.slug ? 'Adding…' : 'Add module'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          );
        })()}

        {/* ─── 4. MODULES ─── */}
        <Text style={s.sectionLabel}>MODULES · {counters.total}</Text>
        {(ws.modules || []).map((m) => {
          const tone = MODULE_TONE[m.status] || T.textMuted;
          const inv = invoiceByModule[m.module_id];
          const invIsPending = inv && (inv.status === 'pending_payment' || inv.status === 'failed');
          const invIsPaid = inv && inv.status === 'paid';
          const showApprove = m.status === 'review' && !inv;
          return (
            <View key={m.module_id} style={s.moduleCard} testID={`module-${m.module_id}`}>
              <View style={s.moduleHeader}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={s.moduleTitle} numberOfLines={1}>{m.module_title}</Text>
                  <Text style={s.moduleMeta}>
                    {m.developer_name ? `${m.developer_name} · ` : ''}
                    {m.cost_status === 'over_budget' ? 'OVER BUDGET' :
                     m.cost_status === 'warning' ? 'NEAR LIMIT' : ''}
                  </Text>
                </View>
                <View style={[s.modulePill, { borderColor: tone + '66', backgroundColor: tone + '14' }]}>
                  <Text style={[s.modulePillText, { color: tone }]}>{m.status.replace('_', ' ')}</Text>
                </View>
              </View>

              <View style={s.modulePriceRow}>
                <Text style={s.modulePrice}>${fmt(m.price)}</Text>
                {invIsPaid ? (
                  <Text style={[s.moduleEarn, { color: T.success, fontWeight: '700' }]}>
                    ✓ Paid {inv?.paid_at ? `· ${new Date(inv.paid_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}` : ''}
                  </Text>
                ) : invIsPending ? (
                  <Text style={[s.moduleEarn, { color: T.warning, fontWeight: '700' }]}>Invoice: pending</Text>
                ) : (
                  <Text style={s.moduleEarn}>earned ${fmt(m.earned)}</Text>
                )}
              </View>

              <View style={s.progressBg}>
                <View style={[s.progressFill, { width: `${Math.min(100, m.progress_pct)}%`, backgroundColor: invIsPaid ? T.success : tone }]} />
              </View>

              {/* Passive pressure: state-specific footer that nudges without nagging. */}
              {showApprove && (
                <View style={s.moduleHint} testID={`pressure-review-${m.module_id}`}>
                  <Ionicons name="alert-circle" size={14} color={T.warning} />
                  <Text style={s.moduleHintText}>
                    Waiting for your approval{m.price ? ` · $${fmt(m.price)} is ready to be delivered` : ''}
                  </Text>
                </View>
              )}

              {invIsPending && (
                <>
                  <View style={s.moduleHint} testID={`pressure-payment-${m.module_id}`}>
                    <Ionicons name="lock-closed" size={14} color={T.danger} />
                    <Text style={[s.moduleHintText, { color: T.danger }]}>
                      Blocked by payment · pay to continue development
                    </Text>
                  </View>
                  <TouchableOpacity
                    testID={`pay-${inv!.invoice_id}`}
                    style={[s.payBtn, paying === inv!.invoice_id && { opacity: 0.6 }]}
                    onPress={() => payInvoice(inv!)}
                    disabled={paying === inv!.invoice_id}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="card" size={16} color={T.bg} />
                    <Text style={s.payBtnText}>
                      {paying === inv!.invoice_id ? 'Processing…' : `Pay now · $${fmt(inv!.amount)}`}
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              {/* Contextual upsell — surface 2FA right under a finished auth module. */}
              {(() => {
                const t = (m.module_title || '').toLowerCase();
                const isAuth = t.includes('auth');
                const isDone = m.status === 'done' || m.status === 'completed';
                const twoFa = catalog.find(c => c.slug === '2fa');
                const alreadyHas = (ws?.modules || []).some(x =>
                  (x.module_title || '').toLowerCase().includes('two-factor') ||
                  (x.module_title || '').toLowerCase().includes('2fa'));
                if (!isAuth || !isDone || !twoFa || alreadyHas) return null;
                return (
                  <View style={s.ctxUpsell} testID={`ctx-upsell-${m.module_id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.ctxUpsellLabel}>UPGRADE AVAILABLE</Text>
                      <Text style={s.ctxUpsellText}>Add 2FA for better security · +${fmt(twoFa.price)}</Text>
                    </View>
                    <TouchableOpacity
                      testID={`ctx-upsell-add-${m.module_id}`}
                      style={[s.ctxUpsellBtn, addingSlug === '2fa' && { opacity: 0.6 }]}
                      onPress={() => addModule('2fa')}
                      disabled={!!addingSlug}
                      activeOpacity={0.85}
                    >
                      <Text style={s.ctxUpsellBtnText}>{addingSlug === '2fa' ? '…' : 'Add'}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })()}
            </View>
          );
        })}

        {/* ─── 4b. ADD MODULE ENTRY ─── */}
        <TouchableOpacity
          testID="open-module-catalog"
          style={s.addBlock}
          onPress={() => router.push({
            pathname: '/client/modules/catalog',
            params: { projectId: id, projectTitle: ws.project.project_title },
          } as any)}
          activeOpacity={0.85}
        >
          <View style={s.addBlockIcon}>
            <Ionicons name="add" size={22} color={T.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.addBlockTitle}>Improve your product</Text>
            <Text style={s.addBlockSub}>Add new capabilities — auth, payments, analytics</Text>
          </View>
          <View style={s.addBlockCta}>
            <Text style={s.addBlockCtaText}>Browse</Text>
            <Ionicons name="chevron-forward" size={14} color={T.bg} />
          </View>
        </TouchableOpacity>

        {/* ─── 5. INLINE ACTIVITY ─── */}
        <Text style={[s.sectionLabel, { marginTop: T.lg }]}>LIVE ACTIVITY</Text>
        {events.length === 0 ? (
          <Text style={s.empty}>Nothing happening yet — events will surface here in real time.</Text>
        ) : (
          events.map((e, i) => (
            <View key={`${e.at}-${i}`} style={s.evRow}>
              <View style={[s.evDot, { backgroundColor: DOT_COLOR[e.dot] }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.evLine} numberOfLines={1}>
                  <Text style={{ fontWeight: '700' }}>{e.module_title}</Text>
                  <Text style={{ color: T.textMuted }}> {e.verb}</Text>
                </Text>
                <Text style={s.evMeta}>{relTime(e.at)}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Counter({ dot, n, label }: { dot: string; n: number; label: string }) {
  return (
    <View style={s.counterCell}>
      <View style={[s.cDot, { backgroundColor: dot }]} />
      <Text style={s.cVal}>{n}</Text>
      <Text style={s.cLab}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  empty: { color: T.textMuted, fontSize: T.small, textAlign: 'center', marginVertical: T.md },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: T.md, paddingVertical: T.sm,
    borderBottomWidth: 1, borderBottomColor: T.border,
    backgroundColor: T.surface1,
  },
  backIcon: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 60 },
  backLabel: { color: T.text, fontSize: T.small, fontWeight: '600' },
  topTitle: { color: T.text, fontSize: T.body, fontWeight: '700', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  backBtn: { backgroundColor: T.primary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: T.radiusSm, marginTop: 12 },
  backBtnText: { color: T.bg, fontWeight: '700' },

  container: { padding: T.lg, paddingBottom: 100 },

  /* HERO */
  hero: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius,
    padding: T.lg,
    marginBottom: T.md,
  },
  heroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: T.surface2,
  },
  pulseDot: { width: 6, height: 6, borderRadius: 3 },
  heroBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  heroTitle: { color: T.text, fontSize: T.h2, fontWeight: '800', marginTop: 12 },
  heroSub: { color: T.textMuted, fontSize: T.small, marginTop: 6 },

  /* OPERATOR LAYER — system-action line on the project hero */
  heroSysAction: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: T.primaryBg,
    borderWidth: 1, borderColor: T.primaryBorder,
    borderRadius: T.radiusSm,
    paddingHorizontal: 10, paddingVertical: 7,
    marginTop: T.sm,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  heroSysActionText: { color: T.text, fontSize: T.tiny, flexShrink: 1, fontWeight: '600' },

  heroRow: { flexDirection: 'row', gap: T.md, marginTop: T.lg },
  heroCell: { flex: 1 },
  heroVal: { color: T.text, fontSize: T.h3, fontWeight: '800' },
  heroLab: { color: T.textMuted, fontSize: T.tiny, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },

  /* PROGRESS */
  progress: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius,
    padding: T.md,
    marginBottom: T.md,
  },
  sectionLabel: { color: T.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 8 },
  counterRow: { flexDirection: 'row', gap: T.md, marginTop: 4 },
  counterCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  cDot: { width: 8, height: 8, borderRadius: 4 },
  cVal: { color: T.text, fontSize: T.h3, fontWeight: '800' },
  cLab: { color: T.textMuted, fontSize: T.tiny },

  /* DECISION ENGINE */
  decision: {
    backgroundColor: T.warningBg,
    borderWidth: 1, borderColor: T.warningBorder,
    borderRadius: T.radius,
    padding: T.md,
    marginBottom: T.md,
  },
  decisionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: T.sm },
  decisionTitle: { color: T.text, fontSize: T.body, fontWeight: '800', flex: 1 },
  decisionPill: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 999, backgroundColor: T.warning,
  },
  decisionPillText: { color: '#000', fontSize: 11, fontWeight: '800' },
  decisionCard: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radiusSm,
    padding: T.md,
    marginTop: 6,
  },
  decisionCardTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  decisionCardSummary: { color: T.textMuted, fontSize: T.small, marginTop: 4 },
  decisionCardPrice: { color: T.primary, fontSize: T.body, fontWeight: '800', marginTop: 8 },
  decisionActions: { flexDirection: 'row', gap: T.sm, marginTop: T.md },
  decisionViewDetails: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: T.sm, paddingTop: T.sm, borderTopWidth: 1, borderTopColor: T.border },
  decisionViewDetailsText: { color: T.textMuted, fontSize: T.small, fontWeight: '500' },
  btn: { flex: 1, paddingVertical: 10, borderRadius: T.radiusSm, alignItems: 'center' },
  btnPrimary: { backgroundColor: T.primary },
  btnPrimaryText: { color: T.bg, fontSize: T.body, fontWeight: '800' },
  btnGhost: { borderWidth: 1, borderColor: T.border, backgroundColor: T.surface2 },
  btnGhostText: { color: T.text, fontSize: T.body, fontWeight: '700' },

  /* MODULES */
  moduleCard: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius,
    padding: T.md,
    marginBottom: T.sm,
  },
  moduleHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  moduleTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  moduleMeta: { color: T.textMuted, fontSize: T.tiny, marginTop: 4 },
  modulePill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  modulePillText: { fontSize: T.tiny, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  modulePriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: T.sm },
  modulePrice: { color: T.text, fontSize: T.h3, fontWeight: '800' },
  moduleEarn: { color: T.textMuted, fontSize: T.tiny },
  progressBg: { height: 4, backgroundColor: T.surface2, borderRadius: 2, overflow: 'hidden', marginTop: T.sm },
  progressFill: { height: 4 },
  moduleHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: T.sm },
  moduleHintText: { color: T.warning, fontSize: T.tiny, fontWeight: '700' },

  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: T.primary,
    paddingVertical: 11, paddingHorizontal: 16,
    borderRadius: T.radiusSm,
    marginTop: T.sm,
  },
  payBtnText: { color: T.bg, fontSize: T.body, fontWeight: '800' },

  /* ACTIVITY (inline) */
  evRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    borderRadius: T.radiusSm, padding: T.sm, marginBottom: 6,
  },
  evDot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
  evLine: { color: T.text, fontSize: T.small },
  evMeta: { color: T.textMuted, fontSize: 10, marginTop: 2 },

  /* EXPANSION ENGINE — inline upsell inside Decision block */
  upsell: {
    backgroundColor: T.primaryBg,
    borderWidth: 1, borderColor: T.primaryBorder,
    borderRadius: T.radiusSm,
    padding: T.md,
    marginTop: T.sm,
  },
  upsellLabel: { color: T.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  upsellTitle: { color: T.text, fontSize: T.body, fontWeight: '800', marginTop: 4 },
  upsellPrice: { color: T.primary, fontWeight: '800' },
  upsellDesc: { color: T.textMuted, fontSize: T.small, marginTop: 4, lineHeight: 18 },
  upsellBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: T.primary,
    paddingVertical: 9, paddingHorizontal: 14,
    borderRadius: T.radiusSm,
    alignSelf: 'flex-start',
    marginTop: T.sm,
  },
  upsellBtnText: { color: T.bg, fontSize: T.small, fontWeight: '800' },

  /* EXPANSION ENGINE — contextual upsell on a finished module */
  ctxUpsell: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: T.primaryBg,
    borderWidth: 1, borderColor: T.primaryBorder,
    borderRadius: T.radiusSm,
    padding: T.sm,
    marginTop: T.sm,
  },
  ctxUpsellLabel: { color: T.primary, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  ctxUpsellText: { color: T.text, fontSize: T.small, fontWeight: '600', marginTop: 2 },
  ctxUpsellBtn: {
    backgroundColor: T.primary,
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: T.radiusSm,
  },
  ctxUpsellBtnText: { color: T.bg, fontSize: T.small, fontWeight: '800' },

  /* EXPANSION ENGINE — Add Module entry block */
  addBlock: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.primaryBorder,
    borderStyle: 'dashed' as const,
    borderRadius: T.radius,
    padding: T.md,
    marginTop: T.sm,
    marginBottom: T.md,
  },
  addBlockIcon: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: T.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  addBlockTitle: { color: T.text, fontSize: T.body, fontWeight: '800' },
  addBlockSub: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },
  addBlockCta: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: T.primary,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: T.radiusSm,
  },
  addBlockCtaText: { color: T.bg, fontSize: T.small, fontWeight: '800' },

  /* DEPOSIT CARD — top-of-page CTA for awaiting_deposit projects */
  depositCard: {
    backgroundColor: T.warningBg,
    borderWidth: 1, borderColor: T.warningBorder,
    borderRadius: T.radius,
    padding: T.lg,
    marginBottom: T.md,
  },
  depositHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  depositTitle: { color: T.text, fontSize: T.body, fontWeight: '800' },
  depositSub: { color: T.textMuted, fontSize: T.small, marginBottom: T.md, lineHeight: 18 },
  depositRow: { flexDirection: 'row', alignItems: 'center', gap: T.md },
  depositAmount: { color: T.text, fontSize: T.h2, fontWeight: '800' },
  depositMeta: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },
  depositBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: T.primary,
    paddingVertical: 12, paddingHorizontal: 18,
    borderRadius: T.radiusSm,
  },
  depositBtnText: { color: T.bg, fontSize: T.body, fontWeight: '800' },
});
