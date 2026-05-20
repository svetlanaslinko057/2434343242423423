import { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from './api';
import { useAuth } from './auth';
import T from './theme';

/**
 * AlertsSheet — bottom sheet, max 7 items, sorted action → warning → info.
 *
 * Reads /client/alerts. Tap an item → close sheet → push /chat?msg=<id>
 * which lets the chat scroll straight to the right message.
 */
export type Alert = {
  id: string;
  type: 'action_required' | 'warning' | 'info';
  title: string;
  description?: string;
  project_id?: string | null;
  entity_id?: string | null;
  entity_type?: string;
  chat_message_id?: string;
};

const TYPE_META = {
  action_required: { label: 'Action required', icon: 'alert-circle', color: T.danger },
  warning:         { label: 'Attention',       icon: 'warning',       color: T.warning ?? '#F59E0B' },
  info:            { label: 'Updates',         icon: 'information-circle', color: T.info ?? T.primary },
} as const;

export function useAlerts() {
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState<Alert[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api.get('/client/alerts');
      const next: Alert[] = r.data?.items || [];
      setItems(next);
      setCount(r.data?.actionable_count || 0);
    } catch {
      setItems([]); setCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auth-gate the activation, not the request. Doctrine: behavior MUST NOT
  // begin existing before authorization context exists. <AppHeader> is
  // mounted globally (incl. guests) by design — but its alerts polling is
  // an authed-only behavior that previously inherited that mount authority
  // accidentally. See RUNTIME_SEMANTICS_INTERACTIONS.md cell I-1, and the
  // 2026-05-13 alerts 401-storm root-cause report.
  useEffect(() => {
    if (authLoading) return;          // auth state not yet resolved
    if (!user) {                       // guest — keep state empty, no polling
      setItems([]); setCount(0);
      return;
    }
    refresh();
    const t = setInterval(refresh, 30000); // gentle 30s poll
    return () => clearInterval(t);
  }, [refresh, user, authLoading]);

  return { items, count, loading, refresh };
}

export default function AlertsSheet({
  visible, onClose,
}: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const { items, loading, refresh } = useAlerts();

  useEffect(() => { if (visible) refresh(); }, [visible, refresh]);

  // Group by type, preserving the server-side priority sort.
  const grouped = (['action_required', 'warning', 'info'] as const).map((k) => ({
    key: k,
    meta: TYPE_META[k],
    list: items.filter((a) => a.type === k),
  })).filter((g) => g.list.length > 0);

  const handleTap = (a: Alert) => {
    onClose();
    setTimeout(() => {
      const msgId = a.chat_message_id || '';
      router.push(`/chat?msg=${encodeURIComponent(msgId)}` as any);
    }, 80);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity testID="alerts-backdrop" style={s.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={s.sheet} testID="alerts-sheet">
        <View style={s.handle} />
        <View style={s.headerRow}>
          <Text style={s.title}>Alerts</Text>
          <TouchableOpacity testID="alerts-close" onPress={onClose}>
            <Ionicons name="close" size={22} color={T.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          {loading && items.length === 0 ? (
            <View style={s.empty}><ActivityIndicator color={T.primary} /></View>
          ) : items.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="checkmark-circle" size={28} color={T.textMuted} />
              <Text style={s.emptyText}>You're all caught up.</Text>
            </View>
          ) : grouped.map((g) => (
            <View key={g.key} style={{ marginBottom: 16 }}>
              <View style={s.groupHead}>
                <Ionicons name={g.meta.icon as any} size={14} color={g.meta.color} />
                <Text style={[s.groupLabel, { color: g.meta.color }]}>{g.meta.label}</Text>
              </View>
              {g.list.map((a) => (
                <TouchableOpacity
                  key={a.id}
                  testID={`alert-item-${a.id}`}
                  style={s.row}
                  onPress={() => handleTap(a)}
                  activeOpacity={0.7}
                >
                  <View style={[s.dot, { backgroundColor: g.meta.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle} numberOfLines={2}>{a.title}</Text>
                    {a.description ? <Text style={s.rowDesc} numberOfLines={1}>{a.description}</Text> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: T.bg,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: T.lg, paddingTop: 8,
    height: '70%',
    borderTopWidth: 1, borderColor: T.border,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: T.border,
    alignSelf: 'center', marginBottom: 12,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { color: T.text, fontSize: T.h2, fontWeight: '800' },

  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  groupLabel: { fontSize: T.tiny, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: 12, marginBottom: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  rowDesc: { color: T.textMuted, fontSize: T.small, marginTop: 2 },

  empty: { paddingVertical: 32, alignItems: 'center', gap: 8 },
  emptyText: { color: T.textMuted, fontSize: T.small },
});
