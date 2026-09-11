"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Fixed shell and entrance for the bottom order bar. Split from
 * `OrderNowBar` because the animation needs the client and the cart total
 * does not — the server component stays a server component.
 */
export function OrderNowBarMotion({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      initial={reduced ? false : { y: "100%" }}
      animate={{ y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-x-0 bottom-0 z-40 border-t-[2.5px] border-[var(--ink)] bg-[var(--cream-hi)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_-12px_rgba(44,33,27,0.35)] lg:hidden"
    >
      {children}
    </motion.div>
  );
}
