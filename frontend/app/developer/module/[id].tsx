/**
 * Developer Module Detail — opened when tapping a module card on /developer/home.
 *
 * Consolidates per-module info from existing endpoints:
 *   GET /api/dev/work                          → find module in active/qa/blocked
 *   GET /api/dev/tasks?module_id={id}          → task list (kanban-lite)
 *   GET /api/developer/why-assigned/{id}       → match reason (collapsed)
 *   POST /api/modules/{id}/submit              → submit deliverable for QA
 *   POST /api/marketplace/modules/{id}/drop    → release the module back
 *
 * Plus quick-actions: open chat, file a support ticket scoped to this module.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert, Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { runtime } from '../../../src/runtime';
import { ApiError } from '../../../src/runtime-client';
import T from '../../../src/theme';

type ModuleRow = {
  module_id: string;
  module_title: string;
  project_id?: string;
  project_title?: string;
  status: string;
  paused_by_system?: boolean;
  progress_pct: number;
  budget: number;
  earned: number;
  rebalanced_from?: string | null;
};
type Task = {
  task_id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'review' | 'done';
  estimated_hours: number;
  spent_hours?: number;
};
type WhyAssigned = {
  reason?: string;
  match_score?: number;
  skills_matched?: string[];
};

function isValidUrl(u: string): boolean {
  const t = (u || '').trim();
  if (!t) return false;
  return /^https?:\/\/\S+/i.test(t);
}

export default function DeveloperModuleDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [mod, setMod] = useState<ModuleRow | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [why, setWhy] = useState<WhyAssigned | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Submit-for-QA modal
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitUrl, setSubmitUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Drop-confirmation modal
  const [dropping, setDropping] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [workRes, tasksRes, whyRes] = await Promise.all([
        runtime.get<any>('/api/dev/work'),
        runtime.get<{ tasks: Task[] }>(`/api/dev/tasks?module_id=${id}`),
        runtime.get<WhyAssigned>(`/api/developer/why-assigned/${id}`).catch(() => ({ data: {} as WhyAssigned })),
      ]);
      const all: ModuleRow[] = [
        ...(workRes.data?.active || []),
        ...(workRes.data?.qa || []),
        ...(workRes.data?.blocked || []),
      ];
      setMod(all.find(m => m.module_id === id) || null);
      setTasks(tasksRes.data?.tasks || []);
      setWhy(whyRes.data || null);
    } catch {
      /* keep state; refresh to retry */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const doSubmit = async () => {
    if (!isValidUrl(submitUrl)) {
      Alert.alert('Need a valid URL', 'Paste a https:// link to your deliverable (GitHub PR, Figma, deploy URL).');
      return;
    }
    setSubmitting(true);
    try {
      await runtime.post(
        `/api/modules/${id}/submit`,
        { deliverable_url: submitUrl.trim() },
        { idempotencyKey: `submit-module:${id}`, capability: 'payment' },
      );
      setSubmitOpen(false);
      setSubmitUrl('');
      Alert.alert('Submitted for QA', 'Your module is now in review. Watch the Notifications tab.');
      await load();
    } catch (e: any) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : (e?.response?.data?.detail || 'Failed');
      Alert.alert('Cannot submit', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const doDrop = () => {
    Alert.alert(
      'Drop this module?',
      `"${mod?.module_title}" will be released back to the marketplace. Your earned amount on completed tasks stays.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Drop',
          style: 'destructive',
          onPress: async () => {
            setDropping(true);
            try {
              await runtime.post(
                `/api/marketplace/modules/${id}/drop`,
                {},
                { idempotencyKey: `drop-module:${id}` },
              );
              Alert.alert('Released', 'Module returned to marketplace.');
              router.replace('/developer/home');
            } catch (e: any) {
              const msg = e instanceof ApiError ? (e.hint || e.message) : 'Failed';
              Alert.alert('Cannot drop', msg);
            } finally {
              setDropping(false);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return <SafeAreaView style={[s.flex, s.center]}><ActivityIndicator color={T.primary} /></SafeAreaView>;
  }
  if (!mod) {
    return (
      <SafeAreaView style={s.flex} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[s.flex, s.center, { padding: T.lg }]}>
          <Ionicons name="warning-outline" size={36} color={T.warning} />
          <Text style={s.notFoundTitle}>Module not found</Text>
          <Text style={s.notFoundSub}>It may have been reassigned or completed. Pull to refresh on Home.</Text>
          <TouchableOpacity style={s.backHome} onPress={() => router.replace('/developer/home')}>
            <Text style={s.backHomeText}>Back to Home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const canSubmit = mod.status === 'in_progress' || mod.status === 'pending';
  const canDrop = ['open', 'reserved', 'in_progress', 'pending'].includes(mod.status);
  const statusColor =
    mod.status === 'done' || mod.status === 'qa_done' ? T.success :
    mod.status === 'qa_review' || mod.status === 'review' ? T.warning :
    mod.status === 'paused' ? T.danger :
    T.primary;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={s.flex} edges={['top']}>
        <ScrollView
          style={s.flex}
          contentContainerStyle={s.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={T.primary} />}
          testID="dev-module-detail"
        >
          {/* Header */}
          <View style={s.head}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="module-back">
              <Ionicons name="chevron-back" size={24} color={T.text} />
            </TouchableOpacity>
            <View style={[s.statusPill, { backgroundColor: statusColor + '22' }]}>
              <Text style={[s.statusPillText, { color: statusColor }]}>
                {mod.status.replace(/_/g, ' ')}
              </Text>
            </View>
          </View>

          <Text style={s.title}>{mod.module_title}</Text>
          {mod.project_title ? <Text style={s.project}>{mod.project_title}</Text> : null}

          {mod.paused_by_system && (
            <View style={s.warnBox}>
              <Ionicons name="pause-circle" size={16} color={T.danger} />
              <Text style={s.warnText}>System-paused. Resolve the blocker before resuming.</Text>
            </View>
          )}

          {/* Progress + earnings */}
          <View style={s.stats}>
            <View style={s.statCard}>
              <Text style={s.statLabel}>BUDGET</Text>
              <Text style={s.statValue}>${mod.budget}</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statLabel}>EARNED</Text>
              <Text style={[s.statValue, { color: T.success }]}>${mod.earned}</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statLabel}>PROGRESS</Text>
              <Text style={s.statValue}>{mod.progress_pct}%</Text>
            </View>
          </View>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${mod.progress_pct}%` }]} />
          </View>

          {/* Why-assigned (collapsed accordion-style) */}
          {(why?.reason || (why?.skills_matched && why.skills_matched.length > 0)) && (
            <View style={s.whyBox} testID="why-assigned">
              <View style={s.whyHead}>
                <Ionicons name="sparkles" size={14} color={T.primary} />
                <Text style={s.whyTitle}>Why you</Text>
                {typeof why?.match_score === 'number' && (
                  <Text style={s.whyScore}>match {Math.round(why.match_score * 100)}%</Text>
                )}
              </View>
              {why.reason ? <Text style={s.whyText}>{why.reason}</Text> : null}
              {why.skills_matched && why.skills_matched.length > 0 && (
                <View style={s.skillRow}>
                  {why.skills_matched.slice(0, 6).map(sk => (
                    <View key={sk} style={s.skillChip}>
                      <Text style={s.skillText}>{sk}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Tasks */}
          <Text style={s.sectionLabel}>TASKS ({tasks.length})</Text>
          {tasks.length === 0 ? (
            <Text style={s.emptyTasks}>No tasks created yet for this module.</Text>
          ) : (
            tasks.map(t => (
              <View key={t.task_id} style={s.taskCard} testID={`mod-task-${t.task_id}`}>
                <View style={s.taskHead}>
                  <View style={[s.taskDot, { backgroundColor: taskColor(t.status) }]} />
                  <Text style={s.taskTitle} numberOfLines={2}>{t.title}</Text>
                </View>
                {t.description ? (
                  <Text style={s.taskDesc} numberOfLines={2}>{t.description}</Text>
                ) : null}
                <View style={s.taskMeta}>
                  <Text style={s.taskMetaText}>
                    {t.estimated_hours}h est
                    {typeof t.spent_hours === 'number' && t.spent_hours > 0 ? `  ·  ${t.spent_hours}h spent` : ''}
                  </Text>
                  <Text style={[s.taskStatus, { color: taskColor(t.status) }]}>
                    {t.status.replace(/_/g, ' ')}
                  </Text>
                </View>
              </View>
            ))
          )}

          {/* Actions */}
          <Text style={s.sectionLabel}>ACTIONS</Text>

          {canSubmit && (
            <TouchableOpacity
              style={[s.actionBtn, s.actionPrimary]}
              onPress={() => setSubmitOpen(true)}
              testID="module-submit-btn"
            >
              <Ionicons name="checkmark-circle" size={18} color={T.primaryInk} />
              <Text style={s.actionPrimaryText}>Submit for QA</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={s.actionBtn}
            onPress={() => router.push('/developer/feedback' as any)}
            testID="module-feedback-btn"
          >
            <Ionicons name="alert-circle-outline" size={18} color={T.primary} />
            <Text style={s.actionText}>View QA feedback</Text>
            <Ionicons name="chevron-forward" size={16} color={T.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={s.actionBtn}
            onPress={() => router.push('/chat' as any)}
            testID="module-chat-btn"
          >
            <Ionicons name="chatbubbles-outline" size={18} color={T.primary} />
            <Text style={s.actionText}>Message admin</Text>
            <Ionicons name="chevron-forward" size={16} color={T.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={s.actionBtn}
            onPress={() => router.push('/developer/support' as any)}
            testID="module-support-btn"
          >
            <Ionicons name="help-buoy-outline" size={18} color={T.primary} />
            <Text style={s.actionText}>File a support ticket</Text>
            <Ionicons name="chevron-forward" size={16} color={T.textMuted} />
          </TouchableOpacity>

          {canDrop && (
            <TouchableOpacity
              style={[s.actionBtn, s.actionDanger]}
              onPress={doDrop}
              disabled={dropping}
              testID="module-drop-btn"
            >
              <Ionicons name="exit-outline" size={18} color={T.danger} />
              <Text style={[s.actionText, { color: T.danger }]}>
                {dropping ? 'Releasing…' : 'Drop module'}
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* Submit modal — proper TextInput (not Alert.prompt) for cross-platform */}
        <Modal visible={submitOpen} animationType="slide" transparent onRequestClose={() => setSubmitOpen(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={s.modalOverlay}
          >
            <View style={s.modalCard} testID="submit-modal">
              <Text style={s.modalTitle}>Submit for QA</Text>
              <Text style={s.modalSub}>{mod.module_title}</Text>

              <Text style={s.modalLabel}>DELIVERABLE URL</Text>
              <TextInput
                style={s.modalInput}
                value={submitUrl}
                onChangeText={setSubmitUrl}
                placeholder="https://github.com/.../pull/123"
                placeholderTextColor={T.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                testID="submit-url-input"
              />
              <Text style={s.modalHint}>
                GitHub PR, Figma file, deploy URL, video walkthrough — anything QA can review.
              </Text>

              <View style={s.modalActions}>
                <TouchableOpacity
                  style={s.modalCancel}
                  onPress={() => setSubmitOpen(false)}
                  testID="submit-cancel"
                >
                  <Text style={s.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.modalSubmit, (!isValidUrl(submitUrl) || submitting) && { opacity: 0.5 }]}
                  onPress={doSubmit}
                  disabled={!isValidUrl(submitUrl) || submitting}
                  testID="submit-confirm"
                >
                  {submitting
                    ? <ActivityIndicator color={T.primaryInk} />
                    : <Text style={s.modalSubmitText}>Submit</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </>
  );
}

function taskColor(st: string): string {
  return st === 'done' ? T.success
       : st === 'review' ? T.warning
       : st === 'in_progress' ? T.primary
       : T.textMuted;
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: T.lg, paddingBottom: T.xl * 2 },

  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: T.md },
  backBtn: { width: 32, height: 32, alignItems: 'flex-start', justifyContent: 'center' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },

  title: { color: T.text, fontSize: T.h2, fontWeight: '800' },
  project: { color: T.textSecondary, fontSize: T.small, marginTop: 4, marginBottom: T.md },

  warnBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: T.dangerTint, borderColor: T.dangerBorder, borderWidth: 1,
    padding: T.sm, borderRadius: T.radiusSm, marginBottom: T.md,
  },
  warnText: { color: T.danger, fontSize: 12, fontWeight: '700', flex: 1 },

  stats: { flexDirection: 'row', gap: T.sm, marginBottom: T.sm },
  statCard: {
    flex: 1, backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    borderRadius: T.radiusSm, padding: T.sm,
  },
  statLabel: { color: T.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  statValue: { color: T.text, fontSize: 18, fontWeight: '800', marginTop: 4 },

  progressTrack: { height: 6, backgroundColor: T.border, borderRadius: 3, overflow: 'hidden', marginBottom: T.lg },
  progressFill: { height: 6, backgroundColor: T.primary },

  whyBox: {
    backgroundColor: T.primaryBg, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.primaryBorder,
    padding: T.md, marginBottom: T.lg, gap: 6,
  },
  whyHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  whyTitle: { color: T.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  whyScore: { color: T.textMuted, fontSize: 10, marginLeft: 'auto' },
  whyText: { color: T.text, fontSize: 12, lineHeight: 18 },
  skillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  skillChip: {
    backgroundColor: T.surface2, borderWidth: 1, borderColor: T.border,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
  },
  skillText: { color: T.textMuted, fontSize: 10, fontWeight: '700' },

  sectionLabel: { color: T.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginTop: T.md, marginBottom: T.sm },

  emptyTasks: { color: T.textMuted, fontSize: 12, fontStyle: 'italic' },
  taskCard: {
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    borderWidth: 1, borderColor: T.border,
    padding: T.sm, marginBottom: 6,
  },
  taskHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  taskDot: { width: 8, height: 8, borderRadius: 4 },
  taskTitle: { color: T.text, fontSize: 13, fontWeight: '700', flex: 1 },
  taskDesc: { color: T.textMuted, fontSize: 11, marginTop: 4 },
  taskMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  taskMetaText: { color: T.textMuted, fontSize: 10 },
  taskStatus: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.md, marginBottom: T.sm,
  },
  actionPrimary: { backgroundColor: T.primary, borderColor: T.primary, justifyContent: 'center' },
  actionPrimaryText: { color: T.primaryInk, fontWeight: '800', fontSize: T.body },
  actionText: { color: T.text, fontSize: T.body, fontWeight: '600', flex: 1 },
  actionDanger: { borderColor: T.dangerBorder || T.border },

  notFoundTitle: { color: T.text, fontSize: T.h3, fontWeight: '800', marginTop: T.md },
  notFoundSub: { color: T.textMuted, fontSize: T.body, marginTop: 4, textAlign: 'center' },
  backHome: {
    marginTop: T.lg, paddingHorizontal: T.lg, paddingVertical: T.sm,
    backgroundColor: T.primary, borderRadius: T.radiusSm,
  },
  backHomeText: { color: T.primaryInk, fontWeight: '800' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: T.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: T.lg, paddingBottom: T.xl,
    borderTopWidth: 1, borderColor: T.border,
  },
  modalTitle: { color: T.text, fontSize: T.h2, fontWeight: '800' },
  modalSub: { color: T.textMuted, fontSize: T.small, marginTop: 4 },
  modalLabel: { color: T.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginTop: T.lg, marginBottom: 6 },
  modalInput: {
    backgroundColor: T.surface1, color: T.text, fontSize: T.body,
    borderRadius: T.radiusSm, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: T.border,
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
