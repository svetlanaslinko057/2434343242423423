import { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/api';
import T from '../../src/theme';
import { ScreenTitle, SectionLabel, Banner, StatCard, StatusPill, MiniProgress, EmptyState } from '../../src/ui-client';
import { PressScale, FadeSlideIn } from '../../src/ui';
import RevenueTimeline from '../../src/revenue-timeline';
import ClientOpportunityFeed from '../../src/client-opportunity-feed';
import RetainerOffer from '../../src/retainer-offer';
import MagicClientPull from '../../src/magic-client-pull';
import { SystemActionsFeed } from '../../src/system-actions-feed';
import PendingLeadBanner from '../../src/pending-lead-banner';
import DecisionHub from '../../src/decision-hub';

// Pure label maps — no aggregation, no decisions.
const RISK_TONE: Record<string, 'success' | 'risk' | 'danger'> = {
  healthy: 'success', watch: 'risk', at_risk: 'danger', blocked: 'danger',
};
const RISK_LABEL: Record<string, string> = {
  healthy: 'On track', watch: 'Watching', at_risk: 'At risk', blocked: 'Blocked',
};

export default function ClientHome() {
  const [operator, setOperator] = useState<any>(null);
  const [costs, setCosts] = useState<any>(null);
  const [attention, setAttention] = useState<any>(null);
  const [owner, setOwner] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const load = async () => {
    try {
      const [op, co, at, ow] = await Promise.all([
        api.get('/client/operator'),
        api.get('/client/costs'),
        api.get('/client/attention').catch(() => ({ data: null })),
        api.get('/client/owner-summary').catch(() => ({ data: null })),
      ]);
      setOperator(op.data);
      setCosts(co.data);
      setAttention(at.data);
      setOwner(ow.data);
    } catch { /* silent — auth interceptor */ }
  };
  useEffect(() => { load(); }, []);

  // Pure projection — backend.risk_state / backend.cost_status drive the UI.
  const activeProjects = (operator?.projects || []).map((p: any) => ({
    project_id: p.project_id,
    title: p.project_title,
    risk_state: p.risk_state || 'healthy',
    headline: p.headline,
    modules_total: p.summary?.total_modules ?? 0,
    modules_active: p.summary?.active_count ?? 0,
    modules_done: p.summary?.done_count ?? 0,
    progress_pct: p.summary?.total_modules > 0
      ? Math.round((p.summary.done_count / p.summary.total_modules) * 100)
      : 0,
  }));

  const fin = costs?.summary || {};
  const fmtMoney = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  const attentionParts: string[] = [];
  if (attention?.pending_approvals > 0) attentionParts.push(`${attention.pending_approvals} approval${attention.pending_approvals > 1 ? 's' : ''}`);
  if (attention?.pending_payments > 0)  attentionParts.push(`${attention.pending_payments} payment${attention.pending_payments > 1 ? 's' : ''}`);
  if (attention?.blocked_modules > 0)   attentionParts.push(`${attention.blocked_modules} blocked`);
  if (attention?.awaiting_deposit > 0)  attentionParts.push(`${attention.awaiting_deposit} deposit${attention.awaiting_deposit > 1 ? 's' : ''}`);

  const firstProjectId = activeProjects[0]?.project_id;
  // First awaiting-deposit project drives the CTA — fresh signups land here.
  const awaitingDeposits: any[] = attention?.awaiting_deposit_projects || [];
  const firstDepositProjectId = awaitingDeposits[0]?.project_id;
  const ctaProjectId = firstDepositProjectId || firstProjectId;

  return (
    <ScrollView
      style={s.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={T.primary} />}
    >
      <View testID="client-dashboard" style={s.content}>
        <ScreenTitle title="Dashboard" subtitle="Owner · Operator assisted" testID="client-home-title" />

        {/* Owner block — frame the user as Owner of a managed product */}
        {owner && owner.products_count > 0 && (
          <FadeSlideIn>
            <PressScale onPress={() => router.push('/client/billing/plans' as any)} testID="owner-summary">
              <View style={s.owner}>
                <Text style={s.ownerLabel}>YOU ARE RUNNING</Text>
                <Text style={s.ownerHeadline}>
                  {owner.products_count} {owner.products_count === 1 ? 'product' : 'products'}
                </Text>
                <Text style={s.ownerInvested}>
                  {owner.invested > 0 ? `${fmtMoney(owner.invested)} invested` : 'Setup phase'}
                  {owner.added_this_month > 0 ? `  ·  +${fmtMoney(owner.added_this_month)} this month` : ''}
                </Text>
                <View style={s.ownerFooter}>
                  <Ionicons name={owner.system_active ? 'hardware-chip' : 'pause-circle-outline'} size={14} color={owner.system_active ? T.primary : T.textMuted} />
                  <Text style={[s.ownerSystem, !owner.system_active && { color: T.textMuted }]}>
                    {owner.system_active ? 'System actively managing everything' : 'System idle'}
                  </Text>
                </View>
              </View>
            </PressScale>
          </FadeSlideIn>
        )}

        {/* Attention vs Trust banner — mutually exclusive */}
        {attention?.total > 0 ? (
          <Banner
            tone="danger"
            icon="alert-circle"
            title="Your product needs attention"
            sub={attentionParts.join(' · ')}
            action="Review now"
            onAction={() => ctaProjectId && router.push(`/client/projects/${ctaProjectId}` as any)}
            testID="attention-block"
          />
        ) : (attention && activeProjects.length > 0) ? (
          <Banner
            tone="success"
            icon="hardware-chip"
            title="Project is being actively managed"
            sub="System is on it · no action required"
            testID="operator-trust-block"
          />
        ) : null}

        {/* Awaiting-deposit sidebar — surfaces post-signup projects that
            need the 10% escrow deposit before development can begin. */}
        {awaitingDeposits.length > 0 && (
          <View testID="awaiting-deposit-sidebar" style={s.depositSidebar}>
            <View style={s.depositSidebarHeader}>
              <Ionicons name="lock-closed" size={14} color={T.warning} />
              <Text style={s.depositSidebarLabel}>AWAITING DEPOSIT</Text>
            </View>
            {awaitingDeposits.map((p: any) => (
              <TouchableOpacity
                key={p.project_id}
                testID={`awaiting-deposit-${p.project_id}`}
                style={s.depositSidebarRow}
                onPress={() => router.push(`/client/projects/${p.project_id}` as any)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.depositSidebarTitle} numberOfLines={1}>{p.name}</Text>
                  <Text style={s.depositSidebarMeta}>
                    Estimate {fmtMoney(p.final_price)} · deposit {fmtMoney(p.deposit_amount)}
                  </Text>
                </View>
                <View style={s.depositSidebarCta}>
                  <Text style={s.depositSidebarCtaText}>Pay</Text>
                  <Ionicons name="chevron-forward" size={12} color={T.bg} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Decision Hub — silent when empty */}
        <DecisionHub />
        <PendingLeadBanner />
        <MagicClientPull />
        <SystemActionsFeed />

        {/* Financial snapshot — stat strip */}
        <SectionLabel>Financial snapshot</SectionLabel>
        <View style={s.statRow}>
          <StatCard label="Paid"   value={fmtMoney(fin.paid_out)} accent={T.success} testID="client-home-paid" />
          <StatCard label="Earned" value={fmtMoney(fin.earned)}   testID="client-home-earned" />
          <StatCard label="Profit" value={fmtMoney(fin.profit)}   accent={(fin.profit ?? 0) >= 0 ? T.success : T.danger} testID="client-home-profit" />
        </View>

        {/* Active projects */}
        <SectionLabel>Active projects</SectionLabel>
        {activeProjects.length === 0 ? (
          <EmptyState
            icon="folder-open-outline"
            title="No active projects"
            sub="Tap below to start one — 4 questions, ready in 10 seconds."
            action="Start new project"
            onAction={() => router.push('/project/wizard' as any)}
          />
        ) : (
          activeProjects.map((p: any, i: number) => (
            <FadeSlideIn key={p.project_id} delay={i * 60}>
              <PressScale
                onPress={() => router.push(`/client/projects/${p.project_id}` as any)}
                testID={`client-home-project-${p.project_id}`}
                style={s.projectCard}
              >
                <View style={s.projectHead}>
                  <Text style={s.projectTitle} numberOfLines={1}>{p.title}</Text>
                  <StatusPill tone={RISK_TONE[p.risk_state]} label={RISK_LABEL[p.risk_state] || p.risk_state} dot />
                </View>
                {p.headline ? <Text style={s.projectHeadline} numberOfLines={2}>{p.headline}</Text> : null}
                <View style={{ marginTop: 12 }}>
                  <MiniProgress pct={p.progress_pct} />
                </View>
                <View style={s.projectMeta}>
                  <Text style={s.projectMetaText}>{p.progress_pct}% complete</Text>
                  <Text style={s.projectMetaText}>{p.modules_done}/{p.modules_total} modules</Text>
                </View>
              </PressScale>
            </FadeSlideIn>
          ))
        )}

        {/* CTA */}
        {activeProjects.length > 0 && (
          <PressScale
            onPress={() => router.push('/project/wizard' as any)}
            testID="client-home-new-project-btn"
            style={s.cta}
          >
            <Ionicons name="add-circle" size={20} color={T.bg} />
            <View style={{ flex: 1 }}>
              <Text style={s.ctaTitle}>Start new project</Text>
              <Text style={s.ctaSub}>4 questions · workspace in 10 seconds</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={T.bg} />
          </PressScale>
        )}

        {/* Existing rich modules — kept as-is, just below the new structure */}
        <View style={{ marginTop: T.lg }}>
          <RevenueTimeline />
          <ClientOpportunityFeed compact />
          <RetainerOffer />
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md, paddingBottom: 100 },

  /* Owner block */
  owner: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.primaryBorder,
    borderRadius: T.radiusLg,
    padding: T.lg,
    marginBottom: T.md,
  },
  ownerLabel: { color: T.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.8 },
  ownerHeadline: { color: T.text, fontSize: 26, fontWeight: '800', marginTop: 8, letterSpacing: -0.5 },
  ownerInvested: { color: T.textSecondary, fontSize: T.small, fontWeight: '600', marginTop: 4 },
  ownerFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: T.md, paddingTop: T.md, borderTopWidth: 1, borderTopColor: T.border },
  ownerSystem: { color: T.text, fontSize: T.tiny, fontWeight: '600', flex: 1 },

  /* Stat strip */
  statRow: { flexDirection: 'row', gap: T.sm, marginBottom: T.md },

  /* Project card */
  projectCard: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radiusLg,
    padding: T.md,
    marginBottom: T.sm,
  },
  projectHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  projectTitle: { color: T.text, fontSize: T.h3, fontWeight: '700', flex: 1 },
  projectHeadline: { color: T.textSecondary, fontSize: T.small, marginTop: 4, lineHeight: 19 },
  projectMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  projectMetaText: { color: T.textMuted, fontSize: T.tiny, fontWeight: '600' },

  /* CTA */
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: T.primary, borderRadius: T.radiusLg,
    padding: T.md, marginTop: T.lg,
  },
  ctaTitle: { color: T.bg, fontSize: T.body + 1, fontWeight: '800' },
  ctaSub: { color: T.bg, fontSize: T.tiny, opacity: 0.7, marginTop: 2 },

  /* Awaiting-deposit sidebar — fresh post-signup CTA */
  depositSidebar: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.warningBorder ?? T.border,
    borderRadius: T.radius,
    padding: T.md,
    marginBottom: T.md,
  },
  depositSidebarHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  depositSidebarLabel: { color: T.warning, fontSize: 10, fontWeight: '900', letterSpacing: 1.6 },
  depositSidebarRow: {
    flexDirection: 'row', alignItems: 'center', gap: T.sm,
    paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: T.border,
  },
  depositSidebarTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  depositSidebarMeta: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },
  depositSidebarCta: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: T.primary,
    paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: T.radiusSm,
  },
  depositSidebarCtaText: { color: T.bg, fontSize: T.tiny, fontWeight: '800' },
});
