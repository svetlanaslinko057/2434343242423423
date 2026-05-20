/**
 * design-tokens.ts — DEPRECATION SHIM (Phase 1, May-2026).
 *
 * This file used to define "System B" (Cognitive Monochrome / warm parchment /
 * bronze signal), a second parallel design system that lived next to the
 * canonical Linear-mint mobile system. That split was the single biggest
 * source of brand incoherence: visitors landed in parchment+bronze, then
 * after auth fell into mint+graphite — two different products in one binary.
 *
 * Per design review, System B is collapsed into System A. This shim:
 *   1. Maps the old `C` / `CL` palette keys to canonical sage/graphite values
 *      from `/app/packages/design-system/tokens/palette.ts`.
 *   2. Replaces `usePalette()` with a real hook that reads from
 *      `theme-context.tsx` (the same engine the rest of the app uses).
 *      It NO LONGER calls `useColorScheme()` directly — that bypass was the
 *      reason the landing page ignored user theme overrides.
 *   3. Preserves the `Palette` shape so the 3 remaining consumers
 *      (`app/index.tsx`, `src/gravity-cta.tsx`) keep compiling without edit.
 *
 * To preserve the editorial "warmth" of the landing surface, the LIGHT theme
 * itself IS warm operational paper (#FAF8F4 bg, deep sage signal). The dark
 * theme is graphite + sage. So the landing page automatically inherits the
 * correct atmosphere from the global theme — no separate aesthetic needed.
 *
 * Phase 3 removal: rewrite `app/index.tsx` and `gravity-cta.tsx` to use `T`
 * directly, then delete this file.
 */

import { palette as DS_PALETTE, type ThemeName } from './design-system/palette';
import { useTheme } from './theme-context';

export type Palette = {
  void: string;
  substrate: string;
  operational: string;
  focus: string;
  modal: string;
  borderSubtle: string;
  borderContrast: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  signal: string;
  signalHover: string;
  signalPressed: string;
  signalOn: string;
  signalBgSub: string;
  signalBorder: string;
};

function paletteFor(theme: ThemeName): Palette {
  const p = theme === 'light' ? DS_PALETTE.light : DS_PALETTE.dark;
  return {
    // Atmospheric depth — re-derived from canonical surfaces.
    void:        p.bg,
    substrate:   p.bg,
    operational: p.surface,
    focus:       p.surfaceRaised,
    modal:       p.surfaceRaised,

    borderSubtle:   p.borderSubtle,
    borderContrast: p.borderStrong,

    textPrimary:   p.textPrimary,
    textSecondary: p.textSecondary,
    textTertiary:  p.textMuted,

    // Signal — the canonical sage (operational gravity).
    signal:        p.signal,
    signalHover:   p.signalHover,
    signalPressed: p.signalActive,
    signalOn:      p.signalInk,
    signalBgSub:   p.signalBgSoft,
    signalBorder:  p.signalBorder,
  };
}

/** Dark palette — frozen export, kept for any non-hook consumer. */
export const C: Palette = paletteFor('dark');

/** Light palette — frozen export, kept for any non-hook consumer. */
export const CL: Palette = paletteFor('light');

/**
 * Reads from the global ThemeProvider (the same one used by the rest of
 * the app). Returns canonical sage/graphite palette for the active theme.
 *
 * Previously: read `useColorScheme()` directly, bypassing user theme
 * preference. That bug is fixed here.
 */
export function usePalette(): Palette {
  const { theme } = useTheme();
  return theme === 'light' ? CL : C;
}

/** Typography families — unchanged from System B (still valid). */
export const F = {
  sans:       'InstrumentSans_400Regular',
  sansMedium: 'InstrumentSans_500Medium',
  mono:       'JetBrainsMono_500Medium',
} as const;
