/**
 * Motion tokens. design-system/motion.md.
 *
 * Durations live here in seconds because Motion for React takes seconds, while
 * the CSS custom properties in globals.css are in milliseconds. Two units, one
 * set of numbers — change both or neither.
 */

export const DURATION = {
  micro: 0.12,
  standard: 0.2,
  entrance: 0.32,
  hero: 0.56,
} as const;

/**
 * The POS ceiling. design-system/motion.md.
 *
 * A cashier taps roughly 200 times an hour. At 300ms per transition that is a
 * minute per shift spent watching the interface catch up, during a rush, with
 * a queue. Nothing under /app/pos or /app/kitchen exceeds this.
 */
export const POS_MAX_DURATION = DURATION.micro;

export const EASE = {
  standard: [0.2, 0, 0, 1],
  decelerate: [0, 0, 0, 1],
  accelerate: [0.3, 0, 1, 1],
} as const;

/** For things a finger should feel: add-to-cart, drawer drag, steppers. */
export const SPRING = { type: "spring", stiffness: 420, damping: 32 } as const;

/** Exits run at 70% of the entrance, so dismissal never feels sticky. */
export const exitDuration = (enter: number) => enter * 0.7;
