/**
 * Admin · Validation — Human Validation Layer one-click bootstrap.
 *
 * Two modes on one screen:
 *   1. "Create from project"  — projects with `hvl_tier` set (client paid for HVL)
 *      and no active campaign yet. Tap a card → prefilled defaults → Create.
 *   2. "Campaigns"            — active / historical sessions admin already launched.
 *
 * Source: GET /api/admin/validation/suggested-projects  (mode 1)
 *         GET /api/admin/validation/campaigns           (mode 2)
 * Action: POST /api/admin/validation/campaigns          (one-click, idempotent
 *         when source="project_hvl_tier")
 *
 * Idempotency: backend returns the existing campaign instead of creating a duplicate
 * if a session is already active for the same project + source. We surface this with
 * an "Already created" toast and a deep-link to the campaign.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/api';
import T from '../../src/theme';

type Suggested = {
  project_id: string;
  project_name: string;
  client_id: string | null;
  current_stage: string | null;
  preview_url: string | null;
  hvl_tier: 'basic' | 'pro' | 'managed';
  campaign_status: 'not_started' | 'active' | 'expired' | 'closed';
  campaign_id: string | null;
  suggested: {
    title: string;
    goal: string;
    max_validators: number;
    reward_pool_credits: number;
    deadline_hours: number;
    preview_url: string | null;
    source: 'project_hvl_tier';
    source_tier: 'basic' | 'pro' | 'managed';
  };
};

type Campaign = {
  campaign_id: string;
  project_id: string;
  project_title: string;
  goal: string;
  max_validators: number;
  reward_pool_credits: number;
  status: string;
  source: string | null;
  source_tier: string | null;
  created_at: string;
  stats: {
    total: number;
    looks_good: number;
    issues: number;
    pending_review: number;
    useful: number;
  };
};

const TIER_LABEL: Record<string, string> = {
  basic: 'Basic',
  pro: 'Pro',
  managed: 'Managed',
};

const TIER_COLOR: Record<string, string> = {
  basic: T.textSecondary,
  pro: T.primary,
  managed: T.success,
};

export default function AdminValidation() {
  const router = useRouter();
  const [tab, setTab] = useState<'projects' | 'campaigns'>('projects');
  const [suggested, setSuggested] = useState<Suggested[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const [s, c] = await Promise.all([
        api.get<Suggested[]>('/admin/validation/suggested-projects'),
        api.get<Campaign[]>('/admin/validation/campaigns'),
      ]);
      setSuggested(s.data || []);
      setCampaigns(c.data || []);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = () => { setRefreshing(true); void load(); };

  const createSession = (p: Suggested) => {
    const tierLabel = TIER_LABEL[p.hvl_tier] || p.hvl_tier;
    const detail =
      `${p.project_name}\n\n` +
      `Tier:           ${tierLabel}\n` +
      `Validators:     ${p.suggested.max_validators}\n` +
      `Reward pool:    ${p.suggested.reward_pool_credits} credits\n` +
      `Deadline:       ${p.suggested.deadline_hours}h`;

    Alert.alert('Create validation session?', detail, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Create',
        style: 'default',
        onPress: async () => {
          setBusy(p.project_id);
          try {
            const r = await api.post<{ campaign_id: string; _already_existed?: boolean }>(
              '/admin/validation/campaigns',
              {
                project_id: p.project_id,
                goal: p.suggested.goal,
                max_validators: p.suggested.max_validators,
                reward_pool_credits: p.suggested.reward_pool_credits,
                deadline_hours: p.suggested.deadline_hours,
                preview_url: p.suggested.preview_url || undefined,
                source: 'project_hvl_tier',
                source_tier: p.suggested.source_tier,
                public: true,
              },
            );
            const already = r.data?._already_existed;
            await load();
            setTab('campaigns');
            if (already) {
              Alert.alert('Session already exists', 'Showing the existing campaign.');
            }
          } catch (e: any) {
            const msg = e?.response?.data?.detail || e?.message || 'Could not create session';
            Alert.alert('Failed', typeof msg === 'string' ? msg : 'Action failed');
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  const notStarted = suggested.filter((p) => p.campaign_status === 'not_started');
  const alreadyRunning = suggested.filter((p) => p.campaign_status !== 'not_started');

  return (
    <>
      <Stack.Screen options={{ title: 'Admin · Validation' }} />
      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} />}
        testID="admin-validation-screen"
      >
        <Text style={s.h1}>Validation</Text>
        <Text style={s.subtitle}>Launch human review sessions from purchased HVL tiers</Text>

        {/* Tab switcher */}
        <View style={s.tabRow}>
          <TouchableOpacity
            style={[s.tab, tab === 'projects' && s.tabActive]}
            onPress={() => setTab('projects')}
            testID="validation-tab-projects"
          >
            <Text style={[s.tabText, tab === 'projects' && s.tabTextActive]}>
              {`From project (${notStarted.length})`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tab, tab === 'campaigns' && s.tabActive]}
            onPress={() => setTab('campaigns')}
            testID="validation-tab-campaigns"
          >
            <Text style={[s.tabText, tab === 'campaigns' && s.tabTextActive]}>
              Campaigns ({campaigns.length})
            </Text>
          </TouchableOpacity>
        </View>

        {loading && <View style={s.center}><ActivityIndicator color={T.primary} /></View>}

        {err && !loading && (
          <View style={s.errBox}>
            <Text style={s.errText}>{err}</Text>
            <TouchableOpacity style={s.retry} onPress={() => { setLoading(true); void load(); }}>
              <Text style={s.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* MODE 1: Create from project */}
        {!loading && !err && tab === 'projects' && (
          <View style={s.list}>
            {notStarted.length === 0 && alreadyRunning.length === 0 && (
              <View style={s.allClear}>
                <Ionicons name="hourglass-outline" size={28} color={T.textMuted} />
                <Text style={s.allClearText}>No HVL purchases yet</Text>
                <Text style={s.allClearSub}>
                  Projects appear here once a client picks a Human Validation tier at checkout.
                </Text>
              </View>
            )}

            {notStarted.length > 0 && (
              <Text style={s.sectionLabel}>Ready to launch</Text>
            )}
            {notStarted.map((p) => (
              <View key={p.project_id} style={s.card} testID={`validation-suggest-${p.project_id}`}>
                <View style={s.cardHeader}>
                  <Text style={s.cardTitle} numberOfLines={2}>{p.project_name}</Text>
                  <View style={[s.tierBadge, { borderColor: TIER_COLOR[p.hvl_tier] || T.border }]}>
                    <Text style={[s.tierBadgeText, { color: TIER_COLOR[p.hvl_tier] || T.text }]}>
                      {TIER_LABEL[p.hvl_tier] || p.hvl_tier}
                    </Text>
                  </View>
                </View>

                <View style={s.metaGrid}>
                  <Text style={s.metaItem}>
                    <Text style={s.metaLabel}>Validators: </Text>
                    <Text style={s.metaValue}>{p.suggested.max_validators}</Text>
                  </Text>
                  <Text style={s.metaItem}>
                    <Text style={s.metaLabel}>Reward pool: </Text>
                    <Text style={s.metaValue}>{p.suggested.reward_pool_credits}c</Text>
                  </Text>
                  <Text style={s.metaItem}>
                    <Text style={s.metaLabel}>Deadline: </Text>
                    <Text style={s.metaValue}>{p.suggested.deadline_hours}h</Text>
                  </Text>
                </View>

                <Text style={s.previewHint} numberOfLines={1}>
                  {p.suggested.title}
                </Text>

                <View style={s.cardActions}>
                  <TouchableOpacity
                    style={[s.actionBtn, s.btnCreate]}
                    onPress={() => createSession(p)}
                    disabled={busy === p.project_id}
                    testID={`validation-create-${p.project_id}`}
                  >
                    {busy === p.project_id
                      ? <ActivityIndicator color={T.bg} />
                      : <Text style={s.btnCreateText}>Create validation session</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.detailLink}
                    onPress={() => router.push(`/admin/projects/${p.project_id}`)}
                    testID={`validation-detail-${p.project_id}`}
                  >
                    <Ionicons name="chevron-forward" size={14} color={T.primary} />
                    <Text style={s.detailLinkText}>Open project</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            {alreadyRunning.length > 0 && (
              <>
                <Text style={[s.sectionLabel, { marginTop: T.lg }]}>Already started</Text>
                {alreadyRunning.map((p) => (
                  <TouchableOpacity
                    key={p.project_id}
                    style={[s.card, s.cardMuted]}
                    onPress={() => router.push(`/admin/projects/${p.project_id}`)}
                    activeOpacity={0.8}
                    testID={`validation-existing-${p.project_id}`}
                  >
                    <View style={s.cardHeader}>
                      <Text style={s.cardTitle} numberOfLines={2}>{p.project_name}</Text>
                      <View style={[s.statusPill, statusPillStyle(p.campaign_status)]}>
                        <Text style={[s.statusPillText, statusPillStyle(p.campaign_status)]}>
                          {p.campaign_status}
                        </Text>
                      </View>
                    </View>
                    <Text style={s.cardSubtitle}>
                      Tier {TIER_LABEL[p.hvl_tier] || p.hvl_tier} · campaign {p.campaign_id?.slice(-6) || '—'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </View>
        )}

        {/* MODE 2: Campaigns */}
        {!loading && !err && tab === 'campaigns' && (
          <View style={s.list}>
            {campaigns.length === 0 && (
              <View style={s.allClear}>
                <Ionicons name="albums-outline" size={28} color={T.textMuted} />
                <Text style={s.allClearText}>No campaigns yet</Text>
                <Text style={s.allClearSub}>Create one from the "From project" tab.</Text>
              </View>
            )}
            {campaigns.map((c) => (
              <View key={c.campaign_id} style={s.card} testID={`campaign-card-${c.campaign_id}`}>
                <View style={s.cardHeader}>
                  <Text style={s.cardTitle} numberOfLines={2}>{c.project_title}</Text>
                  <View style={[s.statusPill, statusPillStyle(c.status)]}>
                    <Text style={[s.statusPillText, statusPillStyle(c.status)]}>{c.status}</Text>
                  </View>
                </View>
                <Text style={s.cardSubtitle}>
                  {c.goal} · {c.max_validators} validators · {c.reward_pool_credits}c pool
                </Text>
                {c.source === 'project_hvl_tier' && c.source_tier && (
                  <View style={s.sourceRow}>
                    <Ionicons name="link-outline" size={12} color={T.primary} />
                    <Text style={s.sourceText}>
                      Auto-spawned from HVL {TIER_LABEL[c.source_tier] || c.source_tier}
                    </Text>
                  </View>
                )}
                <View style={s.statsRow}>
                  <Stat label="Total" value={c.stats?.total ?? 0} />
                  <Stat label="Issues" value={c.stats?.issues ?? 0} />
                  <Stat label="Pending" value={c.stats?.pending_review ?? 0} />
                  <Stat label="Useful" value={c.stats?.useful ?? 0} accent={T.success} />
                </View>
                <TouchableOpacity
                  style={s.detailLink}
                  onPress={() => router.push(`/admin/projects/${c.project_id}`)}
                  testID={`campaign-open-${c.campaign_id}`}
                >
                  <Ionicons name="chevron-forward" size={14} color={T.primary} />
                  <Text style={s.detailLinkText}>Open project</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <View style={s.statBox}>
      <Text style={[s.statValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function statusPillStyle(status: string) {
  if (status === 'active') return { color: T.success, borderColor: T.success, backgroundColor: 'transparent' };
  if (status === 'expired') return { color: T.risk, borderColor: T.risk, backgroundColor: 'transparent' };
  if (status === 'closed') return { color: T.textMuted, borderColor: T.border, backgroundColor: 'transparent' };
  return { color: T.textMuted, borderColor: T.border, backgroundColor: 'transparent' };
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md, paddingBottom: T.xxl * 2 },
  h1: { color: T.text, fontSize: T.h1, fontWeight: '800' },
  subtitle: { color: T.textSecondary, fontSize: T.small, marginTop: 2, marginBottom: T.lg },
  center: { paddingVertical: T.xxl, alignItems: 'center' },

  tabRow: { flexDirection: 'row', gap: T.sm, marginBottom: T.md },
  tab: { flex: 1, paddingVertical: T.sm, alignItems: 'center', backgroundColor: T.surface1, borderRadius: T.radiusSm, borderWidth: 1, borderColor: T.border },
  tabActive: { backgroundColor: T.surface2, borderColor: T.primary },
  tabText: { color: T.textSecondary, fontWeight: '700', fontSize: T.small },
  tabTextActive: { color: T.text },

  errBox: { backgroundColor: T.dangerTint, borderWidth: 1, borderColor: T.dangerBorder, borderRadius: T.radius, padding: T.md, gap: T.sm },
  errText: { color: T.danger, fontSize: T.body, fontWeight: '600' },
  retry: { alignSelf: 'flex-start', paddingHorizontal: T.md, paddingVertical: T.sm, backgroundColor: T.surface2, borderRadius: T.radiusSm },
  retryText: { color: T.text, fontWeight: '700' },

  allClear: { backgroundColor: T.surface1, borderRadius: T.radius, borderWidth: 1, borderColor: T.border, padding: T.xl, alignItems: 'center', gap: T.xs, marginTop: T.md },
  allClearText: { color: T.text, fontSize: T.h3, fontWeight: '700', marginTop: T.xs },
  allClearSub: { color: T.textSecondary, fontSize: T.body, textAlign: 'center' },

  sectionLabel: { color: T.textMuted, fontSize: T.tiny, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: T.xs },

  list: { gap: T.sm },
  card: { backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border, borderRadius: T.radius, padding: T.md, gap: 4 },
  cardMuted: { opacity: 0.85 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: T.sm },
  cardTitle: { color: T.text, fontSize: T.body, fontWeight: '700', flex: 1 },
  cardSubtitle: { color: T.textSecondary, fontSize: T.small, marginTop: 2 },

  tierBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  tierBadgeText: { fontSize: T.tiny, fontWeight: '800', letterSpacing: 0.5 },

  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: T.md, marginTop: T.sm },
  metaItem: { fontSize: T.small },
  metaLabel: { color: T.textMuted },
  metaValue: { color: T.text, fontWeight: '700' },

  previewHint: { color: T.textSecondary, fontSize: T.tiny, fontStyle: 'italic', marginTop: T.xs },

  cardActions: { flexDirection: 'row', alignItems: 'center', gap: T.sm, marginTop: T.md },
  actionBtn: { flex: 1, paddingVertical: T.sm + 2, borderRadius: T.radiusSm, alignItems: 'center', borderWidth: 1 },
  btnCreate: { backgroundColor: T.primary, borderColor: T.primary },
  btnCreateText: { color: T.bg, fontWeight: '800', fontSize: T.small },

  detailLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: T.sm, paddingVertical: T.sm },
  detailLinkText: { color: T.primary, fontSize: T.tiny, fontWeight: '700' },

  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: T.xs },
  sourceText: { color: T.primary, fontSize: T.tiny, fontWeight: '700' },

  statsRow: { flexDirection: 'row', gap: T.sm, marginTop: T.sm, paddingTop: T.sm, borderTopWidth: 1, borderTopColor: T.border },
  statBox: { flex: 1, alignItems: 'center' },
  statValue: { color: T.text, fontSize: T.body, fontWeight: '800' },
  statLabel: { color: T.textMuted, fontSize: T.tiny, fontWeight: '600', marginTop: 2 },

  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  statusPillText: { fontSize: T.tiny, fontWeight: '800', textTransform: 'uppercase' },
});
