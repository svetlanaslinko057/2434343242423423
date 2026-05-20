/**
 * ThemeContext — active palette + theme controls.
 *
 * Mirrors the web platform's ThemeContext (`/app/web/src/contexts/ThemeContext.js`)
 * so dark/light parity is perfect across web and mobile.
 *
 * Behaviour:
 *   1. On mount → read persisted choice from AsyncStorage (`atlas-theme`);
 *      fall back to system `Appearance.getColorScheme()`.
 *   2. Listen to system theme changes — only apply if user hasn't picked
 *      an explicit override.
 *   3. `setTheme(next)` persists the choice and flips the palette.
 *   4. Every render also calls `setTokens(tokens)` on the `theme.ts` bridge
 *      so the 80+ screens importing `T` always read from the current palette.
 *
 * Consumers:
 *   const { theme, tokens, setTheme, toggleTheme } = useTheme();
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Appearance, Platform, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TOKENS, type Palette, type ThemeName } from './theme-tokens';
import { setTokens } from './theme';

type Ctx = {
  theme: ThemeName;
  tokens: Palette;
  setTheme: (next: ThemeName) => Promise<void>;
  toggleTheme: () => Promise<void>;
  /** True if the user has explicitly chosen a theme (vs system default). */
  isUserPref: boolean;
};

const ThemeContext = createContext<Ctx>({
  theme: 'dark',
  tokens: TOKENS.dark,
  setTheme: async () => {},
  toggleTheme: async () => {},
  isUserPref: false,
});

const STORAGE_KEY = 'atlas-theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Default to 'dark' system-wide — Dark is the canonical theme. Light is
  // a future deliverable. AsyncStorage override still wins on subsequent loads.
  const initial: ThemeName = (Appearance.getColorScheme() as ThemeName | null) === 'light'
    ? 'dark'
    : (Appearance.getColorScheme() as ThemeName | null) || 'dark';
  const [theme, setThemeState] = useState<ThemeName>(initial);
  const [isUserPref, setIsUserPref] = useState<boolean>(false);
  const userPrefRef = useRef<boolean>(false);

  // Keep the `T` Proxy in sync BEFORE the first paint.
  setTokens(TOKENS[theme]);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved === 'light' || saved === 'dark') {
          userPrefRef.current = true;
          setIsUserPref(true);
          setThemeState(saved);
        }
      } catch {/* ignore */}
    })();

    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      // System theme changes only auto-apply if the user hasn't pinned a choice.
      if (!userPrefRef.current) {
        setThemeState((colorScheme as ThemeName) || 'dark');
      }
    });
    return () => { try { sub.remove(); } catch {/* ignore */} };
  }, []);

  // Bridge: whenever `theme` changes, refresh the Proxy target so `T.*` reads
  // return the new palette. `key={theme}` on the bridge View forces a remount
  // of the subtree — that's what makes every `StyleSheet.create({...})`
  // re-evaluate and pick up the new colours.
  useEffect(() => {
    setTokens(TOKENS[theme]);
  }, [theme]);

  const setTheme = useCallback(async (next: ThemeName) => {
    userPrefRef.current = true;
    setIsUserPref(true);
    setThemeState(next);
    try { await AsyncStorage.setItem(STORAGE_KEY, next); } catch {/* ignore */}
  }, []);

  const toggleTheme = useCallback(async () => {
    await setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value = useMemo<Ctx>(() => ({
    theme,
    tokens: TOKENS[theme],
    setTheme,
    toggleTheme,
    isUserPref,
  }), [theme, setTheme, toggleTheme, isUserPref]);

  // On web, palette changes reach every already-compiled stylesheet
  // instantly via CSS variables (see `theme.ts`). On native, where
  // module-level StyleSheets captured the *initial* palette, we force
  // a remount of the subtree on theme change so freshly-created
  // stylesheets pick up the new colours. `key={theme}` is the lever.
  return (
    <ThemeContext.Provider value={value}>
      {Platform.OS === 'web' ? (
        // Web path — no remount, CSS vars do the work, zero flicker.
        <View style={{ flex: 1 }}>{children}</View>
      ) : (
        // Native path — remount on theme change.
        <View key={theme} style={{ flex: 1, backgroundColor: TOKENS[theme].bg }}>
          {children}
        </View>
      )}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Ctx {
  return useContext(ThemeContext);
}

export { TOKENS } from './theme-tokens';
export type { Palette, ThemeName } from './theme-tokens';
