// Home → Decision Hub
//
// Top-of-home block that lists every deliverable currently in `pending_approval`
// across all the client's projects, grouped by project. Taps route to the
// project screen (where Approve / Request changes live).
//
// Silent when there's nothing to decide.

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import T from './theme';

type Pending = {
  deliverable_id: string;
  project_id: string;
  project_title?: string;
  title: string;
  summary?: string;
  price?: number;
};

export default function DecisionHub() {
  const router = useRouter();
  const [items, setItems] = useState<Pending[]>([]);

  const load = async () => {
    try {
      const r = await api.get('/client/pending-deliverables');
      const list: Pending[] = Array.isArray(r.data) ? r.data : (r.data?.items || []);
      setItems(list);
    } catch { /* silent */ }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  if (items.length === 0) return null;

  return (
    <View style={s.wrap} testID="decision-hub">
      <View style={s.header}>
        <Ionicons name="flash" size={16} color="#f59e0b" />
        <Text style={s.title}>Action required</Text>
        <View style={s.pill}>
          <Text style={s.pillText}>{items.length}</Text>
        </View>
      </View>

      {items.slice(0, 3).map((d) => (
        <TouchableOpacity
          key={d.deliverable_id}
          testID={`decision-hub-${d.deliverable_id}`}
          style={s.row}
          onPress={() => router.push(`/client/deliverable/${d.deliverable_id}` as any)}
          activeOpacity={0.85}
        >
          <View style={{ flex: 1, marginRight: 10 }}>
            <Text style={s.rowTitle} numberOfLines={1}>{d.title}</Text>
            {d.project_title ? <Text style={s.rowMeta} numberOfLines={1}>{d.project_title}</Text> : null}
          </View>
          <View style={s.cta}>
            <Text style={s.ctaText}>Review</Text>
            <Ionicons name="chevron-forward" size={14} color={T.bg} />
          </View>
        </TouchableOpacity>
      ))}

      {items.length > 3 && (
        <Text style={s.more}>+ {items.length - 3} more awaiting your review</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    backgroundColor: '#f59e0b14',
    borderWidth: 1,
    borderColor: '#f59e0b66',
    borderRadius: T.radius,
    padding: T.md,
    marginBottom: T.lg,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: T.sm },
  title: { color: T.text, fontSize: T.body, fontWeight: '800', flex: 1 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: '#f59e0b' },
  pillText: { color: '#000', fontSize: 11, fontWeight: '800' },

  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radiusSm,
    padding: T.sm,
    marginTop: 6,
  },
  rowTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  rowMeta: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },

  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: T.primary,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: T.radiusSm,
  },
  ctaText: { color: T.bg, fontSize: T.small, fontWeight: '800' },

  more: { color: T.textMuted, fontSize: T.tiny, marginTop: 8, textAlign: 'center' },
});
