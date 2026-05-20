/**
 * web/src/theme/tokens.js — Phase 1 bridge to canonical design-system palette.
 *
 * Public surface unchanged: `TOKENS.{dark,light}`, `getTokens()`,
 * `resolveInitialTheme()`, `THEME_STORAGE_KEY`. All ~9 pages that import
 * this module continue compiling without edits.
 *
 * Source of truth lives in `/app/packages/design-system/tokens/palette.ts`.
 * The CSS variables in that package (loaded via `web/src/index.css`) are
 * what *actually* paint the screen — this JS surface exists for code paths
 * that can't read CSS variables (recharts strokes, inline canvas, etc.).
 *
 * Notes:
 *   - The local field names here mirror the OLD shape (primary,
 *     primaryAccent, successTint, …). They're translated from the canonical
 *     sage/graphite tokens. `primary` = signal in both themes — meaning
 *     "the operational action color".
 *   - `success` is NOT identical to `primary` — that's the locked
 *     architectural rule. Old code that hung "success" off primary now
 *     reads a distinct olive-shifted value.
 */

import { palette as DS } from '../../../packages/design-system/tokens/palette.js';

const D = DS.dark;
const L = DS.light;

export const TOKENS = {
  dark: {
    // BASE
    bg: D.bg,
    surface: D.surface,
    surfaceSecondary: D.surfaceRaised,
    surfaceElevated: D.surfaceRaised,
    // TEXT
    textPrimary: D.textPrimary,
    textSecondary: D.textSecondary,
    textMuted: D.textMuted,
    // BRAND — signal (operational gravity)
    primary: D.signal,
    primaryHover: D.signalHover,
    primaryActive: D.signalActive,
    primaryInk: D.signalInk,
    primaryAccent: D.signal,
    primaryAccentSoft: D.signalBgSoft,
    // STATUS — separate identities
    success: D.success,
    successTint: D.successBgSoft,
    successBorder: D.successBorder,
    warning: D.warning,
    warningTint: D.warningBgSoft,
    warningBorder: D.warningBorder,
    danger: D.danger,
    dangerTint: D.dangerBgSoft,
    dangerBorder: D.dangerBorder,
    info: D.info,
    infoTint: D.infoBgSoft,
    infoBorder: D.infoBorder,
    // STRUCTURE
    border: D.borderDefault,
    borderStrong: D.borderStrong,
    divider: D.borderSubtle,
    // ELEVATION
    cardBg: D.surface,
    cardHover: D.surfaceRaised,
    shadowCard: D.shadowMd,
    shadowHover: D.shadowLg,
  },
  light: {
    // BASE — warm operational paper
    bg: L.bg,
    surface: L.surface,
    surfaceSecondary: L.surfaceRaised,
    surfaceElevated: L.surface,
    // TEXT — warm ink
    textPrimary: L.textPrimary,
    textSecondary: L.textSecondary,
    textMuted: L.textMuted,
    // BRAND
    primary: L.signal,
    primaryHover: L.signalHover,
    primaryActive: L.signalActive,
    primaryInk: L.signalInk,
    primaryAccent: L.signal,
    primaryAccentSoft: L.signalBgSoft,
    // STATUS
    success: L.success,
    successTint: L.successBgSoft,
    successBorder: L.successBorder,
    warning: L.warning,
    warningTint: L.warningBgSoft,
    warningBorder: L.warningBorder,
    danger: L.danger,
    dangerTint: L.dangerBgSoft,
    dangerBorder: L.dangerBorder,
    info: L.info,
    infoTint: L.infoBgSoft,
    infoBorder: L.infoBorder,
    // STRUCTURE
    border: L.borderDefault,
    borderStrong: L.borderStrong,
    divider: L.borderSubtle,
    // ELEVATION
    cardBg: L.surface,
    cardHover: L.surfaceRaised,
    shadowCard: L.shadowMd,
    shadowHover: L.shadowLg,
  },
};

export function getTokens(theme) {
  return TOKENS[theme === 'light' ? 'light' : 'dark'];
}

// Shared storage key — aligned with mobile bridge so a single user
// preference works across web + mobile when they share a domain.
// Note: actual canonical key is `atlas_theme` (underscore). We keep the
// historical `atlas-theme` here AND read both, writing only the new one.
export const THEME_STORAGE_KEY = 'atlas_theme';
const LEGACY_KEY = 'atlas-theme';

export function readStoredTheme() {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem(LEGACY_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch (_e) { /* ignore */ }
  return null;
}

export function readSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveInitialTheme() {
  // Phase 1 behaviour: user preference (storage) > OS preference > 'dark' fallback.
  // Per architectural review, OS preference is NOW honored at first boot —
  // the previous "ignore prefers-color-scheme" behaviour was inconsistent
  // with the runtime OS listener and surprised users on Light-OS devices.
  return readStoredTheme() || readSystemTheme();
}
