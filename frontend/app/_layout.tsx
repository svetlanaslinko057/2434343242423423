import { View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import * as Font from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { AuthProvider, useAuth } from '../src/auth';
import { AuthGateProvider } from '../src/auth-gate';
import { FeedbackProvider } from '../src/feedback';
import { StateShiftProvider } from '../src/state-shift';
import { ValidatorProvider } from '../src/validator-context';
import { I18nProvider } from '../src/i18n';
import { ThemeProvider, useTheme } from '../src/theme-context';
import AppHeader from '../src/app-header';
import BottomTabs from '../src/bottom-tabs';
import { captureFromUrl, bindIfNeeded } from '../src/referral';
import T from '../src/theme';
import { runtime } from '../src/runtime';

// ─── Step 6.2 Stage 2 — Runtime boot guard (Expo) ────────────────────────────
// Race capability manifest fetch against 1.5s. Falls back to soft-degraded
// mode if backend doesn't reply in time — UI never blocks.
Promise.race([
  runtime.capabilities.refresh().catch(() => null),
  new Promise((res) => setTimeout(res, 1500)),
]).catch(() => undefined);

// ─── Icon font preload (web FontFaceObserver timeout fix) ────────────────────
// `@expo/vector-icons/Ionicons` triggers `expo-font` → `FontFaceObserver.load(null, 6000)`
// per icon instance on web. If the browser doesn't render the test glyph in 6s
// the promise rejects as "Uncaught Error: 6000ms timeout exceeded".
// We pre-inject the @font-face CSS rule once at app boot and swallow the
// observer rejection — subsequent <Ionicons> mounts see Font.isLoaded()===true
// and skip their own observer call.
void Font.loadAsync({ ...Ionicons.font }).catch(() => undefined);

/**
 * L0 App Shell — every screen renders inside this frame.
 *
 * Structure (top → bottom):
 *   [AppHeader]        — always (brand + title + identity). Works for guests.
 *   [<Slot />]         — the current route content.
 *   [BottomTabs]       — authed only, visible on L0 + workspace routes.
 *
 * Theme is wired at the very top: `ThemeProvider` owns the active palette and
 * pushes it into the `T` Proxy via `setTokens()`. The provider also remounts
 * its subtree on theme change (`key={theme}`) so every `StyleSheet.create`
 * picks up the new colours.
 *
 * Phase 2.D referral hooks live here so they fire exactly once per app
 * boot (capture from URL) and once per auth state transition (bind).
 */
function AppContent() {
  const { user, loading } = useAuth();
  const { theme } = useTheme();
  const authed = !!user && !loading;

  // Capture `?ref=XXX` exactly once on app boot.
  useEffect(() => { void captureFromUrl(); }, []);

  // Whenever we know we have a signed-in user, attempt the bind. The
  // helper is idempotent (24h TTL + bound flag), so re-runs are safe.
  useEffect(() => {
    if (authed) void bindIfNeeded();
  }, [authed]);

  return (
    <View style={[styles.root, { backgroundColor: T.bg }]}>
      {/* StatusBar icons follow the theme: dark-palette → light icons, and vice versa. */}
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <AppHeader />
      <View style={styles.body}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: T.bg }, animation: 'fade' }} />
      </View>
      {authed && <BottomTabs />}
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      {/* ThemeProvider sits above I18n/Auth so every downstream component — and
          every StyleSheet.create() call — reads from the active palette.
          It also forces a remount of its subtree on theme change via
          key={theme}, which is what makes pre-created stylesheets rebuild. */}
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <AuthGateProvider>
              <FeedbackProvider>
                <StateShiftProvider>
                  <ValidatorProvider>
                    <AppContent />
                  </ValidatorProvider>
                </StateShiftProvider>
              </FeedbackProvider>
            </AuthGateProvider>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
});
