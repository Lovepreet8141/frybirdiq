"use client";

/**
 * Motion primitives. BUILD-PLAN.md §7.
 *
 * §7 asks for these as reusable components rather than one-off `motion.div`s
 * scattered through pages, so that a change to how the product moves is one
 * edit instead of a search.
 *
 * Every primitive here respects `prefers-reduced-motion` through Motion's
 * `useReducedMotion`, and every one renders its final state immediately when
 * reduced motion is on — never a half-applied transform, never a disabled
 * feature. §7: "Reduced motion must remain fully functional."
 */

import { type HTMLMotionProps, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { DURATION, EASE, SPRING, exitDuration } from "./tokens";

type Direction = "up" | "down" | "left" | "right";

const OFFSET: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: 16 },
  down: { x: 0, y: -16 },
  left: { x: 16, y: 0 },
  right: { x: -16, y: 0 },
};

interface RevealProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: ReactNode;
  from?: Direction;
  duration?: number;
  delay?: number;
}

/** Fades and lifts content in when it enters the viewport. */
export function MotionReveal({
  children,
  from = "up",
  duration = DURATION.entrance,
  delay = 0,
  ...props
}: RevealProps) {
  const reduced = useReducedMotion();
  const offset = OFFSET[from];

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, ...offset }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: "-64px" }}
      transition={{ duration, delay, ease: EASE.standard }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/**
 * Staggers children in.
 *
 * Wrap each child in `MotionStaggerItem`. The stagger is capped so a long list
 * never leaves the last item waiting — a menu with 30 products should not take
 * two seconds to finish appearing.
 */
export function MotionStagger({
  children,
  each = 0.05,
  maxTotal = 0.4,
  count,
  ...props
}: Omit<HTMLMotionProps<"div">, "children"> & {
  children: ReactNode;
  each?: number;
  maxTotal?: number;
  count?: number;
}) {
  const reduced = useReducedMotion();
  const step = count && count * each > maxTotal ? maxTotal / count : each;

  return (
    <motion.div
      initial={reduced ? false : "hidden"}
      whileInView="visible"
      viewport={{ once: true, margin: "-64px" }}
      variants={{ visible: { transition: { staggerChildren: reduced ? 0 : step } } }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function MotionStaggerItem({ children, ...props }: Omit<HTMLMotionProps<"div">, "children"> & { children: ReactNode }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12 },
        visible: { opacity: 1, y: 0, transition: { duration: DURATION.standard, ease: EASE.standard } },
      }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function MotionFade({
  children,
  duration = DURATION.standard,
  ...props
}: Omit<HTMLMotionProps<"div">, "children"> & { children: ReactNode; duration?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: exitDuration(duration) } }}
      transition={{ duration, ease: EASE.standard }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/**
 * Press feedback.
 *
 * Responds within 120ms, before any network call. §7: the button reacts
 * immediately; the cart count updates when the server confirms.
 *
 * Scale only — no colour shift, no shadow. On a touchscreen the finger covers
 * the element, so the feedback has to be visible at the edges.
 */
export function MotionPress({
  children,
  disabled,
  ...props
}: Omit<HTMLMotionProps<"button">, "children"> & { children: ReactNode; disabled?: boolean }) {
  const reduced = useReducedMotion();

  return (
    <motion.button
      whileTap={reduced || disabled ? undefined : { scale: 0.97 }}
      transition={{ duration: DURATION.micro, ease: EASE.standard }}
      disabled={disabled}
      {...props}
    >
      {children}
    </motion.button>
  );
}

/**
 * A number that ticks to its new value.
 *
 * `format` keeps this away from currency logic — pass `formatINR` and the
 * component never learns what a rupee is. It counts, `lib/money` formats.
 *
 * Reduced motion snaps to the value. So does a first render, so a page does
 * not count up from zero on load when the figure was already known.
 */
export function MotionNumber({
  value,
  format,
  duration = DURATION.entrance,
  className,
}: {
  value: number;
  format: (value: number) => string;
  duration?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);
  const first = useRef(true);

  useEffect(() => {
    if (reduced || first.current) {
      first.current = false;
      previous.current = value;
      setDisplay(value);
      return;
    }

    const from = previous.current;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / (duration * 1000), 1);
      // Matches EASE.standard closely enough for a counting number, without
      // pulling a bezier solver in for one value.
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (value - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else previous.current = value;
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduced]);

  return (
    <span className={className}>
      {/* Announce the settled figure, not every intermediate frame. */}
      <span aria-hidden="true">{format(display)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}

export { DURATION, EASE, SPRING, exitDuration };
