/**
 * Admin · FINANCE — withdrawals + payout batches (item-contract v1).
 *
 * Source: GET /api/admin/mobile/finance
 * Item:   { id, title, subtitle, status, created_at, meta, primary_action,
 *           actions[], web_url }
 *
 * SEMANTICS (fixed):
 *   withdrawal/approve  = "approved for inclusion in batch". NO money move.
 *   withdrawal/reject   = denied. Funds stay in dev's wallet.
 *   payout-batch/approve = REAL money movement. Confirms before action.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, Linking,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/api';
import T from '../../src/theme';

type FinanceItem = {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  created_at: string | null;
  meta: Record<string, any>;
  primary_action: string;
  actions: string[];
  web_url: string;
};

type FinanceResp = {
  withdrawals: FinanceItem[];
  payout_batches: FinanceItem[];
  summary: {
    withdrawals_pending: number;
    batches_pending: number;
    total_pending_amount: number;
  };
  generated_at: string;
};

export default function AdminFinance() {
  const [data, setData] = useState<FinanceResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const r = await api.get<FinanceResp>('/admin/mobile/finance');
      setData(r.data);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = () => { setRefreshing(true); void load(); };

  const handleAction = (
    id: string,
    confirmTitle: string,
    confirmMessage: string,
    danger: boolean,
    run: () => Promise<void>,
  ) => {
    Alert.alert(confirmTitle, confirmMessage, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        style: danger ? 'destructive' : 'default',
        onPress: async () => {
          setBusy(id);
          try {
            await run();
            await load();
          } catch (e: any) {
            const detail = e?.response?.data?.detail;
            if (e?.response?.status === 409) {
              const msg = typeof detail === 'object'
                ? `${detail.message} (current: ${detail.current_status})`
                : detail || 'Already processed';
              Alert.alert('Already processed', msg, [{ text: 'OK', onPress: () => load() }]);
            } else {
              Alert.alert('Failed', typeof detail === 'string' ? detail : 'Action failed');
            }
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Admin · Finance' }} />
      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} />}
        testID="admin-finance-screen"
      >
        <Text style={s.h1}>Finance</Text>
        <Text style={s.subtitle}>Approve withdrawals · payout batches</Text>

        {loading && <View style={s.center}><ActivityIndicator color={T.primary} /></View>}

        {err && !loading && (
          <View style={s.errBox}>
            <Text style={s.errText}>{err}</Text>
            <TouchableOpacity style={s.retry} onPress={() => { setLoading(true); void load(); }}>
              <Text style={s.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {data && (
          <>
            {/* Summary */}
            <View style={s.summaryCard}>
              <Text style={s.summaryLabel}>TOTAL PENDING</Text>
              <Text style={s.summaryAmount}>${Math.round(data.summary.total_pending_amount).toLocaleString()}</Text>
              <Text style={s.summaryMeta}>
                {data.summary.withdrawals_pending} withdrawal{data.summary.withdrawals_pending !== 1 ? 's' : ''}
                {' · '}{data.summary.batches_pending} batch{data.summary.batches_pending !== 1 ? 'es' : ''}
              </Text>
            </View>

            {data.withdrawals.length === 0 && data.payout_batches.length === 0 && !loading && (
              <View style={s.allClear}>
                <Ionicons name="checkmark-done" size={28} color={T.success} />
                <Text style={s.allClearText}>No pending finance actions</Text>
              </View>
            )}

            {/* Withdrawals — approve = "ready for batch", NOT money move */}
            {data.withdrawals.length > 0 && (
              <>
                <Text style={s.sectionLabel}>WITHDRAWALS · {data.withdrawals.length}</Text>
                <Text style={s.sectionHint}>Approve = allowed into next batch. No money moves yet.</Text>
                <View style={s.list}>
                  {data.withdrawals.map((w) => (
                    <View key={w.id} style={s.card} testID={`withdrawal-${w.id}`}>
                      <View style={s.cardHead}>
                        <Text style={s.cardTitle}>{w.title}</Text>
                      </View>
                      <Text style={s.cardSubtitle}>{w.subtitle}</Text>
                      <View style={s.actionsRow}>
                        {w.actions.includes('approve') && (
                          <TouchableOpacity
                            style={[s.actionBtn, s.btnApprove]}
                            disabled={busy === w.id}
                            onPress={() => handleAction(
                              w.id,
                              'Allow into batch?',
                              `${w.title} · No funds will move yet.`,
                              false,
                              () => api.post(`/admin/mobile/withdrawals/${w.id}/approve`, {}),
                            )}
                            testID={`withdrawal-approve-${w.id}`}
                          >
                            <Text style={s.btnApproveText}>Approve</Text>
                          </TouchableOpacity>
                        )}
                        {w.actions.includes('reject') && (
                          <TouchableOpacity
                            style={[s.actionBtn, s.btnReject]}
                            disabled={busy === w.id}
                            onPress={() => handleAction(
                              w.id,
                              'Reject withdrawal?',
                              `${w.title} · Funds stay in wallet.`,
                              true,
                              () => api.post(`/admin/mobile/withdrawals/${w.id}/reject`, {}),
                            )}
                            testID={`withdrawal-reject-${w.id}`}
                          >
                            <Text style={s.btnRejectText}>Reject</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      <TouchableOpacity
                        style={s.webLink}
                        onPress={() => Linking.openURL(w.web_url)}
                        testID={`withdrawal-web-${w.id}`}
                      >
                        <Ionicons name="open-outline" size={14} color={T.primary} />
                        <Text style={s.webLinkText}>Open in web admin</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* Payout batches — REAL money move. Bigger confirm. */}
            {data.payout_batches.length > 0 && (
              <>
                <Text style={s.sectionLabel}>PAYOUT BATCHES · {data.payout_batches.length}</Text>
                <Text style={[s.sectionHint, { color: T.danger }]}>
                  ⚠ Approving a batch dispatches real payouts.
                </Text>
                <View style={s.list}>
                  {data.payout_batches.map((b) => (
                    <View key={b.id} style={[s.card, s.cardDanger]} testID={`batch-${b.id}`}>
                      <View style={s.cardHead}>
                        <Text style={s.cardTitle}>{b.title}</Text>
                      </View>
                      <Text style={s.cardSubtitle}>{b.subtitle}</Text>
                      <Text style={s.cardAmount}>
                        ${Math.round(b.meta.amount_total || 0).toLocaleString()}
                      </Text>
                      {b.actions.includes('approve_batch') && (
                        <TouchableOpacity
                          style={[s.actionBtn, s.btnDanger, { marginTop: T.md }]}
                          disabled={busy === b.id}
                          onPress={() => handleAction(
                            b.id,
                            '⚠ Real payout',
                            `Dispatch $${Math.round(b.meta.amount_total).toLocaleString()} to ${b.meta.developer_count} developers? This moves real money.`,
                            true,
                            () => api.post(`/admin/mobile/payout-batches/${b.id}/approve`, {}),
                          )}
                          testID={`batch-approve-${b.id}`}
                        >
                          <Text style={s.btnDangerText}>Approve & dispatch</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={s.webLink}
                        onPress={() => Linking.openURL(b.web_url)}
                        testID={`batch-web-${b.id}`}
                      >
                        <Ionicons name="open-outline" size={14} color={T.primary} />
                        <Text style={s.webLinkText}>Open in web admin</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md, paddingBottom: T.xxl * 2 },
  h1: { color: T.text, fontSize: T.h1, fontWeight: '800' },
  subtitle: { color: T.textSecondary, fontSize: T.small, marginTop: 2, marginBottom: T.lg },
  center: { paddingVertical: T.xxl, alignItems: 'center' },
  errBox: { backgroundColor: T.dangerTint, borderWidth: 1, borderColor: T.dangerBorder, borderRadius: T.radius, padding: T.md, gap: T.sm },
  errText: { color: T.danger, fontSize: T.body, fontWeight: '600' },
  retry: { alignSelf: 'flex-start', paddingHorizontal: T.md, paddingVertical: T.sm, backgroundColor: T.surface2, borderRadius: T.radiusSm },
  retryText: { color: T.text, fontWeight: '700' },

  summaryCard: { backgroundColor: T.surface1, borderWidth: 1, borderColor: T.primaryBorder, borderRadius: T.radius, padding: T.md, marginBottom: T.md, alignItems: 'center' },
  summaryLabel: { color: T.primary, fontSize: T.tiny, fontWeight: '800', letterSpacing: 1.4 },
  summaryAmount: { color: T.text, fontSize: 36, fontWeight: '800', marginTop: T.xs },
  summaryMeta: { color: T.textSecondary, fontSize: T.small, marginTop: 4 },

  allClear: { backgroundColor: T.surface1, borderRadius: T.radius, borderWidth: 1, borderColor: T.border, padding: T.xl, alignItems: 'center', gap: T.xs },
  allClearText: { color: T.text, fontSize: T.h3, fontWeight: '700', marginTop: T.xs },

  sectionLabel: { color: T.textMuted, fontSize: T.tiny, fontWeight: '800', letterSpacing: 1.4, marginBottom: T.xs, marginTop: T.md },
  sectionHint: { color: T.textSecondary, fontSize: T.tiny, marginBottom: T.sm, fontStyle: 'italic' },
  list: { gap: T.sm },
  card: { backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border, borderRadius: T.radius, padding: T.md, gap: 4 },
  cardDanger: { borderColor: T.dangerBorder },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  cardSubtitle: { color: T.textSecondary, fontSize: T.small, textTransform: 'capitalize' },
  cardAmount: { color: T.primary, fontSize: T.h2, fontWeight: '800', marginTop: T.xs },

  actionsRow: { flexDirection: 'row', gap: T.sm, marginTop: T.md },
  actionBtn: { flex: 1, paddingVertical: T.sm, borderRadius: T.radiusSm, alignItems: 'center', borderWidth: 1 },
  btnApprove: { backgroundColor: T.success, borderColor: T.success },
  btnApproveText: { color: T.bg, fontWeight: '800', fontSize: T.small },
  btnReject: { backgroundColor: T.surface2, borderColor: T.danger },
  btnRejectText: { color: T.danger, fontWeight: '800', fontSize: T.small },
  btnDanger: { backgroundColor: T.danger, borderColor: T.danger },
  btnDangerText: { color: T.bg, fontWeight: '800', fontSize: T.body },

  webLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: T.sm, paddingTop: T.sm, borderTopWidth: 1, borderTopColor: T.border },
  webLinkText: { color: T.primary, fontSize: T.tiny, fontWeight: '700' },
});
