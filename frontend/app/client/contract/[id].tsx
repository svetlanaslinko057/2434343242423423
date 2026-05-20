/**
 * Phase 3.B — Mobile Contract Screen.
 * Phase 4 — Payment Lock UX:
 *   Sign → backend returns invoice.payment_url
 *   → screen flips into "Initial payment required" state
 *   → [Pay now] opens hosted WayForPay page (Linking)
 *   → fallback polling /api/client/invoices/{id} every 4s
 *   → on `paid` → router.replace('/activity')
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Platform, Linking, AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import api from '../../../src/api';
import T from '../../../src/theme';

type Scope = { module_id: string; title: string; speed_tier: string; final_price: number };
type Totals = { modules_count: number; total_value: number; currency: string; estimated_hours?: number | null };
type Timeline = { weeks_min: number; weeks_max: number; label: string };
type PaymentTerms = { schedule: string; upfront_pct: number; delivery_pct: number; currency: string };

type InvoiceMini = {
  invoice_id: string;
  amount: number;
  currency: string;
  status: string;
  payment_url?: string | null;
  provider?: string | null;
  kind?: string | null;
  title?: string | null;
};

type ContractView = {
  contract_id: string;
  project_id: string;
  project_title: string;
  version: number;
  status: 'draft' | 'pending' | 'signed' | 'active';
  signed: boolean;
  signed_at: string | null;
  scope: Scope[];
  totals: Totals;
  timeline: Timeline;
  includes: string[];
  payment_terms: PaymentTerms;
  invoice?: InvoiceMini | null;
};

const fmtMoney = (n: number, ccy = 'USD') =>
  ccy === 'USD' ? `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}` :
  `${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${ccy}`;

export default function ProjectContractScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const projectId = String(params.id || '');

  const [data, setData] = useState<ContractView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceMini | null>(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setPolling(false);
  }, []);

  // Phase 4 — fallback polling: WayForPay return-flow gap (user closes tab).
  // AppState-gated: tick is a no-op while app is in background.
  const startPolling = useCallback((invId: string) => {
    if (pollRef.current) return;
    setPolling(true);
    pollRef.current = setInterval(async () => {
      if (AppState.currentState !== 'active') return;
      try {
        const r = await api.get(`/client/invoices/${invId}`);
        if (r.data?.status === 'paid') {
          stopPolling();
          Alert.alert(
            'Payment received',
            'Project is now active. Development begins.',
            [{ text: 'Open activity', onPress: () => router.replace('/activity' as any) }],
          );
        } else if (r.data?.status === 'failed' || r.data?.status === 'cancelled') {
          stopPolling();
          setInvoice((prev) => prev ? { ...prev, status: r.data.status } : prev);
        }
      } catch { /* silent — keep polling */ }
    }, 4000);
  }, [router, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const load = useCallback(async () => {
    if (!projectId) { setError('Missing project'); return; }
    try {
      const r = await api.get(`/client/projects/${projectId}/contract`);
      setData(r.data);
      setError(null);

      // If already signed, look up the initial pending invoice for this project.
      if (r.data?.signed && !invoice) {
        try {
          const invR = await api.get(`/client/invoices`);
          const list = Array.isArray(invR.data) ? invR.data : [];
          const pending = list.find((i: any) =>
            i.project_id === r.data.project_id && i.status === 'pending_payment'
          );
          if (pending) {
            setInvoice({
              invoice_id: pending.invoice_id,
              amount: pending.amount,
              currency: pending.currency || 'USD',
              status: pending.status,
              payment_url: pending.payment_url,
              provider: pending.payment_provider || pending.provider,
              kind: pending.kind,
              title: pending.title,
            });
            startPolling(pending.invoice_id);
          }
        } catch { /* ignore */ }
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not load contract');
    }
  }, [projectId, invoice, startPolling]);

  useEffect(() => { load(); }, [load]);

  const onSign = async () => {
    if (!data) return;
    setSigning(true);
    try {
      const r = await api.post(`/client/contracts/${data.contract_id}/sign`, { accepted: true });
      setData(r.data);
      // Phase 4 — backend returns the initial invoice with hosted payment_url.
      const inv: InvoiceMini | undefined = r.data?.invoice;
      if (inv?.invoice_id) {
        setInvoice(inv);
        startPolling(inv.invoice_id);
      }
    } catch (e: any) {
      Alert.alert('Sign failed', e?.response?.data?.detail || 'Try again');
    } finally {
      setSigning(false);
    }
  };

  const openPayment = async () => {
    if (!invoice?.payment_url) {
      Alert.alert('Payment unavailable', 'No payment URL. Try refreshing.');
      return;
    }
    try {
      const can = await Linking.canOpenURL(invoice.payment_url);
      if (!can) throw new Error('cannot_open');
      await Linking.openURL(invoice.payment_url);
      // Resume polling (in case it was paused).
      startPolling(invoice.invoice_id);
    } catch {
      Alert.alert('Could not open payment page', invoice.payment_url || '');
    }
  };

  if (data === null && error === null) {
    return <View style={s.centered}><ActivityIndicator color={T.primary} /></View>;
  }
  if (error || !data) {
    return (
      <View style={s.centered}>
        <Text style={{ color: T.danger, marginBottom: T.md }}>{error || 'No contract'}</Text>
        <TouchableOpacity onPress={load} style={s.retry}><Text style={s.retryText}>Retry</Text></TouchableOpacity>
      </View>
    );
  }

  const alreadySigned = !!data.signed;
  const awaitingPayment = alreadySigned && invoice && invoice.status === 'pending_payment';

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      testID="contract-screen"
    >
      <View style={s.topRow}>
        <TouchableOpacity onPress={() => router.back()} testID="contract-back" style={s.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={T.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <View
          style={awaitingPayment ? s.statusBadgeAwait : alreadySigned ? s.statusBadgeSigned : s.statusBadgeDraft}
          testID="contract-status-badge"
        >
          <Text
            style={awaitingPayment ? s.statusBadgeAwaitText : alreadySigned ? s.statusBadgeSignedText : s.statusBadgeDraftText}
          >
            {awaitingPayment ? 'AWAITING PAYMENT' : alreadySigned ? 'SIGNED' : 'READY TO SIGN'}
          </Text>
        </View>
      </View>

      {/* Block 1 — H1, single big sentence */}
      <View style={s.header}>
        <Text style={s.h1}>
          {awaitingPayment
            ? 'Initial payment required'
            : alreadySigned
              ? "You've started your project"
              : "You're about to start your project"}
        </Text>
        {awaitingPayment ? (
          <Text style={s.subhead} testID="contract-await-sub">
            Complete the upfront payment to begin development.
          </Text>
        ) : null}
      </View>

      {/* Phase 4 — Payment block (after sign, when invoice is pending_payment) */}
      {awaitingPayment && invoice ? (
        <View style={s.payCard} testID="contract-payment-block">
          <Text style={s.payLabel}>INITIAL PAYMENT</Text>
          <Text style={s.payAmount} testID="contract-pay-amount">
            {fmtMoney(invoice.amount, invoice.currency)}
          </Text>
          <Text style={s.payHint}>{invoice.title || 'Initial 50% upfront'}</Text>

          <TouchableOpacity
            testID="contract-pay-now-btn"
            style={s.cta}
            onPress={openPayment}
            activeOpacity={0.85}
          >
            <Ionicons name="card" size={18} color={T.primaryInk} />
            <Text style={s.ctaText}>Pay now</Text>
          </TouchableOpacity>

          {polling ? (
            <View style={s.pollRow} testID="contract-poll-indicator">
              <ActivityIndicator size="small" color={T.textMuted} />
              <Text style={s.pollText}>Checking payment…</Text>
            </View>
          ) : null}

          <Text style={s.payProvider}>
            Secure payment via {invoice.provider === 'wayforpay' ? 'WayForPay' : (invoice.provider || 'card')}
          </Text>
        </View>
      ) : null}

      {/* Block 2 — Project + scope */}
      <View style={s.card} testID="contract-scope-card">
        <Text style={s.label}>PROJECT</Text>
        <Text style={s.projectTitle}>{data.project_title}</Text>

        <View style={s.divider} />

        <Row label="Scope" value={`${data.totals.modules_count} module${data.totals.modules_count === 1 ? '' : 's'}`} />
        <Row label="Timeline" value={data.timeline.label} />
        <Row label="Cost"
             value={fmtMoney(data.totals.total_value, data.totals.currency)}
             accent={T.primary}
             bold />

        <View style={s.divider} />

        <Text style={s.subLabel}>MODULES</Text>
        {data.scope.map((m) => (
          <View key={m.module_id} style={s.moduleRow} testID={`contract-module-${m.module_id}`}>
            <View style={{ flex: 1 }}>
              <Text style={s.moduleTitle}>{m.title}</Text>
              <Text style={s.moduleSpeed}>{m.speed_tier}</Text>
            </View>
            <Text style={s.modulePrice}>{fmtMoney(m.final_price, data.totals.currency)}</Text>
          </View>
        ))}
      </View>

      {/* Block 3 — Includes */}
      <View style={s.card}>
        <Text style={s.label}>INCLUDES</Text>
        {data.includes.map((it) => (
          <View key={it} style={s.includeRow}>
            <Ionicons name="checkmark-circle" size={16} color={T.primary} />
            <Text style={s.includeText}>{it}</Text>
          </View>
        ))}
      </View>

      {/* Block 4 — Payment terms */}
      <View style={s.card} testID="contract-payment-card">
        <Text style={s.label}>PAYMENT TERMS</Text>
        <Text style={s.paymentLine}>
          {data.payment_terms.upfront_pct}% upfront · {data.payment_terms.delivery_pct}% on delivery
        </Text>
      </View>

      {/* Click-wrap acceptance copy */}
      {!alreadySigned ? (
        <Text style={s.legal}>
          By tapping "Accept & Continue to Payment" you agree to the scope, timeline,
          and payment terms above. Your acceptance will be timestamped.
        </Text>
      ) : (
        <Text style={s.legal} testID="contract-signed-meta">
          Signed at {data.signed_at ? new Date(data.signed_at).toLocaleString() : '—'}.
        </Text>
      )}

      {!alreadySigned ? (
        <TouchableOpacity
          testID="contract-pick-plan-btn"
          style={s.ctaSecondary}
          onPress={() => router.push(`/client/payment-plan/${data.project_id}` as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="options" size={18} color={T.primary} />
          <Text style={s.ctaSecondaryText}>Choose payment plan</Text>
        </TouchableOpacity>
      ) : null}

      {/* The button. Always sticky-feeling at the bottom of content. */}
      {!alreadySigned ? (
        <TouchableOpacity
          testID="contract-sign-btn"
          style={[s.cta, signing && { opacity: 0.6 }]}
          onPress={onSign}
          disabled={signing}
          activeOpacity={0.85}
        >
          {signing
            ? <ActivityIndicator color={T.primaryInk} />
            : <>
                <Ionicons name="card" size={18} color={T.primaryInk} />
                <Text style={s.ctaText}>Accept & Continue to Payment</Text>
              </>}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          testID="contract-go-activity"
          style={s.ctaSecondary}
          onPress={() => router.replace('/activity' as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="pulse" size={18} color={T.primary} />
          <Text style={s.ctaSecondaryText}>Open Activity</Text>
        </TouchableOpacity>
      )}

      <Text style={s.footer}>Build products. Not tickets.</Text>
    </ScrollView>
  );
}

function Row({ label, value, accent, bold }: { label: string; value: string; accent?: string; bold?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[
        s.rowValue,
        accent ? { color: accent } : null,
        bold ? { fontWeight: '800' as const } : null,
      ]}>
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.lg, paddingBottom: T.xl * 2 },
  centered: { flex: 1, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center' },

  topRow: { flexDirection: 'row', alignItems: 'center', marginBottom: T.sm },
  iconBtn: { padding: 6 },

  statusBadgeDraft: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    backgroundColor: T.warningBg, borderWidth: 1, borderColor: T.warningBorder,
  },
  statusBadgeDraftText: { color: T.warning, fontWeight: '800', fontSize: 10, letterSpacing: 1 },
  statusBadgeSigned: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    backgroundColor: T.primaryBg, borderWidth: 1, borderColor: T.primaryBg,
  },
  statusBadgeSignedText: { color: T.success, fontWeight: '800', fontSize: 10, letterSpacing: 1 },
  statusBadgeAwait: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    backgroundColor: T.primaryBg, borderWidth: 1, borderColor: T.primaryBg,
  },
  statusBadgeAwaitText: { color: T.primary, fontWeight: '800', fontSize: 10, letterSpacing: 1 },

  header: { marginBottom: T.lg, marginTop: T.sm },
  h1: { color: T.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5, lineHeight: 34 },
  subhead: { color: T.textMuted, fontSize: T.body, marginTop: 6 },

  card: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    padding: T.md, borderWidth: 1, borderColor: T.border,
    marginBottom: T.md,
  },

  payCard: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    padding: T.md, borderWidth: 1, borderColor: T.primaryBg,
    marginBottom: T.md,
  },
  payLabel: { color: T.primary, fontSize: 10, letterSpacing: 2, fontWeight: '800', marginBottom: 8 },
  payAmount: { color: T.text, fontSize: 36, fontWeight: '800', letterSpacing: -1 },
  payHint: { color: T.textMuted, fontSize: T.small, marginTop: 4, marginBottom: T.md },
  payProvider: { color: T.textMuted, fontSize: T.tiny, textAlign: 'center', marginTop: 8 },
  pollRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: T.sm },
  pollText: { color: T.textMuted, fontSize: T.small },

  label: { color: T.textMuted, fontSize: 10, letterSpacing: 2, fontWeight: '800', marginBottom: 8 },
  subLabel: { color: T.textMuted, fontSize: 10, letterSpacing: 2, fontWeight: '800', marginBottom: 8, marginTop: 4 },

  projectTitle: { color: T.text, fontSize: T.h3, fontWeight: '800' },

  divider: { height: 1, backgroundColor: T.border, marginVertical: T.md },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  rowLabel: { color: T.textMuted, fontSize: T.body },
  rowValue: { color: T.text, fontSize: T.body, fontWeight: '600' },

  moduleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8,
  },
  moduleTitle: { color: T.text, fontSize: T.body, fontWeight: '600' },
  moduleSpeed: { color: T.textMuted, fontSize: T.tiny, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },
  modulePrice: { color: T.text, fontSize: T.body, fontWeight: '700' },

  includeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  includeText: { color: T.text, fontSize: T.body },

  paymentLine: { color: T.text, fontSize: T.body, fontWeight: '600' },

  legal: {
    color: T.textMuted, fontSize: T.small, lineHeight: 18,
    marginTop: T.md, marginBottom: T.md, textAlign: 'center',
  },

  cta: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: T.primary, borderRadius: T.radius, paddingVertical: 16,
    marginTop: T.sm, marginBottom: T.md,
    ...Platform.select({
      ios: { shadowColor: T.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12 },
      android: { elevation: 8 },
      default: {},
    }),
  },
  ctaText: { color: T.primaryInk, fontWeight: '800', fontSize: T.body },

  ctaSecondary: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: T.surface1, borderRadius: T.radius, paddingVertical: 14,
    marginTop: T.sm, marginBottom: T.md,
    borderWidth: 1, borderColor: T.primary,
  },
  ctaSecondaryText: { color: T.primary, fontWeight: '800', fontSize: T.body },

  retry: { padding: T.md, backgroundColor: T.surface1, borderRadius: T.radiusSm },
  retryText: { color: T.primary, fontWeight: '700' },

  footer: { color: T.textMuted, fontSize: T.tiny, textAlign: 'center', opacity: 0.6, marginTop: T.md },
});
