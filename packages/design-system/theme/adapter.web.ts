/**
 * Web adapter — DOM + localStorage implementation for ThemeEngine.
 *
 * Apply contract:
 *   1. Set `<html class="theme-dark|theme-light">` AND `<html class="dark|light">`
 *      (both selectors are used in palette.css — bridge legacy code).
 *   2. Set `<html data-theme="...">` for `[data-theme]` selectors.
 *   3. Set CSS `color-scheme` so native form controls / scrollbars match.
 *
 * Storage: `localStorage[STORAGE_KEY]`.
 *
 * System detection: `window.matchMedia('(prefers-color-scheme: dark)')`.
 */

import type { ThemeStorage, ThemeApply, ThemeName } from './ThemeEngine';
import { STORAGE_KEY } from './ThemeEngine';

export const webStorage: ThemeStorage = {
  async read() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === 'dark' || v === 'light' ? v : null;
    } catch { return null; }
  },
  async write(t) { try { localStorage.setItem(STORAGE_KEY, t); } catch {/* ignore */} },
  async clear()  { try { localStorage.removeItem(STORAGE_KEY); }  catch {/* ignore */} },
};

export const webApply: ThemeApply = {
  apply(t) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    // Drop all theme selectors then re-apply the active one. Cover all
    // historical class names so legacy code that targets `.dark` / `.light`
    // keeps working.
    root.classList.remove('theme-dark', 'theme-light', 'dark', 'light');
    root.classList.add(`theme-${t}`, t);
    root.dataset.theme = t;
    root.style.colorScheme = t;
  },
  readSystem() {
    if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  },
  onSystemChange(cb) {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => cb(e.matches ? 'dark' : 'light');
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  },
};
