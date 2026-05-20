import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Animated,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/api';
import {
  Card,
  StatusDot,
  PulseDot,
  ProgressBar,
  PressScale,
  FadeSlideIn,
  SectionLabel,
} from '../../src/ui';
import { motion } from '../../src/motion';
import { useFeedback } from '../../src/feedback';
import T from '../../src/theme';
import { useAppStatePolling } from '../../src/hooks/useAppStatePolling';

/**
 * Workspace — "Living" product view for a single project.
 *
 * Four layers of liveness stack here:
 *   1. Polling every 6s    — backend is the source of truth; no WS needed yet.
 *   2. Diff detection      — the moment a module changes status, we push an
 *                            "X moved to review" line into the inline activity
 *                            feed. User sees movement, not numbers.
 *   3. Micro filler events — every ~14s we inject a soft system line
 *                            (Optimizing API performance, Validating data layer
 *                            …) so the activity feed never sits still.
 *   4. Animated transitions — module rows scale-in on first render and flash
 *                             a subtle glow when their status changes.
 *
 * Contract:  GET /api/client/project/{id}/workspace  (canonical aggregator)
 *   → { project, summary, status, status_label, cause, explanation, modules }
 *
 * No client-side math for counts. All numbers come from summary/modules.
 */

const POLL_MS = 6_000;         // how often we re-pull workspace
const ACTIVITY_CAP = 10;       // max lines shown in inline feed
const ACTIVITY_POLL_MS = 6_000;

type Module = {
  module_id: string;
  module_title: string;
  status: string;
  paused_by_system: boolean;
  progress_pct: number;
  price: number;
  cost_status: string;
  developer_name: string;
};

type Summary = {
  revenue: number;
  cost: number;
  earned: number;
  paid: number;
  profit: number;
  active_modules: number;
  total_modules: number;
  over_budget_count: number;
  warning_count: number;
  paused_by_system_count: number;
};

type WorkspaceData = {
  project: { project_id: string; project_title: string; created_at?: string };
  summary: Summary;
  status: 'healthy' | 'watch' | 'at_risk' | 'blocked';
  status_label: string;
  cause?: string | null;
  explanation: string;
  modules: Module[];
};

type ActivityEvt = {
  id: string;
  kind: 'real' | 'filler';
  title: string;
  ts: number;           // epoch ms, for "ago" display
  status: 'active' | 'review' | 'done' | 'pending' | 'blocked';
};

const STATUS_LABEL: Record<WorkspaceData['status'], string> = {
  healthy: 'Building',
  watch: 'Monitoring',
  at_risk: 'At risk',
  blocked: 'Blocked',
};

const MODULE_DOT: Record<string, 'active' | 'review' | 'done' | 'pending' | 'blocked'> = {
  pending: 'pending',
  in_progress: 'active',
  review: 'review',
  done: 'done',
  paused: 'blocked',
};

const MODULE_LABEL: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
  paused: 'Paused',
};

const STATUS_VERB: Record<string, string> = {
  pending: 'is queued',
  in_progress: 'started',
  review: 'moved to review',
  done: 'completed',
  paused: 'paused by system',
};

const FILLER_LINES: string[] = [];  // deprecated — Phase 3: real events only

/** Human-friendly relative time. */
function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function Workspace() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { show: showToast } = useFeedback();
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline live activity feed (oldest at bottom).
  const [activity, setActivity] = useState<ActivityEvt[]>([]);
  const activitySeenRef = useRef<Set<string>>(new Set());
  // Tick that forces "ago" re-render every 1s (heartbeat-aware).
  const [tick, setTick] = useState(0);
  // When was the last successful load.
  const [lastUpdateTs, setLastUpdateTs] = useState<number | null>(null);
  // Modules that have a pending transition action (to disable duplicate clicks).
  const [pendingAction, setPendingAction] = useState<Record<string, boolean>>({});
  // Previous modules snapshot for diff detection.
  const prevModulesRef = useRef<Record<string, string>>({});

  // Phase 4: money pulse — fire visual burst on `earned` increase.
  const prevEarnedRef = useRef<number | null>(null);
  const moneyScale = useRef(new Animated.Value(1)).current;
  const moneyGlow = useRef(new Animated.Value(0)).current;
  // Phase 6: optimistic bump — added to `earned` between the Approve click
  // and the next poll confirmation. Lets the money number move *now*,
  // not in 6s, without lying (server is still the source of truth).
  const [optimisticEarned, setOptimisticEarned] = useState(0);
  // Phase 6: per-module forced-glow counter — bumps on Approve so the
  // card flashes green instantly instead of waiting for the next poll.
  const [approveGlowBump, setApproveGlowBump] = useState<Record<string, number>>({});
  // Phase 6: auto-scroll — ref to the page ScrollView + measured Y of the
  // activity card. When a new activity row is pushed we glide the user to it.
  const scrollRef = useRef<ScrollView>(null);
  const activityYRef = useRef<number>(0);

  // Phase 6: reusable — both the earned-diff effect and the instant Approve
  // click share the same pulse animation.
  const triggerMoneyPulse = useCallback(() => {
    Animated.sequence([
      Animated.timing(moneyScale, { toValue: 1.06, duration: 180, useNativeDriver: true }),
      Animated.timing(moneyScale, { toValue: 1, duration: 320, useNativeDriver: true }),
    ]).start();
    Animated.sequence([
      Animated.timing(moneyGlow, { toValue: 1, duration: 180, useNativeDriver: false }),
      Animated.timing(moneyGlow, { toValue: 0, duration: 500, useNativeDriver: false }),
    ]).start();
  }, [moneyGlow, moneyScale]);

  const pushActivity = useCallback((evt: Omit<ActivityEvt, 'id' | 'ts'>) => {
    setActivity((cur) => {
      const next: ActivityEvt = { ...evt, id: randomId(), ts: Date.now() };
      return [next, ...cur].slice(0, ACTIVITY_CAP);
    });
    // Phase 6: glide to the activity feed so the user *sees* the event land.
    // Uses measured Y so we don't fight with the page layout.
    if (activityYRef.current > 0) {
      const y = Math.max(0, activityYRef.current - 16);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y, animated: true });
      });
    }
  }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      const r = await api.get(`/client/project/${id}/workspace`);
      const d = r.data as WorkspaceData;

      // Diff detection — push activity events on status transitions.
      const prev = prevModulesRef.current;
      const firstRun = Object.keys(prev).length === 0;
      for (const m of d.modules) {
        const oldSt = prev[m.module_id];
        if (oldSt !== undefined && oldSt !== m.status) {
          const verb = STATUS_VERB[m.status] || `→ ${m.status}`;
          pushActivity({
            kind: 'real',
            title: `${m.module_title} ${verb}`,
            status:
              m.status === 'done' ? 'done' :
              m.status === 'review' ? 'review' :
              m.status === 'in_progress' ? 'active' :
              m.status === 'paused' ? 'blocked' : 'pending',
          });
          // RETENTION: snackbar when a module becomes ready to review —
          // this is the urgency trigger that brings the user back.
          if (m.status === 'review' && oldSt !== 'review') {
            showToast({
              type: 'info',
              title: `Review ready: ${m.module_title}`,
              subtitle: 'Tap Approve on the module card to ship it.',
              icon: 'hourglass-outline',
            });
          }
          if (m.status === 'done' && oldSt !== 'done') {
            showToast({
              type: 'success',
              title: `Shipped: ${m.module_title}`,
              subtitle: 'Your product grew by one module.',
            });
          }
        }
      }
      // On first load, seed one welcoming line so the feed isn't empty.
      if (firstRun) {
        const firstActive = d.modules.find((x) => x.status === 'in_progress');
        const seed = firstActive
          ? `${firstActive.module_title} is in progress`
          : 'System is building your product';
        pushActivity({ kind: 'real', title: seed, status: 'active' });
      }
      prevModulesRef.current = Object.fromEntries(
        d.modules.map((m) => [m.module_id, m.status]),
      );
      setData(d);
      setLastUpdateTs(Date.now());
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not load workspace');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, pushActivity, showToast]);

  // Polling — keeps the workspace alive.
  useEffect(() => { load(); }, [load]);
  useAppStatePolling(load, POLL_MS);

  // Micro filler events removed (Phase 3): feed теперь только real events
  // из timestamps модулей. Пусть чуть реже обновляется — зато правда.

  /**
   * Phase 3: live activity feed from real module timestamps.
   * Источник: GET /api/activity/workspace/:id — агрегирует started_at /
   * review_at / completed_at в сортированную ленту. На фронте мы дедуплицируем
   * по (module_id + type) чтобы не задваивать события при poll.
   */
  const loadLiveActivity = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.get(`/activity/workspace/${id}`);
      const events: any[] = Array.isArray(r.data?.events) ? r.data.events : [];
      if (events.length === 0) return;
      const fresh: ActivityEvt[] = [];
      for (const e of events) {
        const key = `${e.module_id || ''}:${e.type}:${e.at}`;
        if (activitySeenRef.current.has(key)) continue;
        activitySeenRef.current.add(key);
        const actor = e.actor || 'System';
        const verb =
          e.type === 'started' ? 'started' :
          e.type === 'review' ? 'sent for review' :
          e.type === 'done' ? 'shipped' : '→';
        fresh.push({
          kind: 'real',
          id: `act_${key}`,
          ts: new Date(e.at).getTime() || Date.now(),
          title: `${actor} ${verb} ${e.module}`,
          status: (e.type === 'done' ? 'done' : e.type === 'review' ? 'review' : 'active') as any,
        });
      }
      if (fresh.length > 0) {
        // Новые внутри fresh уже в порядке backend (newest first);
        // склеиваем с текущей лентой и обрезаем до cap.
        setActivity((cur) => [...fresh, ...cur].slice(0, ACTIVITY_CAP));
      }
    } catch {
      /* polling — тихо ждём следующего тика */
    }
  }, [id]);

  useEffect(() => { loadLiveActivity(); }, [loadLiveActivity]);
  useAppStatePolling(loadLiveActivity, ACTIVITY_POLL_MS);

  // Re-render "ago" + heartbeat labels every 1s (so the countdown ticks smoothly).
  // Pure UI clock — pauses in background to save CPU/battery.
  useAppStatePolling(() => setTick((x) => x + 1), 1000);

  /**
   * Phase 4: Money pulse.
   * Любой рост `summary.earned` between polls = момент доставленной ценности.
   * Визуализируем: число слегка увеличивается и подсвечивается зелёным.
   * Плюс пишем в activity feed "+$X delivered", чтобы мозг связал
   * событие → деньги → продукт.
   */
  useEffect(() => {
    if (!data) return;
    const cur = data.summary.earned || 0;
    const prev = prevEarnedRef.current;
    if (prev !== null && cur > prev + 0.001) {
      triggerMoneyPulse();
      const delta = Math.round(cur - prev);
      if (delta > 0) {
        pushActivity({
          kind: 'real',
          title: `+$${delta.toLocaleString()} delivered`,
          status: 'done',
        });
      }
      // Phase 6: server caught up — drop any optimistic bump we applied
      // on click so the number reflects the source of truth.
      setOptimisticEarned(0);
    }
    prevEarnedRef.current = cur;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.summary.earned]);

  /**
   * L5: module lifecycle transitions.
   *
   *   approve         → review → done
   *   request changes → review → in_progress
   *
   * Optimistic: we kick off the POST and let the next poll confirm,
   * but we push an instant activity line so the UI feels immediate.
   */
  const transitionModule = useCallback(
    async (m: Module, to: 'done' | 'in_progress', label: string) => {
      setPendingAction((cur) => ({ ...cur, [m.module_id]: true }));
      // Phase 6: dopamine loop — fire the visual reward *before* the network
      // round-trip. The server is still authoritative (next poll will either
      // confirm or silently correct), but the user gets instant feedback.
      if (to === 'done') {
        triggerMoneyPulse();
        setOptimisticEarned((v) => v + (m.price || 0));
        setApproveGlowBump((cur) => ({ ...cur, [m.module_id]: (cur[m.module_id] || 0) + 1 }));
      }
      try {
        // Client-side acceptance — routes through the acceptance layer that
        // verifies project ownership and credits the dev on approve.
        // Dev-only transition endpoint (/modules/{id}/transition) refuses
        // clients, so we never call it here.
        if (to === 'done') {
          await api.post(`/client/modules/${m.module_id}/approve`);
        } else {
          await api.post(`/client/modules/${m.module_id}/request-changes`, {});
        }
        pushActivity({
          kind: 'real',
          title: `${m.module_title} ${label}`,
          status: to === 'done' ? 'done' : 'active',
        });
        if (to === 'done') {
          showToast({
            type: 'success',
            title: `+$${Math.round(m.price || 0).toLocaleString()} delivered`,
            subtitle: `${m.module_title} shipped`,
            icon: 'checkmark-circle',
          });
        } else {
          showToast({
            type: 'info',
            title: `Sent back: ${m.module_title}`,
            subtitle: 'Developer notified — back to work.',
          });
        }
        // Don't wait for next poll — refresh immediately.
        load();
      } catch (e: any) {
        // Rollback optimistic earned on failure so we don't lie to the user.
        if (to === 'done') setOptimisticEarned((v) => Math.max(0, v - (m.price || 0)));
        showToast({
          type: 'error',
          title: 'Could not update',
          subtitle: e?.response?.data?.detail || 'Try again in a moment.',
        });
      } finally {
        setPendingAction((cur) => ({ ...cur, [m.module_id]: false }));
      }
    },
    [load, pushActivity, showToast, triggerMoneyPulse],
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading && !data) {
    return (
      <View style={s.center} testID="workspace-loading">
        <ActivityIndicator color={T.primary} size="large" />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={s.center} testID="workspace-error">
        <Text style={s.errText}>{error || 'Project not found'}</Text>
        <PressScale style={s.retryBtn} onPress={load}>
          <Text style={s.retryText}>Retry</Text>
        </PressScale>
      </View>
    );
  }

  const inProgress = data.modules.filter((m) => m.status === 'in_progress').length;
  const inReview = data.modules.filter((m) => m.status === 'review').length;
  const done = data.modules.filter((m) => m.status === 'done').length;
  const total = data.summary.total_modules || data.modules.length || 0;

  // Phase 4: progress = доставленные деньги, не число модулей.
  // Для клиента «50% модулей сделано» ≠ «$750 доставлено» —
  // второе гораздо честнее и сильнее резонирует.
  // Phase 6: add optimistic bump (cleared on next server confirmation) so the
  // hero number moves *the instant* Approve is pressed.
  const earnedServer = Math.max(0, data.summary.earned || 0);
  const revenue = Math.max(0, data.summary.revenue || 0);
  const earned = Math.min(revenue || Infinity, earnedServer + optimisticEarned);
  const remaining = Math.max(0, revenue - earned);
  const progress = revenue > 0 ? Math.min(1, earned / revenue) : 0;
  const moneyColor = moneyGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [T.text, T.primary],
  });
  const isLive = data.status === 'healthy' || data.status === 'watch';

  const needsAttention =
    data.status === 'at_risk' ||
    data.status === 'blocked' ||
    data.summary.over_budget_count > 0 ||
    data.summary.paused_by_system_count > 0;

  const firstActiveIndex = data.modules.findIndex((mm) => mm.status === 'in_progress');
  const now = Date.now();

  return (
    <ScrollView
      ref={scrollRef}
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} />}
      testID="workspace-screen"
    >
      {/* 1. PROJECT HERO — ownership-first */}
      <FadeSlideIn>
        <View style={s.hero}>
          <Text style={s.ownerEyebrow}>YOUR PRODUCT</Text>
          <View style={s.heroTopRow}>
            <Text style={s.projectTitle} testID="workspace-title" numberOfLines={2}>
              {data.project.project_title || 'Untitled project'}
            </Text>
            <View style={s.liveBadge}>
              <PulseDot size={6} />
              <Text style={s.liveBadgeText}>LIVE</Text>
            </View>
          </View>

          {/* Phase 4: MONEY IN WORKSPACE — value delivered, not just progress. */}
          <View style={s.moneyBlock} testID="workspace-money">
            <View style={s.moneyTopRow}>
              <Animated.Text
                style={[
                  s.moneyDelivered,
                  { color: moneyColor, transform: [{ scale: moneyScale }] },
                ]}
                testID="workspace-money-delivered"
              >
                ${Math.round(earned).toLocaleString()}
              </Animated.Text>
              <Text style={s.moneyDeliveredLabel}>delivered</Text>
            </View>
            <Text style={s.moneyRemaining} testID="workspace-money-remaining">
              ${Math.round(remaining).toLocaleString()} remaining of $
              {Math.round(revenue).toLocaleString()}
            </Text>
            <Text style={s.moneyCaption}>Your product is growing in real time</Text>
          </View>

          <Text style={s.projectMeta}>{total} modules</Text>
        </View>
      </FadeSlideIn>

      {/* 2. LIVE STATUS + HEARTBEAT */}
      <FadeSlideIn delay={motion.staggerStep}>
        <Card style={{ marginBottom: T.md }} testID="workspace-status-card">
          <View style={s.statusRow}>
            {isLive ? <PulseDot /> : <StatusDot status={data.status === 'blocked' ? 'blocked' : 'review'} />}
            <Text style={s.statusText}>{STATUS_LABEL[data.status]}</Text>
          </View>
          <Text style={s.countLine}>
            {inProgress} in progress · {inReview} review · {done} done
          </Text>
          <View style={{ marginTop: T.md }}>
            <ProgressBar value={progress} />
          </View>
          {/* Heartbeat row — the "something is about to happen" hook */}
          <View style={s.heartbeatRow} testID="workspace-heartbeat">
            <Text style={s.heartbeatText}>
              {lastUpdateTs ? `Last update ${ago(lastUpdateTs, now)}` : 'Syncing…'}
            </Text>
            <Text style={s.heartbeatText}>
              {lastUpdateTs
                ? `Next update in ~${Math.max(0, Math.ceil((POLL_MS - (now - lastUpdateTs)) / 1000))}s`
                : ''}
            </Text>
          </View>
        </Card>
      </FadeSlideIn>

      {/* 3. NEXT ACTION */}
      {inReview > 0 && (
        <FadeSlideIn delay={motion.staggerStep * 2}>
          <View style={s.nextCard} testID="workspace-next-action">
            <Text style={s.nextLabel}>⚠ REVIEW REQUIRED</Text>
            <Text style={s.nextBody}>
              {inReview === 1
                ? `Review ${data.modules.find((m) => m.status === 'review')?.module_title || 'module'}`
                : `${inReview} modules waiting for your approval`}
            </Text>
            <Text style={s.nextSub}>Tap a module below to open it.</Text>
          </View>
        </FadeSlideIn>
      )}

      {/* 3b. ALERT CARD */}
      {needsAttention && (
        <FadeSlideIn delay={motion.staggerStep * 2.5}>
          <View style={s.alertCard} testID="workspace-alert-card">
            <View style={s.alertHeader}>
              <Ionicons name="alert-circle" size={18} color={T.danger} />
              <Text style={s.alertTitle}>Action required</Text>
            </View>
            <Text style={s.alertBody}>
              {data.summary.paused_by_system_count > 0
                ? `${data.summary.paused_by_system_count} module(s) paused by the system.`
                : data.summary.over_budget_count > 0
                ? `${data.summary.over_budget_count} module(s) went over budget.`
                : data.explanation}
            </Text>
          </View>
        </FadeSlideIn>
      )}

      {/* 4. INLINE LIVE ACTIVITY — the "this thing is breathing" section */}
      <View
        onLayout={(e) => {
          // Phase 6: measured position so pushActivity() can glide the
          // ScrollView here. No magic numbers.
          activityYRef.current = e.nativeEvent.layout.y;
        }}
      >
        <LiveActivityFeed items={activity} now={now} />
      </View>

      {/* 5. MODULES */}
      <SectionLabel style={{ marginTop: T.lg, marginBottom: T.sm }}>Modules</SectionLabel>
      <View style={{ gap: T.sm }}>
        {data.modules.map((m, i) => {
          const dotStatus = m.paused_by_system ? 'blocked' : MODULE_DOT[m.status] || 'pending';
          const label = m.paused_by_system ? 'Paused by system' : MODULE_LABEL[m.status] || m.status;
          const isModuleLive = dotStatus === 'active';
          const isHighlighted = i === firstActiveIndex && firstActiveIndex >= 0;
          const isDimmed = firstActiveIndex >= 0 && i !== firstActiveIndex && m.status !== 'review';
          return (
            <ModuleRow
              key={m.module_id}
              module={m}
              index={i}
              dotStatus={dotStatus}
              label={label}
              isModuleLive={isModuleLive}
              isHighlighted={isHighlighted}
              isDimmed={isDimmed}
              isPending={!!pendingAction[m.module_id]}
              approveBump={approveGlowBump[m.module_id] || 0}
              onApprove={() => transitionModule(m, 'done', 'approved')}
              onRequestChanges={() => transitionModule(m, 'in_progress', 'sent back for changes')}
            />
          );
        })}
      </View>
    </ScrollView>
  );
}

/* -------------------- Inline activity feed -------------------- */
function LiveActivityFeed({ items, now }: { items: ActivityEvt[]; now: number }) {
  if (items.length === 0) return null;
  return (
    <View style={s.activityWrap} testID="workspace-activity-feed">
      <View style={s.activityHeaderRow}>
        <PulseDot size={6} />
        <Text style={s.activityTitle}>Live activity</Text>
      </View>
      {items.map((evt) => (
        <ActivityRow key={evt.id} evt={evt} now={now} />
      ))}
    </View>
  );
}

function ActivityRow({ evt, now }: { evt: ActivityEvt; now: number }) {
  // Fade/slide in when a new row is prepended.
  const opacity = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(-6)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: motion.normal, useNativeDriver: true }),
      Animated.timing(translateX, { toValue: 0, duration: motion.normal, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateX]);
  return (
    <Animated.View style={[s.activityRow, { opacity, transform: [{ translateX }] }]}>
      <View style={{ paddingTop: 4 }}>
        <StatusDot status={evt.status} pulse={evt.status === 'active'} size={6} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.activityText, evt.kind === 'filler' && s.activityFiller]} numberOfLines={2}>
          {evt.title}
        </Text>
      </View>
      <Text style={s.activityAgo}>{ago(evt.ts, now)}</Text>
    </Animated.View>
  );
}

/* -------------------- Module row with transition flash + actions -------------------- */
function ModuleRow({
  module: m, index, dotStatus, label, isModuleLive, isHighlighted, isDimmed,
  isPending, approveBump, onApprove, onRequestChanges,
}: {
  module: Module;
  index: number;
  dotStatus: 'active' | 'review' | 'done' | 'pending' | 'blocked';
  label: string;
  isModuleLive: boolean;
  isHighlighted: boolean;
  isDimmed: boolean;
  isPending: boolean;
  approveBump: number;
  onApprove: () => void;
  onRequestChanges: () => void;
}) {
  const lastStatus = useRef(m.status);
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (lastStatus.current !== m.status) {
      lastStatus.current = m.status;
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 180, useNativeDriver: false }),
        Animated.timing(glow, { toValue: 0, duration: 620, useNativeDriver: false }),
      ]).start();
    }
  }, [m.status, glow]);
  // Phase 6: the Approve click fires this glow *before* the server confirms,
  // so the dopamine loop is instant (click → flash → $delta → toast).
  const firstBumpRef = useRef(approveBump);
  useEffect(() => {
    if (approveBump === firstBumpRef.current) return;
    firstBumpRef.current = approveBump;
    Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 120, useNativeDriver: false }),
      Animated.timing(glow, { toValue: 0, duration: 600, useNativeDriver: false }),
    ]).start();
  }, [approveBump, glow]);
  const borderColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [isHighlighted ? T.primary : T.border, T.primary],
  });
  const inReview = m.status === 'review' && !m.paused_by_system;
  return (
    <FadeSlideIn delay={(motion.staggerStep * 3) + index * motion.staggerStep}>
      <Animated.View
        testID={`module-card-${m.module_id}`}
        style={[
          {
            backgroundColor: T.surface1,
            borderRadius: T.radius,
            padding: T.lg,
            borderWidth: isHighlighted ? 2 : 1,
            borderColor,
          },
          isDimmed && { opacity: 0.7 },
        ]}
      >
        <View style={s.moduleHeader}>
          <StatusDot status={dotStatus} pulse={isModuleLive} />
          <Text style={s.moduleTitle} numberOfLines={1}>
            {m.module_title}
          </Text>
          <Text style={s.modulePrice}>${m.price.toLocaleString()}</Text>
        </View>
        <Text style={s.moduleMeta}>
          {label}
          {m.developer_name ? ` · ${m.developer_name}` : ''}
        </Text>
        {m.progress_pct > 0 && m.status !== 'done' && (
          <View style={{ marginTop: T.sm }}>
            <ProgressBar value={m.progress_pct / 100} height={3} />
          </View>
        )}

        {/* RETENTION: inline Approve / Request changes on review modules.
            Transforms passive viewing into active decision-making. */}
        {inReview && (
          <View style={s.actionsRow}>
            <PressScale
              style={[s.approveBtn, isPending && { opacity: 0.55 }]}
              onPress={onApprove}
              disabled={isPending}
              testID={`module-approve-${m.module_id}`}
            >
              <Ionicons name="checkmark" size={14} color={T.bg} />
              <Text style={s.approveText}>{isPending ? 'Updating…' : 'Approve'}</Text>
            </PressScale>
            <PressScale
              style={[s.rejectBtn, isPending && { opacity: 0.55 }]}
              onPress={onRequestChanges}
              disabled={isPending}
              testID={`module-request-changes-${m.module_id}`}
            >
              <Ionicons name="refresh" size={14} color={T.text} />
              <Text style={s.rejectText}>Request changes</Text>
            </PressScale>
          </View>
        )}
      </Animated.View>
    </FadeSlideIn>
  );
}

/* -------------------- styles -------------------- */
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.lg, paddingTop: T.xl, paddingBottom: T.xl * 2 },
  center: { flex: 1, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center', padding: T.lg },

  errText: { color: T.textMuted, fontSize: 15, textAlign: 'center', marginBottom: T.md },
  retryBtn: { borderWidth: 1, borderColor: T.primary, borderRadius: T.radiusSm, paddingHorizontal: T.lg, paddingVertical: T.sm },
  retryText: { color: T.primary, fontWeight: '700' },

  hero: { marginBottom: T.lg },
  ownerEyebrow: {
    color: T.primary,
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '800',
    marginBottom: 4,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: T.sm },
  projectTitle: { color: T.text, fontSize: 22, fontWeight: '600', lineHeight: 28, flex: 1 },
  projectMeta: { color: T.textSecondary, fontSize: 13, marginTop: T.xs },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: T.primaryBg,
    borderWidth: 1, borderColor: T.primaryBorder,
  },
  liveBadgeText: { color: T.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },

  /* Phase 4 — money-in-workspace */
  moneyBlock: {
    marginTop: T.md,
    paddingTop: T.md,
    borderTopWidth: 1,
    borderTopColor: T.border,
  },
  moneyTopRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  moneyDelivered: {
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  moneyDeliveredLabel: {
    color: T.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    paddingBottom: 4,
  },
  moneyRemaining: { color: T.textSecondary, fontSize: 13, marginTop: 4 },
  moneyCaption: {
    color: T.textMuted,
    fontSize: 12,
    marginTop: 6,
    fontStyle: 'italic',
  },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: T.sm },
  statusText: { color: T.text, fontSize: 15, fontWeight: '500' },
  countLine: { color: T.textSecondary, fontSize: 13, marginTop: T.sm },
  heartbeatRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: T.md, paddingTop: T.sm,
    borderTopWidth: 1, borderTopColor: T.border,
  },
  heartbeatText: { color: T.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },

  actionsRow: {
    flexDirection: 'row', gap: T.sm, marginTop: T.md,
  },
  approveBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: T.radiusSm,
    backgroundColor: T.primary,
  },
  approveText: { color: T.bg, fontSize: 13, fontWeight: '800' },
  rejectBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: T.radiusSm,
    borderWidth: 1, borderColor: T.border, backgroundColor: T.surface1,
  },
  rejectText: { color: T.text, fontSize: 13, fontWeight: '700' },

  alertCard: {
    backgroundColor: 'rgba(255,107,107,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,107,107,0.35)',
    borderRadius: T.radius, padding: T.md, marginBottom: T.md,
  },
  nextCard: {
    backgroundColor: 'rgba(245,196,81,0.05)',
    borderWidth: 1, borderColor: 'rgba(245,196,81,0.35)',
    borderRadius: T.radius, padding: T.md, marginBottom: T.md,
  },
  nextLabel: { color: T.risk, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  nextBody: { color: T.text, fontSize: 16, fontWeight: '600', marginTop: 4 },
  nextSub: { color: T.textSecondary, fontSize: 13, marginTop: 2 },
  alertHeader: { flexDirection: 'row', alignItems: 'center', gap: T.xs, marginBottom: T.xs },
  alertTitle: { color: T.danger, fontSize: 14, fontWeight: '700' },
  alertBody: { color: T.text, fontSize: 13, lineHeight: 19 },

  /* Live activity feed */
  activityWrap: {
    marginTop: T.md,
    paddingVertical: T.md,
    paddingHorizontal: T.md,
    backgroundColor: T.surface1,
    borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
  },
  activityHeaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: T.sm, marginBottom: T.sm,
  },
  activityTitle: {
    color: T.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.6,
  },
  activityRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: T.sm,
    paddingVertical: 6,
  },
  activityText: { color: T.text, fontSize: 13, flex: 1, lineHeight: 18 },
  activityFiller: { color: T.textSecondary, fontStyle: 'italic' },
  activityAgo: { color: T.textMuted, fontSize: 11, marginLeft: T.sm, paddingTop: 2 },

  moduleHeader: { flexDirection: 'row', alignItems: 'center', gap: T.sm },
  moduleTitle: { color: T.text, fontSize: 15, fontWeight: '600', flex: 1 },
  modulePrice: { color: T.text, fontSize: 15, fontWeight: '600' },
  moduleMeta: { color: T.textSecondary, fontSize: 13, marginTop: T.xs, textTransform: 'capitalize' },
});
