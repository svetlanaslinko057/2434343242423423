/**
 * Motion — platform invariant.
 *
 * Identical timing in dark and light. Interaction physics do not change
 * with luminance.
 */

export const duration = {
  instant: '80ms',
  fast:    '120ms',
  normal:  '150ms',
  slow:    '200ms',
  deliberate: '320ms', // page transitions, modal enter/exit
} as const;

export const easing = {
  standard: 'cubic-bezier(0.16, 1, 0.3, 1)',     // operational — quick out, soft settle
  enter:    'cubic-bezier(0, 0, 0.2, 1)',
  exit:     'cubic-bezier(0.4, 0, 1, 1)',
  linear:   'linear',
} as const;
