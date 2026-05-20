import { useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  useFonts as useInstrument,
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
} from '@expo-google-fonts/instrument-sans';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useAuth } from '../src/auth';
import { useMe } from '../src/use-me';
import { resolveUserEntry } from '../src/resolve-entry';
import {
  markWelcomeSeenForSession,
  markJustLeftWelcome,
} from '../src/welcome-session';
import T from '../src/theme';
import { useTheme } from '../src/theme-context';

/**
 * Welcome — entrance screen to EVA-X.
 *
 * ONE component, ONE layout, ONE set of styles. Dark and Light differ
 * ONLY in palette values — never in structure, copy, layout, fonts, or
 * radii. The `T` proxy returns CSS variables on web (auto-flip without
 * remount) and the live palette on native (the global ThemeProvider
 * remounts the subtree on theme change so module-level StyleSheets pick
 * up the new colours).
 *
 * Hard rules (unchanged):
 *   - No form fields here
 *   - No price logic here
 *   - No mode selection here
 *   - All of that lives on `/` (describe)
 */

const F = {
  sans:        'InstrumentSans_400Regular',
  sansMedium:  'InstrumentSans_500Medium',
  mono:        'JetBrainsMono_500Medium',
} as const;

/**
 * Brand mark selector — substrate-aware.
 *
 * The asset filenames are misleading: `evax-logo.png` is the WHITE
 * wordmark (for dark substrate), and `evax-logo-light.png` is the BLACK
 * wordmark (for "light theme" — i.e. paper substrate). We resolve the
 * correct asset off the active theme so the brand mark never inverts
 * into the substrate.
 */
function useBrandLogo() {
  const { theme } = useTheme();
  return theme === 'dark'
    ? require('../assets/images/evax-logo.png')         // white logo → dark bg
    : require('../assets/images/evax-logo-light.png');  // black logo → light bg
}

/* ---------- CTA — single implementation, theme-reactive ---------- */

function GravityCTA({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const scale = useSharedValue(1);
  const fill = useSharedValue(0);
  const aStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: 1 - fill.value * 0.04,
  }));
  return (
    <Pressable
      onPressIn={() => {
        scale.value = withSpring(0.985, { mass: 1, stiffness: 250, damping: 20 });
        fill.value = withSpring(1, { mass: 1, stiffness: 250, damping: 20 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { mass: 1, stiffness: 250, damping: 20 });
        fill.value = withSpring(0, { mass: 1, stiffness: 250, damping: 20 });
      }}
      onPress={onPress}
      testID={testID}
      style={{ width: '100%' }}
    >
      <Animated.View style={[s.ctaObject, aStyle]}>
        <Text style={s.ctaLabel}>{label}</Text>
        <Text style={s.ctaMarker}>→</Text>
      </Animated.View>
    </Pressable>
  );
}

/* ---------- Sequence row — operational telemetry ---------- */

function SequenceRow({
  seq,
  label,
  position,
  testID,
}: {
  seq: string;
  label: string;
  position: 'first' | 'middle' | 'last';
  testID?: string;
}) {
  return (
    <View
      style={[
        s.seqRow,
        { borderTopWidth: 1 },
        position === 'last' && { borderBottomWidth: 1 },
      ]}
      testID={testID}
    >
      <Text style={s.seqTag}>{seq}</Text>
      <Text style={s.seqLabel}>{label}</Text>
    </View>
  );
}

/* ---------- Capability bullet ---------- */

function Capability({ text }: { text: string }) {
  return (
    <View style={s.capRow}>
      <View style={s.capBar} />
      <Text style={s.capText}>{text}</Text>
    </View>
  );
}

/* ---------- Screen ---------- */

export default function WelcomeScreen() {
  // Pull the active theme name so the JSX subtree re-renders on flip,
  // and so we can keep one canonical implementation.
  const { theme } = useTheme();

  const router = useRouter();
  const { token, loading: authLoading } = useAuth();
  const { me, loading: meLoading } = useMe();

  const [fontsLoaded] = useInstrument({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    JetBrainsMono_500Medium,
  });

  useEffect(() => {
    if (authLoading || meLoading) return;
    if (token && me) {
      router.replace(resolveUserEntry(me) as any);
    }
  }, [authLoading, meLoading, token, me, router]);

  const onStart = () => {
    markWelcomeSeenForSession();
    markJustLeftWelcome();
    router.replace('/describe' as any);
  };

  const onLogin = () => {
    markWelcomeSeenForSession();
    // mode=login → auth screen defaults to password step (returning user)
    router.push('/auth?mode=login' as any);
  };

  if (authLoading || (token && meLoading) || !fontsLoaded) {
    return (
      <View style={s.loading} testID="welcome-loading">
        <ActivityIndicator size="small" color={T.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      // `key={theme}` forces a remount on native when the theme flips so
      // module-level StyleSheets that captured the initial palette are
      // re-evaluated. No-op on web (CSS vars do the work) but harmless.
      key={theme}
      style={s.container}
      contentContainerStyle={s.content}
      testID="welcome-screen"
      showsVerticalScrollIndicator={false}
    >
      {/* Brand mark — canonical PNG. Never text. Do not refactor. */}
      <View style={s.brand} testID="welcome-brand">
        <Image
          source={useBrandLogo()}
          style={s.brandLogo}
          resizeMode="contain"
          accessibilityLabel="EVA-X"
        />
      </View>

      {/* Hero */}
      <View style={s.hero}>
        <Text style={s.heroTitle} testID="welcome-title">
          Build real{'\n'}products.{'\n'}Not tasks.
        </Text>
        <Text style={s.heroSubtitle} testID="welcome-subtitle">
          Describe your idea. Get a full product plan. Launch with our team.
        </Text>
      </View>

      {/* Micro-promise — telemetry strip */}
      <View style={s.microStrip} testID="welcome-micro-promise">
        <Text style={s.microText}>
          NO FREELANCERS · NO CHAOS · ONE SYSTEM
        </Text>
      </View>

      {/* Sequence — operational steps as SEQ-NN telemetry */}
      <View style={s.sequence} testID="welcome-sequence">
        <SequenceRow seq="SEQ-01" label="Describe your idea"    position="first"  testID="welcome-step-1" />
        <SequenceRow seq="SEQ-02" label="Get full plan & price" position="middle" testID="welcome-step-2" />
        <SequenceRow seq="SEQ-03" label="We build your product" position="last"   testID="welcome-step-3" />
      </View>

      {/* Capabilities */}
      <View style={s.capabilities}>
        <Capability text="Real product, not prototype" />
        <Capability text="Fixed scope & pricing" />
        <Capability text="Built by platform team" />
        <Capability text="No hiring, no chaos" />
      </View>

      {/* Trust strip */}
      <View style={s.trust} testID="welcome-trust">
        <Text style={s.trustEyebrow}>USED TO BUILD</Text>
        <Text style={s.trustLine}>
          SaaS platforms · Marketplaces · AI tools · Internal systems
        </Text>
      </View>

      {/* CTA */}
      <View style={s.ctaBlock}>
        <GravityCTA
          label="See my product plan"
          onPress={onStart}
          testID="welcome-start-cta"
        />
        <Text style={s.ctaHint}>30 SECONDS · NO SIGN-UP REQUIRED</Text>
      </View>

      {/* Secondary login link */}
      <Pressable
        onPress={onLogin}
        style={s.loginLink}
        testID="welcome-login-link"
      >
        <View style={s.loginRow}>
          <Text style={s.loginText}>Already have an account?</Text>
          <Text style={s.loginAction}>Log in</Text>
        </View>
      </Pressable>
    </ScrollView>
  );
}

/* ---------- Styles ---------- */

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content:   { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 64 },
  loading:   {
    flex: 1,
    backgroundColor: T.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Brand mark — fixed-size PNG, never text */
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 56,
  },
  brandLogo: { width: 110, height: 32 },

  /* Hero */
  hero: { marginBottom: 32 },
  heroTitle: {
    fontFamily: F.sansMedium,
    fontSize: 42,
    color: T.text,
    lineHeight: 44,
    letterSpacing: -1.5,
  },
  heroSubtitle: {
    fontFamily: F.sans,
    fontSize: 18,
    color: T.textSecondary,
    lineHeight: 25,
    marginTop: 20,
    maxWidth: '95%',
  },

  /* Micro-promise — system telemetry */
  microStrip: {
    backgroundColor: T.surface,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: T.border,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 32,
    marginHorizontal: -24,
  },
  microText: {
    fontFamily: F.mono,
    fontSize: 11,
    color: T.textMuted,
    letterSpacing: 0.5,
  },

  /* Sequence */
  sequence: {
    marginTop: 40,
    marginHorizontal: -24,
    backgroundColor: T.surface,
  },
  seqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderColor: T.border,
  },
  seqTag: {
    fontFamily: F.mono,
    fontSize: 10,
    color: T.textMuted,
    letterSpacing: 1,
    width: 64,
  },
  seqLabel: {
    fontFamily: F.sansMedium,
    fontSize: 16,
    color: T.text,
    flex: 1,
  },

  /* Capabilities */
  capabilities: { marginTop: 32, gap: 14 },
  capRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  capBar: {
    width: 1,
    height: 8,
    backgroundColor: T.primary,
  },
  capText: {
    fontFamily: F.sans,
    fontSize: 15,
    color: T.textSecondary,
  },

  /* Trust */
  trust: {
    marginTop: 48,
    marginHorizontal: -24,
    paddingVertical: 24,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
  },
  trustEyebrow: {
    fontFamily: F.mono,
    fontSize: 10,
    color: T.textMuted,
    letterSpacing: 1,
    marginBottom: 8,
  },
  trustLine: {
    fontFamily: F.sans,
    fontSize: 13,
    color: T.textSecondary,
    textAlign: 'center',
  },

  /* CTA — primary surface, theme-reactive. Same shape in dark + light. */
  ctaBlock: { marginTop: 48, alignItems: 'center' },
  ctaObject: {
    width: '100%',
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    borderRadius: 6,
    backgroundColor: T.primary,
    ...Platform.select({
      web: {
        boxShadow:
          '0 1px 0 rgba(0,0,0,0.12), 0 12px 28px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.06)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
        elevation: 6,
      },
    }),
  },
  ctaLabel: {
    fontFamily: F.sansMedium,
    fontSize: 16,
    color: T.primaryInk,
    letterSpacing: -0.2,
  },
  ctaMarker: {
    fontFamily: F.mono,
    fontSize: 16,
    color: T.primaryInk,
    marginLeft: 12,
  },
  ctaHint: {
    fontFamily: F.mono,
    fontSize: 10,
    color: T.textMuted,
    letterSpacing: 1,
    marginTop: 12,
  },

  /* Secondary link */
  loginLink: {
    marginTop: 48,
    alignItems: 'center',
    paddingVertical: 8,
  },
  loginRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  loginText: {
    fontFamily: F.sans,
    fontSize: 14,
    color: T.textSecondary,
  },
  loginAction: {
    fontFamily: F.sansMedium,
    color: T.text,
  },
});
