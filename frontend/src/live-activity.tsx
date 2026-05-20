import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import T from './theme';

/**
 * Live Activity Banner — "reality anchor" after successful payment.
 * Shows rotating developer activity lines to kill "is this demo?" skepticism.
 *
 * Trigger: set `visible={true}` after PaymentProgress.onComplete.
 * Auto-rotates messages every 4s, lives for 20s then auto-hides.
 */

type Props = {
  visible: boolean;
  developerName?: string;
  onHide?: () => void;
};

const MESSAGES = [
  '🟢 Alex is reviewing your requirements…',
  '💬 Alex added a comment to Dashboard UI',
  '📋 Alex created 3 sub-tasks for Core API',
  '⚙️  Alex started development on Backend API',
];

export default function LiveActivityBanner({ visible, developerName = 'Alex', onHide }: Props) {
  const [msgIdx, setMsgIdx] = useState(0);
  const [shown, setShown] = useState(false);
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const slideAnim = useRef(new Animated.Value(-80)).current;

  useEffect(() => {
    if (!visible) { setShown(false); return; }

    // Slide in after 3s (after user has read "Development started")
    const showTimer = setTimeout(() => {
      setShown(true);
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
    }, 3000);

    // Rotate messages every 4s
    const rotate = setInterval(() => {
      setMsgIdx((i) => (i + 1) % MESSAGES.length);
    }, 4000);

    // Auto-hide after 22s total (3s delay + 19s visible)
    const hideTimer = setTimeout(() => {
      Animated.timing(slideAnim, { toValue: -80, duration: 400, useNativeDriver: true }).start(() => {
        setShown(false);
        onHide?.();
      });
    }, 22000);

    // Pulsing green dot
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 900, useNativeDriver: true }),
      ])
    );
    pulse.start();

    return () => {
      clearTimeout(showTimer); clearInterval(rotate); clearTimeout(hideTimer); pulse.stop();
    };
  }, [visible]);

  if (!visible || !shown) return null;

  const msg = MESSAGES[msgIdx].replace('Alex', developerName);

  return (
    <Animated.View
      style={[s.banner, { transform: [{ translateY: slideAnim }] }]}
      testID="live-activity-banner"
    >
      <Animated.View style={[s.dot, { opacity: pulseAnim }]} />
      <Text style={s.text} numberOfLines={1}>{msg}</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: T.successBg,
    borderLeftWidth: 3,
    borderLeftColor: T.success,
    borderRadius: T.radiusSm,
    padding: T.md,
    marginBottom: T.md,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.success },
  text: { color: T.text, fontSize: T.small, fontWeight: '600', flex: 1 },
});
