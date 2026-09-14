"use client";

/**
 * The one orchestrated moment on a data screen: a figure counts up from
 * its previous value over 500 ms when it first appears and when the period
 * changes. Every other change is a plain state change. With reduced motion
 * the final value renders immediately (design-system/motion.md).
 */

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

export function CountUp({ value, format, delay = 0, className }: { value: number; format: (value: number) => string; delay?: number; className?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    if (reduced) {
      previous.current = value;
      return;
    }
    const from = previous.current;
    const controls = animate(from, value, {
      duration: 0.5,
      delay: delay / 1000,
      ease: [0.2, 0, 0, 1],
      onUpdate: (latest) => setShown(latest),
      onComplete: () => setShown(value),
    });
    previous.current = value;
    return () => controls.stop();
  }, [value, delay, reduced]);

  // With reduced motion the final value renders immediately, from render — no effect, no tick.
  return (
    <span className={className} aria-label={format(value)}>
      {format(reduced ? value : shown)}
    </span>
  );
}
