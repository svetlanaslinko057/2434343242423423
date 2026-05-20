/**
 * Typography — platform invariant.
 *
 * Same families, same sizes, same line-heights in both themes. Light only
 * adjusts anti-aliasing for the "paid product" feel; structure unchanged.
 */

export const fontFamily = {
  display: "'Space Grotesk', 'IBM Plex Sans', sans-serif",
  body:    "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  mono:    "'IBM Plex Mono', 'JetBrains Mono', monospace",
} as const;

export const fontSize = {
  tiny:  11,
  small: 13,
  body:  15,
  h3:    18,
  h2:    22,
  h1:    28,
  display: 40,  // landing / hero only
} as const;

export const lineHeight = {
  tight: 1.2,
  body:  1.5,
  read:  1.6,  // long-form text
  ui:    1.4,
} as const;

export const fontWeight = {
  regular:  '400',
  medium:   '500',
  semibold: '600',
  bold:     '700',
} as const;

export const letterSpacing = {
  display: '-0.02em',
  heading: '-0.01em',
  body:    '0',
  kicker:  '0.1em',  // ALL-CAPS labels
} as const;
