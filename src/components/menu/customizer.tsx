"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Minus, Plus } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { type Paise, add, formatINR, multiply } from "@/lib/money";
import { addToCart } from "@/lib/cart/actions";
import type { MenuProduct } from "@/lib/repositories/menu";
import { cn } from "@/lib/utils";

/**
 * Product customization. BUILD-PLAN.md §12.
 *
 * Renders whatever modifier groups the product carries — nothing about wings
 * or heat levels is hard-coded here. A group with `minSelections: 1` and
 * `maxSelections: 1` is a radio group; anything else is checkboxes.
 *
 * The running price shown here is **display only**. The server prices the cart
 * for itself from the slugs this sends, so a tampered client changes what it
 * sees and nothing else. §13.
 */
export function Customizer({ product }: { product: MenuProduct }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [quantity, setQuantity] = useState(1);

  const [selected, setSelected] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      product.modifierGroups.map((group) => [
        group.slug,
        group.modifiers.filter((modifier) => modifier.isDefault).map((modifier) => modifier.slug),
      ]),
    ),
  );

  const isSingleChoice = (groupSlug: string) => {
    const group = product.modifierGroups.find((candidate) => candidate.slug === groupSlug);
    return group?.maxSelections === 1;
  };

  function toggle(groupSlug: string, modifierSlug: string) {
    setAdded(false);
    setError(null);
    setSelected((current) => {
      const existing = current[groupSlug] ?? [];
      if (isSingleChoice(groupSlug)) return { ...current, [groupSlug]: [modifierSlug] };
      return {
        ...current,
        [groupSlug]: existing.includes(modifierSlug)
          ? existing.filter((slug) => slug !== modifierSlug)
          : [...existing, modifierSlug],
      };
    });
  }

  const chosenSlugs = Object.values(selected).flat();
  const deltas: Paise[] = product.modifierGroups.flatMap((group) =>
    group.modifiers.filter((modifier) => chosenSlugs.includes(modifier.slug)).map((modifier) => modifier.priceDelta),
  );
  const unitPrice = add(product.price, ...deltas);
  const lineTotal = multiply(unitPrice, quantity);

  const unanswered = product.modifierGroups.filter(
    (group) => (selected[group.slug] ?? []).length < group.minSelections,
  );

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addToCart({ slug: product.slug, quantity, modifiers: chosenSlugs });
      if (!result.ok) {
        setError(result.error ?? "That could not be added.");
        return;
      }
      setAdded(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {product.modifierGroups.map((group) => {
        const single = group.maxSelections === 1;
        const chosen = selected[group.slug] ?? [];

        return (
          <fieldset key={group.slug} className="flex flex-col gap-3">
            <legend className="flex items-baseline gap-2 font-heading text-lg font-semibold">
              {group.name}
              <span className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {group.minSelections > 0 ? "Required" : "Optional"}
              </span>
            </legend>

            <div className="grid gap-2 sm:grid-cols-2">
              {group.modifiers.map((modifier) => {
                const isChosen = chosen.includes(modifier.slug);
                return (
                  <label
                    key={modifier.slug}
                    className={cn(
                      "flex min-h-[52px] cursor-pointer items-center justify-between gap-3 rounded-md border px-4 py-3 transition-colors duration-[var(--duration-micro)]",
                      isChosen ? "border-primary bg-primary/10" : "border-border bg-surface hover:border-border-strong",
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type={single ? "radio" : "checkbox"}
                        name={group.slug}
                        value={modifier.slug}
                        checked={isChosen}
                        onChange={() => toggle(group.slug, modifier.slug)}
                        className="size-4 accent-[var(--primary)]"
                      />
                      <span className="font-medium">{modifier.name}</span>
                    </span>
                    {modifier.priceDelta !== 0n && (
                      <span className="tabular text-sm text-muted-foreground">
                        +{formatINR(modifier.priceDelta)}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      {/* Quantity */}
      <div className="flex items-center gap-4">
        <span className="font-heading text-lg font-semibold" id="quantity-label">
          Quantity
        </span>
        <div className="flex items-center gap-1" role="group" aria-labelledby="quantity-label">
          <button
            type="button"
            onClick={() => setQuantity((value) => Math.max(1, value - 1))}
            disabled={quantity <= 1}
            className="flex size-[44px] items-center justify-center rounded-md border border-border bg-surface transition-colors hover:border-border-strong disabled:opacity-40"
            aria-label="One fewer"
          >
            <Minus className="size-4" aria-hidden="true" />
          </button>
          <span className="tabular w-10 text-center text-lg font-semibold" aria-live="polite">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((value) => Math.min(50, value + 1))}
            disabled={quantity >= 50}
            className="flex size-[44px] items-center justify-center rounded-md border border-border bg-surface transition-colors hover:border-border-strong disabled:opacity-40"
            aria-label="One more"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
          {error}
        </p>
      )}

      {/* Add. Responds within 120ms, before the network. */}
      <motion.button
        type="button"
        onClick={submit}
        disabled={pending || unanswered.length > 0}
        whileTap={reduced || pending ? undefined : { scale: 0.98 }}
        transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
        className="flex min-h-[56px] items-center justify-center gap-3 rounded-md bg-primary px-6 text-base font-semibold text-primary-foreground transition-opacity duration-[var(--duration-micro)] hover:opacity-90 disabled:opacity-50"
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Adding
          </>
        ) : added ? (
          <>
            <Check className="size-4" aria-hidden="true" />
            Added
          </>
        ) : unanswered.length > 0 ? (
          `Choose ${unanswered[0]!.name.toLowerCase()}`
        ) : (
          <>
            Add to order
            <span className="tabular">{formatINR(lineTotal)}</span>
          </>
        )}
      </motion.button>

      <p className="sr-only" role="status" aria-live="polite">
        {added ? `${product.name} added to your order.` : ""}
      </p>
    </div>
  );
}
