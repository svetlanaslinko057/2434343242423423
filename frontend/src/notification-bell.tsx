/**
 * NotificationBell — tiny header widget with unread badge.
 *
 * Polls `/api/notifications/unread-count` on mount, then every 20s.
 * Tapping pushes to /developer/notifications (overridable via `href`).
 *
 * Keeps state local — `NotificationPoller` still drives toast events;
 * this component just renders the badge.
 */
import { useEffect, useState, useCallback } from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from './auth';
import api from './api';
import T from './theme';

type Props = { href?: string; testID?: string };

const POLL_MS = 20_000;

export default function NotificationBell({ href = '/developer/notifications', testID = 'notification-bell' }: Props) {
  const { user } = useAuth();
  const router = useRouter();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get('/notifications/unread-count');
      const n = Number(r?.data?.count ?? 0);
      setCount(Number.isFinite(n) ? n : 0);
    } catch {
      /* keep last known */
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    refresh();
    const iv = setInterval(refresh, POLL_MS);
    return () => clearInterval(iv);
  }, [user, refresh]);

  return (
    <TouchableOpacity
      style={s.btn}
      onPress={() => router.push(href as any)}
      testID={testID}
      activeOpacity={0.75}
    >
      <Ionicons name="notifications-outline" size={22} color={T.text} />
      {count > 0 && (
        <View style={s.badge} testID={`${testID}-badge`}>
          <Text style={s.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  btn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    alignItems: 'center', justifyContent: 'center',
  },
  badge: {
    position: 'absolute', top: -2, right: -2,
    minWidth: 18, height: 18, paddingHorizontal: 4,
    borderRadius: 9, backgroundColor: T.danger,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: T.bg,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
