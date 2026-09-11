"use client";

import { Star } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useActionState, useState } from "react";

import { rateOrder, type RatingState } from "@/lib/ratings/actions";

/**
 * Five stars, no comment box.
 *
 * Built as radio inputs rather than buttons, because that is what this is: one
 * choice from five. Keyboard users get arrow keys for free, the group is
 * announced as a group, and the current value is read out — none of which is
 * true of five buttons with aria bolted on.
 *
 * Hovering previews the score, which is the only thing a mouse user has to
 * tell them what they are about to pick. Touch has no hover, so the value
 * commits on tap and the preview never applies.
 */
export function OrderRating({ orderId, initial }: { orderId: string; initial: number | null }) {
  const [state, action, pending] = useActionState<RatingState, FormData>(rateOrder, { status: "idle" });
  const [score, setScore] = useState(initial ?? 0);
  const [preview, setPreview] = useState(0);
  const reduced = useReducedMotion();

  const shown = preview || score;
  const saved = state.status === "saved" || (initial !== null && state.status === "idle");

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="score" value={score} />

      <fieldset
        className="flex flex-col gap-2"
        onMouseLeave={() => setPreview(0)}
        disabled={pending}
      >
        <legend className="font-heading text-base font-extrabold">
          {saved ? "Thanks — you rated this order" : "How was it?"}
        </legend>

        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((value) => {
            const filled = value <= shown;
            return (
              <label
                key={value}
                onMouseEnter={() => setPreview(value)}
                className="cursor-pointer p-1"
                /* The visible label is the star; the text is for screen
                   readers, which need to hear what each option means. */
              >
                <input
                  type="radio"
                  name="score-choice"
                  value={value}
                  checked={score === value}
                  onChange={() => {
                    setScore(value);
                    // Submit on choose. A separate "send" button for a
                    // one-tap action is a second thing to find and a second
                    // chance to abandon.
                    requestAnimationFrame(() => {
                      (document.getElementById(`rating-submit-${orderId}`) as HTMLButtonElement | null)?.click();
                    });
                  }}
                  className="sr-only"
                />
                <motion.span
                  aria-hidden="true"
                  animate={reduced || !filled ? undefined : { scale: [1, 1.25, 1] }}
                  transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                  className="block"
                >
                  <Star
                    className={`size-9 transition-colors duration-150 ${
                      filled ? "fill-[var(--red)] text-[var(--red)]" : "fill-transparent text-[var(--border-strong)]"
                    }`}
                  />
                </motion.span>
                <span className="sr-only">
                  {value} {value === 1 ? "star" : "stars"}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <button id={`rating-submit-${orderId}`} type="submit" className="sr-only">
        Save rating
      </button>

      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {state.status === "error"
          ? state.message
          : pending
            ? "Saving…"
            : saved
              ? "Tap a different star to change it."
              : "One tap. No comment needed."}
      </p>
    </form>
  );
}
