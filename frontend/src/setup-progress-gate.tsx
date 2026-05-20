import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Animated, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import T from './theme';

/**
 * Setup Progress Gate — "Soft Commitment Trap" (Schema 1+2+3+4).
 * Shown BETWEEN the CTA click and the Confirm modal.
 *
 * Timeline (total ≈3.5s of pre-confirm perception):
 *   [0.0s]  Modal opens: "Setting up your project..."
 *   [0.9s]  ✓ Project initialized
 *   [1.8s]  ✓ Developers notified
 *   [2.7s]  ⏳ Waiting for your confirmation...
 *           → Reveals "Team reserved for you · 02:00" timer + 2 CTAs:
 *             • Continue setup (micro-yes #1)  → resolves → parent opens softer Confirm
 *             • Back (small link)
 *
 * When user clicks Continue setup: calls onContinue().
 * When user closes: calls onCancel().
 */

type Props = {
  visible: boolean;
  amount?: number;
  onContinue: () => void;
  onCancel: () => void;
};

export default function SetupProgressGate({ visible, amount, onContinue, onCancel }: Props) {
  const [phase, setPhase] = useState<0 | 1 | 2 | 3>(0);
  const [secondsLeft, setSecondsLeft] = useState(120);
  const stepAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) { setPhase(0); setSecondsLeft(120); return; }

    setPhase(0);
    stepAnim.setValue(0);

    const t1 = setTimeout(() => setPhase(1), 900);
    const t2 = setTimeout(() => setPhase(2), 1800);
    const t3 = setTimeout(() => setPhase(3), 2700);

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [visible]);

  // Fake countdown, only runs once phase 3 reached
  useEffect(() => {
    if (!visible || phase < 3) return;
    const iv = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(iv);
  }, [visible, phase]);

  if (!visible) return null;

  const mm = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const ss = (secondsLeft % 60).toString().padStart(2, '0');

  return (
    <Modal transparent animationType="fade" visible={visible}>
      <Pressable style={s.backdrop} onPress={() => {}}>
        <View style={s.card}>
          <Text style={s.title} testID="setup-gate-title">
            {phase < 3 ? 'Setting up your project…' : 'Ready to start'}
          </Text>

          {/* Steps list */}
          <View style={s.steps}>
            <Step label="Project initialized" done={phase >= 1} active={phase === 0} />
            <Step label="Developers notified" done={phase >= 2} active={phase === 1} />
            <Step label={phase < 3 ? 'Waiting for your confirmation…' : 'Team reserved · waiting for you'} done={phase >= 3} active={phase === 2} />
          </View>

          {/* Phase 3 — reservation timer + CTAs */}
          {phase >= 3 && (
            <>
              <View style={s.timerBox} testID="setup-gate-timer">
                <Ionicons name="timer-outline" size={16} color={T.risk} />
                <Text style={s.timerText}>
                  Team reserved for you · <Text style={s.timerMono}>{mm}:{ss}</Text>
                </Text>
              </View>

              {/* Zero-risk flip — reassurance */}
              <View style={s.safetyBox}>
                <Ionicons name="shield-checkmark" size={14} color={T.success} />
                <Text style={s.safetyText}>
                  You're not charged yet · Payment happens after setup
                </Text>
              </View>

              {/* Micro-yes #1: Continue setup */}
              <TouchableOpacity
                testID="setup-gate-continue"
                style={s.primaryBtn}
                onPress={onContinue}
                activeOpacity={0.85}
              >
                <Text style={s.primaryBtnText}>Continue setup</Text>
                <Ionicons name="chevron-forward" size={18} color={T.bg} />
              </TouchableOpacity>

              {amount != null ? (
                <Text style={s.ctaHint}>Next: confirm start — ${amount}</Text>
              ) : null}

              <TouchableOpacity testID="setup-gate-cancel" onPress={onCancel} style={s.cancelBtn}>
                <Text style={s.cancelText}>← Back</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Phases 0-2: pure loader, no CTA */}
          {phase < 3 && (
            <View style={s.barTrack}>
              <Animated.View
                style={[
                  s.barFill,
                  {
                    width: `${Math.min((phase / 3) * 100 + 20, 100)}%`,
                  },
                ]}
              />
            </View>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

function Step({ label, done, active }: { label: string; done: boolean; active: boolean }) {
  const color = done ? T.success : active ? T.primary : T.textMuted;
  return (
    <View style={s.stepRow}>
      {done ? (
        <Ionicons name="checkmark-circle" size={16} color={T.success} />
      ) : active ? (
        <Ionicons name="sync" size={16} color={T.primary} />
      ) : (
        <Ionicons name="ellipse-outline" size={16} color={T.textMuted} />
      )}
      <Text style={[s.stepText, { color, fontWeight: active || done ? '600' : '400' }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center', padding: T.lg },
  card: { backgroundColor: T.surface1, borderRadius: T.radiusLg, padding: T.xl, width: '100%', maxWidth: 460, borderWidth: 1, borderColor: T.primaryBorder },
  title: { color: T.text, fontSize: T.h2, fontWeight: '800', marginBottom: T.lg, textAlign: 'center' },

  steps: { gap: T.sm, marginBottom: T.lg },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: T.sm },
  stepText: { fontSize: T.body, flex: 1 },

  barTrack: { height: 4, backgroundColor: T.surface2, borderRadius: 2, overflow: 'hidden', marginTop: T.sm },
  barFill: { height: '100%', backgroundColor: T.primary, borderRadius: 2 },

  timerBox: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: T.riskBg, borderRadius: T.radiusSm, padding: 10, marginBottom: T.sm, borderLeftWidth: 3, borderLeftColor: T.risk },
  timerText: { color: T.text, fontSize: T.small, fontWeight: '600' },
  timerMono: { fontVariant: ['tabular-nums'], color: T.risk, fontWeight: '800' },

  safetyBox: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: T.successBg, borderRadius: T.radiusSm, padding: 10, marginBottom: T.md },
  safetyText: { color: T.success, fontSize: T.small, fontWeight: '600' },

  primaryBtn: { backgroundColor: T.primary, borderRadius: T.radiusSm, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  primaryBtnText: { color: T.bg, fontSize: T.body + 1, fontWeight: '800' },
  ctaHint: { color: T.textMuted, fontSize: T.tiny, textAlign: 'center', marginTop: T.sm, fontStyle: 'italic' },

  cancelBtn: { alignSelf: 'center', marginTop: T.md, padding: 8 },
  cancelText: { color: T.textMuted, fontSize: T.small },
});
