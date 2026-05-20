// Help & Support — client surface.
//
// Two-pane experience:
//   1. FAQ — accordions covering how the platform works for clients
//      (what EVA-X is, how a project moves through stages, money,
//      delivery, edits, refunds, 2FA, data export). Static content,
//      versioned in this file. Search filters across question + answer.
//   2. Tickets — list of the client's own tickets + a real "Open a new
//      ticket" form (title, category, priority, description, optional
//      image attachment). Replaces the previous chat-message-only flow.
//
// Header comes from AppHeader (global) — we just render the content.

import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet, TouchableOpacity, Image,
  RefreshControl, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import api from '../src/api';
import T from '../src/theme';
import { StatusPill, EmptyState, SectionLabel } from '../src/ui-client';

type Ticket = {
  ticket_id: string;
  title: string;
  description?: string;
  ticket_type?: string;
  priority?: string;
  status: string;
  attachment_url?: string;
  created_at?: string;
  messages?: { text: string }[];
};

const FAQ: { q: string; a: string }[] = [
  {
    q: 'What is EVA-X?',
    a: 'EVA-X is a build-as-a-service platform. You describe the product you want, our operators assemble a team and a delivery plan, and the system manages the build from kickoff to launch. You stay in the loop without managing engineers directly.',
  },
  {
    q: 'How does a project actually get built?',
    a: 'Every project moves through five stages: Discovery → Scope → Design → Development → QA → Delivery. Each stage produces an artifact you approve (scope doc, design preview, working module, QA report). The system breaks the work into modules, assigns developers, and tracks progress in real time on your dashboard.',
  },
  {
    q: 'How do I start a new project?',
    a: 'Tap "Start new project" on your dashboard or use the EVA-X widget on the landing page. You answer four short questions (goal, audience, must-have features, deadline) and get a price + timeline estimate in under 10 seconds. No commitment until you approve the scope.',
  },
  {
    q: 'How is the price calculated?',
    a: 'Pricing is based on three things: scope (number of modules), complexity (integrations, custom logic), and timeline (rush jobs cost more). You see a fully-itemised breakdown before you pay anything. There are no hidden fees and no "we will quote later".',
  },
  {
    q: 'When and how do I pay?',
    a: 'You pay per milestone. Each invoice is tied to a specific deliverable — when QA approves it, the invoice is unlocked, you review the work, and pay. Payment is via Stripe (cards) or WayForPay (UA cards). Receipts appear under Billing.',
  },
  {
    q: 'Can I ask for changes during the build?',
    a: 'Yes. Use the "Request change" button on any module. Small clarifications are free; bigger scope changes generate a new mini-quote you approve before the team picks them up. This keeps the budget predictable.',
  },
  {
    q: 'Who owns the code and the design?',
    a: 'You do. From the moment a milestone is paid, the artifacts (code, designs, infrastructure scripts, copy) are fully transferred to your account. You can export the final repo from Project → Deliverables once the build is complete.',
  },
  {
    q: 'What happens if a developer is slow or unresponsive?',
    a: 'The system monitors every module in real time. If a developer is overloaded, idle, or missing a deadline, the AUTO-BALANCER reassigns the work to another qualified developer automatically. You do not need to escalate manually — but you can, via Support.',
  },
  {
    q: 'Refunds and disputes',
    a: 'If a deliverable does not meet the agreed scope, you can reject it in one tap. That opens a dispute, freezes the invoice, and a senior operator reviews it within 24h. If we agree the work is off-scope, the payment is refunded in full and the module is re-assigned. No "trust us, it is fine" — only signed scope counts.',
  },
  {
    q: 'How secure is my account? What is 2FA?',
    a: 'Login uses email + a one-time code (default) or email + password. You can turn on Two-Factor Authentication (Settings → Security) for an extra layer using any authenticator app (Google Authenticator, Authy, 1Password). Recovery codes are generated during setup — store them somewhere safe.',
  },
  {
    q: 'Can I export everything I have on EVA-X?',
    a: 'Yes. Go to Settings → Account → "Export my data". You get a JSON dump of your profile, all your projects, all invoices, support tickets, and notifications. You can do this any time at no charge.',
  },
  {
    q: 'How do I close my account?',
    a: 'Settings → Account → "Delete my account". You get a 7-day grace period — your data is soft-deleted and can be restored by support. After 7 days everything is purged. Live projects must be either completed or formally cancelled (with any open invoices settled) before deletion.',
  },
];

const TICKET_TYPE_SUGGESTIONS = ['Bug', 'Billing', 'Account', 'Integration', 'Feature request', 'Question'];

const PRIORITIES = [
  { key: 'low',    label: 'Low',    color: T.success },
  { key: 'medium', label: 'Medium', color: T.warn ?? T.primary },
  { key: 'high',   label: 'High',   color: T.danger },
];

export default function HelpAndSupport() {
  const router = useRouter();
  const [tab, setTab] = useState<'faq' | 'tickets'>('faq');
  const [search, setSearch] = useState('');
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [composeOpen, setComposeOpen] = useState(false);

  const filteredFaq = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return FAQ;
    return FAQ.filter((f) => f.q.toLowerCase().includes(s) || f.a.toLowerCase().includes(s));
  }, [search]);

  const loadTickets = async () => {
    setLoadingTickets(true);
    try {
      const r = await api.get('/client/support-tickets');
      setTickets(Array.isArray(r.data) ? r.data : (r.data?.tickets || []));
    } catch { setTickets([]); }
    finally { setLoadingTickets(false); setRefreshing(false); }
  };

  useEffect(() => {
    if (tab === 'tickets') loadTickets();
  }, [tab]);

  const ticketTone = (st: string): 'success' | 'risk' | 'info' | 'neutral' =>
    st === 'resolved' || st === 'closed' ? 'success' : st === 'open' ? 'risk' : 'info';

  return (
    <SafeAreaView style={s.flex} edges={['bottom']}>
      {/* Tab switch — FAQ vs Tickets */}
      <View style={s.tabs}>
        <TouchableOpacity
          testID="help-tab-faq"
          style={[s.tab, tab === 'faq' && s.tabActive]}
          onPress={() => setTab('faq')}
          activeOpacity={0.7}
        >
          <Ionicons name="book-outline" size={16} color={tab === 'faq' ? T.primary : T.textMuted} />
          <Text style={[s.tabText, tab === 'faq' && s.tabTextActive]}>FAQ</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="help-tab-tickets"
          style={[s.tab, tab === 'tickets' && s.tabActive]}
          onPress={() => setTab('tickets')}
          activeOpacity={0.7}
        >
          <Ionicons name="ticket-outline" size={16} color={tab === 'tickets' ? T.primary : T.textMuted} />
          <Text style={[s.tabText, tab === 'tickets' && s.tabTextActive]}>My tickets</Text>
        </TouchableOpacity>
      </View>

      {tab === 'faq' && (
        <ScrollView contentContainerStyle={s.content} testID="help-faq-pane">
          <View style={s.searchWrap}>
            <Ionicons name="search-outline" size={16} color={T.textMuted} />
            <TextInput
              testID="help-faq-search"
              style={s.searchInput}
              placeholder="Search the knowledge base…"
              placeholderTextColor={T.textMuted}
              value={search}
              onChangeText={setSearch}
            />
          </View>

          <Text style={s.lead}>
            Quick answers for the most common questions. Still stuck?{' '}
            <Text style={s.leadLink} onPress={() => setTab('tickets')}>Open a ticket →</Text>
          </Text>

          {filteredFaq.length === 0 && (
            <EmptyState
              icon="search-outline"
              title="No matches"
              sub="Try different words — or open a ticket and we'll get you a real answer."
            />
          )}

          {filteredFaq.map((f, i) => {
            const isOpen = openIdx === i;
            return (
              <TouchableOpacity
                key={f.q}
                testID={`faq-item-${i}`}
                activeOpacity={0.8}
                onPress={() => setOpenIdx(isOpen ? null : i)}
                style={s.faqItem}
              >
                <View style={s.faqHead}>
                  <Text style={s.faqQ}>{f.q}</Text>
                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={T.textMuted} />
                </View>
                {isOpen ? <Text style={s.faqA}>{f.a}</Text> : null}
              </TouchableOpacity>
            );
          })}

          <View style={{ height: 80 }} />
        </ScrollView>
      )}

      {tab === 'tickets' && (
        <ScrollView
          contentContainerStyle={s.content}
          testID="help-tickets-pane"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadTickets(); }} tintColor={T.primary} />}
        >
          <TouchableOpacity
            testID="help-open-new-ticket"
            style={s.newBtn}
            onPress={() => setComposeOpen(true)}
            activeOpacity={0.85}
          >
            <Ionicons name="add-circle" size={20} color={T.bg} />
            <Text style={s.newBtnText}>Open a new ticket</Text>
          </TouchableOpacity>

          <SectionLabel>Recent tickets</SectionLabel>

          {loadingTickets && <ActivityIndicator color={T.primary} style={{ marginTop: 16 }} />}

          {!loadingTickets && tickets.length === 0 && (
            <EmptyState
              icon="chatbubbles-outline"
              title="No tickets yet"
              sub="Once you open one, it appears here with status and our responses."
            />
          )}

          {tickets.map((t) => (
            <TouchableOpacity
              key={t.ticket_id}
              style={s.ticket}
              testID={`ticket-${t.ticket_id}`}
              activeOpacity={0.85}
              onPress={() => router.push(`/help/${t.ticket_id}` as any)}
            >
              <View style={s.ticketHead}>
                <Text style={s.ticketTitle} numberOfLines={2}>{t.title}</Text>
                <StatusPill tone={ticketTone(t.status)} label={t.status} />
              </View>
              <View style={s.ticketMetaRow}>
                {t.ticket_type ? <Text style={s.ticketMeta}>{t.ticket_type}</Text> : null}
                {t.priority ? <Text style={s.ticketMeta}>· {t.priority}</Text> : null}
                {t.created_at ? (
                  <Text style={s.ticketMeta}>· {new Date(t.created_at).toLocaleDateString()}</Text>
                ) : null}
              </View>
              {t.description ? (
                <Text style={s.ticketBody} numberOfLines={3}>{t.description}</Text>
              ) : null}
              {t.attachment_url ? (
                <Image source={{ uri: t.attachment_url }} style={s.ticketThumb} />
              ) : null}
              <View style={s.ticketCta}>
                <Ionicons name="chatbubble-ellipses-outline" size={14} color={T.primary} />
                <Text style={s.ticketCtaText}>Open chat →</Text>
              </View>
            </TouchableOpacity>
          ))}

          <View style={{ height: 80 }} />
        </ScrollView>
      )}

      {composeOpen ? (
        <ComposeTicket
          onClose={() => setComposeOpen(false)}
          onSubmitted={() => { setComposeOpen(false); loadTickets(); }}
        />
      ) : null}
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------- compose */

function ComposeTicket({ onClose, onSubmitted }: { onClose: () => void; onSubmitted: () => void }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [type, setType] = useState<string>('');
  const [priority, setPriority] = useState<string>('medium');
  const [attachment, setAttachment] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission', 'We need photo library access to attach an image.');
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        base64: true,
      });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0];
      // Inline data URL — keeps the contract tiny and matches how avatars
      // are stored elsewhere in the app (no separate upload endpoint needed).
      const dataUrl = `data:image/jpeg;base64,${a.base64}`;
      setAttachment(dataUrl);
    } catch (e: any) {
      Alert.alert('Attach', String(e?.message || e));
    }
  };

  const submit = async () => {
    if (!title.trim()) { Alert.alert('Required', 'Add a subject.'); return; }
    if (!type.trim())  { Alert.alert('Required', 'Add a type (e.g. Bug, Billing, Question).'); return; }
    if (!desc.trim() || desc.trim().length < 10) {
      Alert.alert('Required', 'Add a short description (at least 10 chars).'); return;
    }
    setSubmitting(true);
    try {
      await api.post('/client/support-tickets', {
        title: title.trim(),
        description: desc.trim(),
        ticket_type: type.trim(),
        priority,
        attachment_url: attachment,
      });
      onSubmitted();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Failed to open ticket');
    } finally { setSubmitting(false); }
  };

  return (
    <View style={c.backdrop} testID="ticket-compose">
      <View style={c.card}>
        <View style={c.head}>
          <Text style={c.title}>New ticket</Text>
          <TouchableOpacity onPress={onClose} testID="ticket-compose-close" hitSlop={8}>
            <Ionicons name="close" size={22} color={T.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ maxHeight: 540 }} contentContainerStyle={{ paddingBottom: 16, gap: 14 }}>
          <View>
            <Text style={c.label}>Subject</Text>
            <TextInput
              testID="ticket-title"
              style={c.input}
              placeholder="e.g. Push notifications not arriving on iOS"
              placeholderTextColor={T.textMuted}
              value={title}
              onChangeText={setTitle}
              maxLength={120}
            />
          </View>

          <View>
            <Text style={c.label}>Type</Text>
            <TextInput
              testID="ticket-type-input"
              style={c.input}
              placeholder="e.g. Bug, Billing, Integration, Question…"
              placeholderTextColor={T.textMuted}
              value={type}
              onChangeText={setType}
              maxLength={40}
              autoCapitalize="words"
            />
            <View style={[c.chipsRow, { marginTop: 8 }]}>
              {TICKET_TYPE_SUGGESTIONS.map((tt) => (
                <TouchableOpacity
                  key={tt}
                  testID={`ticket-type-suggest-${tt.toLowerCase().replace(/\s+/g, '-')}`}
                  style={[c.chip, type.toLowerCase() === tt.toLowerCase() && c.chipActive]}
                  onPress={() => setType(tt)}
                  activeOpacity={0.7}
                >
                  <Text style={[c.chipText, type.toLowerCase() === tt.toLowerCase() && c.chipTextActive]}>{tt}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View>
            <Text style={c.label}>Priority</Text>
            <View style={c.chipsRow}>
              {PRIORITIES.map((p) => (
                <TouchableOpacity
                  key={p.key}
                  testID={`ticket-priority-${p.key}`}
                  style={[c.chip, priority === p.key && { borderColor: p.color, backgroundColor: p.color + '14' }]}
                  onPress={() => setPriority(p.key)}
                  activeOpacity={0.8}
                >
                  <View style={[c.dot, { backgroundColor: p.color }]} />
                  <Text style={[c.chipText, priority === p.key && { color: p.color }]}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View>
            <Text style={c.label}>Description</Text>
            <TextInput
              testID="ticket-description"
              style={[c.input, c.area]}
              placeholder="What happened, what did you expect, any steps to reproduce…"
              placeholderTextColor={T.textMuted}
              value={desc}
              onChangeText={setDesc}
              multiline
              textAlignVertical="top"
              maxLength={2000}
            />
          </View>

          <View>
            <Text style={c.label}>Screenshot (optional)</Text>
            {attachment ? (
              <View style={c.attachRow}>
                <Image source={{ uri: attachment }} style={c.thumb} />
                <TouchableOpacity
                  testID="ticket-attach-remove"
                  style={c.attachRemove}
                  onPress={() => setAttachment(null)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="trash-outline" size={16} color={T.danger} />
                  <Text style={[c.chipText, { color: T.danger }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                testID="ticket-attach"
                style={c.attachBtn}
                onPress={pickImage}
                activeOpacity={0.8}
              >
                <Ionicons name="image-outline" size={18} color={T.text} />
                <Text style={c.attachText}>{Platform.OS === 'web' ? 'Choose a file' : 'Pick a photo'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>

        <View style={c.actions}>
          <TouchableOpacity style={c.cancel} onPress={onClose} testID="ticket-cancel" activeOpacity={0.8}>
            <Text style={c.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="ticket-submit"
            style={[c.submit, submitting && { opacity: 0.6 }]}
            onPress={submit}
            disabled={submitting}
            activeOpacity={0.9}
          >
            <Text style={c.submitText}>{submitting ? 'Sending…' : 'Open ticket'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },

  tabs: {
    flexDirection: 'row',
    padding: T.md,
    gap: T.sm,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10,
    borderRadius: T.radius,
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
  },
  tabActive: { backgroundColor: T.primaryBgStrong, borderColor: T.primaryBorder },
  tabText: { color: T.textMuted, fontSize: T.small, fontWeight: '700' },
  tabTextActive: { color: T.primary },

  content: { padding: T.md, paddingBottom: 40 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius,
    paddingHorizontal: 12, paddingVertical: 6,
    marginBottom: T.md,
  },
  searchInput: { flex: 1, color: T.text, fontSize: T.body, padding: 6 },

  lead: { color: T.textMuted, fontSize: T.small, marginBottom: T.md, lineHeight: 20 },
  leadLink: { color: T.primary, fontWeight: '700' },

  faqItem: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius,
    padding: T.md,
    marginBottom: T.sm,
  },
  faqHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  faqQ:    { color: T.text, fontSize: T.body, fontWeight: '700', flex: 1 },
  faqA:    { color: T.textSecondary, fontSize: T.small, marginTop: 10, lineHeight: 21 },

  newBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: T.primary,
    borderRadius: T.radius,
    paddingVertical: 14,
    marginBottom: T.lg,
  },
  newBtnText: { color: T.bg, fontWeight: '800', fontSize: T.body },

  ticket: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius,
    padding: T.md,
    marginBottom: T.sm,
  },
  ticketHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  ticketTitle: { flex: 1, color: T.text, fontSize: T.body, fontWeight: '700' },
  ticketMetaRow: { flexDirection: 'row', marginTop: 4, gap: 4, flexWrap: 'wrap' },
  ticketMeta: { color: T.textMuted, fontSize: T.tiny, fontWeight: '600', textTransform: 'capitalize' },
  ticketBody: { color: T.textSecondary, fontSize: T.small, marginTop: 8, lineHeight: 20 },
  ticketThumb: { width: '100%', height: 140, borderRadius: T.radiusSm, marginTop: 10, backgroundColor: T.surface2 },
  ticketCta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  ticketCtaText: { color: T.primary, fontSize: T.small, fontWeight: '700' },
});

const c = StyleSheet.create({
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center', alignItems: 'stretch',
    padding: T.md,
  },
  card: {
    backgroundColor: T.surface1,
    borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.lg,
    maxWidth: 540, width: '100%', alignSelf: 'center',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: T.md },
  title: { color: T.text, fontSize: T.h3, fontWeight: '800' },

  label: { color: T.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 },

  input: {
    backgroundColor: T.surface2,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radiusSm,
    paddingHorizontal: 12, paddingVertical: 10,
    color: T.text, fontSize: T.body,
  },
  area: { minHeight: 110 },

  chipsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: T.surface2,
    borderWidth: 1, borderColor: T.border,
  },
  chipActive: { borderColor: T.primary, backgroundColor: T.primaryBgStrong },
  chipText: { color: T.textMuted, fontWeight: '700', fontSize: T.small },
  chipTextActive: { color: T.primary },
  dot: { width: 8, height: 8, borderRadius: 4 },

  attachBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: T.radiusSm,
    backgroundColor: T.surface2,
    borderWidth: 1, borderColor: T.border, borderStyle: 'dashed',
    alignSelf: 'flex-start',
  },
  attachText: { color: T.text, fontWeight: '700', fontSize: T.small },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 80, height: 80, borderRadius: T.radiusSm, backgroundColor: T.surface2 },
  attachRemove: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 },

  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: T.md },
  cancel: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: T.radiusSm, backgroundColor: T.surface2 },
  cancelText: { color: T.text, fontWeight: '700' },
  submit: { paddingHorizontal: 20, paddingVertical: 11, borderRadius: T.radiusSm, backgroundColor: T.primary },
  submitText: { color: T.bg, fontWeight: '800' },
});
