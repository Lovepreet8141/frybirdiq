"use client";

import { Flame, Gift } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * FRYBIRD REWARDS, drawn as what it is — a row of stamps on a card.
 *
 * `stampCount` is either the signed-in customer's actual progress or, for a
 * visitor, nothing at all. The component never invents a number of stamps
 * someone has not earned — §33's rule for the ordering AI holds for
 * marketing copy too, and a promise the account cannot back up is worse
 * than no promise.
 *
 * `availableRewards` drives its own state: at least one and the card leads
 * with an unmissable "reward unlocked" banner, not a quiet 7th flame.
 */
export function StampCard({
  stampsRequired,
  stampCount,
  availableRewards = 0,
  personal = false,
  /** Index of a stamp that just landed this page load — gets the bigger pop. */
  justEarnedIndex,
  className,
}: {
  stampsRequired: number;
  stampCount: number;
  availableRewards?: number;
  personal?: boolean;
  justEarnedIndex?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const slots = Array.from({ length: stampsRequired }, (_, index) => index);
  const unlocked = availableRewards > 0;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <AnimatePresence>
        {unlocked && (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.36, ease: EASE_OUT }}
            role="status"
            className="flex items-center gap-3 rounded-xl border-[2.5px] border-[var(--ink)] bg-primary px-4 py-3 text-primary-foreground shadow-[5px_5px_0_var(--red-deep)]"
          >
            <motion.span
              initial={reduced ? false : { rotate: -12, scale: 0.8 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ duration: 0.4, delay: 0.1, ease: EASE_OUT }}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15"
            >
              <Gift className="size-5" aria-hidden="true" />
            </motion.span>
            <div>
              <p className="font-heading text-sm font-extrabold uppercase tracking-[0.06em]">Reward unlocked</p>
              <p className="text-xs opacity-90">
                {availableRewards > 1 ? `${availableRewards} free items ready to redeem` : "Your free item is ready to redeem"}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className="flex flex-wrap gap-2.5"
        role="img"
        aria-label={`${stampCount} of ${stampsRequired} stamps${personal ? ", your progress" : ""}`}
      >
        {slots.map((index) => {
          const filled = index < stampCount;
          const isNew = index === justEarnedIndex;

          return (
            <motion.span
              key={index}
              aria-hidden="true"
              initial={reduced ? false : { opacity: 0, scale: 0.6 }}
              whileInView={
                isNew && !reduced
                  ? { opacity: 1, scale: [0.6, 1.3, 1] }
                  : { opacity: 1, scale: 1 }
              }
              viewport={{ once: true, amount: 0.6 }}
              transition={
                isNew
                  ? { duration: 0.5, ease: EASE_OUT }
                  : { duration: 0.3, delay: reduced ? 0 : index * 0.05, ease: EASE_OUT }
              }
              className={cn(
                "relative flex size-11 shrink-0 items-center justify-center rounded-full border-2 sm:size-12",
                filled
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-dashed border-border text-muted-foreground",
              )}
            >
              <Flame className="size-5" aria-hidden="true" fill={filled ? "currentColor" : "none"} />
              {isNew && !reduced && (
                <motion.span
                  aria-hidden="true"
                  initial={{ opacity: 0.6, scale: 1 }}
                  animate={{ opacity: 0, scale: 1.8 }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                  className="absolute inset-0 rounded-full bg-primary"
                />
              )}
            </motion.span>
          );
        })}
      </div>
    </div>
  );
}
