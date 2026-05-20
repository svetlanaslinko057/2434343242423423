import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { T } from '../../src/theme';
import { runtime } from '../../src/runtime';

type Task = {
  unit_id: string;
  title: string;
  status: string;
  actual_hours: number;
  estimated_hours: number;
  time_breakdown: Record<string, number>;
  updated_at?: string;
};

const STATUS_COLOR: Record<string, string> = {
  in_progress: T.primary,
  pending: T.textMuted,
  review: T.risk,
  completed: T.primary,
  paused: T.role,
  failed: T.danger,
};

export default function DeveloperTimeLogs() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = React.useCallback(async () => {
    try {
      const r = await runtime.get('/api/developer/time-logs');
      setTasks(r.data?.tasks || []);
      setTotal(r.data?.total_hours || 0);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const tasksWithHours = tasks.filter(t => t.actual_hours > 0);
  const showAll = tasksWithHours.length === 0 && tasks.length > 0;
  const list = showAll ? tasks : tasksWithHours;

  return (
    <>
      <Stack.Screen options={{ title: 'Time Logs', headerStyle: { backgroundColor: T.bg }, headerTitleStyle: { color: T.text } }} />
      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={T.primary} />}
      >
        {/* Total hero */}
        <View style={s.heroCard}>
          <Text style={s.heroLabel}>Total hours logged</Text>
          <Text style={s.heroValue}>{total.toFixed(1)}h</Text>
          <Text style={s.heroSub}>across {tasks.length} task{tasks.length === 1 ? '' : 's'}</Text>
        </View>

        {loading && <ActivityIndicator color={T.primary} />}

        {!loading && tasks.length === 0 && (
          <View style={s.emptyCard}>
            <Ionicons name="time-outline" size={32} color={T.textMuted} />
            <Text style={s.emptyTitle}>No tasks yet</Text>
            <Text style={s.emptySub}>Once a task is assigned to you, it will show up here.</Text>
          </View>
        )}

        {showAll && (
          <View style={s.hintCard}>
            <Ionicons name="information-circle-outline" size={16} color={T.textMuted} />
            <Text style={s.hintText}>No timer started yet. Open a task to log hours.</Text>
          </View>
        )}

        {list.map((t) => {
          const variance = t.actual_hours - t.estimated_hours;
          const overEstimate = t.estimated_hours > 0 && variance > 0;
          const dotColor = STATUS_COLOR[t.status] || T.textMuted;
          return (
            <View key={t.unit_id} style={s.taskCard} testID={`time-log-${t.unit_id}`}>
              <View style={s.taskHeader}>
                <View style={[s.dot, { backgroundColor: dotColor }]} />
                <Text style={s.taskTitle} numberOfLines={1}>{t.title}</Text>
                <Text style={s.taskHours}>{t.actual_hours.toFixed(1)}h</Text>
              </View>
              <View style={s.taskMeta}>
                <Text style={s.metaText}>Status: {t.status}</Text>
                {t.estimated_hours > 0 && (
                  <Text style={[s.metaText, { color: overEstimate ? T.risk : T.primary }]}>
                    {overEstimate ? 'Over' : 'Under'} estimate: {Math.abs(variance).toFixed(1)}h
                  </Text>
                )}
              </View>
              {Object.keys(t.time_breakdown || {}).length > 0 && (
                <View style={s.breakdown}>
                  {Object.entries(t.time_breakdown).map(([k, v]) => (
                    <View key={k} style={s.bChip}>
                      <Text style={s.bChipText}>{k}: {Number(v).toFixed(1)}h</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.lg, paddingBottom: T.xl * 2 },
  heroCard: {
    backgroundColor: T.surface,
    borderRadius: T.radius,
    borderWidth: 1, borderColor: T.primaryBorder,
    padding: T.lg,
    alignItems: 'center',
    marginBottom: T.lg,
  },
  heroLabel: { color: T.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2 },
  heroValue: { color: T.primary, fontSize: 44, fontWeight: '900', marginVertical: 4 },
  heroSub: { color: T.textMuted, fontSize: 13 },
  taskCard: {
    backgroundColor: T.surface,
    borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.md,
    marginBottom: T.sm,
  },
  taskHeader: { flexDirection: 'row', alignItems: 'center', gap: T.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  taskTitle: { color: T.text, fontSize: T.body, fontWeight: '600', flex: 1 },
  taskHours: { color: T.primary, fontSize: 16, fontWeight: '700' },
  taskMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  metaText: { color: T.textMuted, fontSize: 12 },
  breakdown: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: T.sm, paddingTop: T.sm, borderTopWidth: 1, borderTopColor: T.border },
  bChip: { backgroundColor: T.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  bChipText: { color: T.textMuted, fontSize: 11 },
  emptyCard: {
    backgroundColor: T.surface,
    borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.xl,
    alignItems: 'center',
  },
  emptyTitle: { color: T.text, fontSize: 16, fontWeight: '700', marginTop: T.sm },
  emptySub: { color: T.textMuted, fontSize: 13, textAlign: 'center', marginTop: 4, lineHeight: 18 },
  hintCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: T.surface,
    borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.sm,
    marginBottom: T.sm,
  },
  hintText: { color: T.textMuted, fontSize: 12, flex: 1 },
});
