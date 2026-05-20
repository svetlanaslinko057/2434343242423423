import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import T from './theme';

type Props = {
  visible: boolean;
  onComplete?: () => void;
  label?: string;
  durationMs?: number;
  developerName?: string;   // shown in success phase
  developerRole?: string;
  nextUpdateHint?: string;  // e.g. "~2 hours"
};

/**
 * Fake payment progress overlay.
 * - Shows "Processing..." with animated bar (1.5-2s)
 * - Then "✓ Development started" for ~0.8s
 * - Calls onComplete when fully done
 *
 * Use pattern:
 *   const [paying, setPaying] = useState(false);
 *   <PaymentProgress visible={paying} onComplete={() => { setPaying(false); executeReal(); }} />
 */
export default function PaymentProgress({ visible, onComplete, label, durationMs = 1800, developerName = 'Alex', developerRole = 'Senior Backend', nextUpdateHint = '~2 hours' }: Props) {
  const [phase, setPhase] = useState<'processing' | 'success'>('processing');
  const [storyIdx, setStoryIdx] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;

  const STORY = [
    'Securing your team…',
    'Assigning developer…',
    'Starting development…',
  ];

  useEffect(() => {
    if (!visible) return;
    setPhase('processing');
    setStoryIdx(0);
    progress.setValue(0);

    // Rotate storytelling lines
    const s1 = setTimeout(() => setStoryIdx(1), durationMs / 3);
    const s2 = setTimeout(() => setStoryIdx(2), (durationMs / 3) * 2);

    Animated.timing(progress, {
      toValue: 1,
      duration: durationMs,
      useNativeDriver: false,
    }).start(() => {
      setPhase('success');
      // success screen stays longer — user reads "Alex joined"
      setTimeout(() => {
        onComplete?.();
      }, 2400);
    });

    return () => { clearTimeout(s1); clearTimeout(s2); };
  }, [visible, durationMs]);

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible={visible}>
      <View style={s.backdrop}>
        <View style={s.card}>
          {phase === 'processing' ? (
            <>
              <View style={s.iconBox}>
                <Ionicons name="hourglass" size={28} color={T.primary} />
              </View>
              <Text style={s.title} testID="payment-progress-title">{STORY[storyIdx]}</Text>
              <Text style={s.sub}>{label || 'Hang tight — this takes a couple of seconds'}</Text>
              <View style={s.barTrack}>
                <Animated.View
                  style={[
                    s.barFill,
                    {
                      width: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
              </View>
            </>
          ) : (
            <>
              <View style={[s.iconBox, { backgroundColor: T.successBgStrong }]}>
                <Ionicons name="checkmark" size={32} color={T.success} />
              </View>
              <Text style={[s.title, { color: T.success }]} testID="payment-progress-success">Development started</Text>

              {/* Reality anchor — a real person joined */}
              <View style={s.devJoinedBox} testID="payment-progress-dev-joined">
                <View style={s.devAvatar}><Text style={s.devAvatarText}>{developerName.charAt(0)}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.devLine}>
                    <Text style={s.devName}>{developerName}</Text> <Text style={s.devRole}>({developerRole})</Text> joined your project
                  </Text>
                  <Text style={s.devUpdate}>⏱ First update in {nextUpdateHint}</Text>
                </View>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center', padding: T.lg },
  card: { backgroundColor: T.surface1, borderRadius: T.radiusLg, padding: T.xl, minWidth: 300, maxWidth: 420, alignItems: 'center' },
  iconBox: { width: 64, height: 64, borderRadius: 32, backgroundColor: T.primaryBgStrong, alignItems: 'center', justifyContent: 'center', marginBottom: T.md },
  title: { color: T.text, fontSize: T.h2, fontWeight: '800', marginBottom: T.xs },
  sub: { color: T.textMuted, fontSize: T.small, textAlign: 'center', marginBottom: T.lg },
  barTrack: { height: 6, backgroundColor: T.surface2, borderRadius: 3, width: 220, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: T.primary, borderRadius: 3 },

  devJoinedBox: { flexDirection: 'row', alignItems: 'center', gap: T.md, backgroundColor: T.surface2, borderRadius: T.radiusSm, padding: T.md, marginTop: T.md, width: '100%' },
  devAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: T.primaryBgStrong, alignItems: 'center', justifyContent: 'center' },
  devAvatarText: { color: T.primary, fontWeight: '800', fontSize: T.body + 2 },
  devLine: { color: T.text, fontSize: T.small, lineHeight: 18 },
  devName: { fontWeight: '700', color: T.text },
  devRole: { color: T.textMuted, fontWeight: '500' },
  devUpdate: { color: T.success, fontSize: T.tiny, fontWeight: '600', marginTop: 2 },
});


/**
 * Inline availability check ("Checking team availability..." — 1.2-1.8s before confirm modal).
 * Use between CTA click and setConfirm().
 */
export function useAvailabilityCheck() {
  const [checking, setChecking] = useState(false);

  const run = (onDone: () => void, delayMs = 1300) => {
    setChecking(true);
    setTimeout(() => {
      setChecking(false);
      onDone();
    }, delayMs);
  };

  const overlay = (
    <Modal transparent visible={checking} animationType="fade">
      <View style={s2.backdrop}>
        <View style={s2.card}>
          <Ionicons name="search" size={22} color={T.primary} />
          <Text style={s2.text}>Checking team availability...</Text>
        </View>
      </View>
    </Modal>
  );

  return { run, overlay };
}

const s2 = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: T.surface1, borderRadius: T.radiusLg, paddingVertical: T.lg, paddingHorizontal: T.xl, flexDirection: 'row', gap: T.md, alignItems: 'center' },
  text: { color: T.text, fontSize: T.body, fontWeight: '600' },
});
