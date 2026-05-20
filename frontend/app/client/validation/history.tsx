import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { runtime } from '../../../src/runtime';
import T from '../../../src/theme';

/**
 * Validator History — submitted feedback + verdicts + credits.
 *
 * Backend: GET /api/validator/me → {profile, recent_submissions[]}
 *
 * No "pass rate", no "performance dashboard". Validator gets the only signal
 * that matters here: was my observation useful, duplicate, or noise?
 */
type Sub = {
  submission_id: string;
  campaign_id: string;
  kind: 'looks_good' | 'issue' | string;
  category?: string | null;
  comment?: string | null;
  admin_verdict: 'pending' | 'useful' | 'duplicate' | 'irrelevant' | string;
  credits_awarded: number;
  created_at: string;
  verdict_at?: string;
  admin_note?: string;
};

const VERDICT_META: Record<string, { color: string; label: string; icon: string }> = {
  pending:    { color: T.warning,   label: 'Reviewing',  icon: 'time-outline' },
  useful:     { color: T.success,   label: 'Useful',     icon: 'checkmark-circle' },
  duplicate:  { color: T.info,      label: 'Duplicate',  icon: 'copy-outline' },
  irrelevant: { color: T.textMuted, label: 'Noise',      icon: 'remove-circle-outline' },
};

function fmtDate(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

export default function ValidatorHistory() {
  const [profile, setProfile] = useState<{
    credits_balance: number; reputation_score: number; useful_count: number;
    noise_count: number; total_submissions: number;
  } | null>(null);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await runtime.get<{ profile: any; recent_submissions: Sub[] }>('/api/validator/me');
      setProfile(r.data?.profile || null);
      setSubs(Array.isArray(r.data?.recent_submissions) ? r.data!.recent_submissions : []);
    } catch { /* swallow */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const usefulRatio = profile && profile.total_submissions > 0
    ? Math.round((profile.useful_count / profile.total_submissions) * 100)
    : null;

  return (
    <ScrollView
      testID="validator-history"
      style={s.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          tintColor={T.primary}
        />
      }
    >
      <View style={s.content}>
        <Text style={s.title}>Your history</Text>
        <Text style={s.subtitle}>
          Track your contributions and credits earned.
        </Text>

        {/* Summary */}
        <View style={s.statRow}>
          <View style={s.statCard}>
            <Text style={s.statLabel}>CREDITS</Text>
            <Text style={s.statValue}>{profile?.credits_balance ?? 0}</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statLabel}>USEFUL</Text>
            <Text style={s.statValue}>
              {profile?.useful_count ?? 0}
              <Text style={s.statValueSmall}>
                {usefulRatio !== null ? `  ${usefulRatio}%` : ''}
              </Text>
            </Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statLabel}>TOTAL</Text>
            <Text style={s.statValue}>{profile?.total_submissions ?? subs.length}</Text>
          </View>
        </View>

        <Text style={s.sectionTitle}>Recent submissions</Text>
        {subs.length === 0 && (
          <View style={s.empty}>
            <Ionicons name="document-text-outline" size={28} color={T.textMuted} />
            <Text style={s.emptyText}>No submissions yet.</Text>
            <Text style={s.emptySub}>Open a mission and share what you noticed.</Text>
          </View>
        )}
        {subs.map((sub) => {
          const meta = VERDICT_META[sub.admin_verdict] || VERDICT_META.pending;
          return (
            <View key={sub.submission_id} testID={`sub-row-${sub.submission_id}`} style={s.subCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: T.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.subKind}>
                    {sub.kind === 'looks_good' ? 'Looks good' : (sub.category || 'Issue')}
                  </Text>
                  <Text style={s.subDate}>{fmtDate(sub.created_at)}</Text>
                </View>
                <View style={[s.verdictPill, { borderColor: meta.color }]}>
                  <Ionicons name={meta.icon as any} size={11} color={meta.color} />
                  <Text style={[s.verdictText, { color: meta.color }]}>{meta.label}</Text>
                </View>
              </View>
              {sub.comment ? <Text style={s.subComment} numberOfLines={2}>{sub.comment}</Text> : null}
              {sub.admin_verdict !== 'pending' && (sub.credits_awarded ?? 0) > 0 && (
                <View style={s.creditRow}>
                  <Ionicons name="diamond-outline" size={11} color={T.primary} />
                  <Text style={s.creditText}>+{sub.credits_awarded} credits</Text>
                </View>
              )}
              {sub.admin_note ? (
                <Text style={s.adminNote}>Admin: {sub.admin_note}</Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md },
  title: { color: T.text, fontSize: T.h1, fontWeight: '800' },
  subtitle: { color: T.textMuted, fontSize: T.small, marginTop: T.xs, marginBottom: T.lg, lineHeight: 18 },
  statRow: { flexDirection: 'row', gap: T.sm, marginBottom: T.lg },
  statCard: {
    flex: 1, backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.sm, borderWidth: 1, borderColor: T.border,
  },
  statLabel: { color: T.textMuted, fontSize: 9, letterSpacing: 1.5, marginBottom: 4 },
  statValue: { color: T.text, fontSize: 20, fontWeight: '800' },
  statValueSmall: { fontSize: 11, color: T.textMuted, fontWeight: '600' },
  sectionTitle: { color: T.textMuted, fontSize: T.small, textTransform: 'uppercase', letterSpacing: 2, marginBottom: T.sm },
  empty: {
    alignItems: 'center', gap: T.xs,
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.lg, borderWidth: 1, borderColor: T.border, borderStyle: 'dashed',
  },
  emptyText: { color: T.text, fontSize: T.body, fontWeight: '600' },
  emptySub: { color: T.textMuted, fontSize: T.small },
  subCard: {
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.md, marginBottom: T.sm,
    borderWidth: 1, borderColor: T.border,
  },
  subKind: { color: T.text, fontSize: T.body, fontWeight: '700' },
  subDate: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },
  verdictPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999, borderWidth: 1,
  },
  verdictText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  subComment: { color: T.textSecondary || T.textMuted, fontSize: T.small, marginTop: T.xs, lineHeight: 18 },
  creditRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: T.xs },
  creditText: { color: T.primary, fontSize: T.tiny, fontWeight: '700' },
  adminNote: { color: T.textMuted, fontSize: T.tiny, marginTop: T.xs, fontStyle: 'italic' },
});
