/**
 * Mobile theme tokens — Phase 1 bridge to canonical design-system palette.
 *
 * What changed (Phase 1, May-2026):
 *   - Color values now come from `/app/packages/design-system/tokens/palette.ts`
 *     (graphite + sage master system).
 *   - PUBLIC SHAPE is unchanged: the `Palette` type, the `TOKENS` export,
 *     the set of keys — all preserved. 93 files importing `T` keep working.
 *   - Legacy aliases (`risk = warning`, `trust = signal`, `role = warning`)
 *     point at canonical tokens.
 *   - Mint / neon-mint / amber-warning / cool-red literals are GONE. Now:
 *       signal  = sage (#8C9B90 dark / #4A6B5C light) — operational gravity
 *       success = olive-shifted sage (#7E9684 / #3E5F4F) — NOT identical to signal
 *       warning = muted ochre / bronze
 *       danger  = restrained oxide
 *       info    = slate-information
 *
 * What did NOT change:
 *   - Spacing scale (xs=4, sm=8, md=16, lg=20, xl=28, xxl=36)
 *   - Type scale (h1=28 etc.)
 *   - Radius scale (10/14/18)
 *   These are kept stable so 93 screens render at pixel-identical positions.
 *   Cross-platform alignment with web's 4/8/12/16/24 radius scale is a
 *   Phase 3 task.
 *
 * Architectural invariants (locked):
 *   1. signal ≠ success (operational gravity vs status semantic)
 *   2. No mint / emerald / teal / bronze brand literals
 *   3. Status colors are de-saturated, never neon
 *   4. Inverse-ink is theme-aware (graphite-void in dark / paper-white in light)
 */

import { palette as DS_PALETTE } from './design-system/palette';

export type ThemeName = 'dark' | 'light';

type Shadow = {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
};

export type Palette = {
  // ---- Surfaces ----
  bg: string;
  surface: string;
  surface1: string;
  surface2: string;
  surface3: string;
  headerBg: string;
  border: string;
  borderStrong: string;

  // ---- Text ----
  text: string;
  textSecondary: string;
  textMuted: string;

  // ---- Brand / action (signal) ----
  primary: string;
  primaryInk: string;
  primaryAccent: string;
  primaryBg: string;
  primaryBgStrong: string;
  primaryBorder: string;
  primaryBorderStrong: string;
  trust: string;

  // ---- Semantic statuses ----
  success: string;
  successTint: string;
  successBorder: string;
  successBg: string;
  successBgStrong: string;
  successBorderStrong: string;
  warning: string;
  warningTint: string;
  warningBorder: string;
  warningBg: string;
  warningBgStrong: string;
  warningBorderStrong: string;
  risk: string;
  riskTint: string;
  riskBorder: string;
  riskBg: string;
  riskBgStrong: string;
  riskBorderStrong: string;
  danger: string;
  dangerTint: string;
  dangerBorder: string;
  dangerBg: string;
  dangerBgStrong: string;
  dangerBorderStrong: string;
  info: string;
  infoTint: string;
  infoBorder: string;
  infoBg: string;
  infoBgStrong: string;
  infoBorderStrong: string;
  role: string;
  neutralTint: string;
  neutralBorder: string;

  // ---- Fixed ink ----
  white: string;
  black: string;

  // ---- Spacing (unchanged across themes) ----
  xs: number; sm: number; md: number; lg: number; xl: number; xxl: number;

  // ---- Type scale (unchanged) ----
  h1: number; h2: number; h3: number; body: number; small: number; tiny: number;

  // ---- Radius (unchanged) ----
  radius: number; radiusSm: number; radiusLg: number;

  // ---- Elevation (per-theme) ----
  shadowSubtle: Shadow;
  shadowDeep: Shadow;
  glowPrimary: Shadow;
};

const STATIC = {
  xs: 4, sm: 8, md: 16, lg: 20, xl: 28, xxl: 36,
  h1: 28, h2: 22, h3: 18, body: 15, small: 13, tiny: 11,
  radius: 14, radiusSm: 10, radiusLg: 18,
  white: '#FFFFFF',
  black: '#000000',
} as const;

const D = DS_PALETTE.dark;
const L = DS_PALETTE.light;

const DARK_PALETTE: Palette = {
  // Surfaces
  bg:           D.bg,
  surface:      D.surface,
  surface1:     D.surface,
  surface2:     D.surfaceRaised,
  surface3:     D.surfaceRaised,
  headerBg:     'rgba(15,15,17,0.92)',  // bg with 92% opacity
  border:       D.borderDefault,
  borderStrong: D.borderStrong,

  // Text
  text:          D.textPrimary,
  textSecondary: D.textSecondary,
  textMuted:     D.textMuted,

  // Brand / action — SIGNAL (sage)
  primary:             D.signal,
  primaryInk:          D.signalInk,
  primaryAccent:       D.signal,
  primaryBg:           D.signalBgSoft,
  primaryBgStrong:     D.signalBgStrong,
  primaryBorder:       D.signalBorder,
  primaryBorderStrong: D.signalBorder,
  trust:               D.signal,

  // Statuses — separate identities (success is olive-shifted, not identical to signal)
  success:             D.success,
  successTint:         D.successBgSoft,
  successBorder:       D.successBorder,
  successBg:           D.successBgSoft,
  successBgStrong:     D.successBgSoft,
  successBorderStrong: D.successBorder,

  warning:             D.warning,
  warningTint:         D.warningBgSoft,
  warningBorder:       D.warningBorder,
  warningBg:           D.warningBgSoft,
  warningBgStrong:     D.warningBgSoft,
  warningBorderStrong: D.warningBorder,

  // risk = warning alias (kept for 93 files; new code should use warning)
  risk:                D.warning,
  riskTint:            D.warningBgSoft,
  riskBorder:          D.warningBorder,
  riskBg:              D.warningBgSoft,
  riskBgStrong:        D.warningBgSoft,
  riskBorderStrong:    D.warningBorder,

  danger:              D.danger,
  dangerTint:          D.dangerBgSoft,
  dangerBorder:        D.dangerBorder,
  dangerBg:            D.dangerBgSoft,
  dangerBgStrong:      D.dangerBgSoft,
  dangerBorderStrong:  D.dangerBorder,

  info:                D.info,
  infoTint:            D.infoBgSoft,
  infoBorder:          D.infoBorder,
  infoBg:              D.infoBgSoft,
  infoBgStrong:        D.infoBgSoft,
  infoBorderStrong:    D.infoBorder,

  role:                D.warning,                 // legacy "role" → warning
  neutralTint:         D.surfaceRaised,
  neutralBorder:       D.borderDefault,

  ...STATIC,

  // Elevation — heavy in dark, light in shadow
  shadowSubtle: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.20, shadowRadius: 12, elevation: 2,
  },
  shadowDeep: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.40, shadowRadius: 24, elevation: 6,
  },
  glowPrimary: {
    shadowColor: D.signal, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 14, elevation: 4,
  },
};

const LIGHT_PALETTE: Palette = {
  // Surfaces — warm operational paper
  bg:           L.bg,
  surface:      L.surface,
  surface1:     L.surface,
  surface2:     L.surfaceRaised,
  surface3:     L.surfaceSunken,
  headerBg:     'rgba(250,248,244,0.92)',  // bg @ 92%
  border:       L.borderDefault,
  borderStrong: L.borderStrong,

  // Text
  text:          L.textPrimary,
  textSecondary: L.textSecondary,
  textMuted:     L.textMuted,

  // Brand / action — deep sage on paper
  primary:             L.signal,
  primaryInk:          L.signalInk,
  primaryAccent:       L.signal,
  primaryBg:           L.signalBgSoft,
  primaryBgStrong:     L.signalBgStrong,
  primaryBorder:       L.signalBorder,
  primaryBorderStrong: L.signalBorder,
  trust:               L.signal,

  // Statuses — readable on paper, never neon
  success:             L.success,
  successTint:         L.successBgSoft,
  successBorder:       L.successBorder,
  successBg:           L.successBgSoft,
  successBgStrong:     L.successBgSoft,
  successBorderStrong: L.successBorder,

  warning:             L.warning,
  warningTint:         L.warningBgSoft,
  warningBorder:       L.warningBorder,
  warningBg:           L.warningBgSoft,
  warningBgStrong:     L.warningBgSoft,
  warningBorderStrong: L.warningBorder,

  risk:                L.warning,
  riskTint:            L.warningBgSoft,
  riskBorder:          L.warningBorder,
  riskBg:              L.warningBgSoft,
  riskBgStrong:        L.warningBgSoft,
  riskBorderStrong:    L.warningBorder,

  danger:              L.danger,
  dangerTint:          L.dangerBgSoft,
  dangerBorder:        L.dangerBorder,
  dangerBg:            L.dangerBgSoft,
  dangerBgStrong:      L.dangerBgSoft,
  dangerBorderStrong:  L.dangerBorder,

  info:                L.info,
  infoTint:            L.infoBgSoft,
  infoBorder:          L.infoBorder,
  infoBg:              L.infoBgSoft,
  infoBgStrong:        L.infoBgSoft,
  infoBorderStrong:    L.infoBorder,

  role:                L.warning,
  neutralTint:         L.surfaceRaised,
  neutralBorder:       L.borderDefault,

  ...STATIC,

  // Elevation — paper-soft shadows
  shadowSubtle: {
    shadowColor: '#1A1714', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  shadowDeep: {
    shadowColor: '#1A1714', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 3,
  },
  glowPrimary: {
    shadowColor: L.signal, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10, shadowRadius: 10, elevation: 2,
  },
};

export const TOKENS: Record<ThemeName, Palette> = {
  dark:  DARK_PALETTE,
  light: LIGHT_PALETTE,
};
