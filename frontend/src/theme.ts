/**
 * Theme bridge — legacy `T` surface, now backed by a LIVE palette that
 * actually flips at runtime.
 *
 * Design problem we're solving
 * ============================
 * 80+ files do `import T from './theme'` and then
 *   `const s = StyleSheet.create({ root: { backgroundColor: T.bg } })`
 * at module-load time. `StyleSheet.create({...})` is evaluated exactly
 * once per module, so a naive "palette swap" (mutating a shared object)
 * does nothing — the already-compiled stylesheet keeps pointing at the
 * old colour.
 *
 * Solution
 * ========
 * On Web (react-native-web → DOM): the colour keys of `T` return CSS
 * variable strings (`var(--t-bg)`, `var(--t-text)`, …). Those strings are
 * captured by `StyleSheet.create` once and *stay* captured — but because
 * they're CSS variables, flipping the variable at the `<html>` level
 * updates every computed style instantly, with no remount. That's the
 * same mechanism the Web platform uses in `/app/web/src/index.css`.
 *
 * On Native: CSS variables don't exist. Colour keys return the actual
 * palette value; switching theme writes the new palette into `CURRENT`
 * and flips a `generation` counter. Consumers who want live updates can
 * read the generation via `useThemeGeneration()` (from `theme-context`)
 * and memoise their styles against it.
 *
 * Non-colour tokens (spacing, radii, type scale, shadow objects) are
 * palette-invariant (or close enough) and are always returned from the
 * active palette directly.
 *
 * The shape of `T` is unchanged, so every existing consumer keeps
 * working without edits.
 */
import { Platform, StyleSheet } from 'react-native';
import { TOKENS, type Palette } from './theme-tokens';

const IS_WEB = Platform.OS === 'web';

// Active palette. Swapped at runtime by `setTokens()`.
let CURRENT: Palette = TOKENS.dark;

/**
 * Incremented on every palette swap. On native, UI code that wants live
 * theme updates can read this (via `useThemeGeneration()` from the
 * context) and recompute memoised styles.
 */
let GENERATION = 0;
const listeners = new Set<(gen: number) => void>();

export function subscribeThemeGeneration(fn: (gen: number) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getThemeGeneration(): number {
  return GENERATION;
}

/**
 * CSS variable names — mirrored 1:1 with palette keys. We keep the list
 * explicit rather than auto-derived so it's trivial to audit which keys
 * are theme-reactive on Web. Everything not listed falls back to the
 * live palette value.
 */
const WEB_VAR: Partial<Record<keyof Palette, string>> = {
  bg: 'var(--t-bg)',
  surface: 'var(--t-surface)',
  surface1: 'var(--t-surface)',
  surface2: 'var(--t-surface2)',
  surface3: 'var(--t-surface3)',
  headerBg: 'var(--t-header-bg)',
  border: 'var(--t-border)',
  borderStrong: 'var(--t-border-strong)',

  text: 'var(--t-text)',
  textSecondary: 'var(--t-text-secondary)',
  textMuted: 'var(--t-text-muted)',

  primary: 'var(--t-primary)',
  primaryInk: 'var(--t-primary-ink)',
  primaryAccent: 'var(--t-primary-accent)',
  primaryBg: 'var(--t-primary-bg)',
  primaryBgStrong: 'var(--t-primary-bg-strong)',
  primaryBorder: 'var(--t-primary-border)',
  primaryBorderStrong: 'var(--t-primary-border-strong)',
  trust: 'var(--t-primary)',

  success: 'var(--t-success)',
  successTint: 'var(--t-success-tint)',
  successBorder: 'var(--t-success-border)',
  successBg: 'var(--t-success-bg)',
  successBgStrong: 'var(--t-success-bg-strong)',
  successBorderStrong: 'var(--t-success-border-strong)',
  warning: 'var(--t-warning)',
  warningTint: 'var(--t-warning-tint)',
  warningBorder: 'var(--t-warning-border)',
  warningBg: 'var(--t-warning-bg)',
  warningBgStrong: 'var(--t-warning-bg-strong)',
  warningBorderStrong: 'var(--t-warning-border-strong)',
  risk: 'var(--t-warning)',
  riskTint: 'var(--t-warning-tint)',
  riskBorder: 'var(--t-warning-border)',
  riskBg: 'var(--t-warning-bg)',
  riskBgStrong: 'var(--t-warning-bg-strong)',
  riskBorderStrong: 'var(--t-warning-border-strong)',
  danger: 'var(--t-danger)',
  dangerTint: 'var(--t-danger-tint)',
  dangerBorder: 'var(--t-danger-border)',
  dangerBg: 'var(--t-danger-bg)',
  dangerBgStrong: 'var(--t-danger-bg-strong)',
  dangerBorderStrong: 'var(--t-danger-border-strong)',
  info: 'var(--t-info)',
  infoTint: 'var(--t-info-tint)',
  infoBorder: 'var(--t-info-border)',
  infoBg: 'var(--t-info-bg)',
  infoBgStrong: 'var(--t-info-bg-strong)',
  infoBorderStrong: 'var(--t-info-border-strong)',
  role: 'var(--t-role)',
  neutralTint: 'var(--t-neutral-tint)',
  neutralBorder: 'var(--t-neutral-border)',
};

/**
 * Inject the actual hex/rgba values for both palettes into `<style>` so
 * the CSS variables declared above resolve at document level. Called
 * once from the ThemeProvider on web.
 */
export function ensureWebThemeStylesheet(): void {
  if (!IS_WEB || typeof document === 'undefined') return;
  if (document.getElementById('atlas-theme-vars')) return;

  const toRule = (selector: string, palette: Palette) => {
    const map: Record<string, string> = {
      '--t-bg': palette.bg,
      '--t-surface': palette.surface,
      '--t-surface2': palette.surface2,
      '--t-surface3': palette.surface3,
      '--t-header-bg': palette.headerBg,
      '--t-border': palette.border,
      '--t-border-strong': palette.borderStrong,
      '--t-text': palette.text,
      '--t-text-secondary': palette.textSecondary,
      '--t-text-muted': palette.textMuted,
      '--t-primary': palette.primary,
      '--t-primary-ink': palette.primaryInk,
      '--t-primary-accent': palette.primaryAccent,
      '--t-primary-bg': palette.primaryBg,
      '--t-primary-bg-strong': palette.primaryBgStrong,
      '--t-primary-border': palette.primaryBorder,
      '--t-primary-border-strong': palette.primaryBorderStrong,
      '--t-success': palette.success,
      '--t-success-tint': palette.successTint,
      '--t-success-border': palette.successBorder,
      '--t-success-bg': palette.successBg,
      '--t-success-bg-strong': palette.successBgStrong,
      '--t-success-border-strong': palette.successBorderStrong,
      '--t-warning': palette.warning,
      '--t-warning-tint': palette.warningTint,
      '--t-warning-border': palette.warningBorder,
      '--t-warning-bg': palette.warningBg,
      '--t-warning-bg-strong': palette.warningBgStrong,
      '--t-warning-border-strong': palette.warningBorderStrong,
      '--t-danger': palette.danger,
      '--t-danger-tint': palette.dangerTint,
      '--t-danger-border': palette.dangerBorder,
      '--t-danger-bg': palette.dangerBg,
      '--t-danger-bg-strong': palette.dangerBgStrong,
      '--t-danger-border-strong': palette.dangerBorderStrong,
      '--t-info': palette.info,
      '--t-info-tint': palette.infoTint,
      '--t-info-border': palette.infoBorder,
      '--t-info-bg': palette.infoBg,
      '--t-info-bg-strong': palette.infoBgStrong,
      '--t-info-border-strong': palette.infoBorderStrong,
      '--t-role': palette.role,
      '--t-neutral-tint': palette.neutralTint,
      '--t-neutral-border': palette.neutralBorder,
    };
    const body = Object.entries(map).map(([k, v]) => `  ${k}: ${v};`).join('\n');
    return `${selector} {\n${body}\n}`;
  };

  const css = [
    toRule(':root, .theme-dark', TOKENS.dark),
    toRule('.theme-light', TOKENS.light),
    // Make the document surface obey the theme too — so scroll areas and
    // the html/body background flip along with in-app surfaces.
    `html, body { background-color: var(--t-bg); color: var(--t-text); }`,
  ].join('\n\n');

  const el = document.createElement('style');
  el.id = 'atlas-theme-vars';
  el.textContent = css;
  document.head.appendChild(el);
}

/**
 * Flip the active palette. Called by ThemeProvider on every theme change.
 * On Web, also toggles the `<html>` class so CSS variables pick up the
 * new values immediately across the entire document.
 */
export function setTokens(next: Palette): void {
  CURRENT = next;
  GENERATION += 1;

  if (IS_WEB && typeof document !== 'undefined') {
    ensureWebThemeStylesheet();
    const root = document.documentElement;
    const isLight = next === TOKENS.light;
    root.classList.toggle('theme-light', isLight);
    root.classList.toggle('theme-dark', !isLight);
  }

  for (const l of listeners) {
    try { l(GENERATION); } catch {/* ignore */}
  }
}

export function getTokens(): Palette {
  return CURRENT;
}

/**
 * `T` — drop-in replacement for the old frozen dark-only constants.
 *
 *   - On web, palette-dependent colour keys return `var(--t-*)` so the
 *     stylesheet compiled at import-time stays valid forever.
 *   - On native, they return the live palette value (respects the
 *     initial palette for module-level stylesheets; live updates are
 *     available via `useThemeGeneration()`).
 *   - Spacing / radii / type / shadow / fixed-ink keys always resolve
 *     from `CURRENT` so dark+light can diverge where it makes sense
 *     (shadows, for example, are softer in light theme).
 */
export const T = new Proxy({} as Palette, {
  get(_target, key: string) {
    if (IS_WEB && (key in WEB_VAR)) {
      return (WEB_VAR as any)[key];
    }
    return (CURRENT as any)[key];
  },
  has(_t, key) { return key in CURRENT; },
  ownKeys() { return Reflect.ownKeys(CURRENT); },
  getOwnPropertyDescriptor(_t, key) {
    return Object.getOwnPropertyDescriptor(CURRENT, key);
  },
}) as Palette;

export default T;

/**
 * Canonical typography helpers. On web these reference CSS variables, so
 * they live-update with the theme just like everything else.
 */
export const typo = StyleSheet.create({
  title: { color: T.text, fontSize: 22, fontWeight: '700' },
  section: { color: T.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  body: { color: T.text, fontSize: 15 },
  secondary: { color: T.textSecondary, fontSize: 15 },
  caption: { color: T.textSecondary, fontSize: 13 },
  muted: { color: T.textMuted, fontSize: 13 },
});
