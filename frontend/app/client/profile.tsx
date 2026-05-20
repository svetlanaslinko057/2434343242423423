// Profile tab — Operator Console redesign
import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Modal, TextInput, Alert,
  RefreshControl, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/auth';
import { useValidator } from '../../src/validator-context';
import api from '../../src/api';
import T from '../../src/theme';
import { Avatar, MenuRow, StatCard, SectionLabel, EmptyState, StatusPill } from '../../src/ui-client';
import { PressScale } from '../../src/ui';
import { useT } from '../../src/i18n';

type Ticket = {
  ticket_id: string;
  title: string;
  status: string;
  priority?: string;
  messages?: { text: string }[];
};

type ProfileStats = {
  active_projects: number;
  total_invested: number;
  member_since?: string;
};

export default function ClientProfile() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const { t } = useT();
  const { enabled: hvlEnabled } = useValidator();

  const [stats, setStats] = useState<ProfileStats>({ active_projects: 0, total_invested: 0 });
  const [supportOpen, setSupportOpen] = useState(false);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Fetch stats from backend (pure projection — no client math).
  useEffect(() => {
    (async () => {
      try {
        const [proj, costs, owner] = await Promise.all([
          api.get('/projects/mine').catch(() => ({ data: [] })),
          api.get('/client/costs').catch(() => ({ data: { summary: {} } })),
          api.get('/client/owner-summary').catch(() => ({ data: null })),
        ]);
        const list = Array.isArray(proj.data) ? proj.data : [];
        setStats({
          active_projects: list.length,
          total_invested: owner.data?.invested ?? costs.data?.summary?.paid_out ?? 0,
          member_since: user?.created_at,
        });
      } catch { /* silent */ }
    })();
  }, [user]);

  const loadTickets = async () => {
    setLoadingTickets(true);
    try {
      const r = await api.get('/client/support-tickets');
      setTickets(Array.isArray(r.data) ? r.data : (r.data?.tickets || []));
    } catch { setTickets([]); }
    finally { setLoadingTickets(false); setRefreshing(false); }
  };

  const openSupport = () => {
    setSupportOpen(true);
    if (tickets === null) loadTickets();
  };

  const createTicket = async () => {
    if (!title.trim()) { Alert.alert('Error', 'Title required'); return; }
    setSubmitting(true);
    try {
      await api.post('/client/support-tickets', { title, description: desc });
      setTitle(''); setDesc(''); setNewOpen(false);
      await loadTickets();
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed');
    } finally { setSubmitting(false); }
  };

  const ticketTone = (st: string): 'success' | 'risk' | 'info' | 'neutral' =>
    st === 'resolved' ? 'success' : st === 'open' ? 'risk' : 'info';

  const initial = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase();
  const fmtMoney = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const memberLabel = stats.member_since
    ? new Date(stats.member_since).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '—';

  return (
    <SafeAreaView style={s.flex} edges={['top']}>
      <ScrollView contentContainerStyle={s.container} testID="client-profile">
        {/* Identity hero */}
        <View style={s.identity}>
          <Avatar initial={initial} size={72} />
          <Text style={s.name} numberOfLines={1}>{user?.name || user?.email || 'Account'}</Text>
          <Text style={s.email} numberOfLines={1}>{user?.email}</Text>
        </View>

        {/* Quick stats */}
        <View style={s.statRow}>
          <StatCard label={t('profile.stats.projects')}  value={String(stats.active_projects)} />
          <StatCard label={t('profile.stats.invested')}  value={fmtMoney(stats.total_invested)} accent={T.success} />
          <StatCard label={t('profile.stats.member')}    value={memberLabel} />
        </View>

        {/* Account section */}
        <SectionLabel>{t('profile.section.account')}</SectionLabel>
        <MenuRow
          icon="person-circle-outline"
          label={t('profile.row.account_details')}
          onPress={() => router.push('/account' as any)}
          testID="profile-row-account"
        />
        <MenuRow
          icon="settings-outline"
          label={t('profile.row.settings')}
          onPress={() => router.push('/settings' as any)}
          testID="profile-row-settings"
        />
        <MenuRow
          icon="people-outline"
          label={t('profile.row.referrals')}
          onPress={() => router.push('/client/referrals' as any)}
          testID="profile-row-referrals"
        />
        <MenuRow
          icon="document-text-outline"
          label={t('profile.row.documents')}
          value={t('common.coming_soon')}
          onPress={() => Alert.alert(t('profile.row.documents'), t('common.coming_soon'))}
          testID="profile-row-documents"
        />

        {/* Support */}
        <SectionLabel>{t('profile.section.support')}</SectionLabel>
        <MenuRow
          icon="chatbubble-ellipses-outline"
          label={t('profile.row.support')}
          onPress={() => router.push('/help' as any)}
          testID="profile-row-support"
          accent={T.primary}
        />

        {/* Community — Human Validation Layer (opt-in capability).
            Promo card replaces the old MenuRow: a single press-card with
            sparkles iconography, dual headline + microcopy, and a contextual
            CTA chip (Join program / Open missions). Sits flush in the
            Profile rhythm without breaking the menu density above. */}
        <SectionLabel>Community</SectionLabel>
        <PressScale
          onPress={() => router.push('/client/validation' as any)}
          testID="profile-row-validation"
          style={s.hvlCard}
        >
          <View style={s.hvlIconPill}>
            <Ionicons name="sparkles" size={18} color={T.primary} />
          </View>
          <View style={s.hvlBody}>
            <View style={s.hvlTitleRow}>
              <Text style={s.hvlTitle}>Human Validation Program</Text>
              {hvlEnabled === true ? (
                <View style={s.hvlActiveDot}>
                  <Text style={s.hvlActiveDotText}>ACTIVE</Text>
                </View>
              ) : (
                <View style={s.hvlBetaDot}>
                  <Text style={s.hvlBetaDotText}>BETA</Text>
                </View>
              )}
            </View>
            <Text style={s.hvlSub} numberOfLines={2}>
              {hvlEnabled === true
                ? 'Open missions and review products before launch. Earn credits when your feedback is useful.'
                : 'Help teams spot visual and UX issues. Earn credits when your feedback is useful.'}
            </Text>
            <View style={s.hvlCtaRow}>
              <Text style={s.hvlCtaText}>
                {hvlEnabled === true ? 'Open missions' : 'Join program'}
              </Text>
              <Ionicons name="arrow-forward" size={13} color={T.primary} />
            </View>
          </View>
        </PressScale>

        {/* Switch role for multi-role users */}
        {user && (user.roles || []).length > 1 && (
          <>
            <SectionLabel>{t('profile.section.workspace')}</SectionLabel>
            <MenuRow
              icon="swap-horizontal"
              label={t('profile.row.switch_role')}
              onPress={() => router.replace('/gateway' as any)}
              testID="profile-row-switch-role"
              accent={T.primary}
            />
          </>
        )}

        {/* Sign out */}
        <View style={{ marginTop: T.lg }}>
          <PressScale
            onPress={() => { logout(); router.replace('/auth' as any); }}
            testID="profile-row-logout"
            style={s.logoutBtn}
          >
            <Ionicons name="log-out-outline" size={18} color={T.danger} />
            <Text style={s.logoutText}>{t('profile.signout')}</Text>
          </PressScale>
        </View>
      </ScrollView>

      {/* Support sheet */}
      <Modal visible={supportOpen} animationType="slide" onRequestClose={() => setSupportOpen(false)}>
        <SafeAreaView style={s.flex} edges={['top']}>
          <View style={s.sheetHeader}>
            <TouchableOpacity testID="support-close" onPress={() => setSupportOpen(false)}>
              <Ionicons name="close" size={24} color={T.text} />
            </TouchableOpacity>
            <Text style={s.sheetTitle}>Support</Text>
            <TouchableOpacity testID="new-ticket-open" onPress={() => setNewOpen(true)}>
              <Text style={s.sheetAction}>+ New</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={s.flex}
            contentContainerStyle={{ padding: T.md, paddingBottom: 100 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadTickets(); }} tintColor={T.primary} />}
          >
            {loadingTickets && <ActivityIndicator color={T.primary} style={{ marginTop: 24 }} />}

            {!loadingTickets && (tickets?.length ?? 0) === 0 && (
              <EmptyState
                icon="chatbubbles-outline"
                title="No tickets yet"
                sub='Tap "+ New" if something is off — our team gets back fast.'
              />
            )}

            {(tickets || []).map((t) => (
              <View key={t.ticket_id} style={s.ticket} testID={`ticket-${t.ticket_id}`}>
                <View style={s.ticketHeader}>
                  <Text style={s.ticketTitle} numberOfLines={1}>{t.title}</Text>
                  <StatusPill tone={ticketTone(t.status)} label={t.status} />
                </View>
                {t.priority ? <Text style={s.ticketMeta}>Priority: {t.priority}</Text> : null}
                {t.messages && t.messages.length > 0 ? (
                  <Text style={s.ticketMsg} numberOfLines={2}>
                    {t.messages[t.messages.length - 1]?.text}
                  </Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>

        {/* New ticket modal nested */}
        <Modal visible={newOpen} animationType="slide" transparent onRequestClose={() => setNewOpen(false)}>
          <View style={s.newBackdrop}>
            <View style={s.newCard}>
              <Text style={s.newTitle}>New ticket</Text>
              <TextInput
                testID="new-ticket-title"
                style={s.input}
                placeholder="Title"
                placeholderTextColor={T.textMuted}
                value={title}
                onChangeText={setTitle}
              />
              <TextInput
                testID="new-ticket-desc"
                style={[s.input, { height: 120, textAlignVertical: 'top' }]}
                placeholder="Describe what's happening…"
                placeholderTextColor={T.textMuted}
                value={desc}
                onChangeText={setDesc}
                multiline
              />
              <View style={s.newActions}>
                <TouchableOpacity testID="new-ticket-cancel" style={s.newCancel} onPress={() => setNewOpen(false)}>
                  <Text style={s.newCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="new-ticket-submit"
                  style={[s.newSubmit, submitting && { opacity: 0.6 }]}
                  onPress={createTicket}
                  disabled={submitting}
                >
                  <Text style={s.newSubmitText}>{submitting ? 'Sending…' : 'Submit'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  container: { padding: T.md, paddingBottom: 100 },

  /* Identity hero */
  identity: { alignItems: 'center', paddingTop: T.md, paddingBottom: T.lg },
  name: { color: T.text, fontSize: T.h2, fontWeight: '800', marginTop: T.md, letterSpacing: -0.3 },
  email: { color: T.textSecondary, fontSize: T.small, marginTop: 4, fontWeight: '500' },

  /* Stat strip */
  statRow: { flexDirection: 'row', gap: T.sm, marginBottom: T.md },

  /* Sign out */
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    backgroundColor: T.dangerTint,
    borderWidth: 1, borderColor: T.dangerBorder,
    borderRadius: T.radius,
    paddingVertical: 14,
  },
  logoutText: { color: T.danger, fontSize: T.body, fontWeight: '700' },

  /* HVL promo card (Profile → Community section) */
  hvlCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: T.sm,
    padding: T.md,
    borderRadius: T.radius,
    backgroundColor: T.primary + '0F',
    borderWidth: 1,
    borderColor: T.primary + '33',
    marginBottom: T.sm,
  },
  hvlIconPill: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: T.primary + '22',
    borderWidth: 1, borderColor: T.primary + '44',
    alignItems: 'center', justifyContent: 'center',
  },
  hvlBody: { flex: 1 },
  hvlTitleRow: { flexDirection: 'row', alignItems: 'center', gap: T.xs, marginBottom: 2 },
  hvlTitle: { color: T.text, fontSize: T.body, fontWeight: '800', flexShrink: 1 },
  hvlBetaDot: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    backgroundColor: T.primary + '22',
  },
  hvlBetaDotText: { color: T.primary, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  hvlActiveDot: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    backgroundColor: (T as any).success ? (T as any).success + '22' : T.primary + '22',
  },
  hvlActiveDotText: { color: (T as any).success || T.primary, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  hvlSub: { color: T.textMuted, fontSize: T.small, lineHeight: 17, marginBottom: T.xs },
  hvlCtaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  hvlCtaText: { color: T.primary, fontSize: T.small, fontWeight: '700' },

  version: { color: T.textMuted, fontSize: T.tiny, textAlign: 'center', marginTop: T.lg, fontWeight: '600' },

  /* Support sheet */
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: T.md, paddingVertical: T.md,
    borderBottomWidth: 1, borderBottomColor: T.border,
    backgroundColor: T.surface1,
  },
  sheetTitle: { color: T.text, fontSize: T.h3, fontWeight: '800' },
  sheetAction: { color: T.primary, fontSize: T.body, fontWeight: '700' },

  ticket: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius,
    padding: T.md,
    marginBottom: T.sm,
  },
  ticketHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  ticketTitle: { color: T.text, fontSize: T.body, fontWeight: '700', flex: 1 },
  ticketMeta: { color: T.textMuted, fontSize: T.tiny, marginTop: 4, fontWeight: '600' },
  ticketMsg: { color: T.textSecondary, fontSize: T.small, marginTop: 6, fontStyle: 'italic', lineHeight: 19 },

  /* New ticket modal */
  newBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: T.md },
  newCard: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius,
    padding: T.lg,
    gap: T.md,
  },
  newTitle: { color: T.text, fontSize: T.h3, fontWeight: '800' },
  input: {
    backgroundColor: T.surface2,
    borderRadius: T.radiusSm,
    padding: 12,
    color: T.text, fontSize: T.body,
    borderWidth: 1, borderColor: T.border,
  },
  newActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: T.sm },
  newCancel: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: T.radiusSm, backgroundColor: T.surface2 },
  newCancelText: { color: T.text, fontWeight: '700' },
  newSubmit: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: T.radiusSm, backgroundColor: T.primary },
  newSubmitText: { color: T.bg, fontWeight: '800' },
});
