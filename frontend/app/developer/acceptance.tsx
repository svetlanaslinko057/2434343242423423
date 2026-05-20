// Block 10.1 — Developer Acceptance Queue
// Минимальный экран: показать ожидающие ответа задания и принять/отклонить.
// После accept → router.push('/developer/work').

import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { runtime } from '../../src/runtime';
import { ApiError } from '../../src/runtime-client';
import T from '../../src/theme';

type AcceptanceTask = {
  unit_id: string;
  title: string;
  module_id?: string;
  project_id?: string;
  project_name?: string;
  description?: string;
  estimated_hours?: number;
  reward_amount?: number;
  why_you?: string;
  deadline_minutes_remaining?: number;
  is_overdue?: boolean;
};

export default function AcceptanceQueue() {
  const router = useRouter();
  const [tasks, setTasks] = useState<AcceptanceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Cross-platform clarification modal — replaces iOS-only Alert.prompt.
  const [askTask, setAskTask] = useState<AcceptanceTask | null>(null);
  const [askText, setAskText] = useState('');
  const [askSending, setAskSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await runtime.get<{ tasks: AcceptanceTask[] }>('/api/developer/tasks/awaiting-response');
      setTasks(r.data?.tasks || []);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const accept = async (t: AcceptanceTask) => {
    setBusyId(t.unit_id);
    try {
      // Idempotency: speed-tapping operators may double-tap Accept on the
      // same row before navigation fires. Same unit_id collapses; backend's
      // 409 "already taken" path still fires for stale state.
      // No `capability: 'payment'` — accept is state-machine; reward is
      // dispatched on completion, not at accept-time.
      await runtime.post(`/api/developer/tasks/${t.unit_id}/accept`, {}, {
        idempotencyKey: `accept-task:${t.unit_id}`,
      });
      router.replace('/developer/work');
    } catch (e: any) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : (e?.response?.data?.detail || 'Failed');
      Alert.alert('Cannot accept', msg);
    } finally {
      setBusyId(null);
    }
  };

  const decline = (t: AcceptanceTask) => {
    Alert.alert(
      'Decline task?',
      `"${t.title}"`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Overload',
          onPress: () => doDecline(t.unit_id, 'overload'),
        },
        {
          text: 'Skill mismatch',
          onPress: () => doDecline(t.unit_id, 'skill_mismatch'),
        },
        {
          text: 'Other',
          style: 'destructive',
          onPress: () => doDecline(t.unit_id, 'other'),
        },
      ],
    );
  };

  const doDecline = async (unitId: string, reasonType: string) => {
    setBusyId(unitId);
    try {
      // Idempotency: same unit + same reason within ~10s collapses.
      // Flipping reason (e.g. overload → skill_mismatch) is a distinct key
      // and goes through; backend audits the latest.
      await runtime.post(
        `/api/developer/tasks/${unitId}/decline?reason_type=${reasonType}`,
        {},
        { idempotencyKey: `decline-task:${unitId}:${reasonType}` },
      );
      await load();
    } catch (e: any) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : (e?.response?.data?.detail || 'Failed');
      Alert.alert('Cannot decline', msg);
    } finally {
      setBusyId(null);
    }
  };

  const askClarification = (t: AcceptanceTask) => {
    setAskTask(t);
    setAskText('');
  };

  const submitClarification = async () => {
    if (!askTask) return;
    const text = askText.trim();
    if (!text) {
      Alert.alert('Empty question', 'Type your question first.');
      return;
    }
    setAskSending(true);
    try {
      await runtime.post(`/api/developer/tasks/${askTask.unit_id}/clarification`, {
        question: text,
      });
      setAskTask(null);
      setAskText('');
      await load();
      Alert.alert('Sent', 'Admin will respond shortly.');
    } catch (e: any) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : (e?.response?.data?.detail || 'Failed');
      Alert.alert('Cannot send', msg);
    } finally {
      setAskSending(false);
    }
  };

  if (loading) {
    return (
      <View style={[s.flex, s.center]}>
        <ActivityIndicator color={T.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.flex} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={T.primary}
          />
        }
      >
        <View style={s.header}>
          <Text style={s.title}>Acceptance</Text>
          <View style={s.countPill} testID="acceptance-count">
            <Text style={s.countText}>{tasks.length}</Text>
          </View>
        </View>
        <Text style={s.subtitle}>
          Tasks waiting for your response
        </Text>

        {tasks.length === 0 && (
          <View style={s.empty} testID="acceptance-empty">
            <Ionicons
              name="checkmark-done-outline"
              size={32}
              color={T.textMuted}
            />
            <Text style={s.emptyText}>Nothing pending.</Text>
            <Text style={s.emptySub}>
              When admin assigns you a task, it will appear here.
            </Text>
          </View>
        )}

        {tasks.map((t) => (
          <View
            key={t.unit_id}
            style={[
              s.card,
              t.is_overdue && { borderColor: T.danger },
            ]}
            testID={`acceptance-card-${t.unit_id}`}
          >
            <View style={s.cardHeader}>
              <Text style={s.cardTitle} numberOfLines={2}>
                {t.title}
              </Text>
              {typeof t.reward_amount === 'number' && t.reward_amount > 0 && (
                <Text style={s.reward}>${t.reward_amount}</Text>
              )}
            </View>
            {t.project_name ? (
              <Text style={s.project}>{t.project_name}</Text>
            ) : null}
            {t.description ? (
              <Text style={s.desc} numberOfLines={3}>
                {t.description}
              </Text>
            ) : null}
            <View style={s.metaRow}>
              {typeof t.estimated_hours === 'number' && t.estimated_hours > 0 && (
                <Text style={s.meta}>{t.estimated_hours}h est</Text>
              )}
              {typeof t.deadline_minutes_remaining === 'number' && (
                <Text
                  style={[
                    s.meta,
                    t.is_overdue && { color: T.danger, fontWeight: '700' },
                  ]}
                >
                  {t.is_overdue
                    ? `Overdue ${Math.abs(t.deadline_minutes_remaining)}m`
                    : `Respond in ${t.deadline_minutes_remaining}m`}
                </Text>
              )}
            </View>
            {/* Deadline progress bar — visual urgency cue.
                Assume 60-minute default acceptance window per Stage-4 spec.
                Pct = (remaining/60) clamped to [0,1]; overdue collapses to 0. */}
            {typeof t.deadline_minutes_remaining === 'number' && !t.is_overdue && (
              <View style={s.deadlineTrack} testID={`deadline-bar-${t.unit_id}`}>
                <View
                  style={[
                    s.deadlineFill,
                    {
                      width: `${Math.min(100, Math.max(0, (t.deadline_minutes_remaining / 60) * 100))}%`,
                      backgroundColor:
                        t.deadline_minutes_remaining > 30 ? T.success :
                        t.deadline_minutes_remaining > 10 ? T.warning :
                        T.danger,
                    },
                  ]}
                />
              </View>
            )}
            {t.why_you ? (
              <Text style={s.why} numberOfLines={2}>
                Why you: {t.why_you}
              </Text>
            ) : null}

            <View style={s.actions}>
              <TouchableOpacity
                testID={`accept-btn-${t.unit_id}`}
                style={[s.btn, s.acceptBtn, busyId === t.unit_id && s.disabled]}
                disabled={busyId === t.unit_id}
                onPress={() => accept(t)}
                activeOpacity={0.85}
              >
                <Text style={s.acceptText}>
                  {busyId === t.unit_id ? '…' : 'Accept'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID={`decline-btn-${t.unit_id}`}
                style={[s.btn, s.declineBtn]}
                disabled={busyId === t.unit_id}
                onPress={() => decline(t)}
                activeOpacity={0.85}
              >
                <Text style={s.declineText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID={`ask-btn-${t.unit_id}`}
                style={[s.btn, s.askBtn]}
                disabled={busyId === t.unit_id}
                onPress={() => askClarification(t)}
                activeOpacity={0.85}
              >
                <Text style={s.askText}>Ask</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Cross-platform clarification modal — replaces iOS-only Alert.prompt */}
      <Modal
        visible={!!askTask}
        animationType="slide"
        transparent
        onRequestClose={() => setAskTask(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.modalOverlay}
        >
          <View style={s.modalCard} testID="clarify-modal">
            <Text style={s.modalTitle}>Ask a question</Text>
            {askTask && <Text style={s.modalSub}>About "{askTask.title}"</Text>}

            <Text style={s.modalLabel}>YOUR QUESTION</Text>
            <TextInput
              style={s.modalInput}
              value={askText}
              onChangeText={setAskText}
              placeholder="What's unclear? E.g. 'Is push to web required?'"
              placeholderTextColor={T.textMuted}
              multiline
              numberOfLines={4}
              autoFocus
              maxLength={500}
              testID="clarify-input"
            />
            <Text style={s.modalHint}>
              Admin will reply in your notifications inbox. Acceptance deadline keeps running.
            </Text>

            <View style={s.modalActions}>
              <TouchableOpacity
                style={s.modalCancel}
                onPress={() => setAskTask(null)}
                testID="clarify-cancel"
              >
                <Text style={s.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalSubmit, (!askText.trim() || askSending) && { opacity: 0.5 }]}
                onPress={submitClarification}
                disabled={!askText.trim() || askSending}
                testID="clarify-send"
              >
                {askSending
                  ? <ActivityIndicator color={T.primaryInk} />
                  : <Text style={s.modalSubmitText}>Send question</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  container: { padding: T.lg, paddingBottom: 100 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: { color: T.text, fontSize: T.h2 ?? 24, fontWeight: '800' },
  subtitle: { color: T.textMuted, fontSize: 12, marginBottom: T.lg },
  countPill: {
    backgroundColor: T.primary,
    borderRadius: 14,
    paddingVertical: 4,
    paddingHorizontal: 12,
    minWidth: 36,
    alignItems: 'center',
  },
  countText: { color: '#000', fontWeight: '800', fontSize: 12 },
  empty: { alignItems: 'center', padding: 32, marginTop: 32 },
  emptyText: { color: T.text, marginTop: 12, fontWeight: '700' },
  emptySub: { color: T.textMuted, fontSize: 12, marginTop: 4, textAlign: 'center' },
  card: {
    backgroundColor: T.surface1,
    borderRadius: 12,
    padding: T.md,
    marginBottom: T.sm,
    borderWidth: 1,
    borderColor: T.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardTitle: { color: T.text, fontWeight: '700', fontSize: 15, flex: 1 },
  reward: { color: T.primary, fontWeight: '800', fontSize: 14 },
  project: { color: T.textSecondary, fontSize: 12, marginTop: 2 },
  desc: { color: T.textMuted, fontSize: 12, marginTop: 6 },
  metaRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  meta: { color: T.textMuted, fontSize: 11 },
  why: { color: T.info, fontSize: 11, marginTop: 6, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
  },
  disabled: { opacity: 0.5 },
  acceptBtn: { backgroundColor: T.primary, borderColor: T.primary },
  acceptText: { color: '#000', fontWeight: '800', fontSize: 13 },
  declineBtn: { backgroundColor: 'transparent', borderColor: T.danger },
  declineText: { color: T.danger, fontWeight: '700', fontSize: 13 },
  askBtn: { backgroundColor: T.surface3, borderColor: T.border },
  askText: { color: T.text, fontWeight: '700', fontSize: 13 },

  // Deadline progress
  deadlineTrack: {
    height: 4, backgroundColor: T.border, borderRadius: 2,
    overflow: 'hidden', marginTop: 8, marginBottom: 4,
  },
  deadlineFill: { height: 4, borderRadius: 2 },

  // Clarification modal (cross-platform replacement for Alert.prompt)
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: T.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: T.lg, paddingBottom: T.xl,
    borderTopWidth: 1, borderColor: T.border,
  },
  modalTitle: { color: T.text, fontSize: T.h2, fontWeight: '800' },
  modalSub: { color: T.textMuted, fontSize: T.small, marginTop: 4 },
  modalLabel: {
    color: T.textMuted, fontSize: 10, fontWeight: '800',
    letterSpacing: 1.5, marginTop: T.lg, marginBottom: 6,
  },
  modalInput: {
    backgroundColor: T.surface1, color: T.text, fontSize: T.body,
    borderRadius: T.radiusSm, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: T.border, minHeight: 90, textAlignVertical: 'top',
  },
  modalHint: { color: T.textMuted, fontSize: 11, marginTop: 6, lineHeight: 16 },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: T.lg },
  modalCancel: {
    paddingVertical: 14, paddingHorizontal: 22, borderRadius: T.radiusSm,
    borderWidth: 1, borderColor: T.border,
  },
  modalCancelText: { color: T.text, fontWeight: '700' },
  modalSubmit: {
    flex: 1, backgroundColor: T.primary, borderRadius: T.radiusSm,
    paddingVertical: 14, alignItems: 'center',
  },
  modalSubmitText: { color: T.primaryInk, fontWeight: '800', fontSize: T.body },
});
