import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { runtime } from '../../../src/runtime';
import { useValidator } from '../../../src/validator-context';
import T from '../../../src/theme';

/**
 * Human Validation Layer — entry screen for clients.
 *
 * Architecture (v2, 2026-05-18):
 *   Validator is NOT a separate role. It's a capability flag on the client
 *   account (users.features.validation_enabled). This screen has two modes:
 *
 *   1. NOT opted in → show "Join Human Validation Program" CTA
 *   2. Opted in    → show missions + stats + history link
 *
 * Backend:
 *   GET  /api/validator/status                 → {enabled, profile?}
 *   POST /api/validator/opt-in                 → marks user.features.validation_enabled=true
 *   GET  /api/validator/missions               → available missions (requires enabled)
 */
type Mission = {
  campaign_id: string;
  project_title: string;
  goal: string;
  reward_per_useful: number;
  max_validators: number;
  validators_count: number;
  deadline_at: string;
  checklist: string[];
};
type Profile = {
  credits_balance: number;
  reputation_score: number;
  useful_count: number;
  total_submissions: number;
};

function repTag(score: number): { text: string; color: string } {
  if (score >= 80) return { text: 'Trusted', color: T.success };
  if (score >= 60) return { text: 'Active',  color: T.info };
  if (score >= 40) return { text: 'Building', color: T.warning };
  return { text: 'New', color: T.textMuted };
}
function deadlineLabel(iso: string): string {
  try {
    const dl = new Date(iso).getTime();
    const hours = Math.max(0, Math.round((dl - Date.now()) / 36e5));
    if (hours < 1) return 'closing soon';
    if (hours < 24) return `${hours}h left`;
    return `${Math.round(hours / 24)}d left`;
  } catch { return ''; }
}

export default function ValidationHome() {
  const router = useRouter();
  const { refresh: refreshValidatorCtx, setEnabled: setValidatorCtxEnabled } = useValidator();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [optingIn, setOptingIn] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await runtime.get<{ enabled: boolean; profile: Profile | null }>('/api/validator/status');
      const en = !!s.data?.enabled;
      setEnabled(en);
      setProfile(s.data?.profile || null);
      if (en) {
        const m = await runtime.get<Mission[]>('/api/validator/missions');
        setMissions(Array.isArray(m.data) ? m.data : []);
      }
    } catch { /* swallow */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const optIn = async () => {
    setOptingIn(true);
    try {
      await runtime.post('/api/validator/opt-in', {});
      // Optimistically flip the global capability flag so the Validation tab
      // appears in the bottom-nav immediately, then re-verify via refresh().
      setValidatorCtxEnabled(true);
      await Promise.all([load(), refreshValidatorCtx()]);
    } catch {
      setOptingIn(false);
    }
  };

  const optOut = async () => {
    try {
      await runtime.post('/api/validator/opt-out', {});
      setValidatorCtxEnabled(false);
      await Promise.all([load(), refreshValidatorCtx()]);
    } catch { /* swallow */ }
  };

  if (loading || enabled === null) {
    return (
      <View style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={T.primary} />
      </View>
    );
  }

  // ---------- OPT-IN MODE ----------
  if (!enabled) {
    return (
      <ScrollView testID="validation-opt-in" style={s.container}>
        <View style={s.content}>
          <Text style={s.kicker}>HUMAN VALIDATION LAYER</Text>
          <Text style={s.title}>Help shape products before launch</Text>
          <Text style={s.subtitle}>
            Independent reviewers click through products and report visual, UX,
            and mobile issues. Your feedback helps teams polish their work.
            You earn credits when reviews are marked useful.
          </Text>

          <View style={s.optInCard}>
            <View style={s.optInRow}>
              <Ionicons name="eye-outline" size={20} color={T.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.optInHeading}>Review apps before launch</Text>
                <Text style={s.optInBody}>Open a product, click around, share what you noticed.</Text>
              </View>
            </View>
            <View style={s.optInRow}>
              <Ionicons name="diamond-outline" size={20} color={T.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.optInHeading}>Earn credits</Text>
                <Text style={s.optInBody}>Get credits when your feedback is marked useful by the team.</Text>
              </View>
            </View>
            <View style={s.optInRow}>
              <Ionicons name="shield-checkmark-outline" size={20} color={T.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.optInHeading}>No pressure</Text>
                <Text style={s.optInBody}>Skip missions anytime. You stay a client first. Opt out whenever you want.</Text>
              </View>
            </View>
          </View>

          <TouchableOpacity
            testID="validation-opt-in-btn"
            style={[s.primaryBtn, optingIn && { opacity: 0.6 }]}
            onPress={optIn}
            disabled={optingIn}
          >
            <Text style={s.primaryBtnText}>{optingIn ? 'Joining…' : 'Join Human Validation Program'}</Text>
          </TouchableOpacity>

          <Text style={s.fineprint}>
            You will not be approving releases or doing engineering QA. You contribute
            human signal. Admins decide what is useful — no appeals.
          </Text>
        </View>
      </ScrollView>
    );
  }

  // ---------- ENABLED — MISSIONS ----------
  const rep = repTag(profile?.reputation_score ?? 50);

  return (
    <ScrollView
      testID="validation-missions"
      style={s.container}
      refreshControl={
        <RefreshControl refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          tintColor={T.primary} />
      }
    >
      <View style={s.content}>
        <Text style={s.kicker}>HUMAN VALIDATION LAYER</Text>
        <Text style={s.title}>Review missions</Text>
        <Text style={s.subtitle}>Open a product. Tell us what you noticed.</Text>

        {/* Wallet strip */}
        <View testID="validation-wallet" style={s.walletRow}>
          <View style={s.walletCard}>
            <Text style={s.walletLabel}>CREDITS</Text>
            <Text style={s.walletValue}>{profile?.credits_balance ?? 0}</Text>
          </View>
          <View style={s.walletCard}>
            <Text style={s.walletLabel}>REPUTATION</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Text style={s.walletValue}>{profile?.reputation_score ?? 50}</Text>
              <Text style={[s.repTag, { color: rep.color }]}>{rep.text}</Text>
            </View>
          </View>
          <View style={s.walletCard}>
            <Text style={s.walletLabel}>USEFUL</Text>
            <Text style={s.walletValue}>{profile?.useful_count ?? 0}</Text>
          </View>
        </View>

        {/* History link */}
        <TouchableOpacity
          testID="validation-history-link"
          style={s.historyLink}
          onPress={() => router.push('/client/validation/history' as any)}
        >
          <Ionicons name="time-outline" size={14} color={T.textMuted} />
          <Text style={s.historyLinkText}>View my submissions & credits history</Text>
          <Ionicons name="chevron-forward" size={14} color={T.textMuted} />
        </TouchableOpacity>

        <Text style={s.sectionTitle}>Available missions</Text>
        {missions.length === 0 && (
          <View style={s.empty}>
            <Ionicons name="moon-outline" size={28} color={T.textMuted} />
            <Text style={s.emptyText}>No open missions right now.</Text>
            <Text style={s.emptySub}>Pull down to refresh — new missions appear when teams launch them.</Text>
          </View>
        )}
        {missions.map((m) => (
          <TouchableOpacity
            key={m.campaign_id}
            testID={`mission-card-${m.campaign_id}`}
            style={s.missionCard}
            activeOpacity={0.85}
            onPress={() => router.push(`/client/validation/mission/${m.campaign_id}` as any)}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: T.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={s.missionGoal}>{m.goal.toUpperCase()}</Text>
                <Text style={s.missionTitle}>{m.project_title}</Text>
              </View>
              <View style={s.rewardPill}>
                <Ionicons name="diamond-outline" size={11} color={T.primaryInk} />
                <Text style={s.rewardText}>+{m.reward_per_useful}</Text>
              </View>
            </View>
            <View style={s.missionMeta}>
              <Text style={s.missionMetaText}>
                {m.validators_count}/{m.max_validators} reviewers · {deadlineLabel(m.deadline_at)}
              </Text>
            </View>
            <View style={s.checklistRow}>
              {m.checklist.slice(0, 3).map((c, i) => (
                <View key={i} style={s.chip}><Text style={s.chipText}>{c}</Text></View>
              ))}
              {m.checklist.length > 3 && <Text style={s.checklistMore}>+{m.checklist.length - 3}</Text>}
            </View>
          </TouchableOpacity>
        ))}

        <View style={s.footnote}>
          <Ionicons name="information-circle-outline" size={14} color={T.textMuted} />
          <Text style={s.footnoteText}>
            You contribute perception signal. Admins decide what is useful. No
            approvals, no rejections from your side.
          </Text>
        </View>

        <TouchableOpacity
          testID="validation-opt-out-btn"
          style={s.optOutBtn}
          onPress={optOut}
          activeOpacity={0.7}
        >
          <Text style={s.optOutText}>Leave program</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md },
  kicker: { color: T.primary, fontSize: 10, letterSpacing: 2.5, fontWeight: '700', marginBottom: 6 },
  title: { color: T.text, fontSize: T.h1, fontWeight: '800' },
  subtitle: { color: T.textMuted, fontSize: T.small, marginTop: T.xs, marginBottom: T.lg, lineHeight: 18 },
  optInCard: {
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.md, marginBottom: T.lg, gap: T.md,
    borderWidth: 1, borderColor: T.border,
  },
  optInRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  optInHeading: { color: T.text, fontSize: T.body, fontWeight: '700', marginBottom: 2 },
  optInBody: { color: T.textMuted, fontSize: T.small, lineHeight: 18 },
  primaryBtn: { backgroundColor: T.primary, borderRadius: T.radiusSm, paddingVertical: 14, alignItems: 'center' },
  primaryBtnText: { color: T.primaryInk, fontSize: T.body, fontWeight: '800' },
  fineprint: { color: T.textMuted, fontSize: T.tiny, marginTop: T.md, lineHeight: 16, paddingHorizontal: T.xs, textAlign: 'center' },
  walletRow: { flexDirection: 'row', gap: T.sm, marginBottom: T.md },
  walletCard: {
    flex: 1, backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.sm, borderWidth: 1, borderColor: T.border,
  },
  walletLabel: { color: T.textMuted, fontSize: 9, letterSpacing: 1.5, marginBottom: 4 },
  walletValue: { color: T.text, fontSize: 20, fontWeight: '800' },
  repTag: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  historyLink: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: T.sm, paddingHorizontal: T.sm,
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    marginBottom: T.lg, borderWidth: 1, borderColor: T.border,
  },
  historyLinkText: { flex: 1, color: T.textMuted, fontSize: T.small },
  sectionTitle: { color: T.textMuted, fontSize: T.small, textTransform: 'uppercase', letterSpacing: 2, marginBottom: T.sm },
  empty: {
    alignItems: 'center', gap: T.xs,
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.lg, borderWidth: 1, borderColor: T.border, borderStyle: 'dashed',
  },
  emptyText: { color: T.text, fontSize: T.body, fontWeight: '600' },
  emptySub: { color: T.textMuted, fontSize: T.small, textAlign: 'center' },
  missionCard: {
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.md, marginBottom: T.sm,
    borderWidth: 1, borderColor: T.border,
  },
  missionGoal: { color: T.primary, fontSize: 10, letterSpacing: 1.8, fontWeight: '700' },
  missionTitle: { color: T.text, fontSize: T.body, fontWeight: '700', marginTop: 4 },
  rewardPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: T.primary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
  },
  rewardText: { color: T.primaryInk, fontSize: 11, fontWeight: '800' },
  missionMeta: { marginTop: 6 },
  missionMetaText: { color: T.textMuted, fontSize: T.tiny },
  checklistRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: T.sm, alignItems: 'center' },
  chip: { backgroundColor: T.surface2 || T.surface1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: T.border },
  chipText: { color: T.textSecondary || T.textMuted, fontSize: 10 },
  checklistMore: { color: T.textMuted, fontSize: 10 },
  footnote: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: T.lg, paddingHorizontal: T.sm },
  footnoteText: { flex: 1, color: T.textMuted, fontSize: T.tiny, lineHeight: 16 },
  optOutBtn: {
    marginTop: T.lg,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: T.radiusSm,
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor: 'transparent',
  },
  optOutText: { color: T.textMuted, fontSize: T.small, fontWeight: '600' },
});
