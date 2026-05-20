/**
 * Developer Support — single ticket chat with reply box.
 *
 * Mirrors /help/[ticketId] for clients. Two-way thread (developer ↔ admin),
 * with emoji picker, image attachments, real-time poll every 8s.
 *
 *   GET  /api/developer/support-tickets/{id}            → ticket + responses[]
 *   POST /api/developer/support-tickets/{id}/respond    → { message, attachment_url }
 *
 * Admin replies land via /api/admin/support-tickets/{id}/respond and show up
 * here on the next poll tick.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Image,
  ActivityIndicator, RefreshControl, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { runtime } from '../../../src/runtime';
import { ApiError } from '../../../src/runtime-client';
import T from '../../../src/theme';

type Resp = {
  response_id: string;
  user_role: string;
  message: string;
  attachment_url?: string | null;
  created_at: string;
};
type Ticket = {
  ticket_id: string;
  title: string;
  description?: string;
  ticket_type: string;
  priority: string;
  status: string;
  attachment_url?: string | null;
  created_at: string;
  responses: Resp[];
};

const EMOJIS = ['👍', '🙏', '✅', '🎉', '🔥', '💡', '🤔', '😊', '😅', '❤️', '🚀'];

export default function TicketDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reply, setReply] = useState('');
  const [attachment, setAttachment] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await runtime.get<Ticket>(`/api/developer/support-tickets/${id}`);
      setTicket(r.data);
    } catch (e: any) {
      Alert.alert('Cannot load', e instanceof ApiError ? e.message : 'Ticket not found');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Poll for admin replies every 8s while screen is mounted.
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, [ticket?.responses?.length]);

  const pickAttachment = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission', 'We need photo library access to attach a file.');
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

  const send = async () => {
    const text = reply.trim();
    if (!text && !attachment) return;
    setSending(true);
    try {
      await runtime.post(`/api/developer/support-tickets/${id}/respond`, {
        message: text, attachment_url: attachment,
      });
      setReply('');
      setAttachment(null);
      setShowEmoji(false);
      await load();
    } catch (e: any) {
      Alert.alert('Failed', e instanceof ApiError ? (e.hint || e.message) : 'Try again');
    } finally { setSending(false); }
  };

  const addEmoji = (e: string) => setReply((p) => p + e);

  const statusColor = (s: string) =>
    s === 'resolved' ? T.success : s === 'open' ? T.warning : T.info;

  if (loading) {
    return (
      <SafeAreaView style={s.flex}>
        <ActivityIndicator color={T.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }
  if (!ticket) {
    return (
      <SafeAreaView style={s.flex}>
        <Text style={s.notFound}>Ticket not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.flex} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity testID="dev-ticket-back" onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={T.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>{ticket.title}</Text>
          <View style={s.headerMetaRow}>
            <Text style={s.headerMeta}>{ticket.ticket_type}</Text>
            <Text style={s.headerMeta}> · {ticket.priority}</Text>
          </View>
        </View>
        <View style={[s.statusPill, { backgroundColor: statusColor(ticket.status) + '22' }]}>
          <Text style={[s.statusPillText, { color: statusColor(ticket.status) }]}>{ticket.status}</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={20}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={s.thread}
          testID="dev-ticket-thread"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={T.primary} />
          }
        >
          {/* Original ticket */}
          <View style={[s.bubble, s.bubbleMine]} testID="dev-ticket-original">
            <Text style={s.bubbleRole}>You</Text>
            {ticket.description ? <Text style={s.bubbleText}>{ticket.description}</Text> : null}
            {ticket.attachment_url ? <Image source={{ uri: ticket.attachment_url }} style={s.bubbleImg} /> : null}
            {ticket.created_at ? (
              <Text style={s.bubbleTime}>{new Date(ticket.created_at).toLocaleString()}</Text>
            ) : null}
          </View>

          {(ticket.responses || []).map((r) => {
            const mine = r.user_role !== 'admin';
            return (
              <View key={r.response_id} style={[s.bubble, mine ? s.bubbleMine : s.bubbleAdmin]} testID={`dev-ticket-msg-${r.response_id}`}>
                <Text style={[s.bubbleRole, !mine && { color: T.primary }]}>
                  {mine ? 'You' : 'Support'}
                </Text>
                {r.message ? <Text style={s.bubbleText}>{r.message}</Text> : null}
                {r.attachment_url ? <Image source={{ uri: r.attachment_url }} style={s.bubbleImg} /> : null}
                {r.created_at ? (
                  <Text style={s.bubbleTime}>{new Date(r.created_at).toLocaleString()}</Text>
                ) : null}
              </View>
            );
          })}
        </ScrollView>

        {/* Emoji picker */}
        {showEmoji ? (
          <View style={s.emojiRow} testID="dev-ticket-emoji-row">
            {EMOJIS.map((e) => (
              <TouchableOpacity key={e} style={s.emojiBtn} onPress={() => addEmoji(e)} testID={`dev-emoji-${e}`} activeOpacity={0.7}>
                <Text style={s.emojiText}>{e}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* Attachment preview */}
        {attachment ? (
          <View style={s.attachPreview} testID="dev-ticket-attach-preview">
            <Image source={{ uri: attachment }} style={s.attachThumb} />
            <Text style={s.attachLabel}>Image ready to send</Text>
            <TouchableOpacity onPress={() => setAttachment(null)} hitSlop={8} testID="dev-ticket-attach-clear">
              <Ionicons name="close-circle" size={20} color={T.danger} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Composer — compact icons, wide text */}
        <View style={s.composer}>
          <TouchableOpacity onPress={pickAttachment} style={s.iconBtn} testID="dev-ticket-attach" hitSlop={6}>
            <Ionicons name="attach" size={20} color={T.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowEmoji((v) => !v)} style={s.iconBtn} testID="dev-ticket-emoji" hitSlop={6}>
            <Ionicons name={showEmoji ? 'happy' : 'happy-outline'} size={20} color={showEmoji ? T.primary : T.textMuted} />
          </TouchableOpacity>
          <TextInput
            testID="dev-ticket-input"
            style={s.composerInput}
            placeholder="Reply to admin…"
            placeholderTextColor={T.textMuted}
            value={reply}
            onChangeText={setReply}
            multiline
          />
          <TouchableOpacity
            testID="dev-ticket-send"
            style={[s.sendBtn, (sending || (!reply.trim() && !attachment)) && { opacity: 0.5 }]}
            onPress={send}
            disabled={sending || (!reply.trim() && !attachment)}
            activeOpacity={0.85}
          >
            {sending ? <ActivityIndicator color={T.primaryInk} size="small" /> : <Ionicons name="arrow-up" size={18} color={T.primaryInk} />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  notFound: { color: T.textMuted, textAlign: 'center', marginTop: 80 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: T.md,
    borderBottomWidth: 1, borderBottomColor: T.border,
    backgroundColor: T.surface1,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: T.text, fontSize: T.body, fontWeight: '800' },
  headerMetaRow: { flexDirection: 'row', marginTop: 2 },
  headerMeta: { color: T.textMuted, fontSize: T.tiny, fontWeight: '600', textTransform: 'capitalize' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  thread: { padding: T.md, paddingBottom: 24, gap: 10 },

  bubble: {
    maxWidth: '85%',
    padding: 12,
    borderRadius: T.radius,
    borderWidth: 1,
  },
  bubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: T.primaryBgStrong,
    borderColor: T.primaryBorder,
  },
  bubbleAdmin: {
    alignSelf: 'flex-start',
    backgroundColor: T.surface1,
    borderColor: T.border,
  },
  bubbleRole: { color: T.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  bubbleText: { color: T.text, fontSize: T.body, lineHeight: 22 },
  bubbleImg: { width: 220, height: 160, borderRadius: T.radiusSm, marginTop: 8, backgroundColor: T.surface2 },
  bubbleTime: { color: T.textMuted, fontSize: T.tiny, marginTop: 6 },

  emojiRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: T.md, paddingVertical: T.sm,
    gap: 4,
    backgroundColor: T.surface1,
    borderTopWidth: 1, borderTopColor: T.border,
  },
  emojiBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: T.surface2,
  },
  emojiText: { fontSize: 22 },

  attachPreview: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: T.md, paddingVertical: T.sm,
    backgroundColor: T.surface1,
    borderTopWidth: 1, borderTopColor: T.border,
  },
  attachThumb: { width: 36, height: 36, borderRadius: 6, backgroundColor: T.surface2 },
  attachLabel: { flex: 1, color: T.textSecondary, fontSize: T.small },

  // Compact composer — icons 32×32, send 36×36, input takes the rest.
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 4,
    paddingHorizontal: 8, paddingVertical: 6,
    backgroundColor: T.surface1,
    borderTopWidth: 1, borderTopColor: T.border,
  },
  iconBtn: {
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 6,
  },
  composerInput: {
    flex: 1,
    backgroundColor: T.surface2,
    borderRadius: 18,
    borderWidth: 1, borderColor: T.border,
    paddingHorizontal: 12, paddingVertical: 8,
    color: T.text, fontSize: T.body,
    minHeight: 36, maxHeight: 120,
    // @ts-ignore — web outline cleanup
    outlineStyle: 'none',
  },
  sendBtn: {
    width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: T.primary,
  },
});
