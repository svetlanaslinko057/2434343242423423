/**
 * L0 Motion tokens — single source of truth for every animation duration.
 *
 * Rule: animation is not decoration, it's confirmation. If you can't name the
 * user action that triggers it, don't add it.
 */
export const motion = {
  fast: 140,     // press feedback
  normal: 220,   // enter / fade-slide (faster = snappier)
  slow: 340,     // progress bar fill, stagger reveals

  scalePressIn: 0.98,
  scalePressOut: 1,

  // Stagger step between sibling items (FadeSlideIn delay = i * staggerStep)
  staggerStep: 45,
};

export default motion;
