/**
 * Native (Expo) adapter — AsyncStorage + Appearance implementation.
 *
 * Apply contract on native is a no-op: stylesheets compiled by RN at
 * module-load time can't re-bind colors. The actual "apply" happens at
 * the consumer side — `frontend/src/theme.ts` swaps its Proxy target,
 * and React subtree remounts via `key={theme}` on the provider.
 *
 * This adapter exists so ThemeEngine has a uniform interface; the
 * consumer subscribes to engine changes and triggers its own re-paint.
 */

import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ThemeStorage, ThemeApply, ThemeName } from './ThemeEngine';
import { STORAGE_KEY } from './ThemeEngine';

export const nativeStorage: ThemeStorage = {
  async read() {
    try {
      const v = await AsyncStorage.getItem(STORAGE_KEY);
      return v === 'dark' || v === 'light' ? v : null;
    } catch { return null; }
  },
  async write(t) { try { await AsyncStorage.setItem(STORAGE_KEY, t); } catch {/* ignore */} },
  async clear()  { try { await AsyncStorage.removeItem(STORAGE_KEY); }  catch {/* ignore */} },
};

export const nativeApply: ThemeApply = {
  apply(_t) { /* no-op — caller wraps subtree with `key={theme}` */ },
  readSystem() {
    const cs = Appearance.getColorScheme();
    return cs === 'light' ? 'light' : 'dark';
  },
  onSystemChange(cb) {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      cb((colorScheme as ThemeName) || 'dark');
    });
    return () => { try { sub.remove(); } catch {/* ignore */} };
  },
};
