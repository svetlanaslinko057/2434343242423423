/**
 * Admin · HOME — control panel (pult).
 *
 * Source: GET /api/admin/mobile/home
 * Contract v1: alerts (3 keys) · snapshot · quick_actions[] · advanced
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Linking,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/api';
import { useRealtime } from '../../src/realtime';
import T from '../../src/theme';

type HomeResp = {
  alerts: {
    qa_pending: number;
    withdrawals_pending: number;
    payout_batches_pending: number;
  };
  snapshot: {
    active_devs: number;
    active_modules: number;
    qa_pending: number;
  };
  quick_actions: Array<{
    key: string; label: string; count: number;
    route: string; web_url: string;
  }>;
  advanced: {
    overloaded_devs: number;
    blocked_modules: number;
    web_url: string;
  };
  generated_at: string;
};

/**
 * Operations tiles — entry points to the parity-expansion surfaces.
 * Single source of truth; if a tile is added to admin/_layout.tsx it
 * MUST also be added here (with a unique `id` for testID).
 */
const OPS_TILES: Array<{ id: string; label: string; icon: string; route: string }> = [
  { id: 'users',        label: 'Users',         icon: 'people-outline',           route: '/admin/users' },
  { id: 'team',         label: 'Team',          icon: 'pulse-outline',            route: '/admin/team' },
  { id: 'contracts',    label: 'Contracts',     icon: 'document-text-outline',    route: '/admin/contracts' },
  { id: 'templates',    label: 'Templates',     icon: 'layers-outline',           route: '/admin/templates' },
  { id: 'integrations', label: 'Integrations',  icon: 'extension-puzzle-outline', route: '/admin/integrations' },
  { id: 'inbox',        label: 'Inbox',         icon: 'mail-outline',             route: '/admin/inbox' },
  { id: 'marketplace',  label: 'Marketplace',   icon: 'star-outline',             route: '/admin/marketplace' },
  { id: 'master',       label: 'Master view',   icon: 'git-network-outline',      route: '/admin/master' },
];

export default function AdminHome() {
  const router = useRouter();
  const [data, setData] = useState<HomeResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Live system adjustments feed — holds the last 5 auto-rebalance events.
  // Kept deliberately neutral: no decay numbers, no "bad dev" framing.
  const [rebalances, setRebalances] = useState<Array<{
    module_id: string;
    module_title?: string;
    at?: string;
  }>>([]);

  useRealtime(['role:admin'], (event, payload) => {
    if (event === 'admin.auto_rebalanced' && payload) {
      setRebalances((prev) => [{
        module_id: payload.module_id,
        module_title: payload.module_title,
        at: payload.at || payload.timestamp,
      }, ...prev].slice(0, 5));
    }
  });

  const load = useCallback(async () => {
    try {
      setErr(null);
      const r = await api.get<HomeResp>('/admin/mobile/home');
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

  return (
    <>
      <Stack.Screen options={{ title: 'Admin · Control' }} />
      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} />}
        testID="admin-home-screen"
      >
        <Text style={s.h1}>Control</Text>
        <Text style={s.subtitle}>Pulse of the system</Text>

        {loading && (
          <View style={s.center}><ActivityIndicator color={T.primary} /></View>
        )}

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
            {/* Alerts grid — only money-actionable signals */}
            <Text style={s.sectionLabel}>ALERTS</Text>
            <View style={s.alertsGrid}>
              <AlertCard
                icon="checkmark-circle"
                label="QA pending"
                count={data.alerts.qa_pending}
                tone={data.alerts.qa_pending > 0 ? 'warn' : 'ok'}
                onPress={() => router.push('/admin/qa' as any)}
                testID="alert-qa"
              />
              <AlertCard
                icon="cash"
                label="Withdrawals"
                count={data.alerts.withdrawals_pending}
                tone={data.alerts.withdrawals_pending > 0 ? 'warn' : 'ok'}
                onPress={() => router.push('/admin/finance' as any)}
                testID="alert-withdrawals"
              />
              <AlertCard
                icon="layers"
                label="Payout batches"
                count={data.alerts.payout_batches_pending}
                tone={data.alerts.payout_batches_pending > 0 ? 'warn' : 'ok'}
                onPress={() => router.push('/admin/finance' as any)}
                testID="alert-batches"
              />
            </View>

            {/* Live system adjustments — realtime, neutral, no shaming */}
            {rebalances.length > 0 && (
              <View style={s.adjCard} testID="system-adjustments">
                <View style={s.adjHeader}>
                  <Ionicons name="flash" size={14} color={T.primary} />
                  <Text style={s.adjTitle}>System adjustments</Text>
                  <View style={s.adjLiveDot} />
                </View>
                {rebalances.map((r, i) => (
                  <Text key={`${r.module_id}-${i}`} style={s.adjItem} numberOfLines={1}>
                    • Module reassigned to keep progress stable
                  </Text>
                ))}
              </View>
            )}

            {/* Snapshot */}
            <Text style={s.sectionLabel}>SNAPSHOT</Text>
            <View style={s.snapshotBox}>
              <SnapRow label="Active developers" value={data.snapshot.active_devs} />
              <SnapRow label="Active modules" value={data.snapshot.active_modules} />
              <SnapRow label="QA pending" value={data.snapshot.qa_pending} highlight={data.snapshot.qa_pending > 0} />
            </View>

            {/* Quick actions — only when relevant */}
            {data.quick_actions.length > 0 && (
              <>
                <Text style={s.sectionLabel}>QUICK ACTIONS</Text>
                <View style={{ gap: T.sm }}>
                  {data.quick_actions.map((a) => (
                    <TouchableOpacity
                      key={a.key}
                      style={s.qaBtn}
                      onPress={() => router.push(a.route as any)}
                      testID={`qa-${a.key}`}
                    >
                      <Text style={s.qaText}>{a.label}</Text>
                      {a.count > 0 && (
                        <View style={s.qaBadge}>
                          <Text style={s.qaBadgeText}>{a.count}</Text>
                        </View>
                      )}
                      <Ionicons name="arrow-forward" size={18} color={T.bg} />
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {data.quick_actions.length === 0 && (
              <View style={s.allClear} testID="all-clear">
                <Ionicons name="checkmark-done" size={28} color={T.success} />
                <Text style={s.allClearText}>All clear</Text>
                <Text style={s.allClearSub}>Nothing pending right now.</Text>
              </View>
            )}

            {/* Advanced — system signals admin can investigate in web */}
            {(data.advanced.overloaded_devs > 0 || data.advanced.blocked_modules > 0) && (
              <>
                <Text style={s.sectionLabel}>ADVANCED · WEB</Text>
                <TouchableOpacity
                  style={s.advBox}
                  onPress={() => Linking.openURL(data.advanced.web_url)}
                  testID="advanced-card"
                >
                  <View style={s.advRow}>
                    <Ionicons name="flame" size={16} color={T.risk} />
                    <Text style={s.advLabel}>Overloaded devs</Text>
                    <Text style={s.advValue}>{data.advanced.overloaded_devs}</Text>
                  </View>
                  <View style={s.advRow}>
                    <Ionicons name="close-circle" size={16} color={T.danger} />
                    <Text style={s.advLabel}>Blocked modules</Text>
                    <Text style={s.advValue}>{data.advanced.blocked_modules}</Text>
                  </View>
                  <View style={s.advFooter}>
                    <Text style={s.advFooterText}>Open in web admin</Text>
                    <Ionicons name="open-outline" size={14} color={T.primary} />
                  </View>
                </TouchableOpacity>
              </>
            )}

            {/* Operations grid — parity expansion (May 2026, scope-freeze amend).
                Reaches the 8 deep-link surfaces wired in admin/_layout.tsx.
                Kept BELOW the alerts/quick actions so the cockpit-first
                principle still holds: admin sees signal first, drills only
                if needed. */}
            <Text style={s.sectionLabel}>OPERATIONS</Text>
            <View style={s.opsGrid} testID="admin-operations-grid">
              {OPS_TILES.map((t) => (
                <TouchableOpacity
                  key={t.route}
                  style={s.opsTile}
                  onPress={() => router.push(t.route as any)}
                  testID={`admin-ops-${t.id}`}
                  activeOpacity={0.85}
                >
                  <Ionicons name={t.icon as any} size={20} color={T.primary} />
                  <Text style={s.opsLabel} numberOfLines={1}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}

function AlertCard({
  icon, label, count, tone, onPress, testID,
}: {
  icon: any; label: string; count: number;
  tone: 'ok' | 'warn' | 'danger';
  onPress?: () => void; testID?: string;
}) {
  const color = tone === 'danger' ? T.danger : tone === 'warn' ? T.risk : T.success;
  return (
    <TouchableOpacity
      style={[s.alertCard, { borderColor: color + '55' }]}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.85}
      testID={testID}
    >
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[s.alertCount, { color }]}>{count}</Text>
      <Text style={s.alertLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function SnapRow({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={s.snapRow}>
      <Text style={s.snapLabel}>{label}</Text>
      <Text style={[s.snapValue, highlight && { color: T.risk }]}>{value}</Text>
    </View>
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

  sectionLabel: { color: T.textMuted, fontSize: T.tiny, fontWeight: '800', letterSpacing: 1.4, marginBottom: T.sm, marginTop: T.md },

  alertsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: T.sm },
  alertCard: {
    flexGrow: 1, flexBasis: '30%',
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius, padding: T.md, gap: 4,
  },
  alertCount: { fontSize: 28, fontWeight: '800', marginTop: T.xs },
  alertLabel: { color: T.textSecondary, fontSize: T.small, fontWeight: '600' },

  snapshotBox: { backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border, borderRadius: T.radius, padding: T.md, gap: T.sm },
  snapRow: { flexDirection: 'row', justifyContent: 'space-between' },
  snapLabel: { color: T.textSecondary, fontSize: T.body },
  snapValue: { color: T.text, fontSize: T.body, fontWeight: '700' },

  adjCard: {
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius, padding: T.md, marginTop: T.md, gap: 6,
  },
  adjHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  adjTitle: { color: T.text, fontSize: T.small, fontWeight: '800', letterSpacing: 0.3, flex: 1 },
  adjLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.primary, opacity: 0.9 },
  adjItem: { color: T.textSecondary, fontSize: T.small, lineHeight: 18 },

  qaBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: T.primary, borderRadius: T.radius,
    paddingVertical: T.md, paddingHorizontal: T.md, gap: T.sm,
  },
  qaText: { color: T.bg, fontSize: T.body, fontWeight: '800', flex: 1 },
  qaBadge: { backgroundColor: T.surface3, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  qaBadgeText: { color: T.bg, fontSize: T.tiny, fontWeight: '800' },

  allClear: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.xl, alignItems: 'center', gap: T.xs, marginTop: T.md,
  },
  allClearText: { color: T.text, fontSize: T.h3, fontWeight: '700', marginTop: T.xs },
  allClearSub: { color: T.textSecondary, fontSize: T.body },

  advBox: { backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border, borderRadius: T.radius, padding: T.md, gap: T.sm },
  advRow: { flexDirection: 'row', alignItems: 'center', gap: T.sm },
  advLabel: { color: T.textSecondary, fontSize: T.body, flex: 1 },
  advValue: { color: T.text, fontSize: T.body, fontWeight: '700' },
  advFooter: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: T.xs, paddingTop: T.sm, borderTopWidth: 1, borderTopColor: T.border },
  advFooterText: { color: T.primary, fontSize: T.small, fontWeight: '700' },

  // Operations grid — 4-up, drops to 2-up below ~480px through flexBasis.
  opsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: T.sm, marginTop: T.xs },
  opsTile: {
    flexGrow: 1, flexBasis: '22%',
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius, padding: T.md,
    alignItems: 'center', gap: 6, minHeight: 72,
  },
  opsLabel: { color: T.text, fontSize: T.tiny, fontWeight: '700', letterSpacing: 0.2 },
});
