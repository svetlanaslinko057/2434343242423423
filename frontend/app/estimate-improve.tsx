import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../src/api';
import { FadeSlideIn, PressScale, PrimaryButton, SectionLabel } from '../src/ui';
import { motion } from '../src/motion';
import T from '../src/theme';

/**
 * Estimate Improve — "your brief is too thin" screen.
 *
 * Shown instead of /estimate-result when backend returns `clarity: 'low'`.
 * The goal is to convert an unclear brief into help — not into an error
 * message. User sees the suggestion list (from backend) and can edit their
 * original goal in-place without having to go back.
 *
 * Flow:  Home → POST /estimate (clarity=low) → here → re-submit → /estimate-result
 */

export default function EstimateImprove() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    goal: string;
    mode: string;
    message: string;
    suggestions: string;  // JSON array
  }>();

  const [goal, setGoal] = useState((params.goal as string) || '');
  const [busy, setBusy] = useState(false);

  const mode = (params.mode as string) || 'hybrid';
  const message =
    (params.message as string) || 'We need a bit more detail to give you a real estimate.';
  let suggestions: string[] = [];
  try {
    suggestions = params.suggestions ? JSON.parse(params.suggestions as string) : [];
  } catch {
    suggestions = [];
  }

  const resubmit = async () => {
    const g = goal.trim();
    if (g.length < 20) {
      Alert.alert(
        'Still too short',
        'Try adding one more sentence about the user or the data — it helps us size the build.',
      );
      return;
    }
    try {
      setBusy(true);
      const r = await api.post('/estimate', { goal: g, mode });
      if (r.data?.clarity === 'low') {
        // Still unclear — keep us on this screen with the new suggestions.
        Alert.alert(
          r.data.message || 'We still need more',
          (r.data.suggestions || []).join('\n• '),
        );
        return;
      }
      router.replace({
        pathname: '/estimate-result',
        params: { data: JSON.stringify(r.data), goal: g, mode },
      } as any);
    } catch (e: any) {
      Alert.alert('Could not calculate', e?.response?.data?.detail || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: T.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        testID="estimate-improve-screen"
        keyboardShouldPersistTaps="handled"
      >
        <FadeSlideIn>
          <View style={s.hintRow}>
            <Ionicons name="bulb-outline" size={18} color={T.risk} />
            <Text style={s.hintText}>We need a bit more detail</Text>
          </View>
          <Text style={s.title}>{message}</Text>
        </FadeSlideIn>

        <FadeSlideIn delay={motion.staggerStep}>
          <SectionLabel style={{ marginTop: T.xl, marginBottom: T.sm }}>Try adding</SectionLabel>
          <View style={{ gap: T.sm }}>
            {suggestions.map((x, i) => (
              <FadeSlideIn key={x} delay={motion.staggerStep * (2 + i)}>
                <View style={s.suggestion}>
                  <Text style={s.suggestionText}>• {x}</Text>
                </View>
              </FadeSlideIn>
            ))}
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={motion.staggerStep * (2 + suggestions.length + 1)}>
          <SectionLabel style={{ marginTop: T.xl, marginBottom: T.sm }}>
            Your description
          </SectionLabel>
          <TextInput
            testID="improve-goal-input"
            style={s.input}
            placeholder="Describe what you want to build…"
            placeholderTextColor={T.textMuted}
            value={goal}
            onChangeText={setGoal}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />
        </FadeSlideIn>

        <FadeSlideIn delay={motion.staggerStep * (3 + suggestions.length + 1)}>
          <View style={{ marginTop: T.xl }}>
            <PrimaryButton
              testID="improve-submit"
              title={busy ? 'Calculating…' : 'Improve description'}
              onPress={resubmit}
              disabled={busy}
            />
            <PressScale
              style={s.cancelBtn}
              onPress={() => router.back()}
              testID="improve-cancel"
            >
              <Text style={s.cancelText}>Back</Text>
            </PressScale>
          </View>
        </FadeSlideIn>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.lg, paddingTop: T.xl, paddingBottom: T.xl * 2 },

  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.xs,
    marginBottom: T.sm,
  },
  hintText: { color: T.risk, fontSize: 12, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' },
  title: { color: T.text, fontSize: 22, fontWeight: '600', lineHeight: 28 },

  suggestion: {
    paddingHorizontal: T.md,
    paddingVertical: T.sm,
    backgroundColor: T.surface1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.border,
  },
  suggestionText: { color: T.text, fontSize: 14, lineHeight: 20 },

  input: {
    backgroundColor: T.surface1,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: T.radius,
    padding: T.md,
    color: T.text,
    fontSize: 15,
    minHeight: 120,
  },

  cancelBtn: {
    marginTop: T.sm,
    alignItems: 'center',
    paddingVertical: T.md,
  },
  cancelText: { color: T.textSecondary, fontSize: 14 },
});
