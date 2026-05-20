import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, Easing, ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../src/api';
import { resolveUserEntry } from '../src/resolve-entry';
import { FadeSlideIn, PulseDot, StatusDot } from '../src/ui';
import { motion } from '../src/motion';
import T from '../src/theme';

/**
 * Project Booting — the "they've already started building my product" moment.
 *
 * Not a loader. A performance.
 *
 * Timeline (≈3.0s total, parallel with workspace fetch):
 *   0–400ms    Header fade                           "● Creating your product"
 *   400–1200ms Step 1 tick                           ✓ Understanding your idea
 *   1200–2000ms Step 2 tick + modules stagger        ✓ Splitting into N modules
 *   2000–2800ms Step 3 pulse + live activity feed    ● Starting execution
 *   ~2900ms     Final ✓ "Execution started"          ✓ Execution started
 *   3000ms      router.replace → workspace
 *
 * Psychology:
 *   • "The system has already started working." — present tense, active voice.
 *   • Check-marks appear BEFORE the underlying fetch resolves → it feels
 *     like Eva-X is faster than your patience.
 *   • Live activity rows flip "queued → in progress" → movement, not waiting.
 *   • Final checkmark before redirect → "it's done" > "wait for it".
 */

type ModuleLite = { module_id?: string; title: string; status?: string };

const STEP_TIMINGS = { s1: 500, s2: 1300, s3: 2100, done: 2900, redirect: 3000 };

export default function ProjectBooting() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [modules, setModules] = useState<ModuleLite[]>([]);
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(0);  // 0=none, 1=s1, 2=s2, 3=s3, 4=done
  const [liveStatus, setLiveStatus] = useState<Record<string, 'queued' | 'started'>>({});

  // Fetch workspace in parallel — the user doesn't wait on it.
  useEffect(() => {
    let mounted = true;
    if (!id) return;
    (async () => {
      try {
        const r = await api.get(`/client/project/${id}/workspace`);
        if (!mounted) return;
        const m: ModuleLite[] = Array.isArray(r.data?.modules) ? r.data.modules : [];
        setModules(m.slice(0, 5));
      } catch {
        // Silent — booting screen must not depend on this.
      }
    })();
    return () => { mounted = false; };
  }, [id]);

  // Orchestrate the step timeline.
  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), STEP_TIMINGS.s1);
    const t2 = setTimeout(() => setStep(2), STEP_TIMINGS.s2);
    const t3 = setTimeout(() => setStep(3), STEP_TIMINGS.s3);
    const tDone = setTimeout(() => setStep(4), STEP_TIMINGS.done);
    const tGo = setTimeout(() => {
      if (id) {
        router.replace(`/workspace/${id}` as any);
      } else {
        // Fallback без id — уводим в родной кабинет юзера через единую
        // точку решения. /home здесь больше не используется.
        api.get('/me')
          .then((r) => router.replace(resolveUserEntry(r.data) as any))
          .catch(() => router.replace('/gateway' as any));
      }
    }, STEP_TIMINGS.redirect);
    return () => [t1, t2, t3, tDone, tGo].forEach(clearTimeout);
  }, [id, router]);

  // Live activity rows — flip one "queued" → "started" every 300ms during step 3.
  useEffect(() => {
    if (step < 3 || modules.length === 0) return;
    // seed all queued
    setLiveStatus(
      Object.fromEntries(modules.map((m) => [m.module_id || m.title, 'queued'])),
    );
    // flip first → started after 200ms, second → started after 500ms
    const t1 = setTimeout(() => {
      const k = modules[0]?.module_id || modules[0]?.title;
      if (k) setLiveStatus((prev) => ({ ...prev, [k]: 'started' }));
    }, 200);
    const t2 = setTimeout(() => {
      const k = modules[1]?.module_id || modules[1]?.title;
      if (k) setLiveStatus((prev) => ({ ...prev, [k]: 'started' }));
    }, 550);
    return () => [t1, t2].forEach(clearTimeout);
  }, [step, modules]);

  const moduleCount = modules.length || 4;

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      testID="project-booting-screen"
      scrollEnabled={false}
    >
      {/* Header — active voice */}
      <FadeSlideIn>
        <View style={s.headerRow}>
          <PulseDot size={8} />
          <Text style={s.headerText}>Creating your product</Text>
        </View>
        <Text style={s.subtitle}>The system has already started working.</Text>
      </FadeSlideIn>

      <View style={s.steps}>
        {/* Step 1 — Understanding */}
        <StepRow
          visible={step >= 1}
          state={step >= 1 ? 'done' : 'queued'}
          title="Understanding your idea"
          sub="Analyzing requirements and structure"
        />

        {/* Step 2 — Splitting */}
        <StepRow
          visible={step >= 2}
          state={step >= 2 ? 'done' : 'queued'}
          title={`Splitting into ${moduleCount} modules`}
          sub="Decomposing scope & allocating budget"
        />
        {step >= 2 && modules.length > 0 && (
          <View style={s.modulesList}>
            {modules.map((m, i) => (
              <FadeSlideIn key={m.module_id || m.title} delay={100 + i * 90}>
                <View style={s.moduleRow}>
                  <View style={s.moduleDotWrap}>
                    <Ionicons name="checkmark" size={12} color={T.primary} />
                  </View>
                  <Text style={s.moduleText} numberOfLines={1}>{m.title}</Text>
                </View>
              </FadeSlideIn>
            ))}
          </View>
        )}

        {/* Step 3 — Starting execution */}
        <StepRow
          visible={step >= 3}
          state={step >= 3 ? (step >= 4 ? 'done' : 'active') : 'queued'}
          title="Starting execution"
          sub="Assigning tasks and preparing workflow"
        />

        {/* Live activity */}
        {step >= 3 && modules.length > 0 && (
          <View style={s.liveWrap}>
            <View style={s.liveLabelRow}>
              <View style={s.liveDivider} />
              <Text style={s.liveLabel}>LIVE</Text>
              <View style={s.liveDivider} />
            </View>
            {modules.slice(0, 3).map((m, i) => {
              const key = m.module_id || m.title;
              const st = liveStatus[key] || 'queued';
              return (
                <FadeSlideIn key={key} delay={i * 80}>
                  <View style={s.activityRow}>
                    <StatusDot status={st === 'started' ? 'active' : 'pending'} pulse={st === 'started'} size={6} />
                    <Text style={s.activityText} numberOfLines={1}>
                      {m.title}{' '}
                      <Text style={st === 'started' ? s.statusStarted : s.statusQueued}>
                        {st === 'started' ? 'started' : 'queued'}
                      </Text>
                    </Text>
                  </View>
                </FadeSlideIn>
              );
            })}
          </View>
        )}

        {/* Final done checkmark */}
        {step >= 4 && (
          <FadeSlideIn>
            <View style={s.finalRow} testID="booting-final-done">
              <Ionicons name="checkmark-circle" size={18} color={T.primary} />
              <Text style={s.finalText}>Execution started</Text>
            </View>
          </FadeSlideIn>
        )}
      </View>

      <Text style={s.footer}>You can follow progress in real time.</Text>
    </ScrollView>
  );
}

/* -------------------- Step row --------------------*/
function StepRow({
  visible, state, title, sub,
}: {
  visible: boolean;
  state: 'queued' | 'active' | 'done';
  title: string;
  sub: string;
}) {
  // Check-mark fade-in for done state.
  const checkScale = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state === 'done') {
      Animated.timing(checkScale, {
        toValue: 1,
        duration: motion.normal,
        easing: Easing.out(Easing.back(1.7)),
        useNativeDriver: true,
      }).start();
    }
  }, [state, checkScale]);

  // Phase 6: typewriter — only while the step is `active`. Feels like the
  // system is *thinking* this phrase right now, not pre-canned. On `done`
  // we snap to the full title so it stays readable. On `queued` the title
  // is still visible but muted (no animation).
  const [typed, setTyped] = useState(state === 'active' ? '' : title);
  useEffect(() => {
    if (state !== 'active') {
      setTyped(title);
      return;
    }
    setTyped('');
    let i = 0;
    const iv = setInterval(() => {
      i += 1;
      setTyped(title.slice(0, i));
      if (i >= title.length) clearInterval(iv);
    }, 28);
    return () => clearInterval(iv);
  }, [state, title]);

  if (!visible) return null;
  return (
    <FadeSlideIn>
      <View style={s.stepRow}>
        <View style={s.stepIconWrap}>
          {state === 'done' ? (
            <Animated.View style={{ transform: [{ scale: checkScale }] }}>
              <Ionicons name="checkmark-circle" size={22} color={T.primary} />
            </Animated.View>
          ) : state === 'active' ? (
            <PulseDot size={10} />
          ) : (
            <View style={s.queuedDot} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.stepTitle}>
            {typed}
            {state === 'active' && typed.length < title.length ? (
              <Text style={{ color: T.primary }}>▍</Text>
            ) : null}
          </Text>
          <Text style={s.stepSub}>{sub}</Text>
        </View>
      </View>
    </FadeSlideIn>
  );
}

/* -------------------- styles -------------------- */
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: {
    padding: T.lg,
    paddingTop: T.xl * 2,
    minHeight: '100%',
  },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: T.sm, marginBottom: 6 },
  headerText: { color: T.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  subtitle: { color: T.textMuted, fontSize: T.body, marginBottom: T.xl * 1.2 },

  steps: { gap: T.md },

  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: T.md, paddingVertical: 6 },
  stepIconWrap: { width: 22, alignItems: 'center', paddingTop: 3 },
  stepTitle: { color: T.text, fontSize: T.body, fontWeight: '600' },
  stepSub: { color: T.textMuted, fontSize: T.small, marginTop: 2 },
  queuedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.border, marginTop: 5 },

  modulesList: { marginLeft: 38, marginTop: -6, marginBottom: T.xs, gap: 4 },
  moduleRow: { flexDirection: 'row', alignItems: 'center', gap: T.sm, paddingVertical: 4 },
  moduleDotWrap: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: T.primaryBgStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  moduleText: { color: T.textSecondary, fontSize: 14, flex: 1 },

  liveWrap: { marginTop: T.md, marginLeft: 38 },
  liveLabelRow: {
    flexDirection: 'row', alignItems: 'center', gap: T.sm,
    marginBottom: T.sm,
  },
  liveDivider: { flex: 1, height: 1, backgroundColor: T.border },
  liveLabel: {
    color: T.primary,
    fontSize: 10, fontWeight: '800', letterSpacing: 1.8,
  },
  activityRow: {
    flexDirection: 'row', alignItems: 'center', gap: T.sm,
    paddingVertical: 5,
  },
  activityText: { color: T.text, fontSize: 13, flex: 1 },
  statusStarted: { color: T.primary, fontWeight: '700' },
  statusQueued: { color: T.textMuted, fontWeight: '600' },

  finalRow: {
    flexDirection: 'row', alignItems: 'center', gap: T.sm,
    marginTop: T.md,
    paddingVertical: T.sm,
    paddingHorizontal: T.md,
    borderRadius: 10,
    backgroundColor: T.primaryBg,
    borderWidth: 1, borderColor: T.primaryBorder,
    alignSelf: 'flex-start',
  },
  finalText: { color: T.primary, fontWeight: '700' },

  footer: {
    color: T.textMuted,
    fontSize: T.tiny,
    textAlign: 'center',
    marginTop: T.xl,
  },
});
