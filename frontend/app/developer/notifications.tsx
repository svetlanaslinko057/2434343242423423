/**
 * Developer Notifications — full inbox of system events.
 *
 * GET  /api/notifications/my?limit=50          → all + unread metadata
 * POST /api/notifications/mark-read            → ack
 * POST /api/notifications/read-all             → bulk
 *
 * NotificationPoller (toast layer) only shows transient flashes; this is
 * the permanent record so developers can scroll back through events that
 * fired while the app was closed.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { runtime } from '../../src/runtime';
import T from '../../src/theme';

type Notification = {
  notification_id: string;
  type: string;
  title?: string;
  subtitle?: string;
  module_id?: string;
  project_id?: string;
  read: boolean;
  created_at: string;
};

const ICON_FOR_TYPE: Record<string, string> = {
  review_required: 'alert-circle',
  review_ready: 'hourglass',
  module_done: 'checkmark-circle',
  module_paused: 'pause-circle',
  qa_failed: 'close-circle',
  payout_approved: 'cash',
  payout_paid: 'wallet',
  task_assigned: 'briefcase',
  task_overdue: 'time',
  message: 'chatbubble',
};

const TONE_FOR_TYPE: Record<string, string> = {
  review_required: T.warning,
  review_ready: T.info,
  module_done: T.success,
  module_paused: T.danger,
  qa_failed: T.danger,
  payout_approved: T.success,
  payout_paid: T.success,
  task_assigned: T.primary,
  task_overdue: T.danger,
  message: T.primary,
};

const FILTERS = [
  { key: 'all',    label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'work',   label: 'Work' },
  { key: 'money',  label: 'Money' },
] as const;

type FilterKey = typeof FILTERS[number]['key'];

const FILTER_TYPES: Record<FilterKey, string[]> = {
  all: [],
  unread: [],
  work: ['review_required', 'review_ready', 'module_done', 'module_paused', 'qa_failed', 'task_assigned', 'task_overdue'],
  money: ['payout_approved', 'payout_paid'],
};

export default function DeveloperNotifications() {
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await runtime.get<{ notifications: Notification[]; count?: number }>(
        '/api/notifications/my?limit=50',
      );
      setItems(r.data?.notifications || []);
    } catch {
      /* keep current */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id: string) => {
    try {
      await runtime.post('/api/notifications/mark-read', { notification_ids: [id], all: false });
      setItems(prev => prev.map(n => n.notification_id === id ? { ...n, read: true } : n));
    } catch {
      /* keep state */
    }
  };

  const markAllRead = async () => {
    setMarking(true);
    try {
      await runtime.post('/api/notifications/mark-read', { notification_ids: [], all: true });
      setItems(prev => prev.map(n => ({ ...n, read: true })));
    } catch {
      /* keep state */
    } finally {
      setMarking(false);
    }
  };

  const open = (n: Notification) => {
    if (!n.read) markRead(n.notification_id);
    if (n.module_id) router.push(`/developer/module/${n.module_id}` as any);
    else if (n.type === 'message') router.push('/chat' as any);
  };

  const filtered = items.filter(n => {
    if (filter === 'all') return true;
    if (filter === 'unread') return !n.read;
    return FILTER_TYPES[filter].includes(n.type);
  });

  const unreadCount = items.filter(n => !n.read).length;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={s.flex} edges={['top']}>
        <ScrollView
          style={s.flex}
          contentContainerStyle={s.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={T.primary} />}
          testID="developer-notifications"
        >
          <View style={s.head}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="notifications-back">
              <Ionicons name="chevron-back" size={24} color={T.text} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={s.h1}>Notifications</Text>
              <Text style={s.subtitle}>
                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              </Text>
            </View>
            {unreadCount > 0 && (
              <TouchableOpacity
                style={s.markAllBtn}
                onPress={markAllRead}
                disabled={marking}
                testID="mark-all-read"
              >
                {marking
                  ? <ActivityIndicator color={T.primary} size="small" />
                  : <Text style={s.markAllText}>Mark all read</Text>}
              </TouchableOpacity>
            )}
          </View>

          {/* Filter pills */}
          <View style={s.filters}>
            {FILTERS.map(f => (
              <TouchableOpacity
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[s.filterPill, filter === f.key && s.filterPillActive]}
                testID={`notifications-filter-${f.key}`}
              >
                <Text style={[s.filterPillText, filter === f.key && s.filterPillTextActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {loading && (
            <View style={s.center}><ActivityIndicator color={T.primary} /></View>
          )}

          {!loading && filtered.length === 0 && (
            <View style={s.empty} testID="notifications-empty">
              <Ionicons name="notifications-off-outline" size={36} color={T.textMuted} />
              <Text style={s.emptyTitle}>
                {filter === 'unread' ? 'No unread events' : 'No notifications yet'}
              </Text>
              <Text style={s.emptySub}>
                When something needs your attention, it will land here.
              </Text>
            </View>
          )}

          {filtered.map(n => {
            const icon = ICON_FOR_TYPE[n.type] || 'notifications';
            const tone = TONE_FOR_TYPE[n.type] || T.primary;
            return (
              <TouchableOpacity
                key={n.notification_id}
                style={[s.row, !n.read && s.rowUnread]}
                onPress={() => open(n)}
                activeOpacity={0.85}
                testID={`notification-${n.notification_id}`}
              >
                <View style={[s.iconBox, { backgroundColor: tone + '22' }]}>
                  <Ionicons name={icon as any} size={18} color={tone} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowTitle, !n.read && { fontWeight: '800' }]} numberOfLines={1}>
                    {n.title || n.type.replace(/_/g, ' ')}
                  </Text>
                  {n.subtitle && (
                    <Text style={s.rowSub} numberOfLines={2}>{n.subtitle}</Text>
                  )}
                  <Text style={s.rowTime}>
                    {new Date(n.created_at).toLocaleString()}
                  </Text>
                </View>
                {!n.read && <View style={s.unreadDot} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.lg, paddingBottom: T.xl * 2 },
  center: { paddingVertical: T.xl, alignItems: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: T.sm, marginBottom: T.lg },
  backBtn: { width: 32, height: 32, alignItems: 'flex-start', justifyContent: 'center' },
  h1: { color: T.text, fontSize: T.h1, fontWeight: '800' },
  subtitle: { color: T.textMuted, fontSize: T.small, marginTop: 2 },
  markAllBtn: {
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    borderRadius: T.radiusSm,
  },
  markAllText: { color: T.primary, fontWeight: '700', fontSize: 12 },

  filters: { flexDirection: 'row', gap: 6, marginBottom: T.lg },
  filterPill: {
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    borderRadius: 999,
  },
  filterPillActive: { backgroundColor: T.primary, borderColor: T.primary },
  filterPillText: { color: T.textMuted, fontSize: 11, fontWeight: '700' },
  filterPillTextActive: { color: T.primaryInk },

  empty: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.xl, alignItems: 'center', gap: 8, marginTop: T.lg,
  },
  emptyTitle: { color: T.text, fontWeight: '700', marginTop: 8 },
  emptySub: { color: T.textMuted, fontSize: 12, textAlign: 'center' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: T.md,
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.md, marginBottom: T.sm,
  },
  rowUnread: { borderColor: T.primaryBorder, backgroundColor: T.primaryBg },
  iconBox: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { color: T.text, fontSize: T.body, fontWeight: '600' },
  rowSub: { color: T.textSecondary, fontSize: 12, marginTop: 2 },
  rowTime: { color: T.textMuted, fontSize: 10, marginTop: 4 },
  unreadDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: T.primary,
  },
});
