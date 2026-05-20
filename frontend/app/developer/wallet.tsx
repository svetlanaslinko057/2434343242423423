/**
 * Phase 5 — Developer Wallet & Withdraw.
 *
 *  available  → can withdraw now
 *  pending    → already requested, waiting on admin
 *  withdrawn  → lifetime sent out
 *  earned     → lifetime credited from approved modules
 *
 * Earnings arrive ONLY when client_approve_module flips a module → done.
 * Never from time logs / hours.
 *
 * ─── Pilot #4 — Expo dashboard migration to runtime-client ─────────────────
 *
 * This screen is the Expo analog of web Pilot #3 (DeveloperEarnings.js).
 * Migration scope is intentionally STRICT — only:
 *   - transport (axios → runtime)
 *   - capability semantics (payment is hard-gated; withdraw tagged)
 *   - lifecycle semantics (AbortSignal cleanup on unmount)
 *   - mock honesty (mode='mock' → MOCK badge, no fake success)
 *   - error model (ApiError, request_id surfacing)
 * No UX/design/auth/navigation refactor.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl, Modal, TextInput, Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { runtime } from '../../src/runtime';
import { ApiError, ErrorCode } from '../../src/runtime-client';
import type { CapabilityState } from '../../src/runtime-client';
import T from '../../src/theme';

type WalletHistoryItem = {
  log_id: string;
  module_id: string;
  project_id?: string;
  amount: number;
  reason: string;
  created_at: string;
};
type Wallet = {
  user_id: string;
  earned_lifetime: number;
  available_balance: number;
  pending_withdrawal: number;
  withdrawn_lifetime: number;
  history: WalletHistoryItem[];
};
type Withdrawal = {
  withdrawal_id: string;
  amount: number;
  status: 'requested' | 'approved' | 'paid' | 'rejected' | string;
  method?: string;
  destination?: string;
  created_at: string;
  paid_at?: string | null;
};

const fmt = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const dateStr = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';

// Idempotency keys are caller-generated for non-idempotent payment ops.
// expo-crypto.randomUUID() would work too — Math.random is fine here because
// the key is an opaque string the server treats as one of {amount,destination,method,key}.
function makeIdempotencyKey(): string {
  return `wd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function DeveloperWalletScreen() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [method, setMethod] = useState<'bank' | 'crypto' | 'manual'>('bank');
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [paymentMode, setPaymentMode] = useState<CapabilityState | null>(
    runtime.capabilities.peek('payment'),
  );

  // Live subscription to capability flips. Manifest refreshes every 5min and
  // also on demand — UI must re-render when payment switches mock↔live.
  useEffect(() => {
    const unsubscribe = runtime.capabilities.subscribe((m) => {
      setPaymentMode(m.capabilities?.payment ?? null);
    });
    // Make sure manifest is hot — if cold-start hadn't completed yet.
    if (!paymentMode || runtime.capabilities.isStale()) {
      void runtime.capabilities.refresh().catch(() => undefined);
    }
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Lifecycle: AbortSignal cleanup on unmount ──────────────────────────
  // Each load() spawns 2 GETs. If the user navigates away or pull-to-refresh
  // races, we cancel the in-flight pair so React doesn't warn about state
  // updates after unmount, and the dedup registry is left clean.
  const ctrlRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    // Cancel any prior in-flight load — protects pull-to-refresh races.
    if (ctrlRef.current) ctrlRef.current.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    try {
      const [w, list] = await Promise.all([
        runtime.get<Wallet>('/api/developer/wallet', { signal: ctrl.signal, retries: 2 }),
        runtime.get<Withdrawal[] | { withdrawals: Withdrawal[] }>(
          '/api/developer/withdrawals',
          { signal: ctrl.signal, retries: 2 },
        ),
      ]);
      if (ctrl.signal.aborted) return; // unmounted while awaiting
      setWallet(w.data);
      const raw = list.data as unknown;
      const arr = Array.isArray(raw)
        ? raw
        : ((raw as { withdrawals?: Withdrawal[] })?.withdrawals ?? []);
      setWithdrawals(arr);
    } catch (e) {
      if (e instanceof ApiError && e.code === ErrorCode.ABORTED) return; // unmounted
      // Silent — UI shows empty state rather than a transient toast.
      // Errors still surface via runtime telemetry for ops.
    } finally {
      if (!ctrl.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      // unmount → cancel any pending request, prevent setState on dead screen.
      if (ctrlRef.current) ctrlRef.current.abort();
    };
  }, [load]);

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { Alert.alert('Invalid amount'); return; }
    if (wallet && amt > wallet.available_balance + 0.001) {
      Alert.alert('Insufficient balance', `Available: ${fmt(wallet.available_balance)}`);
      return;
    }

    setSubmitting(true);
    const idempotencyKey = makeIdempotencyKey();
    try {
      await runtime.post(
        '/api/developer/withdraw',
        { amount: amt, method, destination },
        {
          // Hard-policy capability — runtime gate will throw CAPABILITY_OFFLINE
          // BEFORE the network call if payment.mode != 'live'.
          capability: 'payment',
          // Mandatory for any payment-class POST: server collapses retries.
          idempotencyKey,
          // Retries here are SAFE because of idempotencyKey — server will
          // not double-charge even if backoff retries fire.
          retries: 1,
        },
      );
      setOpen(false); setAmount(''); setDestination('');
      await load();

      // Mock honesty: if the manifest says payment is in mock mode, do NOT
      // pretend a real withdrawal happened. UI explicitly tells the user.
      if (paymentMode?.mode === 'mock') {
        Alert.alert(
          'MOCK withdrawal recorded',
          'Payment integration is in MOCK mode — no real funds moved. ' +
          'Ask an admin to enable a live provider in /admin/integrations.',
        );
      } else {
        Alert.alert('Withdraw requested', 'Admin will approve and pay out shortly.');
      }
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === ErrorCode.CAPABILITY_OFFLINE) {
          // Hard gate fired — payment integration not live.
          Alert.alert(
            'Payments offline',
            e.hint || 'Payment integration is not active. Ask an admin to enable it.',
          );
        } else if (e.isAuthExpired) {
          // adapter.onAuthExpired already cleared the token. The /auth screen
          // will pick this up via the runtime.onAuthExpired listener wired in
          // src/runtime/index.ts. We just stop here.
          Alert.alert('Session expired', 'Please sign in again.');
        } else {
          Alert.alert('Request failed', `${e.message} (req: ${e.requestId})`);
        }
      } else {
        Alert.alert('Request failed', 'Try again');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <SafeAreaView style={[s.flex, s.center]}><ActivityIndicator color={T.primary} /></SafeAreaView>;
  }
  const w = wallet || { earned_lifetime: 0, available_balance: 0, pending_withdrawal: 0, withdrawn_lifetime: 0, history: [], user_id: '' };
  const isMock = paymentMode?.mode === 'mock';
  const isOffline = paymentMode && paymentMode.mode !== 'live';

  const cancelWithdrawal = (wd: Withdrawal) => {
    Alert.alert(
      'Cancel withdrawal?',
      `${fmt(wd.amount)} will be released back to your available balance.`,
      [
        { text: 'Keep request', style: 'cancel' },
        {
          text: 'Cancel request',
          style: 'destructive',
          onPress: async () => {
            setCancellingId(wd.withdrawal_id);
            try {
              await runtime.post(
                `/api/developer/withdrawals/${wd.withdrawal_id}/cancel`,
                {},
                { idempotencyKey: `cancel-wd:${wd.withdrawal_id}` },
              );
              await load();
            } catch (e) {
              const msg = e instanceof ApiError ? (e.hint || e.message) : 'Failed';
              Alert.alert('Could not cancel', msg);
            } finally {
              setCancellingId(null);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={s.flex} edges={['top']} testID="dev-wallet-screen">
      <ScrollView
        style={s.flex}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={T.primary} />}
      >
        <Text style={s.h1}>Wallet</Text>
        <Text style={s.subhead}>You earn when a module is approved by the client.</Text>

        {/* Capability badge — hard truth from manifest, never fake-live. */}
        {isOffline && (
          <View style={s.modeBadge} testID="payment-mode-badge">
            <Ionicons name="alert-circle" size={14} color={isMock ? T.warning : T.danger} />
            <Text style={[s.modeBadgeText, { color: isMock ? T.warning : T.danger }]}>
              PAYMENT MODE: {paymentMode?.mode?.toUpperCase()}
            </Text>
          </View>
        )}

        {/* Hero — Available */}
        <View style={s.hero} testID="wallet-hero">
          <Text style={s.heroLabel}>AVAILABLE TO WITHDRAW</Text>
          <Text style={s.heroAmount} testID="wallet-available">{fmt(w.available_balance)}</Text>
          <TouchableOpacity
            disabled={w.available_balance <= 0}
            onPress={() => setOpen(true)}
            style={[s.cta, w.available_balance <= 0 && { opacity: 0.5 }]}
            testID="wallet-withdraw-btn"
          >
            <Ionicons name="arrow-up-circle" size={18} color={T.primaryInk} />
            <Text style={s.ctaText}>Withdraw</Text>
          </TouchableOpacity>
        </View>

        {/* Stats grid */}
        <View style={s.statRow}>
          <Stat label="Pending" value={fmt(w.pending_withdrawal)} sub="In admin queue" testID="wallet-pending" />
          <Stat label="Earned" value={fmt(w.earned_lifetime)} sub="Lifetime" testID="wallet-earned" />
          <Stat label="Withdrawn" value={fmt(w.withdrawn_lifetime)} sub="Lifetime" testID="wallet-withdrawn" />
        </View>

        {/* Withdrawals history */}
        <Text style={s.sectionLabel}>WITHDRAWAL REQUESTS</Text>
        {withdrawals.length === 0 ? (
          <View style={s.emptyCard}><Text style={s.emptyText}>No withdrawals yet</Text></View>
        ) : (
          withdrawals.map((wd) => (
            <View key={wd.withdrawal_id} style={s.row} testID={`withdrawal-row-${wd.withdrawal_id}`}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{fmt(wd.amount)}</Text>
                <Text style={s.rowMeta}>
                  {dateStr(wd.created_at)} · {wd.method || 'manual'}
                </Text>
              </View>
              <Pill status={wd.status} />
              {wd.status === 'requested' && (
                <TouchableOpacity
                  style={s.cancelBtn}
                  testID={`withdrawal-cancel-${wd.withdrawal_id}`}
                  onPress={() => cancelWithdrawal(wd)}
                  disabled={cancellingId === wd.withdrawal_id}
                >
                  {cancellingId === wd.withdrawal_id
                    ? <ActivityIndicator color={T.danger} size="small" />
                    : <Text style={s.cancelBtnText}>Cancel</Text>}
                </TouchableOpacity>
              )}
            </View>
          ))
        )}

        {/* Earnings history */}
        <Text style={s.sectionLabel}>EARNINGS HISTORY</Text>
        {w.history.length === 0 ? (
          <View style={s.emptyCard}><Text style={s.emptyText}>No earnings yet — finish + approve a module to get paid</Text></View>
        ) : (
          w.history.map((h) => (
            <View key={h.log_id} style={s.row} testID={`earning-row-${h.log_id}`}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>+{fmt(h.amount)}</Text>
                <Text style={s.rowMeta}>{dateStr(h.created_at)} · {h.reason.replace(/_/g, ' ')}</Text>
              </View>
              <Ionicons name="checkmark-circle" size={20} color={T.primary} />
            </View>
          ))
        )}
      </ScrollView>

      {/* Withdraw modal */}
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={s.modalOverlay}
        >
          <View style={s.modalCard} testID="withdraw-modal">
            <Text style={s.modalTitle}>Withdraw funds</Text>
            <Text style={s.modalSub}>Available: {fmt(w.available_balance)}</Text>
            {isMock && (
              <Text style={s.mockNotice} testID="withdraw-mock-notice">
                MOCK MODE — submitting will record a request, not move real funds.
              </Text>
            )}

            <Text style={s.inputLabel}>AMOUNT</Text>
            <TextInput
              testID="withdraw-amount-input"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={T.textMuted}
              style={s.input}
            />

            <Text style={s.inputLabel}>METHOD</Text>
            <View style={s.methodRow}>
              {(['bank', 'crypto', 'manual'] as const).map((m) => (
                <TouchableOpacity
                  key={m}
                  onPress={() => setMethod(m)}
                  style={[s.methodChip, method === m && s.methodChipActive]}
                  testID={`withdraw-method-${m}`}
                >
                  <Text style={[s.methodChipText, method === m && s.methodChipTextActive]}>
                    {m.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.inputLabel}>{method === 'crypto' ? 'WALLET ADDRESS' : 'IBAN / DESTINATION'}</Text>
            <TextInput
              testID="withdraw-destination-input"
              value={destination}
              onChangeText={setDestination}
              placeholder={method === 'crypto' ? '0x…' : 'IBAN UA00…'}
              placeholderTextColor={T.textMuted}
              autoCapitalize="characters"
              style={s.input}
            />

            <View style={s.modalActions}>
              <TouchableOpacity
                onPress={() => setOpen(false)}
                style={s.btnGhost}
                testID="withdraw-cancel"
              >
                <Text style={s.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={submit}
                disabled={submitting}
                style={[s.cta, { flex: 1 }]}
                testID="withdraw-submit"
              >
                {submitting
                  ? <ActivityIndicator color={T.primaryInk} />
                  : <Text style={s.ctaText}>Request withdraw</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function Stat({ label, value, sub, testID }: { label: string; value: string; sub: string; testID?: string }) {
  return (
    <View style={s.statCard} testID={testID}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statSub}>{sub}</Text>
    </View>
  );
}

function Pill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    requested: { bg: T.warningBg, color: T.warning, label: 'Requested' },
    approved:  { bg: T.primaryBg, color: T.primary, label: 'Approved' },
    paid:      { bg: T.successBg, color: T.success, label: 'Paid' },
    rejected:  { bg: T.dangerBg, color: T.danger, label: 'Rejected' },
  };
  const it = map[status] || { bg: T.surface2, color: T.textMuted, label: status };
  return (
    <View style={[s.pill, { backgroundColor: it.bg }]}>
      <Text style={[s.pillText, { color: it.color }]}>{it.label.toUpperCase()}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: T.lg, paddingBottom: T.xl * 2 },

  h1: { color: T.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  subhead: { color: T.textMuted, fontSize: T.body, marginTop: 4, marginBottom: T.lg },

  modeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    marginBottom: T.md,
  },
  modeBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },

  hero: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.lg, marginBottom: T.md, alignItems: 'center',
  },
  heroLabel: { color: T.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 4 },
  heroAmount: { color: T.text, fontSize: 48, fontWeight: '800', letterSpacing: -1.2, marginVertical: 8 },

  cta: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: T.primary, borderRadius: T.radiusSm, paddingVertical: 14, paddingHorizontal: 28,
    marginTop: 6,
  },
  ctaText: { color: T.primaryInk, fontWeight: '800', fontSize: T.body },

  statRow: { flexDirection: 'row', gap: 8, marginBottom: T.lg },
  statCard: { flex: 1, backgroundColor: T.surface1, borderRadius: T.radiusSm, padding: T.sm, borderWidth: 1, borderColor: T.border },
  statLabel: { color: T.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  statValue: { color: T.text, fontSize: T.h3, fontWeight: '800', marginTop: 4 },
  statSub: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },

  sectionLabel: { color: T.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginTop: T.lg, marginBottom: T.sm },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.sm, marginBottom: 6, borderWidth: 1, borderColor: T.border,
  },
  rowTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  rowMeta: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },

  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },

  emptyCard: {
    backgroundColor: T.surface1, borderRadius: T.radiusSm, padding: T.md,
    borderWidth: 1, borderColor: T.border, alignItems: 'center',
  },
  emptyText: { color: T.textMuted, fontSize: T.small },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: T.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: T.lg, paddingBottom: T.xl,
    borderTopWidth: 1, borderColor: T.border,
  },
  modalTitle: { color: T.text, fontSize: T.h2, fontWeight: '800' },
  modalSub: { color: T.textMuted, fontSize: T.small, marginTop: 4, marginBottom: T.lg },
  mockNotice: {
    color: T.warning, fontSize: T.tiny, fontWeight: '700',
    marginTop: -T.md, marginBottom: T.md, letterSpacing: 0.5,
  },
  inputLabel: { color: T.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 6, marginTop: T.sm },
  input: {
    backgroundColor: T.surface1, color: T.text, fontSize: T.h3, fontWeight: '700',
    borderRadius: T.radiusSm, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: T.border,
  },
  methodRow: { flexDirection: 'row', gap: 8 },
  methodChip: {
    flex: 1, paddingVertical: 10, borderRadius: T.radiusSm,
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border, alignItems: 'center',
  },
  methodChipActive: { backgroundColor: T.primary, borderColor: T.primary },
  methodChipText: { color: T.textMuted, fontWeight: '800', fontSize: T.tiny, letterSpacing: 1 },
  methodChipTextActive: { color: T.primaryInk },

  modalActions: { flexDirection: 'row', gap: 8, marginTop: T.lg },
  btnGhost: { paddingVertical: 14, paddingHorizontal: 22, borderRadius: T.radiusSm, borderWidth: 1, borderColor: T.border },
  btnGhostText: { color: T.text, fontWeight: '700' },
  cancelBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: T.radiusSm, borderWidth: 1, borderColor: T.danger,
    marginLeft: 8,
  },
  cancelBtnText: { color: T.danger, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
});
