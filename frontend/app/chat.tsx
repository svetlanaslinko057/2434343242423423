import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
  TextInput, KeyboardAvoidingView, Platform, Alert, Image, Modal, Pressable,
  PanResponder, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import { AudioModule, useAudioRecorder, useAudioPlayer, useAudioPlayerStatus, RecordingPresets } from 'expo-audio';
import api from '../src/api';
import { payInvoiceWithGate } from '../src/pay-with-gate';
import T from '../src/theme';
import { useRequireAuth } from '../src/auth-gate';
import { useAuth } from '../src/auth';
import { useMe } from '../src/use-me';
import { useAppStatePolling } from '../src/hooks/useAppStatePolling';

/**
 * Fullscreen chat. Single feed across system / action / money / user / support.
 *
 * Every system message can carry actions ([Approve] / [Pay now] / etc).
 * Quick commands are seeded ("add payments", "what's the status") so the input
 * area is never blank and the user always has somewhere to start.
 *
 * Deep-link: /chat?msg=<id> → after load, scrolls to that message.
 */

type ChatAction = { label: string; action: string; entity_id?: string };
// Local transport metadata for optimistic bubbles. Lives only on the client —
// the backend never sees `_local`. It carries the staged payload so retry can
// re-run the exact same upload+send without rebuilding state from the composer.
type LocalTransport = {
  local_id: string;
  upload_status: 'uploading' | 'uploaded' | 'failed' | 'retrying';
  staged_attachment_url?: string | null;   // data: URL (pre-upload) — needed for retry
  staged_attachment_name?: string | null;
  staged_attachment_kind?: 'image' | 'file' | 'voice' | null;
  staged_attachment_duration_sec?: number | null;
  staged_text?: string;
  staged_project_id?: string | null;
};
type ChatMsg = {
  id: string;
  type: 'system' | 'action' | 'money' | 'user' | 'support';
  text: string;
  actions?: ChatAction[];
  project_id?: string | null;
  created_at?: string;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_kind?: string | null;
  attachment_duration_sec?: number | null;
  _local?: LocalTransport;
};

const QUICK = ['add payments', "what's the status", 'I want to scale'];
const EMOJIS = ['👍', '🙏', '✅', '🎉', '🔥', '💡', '🤔', '😊', '😅', '❤️', '🚀'];

const TYPE_STYLE: Record<ChatMsg['type'], { bg: string; border: string; accent: string }> = {
  system:  { bg: T.surface2, border: T.border,  accent: T.textMuted },
  action:  { bg: T.primaryBg, border: T.primary,  accent: T.primary },
  money:   { bg: T.warningBg, border: T.warningBorder,  accent: T.warning },
  user:    { bg: T.infoBg, border: T.primary,  accent: T.info },
  support: { bg: T.infoBg, border: T.infoBorder,  accent: T.info },
};

export default function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const requireAuth = useRequireAuth();
  const { msg: deeplinkId, project_id: pidParam, prefill: prefillParam, send: sendParam } = useLocalSearchParams<{ msg?: string; project_id?: string; prefill?: string; send?: string }>();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  // Attach + emoji composer state — added so the chat is a *real* chat
  // (per-project, two-way) and not just a one-line text box.
  const [attachment, setAttachment] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [attachmentKind, setAttachmentKind] = useState<'image' | 'file' | 'voice' | null>(null);
  const [attachmentDuration, setAttachmentDuration] = useState<number | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  // Telegram-style composer: attach menu (photo/file/location) + voice recording.
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [swipeOffsetX, setSwipeOffsetX] = useState(0);
  const recordingStartRef = useRef<number>(0);
  const isRecordingRef = useRef(false);
  const swipeXRef = useRef(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  // Keep ref in sync so PanResponder can read latest value without re-creating handlers.
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  // Cancel threshold — slide left more than 80px during recording → cancel.
  const SWIPE_CANCEL_THRESHOLD = 80;
  // Phase 2.A — one-shot referral system message after first paid invoice.
  const { me } = useMe();
  const [refAnnounce, setRefAnnounce] = useState<boolean>(false);

  // Decide whether to render the referral system bubble. Conditions:
  //   1. Backend says user is referral_eligible (paid >= 1 invoice).
  //   2. We have NOT shown it before on this device (AsyncStorage flag).
  // Once we show it AND the user navigates to /client/referrals OR
  // taps the close mark, the flag is persisted so it never re-appears.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!(me as any)?.referral_eligible) return;
        const seen = await AsyncStorage.getItem('eva_chat_referral_announced');
        if (!cancelled && !seen) setRefAnnounce(true);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [me]);

  const dismissReferralAnnounce = async () => {
    setRefAnnounce(false);
    try { await AsyncStorage.setItem('eva_chat_referral_announced', '1'); } catch { /* ignore */ }
  };

  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});

  // Refine-shortcut from wizard / cards: arrive with text already in input.
  // Set once on mount so user typing isn't clobbered on re-renders.
  // If `?send=1` is also passed, auto-send it so the dialog starts immediately
  // (chat-first activation) instead of waiting on the user to tap "send".
  const prefillApplied = useRef(false);
  useEffect(() => {
    if (prefillApplied.current) return;
    if (loading) return;  // wait for thread to load so auto-send appends after history
    if (typeof prefillParam === 'string' && prefillParam.length > 0) {
      prefillApplied.current = true;
      if (sendParam === '1') {
        // fire-and-forget — `send` already handles its own loading/error
        void send(prefillParam);
      } else {
        setInput(prefillParam);
      }
    }
  }, [prefillParam, sendParam, loading]);

  const refresh = async () => {
    try {
      const url = pidParam ? `/chat/thread?project_id=${encodeURIComponent(pidParam)}` : '/chat/thread';
      const r = await api.get(url);
      setMessages(r.data?.messages || []);
    } catch { /* anonymous users get 401 — show empty state, not an error overlay */ }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, [pidParam]);

  // Live updates: poll for admin replies every 6s while screen is mounted.
  // Backend persists admin → client messages with type="support"; this surfaces
  // them without the user having to navigate away and back.
  const tickChatThread = useCallback(async () => {
    try {
      const url = pidParam ? `/chat/thread?project_id=${encodeURIComponent(pidParam)}` : '/chat/thread';
      const r = await api.get(url);
      const next: ChatMsg[] = r.data?.messages || [];
      setMessages((prev) => (prev.length === next.length ? prev : next));
    } catch { /* keep last good state */ }
  }, [pidParam]);
  // Hook pauses on background + on screen blur, fires one immediate refresh on resume.
  useAppStatePolling(tickChatThread, 6000);

  // Scroll to bottom on first paint, OR to deep-linked message if present.
  useEffect(() => {
    if (loading || messages.length === 0) return;
    setTimeout(() => {
      if (deeplinkId && offsets.current[deeplinkId] != null) {
        scrollRef.current?.scrollTo({ y: Math.max(0, offsets.current[deeplinkId] - 60), animated: true });
      } else {
        scrollRef.current?.scrollToEnd({ animated: true });
      }
    }, 80);
  }, [loading, messages.length, deeplinkId]);

  // ── Delivery trust layer ────────────────────────────────────────────────
  // Pure 4-state narrative: uploading → uploaded | failed → retrying → …
  // Bubble appears INSTANTLY (optimistic), upload happens in background,
  // bubble itself becomes the error/retry surface. No toasts, no alerts,
  // no duplicate bubbles on retry (we mutate the existing one in place).
  const deliverMessage = useCallback(async (local_id: string) => {
    // Find the optimistic record by local_id and read its staged payload.
    // We read via setMessages so we always have the latest snapshot, then
    // continue with the value captured outside React state.
    let staged: LocalTransport | undefined;
    setMessages((prev) => {
      const found = prev.find((m) => m._local?.local_id === local_id);
      staged = found?._local;
      return prev;
    });
    if (!staged) return;
    try {
      let finalUrl: string | null | undefined = staged.staged_attachment_url;
      if (finalUrl && finalUrl.startsWith('data:')) {
        try {
          const up = await api.post('/chat/upload-attachment', {
            kind: staged.staged_attachment_kind || 'file',
            data_url: finalUrl,
            filename: staged.staged_attachment_name,
          });
          finalUrl = up.data?.url || finalUrl;
        } catch (upErr: any) {
          // eslint-disable-next-line no-console
          console.warn('chat upload failed, sending data URL inline:', upErr?.message || upErr);
        }
      }
      const r = await api.post('/chat/message', {
        text: staged.staged_text || '',
        project_id: staged.staged_project_id || null,
        attachment_url: finalUrl,
        attachment_name: staged.staged_attachment_name,
        attachment_kind: staged.staged_attachment_kind,
        attachment_duration_sec: staged.staged_attachment_duration_sec,
      });
      const server: ChatMsg | undefined = r.data?.messages?.[0];
      // Mutate the optimistic bubble in place — never append a duplicate.
      setMessages((prev) => prev.map((m) => {
        if (m._local?.local_id !== local_id) return m;
        return {
          ...m,
          ...(server || {}),
          // Replace the staged data URL with the persisted server URL so the
          // VoicePlayer/Image switch from a heavy blob to the CDN reference.
          attachment_url: server?.attachment_url || finalUrl || m.attachment_url,
          _local: {
            ...m._local!,
            upload_status: 'uploaded',
            // Drop staged payload — it's only needed for retry, and we succeeded.
            staged_attachment_url: null,
          },
        };
      }));
    } catch (e: any) {
      setMessages((prev) => prev.map((m) =>
        m._local?.local_id === local_id
          ? { ...m, _local: { ...m._local!, upload_status: 'failed' } }
          : m,
      ));
    }
  }, [pidParam]);

  const retryDelivery = useCallback((local_id: string) => {
    setMessages((prev) => prev.map((m) =>
      m._local?.local_id === local_id
        ? { ...m, _local: { ...m._local!, upload_status: 'retrying' } }
        : m,
    ));
    // Kick off the same delivery routine — it reads the staged payload from state.
    void deliverMessage(local_id);
  }, [deliverMessage]);

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    const hasAttach = !!attachment;
    if (!text && !hasAttach) return;
    // Just-in-time auth: anonymous users can browse the chat seed/marketing,
    // but sending a message is gated. AuthGate will replay this exact send
    // after verify, so the user doesn't lose their message.
    requireAuth(async () => {
      const stagedAttachment = attachment;
      const stagedName = attachmentName;
      const stagedKind = (attachmentKind || (attachment ? 'image' : null)) as LocalTransport['staged_attachment_kind'];
      const stagedDuration = attachmentDuration;
      // Clear the composer immediately so it feels live.
      setInput('');
      setAttachment(null);
      setAttachmentName(null);
      setAttachmentKind(null);
      setAttachmentDuration(null);
      setShowEmoji(false);

      // Optimistic bubble — appears BEFORE upload completes.
      const local_id = `tmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: ChatMsg = {
        id: local_id,
        type: 'user',
        text: text || (stagedKind === 'voice' ? '[voice]' : stagedKind === 'file' ? '[file]' : stagedAttachment ? '[image]' : ''),
        attachment_url: stagedAttachment,
        attachment_name: stagedName,
        attachment_kind: stagedKind,
        attachment_duration_sec: stagedDuration,
        project_id: pidParam || null,
        created_at: new Date().toISOString(),
        _local: {
          local_id,
          upload_status: 'uploading',
          staged_attachment_url: stagedAttachment,
          staged_attachment_name: stagedName,
          staged_attachment_kind: stagedKind,
          staged_attachment_duration_sec: stagedDuration,
          staged_text: text,
          staged_project_id: pidParam || null,
        },
      };
      setMessages((prev) => [...prev, optimistic]);
      // Don't block the composer — the user can start typing the next message.
      void deliverMessage(local_id);
    }, 'Save your conversation');
  };

  // Image attach (gallery). Native + web both go through expo-image-picker;
  // base64 → data URL so the backend doesn't need a separate upload endpoint.
  const pickAttachment = async () => {
    setShowAttachMenu(false);
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
      const a = r.assets[0];
      setAttachment(`data:image/jpeg;base64,${a.base64}`);
      setAttachmentName(a.fileName || 'photo.jpg');
      setAttachmentKind('image');
      setAttachmentDuration(null);
    } catch (e: any) {
      Alert.alert('Attach', String(e?.message || e));
    }
  };

  // File attach via expo-document-picker → data URL (base64) for backend storage.
  const pickFile = async () => {
    setShowAttachMenu(false);
    try {
      const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0];
      // Try to fetch & convert to base64 data URL so backend doesn't need a separate upload route.
      let dataUrl = a.uri;
      try {
        const resp = await fetch(a.uri);
        const blob = await resp.blob();
        const b64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result || ''));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        dataUrl = b64;
      } catch { /* keep file uri if data URL conversion fails */ }
      setAttachment(dataUrl);
      setAttachmentName(a.name || 'file');
      setAttachmentKind('file');
      setAttachmentDuration(null);
    } catch (e: any) {
      Alert.alert('Attach file', String(e?.message || e));
    }
  };

  // Location attach: capture current coords and send as a text-shaped attachment.
  const pickLocation = async () => {
    setShowAttachMenu(false);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'We need location access to share your position.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = loc.coords.latitude.toFixed(6);
      const lng = loc.coords.longitude.toFixed(6);
      const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
      // Inline into the input so user can add a comment and send.
      setInput((p) => (p ? `${p}\n📍 ${mapsUrl}` : `📍 ${mapsUrl}`));
    } catch (e: any) {
      Alert.alert('Location', String(e?.message || e));
    }
  };

  // Voice recording — start on long-press of mic. Release sends, swipe-left cancels.
  const startRecording = async () => {
    try {
      // Web: HTTPS + user gesture required for navigator.mediaDevices.getUserMedia.
      // Preview URL is HTTPS and onLongPress IS a user gesture, so we just need
      // a helpful error message when permission is denied or context is insecure.
      if (Platform.OS === 'web') {
        const isSecure = typeof window !== 'undefined'
          && (window.isSecureContext || window.location.protocol === 'https:' || window.location.hostname === 'localhost');
        if (!isSecure) {
          Alert.alert(
            'Голосовые сообщения недоступны',
            'Браузер блокирует доступ к микрофону на небезопасном соединении. Откройте сайт по HTTPS.',
          );
          return;
        }
        // Pre-check via navigator.mediaDevices so denial is surfaced clearly.
        try {
          const stream = await (navigator as any).mediaDevices?.getUserMedia?.({ audio: true });
          if (stream && typeof stream.getTracks === 'function') {
            // Release the probe stream immediately — expo-audio will request its own.
            stream.getTracks().forEach((t: any) => t.stop?.());
          }
        } catch (e: any) {
          const name = e?.name || '';
          if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            Alert.alert('Нет доступа к микрофону', 'Разрешите доступ к микрофону в настройках браузера и попробуйте снова.');
          } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
            Alert.alert('Микрофон не найден', 'Подключите микрофон и попробуйте снова.');
          } else {
            Alert.alert('Микрофон', String(e?.message || e));
          }
          return;
        }
      }
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Нет доступа к микрофону',
          Platform.OS === 'web'
            ? 'Разрешите доступ к микрофону в настройках браузера и попробуйте снова.'
            : 'Откройте настройки приложения и разрешите доступ к микрофону.',
        );
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingStartRef.current = Date.now();
      swipeXRef.current = 0;
      setSwipeOffsetX(0);
      setIsRecording(true);
    } catch (e: any) {
      Alert.alert('Запись', String(e?.message || e));
    }
  };

  const cancelRecording = async () => {
    if (!isRecordingRef.current) return;
    setIsRecording(false);
    setSwipeOffsetX(0);
    swipeXRef.current = 0;
    try { await recorder.stop(); } catch { /* ignore */ }
  };

  const stopRecordingAndSend = async () => {
    if (!isRecordingRef.current) return;
    const elapsed = Date.now() - recordingStartRef.current;
    setIsRecording(false);
    setSwipeOffsetX(0);
    swipeXRef.current = 0;
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri || elapsed < 400) {
        // too short — discard (Telegram behavior on tap rather than long-press)
        return;
      }
      // Convert to base64 data URL for transport.
      let dataUrl = uri;
      try {
        const resp = await fetch(uri);
        const blob = await resp.blob();
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result || ''));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch { /* keep uri */ }
      setAttachment(dataUrl);
      setAttachmentName(`voice_${Math.round(elapsed / 1000)}s.m4a`);
      setAttachmentKind('voice');
      setAttachmentDuration(Math.max(1, Math.round(elapsed / 1000)));
      // Auto-send the voice message immediately.
      setTimeout(() => { void send(''); }, 50);
    } catch (e: any) {
      Alert.alert('Запись', String(e?.message || e));
    }
  };

  // PanResponder on the send/mic button:
  //  - empty input: long-press starts recording, release sends, swipe-left cancels.
  //  - has text/attachment: any tap sends (no recording path).
  const sendPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      swipeXRef.current = 0;
      // If composer has content, this is a tap-to-send press. Skip long-press logic.
      if (input.trim() || attachment) return;
      // Schedule recording after 250ms hold.
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = setTimeout(() => { void startRecording(); }, 250);
    },
    onPanResponderMove: (_, gesture) => {
      if (isRecordingRef.current) {
        // Only track leftward swipe (negative dx); cap at 0 so right-drag is ignored.
        const dx = Math.min(0, gesture.dx);
        swipeXRef.current = dx;
        setSwipeOffsetX(dx);
      }
    },
    onPanResponderRelease: () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (input.trim() || attachment) {
        void send();
        return;
      }
      if (isRecordingRef.current) {
        if (swipeXRef.current < -SWIPE_CANCEL_THRESHOLD) {
          void cancelRecording();
        } else {
          void stopRecordingAndSend();
        }
      }
    },
    onPanResponderTerminate: () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      // Treat termination (e.g. swipe gesture stolen by parent) same as cancel
      // when we were recording, so we don't leave the recorder running.
      if (isRecordingRef.current) void cancelRecording();
    },
  // Dependencies must be empty to keep handlers stable for the gesture lifecycle.
  // Latest input/attachment are read via the closure each press; React re-renders
  // re-create the handlers as the deps `input` and `attachment` change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [input, attachment]);

  const addEmoji = (emo: string) => setInput((p) => p + emo);

  const runAction = async (m: ChatMsg, a: ChatAction) => {
    try {
      if (a.action === 'approve_deliverable' && a.entity_id) {
        await api.post(`/client/deliverables/${a.entity_id}/approve`);
      } else if (a.action === 'reject_deliverable' && a.entity_id) {
        await api.post(`/client/deliverables/${a.entity_id}/reject`, { reason: 'Requested changes from chat' });
      } else if (a.action === 'pay_invoice' && a.entity_id) {
        const r = await payInvoiceWithGate(a.entity_id, {
          projectId: (a as any).project_id || (m as any).project_id || null,
          router,
        });
        if (r.ok === false && r.redirected) {
          // Soft redirect — flow-driven, not error-driven.
          return;
        }
        if (r.ok === false && !r.redirected) {
          throw r.error;
        }
      } else if (a.action === 'view_modules' && a.entity_id) {
        // Drop the user into the live workspace for this project.
        router.push(`/client/projects/${a.entity_id}` as any);
        return;
      } else if (a.action === 'add_feature') {
        // Pre-load input so the user can type details without thinking
        // about how to phrase the first message.
        setInput('I want to add: ');
        return;
      } else if (a.action === 'ask_included') {
        // Auto-send the question — chip becomes a one-tap conversation starter.
        await send("What's included in my project?");
        // Clear the chips so the user knows their tap was accepted.
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, actions: [] } : x)));
        return;
      } else {
        Alert.alert('Action', `${a.label} sent.`);
        return;
      }
      // Clear that action message — user has acted on it.
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, actions: [] } : x)));
      Alert.alert('Done', `${a.label}: success.`);
      refresh();
    } catch (e: any) {
      Alert.alert('Action failed', e?.response?.data?.detail || 'Try again.');
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[s.header, { paddingTop: Math.max(insets.top, 8) }]}>
        <TouchableOpacity testID="chat-close" onPress={() => router.back()} style={s.headerBtn}>
          <Ionicons name="close" size={22} color={T.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Chat</Text>
        <View style={s.headerBtn} />
      </View>

      {/* Feed */}
      <ScrollView
        ref={scrollRef}
        style={s.feed}
        contentContainerStyle={s.feedContent}
        keyboardShouldPersistTaps="handled"
        testID="chat-feed"
      >
        {loading ? (
          <View style={s.empty}><ActivityIndicator color={T.primary} /></View>
        ) : messages.length === 0 ? (
          <View style={s.empty}><Text style={{ color: T.textMuted }}>No messages yet.</Text></View>
        ) : messages.map((m) => {
          const isUser = m.type === 'user';
          const st = TYPE_STYLE[m.type] || TYPE_STYLE.system;
          const tx = m._local?.upload_status;
          const isInflight = tx === 'uploading' || tx === 'retrying';
          const isFailed = tx === 'failed';
          return (
            <View
              key={m.id}
              testID={`chat-msg-${m.id}`}
              onLayout={(e) => { offsets.current[m.id] = e.nativeEvent.layout.y; }}
              style={[s.msgRow, isUser && { justifyContent: 'flex-end' }]}
            >
              <View style={[
                s.msgBubble,
                { backgroundColor: st.bg, borderColor: st.border },
                isUser && { maxWidth: '78%' },
                isFailed && { borderColor: T.danger },
              ]}>
                {!isUser ? (
                  <Text style={[s.msgKind, { color: st.accent }]}>
                    {m.type.toUpperCase()}
                  </Text>
                ) : null}
                <View style={isInflight ? { opacity: 0.55 } : null}>
                  {/* Skip rendering backend placeholder text like "[voice]"/"[image]"/"[file]"
                      when a real attachment is present — the rich preview below already
                      conveys what the message is, and the bracketed text just adds noise. */}
                  {(() => {
                    const isPlaceholder = m.attachment_url && (
                      m.text === '[voice]' || m.text === '[image]' || m.text === '[file]' || m.text === '[attachment]'
                    );
                    if (!m.text || isPlaceholder) return null;
                    return <Text style={s.msgText}>{m.text}</Text>;
                  })()}
                  {m.attachment_url ? (
                    m.attachment_kind === 'voice' ? (
                      <VoicePlayer
                        uri={m.attachment_url}
                        duration={m.attachment_duration_sec || 0}
                        testID={`chat-msg-voice-${m.id}`}
                        tintColor={isUser ? T.primaryInk : T.primary}
                        onColor={isUser ? T.primaryInk : T.text}
                        offColor={isUser ? T.primaryInk : T.textMuted}
                        isUser={isUser}
                      />
                    ) : m.attachment_kind === 'file' ? (
                      <View style={s.fileCard} testID={`chat-msg-file-${m.id}`}>
                        <Ionicons name="document" size={28} color={T.primary} />
                        <Text style={s.fileName} numberOfLines={1}>
                          {m.attachment_name || 'file'}
                        </Text>
                      </View>
                    ) : (
                      <Image
                        source={{ uri: m.attachment_url }}
                        style={s.msgImage}
                        testID={`chat-msg-attachment-${m.id}`}
                      />
                    )
                  ) : null}
                </View>
                {/* Delivery trust layer — bubble IS the surface.
                    uploading/retrying → tiny inline spinner (no label noise).
                    failed → red retry pill that mutates THIS bubble (no duplicates).
                    uploaded → silent (nothing rendered). */}
                {isInflight ? (
                  <View style={s.txInflight} testID={`chat-msg-status-${m.id}`}>
                    <ActivityIndicator size="small" color={T.textMuted} />
                  </View>
                ) : null}
                {isFailed ? (
                  <TouchableOpacity
                    testID={`chat-msg-retry-${m.id}`}
                    onPress={() => retryDelivery(m._local!.local_id)}
                    style={s.txRetry}
                    hitSlop={6}
                  >
                    <Ionicons name="refresh" size={14} color={T.danger} />
                    <Text style={s.txRetryText}>Не отправлено · повторить</Text>
                  </TouchableOpacity>
                ) : null}
                {(m.actions && m.actions.length > 0) ? (
                  <View style={s.actionRow}>
                    {m.actions.map((a, i) => (
                      <TouchableOpacity
                        key={i}
                        testID={`chat-action-${m.id}-${i}`}
                        style={[
                          s.actionBtn,
                          a.action === 'approve_deliverable' && { backgroundColor: T.primary },
                          a.action === 'pay_invoice' && { backgroundColor: T.warning },
                        ]}
                        onPress={() => runAction(m, a)}
                      >
                        <Text style={[
                          s.actionText,
                          (a.action === 'approve_deliverable' || a.action === 'pay_invoice') && { color: T.primaryInk },
                        ]}>
                          {a.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
        {/* Phase 3.D — pending contract one-shot. Surfaces the "Review & Start"
            CTA inside the conversation thread the user is already in. */}
        {(me as any)?.pending_contract ? (
          <View style={s.msgRow} testID="chat-msg-pending-contract">
            <View style={[s.msgBubble, { backgroundColor: '#F59E0B14', borderColor: '#F59E0B66' }]}>
              <Text style={[s.msgKind, { color: T.warning }]}>READY TO START</Text>
              <Text style={s.msgText}>
                Your project is ready to start. Review the agreement and tap Accept to launch development.
              </Text>
              <View style={s.actionRow}>
                <TouchableOpacity
                  testID="chat-pending-contract-review"
                  style={[s.actionBtn, { backgroundColor: T.warning }]}
                  onPress={() => router.push(`/client/contract/${(me as any).pending_contract.project_id}` as any)}
                >
                  <Text style={[s.actionText, { color: T.primaryInk }]}>Review &amp; Start</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}

        {/* Phase 2.A — referral one-shot announce. Only when eligible AND not yet seen. */}
        {refAnnounce ? (
          <View style={s.msgRow} testID="chat-msg-referral-announce">
            <View style={[s.msgBubble, { backgroundColor: T.primaryBg, borderColor: T.primaryBg }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[s.msgKind, { color: T.success }]}>EARN</Text>
                <TouchableOpacity
                  testID="chat-referral-dismiss"
                  onPress={dismissReferralAnnounce}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={14} color={T.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={s.msgText}>
                You can now earn from referrals — get 7% from every project you bring.
              </Text>
              <View style={s.actionRow}>
                <TouchableOpacity
                  testID="chat-referral-get-link"
                  style={[s.actionBtn, { backgroundColor: T.primary }]}
                  onPress={() => {
                    void dismissReferralAnnounce();
                    router.push('/client/referrals' as any);
                  }}
                >
                  <Text style={[s.actionText, { color: T.primaryInk }]}>Get my link</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Quick commands — chip row above input */}
      <View style={s.quickRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {QUICK.map((q) => (
            <TouchableOpacity
              key={q}
              testID={`chat-quick-${q.replace(/\W/g, '_')}`}
              style={s.quickChip}
              onPress={() => send(q)}
              disabled={sending}
            >
              <Text style={s.quickText}>{q}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Emoji picker — toggled by smiley btn */}
      {showEmoji ? (
        <View style={s.emojiRow} testID="chat-emoji-row">
          {EMOJIS.map((e) => (
            <TouchableOpacity
              key={e}
              style={s.emojiBtn}
              onPress={() => addEmoji(e)}
              testID={`chat-emoji-${e}`}
              activeOpacity={0.7}
            >
              <Text style={s.emojiText}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {/* Pending attachment preview — sits above the input row */}
      {attachment ? (
        <View style={s.attachPreview} testID="chat-attachment-preview">
          <Image source={{ uri: attachment }} style={s.attachThumb} />
          <Text style={s.attachLabel} numberOfLines={1}>
            {attachmentName || 'Image'} — ready to send
          </Text>
          <TouchableOpacity
            onPress={() => { setAttachment(null); setAttachmentName(null); }}
            hitSlop={8}
            testID="chat-attachment-clear"
          >
            <Ionicons name="close-circle" size={20} color={T.danger} />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Input — Telegram-style: icons hidden while empty, long-press mic to record, attach menu */}
      <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <View style={[s.inputPill, isRecording && s.inputPillRec]}>
          {(input.length > 0 || attachment) && !isRecording ? (
            <TouchableOpacity
              testID="chat-emoji-toggle"
              onPress={() => setShowEmoji((v) => !v)}
              style={s.inlineIconBtn}
              hitSlop={8}
              disabled={sending}
            >
              <Ionicons
                name={showEmoji ? 'happy' : 'happy-outline'}
                size={22}
                color={showEmoji ? T.primary : T.textMuted}
              />
            </TouchableOpacity>
          ) : null}
          {isRecording ? (
            <View style={s.recPill}>
              <View style={s.recDot} />
              <WaveformBars recorder={recorder} active={isRecording} color={T.danger} />
              <Text style={s.recHint} numberOfLines={1}>
                {swipeOffsetX < -SWIPE_CANCEL_THRESHOLD
                  ? 'Отпустите чтобы отменить'
                  : '← смахните чтобы отменить'}
              </Text>
            </View>
          ) : (
            <TextInput
              testID="chat-input"
              style={[s.input, (input.length === 0 && !attachment) ? s.inputEmpty : null]}
              placeholder="Сообщение"
              placeholderTextColor={T.textMuted}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => send()}
              returnKeyType="send"
              editable={!sending}
              multiline
            />
          )}
          {(input.length > 0 || attachment) && !isRecording ? (
            <TouchableOpacity
              testID="chat-attach"
              onPress={() => setShowAttachMenu(true)}
              style={s.inlineIconBtn}
              hitSlop={8}
              disabled={sending}
            >
              <Ionicons name="attach" size={22} color={T.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
        <View
          testID="chat-send"
          {...sendPanResponder.panHandlers}
          style={[
            s.sendBtn,
            isRecording && s.sendBtnRec,
            isRecording && swipeOffsetX < -SWIPE_CANCEL_THRESHOLD && s.sendBtnCancel,
            sending ? { opacity: 0.45 } : null,
            // While recording, follow the finger horizontally (capped at -threshold * 2).
            isRecording ? { transform: [{ translateX: Math.max(swipeOffsetX, -SWIPE_CANCEL_THRESHOLD * 2) }, { scale: 1.15 }] } : null,
          ]}
        >
          {sending ? <ActivityIndicator color={T.bg} size="small" /> : (
            <Ionicons
              name={
                isRecording
                  ? (swipeOffsetX < -SWIPE_CANCEL_THRESHOLD ? 'trash' : 'stop')
                  : ((input.trim() || attachment) ? 'arrow-up' : 'mic')
              }
              size={20}
              color={T.bg}
            />
          )}
        </View>
      </View>

      {/* Attach menu modal — Photo / File / Location */}
      <Modal
        visible={showAttachMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAttachMenu(false)}
      >
        <Pressable style={s.menuBackdrop} onPress={() => setShowAttachMenu(false)}>
          <Pressable style={s.menuCard} onPress={() => {}}>
            <Text style={s.menuTitle}>Прикрепить</Text>
            <TouchableOpacity testID="chat-attach-photo" style={s.menuRow} onPress={pickAttachment}>
              <View style={[s.menuIcon, { backgroundColor: T.infoBg }]}>
                <Ionicons name="image" size={22} color={T.info} />
              </View>
              <Text style={s.menuLabel}>Фото</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="chat-attach-file" style={s.menuRow} onPress={pickFile}>
              <View style={[s.menuIcon, { backgroundColor: T.warningBg }]}>
                <Ionicons name="document" size={22} color={T.warning} />
              </View>
              <Text style={s.menuLabel}>Файл</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="chat-attach-location" style={s.menuRow} onPress={pickLocation}>
              <View style={[s.menuIcon, { backgroundColor: T.primaryBg }]}>
                <Ionicons name="location" size={22} color={T.primary} />
              </View>
              <Text style={s.menuLabel}>Геолокация</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// -------------------------------------------------------------------------
// VoicePlayer — Telegram-style audio bubble: play/pause + progress + duration.
// Uses expo-audio's useAudioPlayer hook so playback works on web (HTMLAudio)
// and native (AVPlayer / ExoPlayer) without us touching the platform code.
// -------------------------------------------------------------------------

// Session-scope memory: last speed the user picked stays around between
// remounts within the same session, but resets on page reload. Intentionally
// a module-level variable — speed is player-local intent, not global state,
// so we don't put it in storage or context.
let _lastVoiceSpeed = 1;
const SPEED_CYCLE: number[] = [1, 1.5, 2];

function VoicePlayer({
  uri, duration, testID, tintColor, onColor, offColor, isUser,
}: {
  uri: string;
  duration: number;
  testID?: string;
  tintColor: string;
  onColor: string;
  offColor: string;
  isUser?: boolean;
}) {
  const player = useAudioPlayer(uri, { updateInterval: 100 });
  // Reactive status from expo-audio (fires PLAYBACK_STATUS_UPDATE at the
  // updateInterval above). This is what gives us live currentTime/duration
  // without needing a polling setInterval — and it's the only path that
  // reliably re-renders on web, where the SharedObject's direct getters
  // don't notify React.
  const status = useAudioPlayerStatus(player);
  const isPlaying = Boolean(status?.playing);
  const [scrubProgress, setScrubProgress] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number>(_lastVoiceSpeed);
  const barsRowWidthRef = useRef(0);
  // Apply playbackRate to the underlying player. expo-audio exposes both
  // `setPlaybackRate(rate, pitchCorrectionQuality?)` and a `playbackRate`
  // property setter that mirrors the underlying media element on web.
  // Setting both makes the same code work on iOS, Android, and the browser.
  const applySpeed = useCallback((rate: number) => {
    const p: any = player;
    if (!p) return false;
    let applied = false;
    // Method form (preferred on native — does pitch correction).
    try {
      if (typeof p.setPlaybackRate === 'function') {
        p.setPlaybackRate(rate, 'high');
        applied = true;
      }
    } catch { /* fall through */ }
    // Property setter form (works on web HTMLAudio; harmless on native).
    try { p.playbackRate = rate; applied = true; } catch { /* ignore */ }
    // Web fallback: expo-audio's web AudioPlayer stores the <audio> element
    // on `.media`. Touch it directly so the rate sticks if the property
    // setter is shadowed by the shared-object proxy.
    try {
      const el = p.media || p._audioElement || p.element || p._element;
      if (el && typeof el.playbackRate !== 'undefined') {
        el.playbackRate = rate;
        el.defaultPlaybackRate = rate;
        if ('preservesPitch' in el) (el as any).preservesPitch = true;
        applied = true;
      }
    } catch { /* ignore */ }
    return applied;
  }, [player]);
  // Re-apply speed whenever it changes or playback resumes — some web engines
  // reset rate on play()/seekTo(). Pause doesn't reset rate, but we still
  // re-apply defensively when toggling.
  useEffect(() => { applySpeed(speed); }, [speed, applySpeed]);
  useEffect(() => {
    if (isPlaying) applySpeed(speed);
  }, [isPlaying, applySpeed, speed]);
  // Read live position from the status event payload (fires at updateInterval).
  // `status` already triggers re-renders, so no manual setInterval is needed.
  const cur = Number(status?.currentTime || 0);
  const playerDur = Number(status?.duration || 0);
  const total = (Number.isFinite(playerDur) && playerDur > 0)
    ? playerDur
    : (duration > 0 ? duration : 0);
  const livedProgress = total > 0 ? Math.min(1, Math.max(0, cur / total)) : 0;
  const progress = scrubProgress != null ? scrubProgress : livedProgress;
  const fmt = (sec: number) => {
    const s = Math.max(0, Math.round(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  };
  const toggle = () => {
    try {
      if (isPlaying) {
        (player as any).pause?.();
      } else {
        if (total > 0 && cur >= total - 0.05) {
          (player as any).seekTo?.(0);
        }
        (player as any).play?.();
        // Reapply on resume — some browsers reset rate on play().
        applySpeed(speed);
      }
    } catch { /* ignore */ }
  };
  const cycleSpeed = () => {
    const idx = SPEED_CYCLE.indexOf(speed);
    const next = SPEED_CYCLE[(idx + 1) % SPEED_CYCLE.length];
    _lastVoiceSpeed = next;
    setSpeed(next);
    // useEffect on `speed` will call applySpeed — works whether paused or playing.
  };
  const seekToProgress = (p: number) => {
    if (total <= 0) return;
    const target = Math.max(0, Math.min(total, total * p));
    try {
      (player as any).seekTo?.(target);
      // Speed must survive scrub. Some engines reset rate after seekTo; re-apply.
      applySpeed(speed);
    } catch { /* ignore */ }
  };
  // Scrub-to-seek: tap or drag along the waveform → seek to that point.
  // We capture the gesture only after a short delay to keep simple taps cheap
  // and avoid stealing scroll. Final position commits on release.
  const seekPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      const w = barsRowWidthRef.current;
      if (w <= 0) return;
      const x = (e.nativeEvent as any).locationX ?? 0;
      const p = Math.max(0, Math.min(1, x / w));
      setScrubProgress(p);
    },
    onPanResponderMove: (e) => {
      const w = barsRowWidthRef.current;
      if (w <= 0) return;
      const x = (e.nativeEvent as any).locationX ?? 0;
      const p = Math.max(0, Math.min(1, x / w));
      setScrubProgress(p);
    },
    onPanResponderRelease: () => {
      if (scrubProgress != null) {
        seekToProgress(scrubProgress);
      }
      setScrubProgress(null);
    },
    onPanResponderTerminate: () => { setScrubProgress(null); },
  // Re-create when total changes so the closure has the right duration.
  // scrubProgress intentionally stays in deps for the release commit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [total, scrubProgress]);
  // Static 28-bar waveform for the bubble — deterministic from URI hash.
  const bars = useMemo(() => {
    const seed = (uri || '').split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 7);
    const out: number[] = [];
    let s = seed || 1;
    for (let i = 0; i < 28; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      out.push(0.25 + ((s >>> 8) % 100) / 140);
    }
    return out;
  }, [uri]);
  const speedLabel = speed === 1 ? '1×' : speed === 1.5 ? '1.5×' : '2×';
  const displayTime = scrubProgress != null
    ? total * scrubProgress
    : (isPlaying || cur > 0 ? cur : total);
  return (
    <View style={vp.row} testID={testID}>
      <TouchableOpacity
        onPress={toggle}
        style={[vp.btn, { backgroundColor: tintColor }]}
        testID={`${testID}-toggle`}
        hitSlop={6}
      >
        <Ionicons name={isPlaying ? 'pause' : 'play'} size={18} color={T.bg} />
      </TouchableOpacity>
      <View style={vp.barsWrap}>
        <View
          style={vp.barsRow}
          {...seekPanResponder.panHandlers}
          onLayout={(e) => { barsRowWidthRef.current = e.nativeEvent.layout.width; }}
          testID={`${testID}-scrub`}
        >
          {bars.map((h, i) => {
            const filled = (i + 0.5) / bars.length <= progress;
            return (
              <View
                key={i}
                pointerEvents="none"
                style={[
                  vp.bar,
                  {
                    height: 5 + h * 18,
                    backgroundColor: filled ? onColor : offColor,
                    opacity: filled ? 1 : (isUser ? 0.4 : 0.5),
                  },
                ]}
              />
            );
          })}
        </View>
        <View style={vp.metaRow}>
          <Text style={[vp.time, { color: offColor }]}>
            {fmt(displayTime)}
          </Text>
          <Text style={[vp.time, { color: offColor, opacity: 0.6 }]}>
            {' / '}{fmt(total)}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        testID={`${testID}-speed`}
        onPress={cycleSpeed}
        hitSlop={8}
        activeOpacity={0.7}
        style={[
          vp.speedBtn,
          speed === 1
            ? { backgroundColor: 'transparent', borderColor: offColor }
            : { backgroundColor: tintColor, borderColor: tintColor },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            vp.speedText,
            { color: speed === 1 ? onColor : T.bg },
          ]}
        >
          {speedLabel}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const vp = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    minWidth: 220,
    flex: 1,
  },
  btn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  barsWrap: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    justifyContent: 'center',
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 26,
  },
  bar: { width: 3, borderRadius: 1.5 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  time: { fontSize: 11, fontWeight: '600' },
  speedBtn: {
    minWidth: 44,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    paddingHorizontal: 8,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    alignSelf: 'center',
  },
  speedText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
    includeFontPadding: false,
    textAlign: 'center',
    lineHeight: 13,
  },
});

// -------------------------------------------------------------------------
// WaveformBars — animated bars driven by recorder metering during recording.
// Reads `recorder.getStatus().metering` (dBFS, -160..0) on a 100ms interval.
// -------------------------------------------------------------------------
function WaveformBars({ recorder, active, color }: { recorder: any; active: boolean; color: string }) {
  const [levels, setLevels] = useState<number[]>(() => Array(28).fill(0.05));
  useEffect(() => {
    if (!active) {
      setLevels(Array(28).fill(0.05));
      return;
    }
    let cancelled = false;
    const id = setInterval(() => {
      try {
        const st = recorder?.getStatus?.();
        const m: number | undefined = st?.metering;
        // metering is dBFS: -160 (silent) → 0 (max). Map to 0..1 with curve.
        let v = 0.1;
        if (typeof m === 'number') {
          const n = Math.max(0, Math.min(1, (m + 60) / 60)); // -60..0 → 0..1
          v = 0.1 + n * 0.9;
        } else {
          // Fallback: random pulse (web sometimes doesn't expose metering).
          v = 0.2 + Math.random() * 0.5;
        }
        if (cancelled) return;
        setLevels((prev) => {
          const next = prev.slice(1);
          next.push(v);
          return next;
        });
      } catch { /* ignore */ }
    }, 90);
    return () => { cancelled = true; clearInterval(id); };
  }, [active, recorder]);
  return (
    <View style={wf.row}>
      {levels.map((v, i) => (
        <View
          key={i}
          style={[wf.bar, { height: 4 + v * 20, backgroundColor: color }]}
        />
      ))}
    </View>
  );
}

const wf = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    height: 26, flex: 1,
  },
  bar: { width: 2.5, borderRadius: 1.5 },
});

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: T.md, paddingBottom: 10,
    backgroundColor: T.surface1,
    borderBottomWidth: 1, borderBottomColor: T.border,
  },
  headerBtn: { width: 40, alignItems: 'flex-start' },
  headerTitle: { color: T.text, fontSize: T.h3, fontWeight: '800' },

  feed: { flex: 1 },
  feedContent: { padding: T.md, gap: 8 },
  empty: { alignItems: 'center', paddingVertical: 40 },

  msgRow: { flexDirection: 'row', marginBottom: 6 },
  msgBubble: {
    maxWidth: '88%',
    borderRadius: T.radius,
    borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10,
    position: 'relative',
  },
  msgKind: {
    fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginBottom: 4,
  },
  msgText: { color: T.text, fontSize: T.body, lineHeight: 22 },
  msgImage: {
    width: 240, height: 160,
    borderRadius: T.radiusSm,
    marginTop: 8,
    backgroundColor: T.surface2,
  },

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

  composerIconBtn: {
    width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 8,
  },

  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  actionBtn: {
    backgroundColor: T.surface2,
    borderWidth: 1, borderColor: T.border,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 8,
  },
  actionText: { color: T.text, fontSize: T.small, fontWeight: '700' },

  quickRow: {
    paddingHorizontal: T.md, paddingTop: 6, paddingBottom: 6,
    backgroundColor: T.bg,
  },
  quickChip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    marginRight: 8,
  },
  quickText: { color: T.textMuted, fontSize: T.small, fontWeight: '600' },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: T.md, paddingTop: 8,
    backgroundColor: T.surface1,
    borderTopWidth: 1, borderTopColor: T.border,
  },
  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: T.bg,
    borderWidth: 1, borderColor: T.border, borderRadius: 22,
    paddingHorizontal: 4,
    minHeight: 44,
  },
  inlineIconBtn: {
    width: 36, height: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  input: {
    flex: 1,
    color: T.text,
    backgroundColor: 'transparent',
    paddingHorizontal: 8, paddingTop: 11, paddingBottom: 11,
    fontSize: T.body,
    maxHeight: 110,
    minHeight: 44,
    textAlignVertical: 'center',
  },
  inputEmpty: {
    // Extra left padding when icons are hidden — placeholder doesn't hug the border.
    paddingLeft: 16,
  },
  inputPillRec: {
    borderColor: T.danger,
    backgroundColor: T.dangerBg,
  },
  recPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
    gap: 10,
    minHeight: 44,
  },
  recDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: T.danger,
  },
  recText: {
    color: T.text, fontSize: T.small, fontWeight: '600',
    flex: 1,
  },
  recHint: {
    color: T.textMuted, fontSize: T.small, fontWeight: '500',
  },
  fileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: T.surface2,
    borderWidth: 1, borderColor: T.border, borderRadius: 12,
    marginTop: 8,
    minWidth: 200,
  },
  fileName: {
    color: T.text, fontSize: T.body, fontWeight: '600',
    flex: 1,
  },
  txInflight: {
    position: 'absolute',
    top: 6, right: 6,
  },
  txRetry: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: T.dangerBg,
    alignSelf: 'flex-start',
  },
  txRetryText: { color: T.danger, fontSize: 12, fontWeight: '600' },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: T.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnRec: {
    backgroundColor: T.danger,
    transform: [{ scale: 1.15 }],
  },
  sendBtnCancel: {
    backgroundColor: T.danger,
    boxShadow: `0 0 0 4px ${T.dangerBg}`,
  },

  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  menuCard: {
    backgroundColor: T.surface1,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: T.md, paddingTop: 14, paddingBottom: 28,
    gap: 4,
  },
  menuTitle: {
    color: T.textMuted, fontSize: T.small, fontWeight: '700',
    letterSpacing: 0.5, textTransform: 'uppercase',
    marginBottom: 8, paddingHorizontal: 8,
  },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 12, paddingHorizontal: 8,
    borderRadius: 12,
  },
  menuIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  menuLabel: { color: T.text, fontSize: T.body, fontWeight: '600' },
});
