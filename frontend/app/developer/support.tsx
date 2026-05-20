/**
 * Developer Support — list + create + chat thread per ticket.
 *
 * Mirrors /client/support but uses /api/developer/support-tickets and
 * supports ticket_type filter (bug / question / payout / blocker / improvement).
 *
 * Access: Profile → Support row, and the support bell row in /developer/home.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Image,
  TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { runtime } from '../../src/runtime';
import { ApiError } from '../../src/runtime-client';
import T from '../../src/theme';

type Ticket = {
  ticket_id: string;
  title: string;
  description?: string;
  ticket_type: string;
  priority: string;
  status: 'open' | 'in_progress' | 'resolved' | string;
  created_at: string;
  module_id?: string | null;
  attachment_url?: string | null;
  last_response?: { preview: string; from: string; at: string };
};

// Suggestions only — the user can type ANY type, just like client side.
const TYPE_SUGGESTIONS = ['Bug', 'Payout', 'Blocker', 'Question', 'Idea', 'Integration'];

const PRIO_OPTIONS = ['low', 'medium', 'high'] as const;

export default function DeveloperSupport() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [type, setType] = useState<string>('');
  const [prio, setPrio] = useState<typeof PRIO_OPTIONS[number]>('medium');
  const [attachment, setAttachment] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await runtime.get<{ tickets: Ticket[] }>('/api/developer/support-tickets');
      setTickets(r.data?.tickets || []);
    } catch {
      /* keep current state on transient errors */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pickAttachment = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'We need photo library access to attach a file.');
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        base64: true,
      });
      if (r.canceled || !r.assets?.[0]) return;
      setAttachment(`data:image/jpeg;base64,${r.assets[0].base64}`);
    } catch (e: any) {
      Alert.alert('Attach', String(e?.message || e));
    }
  };

  const create = async () => {
    if (!title.trim()) {
      Alert.alert('Subject required', 'Tell us in one line what is going on.');
      return;
    }
    if (!type.trim()) {
      Alert.alert('Type required', 'Add a type (e.g. Bug, Payout, Question).');
      return;
    }
    setSubmitting(true);
    try {
      await runtime.post(
        '/api/developer/support-tickets',
        {
          title: title.trim(),
          description: desc.trim(),
          ticket_type: type.trim(),
          priority: prio,
          attachment_url: attachment,
        },
        { idempotencyKey: `dev-ticket:${title.trim().slice(0, 40)}` },
      );
      setShowNew(false);
      setTitle(''); setDesc(''); setType(''); setPrio('medium'); setAttachment(null);
      await load();
      Alert.alert('Ticket submitted', 'Admin will respond shortly.');
    } catch (e: any) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : (e?.response?.data?.detail || 'Failed');
      Alert.alert('Cannot submit', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const statusColor = (s: string) =>
    s === 'resolved' ? T.success : s === 'open' ? T.warning : T.info;

  const prioColor = (p: string) =>
    p === 'high' ? T.danger : p === 'medium' ? T.warning : T.textMuted;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={s.flex} edges={['top']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.flex}
        >
          <ScrollView
            style={s.flex}
            contentContainerStyle={s.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={T.primary} />}
            keyboardShouldPersistTaps="handled"
            testID="developer-support"
          >
            {/* Header */}
            <View style={s.head}>
              <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="support-back">
                <Ionicons name="chevron-back" size={24} color={T.text} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={s.h1}>Support</Text>
                <Text style={s.subtitle}>Direct line to admin</Text>
              </View>
              <TouchableOpacity
                style={s.newBtn}
                onPress={() => setShowNew(v => !v)}
                testID="support-new-btn"
              >
                <Ionicons name={showNew ? 'close' : 'add'} size={16} color={T.primaryInk} />
                <Text style={s.newBtnText}>{showNew ? 'Close' : 'New'}</Text>
              </TouchableOpacity>
            </View>

            {/* Chat with admin shortcut */}
            <TouchableOpacity
              style={s.chatRow}
              onPress={() => router.push('/chat' as any)}
              testID="support-open-chat"
            >
              <View style={s.chatIcon}>
                <Ionicons name="chatbubbles" size={20} color={T.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.chatTitle}>Live chat with admin</Text>
                <Text style={s.chatSub}>Quick questions, instant reply during business hours</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
            </TouchableOpacity>

            {/* New ticket form */}
            {showNew && (
              <View style={s.form} testID="support-form">
                <Text style={s.formLabel}>SUBJECT</Text>
                <TextInput
                  style={s.input}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="One-line summary"
                  placeholderTextColor={T.textMuted}
                  testID="support-title-input"
                  maxLength={120}
                />

                <Text style={s.formLabel}>TYPE</Text>
                <TextInput
                  style={s.input}
                  value={type}
                  onChangeText={setType}
                  placeholder="e.g. Bug, Payout, Blocker, Integration…"
                  placeholderTextColor={T.textMuted}
                  testID="support-type-input"
                  maxLength={40}
                  autoCapitalize="words"
                />
                <View style={s.typeRow}>
                  {TYPE_SUGGESTIONS.map((tt) => (
                    <TouchableOpacity
                      key={tt}
                      style={[s.typeChip, type.toLowerCase() === tt.toLowerCase() && s.typeChipActive]}
                      onPress={() => setType(tt)}
                      testID={`support-type-suggest-${tt.toLowerCase()}`}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.typeChipText, type.toLowerCase() === tt.toLowerCase() && s.typeChipTextActive]}>{tt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={s.formLabel}>PRIORITY</Text>
                <View style={s.prioRow}>
                  {PRIO_OPTIONS.map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={[s.prioChip, prio === p && { borderColor: prioColor(p), backgroundColor: prioColor(p) + '22' }]}
                      onPress={() => setPrio(p)}
                      testID={`support-prio-${p}`}
                    >
                      <Text style={[s.prioChipText, { color: prio === p ? prioColor(p) : T.textMuted }]}>
                        {p.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={s.formLabel}>DETAILS</Text>
                <TextInput
                  style={[s.input, s.textarea]}
                  value={desc}
                  onChangeText={setDesc}
                  placeholder="Steps to reproduce, error message, link…"
                  placeholderTextColor={T.textMuted}
                  multiline
                  numberOfLines={4}
                  testID="support-desc-input"
                />

                <Text style={s.formLabel}>ATTACHMENT (OPTIONAL)</Text>
                {attachment ? (
                  <View style={s.attachRow}>
                    <Image source={{ uri: attachment }} style={s.attachThumb} />
                    <Text style={s.attachLabel}>Image ready</Text>
                    <TouchableOpacity onPress={() => setAttachment(null)} testID="support-attach-clear" hitSlop={8}>
                      <Ionicons name="close-circle" size={20} color={T.danger} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={s.attachBtn}
                    onPress={pickAttachment}
                    testID="support-attach-btn"
                    activeOpacity={0.8}
                  >
                    <Ionicons name="attach" size={16} color={T.textSecondary} />
                    <Text style={s.attachBtnText}>Add image</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[s.submitBtn, submitting && { opacity: 0.6 }]}
                  onPress={create}
                  disabled={submitting}
                  testID="support-submit-btn"
                >
                  {submitting
                    ? <ActivityIndicator color={T.primaryInk} />
                    : <Text style={s.submitBtnText}>Submit ticket</Text>}
                </TouchableOpacity>
              </View>
            )}

            {/* Ticket list */}
            <Text style={s.sectionLabel}>YOUR TICKETS ({tickets.length})</Text>

            {loading && <ActivityIndicator color={T.primary} style={{ marginTop: T.lg }} />}

            {!loading && tickets.length === 0 && !showNew && (
              <View style={s.empty} testID="support-empty">
                <Ionicons name="checkmark-done-outline" size={28} color={T.textMuted} />
                <Text style={s.emptyText}>No tickets yet.</Text>
                <Text style={s.emptySub}>Tap "New" above to file your first one.</Text>
              </View>
            )}

            {tickets.map((t) => (
              <TouchableOpacity
                key={t.ticket_id}
                style={s.card}
                onPress={() => router.push(`/developer/support/${t.ticket_id}` as any)}
                testID={`support-ticket-${t.ticket_id}`}
                activeOpacity={0.85}
              >
                <View style={s.cardHeader}>
                  <View style={[s.prioDot, { backgroundColor: prioColor(t.priority) }]} />
                  <Text style={s.cardTitle} numberOfLines={1}>{t.title}</Text>
                  <View style={[s.statusPill, { backgroundColor: statusColor(t.status) + '22' }]}>
                    <Text style={[s.statusPillText, { color: statusColor(t.status) }]}>{t.status}</Text>
                  </View>
                </View>
                <Text style={s.cardMeta}>
                  {t.ticket_type.toUpperCase()} · {new Date(t.created_at).toLocaleDateString()}
                </Text>
                {t.last_response && (
                  <Text style={s.cardPreview} numberOfLines={1}>
                    <Text style={{ color: T.primary, fontWeight: '700' }}>{t.last_response.from}:</Text>{' '}
                    {t.last_response.preview}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.lg, paddingBottom: T.xl * 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: T.sm, marginBottom: T.lg },
  backBtn: { width: 32, height: 32, alignItems: 'flex-start', justifyContent: 'center' },
  h1: { color: T.text, fontSize: T.h1, fontWeight: '800' },
  subtitle: { color: T.textMuted, fontSize: T.small, marginTop: 2 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: T.primary, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: T.radiusSm,
  },
  newBtnText: { color: T.primaryInk, fontWeight: '800', fontSize: 12 },

  chatRow: {
    flexDirection: 'row', alignItems: 'center', gap: T.md,
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.primaryBorder,
    padding: T.md, marginBottom: T.lg,
  },
  chatIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: T.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  chatTitle: { color: T.text, fontWeight: '700', fontSize: T.body },
  chatSub: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },

  form: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.primaryBorder,
    padding: T.md, marginBottom: T.lg, gap: 6,
  },
  formLabel: {
    color: T.textMuted, fontSize: 10, fontWeight: '800',
    letterSpacing: 1.4, marginTop: 6, marginBottom: 4,
  },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  typeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: T.surface2, borderWidth: 1, borderColor: T.border,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
  },
  typeChipActive: { backgroundColor: T.primary, borderColor: T.primary },
  typeChipText: { color: T.textMuted, fontSize: 11, fontWeight: '700' },
  typeChipTextActive: { color: T.primaryInk },
  prioRow: { flexDirection: 'row', gap: 6 },
  prioChip: {
    flex: 1, alignItems: 'center', paddingVertical: 8,
    backgroundColor: T.surface2, borderWidth: 1, borderColor: T.border,
    borderRadius: T.radiusSm,
  },
  prioChipText: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  input: {
    backgroundColor: T.surface2, color: T.text, fontSize: T.body,
    borderWidth: 1, borderColor: T.border, borderRadius: T.radiusSm,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 2,
  },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  attachBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: T.surface2,
    borderWidth: 1, borderColor: T.border, borderStyle: 'dashed',
    borderRadius: T.radiusSm,
    paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 4,
  },
  attachBtnText: { color: T.textSecondary, fontSize: 12, fontWeight: '700' },
  attachRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: T.surface2,
    borderRadius: T.radiusSm,
    paddingHorizontal: 10, paddingVertical: 8,
    marginBottom: 4,
  },
  attachThumb: { width: 36, height: 36, borderRadius: 6, backgroundColor: T.surface1 },
  attachLabel: { flex: 1, color: T.textSecondary, fontSize: T.small },
  submitBtn: {
    backgroundColor: T.primary, borderRadius: T.radiusSm,
    paddingVertical: 14, alignItems: 'center', marginTop: 12,
  },
  submitBtnText: { color: T.primaryInk, fontWeight: '800', fontSize: T.body },

  sectionLabel: {
    color: T.textMuted, fontSize: 10, fontWeight: '800',
    letterSpacing: 2, marginBottom: T.sm,
  },
  empty: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border, padding: T.xl,
    alignItems: 'center', gap: 8,
  },
  emptyText: { color: T.text, fontWeight: '700' },
  emptySub: { color: T.textMuted, fontSize: 12 },
  card: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.md, marginBottom: T.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prioDot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { color: T.text, fontSize: T.body, fontWeight: '700', flex: 1 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusPillText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardMeta: { color: T.textMuted, fontSize: 11, marginTop: 4, marginLeft: 16 },
  cardPreview: { color: T.textSecondary, fontSize: 12, marginTop: 6, marginLeft: 16, fontStyle: 'italic' },
});
