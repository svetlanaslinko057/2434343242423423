import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../src/api';
import { useMe } from '../src/use-me';
import { PulseDot, StatusDot, FadeSlideIn, SectionLabel } from '../src/ui';
import { motion } from '../src/motion';
import T from '../src/theme';
import { useAppStatePolling } from '../src/hooks/useAppStatePolling';

/**
 * L0 Live Activity feed.
 *
 * Pure log stream — one event per row. "Dashboard UI completed · 12s ago".
 * No verb chatter, no meta line, no "auto-updates every N seconds" noise.
 *
 * Reads /api/activity/live (polled every 10s). The backend is the truth — the
 * UI only renders.
 */

type Event = {
  at: string;
  module_title: string;
  project_title: string;
  project_id: string;
  verb: 'completed' | 'moved to review' | 'started';
  dot: 'green' | 'yellow' | 'blue';
};

const DOT_TO_STATUS: Record<Event['dot'], 'done' | 'review' | 'active'> = {
  green: 'done',
  yellow: 'review',
  blue: 'active',
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const s = Math.floor(diff / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Bucket an event into a coarse time group so activity feels rhythmic,
 *  not like a wall of same-weight rows. Buckets are ordered most-recent-first. */
function bucketFor(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'JUST NOW';
  const m = Math.floor(s / 60);
  if (m < 5) return 'A FEW MINUTES AGO';
  if (m < 60) return `${m} MIN AGO`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}H AGO`;
  return 'EARLIER';
}

export default function Activity() {
  const router = useRouter();
  const { me } = useMe();
  const [events, setEvents] = useState<Event[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/activity/live');
      setEvents(Array.isArray(r.data?.events) ? r.data.events : []);
      setError(null);
    } catch (e: any) {
      setEvents([]);
      setError(e?.response?.status === 401
        ? 'Sign in to see live activity.'
        : e?.response?.data?.detail || 'Failed to load activity');
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useAppStatePolling(load, 10_000);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (events === null) {
    return <View style={s.centered}><ActivityIndicator color={T.primary} /></View>;
  }

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} />}
      testID="activity-screen"
    >
      {/* Minimal live banner — one pulse + one line. */}
      <FadeSlideIn style={{ marginBottom: T.xl }}>
        <View style={s.banner}>
          <PulseDot size={8} />
          <Text style={s.bannerText}>
            {events.length > 0 ? 'System is live' : 'System is idle'}
          </Text>
        </View>
      </FadeSlideIn>

      <SectionLabel style={{ marginBottom: T.sm }}>Activity</SectionLabel>

      {/* Phase 3.D — pending contract gate. Shown ONLY when backend
          flags an unsigned draft contract on /me. Routing brings the
          user to the single-decision contract screen. */}
      {(me as any)?.pending_contract ? (
        <FadeSlideIn>
          <TouchableOpacity
            testID="activity-pending-contract"
            style={s.pendingCard}
            activeOpacity={0.85}
            onPress={() => {
              const pc = (me as any).pending_contract;
              router.push(`/client/contract/${pc.project_id}` as any);
            }}
          >
            <View style={s.pendingIcon}>
              <Ionicons name="document-text-outline" size={20} color={T.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.pendingTitle}>Waiting for your approval</Text>
              <Text style={s.pendingSub}>
                {(me as any).pending_contract.project_title} · accept to start development
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
          </TouchableOpacity>
        </FadeSlideIn>
      ) : null}

      {/* Phase 2.A — earning opportunity. Only shown when backend marks
          the user as referral_eligible (>=1 project AND total_spent > 0).
          Brand-new users never see this — keeps trust intact. */}
      {(me as any)?.referral_eligible ? (
        <FadeSlideIn>
          <TouchableOpacity
            testID="activity-earning-block"
            style={s.earnCard}
            activeOpacity={0.85}
            onPress={() => router.push('/client/referrals' as any)}
          >
            <View style={s.earnIcon}>
              <Ionicons name="cash-outline" size={20} color={T.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.earnTitle}>Earn with EVA-X</Text>
              <Text style={s.earnSub}>Get 7% from every project you bring</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
          </TouchableOpacity>
        </FadeSlideIn>
      ) : null}

      {error && (
        <Text style={s.errorText}>{error}</Text>
      )}

      {events.length === 0 ? (
        <FadeSlideIn>
          <Text style={s.emptyText}>
            {me?.states?.length
              ? 'No events yet. Modules will appear here as they start, move to review and complete.'
              : 'Start your first project from Home — activity will appear here once modules begin.'}
          </Text>
        </FadeSlideIn>
      ) : (
        (() => {
          // Group events by time bucket for "time rhythm" — JUST NOW / 3 MIN AGO / …
          let lastBucket = '';
          let globalIndex = 0;
          const nodes: any[] = [];
          events.forEach((ev, i) => {
            const bucket = bucketFor(ev.at);
            if (bucket !== lastBucket) {
              nodes.push(
                <SectionLabel
                  key={`bucket-${i}`}
                  style={{ marginTop: lastBucket ? T.lg : 0, marginBottom: T.sm }}
                >
                  {bucket}
                </SectionLabel>,
              );
              lastBucket = bucket;
            }
            nodes.push(
              <FadeSlideIn
                key={`${ev.project_id}-${i}`}
                delay={globalIndex * motion.staggerStep}
              >
                <View style={s.row} testID={`activity-event-${i}`}>
                  <View style={{ paddingTop: 6 }}>
                    <StatusDot status={DOT_TO_STATUS[ev.dot]} size={8} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle} numberOfLines={2}>
                      {ev.module_title} {ev.verb}
                    </Text>
                    <Text style={s.rowMeta}>{relativeTime(ev.at)}</Text>
                  </View>
                </View>
              </FadeSlideIn>,
            );
            globalIndex += 1;
          });
          return nodes;
        })()
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.lg, paddingBottom: T.xl * 2 },
  centered: { flex: 1, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center' },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.sm,
  },
  bannerText: { color: T.text, fontSize: 15, fontWeight: '500' },

  errorText: { color: T.danger, fontSize: 13, marginBottom: T.md },
  emptyText: { color: T.textMuted, fontSize: 14, lineHeight: 20 },

  row: {
    flexDirection: 'row',
    gap: T.md,
    paddingVertical: T.md,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  rowTitle: { color: T.text, fontSize: 15 },
  rowMeta: { color: T.textSecondary, fontSize: 13, marginTop: 2 },

  pendingCard: {
    flexDirection: 'row', alignItems: 'center', gap: T.md,
    backgroundColor: '#F59E0B14', borderColor: '#F59E0B66',
    borderWidth: 1, borderRadius: T.radius,
    padding: T.md, marginBottom: T.md,
  },
  pendingIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#F59E0B22',
    alignItems: 'center', justifyContent: 'center',
  },
  pendingTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  pendingSub: { color: T.textMuted, fontSize: T.small, marginTop: 2 },

  earnCard: {
    flexDirection: 'row', alignItems: 'center', gap: T.md,
    backgroundColor: T.primaryBg, borderColor: T.primaryBg,
    borderWidth: 1, borderRadius: T.radius,
    padding: T.md, marginBottom: T.lg,
  },
  earnIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: T.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  earnTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  earnSub: { color: T.textMuted, fontSize: T.small, marginTop: 2 },
});
