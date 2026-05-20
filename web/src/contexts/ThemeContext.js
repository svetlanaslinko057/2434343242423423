import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { getTokens, resolveInitialTheme, THEME_STORAGE_KEY } from '@/theme/tokens';

/**
 * ThemeContext v2 — proper light/dark switcher.
 *
 *   • default      → system preference (`prefers-color-scheme`)
 *   • override     → user choice (Light / Dark toggle)
 *   • persisted in → localStorage (atlas-theme)
 *   • applied via  → `<html data-theme="...">` + class toggle
 *
 * All UI code should consume `useTheme()` rather than checking
 * media-queries directly. Old `setLightTheme` / `setDarkTheme` /
 * `toggleTheme` aliases are preserved for components that haven't
 * migrated yet.
 */
const ThemeContext = createContext({
  theme: 'dark',
  tokens: getTokens('dark'),
  setTheme: () => {},
  toggleTheme: () => {},
  setLightTheme: () => {},
  setDarkTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

const apply = (theme) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  // Strip every legacy theme alias before applying the new one, otherwise
  // an old `theme-light` class can still match `.theme-light, .light, [data-theme="light"]`
  // in palette.css and beat the freshly-set [data-theme="dark"] selector
  // (same specificity, light rule comes later in source order).
  root.classList.remove('light', 'dark', 'theme-light', 'theme-dark');
  root.classList.add(theme);
  root.classList.add(`theme-${theme}`);
  root.dataset.theme = theme;
  // Mirror as colour-scheme so native form controls / scrollbars match.
  root.style.colorScheme = theme;
};

export const ThemeProvider = ({ children }) => {
  const [theme, setThemeState] = useState(() => resolveInitialTheme());

  useEffect(() => {
    apply(theme);
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (_e) { /* ignore */ }
  }, [theme]);

  // Follow system theme if user hasn't explicitly chosen yet.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = (e) => {
      try {
        if (localStorage.getItem(THEME_STORAGE_KEY)) return; // user override wins
      } catch (_e) { /* ignore */ }
      setThemeState(e.matches ? 'light' : 'dark');
    };
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  const setTheme = useCallback((t) => {
    if (t === 'light' || t === 'dark') setThemeState(t);
  }, []);
  const toggleTheme = useCallback(() => {
    setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(() => ({
    theme,
    tokens: getTokens(theme),
    setTheme,
    toggleTheme,
    setLightTheme: () => setTheme('light'),
    setDarkTheme: () => setTheme('dark'),
  }), [theme, setTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export default ThemeProvider;
