import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, Pressable, StyleSheet } from 'react-native';
import T from './theme';
import { motion } from './motion';

/**
 * L0 UI Kit — Linear-canon primitives.
 * Import as:  import { Card, StatusDot, PulseDot, ProgressBar, PrimaryButton,
 *                      PressScale, FadeSlideIn, SystemStateCard, ProjectCard,
 *                      ActivityItem, SectionLabel, Row } from '@/ui';
 *
 * Rule: keep this file tight. No business logic, no variants explosion. If a
 * screen needs something fancier it should compose these, not fork them.
 */

type Status = 'active' | 'review' | 'pending' | 'done' | 'error' | 'idle' | 'blocked';

const STATUS_COLOR: Record<Status, string> = {
  active: T.success,
  done: T.success,
  review: T.risk,
  pending: T.textMuted,
  idle: T.textMuted,
  error: T.danger,
  blocked: T.danger,
};

/* ------------------------------------------------------------------ Card */
export function Card({ children, style, onPress, testID }: {
  children: any;
  style?: any;
  onPress?: () => void;
  testID?: string;
}) {
  const body = (
    <View
      testID={testID}
      style={[{
        backgroundColor: T.surface1,
        borderRadius: T.radius,
        padding: T.lg,
        borderWidth: 1,
        borderColor: T.border,
      }, style]}
    >
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <PressScale onPress={onPress} testID={testID}>
      {body}
    </PressScale>
  );
}

/* ------------------------------------------------------------- StatusDot */
export function StatusDot({ status = 'active', pulse = false, size = 8 }: {
  status?: Status;
  pulse?: boolean;
  size?: number;
}) {
  const a = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulse) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 0.35, duration: 800, useNativeDriver: true }),
        Animated.timing(a, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, a]);

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: STATUS_COLOR[status],
        opacity: pulse ? a : 1,
      }}
    />
  );
}

/* ------------------------------------------------------------- PulseDot */
/** Always-pulsing green dot — shorthand for "system alive". */
export function PulseDot({ size = 8 }: { size?: number }) {
  return <StatusDot status="active" pulse size={size} />;
}

/* ----------------------------------------------------------- ProgressBar */
export function ProgressBar({ value, height = 4 }: { value: number; height?: number }) {
  const a = useRef(new Animated.Value(value)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: value, duration: motion.slow, useNativeDriver: false }).start();
  }, [value, a]);

  const width = a.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View style={{
      height,
      borderRadius: height / 2,
      backgroundColor: 'rgba(255,255,255,0.06)',
      overflow: 'hidden',
    }}>
      <Animated.View style={{
        height: '100%',
        width,
        backgroundColor: T.primary,
        borderRadius: height / 2,
      }} />
    </View>
  );
}

/* ------------------------------------------------------------ PressScale */
/** Wrap any onPress target. Press-in scale 0.98, out 1. No ripple, no color flash. */
export function PressScale({ children, onPress, style, testID, disabled }: {
  children: any;
  onPress?: () => void;
  style?: any;
  testID?: string;
  disabled?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => {
    if (disabled) return;
    Animated.timing(scale, {
      toValue: motion.scalePressIn,
      duration: motion.fast,
      useNativeDriver: true,
    }).start();
  };
  const pressOut = () => {
    Animated.timing(scale, {
      toValue: motion.scalePressOut,
      duration: motion.fast,
      useNativeDriver: true,
    }).start();
  };
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
    >
      <Animated.View style={[style, { transform: [{ scale }] }, disabled && { opacity: 0.5 }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

/* ----------------------------------------------------------- FadeSlideIn */
/** Opacity 0→1 + translateY 8→0 over 260ms. Use with delay={i * 50} for stagger. */
export function FadeSlideIn({ children, delay = 0, style }: {
  children: any;
  delay?: number;
  style?: any;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: motion.normal,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: motion.normal,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY, delay]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

/* --------------------------------------------------------- PrimaryButton */
export function PrimaryButton({
  title, onPress, testID, disabled,
}: { title: string; onPress: () => void; testID?: string; disabled?: boolean }) {
  return (
    <PressScale onPress={onPress} disabled={disabled} testID={testID} style={s.primary}>
      <Text style={s.primaryText}>{title}</Text>
    </PressScale>
  );
}

/* ------------------------------------------------------- SecondaryButton */
/** Neutral CTA: outline + neutral text. Press = mint border tint to hint
 *  it'll lead to the same action surface as PrimaryButton. */
export function SecondaryButton({
  title, onPress, testID, disabled,
}: { title: string; onPress: () => void; testID?: string; disabled?: boolean }) {
  return (
    <PressScale onPress={onPress} disabled={disabled} testID={testID} style={s.secondary}>
      <Text style={s.secondaryText}>{title}</Text>
    </PressScale>
  );
}

/* --------------------------------------------------------- SystemStateCard */
/** Live "Building your product" card. Hero-sized — it's the centre of gravity
 *  on /home. Title 18/600 + LIVE pulse badge + one state line + progress bar. */
export function SystemStateCard({
  active = 0,
  done = 0,
  progress = 0,
  label = 'Building your product',
  testID,
}: {
  active?: number;
  done?: number;
  progress?: number;   // 0..1
  label?: string;
  testID?: string;
}) {
  return (
    <Card testID={testID} style={s.hero}>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Text style={typo.heroTitle}>{label}</Text>
        <View style={s.liveBadge}>
          <PulseDot size={6} />
          <Text style={s.liveText}>LIVE</Text>
        </View>
      </View>
      <Text style={[typo.caption, { marginTop: T.sm }]}>
        {active} in progress · {done} done
      </Text>
      <View style={{ marginTop: T.lg }}>
        <ProgressBar value={progress} height={5} />
      </View>
    </Card>
  );
}

/* ------------------------------------------------------------ ProjectCard */
/** Clean project row: title / ● Building / counts / progress. */
export function ProjectCard({
  title,
  status = 'active',
  statusLabel = 'Building',
  inProgress = 0,
  review = 0,
  progress = 0,
  onPress,
  testID,
}: {
  title: string;
  status?: Status;
  statusLabel?: string;
  inProgress?: number;
  review?: number;
  progress?: number;   // 0..1
  onPress?: () => void;
  testID?: string;
}) {
  const isLive = status === 'active' || status === 'review';
  return (
    <Card onPress={onPress} testID={testID}>
      <Text style={typo.title} numberOfLines={1}>{title}</Text>
      <View style={[s.row, { marginTop: T.sm }]}>
        <StatusDot status={status} pulse={isLive} />
        <Text style={typo.body}>{statusLabel}</Text>
      </View>
      <Text style={[typo.caption, { marginTop: T.xs }]}>
        {inProgress} in progress · {review} review
      </Text>
      <View style={{ marginTop: T.md }}>
        <ProgressBar value={progress} />
      </View>
    </Card>
  );
}

/* ------------------------------------------------------------ ActivityItem */
/** Minimal event row: title + relative time. No verb chatter, no meta line. */
export function ActivityItem({
  title,
  time,
  status = 'active',
  testID,
}: {
  title: string;
  time: string;
  status?: Status;
  testID?: string;
}) {
  return (
    <View style={s.activityRow} testID={testID}>
      <View style={{ paddingTop: 6 }}>
        <StatusDot status={status} size={8} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={typo.body} numberOfLines={2}>{title}</Text>
        <Text style={typo.caption}>{time}</Text>
      </View>
    </View>
  );
}

/* --------------------------------------------------------- SectionLabel */
export function SectionLabel({ children, style }: { children: any; style?: any }) {
  return <Text style={[s.sectionLabel, style]}>{children}</Text>;
}

/* --------------------------------------------------------- Row helpers */
export function Row({ children, gap = T.sm, style }: any) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>
      {children}
    </View>
  );
}

/* --------------------------------------------------------- Typography */
const typo = StyleSheet.create({
  title: { color: T.text, fontSize: 22, fontWeight: '600' },
  heroTitle: { color: T.text, fontSize: 18, fontWeight: '600' },
  body: { color: T.text, fontSize: 15 },
  caption: { color: T.textSecondary, fontSize: 13 },
});

const s = StyleSheet.create({
  primary: {
    backgroundColor: T.primary,
    paddingVertical: 14,
    paddingHorizontal: T.lg,
    borderRadius: T.radius,
    alignItems: 'center',
  },
  primaryText: { color: '#0B0F14', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: T.borderStrong,
    paddingVertical: 13,
    paddingHorizontal: T.lg,
    borderRadius: T.radius,
    alignItems: 'center',
  },
  secondaryText: { color: T.text, fontSize: 15, fontWeight: '600', letterSpacing: 0.2 },
  sectionLabel: {
    color: T.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: T.sm },
  activityRow: {
    flexDirection: 'row',
    gap: T.md,
    paddingVertical: T.md,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  // SystemStateCard hero
  hero: {
    padding: 28,
    borderRadius: 20,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: T.primaryBorder,
    backgroundColor: T.primaryBg,
  },
  liveText: {
    color: T.primary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
});
