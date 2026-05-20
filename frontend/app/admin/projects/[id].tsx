/**
 * Admin · Project Detail — HVL bootstrap surface.
 *
 * Project-detail mirror of /admin/validation. Always shows the
 * "Human Validation Layer" block:
 *   - if project has no hvl_tier → empty state (no client purchase yet)
 *   - if hvl_tier set and no campaign → "Not started" + Create CTA
 *   - if campaign exists → live status + stats + deep link to campaign
 *
 * Source: GET  /api/admin/projects/{id}/validation
 * Action: POST /api/admin/validation/campaigns (idempotent via source="project_hvl_tier")
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, Linking,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../../src/api';
import T from '../../../src/theme';

type ValidationBlock = {
  project_id: string;
  project_name: string;
  hvl_tier: 'basic' | 'pro' | 'managed' | null;
  campaign: null | {
    campaign_id: string;
    goal: string;
    max_validators: number;
    reward_pool_credits: number;
    status: 'active' | 'expired' | 'closed';
    preview_url: string | null;
    deadline_at: string;
    created_at: string;
    source: string | null;
    source_tier: string | null;
    stats: { total: number; pending_review: number; useful: number };
  };
  suggested: null | {
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

export default function AdminProjectDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = typeof id === 'string' ? id : '';
  const [data, setData] = useState<ValidationBlock | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setErr(null);
      const r = await api.get<ValidationBlock>(`/admin/projects/${projectId}/validation`);
      setData(r.data);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = () => { setRefreshing(true); void load(); };

  const createSession = () => {
    if (!data?.suggested || !data.hvl_tier) return;
    const sug = data.suggested;
    const tierLabel = TIER_LABEL[data.hvl_tier] || data.hvl_tier;
    const detail =
      `${data.project_name}\n\n` +
      `Tier:           ${tierLabel}\n` +
      `Validators:     ${sug.max_validators}\n` +
      `Reward pool:    ${sug.reward_pool_credits} credits\n` +
      `Deadline:       ${sug.deadline_hours}h`;

    Alert.alert('Create validation session?', detail, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Create',
        style: 'default',
        onPress: async () => {
          setBusy(true);
          try {
            const r = await api.post<{ campaign_id: string; _already_existed?: boolean }>(
              '/admin/validation/campaigns',
              {
                project_id: projectId,
                goal: sug.goal,
                max_validators: sug.max_validators,
                reward_pool_credits: sug.reward_pool_credits,
                deadline_hours: sug.deadline_hours,
                preview_url: sug.preview_url || undefined,
                source: 'project_hvl_tier',
                source_tier: sug.source_tier,
                public: true,
              },
            );
            const already = r.data?._already_existed;
            await load();
            if (already) {
              Alert.alert('Session already exists', 'Showing the existing campaign.');
            }
          } catch (e: any) {
            const msg = e?.response?.data?.detail || e?.message || 'Could not create session';
            Alert.alert('Failed', typeof msg === 'string' ? msg : 'Action failed');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const statusLabel = (() => {
    if (!data) return 'Loading';
    if (!data.hvl_tier) return 'Not purchased';
    if (!data.campaign) return 'Not started';
    return data.campaign.status[0].toUpperCase() + data.campaign.status.slice(1);
  })();

  const tier = data?.hvl_tier;
  const tierColor = tier ? TIER_COLOR[tier] || T.text : T.textMuted;

  return (
    <>
      <Stack.Screen options={{ title: 'Project' }} />
      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} />}
        testID="admin-project-detail"
      >
        {/* Back nav */}
        <TouchableOpacity style={s.backRow} onPress={() => router.back()} testID="project-back-btn">
          <Ionicons name="chevron-back" size={18} color={T.primary} />
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>

        {loading && <View style={s.center}><ActivityIndicator color={T.primary} /></View>}

        {err && !loading && (
          <View style={s.errBox}>
            <Text style={s.errText}>{err}</Text>
            <TouchableOpacity style={s.retry} onPress={() => { setLoading(true); void load(); }}>
              <Text style={s.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !err && data && (
          <>
            <Text style={s.h1} numberOfLines={3}>{data.project_name}</Text>
            <Text style={s.subtitle}>Project ID · {projectId}</Text>

            {/* ─── Human Validation Layer block ─────────────────────── */}
            <View style={s.block} testID="hvl-block">
              <View style={s.blockHeader}>
                <Ionicons name="people-circle" size={20} color={T.primary} />
                <Text style={s.blockTitle}>Human Validation Layer</Text>
              </View>

              <View style={s.kvRow}>
                <Text style={s.kvLabel}>Tier</Text>
                {tier ? (
                  <View style={[s.tierBadge, { borderColor: tierColor }]}>
                    <Text style={[s.tierBadgeText, { color: tierColor }]}>
                      {TIER_LABEL[tier] || tier}
                    </Text>
                  </View>
                ) : (
                  <Text style={s.kvMuted}>—</Text>
                )}
              </View>

              <View style={s.kvRow}>
                <Text style={s.kvLabel}>Status</Text>
                <Text style={[
                  s.kvValue,
                  data.campaign?.status === 'active' && { color: T.success },
                  data.campaign?.status === 'expired' && { color: T.risk },
                  !data.hvl_tier && { color: T.textMuted },
                ]}>
                  {statusLabel}
                </Text>
              </View>

              {/* Suggested or active campaign details */}
              {data.campaign && (
                <>
                  <View style={s.kvRow}>
                    <Text style={s.kvLabel}>Validators</Text>
                    <Text style={s.kvValue}>{data.campaign.max_validators}</Text>
                  </View>
                  <View style={s.kvRow}>
                    <Text style={s.kvLabel}>Reward pool</Text>
                    <Text style={s.kvValue}>{data.campaign.reward_pool_credits} credits</Text>
                  </View>
                  <View style={s.kvRow}>
                    <Text style={s.kvLabel}>Submissions</Text>
                    <Text style={s.kvValue}>
                      {data.campaign.stats.total} · {data.campaign.stats.pending_review} pending
                    </Text>
                  </View>
                  {data.campaign.preview_url && (
                    <TouchableOpacity
                      style={s.linkRow}
                      onPress={() => Linking.openURL(data.campaign!.preview_url!)}
                      testID="hvl-preview-link"
                    >
                      <Ionicons name="open-outline" size={14} color={T.primary} />
                      <Text style={s.linkText} numberOfLines={1}>{data.campaign.preview_url}</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              {!data.campaign && data.suggested && (
                <>
                  <View style={s.kvRow}>
                    <Text style={s.kvLabel}>Validators</Text>
                    <Text style={s.kvValue}>{data.suggested.max_validators} (suggested)</Text>
                  </View>
                  <View style={s.kvRow}>
                    <Text style={s.kvLabel}>Reward pool</Text>
                    <Text style={s.kvValue}>{data.suggested.reward_pool_credits} credits (suggested)</Text>
                  </View>
                  <View style={s.kvRow}>
                    <Text style={s.kvLabel}>Deadline</Text>
                    <Text style={s.kvValue}>{data.suggested.deadline_hours}h</Text>
                  </View>
                </>
              )}

              {/* CTA */}
              {!data.hvl_tier && (
                <View style={s.emptyHint}>
                  <Text style={s.emptyText}>
                    {`Client hasn't purchased a Human Validation tier for this project.`}
                  </Text>
                </View>
              )}

              {data.hvl_tier && !data.campaign && (
                <TouchableOpacity
                  style={[s.cta, busy && s.ctaDisabled]}
                  onPress={createSession}
                  disabled={busy}
                  testID="hvl-create-session-btn"
                >
                  {busy
                    ? <ActivityIndicator color={T.bg} />
                    : <Text style={s.ctaText}>Create validation session</Text>}
                </TouchableOpacity>
              )}

              {data.campaign && (
                <View style={s.activeHint}>
                  <Ionicons name="checkmark-circle" size={14} color={T.success} />
                  <Text style={s.activeText}>
                    Session active · campaign {data.campaign.campaign_id.slice(-8)}
                  </Text>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md, paddingBottom: T.xxl * 2 },
  center: { paddingVertical: T.xxl, alignItems: 'center' },

  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: T.md, alignSelf: 'flex-start' },
  backText: { color: T.primary, fontSize: T.body, fontWeight: '700' },

  h1: { color: T.text, fontSize: T.h1, fontWeight: '800' },
  subtitle: { color: T.textMuted, fontSize: T.tiny, marginTop: 2, marginBottom: T.lg },

  errBox: { backgroundColor: T.dangerTint, borderWidth: 1, borderColor: T.dangerBorder, borderRadius: T.radius, padding: T.md, gap: T.sm },
  errText: { color: T.danger, fontSize: T.body, fontWeight: '600' },
  retry: { alignSelf: 'flex-start', paddingHorizontal: T.md, paddingVertical: T.sm, backgroundColor: T.surface2, borderRadius: T.radiusSm },
  retryText: { color: T.text, fontWeight: '700' },

  block: { backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border, borderRadius: T.radius, padding: T.md, gap: T.xs },
  blockHeader: { flexDirection: 'row', alignItems: 'center', gap: T.xs, marginBottom: T.sm },
  blockTitle: { color: T.text, fontSize: T.h3, fontWeight: '800' },

  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.border },
  kvLabel: { color: T.textSecondary, fontSize: T.small, fontWeight: '600' },
  kvValue: { color: T.text, fontSize: T.body, fontWeight: '700' },
  kvMuted: { color: T.textMuted, fontSize: T.body, fontWeight: '700' },

  tierBadge: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  tierBadgeText: { fontSize: T.small, fontWeight: '800', letterSpacing: 0.5 },

  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: T.sm },
  linkText: { color: T.primary, fontSize: T.tiny, fontWeight: '600', flex: 1 },

  cta: { backgroundColor: T.primary, paddingVertical: T.md, borderRadius: T.radiusSm, alignItems: 'center', marginTop: T.md, borderWidth: 1, borderColor: T.primary },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: T.bg, fontWeight: '800', fontSize: T.body },

  emptyHint: { backgroundColor: T.surface2, borderRadius: T.radiusSm, padding: T.sm, marginTop: T.sm },
  emptyText: { color: T.textSecondary, fontSize: T.small, fontStyle: 'italic' },

  activeHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: T.md, paddingTop: T.sm, borderTopWidth: 1, borderTopColor: T.border },
  activeText: { color: T.success, fontSize: T.small, fontWeight: '700' },
});
