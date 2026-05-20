/**
 * Spacing & Layout — platform invariants.
 *
 * IDENTICAL between dark and light themes. Density does not change with
 * luminance. Padding, margins, gaps, sizes are the same. Only substrate
 * colors shift.
 *
 * 4pt grid. Eight ratchets covers every legitimate spacing decision.
 */

export const space = {
  '0': 0,
  '1': 4,
  '2': 8,
  '3': 12,
  '4': 16,
  '5': 24,
  '6': 32,
  '7': 48,
  '8': 64,
} as const;

/**
 * Radius scale — five ratchets only. No bespoke radii at the page level.
 */
export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

/**
 * Component dimensions — locked anatomy. Same in both themes.
 */
export const sizes = {
  inputHeight: 40,
  buttonHeight: 36,
  buttonHeightLg: 44,
  buttonHeightSm: 28,
  sidebarWidth: 240,
  cardPadding: 16,
  sectionGap: 24,
  listItemPaddingY: 12,
  iconSm: 14,
  iconMd: 18,
  iconLg: 24,
} as const;
