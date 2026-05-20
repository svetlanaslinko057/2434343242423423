import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import T from '../src/theme';

// Local seeded voice messages for testing — served by FastAPI on /api/chat/uploads.
const SAMPLE = '/api/chat/uploads/user_15be41a662e8/demo15s.wav';
const SAMPLE_BIG = '/api/chat/uploads/user_15be41a662e8/demo15s.wav';

let _lastVoiceSpeed = 1;
const SPEED_CYCLE: number[] = [1, 1.5, 2];

function VoicePlayer({
  uri, duration, testID, tintColor, onColor, offColor, isUser,
}: {
  uri: string;
  duration: number;
  testID?: string;
  tintColor: string;
  onColor: string;
  offColor: string;
  isUser?: boolean;
}) {
  const player = useAudioPlayer(uri, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const isPlaying = Boolean(status?.playing);
  const [scrubProgress, setScrubProgress] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number>(_lastVoiceSpeed);
  const barsRowWidthRef = useRef(0);

  const applySpeed = useCallback((rate: number) => {
    const p: any = player;
    if (!p) return false;
    let applied = false;
    try {
      if (typeof p.setPlaybackRate === 'function') {
        p.setPlaybackRate(rate, 'high');
        applied = true;
      }
    } catch { /* ignore */ }
    try { p.playbackRate = rate; applied = true; } catch { /* ignore */ }
    try {
      const el = p.media || p._audioElement || p.element || p._element;
      if (el && typeof el.playbackRate !== 'undefined') {
        el.playbackRate = rate;
        el.defaultPlaybackRate = rate;
        if ('preservesPitch' in el) (el as any).preservesPitch = true;
        applied = true;
      }
    } catch { /* ignore */ }
    return applied;
  }, [player]);

  useEffect(() => { applySpeed(speed); }, [speed, applySpeed]);
  useEffect(() => { if (isPlaying) applySpeed(speed); }, [isPlaying, applySpeed, speed]);

  const cur = Number(status?.currentTime || 0);
  const playerDur = Number(status?.duration || 0);
  const total = (Number.isFinite(playerDur) && playerDur > 0) ? playerDur : (duration > 0 ? duration : 0);
  const livedProgress = total > 0 ? Math.min(1, Math.max(0, cur / total)) : 0;
  const progress = scrubProgress != null ? scrubProgress : livedProgress;

  const fmt = (sec: number) => {
    const s = Math.max(0, Math.round(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  };

  const toggle = () => {
    try {
      if (isPlaying) {
        (player as any).pause?.();
      } else {
        if (total > 0 && cur >= total - 0.05) {
          (player as any).seekTo?.(0);
        }
        (player as any).play?.();
        applySpeed(speed);
      }
    } catch { /* ignore */ }
  };

  const cycleSpeed = () => {
    const idx = SPEED_CYCLE.indexOf(speed);
    const next = SPEED_CYCLE[(idx + 1) % SPEED_CYCLE.length];
    _lastVoiceSpeed = next;
    setSpeed(next);
  };

  const seekToProgress = (p: number) => {
    if (total <= 0) return;
    const target = Math.max(0, Math.min(total, total * p));
    try {
      (player as any).seekTo?.(target);
      applySpeed(speed);
    } catch { /* ignore */ }
  };

  const seekPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      const w = barsRowWidthRef.current;
      if (w <= 0) return;
      const x = (e.nativeEvent as any).locationX ?? 0;
      const p = Math.max(0, Math.min(1, x / w));
      setScrubProgress(p);
    },
    onPanResponderMove: (e) => {
      const w = barsRowWidthRef.current;
      if (w <= 0) return;
      const x = (e.nativeEvent as any).locationX ?? 0;
      const p = Math.max(0, Math.min(1, x / w));
      setScrubProgress(p);
    },
    onPanResponderRelease: () => {
      if (scrubProgress != null) seekToProgress(scrubProgress);
      setScrubProgress(null);
    },
    onPanResponderTerminate: () => setScrubProgress(null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [total, scrubProgress]);

  const bars = useMemo(() => {
    const seed = (uri || '').split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 7);
    const out: number[] = [];
    let s = seed || 1;
    for (let i = 0; i < 28; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      out.push(0.25 + ((s >>> 8) % 100) / 140);
    }
    return out;
  }, [uri]);

  const speedLabel = speed === 1 ? '1×' : speed === 1.5 ? '1.5×' : '2×';
  const displayTime = scrubProgress != null ? total * scrubProgress : (isPlaying || cur > 0 ? cur : total);

  return (
    <View style={vp.row} testID={testID}>
      <TouchableOpacity
        onPress={toggle}
        style={[vp.btn, { backgroundColor: tintColor }]}
        testID={`${testID}-toggle`}
        hitSlop={6}
      >
        <Ionicons name={isPlaying ? 'pause' : 'play'} size={18} color={T.bg} />
      </TouchableOpacity>
      <View style={vp.barsWrap}>
        <View
          style={vp.barsRow}
          {...seekPanResponder.panHandlers}
          onLayout={(e) => { barsRowWidthRef.current = e.nativeEvent.layout.width; }}
          testID={`${testID}-scrub`}
        >
          {bars.map((h, i) => {
            const filled = (i + 0.5) / bars.length <= progress;
            return (
              <View
                key={i}
                pointerEvents="none"
                style={[
                  vp.bar,
                  {
                    height: 5 + h * 18,
                    backgroundColor: filled ? onColor : offColor,
                    opacity: filled ? 1 : (isUser ? 0.4 : 0.5),
                  },
                ]}
              />
            );
          })}
        </View>
        <View style={vp.metaRow}>
          <Text style={[vp.time, { color: offColor }]}>{fmt(displayTime)}</Text>
          <Text style={[vp.time, { color: offColor, opacity: 0.6 }]}>{' / '}{fmt(total)}</Text>
        </View>
      </View>
      <TouchableOpacity
        testID={`${testID}-speed`}
        onPress={cycleSpeed}
        hitSlop={8}
        activeOpacity={0.7}
        style={[
          vp.speedBtn,
          speed === 1
            ? { backgroundColor: 'transparent', borderColor: offColor }
            : { backgroundColor: tintColor, borderColor: tintColor },
        ]}
      >
        <Text numberOfLines={1} style={[vp.speedText, { color: speed === 1 ? onColor : T.bg }]}>
          {speedLabel}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const vp = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, minWidth: 220, flex: 1 },
  btn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  barsWrap: { flex: 1, minWidth: 0, gap: 4, justifyContent: 'center' },
  barsRow: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 26 },
  bar: { width: 3, borderRadius: 1.5 },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
  time: { fontSize: 11, fontWeight: '600' },
  speedBtn: { minWidth: 44, height: 26, borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0, alignSelf: 'center' },
  speedText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3, includeFontPadding: false, textAlign: 'center', lineHeight: 13 },
});

export default function VoiceDemo() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.bg }} contentContainerStyle={{ padding: 16, gap: 20 }}>
      <Text style={{ color: T.text, fontSize: 22, fontWeight: '800', marginTop: 24 }}>
        Voice Player — Demo
      </Text>
      <Text style={{ color: T.textMuted, fontSize: 13 }} testID="voice-demo-intro">
        Проверка прогресса, скорости (1× → 1.5× → 2×) и UI. Прогресс должен бежать во время воспроизведения.
      </Text>

      <Text style={{ color: T.textMuted, fontSize: 11, letterSpacing: 1.5, fontWeight: '800', marginTop: 12 }}>
        ВХОДЯЩЕЕ (system bubble)
      </Text>
      <View style={s.bubble} testID="voice-bubble-other">
        <Text style={s.kind}>VOICE</Text>
        <VoicePlayer
          uri={SAMPLE_BIG}
          duration={60}
          testID="voice-demo-other"
          tintColor={T.primary}
          onColor={T.text}
          offColor={T.textMuted}
          isUser={false}
        />
      </View>

      <Text style={{ color: T.textMuted, fontSize: 11, letterSpacing: 1.5, fontWeight: '800', marginTop: 12 }}>
        ИСХОДЯЩЕЕ (user bubble)
      </Text>
      <View style={[s.bubble, s.userBubble]} testID="voice-bubble-user">
        <VoicePlayer
          uri={SAMPLE_BIG}
          duration={60}
          testID="voice-demo-user"
          tintColor={T.primaryInk}
          onColor={T.primaryInk}
          offColor={T.primaryInk}
          isUser={true}
        />
      </View>

      <Text style={{ color: T.textMuted, fontSize: 11, letterSpacing: 1.5, fontWeight: '800', marginTop: 12 }}>
        КОРОТКОЕ
      </Text>
      <View style={s.bubble} testID="voice-bubble-short">
        <VoicePlayer
          uri={SAMPLE}
          duration={1}
          testID="voice-demo-short"
          tintColor={T.primary}
          onColor={T.text}
          offColor={T.textMuted}
          isUser={false}
        />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  bubble: {
    backgroundColor: T.surface2,
    borderColor: T.border,
    borderWidth: 1,
    borderRadius: T.radius,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxWidth: '88%',
  },
  userBubble: {
    backgroundColor: T.primary,
    borderColor: T.primary,
    alignSelf: 'flex-end',
    maxWidth: '78%',
  },
  kind: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginBottom: 4, color: T.textMuted },
});
