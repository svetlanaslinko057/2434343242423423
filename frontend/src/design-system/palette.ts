/**
 * palette.ts — TypeScript-typed re-export of the canonical palette.
 *
 * The actual values live in `./palette.js` so that web (CRA / webpack
 * without TS loader for arbitrary paths) and mobile (Expo / Metro)
 * both import from the same source. This file only adds types.
 *
 * To change a value: edit `palette.js`. This file inherits automatically.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { palette: P, getPalette: G } = require('./palette.js');

export type ThemeName = 'dark' | 'light';

export interface Palette {
  // SUBSTRATE
  bg: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  // BORDER
  borderSubtle: string;
  borderDefault: string;
  borderStrong: string;
  // TEXT
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  // SIGNAL
  signal: string;
  signalHover: string;
  signalActive: string;
  signalInk: string;
  signalBgSoft: string;
  signalBgStrong: string;
  signalBorder: string;
  // STATUS
  success: string;
  successInk: string;
  successBgSoft: string;
  successBorder: string;
  warning: string;
  warningInk: string;
  warningBgSoft: string;
  warningBorder: string;
  danger: string;
  dangerInk: string;
  dangerBgSoft: string;
  dangerBorder: string;
  info: string;
  infoInk: string;
  infoBgSoft: string;
  infoBorder: string;
  // ELEVATION
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
}

export const palette: { dark: Palette; light: Palette } = P;
export const getPalette: (theme: ThemeName) => Palette = G;
