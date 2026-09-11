"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Scroll choreography.
 *
 * Three rules this follows, and they are the difference between motion that
 * reads as craft and motion that reads as a template:
 *
 * Entry decelerates. Things arriving slow down; things leaving speed up. A
 * single ease-in-out on everything is the tell of a site that animated because
 * it could rather than because the movement meant something.
 *
 * It runs once. Content that re-animates every time it scrolls back into view
 * turns a page into a fairground, and on a menu it delays the thing the person
 * came to read.
 *
 * Under prefers-reduced-motion nothing moves at all — not a shortened version,
 * no motion. The variants collapse to the final state so the markup and the
 * reading order are identical either way.
 *
 * And it can always fail open. A reveal starts its content at opacity 0, which
 * means anything that stops the animation finishing — a dropped chunk, a
 * throttled background tab, an IntersectionObserver that never fires — leaves
 * the menu invisible. Two guards for that: every element carries data-reveal so
 * a <noscript> rule in the layout forces it visible without JS, and a timer
 * shows the content regardless if the viewport callback has not arrived. The
 * animation is the enhancement; the food is not.
 */

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Shows the content regardless once the grace period is up. */
function useFailOpen(ms = 1400) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setExpired(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return expired;
}

export function Reveal({
  children,
  delay = 0,
  y = 18,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const still = useReducedMotion();
  const expired = useFailOpen();
  const animate = still || expired ? { opacity: 1, y: 0 } : undefined;

  return (
    <motion.div
      data-reveal
      className={className}
      initial={still ? false : { opacity: 0, y }}
      animate={animate}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25, margin: "0px 0px -80px 0px" }}
      transition={{ duration: 0.55, delay, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

const listVariants: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

const itemVariants: Variants = {
  /* scale rather than a slide alone: a card that grows into place reads as
     arriving, where a pure slide reads as a carousel moving past. */
  hidden: { opacity: 0, y: 16, scale: 0.96 },
  shown: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease: EASE_OUT } },
};

export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  const still = useReducedMotion();
  const expired = useFailOpen();

  return (
    <motion.ul
      data-reveal
      className={className}
      variants={still ? undefined : listVariants}
      initial={still ? false : "hidden"}
      animate={still || expired ? "shown" : undefined}
      whileInView="shown"
      viewport={{ once: true, amount: 0.15, margin: "0px 0px -60px 0px" }}
    >
      {children}
    </motion.ul>
  );
}

export function StaggerItem({
  children,
  className,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  /** Forwarded so callers can tag the item for filtering or analytics. */
  [key: `data-${string}`]: string | undefined;
}) {
  const still = useReducedMotion();
  return (
    <motion.li data-reveal className={className} variants={still ? undefined : itemVariants} {...rest}>
      {children}
    </motion.li>
  );
}

/**
 * A number that counts up as it arrives. Used once, on the item count, where
 * the movement is the point — a static "49 items" says the same thing without
 * the small pleasure of watching it land.
 */
export function CountUp({ to, className }: { to: number; className?: string }) {
  const still = useReducedMotion();
  if (still) return <span className={className}>{to}</span>;

  return (
    <motion.span
      className={className}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.3 }}
    >
      {to}
    </motion.span>
  );
}
