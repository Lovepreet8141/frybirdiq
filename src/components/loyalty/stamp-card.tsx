"use client";

import { Check, Gift } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * The stamp card, drawn as what it is — a row of punches on a loyalty card.
 *
 * Every slot is real: `count` is either the signed-in customer's actual
 * progress or, for a visitor, nothing at all — the component never invents a
 * number of stamps someone has not earned. §33's rule for the ordering AI
 * applies just as much to marketing copy: a promise the account cannot back
 * up is worse than no promise.
 */
export function StampCard({
  goal,
  count,
  personal = false,
  className,
}: {
  /** Orders per cycle — the last slot is the free one. */
  goal: number;
  /** Stamps earned since the last reward. 0 for a signed-out visitor. */
  count: number;
  /** Whether `count` is this visitor's own progress, or an explainer at 0. */
  personal?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const slots = Array.from({ length: goal }, (_, index) => index);
  const rewardIndex = goal - 1;

  return (
    <div className={cn("flex flex-wrap gap-2.5", className)} role="img" aria-label={`Stamp card: ${count} of ${rewardIndex} stamps${personal ? ", your progress" : ""}`}>
      {slots.map((index) => {
        const filled = index < count;
        const isReward = index === rewardIndex;

        return (
          <motion.span
            key={index}
            aria-hidden="true"
            initial={reduced ? false : { opacity: 0, scale: 0.7 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{
              duration: 0.32,
              delay: reduced ? 0 : index * 0.045,
              ease: [0.16, 1, 0.3, 1],
            }}
            className={cn(
              "relative flex size-11 shrink-0 items-center justify-center rounded-full border-2 sm:size-12",
              isReward
                ? "border-dashed border-primary text-primary"
                : filled
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground",
            )}
          >
            {isReward ? (
              <Gift className="size-5" aria-hidden="true" />
            ) : filled ? (
              <Check className="size-5" aria-hidden="true" strokeWidth={3} />
            ) : (
              <span className="text-sm font-bold">{index + 1}</span>
            )}
          </motion.span>
        );
      })}
    </div>
  );
}
