import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import T from './theme';
import { track } from './metrics';

// Sequential tooltip tour for demo mode. Shows ~3-4 short hints then auto-dismisses.
// Gated by: user.email === 'demo@atlas.dev' AND AsyncStorage flag (show once).

const STEPS = [
  {
    title: "This is your project",
    body: "5 modules · 1 ready for action. The system tracks everything.",
    icon: 'folder-open',
  },
  {
    title: "Look at the yellow block",
    body: "DO THIS NOW — the system tells you exactly what to do next. Only one action at a time.",
    icon: 'flash',
  },
  {
    title: "If you don't act — nothing happens",
    body: "No guesswork. No 10 buttons. The system pushes the project forward only when YOU decide.",
    icon: 'alert-circle',
  },
  {
    title: "Try clicking \"Unlock development\"",
    body: "It will show consequences before charging. Safe to explore.",
    icon: 'hand-left',
  },
];

const STORAGE_KEY = 'atlas_demo_tour_seen';

type Props = {
  userEmail?: string;
};

export default function DemoTour({ userEmail }: Props) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    (async () => {
      if (userEmail !== 'demo@atlas.dev') return;
      const seen = await AsyncStorage.getItem(STORAGE_KEY);
      if (seen === '1') return;
      // Small delay — let workspace render first
      setTimeout(() => setVisible(true), 900);
    })();
  }, [userEmail]);

  const finish = async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
    void track('tour_completed', { steps: STEPS.length });
  };

  const next = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      void finish();
    }
  };

  if (!visible) return null;

  const s_ = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <Modal transparent animationType="fade" visible={visible}>
      <Pressable style={s.backdrop} onPress={finish}>
        <Pressable style={s.card} onPress={() => {}}>
          <View style={s.iconBox}>
            <Ionicons name={s_.icon as any} size={28} color={T.primary} />
          </View>

          <Text style={s.stepCounter}>{step + 1} / {STEPS.length}</Text>
          <Text style={s.title} testID={`demo-tour-title-${step}`}>{s_.title}</Text>
          <Text style={s.body}>{s_.body}</Text>

          <View style={s.dots}>
            {STEPS.map((_, i) => (
              <View
                key={i}
                style={[s.dot, i === step && s.dotActive]}
              />
            ))}
          </View>

          <View style={s.buttonsRow}>
            <TouchableOpacity testID="demo-tour-skip" onPress={finish} style={s.skipBtn}>
              <Text style={s.skipText}>Skip tour</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="demo-tour-next"
              onPress={next}
              style={s.nextBtn}
            >
              <Text style={s.nextText}>{isLast ? 'Got it' : 'Next'}</Text>
              <Ionicons name={isLast ? 'checkmark' : 'chevron-forward'} size={16} color={T.bg} />
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: T.lg,
  },
  card: {
    backgroundColor: T.surface1,
    borderRadius: T.radiusLg,
    padding: T.xl,
    width: '100%',
    maxWidth: 480,
    borderWidth: 1,
    borderColor: T.primaryBorder,
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: T.primaryBgStrong,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginBottom: T.md,
  },
  stepCounter: { color: T.primary, fontSize: 10, letterSpacing: 2, fontWeight: '800', marginBottom: T.xs },
  title: { color: T.text, fontSize: T.h2, fontWeight: '800', marginBottom: T.sm },
  body: { color: T.textMuted, fontSize: T.body, lineHeight: 22, marginBottom: T.lg },

  dots: { flexDirection: 'row', gap: 6, marginBottom: T.lg, alignSelf: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.border },
  dotActive: { backgroundColor: T.primary, width: 24 },

  buttonsRow: { flexDirection: 'row', gap: T.sm },
  skipBtn: { flex: 1, padding: T.md, borderRadius: T.radiusSm, alignItems: 'center', borderWidth: 1, borderColor: T.border },
  skipText: { color: T.textMuted, fontWeight: '600', fontSize: T.small },
  nextBtn: { flex: 2, flexDirection: 'row', padding: T.md, borderRadius: T.radiusSm, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: T.primary },
  nextText: { color: T.bg, fontWeight: '800', fontSize: T.body },
});
