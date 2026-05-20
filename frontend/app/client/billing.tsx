// Billing tab — Operator Console redesign
//
// ─── Runtime-client migration (Batch 2 — Expo Client Cabinet) ───────────
// Transport-swap only. Polling loop (4s setInterval) PRESERVED unchanged
// (manual lifecycle, no retry/dedup interference). `pay()` calls
// `/payments/wayforpay/create` which returns a checkout URL — that's a
// CREATE side-effect but the actual money movement happens after the user
// is redirected to the provider, so no `capability: 'payment'` here.
// Idempotency added so repeated taps don't generate multiple checkout
// sessions for the same invoice.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, Alert, ActivityIndicator,
  Linking, AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { runtime } from '../../src/runtime';
import { ApiError } from '../../src/runtime-client';
import T from '../../src/theme';
import { ScreenTitle, SectionLabel, StatCard, StatusPill, EmptyState } from '../../src/ui-client';
import { PressScale, FadeSlideIn } from '../../src/ui';

type Invoice = {
  invoice_id: string;
  project_id: string;
  title: string;
  amount: number;
  currency?: string;
  status: 'paid' | 'pending_payment' | 'draft' | 'failed' | 'cancelled' | string;
  payment_provider?: string;
  payment_url?: string | null;
  provider?: string;
  created_at?: string;
  paid_at?: string;
};

type CostSummary = {
  revenue?: number; committed_cost?: number; earned?: number;
  paid_out?: number; remaining_cost?: number; profit?: number;
};

const STATUS: Record<string, { label: string; tone: 'success' | 'risk' | 'info' | 'danger' | 'neutral' }> = {
  paid:            { label: 'Paid',       tone: 'success' },
  pending_payment: { label: 'Pending',    tone: 'risk' },
  draft:           { label: 'Draft',      tone: 'info' },
  failed:          { label: 'Failed',     tone: 'danger' },
  cancelled:       { label: 'Cancelled',  tone: 'neutral' },
};

function fmt(n: number | undefined): string {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function shortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ClientBilling() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [costs, setCosts] = useState<CostSummary>({});
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pollingId, setPollingId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setPollingId(null);
  };

  useEffect(() => () => stopPolling(), []);

  const load = async () => {
    try {
      const [invR, costR, projR] = await Promise.all([
        runtime.get('/api/client/invoices'),
        runtime.get('/api/client/costs'),
        runtime.get('/api/projects/mine'),
      ]);
      const invList: Invoice[] = Array.isArray(invR.data)
        ? invR.data
        : Array.isArray(invR.data?.invoices) ? invR.data.invoices : [];
      invList.sort((a, b) => {
        const p = (a.project_id || '').localeCompare(b.project_id || '');
        if (p !== 0) return p;
        return (b.created_at || '').localeCompare(a.created_at || '');
      });
      setInvoices(invList);
      setCosts(costR.data?.summary || {});
      const nameMap: Record<string, string> = {};
      for (const p of (Array.isArray(projR.data) ? projR.data : [])) {
        nameMap[p.project_id] = p.name || p.title || '';
      }
      setProjectNames(nameMap);
    } catch { /* silent — preserves original telemetry surface */ }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, []);

  const totals = useMemo(() => {
    const paid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
    const pending = invoices.filter(i => i.status === 'pending_payment').reduce((s, i) => s + i.amount, 0);
    return { paid, pending };
  }, [invoices]);

  // Phase 4 — fallback polling: WayForPay user may close tab before redirect.
  // NOTE: polling runs on a manual setInterval so it operates OUTSIDE
  // runtime-client retry semantics — exactly what we want. Each tick is a
  // fresh GET; runtime dedup is fine to coalesce concurrent ticks if any.
  // 2026-05-13 (Runtime Stabilization Window): gated on AppState.currentState
  // so the tick is a no-op while app is in background (preserves polling
  // intent but stops needless network on resume burst).
  const startPolling = (invoiceId: string, projectId: string) => {
    stopPolling();
    setPollingId(invoiceId);
    pollRef.current = setInterval(async () => {
      if (AppState.currentState !== 'active') return;
      try {
        const r = await runtime.get(`/api/client/invoices/${invoiceId}`);
        if (r.data?.status === 'paid') {
          stopPolling();
          load();
          Alert.alert(
            'Payment received',
            'Project is now active. Development begins.',
            [
              { text: 'Open activity', onPress: () => router.push('/activity' as any) },
              { text: 'OK' },
            ],
          );
        } else if (r.data?.status === 'failed' || r.data?.status === 'cancelled') {
          stopPolling();
          load();
        }
      } catch { /* keep polling */ }
    }, 4000);
  };

  const pay = async (inv: Invoice) => {
    // 1. If invoice already has a payment_url, open it directly.
    let url: string | null | undefined = inv.payment_url;
    let invoiceId = inv.invoice_id;

    // 2. Otherwise, ask backend to create one via the configured provider.
    if (!url) {
      try {
        // No `capability: 'payment'` — this endpoint returns a redirect URL
        // to the provider's hosted checkout; money movement happens on the
        // provider side after redirect. Idempotency stops repeated taps from
        // generating multiple checkout sessions for the same invoice.
        const r = await runtime.post(
          '/api/payments/wayforpay/create',
          { invoice_id: inv.invoice_id },
          { idempotencyKey: `wfp-create:${inv.invoice_id}` },
        );
        url = r.data?.payment_url;
      } catch (e: any) {
        const msg = e instanceof ApiError ? (e.message || e.code) : (e?.response?.data?.detail || 'Could not create payment');
        Alert.alert('Payment unavailable', msg);
        return;
      }
    }

    if (!url) {
      Alert.alert('Payment unavailable', 'No payment URL returned by provider');
      return;
    }

    try {
      const can = await Linking.canOpenURL(url);
      if (!can) throw new Error('cannot_open');
      await Linking.openURL(url);
    } catch {
      Alert.alert('Could not open payment page', url);
      return;
    }

    // 3. Start polling so the UI flips automatically when WayForPay confirms.
    startPolling(invoiceId, inv.project_id);
  };

  if (loading) {
    return (
      <SafeAreaView style={[s.flex, s.center]} edges={['top']}>
        <ActivityIndicator color={T.primary} />
      </SafeAreaView>
    );
  }

  // Group invoices by project_id, preserving sort order (display logic only).
  const groups: { project_id: string; project_name: string; items: Invoice[] }[] = [];
  for (const inv of invoices) {
    const pid = inv.project_id || '_';
    const name = projectNames[pid] || 'Untitled';
    const last = groups[groups.length - 1];
    if (last && last.project_id === pid) last.items.push(inv);
    else groups.push({ project_id: pid, project_name: name, items: [inv] });
  }

  return (
    <SafeAreaView style={s.flex} edges={['top']}>
      <ScrollView
        style={s.flex}
        contentContainerStyle={s.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={T.primary} />}
        testID="client-billing"
      >
        <ScreenTitle title="Billing" subtitle="Where every dollar goes" />

        {/* Stat strip */}
        <View style={s.statRow}>
          <StatCard label="Paid"    value={`$${fmt(totals.paid)}`}    accent={T.success} />
          <StatCard label="Pending" value={`$${fmt(totals.pending)}`} accent={T.risk} />
        </View>
        <View style={[s.statRow, { marginTop: T.sm }]}>
          <StatCard label="Earned" value={`$${fmt(costs.earned)}`} />
          <StatCard label="Profit" value={`$${fmt(costs.profit)}`} accent={(costs.profit ?? 0) >= 0 ? T.success : T.danger} />
        </View>

        <SectionLabel>Invoices</SectionLabel>

        {invoices.length === 0 && (
          <EmptyState icon="receipt-outline" title="No invoices yet" sub="Once a milestone is approved, an invoice will appear here." />
        )}

        {groups.map((g) => (
          <View key={g.project_id} style={{ marginBottom: T.md }}>
            <Text style={s.projectGroup}>{g.project_name}</Text>
            {g.items.map((inv, i) => {
              const meta = STATUS[inv.status] || STATUS.draft;
              const dateLabel = inv.status === 'paid'
                ? `Paid ${shortDate(inv.paid_at)}`
                : `Issued ${shortDate(inv.created_at)}`;
              return (
                <FadeSlideIn key={inv.invoice_id} delay={i * 40}>
                  <View style={s.invoice} testID={`invoice-${inv.invoice_id}`}>
                    <View style={s.invoiceHeader}>
                      <Text style={s.invoiceTitle} numberOfLines={2}>{inv.title}</Text>
                      <StatusPill tone={meta.tone} label={meta.label} />
                    </View>

                    <View style={s.invoiceFooter}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.amount}>${fmt(inv.amount)}</Text>
                        <Text style={s.invoiceDate} numberOfLines={1}>
                          {dateLabel}{inv.payment_provider ? ` · ${inv.payment_provider}` : ''}
                        </Text>
                      </View>

                      {inv.status === 'pending_payment' && (
                        pollingId === inv.invoice_id ? (
                          <View style={s.pollingBtn} testID={`invoice-polling-${inv.invoice_id}`}>
                            <ActivityIndicator size="small" color={T.primary} />
                            <Text style={s.pollingBtnText}>Checking…</Text>
                          </View>
                        ) : (
                          <PressScale
                            testID={`invoice-pay-${inv.invoice_id}`}
                            onPress={() => pay(inv)}
                            style={s.payBtn}
                          >
                            <Ionicons name="card" size={16} color={T.bg} />
                            <Text style={s.payBtnText}>Pay now</Text>
                          </PressScale>
                        )
                      )}
                      {inv.status === 'draft' && (
                        <View style={s.draftHint}>
                          <Text style={s.draftHintText}>Awaiting issue</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </FadeSlideIn>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  container: { padding: T.md, paddingBottom: 100 },

  statRow: { flexDirection: 'row', gap: T.sm },

  projectGroup: {
    color: T.text,
    fontSize: T.body,
    fontWeight: '800',
    marginTop: T.sm,
    marginBottom: 8,
  },

  invoice: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radiusLg,
    padding: T.md,
    marginBottom: T.sm,
  },
  invoiceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  invoiceTitle: { color: T.text, fontSize: T.body, fontWeight: '700', flex: 1 },

  invoiceFooter: {
    marginTop: T.md,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: T.sm,
  },
  amount: { color: T.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  invoiceDate: { color: T.textMuted, fontSize: T.tiny, marginTop: 4, fontWeight: '600' },

  payBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: T.primary,
    borderRadius: T.radiusSm,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  payBtnText: { color: T.bg, fontWeight: '800', fontSize: T.small },
  pollingBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: T.surface2,
    borderRadius: T.radiusSm,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: T.primary,
  },
  pollingBtnText: { color: T.primary, fontWeight: '800', fontSize: T.small },
  draftHint: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: T.radiusSm, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.border },
  draftHintText: { color: T.textMuted, fontSize: T.tiny, fontWeight: '700', letterSpacing: 0.5 },
});
