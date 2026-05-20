/**
 * Phase 2.B — Mobile referrals screen.
 *
 * Strict architecture rule (see /app/web/ARCHITECTURE.md):
 *   • UI renders JSON. Backend is the source of truth.
 *   • No client-side aggregation, filtering, or recomputation.
 *
 * All numbers, tier progress, and referral lists come from a SINGLE
 * endpoint: GET /api/referral/dashboard. The link itself comes from
 * GET /api/referral/my-link (creates one if missing).
 *
 * Six blocks (per Phase 2.B spec + the "Why this works" block 6):
 *   1. Header
 *   2. Link (copy + share)
 *   3. Wallet
 *   4. Tier
 *   5. Referrals (people you invited)
 *   6. Why this works
 */

import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Share, Platform, Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../src/api';
import T from '../../src/theme';

type Wallet = { available_balance: number; pending_balance: number; lifetime_earned: number };
type Link = { code: string; commission_rate: number; tier: string; clicks: number; conversions: number };
type ReferralRow = {
  referral_id: string;
  referred_name: string;
  referred_email: string;
  commission_rate: number;
  tier: string;
  total_earned: number;
  status: string;
};
type TierInfoEntry = { tier: string; rate: number };
type Dashboard = {
  wallet: Wallet;
  link: Link | null;
  referrals: ReferralRow[];
  total_referrals: number;
  active_referrals: number;
  current_tier: string;
  tier_info: Record<string, TierInfoEntry>;
};

const PUBLIC_BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const fmtMoney = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmtPct = (r: number) => `${Math.round((r || 0) * 100)}%`;

export default function ClientReferralsScreen() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [link, setLink] = useState<Link | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, l] = await Promise.all([
        api.get('/referral/dashboard'),
        api.get('/referral/my-link'),
      ]);
      setData(d.data || null);
      setLink(l.data || null);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not load referrals');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const fullUrl = link ? `${PUBLIC_BASE}/?ref=${link.code}` : '';

  const onCopy = async () => {
    if (!fullUrl) return;
    try {
      await Clipboard.setStringAsync(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { Alert.alert('Copy failed'); }
  };

  const onShare = async () => {
    if (!fullUrl) return;
    try {
      await Share.share({
        message: `Build with EVA-X — your project gets shipped, not ticketed. ${fullUrl}`,
        url: Platform.OS === 'ios' ? fullUrl : undefined,
      });
    } catch { /* user cancelled */ }
  };

  if (data === null && error === null) {
    return <View style={s.centered}><ActivityIndicator color={T.primary} /></View>;
  }
  if (error) {
    return (
      <View style={s.centered}>
        <Text style={{ color: T.danger }}>{error}</Text>
        <TouchableOpacity style={s.retryBtn} onPress={load} testID="referrals-retry">
          <Text style={s.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!data) return null;

  const wallet = data.wallet;
  const refs = data.referrals || [];
  const tierKeys = Object.keys(data.tier_info || {});
  const currentTierKey = tierKeys.find((k) => data.tier_info[k].tier === data.current_tier) || tierKeys[0];
  const currentIdx = tierKeys.indexOf(currentTierKey);
  const nextTierKey = currentIdx >= 0 && currentIdx < tierKeys.length - 1 ? tierKeys[currentIdx + 1] : null;
  const nextTier = nextTierKey ? data.tier_info[nextTierKey] : null;
  // Backend has no explicit "progress"; we render a simple step indicator
  // based on tier position. Reading-only — no aggregation here.
  const progressPct = tierKeys.length > 1 ? Math.round(((currentIdx + 1) / tierKeys.length) * 100) : 100;
  const currentRate = link?.commission_rate ?? data.tier_info[currentTierKey]?.rate ?? 0;

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      testID="referrals-screen"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} />}
    >
      {/* Back row */}
      <View style={s.topRow}>
        <TouchableOpacity onPress={() => router.back()} testID="referrals-back" style={s.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={T.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
      </View>

      {/* BLOCK 1 — Header */}
      <View style={s.header}>
        <Text style={s.h1}>Earn with EVA-X</Text>
        <Text style={s.h1Sub}>
          Get {fmtPct(currentRate)} from every project your referrals build.
        </Text>
      </View>

      {/* BLOCK 2 — Link */}
      <View style={s.card} testID="referrals-link-card">
        <Text style={s.label}>YOUR LINK</Text>
        <View style={s.linkBox}>
          <Text style={s.linkText} numberOfLines={1} testID="referrals-link-url">
            {fullUrl || '—'}
          </Text>
        </View>
        <View style={s.linkActionRow}>
          <TouchableOpacity
            testID="referrals-copy-btn"
            style={[s.linkBtn, copied && { backgroundColor: T.primary }]}
            onPress={onCopy}
            disabled={!fullUrl}
          >
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={copied ? T.primaryInk : T.bg} />
            <Text style={[s.linkBtnText, copied && { color: T.primaryInk }]}>
              {copied ? 'Copied' : 'Copy link'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity testID="referrals-share-btn" style={s.linkShareBtn} onPress={onShare} disabled={!fullUrl}>
            <Ionicons name="share-outline" size={16} color={T.primary} />
            <Text style={s.linkShareBtnText}>Share</Text>
          </TouchableOpacity>
        </View>
        {link ? (
          <View style={s.linkStats}>
            <Stat label="CLICKS" value={String(link.clicks ?? 0)} />
            <Stat label="SIGN-UPS" value={String(link.conversions ?? 0)} />
            <Stat label="RATE" value={fmtPct(currentRate)} />
          </View>
        ) : null}
      </View>

      {/* BLOCK 3 — Wallet */}
      <Text style={s.section}>Wallet</Text>
      <View style={s.walletRow} testID="referrals-wallet">
        <WalletCell label="AVAILABLE" value={fmtMoney(wallet.available_balance)} accent={T.primary} testID="wallet-available" />
        <WalletCell label="PENDING"   value={fmtMoney(wallet.pending_balance)}   accent={T.warning} testID="wallet-pending" />
        <WalletCell label="LIFETIME"  value={fmtMoney(wallet.lifetime_earned)}   accent={T.text}  testID="wallet-lifetime" />
      </View>

      {/* BLOCK 4 — Tier */}
      <Text style={s.section}>Your tier</Text>
      <View style={s.card} testID="referrals-tier-card">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={s.tierNow}>{data.current_tier?.toUpperCase()} · {fmtPct(currentRate)}</Text>
          {nextTier ? (
            <Text style={s.tierNext}>Next: {nextTier.tier?.toUpperCase()} ({fmtPct(nextTier.rate)})</Text>
          ) : (
            <Text style={s.tierNext}>Top tier reached</Text>
          )}
        </View>
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${progressPct}%` }]} />
        </View>
        <Text style={s.tierHint}>
          {data.total_referrals} referral{data.total_referrals === 1 ? '' : 's'} · {data.active_referrals} active
        </Text>
      </View>

      {/* BLOCK 5 — Referrals */}
      <Text style={s.section}>People you invited</Text>
      {refs.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>No one yet. Share your link to start earning.</Text>
        </View>
      ) : (
        refs.map((r) => (
          <View key={r.referral_id} style={s.refRow} testID={`referrals-row-${r.referral_id}`}>
            <View style={s.refAvatar}>
              <Text style={s.refAvatarText}>{(r.referred_name || '?').charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.refName} numberOfLines={1}>{r.referred_name}</Text>
              <Text style={s.refStatus}>
                {r.status === 'active' ? 'Active' : r.status} · {r.tier}
              </Text>
            </View>
            <Text style={s.refEarned}>{fmtMoney(r.total_earned)}</Text>
          </View>
        ))
      )}

      {/* BLOCK 6 — Why this works */}
      <Text style={s.section}>How it works</Text>
      <View style={s.howCard}>
        <Step n="1" title="Invite a friend" body="Share your link. Anyone who lands on it joins your network." />
        <Step n="2" title="They start a project" body="When they pay for their first project, you become eligible to earn." />
        <Step n="3" title="You earn %" body={`You get ${fmtPct(currentRate)} of every paid invoice from the projects they build.`} />
      </View>

      <Text style={s.footer}>Build products. Not tickets.</Text>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.statCell}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function WalletCell({ label, value, accent, testID }: { label: string; value: string; accent: string; testID?: string }) {
  return (
    <View style={s.walletCell} testID={testID}>
      <Text style={[s.walletValue, { color: accent }]}>{value}</Text>
      <Text style={s.walletLabel}>{label}</Text>
    </View>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <View style={s.stepRow}>
      <View style={s.stepBadge}><Text style={s.stepBadgeText}>{n}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={s.stepTitle}>{title}</Text>
        <Text style={s.stepBody}>{body}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.lg, paddingBottom: T.xl * 2 },
  centered: { flex: 1, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center' },

  topRow: { flexDirection: 'row', alignItems: 'center', marginBottom: T.sm },
  iconBtn: { padding: 6 },

  header: { marginBottom: T.lg },
  h1: { color: T.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  h1Sub: { color: T.textMuted, fontSize: T.body, marginTop: 8, lineHeight: 22 },

  label: { color: T.textMuted, fontSize: 10, letterSpacing: 2, fontWeight: '800', marginBottom: 6 },

  card: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    padding: T.md, borderWidth: 1, borderColor: T.border,
    marginBottom: T.lg,
  },

  linkBox: {
    backgroundColor: T.surface2, borderRadius: T.radiusSm,
    paddingHorizontal: T.md, paddingVertical: 12,
    borderWidth: 1, borderColor: T.border,
  },
  linkText: { color: T.text, fontSize: T.small, fontWeight: '600' },
  linkActionRow: { flexDirection: 'row', gap: T.sm, marginTop: T.sm },
  linkBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: T.primary, borderRadius: T.radiusSm, paddingVertical: 12,
  },
  linkBtnText: { color: T.bg, fontWeight: '800' },
  linkShareBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: T.surface2, borderRadius: T.radiusSm, paddingVertical: 12,
    borderWidth: 1, borderColor: T.primary,
  },
  linkShareBtnText: { color: T.primary, fontWeight: '700' },
  linkStats: { flexDirection: 'row', marginTop: T.md, gap: T.md },
  statCell: { flex: 1 },
  statValue: { color: T.text, fontSize: T.h3, fontWeight: '800' },
  statLabel: { color: T.textMuted, fontSize: 10, letterSpacing: 2, fontWeight: '700', marginTop: 2 },

  section: { color: T.text, fontSize: T.body, fontWeight: '700', marginTop: T.md, marginBottom: T.sm },

  walletRow: { flexDirection: 'row', gap: T.sm, marginBottom: T.lg },
  walletCell: {
    flex: 1, backgroundColor: T.surface1, borderRadius: T.radius,
    paddingVertical: T.md, paddingHorizontal: T.sm,
    borderWidth: 1, borderColor: T.border, alignItems: 'flex-start',
  },
  walletValue: { fontSize: T.h3, fontWeight: '800' },
  walletLabel: { color: T.textMuted, fontSize: 10, letterSpacing: 2, fontWeight: '700', marginTop: 4 },

  tierNow: { color: T.text, fontSize: T.body, fontWeight: '800' },
  tierNext: { color: T.textMuted, fontSize: T.small, fontWeight: '600' },
  progressTrack: {
    height: 6, borderRadius: 3, backgroundColor: T.surface2, overflow: 'hidden',
    marginTop: T.md, marginBottom: T.sm,
  },
  progressFill: { height: '100%', backgroundColor: T.primary, borderRadius: 3 },
  tierHint: { color: T.textMuted, fontSize: T.tiny },

  empty: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    padding: T.md, borderWidth: 1, borderColor: T.border,
  },
  emptyText: { color: T.textMuted, fontSize: T.small },

  refRow: {
    flexDirection: 'row', alignItems: 'center', gap: T.md,
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.md, marginBottom: 8,
    borderWidth: 1, borderColor: T.border,
  },
  refAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: T.surface2,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: T.border,
  },
  refAvatarText: { color: T.text, fontWeight: '800', fontSize: 14 },
  refName: { color: T.text, fontSize: T.body, fontWeight: '700' },
  refStatus: { color: T.textMuted, fontSize: T.small, marginTop: 2 },
  refEarned: { color: T.success, fontWeight: '800', fontSize: T.body },

  howCard: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    padding: T.md, borderWidth: 1, borderColor: T.border,
  },
  stepRow: { flexDirection: 'row', gap: T.md, marginVertical: 6 },
  stepBadge: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: T.primaryBgStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  stepBadgeText: { color: T.primary, fontWeight: '800' },
  stepTitle: { color: T.text, fontWeight: '700', fontSize: T.body },
  stepBody: { color: T.textMuted, fontSize: T.small, marginTop: 2, lineHeight: 18 },

  retryBtn: { marginTop: T.md, padding: T.md, backgroundColor: T.surface1, borderRadius: T.radiusSm },
  retryText: { color: T.primary, fontWeight: '700' },

  footer: { color: T.textMuted, fontSize: T.tiny, textAlign: 'center', marginTop: T.lg, opacity: 0.6 },
});
