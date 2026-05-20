// Support ticket chat — client view.
//
// Shows the original ticket (subject / type / priority / description / attachment)
// + a chronological thread of responses from BOTH the client and admin (saved
// to `ticket_responses`). Client can reply with:
//   - plain text (multiline)
//   - emoji (compact picker via Ionicons "happy-outline" button)
//   - image / file attachment (data URL via expo-image-picker)
//
// Backend wiring:
//   GET  /api/client/support-tickets/{id}            → ticket + responses[]
//   POST /api/client/support-tickets/{id}/respond    → { message, attachment_url }
//
// Realtime: we poll every 8s while the screen is mounted. Cheap and reliable
// across web + native preview; the socket.io event 'support:ticket_reply'
// emitted by the backend is consumed by the global notification poller.
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet, TouchableOpacity, Image,
  RefreshControl, ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../src/api';
import T from '../../src/theme';
import { StatusPill } from '../../src/ui-client';

type Resp = {
  response_id: string;
  user_role: string;
  message: string;
  attachment_url?: string | null;
  created_at?: string;
};

type Ticket = {
  ticket_id: string;
  title: string;
  description?: string;
  ticket_type?: string;
  priority?: string;
  status: string;
  attachment_url?: string;
  created_at?: string;
  responses?: Resp[];
};

const EMOJIS = ['👍', '🙏', '✅', '🎉', '🔥', '💡', '🤔', '😊', '😅', '😢', '❤️', '🚀'];

export default function TicketChat() {
  const router = useRouter();
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [attachment, setAttachment] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!ticketId) return;
    try {
      const r = await api.get(`/client/support-tickets/${ticketId}`);
      setTicket(r.data);
    } catch (e: any) {
      // 404 -> ticket doesn't belong to this user
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);

  // poll every 8s for new admin replies
  useEffect(() => {
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  // auto-scroll to bottom whenever the thread grows
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
      const a = r.assets[0];
      setAttachment(`data:image/jpeg;base64,${a.base64}`);
    } catch (e: any) {
      Alert.alert('Attach', String(e?.message || e));
    }
  };

  const send = async () => {
    const text = message.trim();
    if (!text && !attachment) return;
    setSending(true);
    try {
      await api.post(`/client/support-tickets/${ticketId}/respond`, {
        message: text,
        attachment_url: attachment,
      });
      setMessage('');
      setAttachment(null);
      setShowEmoji(false);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Failed to send');
    } finally { setSending(false); }
  };

  const addEmoji = (emo: string) => {
    setMessage((prev) => prev + emo);
  };

  const ticketTone = (st?: string): 'success' | 'risk' | 'info' | 'neutral' =>
    st === 'resolved' || st === 'closed' ? 'success' : st === 'open' ? 'risk' : 'info';

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
        <TouchableOpacity
          testID="ticket-chat-back"
          onPress={() => router.back()}
          style={s.backBtn}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={22} color={T.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>{ticket.title}</Text>
          <View style={s.headerMetaRow}>
            {ticket.ticket_type ? <Text style={s.headerMeta}>{ticket.ticket_type}</Text> : null}
            {ticket.priority ? <Text style={s.headerMeta}>· {ticket.priority}</Text> : null}
          </View>
        </View>
        <StatusPill tone={ticketTone(ticket.status)} label={ticket.status} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={20}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={s.thread}
          testID="ticket-chat-thread"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={T.primary}
            />
          }
        >
          {/* Original ticket = first message from client */}
          <View style={[s.bubble, s.bubbleMine]} testID="ticket-original">
            <Text style={s.bubbleRole}>You</Text>
            {ticket.description ? <Text style={s.bubbleText}>{ticket.description}</Text> : null}
            {ticket.attachment_url ? (
              <Image source={{ uri: ticket.attachment_url }} style={s.bubbleImg} />
            ) : null}
            {ticket.created_at ? (
              <Text style={s.bubbleTime}>{new Date(ticket.created_at).toLocaleString()}</Text>
            ) : null}
          </View>

          {(ticket.responses || []).map((r) => {
            const mine = r.user_role !== 'admin';
            return (
              <View
                key={r.response_id}
                style={[s.bubble, mine ? s.bubbleMine : s.bubbleAdmin]}
                testID={`ticket-msg-${r.response_id}`}
              >
                <Text style={[s.bubbleRole, !mine && { color: T.primary }]}>
                  {mine ? 'You' : 'Support'}
                </Text>
                {r.message ? <Text style={s.bubbleText}>{r.message}</Text> : null}
                {r.attachment_url ? (
                  <Image source={{ uri: r.attachment_url }} style={s.bubbleImg} />
                ) : null}
                {r.created_at ? (
                  <Text style={s.bubbleTime}>{new Date(r.created_at).toLocaleString()}</Text>
                ) : null}
              </View>
            );
          })}
        </ScrollView>

        {/* Emoji picker — shown above composer when toggled */}
        {showEmoji ? (
          <View style={s.emojiRow} testID="ticket-emoji-row">
            {EMOJIS.map((e) => (
              <TouchableOpacity
                key={e}
                style={s.emojiBtn}
                onPress={() => addEmoji(e)}
                testID={`emoji-${e}`}
                activeOpacity={0.7}
              >
                <Text style={s.emojiText}>{e}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* Pending attachment preview */}
        {attachment ? (
          <View style={s.attachPreview} testID="ticket-attach-preview">
            <Image source={{ uri: attachment }} style={s.attachThumb} />
            <Text style={s.attachLabel}>Image ready to send</Text>
            <TouchableOpacity
              onPress={() => setAttachment(null)}
              hitSlop={8}
              testID="ticket-attach-clear"
            >
              <Ionicons name="close-circle" size={20} color={T.danger} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Composer */}
        <View style={s.composer}>
          <TouchableOpacity
            onPress={pickAttachment}
            style={s.iconBtn}
            testID="ticket-chat-attach"
            hitSlop={8}
          >
            <Ionicons name="attach" size={22} color={T.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowEmoji((v) => !v)}
            style={s.iconBtn}
            testID="ticket-chat-emoji-toggle"
            hitSlop={8}
          >
            <Ionicons
              name={showEmoji ? 'happy' : 'happy-outline'}
              size={22}
              color={showEmoji ? T.primary : T.textMuted}
            />
          </TouchableOpacity>
          <TextInput
            testID="ticket-chat-input"
            style={s.composerInput}
            placeholder="Write to support…"
            placeholderTextColor={T.textMuted}
            value={message}
            onChangeText={setMessage}
            multiline
          />
          <TouchableOpacity
            testID="ticket-chat-send"
            style={[s.sendBtn, (sending || (!message.trim() && !attachment)) && { opacity: 0.5 }]}
            onPress={send}
            disabled={sending || (!message.trim() && !attachment)}
            activeOpacity={0.85}
          >
            {sending
              ? <ActivityIndicator color={T.bg} />
              : <Ionicons name="send" size={18} color={T.bg} />}
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

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 6,
    paddingHorizontal: T.md, paddingVertical: T.sm,
    backgroundColor: T.surface1,
    borderTopWidth: 1, borderTopColor: T.border,
  },
  iconBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 8,
  },
  composerInput: {
    flex: 1,
    backgroundColor: T.surface2,
    borderRadius: T.radiusSm,
    borderWidth: 1, borderColor: T.border,
    paddingHorizontal: 12, paddingVertical: 10,
    color: T.text, fontSize: T.body,
    minHeight: 40, maxHeight: 120,
    // @ts-ignore — web focus outline cleanup
    outlineStyle: 'none',
  },
  sendBtn: {
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: T.radiusSm,
    backgroundColor: T.primary,
  },
});
