"use client";

import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * A page arrives: 240 ms, a 6px rise and a fade (design-system/motion.md
 * "entrance"). Keyed on the path so every navigation gets it once; there
 * is no exit — the old page is gone the moment the new one has data, and
 * holding it back would only make the app feel slower. Reduced motion
 * renders the page in place.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  return (
    <motion.div key={pathname} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }} className="flex flex-1 flex-col">
      {children}
    </motion.div>
  );
}
