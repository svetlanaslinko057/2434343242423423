// Activity tab — Operator Panel (v2: smart copy + action highlight + motion)
//
// Layers (top → bottom):
//   1. PROJECT SELECTOR     — only when client has >1 project
//   2. ACTION HIGHLIGHT     — promoted CTA for the single most-pressing item
//                              (e.g. "Waiting for your approval")
//   3. SNAPSHOT             — animated progress bar, smart headline copy,
//                              counters, phase pill, ETA
//   4. CURRENT WORK         — module rows with pulse on in-progress + "updated Xm ago"
//   5. NEXT                 — queue teaser
//   6. ACTIVITY             — bucketed feed with `impact` sub-line per event
//
// One backend round-trip: GET /api/client/activity/full?project_id=…
// Polls every 15s, paused via AppState when backgrounded.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl,
  TouchableOpacity, Modal, Pressable, Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/api';
import T from '../../src/theme';
import { ScreenTitle, EmptyState } from '../../src/ui-client';
import { FadeSlideIn } from '../../src/ui';
import { useAppStatePolling } from '../../src/hooks/useAppStatePolling';

/* ───────────────────────────── Types (mirror /api/client/activity/full) */

type ProjectRef    = { id: string; title: string; current_stage: string };
type AvailableProj = { id: string; title: string; status: string };
type Progress = {
  total_modules: number; completed: number; in_progress: number;
  review: number; blocked: number; queued: number; percent: number;
};
type Phase     = { current: string; label: string; index: number; total: number };
type Time      = { remaining_hours: number; eta_days: number };
type Highlight = {
  type: 'approval_needed' | 'blocked';
  module_id: string;
  title: string;
  label: string;
  cta: string;
  cause_effect?: string | null;
};
type OperatorStatus = { active: boolean; message: string };
type Current = {
  module_id: string; title: string; status: string; status_label: string;
  eta_hours: number; developer_name: string; action_required: boolean;
  last_activity_at: string | null;
  subtask?: string | null;
};
type NextMod = { module_id: string; title: string; eta_hours: number };
type Event   = {
  at: string; module_title: string; module_id: string | null;
  verb: string; dot: 'green' | 'yellow' | 'blue' | 'purple';
  impact?: string | null; kind?: string;
};
type FullPayload = {
  project: ProjectRef | null;
  available_projects: AvailableProj[];
  headline: string | null;
  headline_subtitle?: string | null;
  operator_status?: OperatorStatus | null;
  action_highlight: Highlight | null;
  progress: Progress;
  phase: Phase | null;
  time: Time;
  current_work: Current[];
  next_modules: NextMod[];
  events: Event[];
};

/* ───────────────────────────── Helpers */

function relTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function bucketFor(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'JUST NOW';
  if (m < 60 * 24) return 'TODAY';
  if (m < 60 * 48) return 'YESTERDAY';
  return 'EARLIER';
}

const DOT_COLOR: Record<Event['dot'], string> = {
  green:  T.success,
  yellow: T.risk,
  blue:   T.info,
  purple: T.info,
};

const STATUS_TINT: Record<string, { bg: string; fg: string; border: string }> = {
  review:      { bg: T.riskTint,    fg: T.risk,    border: T.riskBorder },
  in_progress: { bg: T.infoTint,    fg: T.info,    border: T.infoBorder },
  submitted:   { bg: T.infoTint,    fg: T.info,    border: T.infoBorder },
  blocked:     { bg: T.dangerTint,  fg: T.danger,  border: T.dangerBorder },
  failed:      { bg: T.dangerTint,  fg: T.danger,  border: T.dangerBorder },
  validation:  { bg: T.riskTint,    fg: T.risk,    border: T.riskBorder },
};

/* ───────────────────────────── Screen */

const POLL_MS = 15_000;

export default function ClientActivity() {
  const router = useRouter();
  const [data, setData]               = useState<FullPayload | null>(null);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [pickerOpen, setPickerOpen]   = useState(false);
  const [selectedPid, setSelectedPid] = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [flash, setFlash]             = useState<string | null>(null);
  const [inlineBusy, setInlineBusy]   = useState<'approve' | 'revision' | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const url = selectedPid
        ? `/client/activity/full?project_id=${encodeURIComponent(selectedPid)}`
        : '/client/activity/full';
      const r = await api.get(url);
      setData(r.data as FullPayload);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.status === 401
        ? 'Sign in to see your project activity.'
        : 'Couldn\'t refresh — retrying…');
    } finally {
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedPid]);

  /** Inline approve — fire-and-refresh with an optimistic flash banner.
   *  Preserves the "SEE = ACT" contract: action lives on the same screen. */
  const approveHighlighted = useCallback(async (moduleId: string) => {
    if (!moduleId || inlineBusy) return;
    setInlineBusy('approve');
    try {
      await api.post(`/client/modules/${moduleId}/approve`);
      setFlash('✓ Module approved — moving to the next step');
      await load();
    } catch (e: any) {
      setFlash(e?.response?.data?.detail || 'Could not approve — try again');
    } finally {
      setInlineBusy(null);
      setTimeout(() => setFlash(null), 3200);
    }
  }, [inlineBusy, load]);

  const requestChangesHighlighted = useCallback(async (moduleId: string) => {
    if (!moduleId || inlineBusy) return;
    setInlineBusy('revision');
    try {
      await api.post(`/client/modules/${moduleId}/request-changes`, {});
      setFlash('↺ Changes requested — developer notified');
      await load();
    } catch (e: any) {
      setFlash(e?.response?.data?.detail || 'Could not request changes — try again');
    } finally {
      setInlineBusy(null);
      setTimeout(() => setFlash(null), 3200);
    }
  }, [inlineBusy, load]);

  useEffect(() => { load(); }, [load]);
  // Lifecycle-aware polling: pauses on screen blur and on app background;
  // fires one immediate refresh on resume.
  useAppStatePolling(load, POLL_MS);

  if (loading) {
    return (
      <SafeAreaView style={[s.flex, s.center]} edges={['top']}>
        <ActivityIndicator color={T.primary} />
      </SafeAreaView>
    );
  }

  if (!data?.project) {
    return (
      <SafeAreaView style={s.flex} edges={['top']}>
        <ScrollView contentContainerStyle={s.container}>
          <ScreenTitle title="Activity" subtitle="Your project's operator panel" />
          <EmptyState
            icon="rocket-outline"
            title="No active project yet"
            sub="Start your first project from Home — the operator panel will surface progress, current work and live events here."
            testID="activity-no-project"
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const {
    project, available_projects, headline, headline_subtitle, operator_status,
    action_highlight, progress, phase, time, current_work, next_modules, events,
  } = data;

  const showPicker = (available_projects?.length || 0) > 1;

  // Group events by time bucket (preserve order).
  const groups: { bucket: string; items: Event[] }[] = [];
  for (const e of events) {
    const b = bucketFor(e.at);
    const last = groups[groups.length - 1];
    if (last && last.bucket === b) last.items.push(e);
    else groups.push({ bucket: b, items: [e] });
  }

  return (
    <SafeAreaView style={s.flex} edges={['top']}>
      <ScrollView
        testID="client-activity"
        contentContainerStyle={s.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={T.primary}
          />
        }
      >
        {/* ─── HEADER + PROJECT SELECTOR ─── */}
        <View style={s.headerRow}>
          <Text style={s.h1}>Activity</Text>
          {showPicker ? (
            <TouchableOpacity
              testID="activity-project-picker"
              style={s.projectPill}
              onPress={() => setPickerOpen(true)}
              activeOpacity={0.85}
            >
              <Text style={s.projectPillText} numberOfLines={1}>{project.title}</Text>
              <Ionicons name="chevron-down" size={14} color={T.textSecondary} />
            </TouchableOpacity>
          ) : (
            <Text style={s.projectStatic} numberOfLines={1}>{project.title}</Text>
          )}
        </View>

        {/* Operator voice line — global presence indicator. Sits right under
            the header, before any data, so it sets the tone of the screen. */}
        {operator_status?.message && (
          <View style={s.opRow}>
            <View style={[s.opDot, operator_status.active ? s.opDotActive : null]} />
            <Text style={s.opText}>{operator_status.message}</Text>
          </View>
        )}

        {error ? <Text style={s.errorChip}>{error}</Text> : null}
        {flash ? <Text style={s.flashChip} testID="activity-flash">{flash}</Text> : null}

        {/* ─── 0. ACTION HIGHLIGHT (above the snapshot) ─── */}
        {action_highlight && (
          <FadeSlideIn>
            <ActionHighlightBar
              highlight={action_highlight}
              busy={inlineBusy}
              onApprove={() => approveHighlighted(action_highlight.module_id)}
              onRequestChanges={() => requestChangesHighlighted(action_highlight.module_id)}
              onOpen={() => router.push(`/client/projects/${project.id}` as any)}
            />
          </FadeSlideIn>
        )}

        {/* ─── 1. SNAPSHOT ─── */}
        <FadeSlideIn>
          <SnapshotCard
            title={project.title}
            headline={headline}
            headlineSubtitle={headline_subtitle ?? null}
            progress={progress}
            phase={phase}
            time={time}
            onOpenProject={() => router.push(`/client/projects/${project.id}` as any)}
          />
        </FadeSlideIn>

        {/* ─── 2. CURRENT WORK ─── */}
        <SectionTitle>Currently working</SectionTitle>
        {current_work.length === 0 ? (
          <Text style={s.empty}>
            Nothing active right now. {progress.queued > 0
              ? `${progress.queued} module${progress.queued === 1 ? '' : 's'} queued — picking up next.`
              : 'When the next phase starts, modules will appear here.'}
          </Text>
        ) : (
          current_work.map((m, i) => (
            <FadeSlideIn key={m.module_id} delay={i * 40}>
              <CurrentWorkRow
                item={m}
                onPress={() => router.push(`/client/projects/${project.id}` as any)}
                testID={`current-work-${i}`}
              />
            </FadeSlideIn>
          ))
        )}

        {/* ─── 3. NEXT ─── */}
        {next_modules.length > 0 && (
          <>
            <SectionTitle>Next up <Text style={s.sectionSub}>· after current work</Text></SectionTitle>
            <View style={s.nextGroup}>
              {next_modules.map((n, i) => (
                <View
                  key={n.module_id}
                  style={[s.nextRow, i === next_modules.length - 1 && s.nextRowLast]}
                >
                  <View style={s.nextDot} />
                  <Text style={s.nextTitle} numberOfLines={1}>{n.title}</Text>
                  {n.eta_hours > 0 && <Text style={s.nextEta}>~{n.eta_hours}h</Text>}
                </View>
              ))}
            </View>
          </>
        )}

        {/* ─── 4. EVENTS FEED ─── */}
        <SectionTitle>Activity</SectionTitle>
        {groups.length === 0 ? (
          <Text style={s.empty}>Events from the system and your team will surface here.</Text>
        ) : (
          groups.map((g, gi) => (
            <View key={g.bucket + gi} style={s.evGroup}>
              <View style={s.bucketRow}>
                <Text style={s.bucketLabel}>{g.bucket}</Text>
                <View style={s.bucketLine} />
                <Text style={s.bucketCount}>{g.items.length}</Text>
              </View>
              {g.items.map((e, idx) => {
                const isAction = e.dot === 'yellow' || e.dot === 'red';
                return (
                  <View
                    key={`${e.module_id ?? 'sys'}-${e.at}-${idx}`}
                    style={[
                      s.evRow,
                      idx === g.items.length - 1 && s.evRowLast,
                      isAction && s.evRowAction,    // left bar + tinted bg
                    ]}
                    testID={`activity-event-${gi}-${idx}`}
                  >
                    <View style={[s.evDot, { backgroundColor: DOT_COLOR[e.dot] || T.textMuted }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.evLine} numberOfLines={2}>
                        <Text style={s.evModule}>{e.module_title}</Text>
                        <Text style={s.evVerb}>  {e.verb}</Text>
                      </Text>
                      {e.impact ? <Text style={s.evImpact}>→ {e.impact}</Text> : null}
                      <Text style={s.evMeta}>{relTime(e.at)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>

      {/* ─── PROJECT PICKER MODAL ─── */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={s.modalBackdrop} onPress={() => setPickerOpen(false)}>
          <Pressable style={s.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={s.modalTitle}>Switch project</Text>
            {available_projects.map((p) => {
              const isCurrent = p.id === project.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  testID={`picker-row-${p.id}`}
                  style={[s.modalRow, isCurrent && s.modalRowCurrent]}
                  onPress={() => {
                    setSelectedPid(p.id);
                    setPickerOpen(false);
                    setLoading(true);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.modalProjTitle} numberOfLines={1}>{p.title}</Text>
                    <Text style={s.modalProjStatus}>{p.status}</Text>
                  </View>
                  {isCurrent && <Ionicons name="checkmark" size={18} color={T.primary} />}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

/* ───────────────────────────── Subcomponents */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={s.sectionTitle}>{children}</Text>;
}

/** Promoted "do this next" banner — appears only when something needs the
 *  client. Pulses gently to pull the eye.
 *  - For `approval_needed`: renders TWO inline actions ([Approve] [Request changes])
 *    right on this screen — SEE = ACT, no detour into the project page.
 *  - For `blocked`: a single "Open module" CTA (cannot be resolved inline). */
function ActionHighlightBar({
  highlight, busy, onApprove, onRequestChanges, onOpen,
}: {
  highlight: Highlight;
  busy: 'approve' | 'revision' | null;
  onApprove: () => void;
  onRequestChanges: () => void;
  onOpen: () => void;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });

  const isBlocked = highlight.type === 'blocked';
  const tint = isBlocked
    ? { bg: T.dangerTint, border: T.dangerBorder, fg: T.danger }
    : { bg: T.riskTint,   border: T.riskBorder,   fg: T.risk   };

  const canInlineApprove = highlight.type === 'approval_needed';

  return (
    <View
      testID="activity-action-highlight"
      style={[s.action, { backgroundColor: tint.bg, borderColor: tint.border }]}
    >
      <View style={s.actionTopRow}>
        <Animated.View
          style={[s.actionPulse, { backgroundColor: tint.fg, transform: [{ scale: dotScale }], opacity: dotOpacity }]}
        />
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.85} onPress={onOpen}>
          <Text style={[s.actionLabel, { color: tint.fg }]}>{highlight.label.toUpperCase()}</Text>
          <Text style={s.actionTitle} numberOfLines={1}>{highlight.title}</Text>
          {highlight.cause_effect ? (
            <Text style={s.actionCauseEffect} numberOfLines={2}>→ {highlight.cause_effect}</Text>
          ) : null}
        </TouchableOpacity>
      </View>

      {canInlineApprove ? (
        <View style={s.actionBtnRow}>
          <TouchableOpacity
            testID="activity-action-approve"
            activeOpacity={0.85}
            disabled={!!busy}
            style={[s.actionBtn, s.actionBtnPrimary, busy && s.actionBtnDisabled]}
            onPress={onApprove}
          >
            {busy === 'approve'
              ? <ActivityIndicator size="small" color={T.bg} />
              : (
                <>
                  <Ionicons name="checkmark-circle" size={15} color={T.bg} />
                  <Text style={s.actionBtnPrimaryText}>Approve</Text>
                </>
              )}
          </TouchableOpacity>
          <TouchableOpacity
            testID="activity-action-revision"
            activeOpacity={0.85}
            disabled={!!busy}
            style={[s.actionBtn, s.actionBtnGhost, busy && s.actionBtnDisabled, { borderColor: tint.fg }]}
            onPress={onRequestChanges}
          >
            {busy === 'revision'
              ? <ActivityIndicator size="small" color={tint.fg} />
              : (
                <>
                  <Ionicons name="refresh" size={15} color={tint.fg} />
                  <Text style={[s.actionBtnGhostText, { color: tint.fg }]}>Request changes</Text>
                </>
              )}
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          testID="activity-action-open"
          activeOpacity={0.85}
          onPress={onOpen}
          style={[s.actionCta, { borderColor: tint.border, alignSelf: 'flex-start', marginTop: 10 }]}
        >
          <Text style={[s.actionCtaText, { color: tint.fg }]}>{highlight.cta}</Text>
          <Ionicons name="chevron-forward" size={12} color={tint.fg} />
        </TouchableOpacity>
      )}
    </View>
  );
}

function SnapshotCard({
  title, headline, headlineSubtitle, progress, phase, time, onOpenProject,
}: {
  title: string;
  headline: string | null;
  headlineSubtitle: string | null;
  progress: Progress;
  phase: Phase | null;
  time: Time;
  onOpenProject: () => void;
}) {
  // Animated progress bar — glides into place over 600ms instead of jumping.
  const widthAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: progress.percent,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,  // width animation requires layout driver
    }).start();
  }, [progress.percent, widthAnim]);

  return (
    <TouchableOpacity
      testID="activity-snapshot"
      activeOpacity={0.92}
      onPress={onOpenProject}
      style={s.snap}
    >
      <View style={s.snapHeaderRow}>
        <Text style={s.snapTitle} numberOfLines={1}>{title}</Text>
        <Ionicons name="open-outline" size={16} color={T.textMuted} />
      </View>

      <View style={s.snapProgressRow}>
        <Text style={s.snapPercent}>{progress.percent}%</Text>
        <Text style={s.snapMeta}>
          {progress.completed} <Text style={s.snapMetaDim}>of {progress.total_modules} modules</Text>
        </Text>
      </View>

      <View style={s.bar} accessibilityRole="progressbar">
        <Animated.View
          style={[
            s.barFill,
            { width: widthAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) },
          ]}
        />
      </View>

      {headline ? <Text style={s.snapHeadline}>{headline}</Text> : null}
      {headlineSubtitle ? (
        <Text style={s.snapSubtitle}>→ {headlineSubtitle}</Text>
      ) : null}

      <View style={s.snapCounters}>
        <Counter color={T.info}    n={progress.in_progress} label="in progress" />
        <View style={s.counterDivider} />
        <Counter color={T.risk}    n={progress.review}      label="in review"   />
        <View style={s.counterDivider} />
        <Counter color={T.danger}  n={progress.blocked}     label="blocked"     />
      </View>

      <View style={s.snapFooter}>
        {phase && (
          <View style={s.phasePill}>
            <Text style={s.phasePillText}>
              {phase.label} <Text style={s.phasePillDim}>· {phase.index}/{phase.total}</Text>
            </Text>
          </View>
        )}
        {time.remaining_hours > 0 && (
          <Text style={s.eta}>
            ~{time.remaining_hours}h remaining{time.eta_days ? ` · ${time.eta_days}d` : ''}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

function Counter({ color, n, label }: { color: string; n: number; label: string }) {
  return (
    <View style={s.counter}>
      <View style={[s.counterDot, { backgroundColor: color }]} />
      <Text style={s.counterN}>{n}</Text>
      <Text style={s.counterLabel}>{label}</Text>
    </View>
  );
}

function CurrentWorkRow({
  item, onPress, testID,
}: { item: Current; onPress: () => void; testID?: string }) {
  const tint = STATUS_TINT[item.status] || { bg: T.surface2, fg: T.textSecondary, border: T.border };
  const isLive = item.status === 'in_progress' || item.status === 'submitted';

  // Subtle pulse on the live dot only. Pure RN Animated to avoid Reanimated dep.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isLive) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isLive, pulse]);

  const liveOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  return (
    <TouchableOpacity
      testID={testID}
      activeOpacity={0.85}
      onPress={onPress}
      style={[s.cwRow, item.action_required && s.cwRowAction]}
    >
      {isLive && (
        <Animated.View style={[s.liveBadge, { opacity: liveOpacity }]}>
          <View style={s.liveDot} />
        </Animated.View>
      )}
      <View style={{ flex: 1 }}>
        <View style={s.cwTitleRow}>
          <Text style={s.cwTitle} numberOfLines={1}>{item.title}</Text>
          {item.action_required && (
            <View style={s.actionDot}><Text style={s.actionDotText}>!</Text></View>
          )}
        </View>
        <Text style={s.cwMeta}>
          {item.status_label}
          {item.developer_name ? <Text style={s.cwMetaDim}> · {item.developer_name}</Text> : null}
        </Text>
        {item.subtask ? (
          <Text style={s.cwSubtask}>→ {item.subtask}</Text>
        ) : null}
        {item.last_activity_at && (
          <Text style={s.cwSignal}>updated {relTime(item.last_activity_at)}</Text>
        )}
      </View>
      <View style={[s.cwPill, { backgroundColor: tint.bg, borderColor: tint.border }]}>
        <Text style={[s.cwPillText, { color: tint.fg }]}>
          {item.status === 'review'      ? 'REVIEW'  :
           item.status === 'in_progress' ? 'WORKING' :
           item.status === 'blocked'     ? 'BLOCKED' :
           item.status === 'failed'      ? 'FAILED'  :
                                            item.status.toUpperCase()}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/* ───────────────────────────── Styles */

const s = StyleSheet.create({
  flex:      { flex: 1, backgroundColor: T.bg },
  center:    { justifyContent: 'center', alignItems: 'center' },
  container: { padding: T.md, paddingBottom: 100 },

  /* Header */
  headerRow:    { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: T.lg, gap: 12 },
  h1:           { color: T.text, fontSize: T.h1, fontWeight: '800', letterSpacing: -0.5 },
  projectPill:  {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: T.surface2,
    borderRadius: T.radiusSm,
    borderWidth: 1, borderColor: T.border,
    maxWidth: 200,
  },
  projectPillText: { color: T.textSecondary, fontSize: 12, fontWeight: '600' },
  projectStatic:   { color: T.textMuted, fontSize: 12, fontWeight: '500', maxWidth: 200 },

  errorChip: {
    color: T.risk, fontSize: 12, fontWeight: '500',
    backgroundColor: T.riskTint, borderRadius: T.radiusSm,
    paddingVertical: 6, paddingHorizontal: 10,
    marginBottom: T.sm,
    alignSelf: 'flex-start',
  },

  /* Operator voice row — sits under header, sets the tone. */
  opRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: T.md, paddingHorizontal: 2 },
  opDot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: T.textMuted },
  opDotActive:  { backgroundColor: T.success },
  opText:       { color: T.textSecondary, fontSize: 12, fontWeight: '500', flex: 1 },

  sectionTitle: {
    color: T.textMuted, fontSize: 11, fontWeight: '900',
    letterSpacing: 1.6, textTransform: 'uppercase',
    marginTop: T.lg, marginBottom: T.sm,
  },
  sectionSub: { color: T.textMuted, fontWeight: '500', letterSpacing: 0.4, textTransform: 'none', fontSize: 10 },
  empty:      { color: T.textMuted, fontSize: 13, lineHeight: 18, paddingVertical: T.sm },

  /* Action Highlight */
  action: {
    padding: T.md,
    borderRadius: T.radius,
    borderWidth: 1,
    marginBottom: T.md,
  },
  actionTopRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  actionPulse: { width: 10, height: 10, borderRadius: 5 },
  actionLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  actionTitle: { color: T.text, fontSize: 14, fontWeight: '700', marginTop: 2 },
  actionCta: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1,
  },
  actionCtaText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  actionCauseEffect: {
    color: T.textSecondary, fontSize: 12, fontWeight: '500',
    marginTop: 4, fontStyle: 'italic',
  },
  /* Inline action row — SEE = ACT */
  actionBtnRow: {
    flexDirection: 'row', gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    minHeight: 44,
  },
  actionBtnPrimary:      { backgroundColor: T.primary },
  actionBtnPrimaryText:  { color: T.bg, fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  actionBtnGhost:        { backgroundColor: 'transparent', borderWidth: 1 },
  actionBtnGhostText:    { fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  actionBtnDisabled:     { opacity: 0.55 },
  /* Flash / toast chip */
  flashChip: {
    alignSelf: 'stretch',
    color: T.text, backgroundColor: T.successBgStrong,
    borderColor: T.successBorderStrong, borderWidth: 1,
    paddingHorizontal: T.md, paddingVertical: 8,
    borderRadius: 10,
    fontSize: 12, fontWeight: '700',
    marginBottom: T.sm,
    textAlign: 'center',
  },

  /* Snapshot card */
  snap: {
    backgroundColor: T.surface1,
    borderRadius: T.radius,
    padding: T.md,
    borderWidth: 1, borderColor: T.border,
    gap: 10,
  },
  snapHeaderRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  snapTitle:      { color: T.text, fontSize: 16, fontWeight: '700', flex: 1, letterSpacing: -0.2 },
  snapProgressRow:{ flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  snapPercent:    { color: T.primary, fontSize: 32, fontWeight: '800', letterSpacing: -1 },
  snapMeta:       { color: T.text, fontSize: 13, fontWeight: '600' },
  snapMetaDim:    { color: T.textMuted, fontWeight: '500' },
  snapHeadline:   { color: T.textSecondary, fontSize: 13, fontWeight: '500', fontStyle: 'italic', marginTop: -4 },
  snapSubtitle:   { color: T.primary, fontSize: 12, fontWeight: '600', marginTop: -4 },

  bar:     { height: 6, backgroundColor: T.surface3, borderRadius: 6, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: T.primary, borderRadius: 6 },

  snapCounters:    { flexDirection: 'row', alignItems: 'center', marginTop: 6, paddingVertical: 8 },
  counter:         { flex: 1, alignItems: 'center', gap: 2 },
  counterDot:      { width: 6, height: 6, borderRadius: 3, marginBottom: 4 },
  counterN:        { color: T.text, fontSize: 18, fontWeight: '700' },
  counterLabel:    { color: T.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  counterDivider:  { width: 1, height: 24, backgroundColor: T.border },

  snapFooter:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  phasePill:     { backgroundColor: T.surface2, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: T.border },
  phasePillText: { color: T.text, fontSize: 11, fontWeight: '700' },
  phasePillDim:  { color: T.textMuted, fontWeight: '500' },
  eta:           { color: T.primary, fontSize: 12, fontWeight: '700' },

  /* Current work row */
  cwRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: T.md, paddingHorizontal: T.md,
    backgroundColor: T.surface1,
    borderRadius: T.radiusSm,
    borderWidth: 1, borderColor: T.border,
    marginBottom: 8,
    position: 'relative',
  },
  cwRowAction: { borderColor: T.riskBorder, backgroundColor: T.riskTint },
  cwTitleRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cwTitle:     { color: T.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  cwMeta:      { color: T.textSecondary, fontSize: 12, marginTop: 2 },
  cwMetaDim:   { color: T.textMuted },
  cwSubtask:   { color: T.primary, fontSize: 11, marginTop: 4, fontWeight: '600' },
  cwSignal:    { color: T.textMuted, fontSize: 11, marginTop: 4, fontStyle: 'italic' },
  cwPill:      { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  cwPillText:  { fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  actionDot:   { width: 16, height: 16, borderRadius: 8, backgroundColor: T.risk, alignItems: 'center', justifyContent: 'center' },
  actionDotText: { color: T.bg, fontSize: 10, fontWeight: '900' },

  liveBadge:   { position: 'absolute', top: 8, right: 8, padding: 4 },
  liveDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: T.info },

  /* Next */
  nextGroup: {
    backgroundColor: T.surface1,
    borderRadius: T.radiusSm,
    borderWidth: 1, borderColor: T.border,
    paddingHorizontal: T.md,
  },
  nextRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.border },
  nextRowLast: { borderBottomWidth: 0 },
  nextDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: T.textMuted },
  nextTitle:   { flex: 1, color: T.textSecondary, fontSize: 13, fontWeight: '500' },
  nextEta:     { color: T.textMuted, fontSize: 11, fontWeight: '600' },

  /* Events */
  evGroup:    { marginBottom: T.md },
  bucketRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  bucketLabel:{ color: T.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 1.6 },
  bucketLine: { flex: 1, height: 1, backgroundColor: T.border },
  bucketCount:{ color: T.textMuted, fontSize: 10, fontWeight: '700' },

  evRow:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.border },
  evRowLast:    { borderBottomWidth: 0 },
  evRowAction:  {
    backgroundColor: T.riskTint,
    borderLeftWidth: 3, borderLeftColor: T.risk,
    paddingHorizontal: 10, marginHorizontal: -10,
    borderRadius: T.radiusSm,
    borderBottomWidth: 0, marginBottom: 4,
  },
  evDot:     { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  evLine:    { fontSize: 13, lineHeight: 18 },
  evModule:  { color: T.text, fontWeight: '700' },
  evVerb:    { color: T.textSecondary, fontWeight: '500' },
  evImpact:  { color: T.textSecondary, fontSize: 11, marginTop: 2, fontWeight: '500' },
  evMeta:    { color: T.textMuted, fontSize: 11, marginTop: 2, fontWeight: '500' },

  /* Modal */
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalSheet:    {
    backgroundColor: T.surface1,
    borderTopLeftRadius: T.radiusLg, borderTopRightRadius: T.radiusLg,
    paddingHorizontal: T.md, paddingTop: T.md, paddingBottom: T.xl,
    borderTopWidth: 1, borderColor: T.border,
  },
  modalTitle: { color: T.text, fontSize: 16, fontWeight: '800', marginBottom: T.md },
  modalRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: T.md, paddingHorizontal: T.md,
    backgroundColor: T.surface2,
    borderRadius: T.radiusSm,
    marginBottom: 8,
    borderWidth: 1, borderColor: T.border,
  },
  modalRowCurrent:  { borderColor: T.successBorder, backgroundColor: T.successTint },
  modalProjTitle:   { color: T.text, fontSize: 14, fontWeight: '700' },
  modalProjStatus:  { color: T.textMuted, fontSize: 11, marginTop: 2, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.6 },
});
