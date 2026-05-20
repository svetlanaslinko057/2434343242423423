/**
 * Admin · QA — quick decision surface (item-contract v1).
 *
 * Source: GET /api/admin/mobile/qa
 * Item:   { id, title, subtitle, status, created_at, meta, primary_action,
 *           actions[], web_url }
 *
 * Actions:
 *   POST /api/admin/mobile/qa/{id}/approve
 *   POST /api/admin/mobile/qa/{id}/revision
 *   POST /api/admin/mobile/qa/{id}/reject
 *
 * On 409 (already decided) — list refreshes. No double payouts.
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

type QaItem = {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  created_at: string | null;
  meta: {
    client_price: number;
    revision_count: number;
    project_id: string | null;
    developer_id: string | null;
  };
  primary_action: 'approve' | 'revision' | 'reject';
  actions: Array<'approve' | 'revision' | 'reject'>;
  web_url: string;
};

type QaResp = {
  items: QaItem[];
  summary: { pending: number; has_more: boolean };
  generated_at: string;
};

const ACTION_LABELS = {
  approve: { confirm: 'Approve module?', verb: 'Approve' },
  revision: { confirm: 'Send to revision?', verb: 'Revision' },
  reject: { confirm: 'Reject module?', verb: 'Reject' },
} as const;

export default function AdminQA() {
  const [data, setData] = useState<QaResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const r = await api.get<QaResp>('/admin/mobile/qa');
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

  const decide = (item: QaItem, action: 'approve' | 'revision' | 'reject') => {
    Alert.alert(ACTION_LABELS[action].confirm, item.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        style: action === 'reject' ? 'destructive' : 'default',
        onPress: async () => {
          setBusy(item.id);
          try {
            await api.post(`/admin/mobile/qa/${item.id}/${action}`, {});
            await load();
          } catch (e: any) {
            const detail = e?.response?.data?.detail;
            if (e?.response?.status === 409) {
              const msg = typeof detail === 'object'
                ? `${detail.message} (current: ${detail.current_status})`
                : detail || 'Already decided';
              Alert.alert('Already decided', msg, [{ text: 'OK', onPress: () => load() }]);
            } else if (e?.response?.status === 500 && typeof detail === 'string'
                       && detail.includes('Reward')) {
              Alert.alert('Payment failed', 'Decision was rolled back. Please retry or open in web.');
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
      <Stack.Screen options={{ title: 'Admin · QA' }} />
      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} />}
        testID="admin-qa-screen"
      >
        <Text style={s.h1}>QA</Text>
        <Text style={s.subtitle}>One-tap decisions on pending modules</Text>

        {loading && <View style={s.center}><ActivityIndicator color={T.primary} /></View>}

        {err && !loading && (
          <View style={s.errBox}>
            <Text style={s.errText}>{err}</Text>
            <TouchableOpacity style={s.retry} onPress={() => { setLoading(true); void load(); }}>
              <Text style={s.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {data && data.items.length === 0 && !loading && (
          <View style={s.allClear}>
            <Ionicons name="checkmark-done" size={28} color={T.success} />
            <Text style={s.allClearText}>QA queue is empty</Text>
            <Text style={s.allClearSub}>Nothing waiting for review.</Text>
          </View>
        )}

        {data && data.items.length > 0 && (
          <View style={s.list}>
            {data.items.map((item) => (
              <View key={item.id} style={s.card} testID={`qa-card-${item.id}`}>
                <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
                <Text style={s.cardSubtitle}>{item.subtitle}</Text>
                <View style={s.metaRow}>
                  {item.meta.client_price > 0 && (
                    <Text style={s.cardPrice}>${Math.round(item.meta.client_price)}</Text>
                  )}
                  {item.meta.revision_count > 0 && (
                    <View style={s.revBadge}>
                      <Text style={s.revBadgeText}>R{item.meta.revision_count}</Text>
                    </View>
                  )}
                </View>

                <View style={s.actionsRow}>
                  {item.actions.includes('approve') && (
                    <TouchableOpacity
                      style={[s.actionBtn, s.btnApprove]}
                      onPress={() => decide(item, 'approve')}
                      disabled={busy === item.id}
                      testID={`qa-approve-${item.id}`}
                    >
                      <Text style={s.btnApproveText}>Approve</Text>
                    </TouchableOpacity>
                  )}
                  {item.actions.includes('revision') && (
                    <TouchableOpacity
                      style={[s.actionBtn, s.btnRevision]}
                      onPress={() => decide(item, 'revision')}
                      disabled={busy === item.id}
                      testID={`qa-revision-${item.id}`}
                    >
                      <Text style={s.btnRevisionText}>Revision</Text>
                    </TouchableOpacity>
                  )}
                  {item.actions.includes('reject') && (
                    <TouchableOpacity
                      style={[s.actionBtn, s.btnReject]}
                      onPress={() => decide(item, 'reject')}
                      disabled={busy === item.id}
                      testID={`qa-reject-${item.id}`}
                    >
                      <Text style={s.btnRejectText}>Reject</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <TouchableOpacity
                  style={s.webLink}
                  onPress={() => Linking.openURL(item.web_url)}
                  testID={`qa-web-${item.id}`}
                >
                  <Ionicons name="open-outline" size={14} color={T.primary} />
                  <Text style={s.webLinkText}>Open in web admin</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
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

  allClear: { backgroundColor: T.surface1, borderRadius: T.radius, borderWidth: 1, borderColor: T.border, padding: T.xl, alignItems: 'center', gap: T.xs, marginTop: T.md },
  allClearText: { color: T.text, fontSize: T.h3, fontWeight: '700', marginTop: T.xs },
  allClearSub: { color: T.textSecondary, fontSize: T.body },

  list: { gap: T.sm },
  card: { backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border, borderRadius: T.radius, padding: T.md, gap: 4 },
  cardTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  cardSubtitle: { color: T.textSecondary, fontSize: T.small },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: T.sm, marginTop: T.xs },
  cardPrice: { color: T.primary, fontSize: T.body, fontWeight: '800' },
  revBadge: { backgroundColor: T.riskBgStrong, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  revBadgeText: { color: T.risk, fontSize: T.tiny, fontWeight: '800' },

  actionsRow: { flexDirection: 'row', gap: T.sm, marginTop: T.md },
  actionBtn: { flex: 1, paddingVertical: T.sm, borderRadius: T.radiusSm, alignItems: 'center', borderWidth: 1 },
  btnApprove: { backgroundColor: T.success, borderColor: T.success },
  btnApproveText: { color: T.bg, fontWeight: '800', fontSize: T.small },
  btnRevision: { backgroundColor: T.surface2, borderColor: T.risk },
  btnRevisionText: { color: T.risk, fontWeight: '800', fontSize: T.small },
  btnReject: { backgroundColor: T.surface2, borderColor: T.danger },
  btnRejectText: { color: T.danger, fontWeight: '800', fontSize: T.small },

  webLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: T.sm, paddingTop: T.sm, borderTopWidth: 1, borderTopColor: T.border },
  webLinkText: { color: T.primary, fontSize: T.tiny, fontWeight: '700' },
});
