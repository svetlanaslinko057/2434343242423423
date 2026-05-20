import { Pressable, Text, View, StyleSheet, Platform } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { C, F } from './design-tokens';

/**
 * GravityCTA — the primary surface action across the cognitive-monochrome
 * landing flow. NOT a flat rectangle. It is a tactile sage object with:
 *   • matte sage fill (no gradients, no glow);
 *   • 1px inner top highlight — matte light catching the upper edge;
 *   • 1px outer void anchor — grounding into the substrate;
 *   • soft warm-sage shadow (NOT iOS blue-grey dropdown shadow);
 *   • press response: scale 0.98 + fill shift to signalPressed.
 *
 * No confetti. No glow. No "thinking" animation. Press is a single
 * physical event, not a celebration.
 *
 * Re-used across surfaces so the grammar lives in ONE place. If the
 * CTA needs to behave differently somewhere, that's a signal the
 * grammar is breaking, not a reason to fork the component.
 */
export function GravityCTA({
  label,
  onPress,
  disabled,
  busy,
  busyLabel,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  testID?: string;
}) {
  const scale = useSharedValue(1);
  const fill = useSharedValue(0); // 0 = base sage, 1 = pressed sage
  const aStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    backgroundColor: fill.value > 0.5 ? C.signalPressed : C.signal,
    opacity: disabled ? 0.55 : 1,
  }));
  const handleIn = () => {
    if (disabled || busy) return;
    scale.value = withSpring(0.98, { mass: 1, stiffness: 250, damping: 20 });
    fill.value  = withSpring(1,    { mass: 1, stiffness: 250, damping: 20 });
  };
  const handleOut = () => {
    scale.value = withSpring(1, { mass: 1, stiffness: 250, damping: 20 });
    fill.value  = withSpring(0, { mass: 1, stiffness: 250, damping: 20 });
  };
  return (
    <Pressable
      onPressIn={handleIn}
      onPressOut={handleOut}
      onPress={() => !disabled && !busy && onPress()}
      testID={testID}
      disabled={disabled || busy}
    >
      <Animated.View style={[s.object, aStyle]}>
        <View style={s.innerHighlight} pointerEvents="none" />
        <Text style={s.label}>{busy ? (busyLabel || label) : label}</Text>
        <Text style={s.marker}>{busy ? '·' : '→'}</Text>
      </Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  object: {
    width: '100%',
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: C.void,
    backgroundColor: C.signal,
    ...Platform.select({
      web: {
        boxShadow:
          '0px 8px 24px rgba(140, 155, 144, 0.15), 0px 2px 4px rgba(0, 0, 0, 0.4)',
      },
      default: {
        shadowColor: '#8C9B90',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 24,
        elevation: 6,
      },
    }),
  },
  innerHighlight: {
    position: 'absolute',
    top: 0, left: 0, right: 0, height: 1,
    backgroundColor: C.signalHover,
  },
  label: {
    fontFamily: F.sansMedium,
    fontSize: 16,
    color: C.signalOn,
    letterSpacing: -0.2,
  },
  marker: {
    fontFamily: F.mono,
    fontSize: 16,
    color: C.signalOn,
    marginLeft: 12,
  },
});
