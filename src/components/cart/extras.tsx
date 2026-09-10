"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gift, Loader2, StickyNote, Tag, X } from "lucide-react";
import { applyPromoCode, clearPromoCode, setPointsToSpend } from "@/lib/cart/actions";

/**
 * The things most orders do not need.
 *
 * A promotion code, a note and points are each useful to a minority of orders
 * and in the way of all of them, so they sit behind a line of text rather than
 * three open fields. Checkout should be as long as the order requires and no
 * longer.
 */
export function CheckoutExtras({
  promotion,
  promotionError,
  points,
}: {
  promotion: { code: string; name: string } | null;
  promotionError: string | null;
  points: { available: number; spending: number; worth: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showCode, setShowCode] = useState(Boolean(promotion || promotionError));
  const [showNote, setShowNote] = useState(false);
  const [code, setCode] = useState("");

  const run = (work: () => Promise<unknown>) =>
    startTransition(async () => {
      await work();
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      {/* Points, when there are any worth spending. One toggle, no arithmetic
          asked of the customer. */}
      {points && points.available > 0 && (
        <label className="flex min-h-[56px] cursor-pointer items-center gap-3 rounded-md border border-border bg-surface px-4 py-3">
          <input
            type="checkbox"
            checked={points.spending > 0}
            disabled={pending}
            onChange={(event) => run(() => setPointsToSpend({ points: event.target.checked ? points.available : 0 }))}
            className="size-4 shrink-0 accent-[var(--primary)]"
          />
          <Gift className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="flex flex-col">
            <span className="text-sm font-semibold">Use {points.available} points</span>
            <span className="text-sm text-muted-foreground">{points.worth} off this order</span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap gap-4 text-sm">
        {!showCode && !promotion && (
          <button type="button" onClick={() => setShowCode(true)} className="flex items-center gap-1.5 font-semibold text-primary">
            <Tag className="size-4" aria-hidden="true" />
            Have a code?
          </button>
        )}
        {!showNote && (
          <button type="button" onClick={() => setShowNote(true)} className="flex items-center gap-1.5 font-semibold text-primary">
            <StickyNote className="size-4" aria-hidden="true" />
            Add a note
          </button>
        )}
      </div>

      {promotion ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
          <span className="flex items-center gap-2 text-sm">
            <Tag className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="tabular font-semibold">{promotion.code}</span>
            <span className="text-muted-foreground">{promotion.name}</span>
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(clearPromoCode)}
            className="flex min-h-[44px] items-center gap-1 text-sm font-semibold text-muted-foreground"
          >
            <X className="size-4" aria-hidden="true" />
            Remove
          </button>
        </div>
      ) : (
        showCode && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                aria-label="Promotion code"
                maxLength={40}
                className="tabular h-[52px] flex-1 rounded-md border border-border bg-surface px-4 text-base uppercase"
              />
              <button
                type="button"
                disabled={pending || !code.trim()}
                onClick={() => run(() => applyPromoCode({ code }))}
                className="flex min-h-[52px] items-center justify-center rounded-md border border-border-strong px-5 text-sm font-semibold disabled:opacity-40"
              >
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : "Apply"}
              </button>
            </div>
            {/* The specific reason, not "invalid code" — otherwise the customer
                retypes the same thing. */}
            {promotionError && (
              <p role="alert" className="text-sm text-muted-foreground">
                {promotionError}
              </p>
            )}
          </div>
        )
      )}

      {showNote && (
        <textarea
          name="notes"
          rows={2}
          maxLength={500}
          aria-label="Anything else"
          placeholder="Anything we should know"
          className="rounded-md border border-border bg-surface px-4 py-3 text-base"
        />
      )}
    </div>
  );
}
