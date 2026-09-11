"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/**
 * The count in the header's cart button.
 *
 * The number rolls over and the button gives a short pulse when the count goes
 * up. It is a small thing, and it is the only confirmation a customer gets in
 * the header that the thing they just tapped worked — the toast covers the
 * moment, this covers the glance a second later.
 *
 * It pulses on increase only. Removing an item is not a moment to celebrate,
 * and animating both directions makes the motion meaningless.
 *
 * The count itself comes from the server on every render, so this never holds
 * its own idea of what is in the cart; it only animates the change.
 */
export function CartBadge({ count }: { count: number }) {
  const reduced = useReducedMotion();
  const previous = useRef(count);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    if (count > previous.current) setBump((n) => n + 1);
    previous.current = count;
  }, [count]);

  if (reduced) {
    return <span className="tabular">{count}</span>;
  }

  return (
    <motion.span
      key={bump}
      // A short spring rather than a duration: the overshoot is what reads as
      // physical, and it settles fast enough not to delay the next tap.
      animate={bump === 0 ? undefined : { scale: [1, 1.28, 1] }}
      transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1], times: [0, 0.4, 1] }}
      className="relative inline-flex tabular"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={count}
          initial={{ y: "-70%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={{ y: "70%", opacity: 0, position: "absolute" }}
          transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
        >
          {count}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}
