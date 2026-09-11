"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Minus, Plus } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type Paise, add, formatINR, multiply } from "@/lib/money";
import { addToCart } from "@/lib/cart/actions";
import { useToast } from "@/components/ui/toast";
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
  const { show } = useToast();

  /*
   * The main button, watched so the sticky bar can take over when it scrolls
   * away. On a phone the add button sits below the options and the price, and
   * once someone has scrolled past it there is no way to order without
   * scrolling back — which is where people give up.
   */
  const ctaRef = useRef<HTMLButtonElement>(null);
  const [ctaVisible, setCtaVisible] = useState(true);

  useEffect(() => {
    const node = ctaRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setCtaVisible(entry?.isIntersecting ?? true),
      { rootMargin: "0px 0px -8px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
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
      show({
        message: `${quantity} × ${product.name} added`,
        detail: `${formatINR(lineTotal)} — fried to order, about 15 minutes.`,
        action: { label: "View your order", href: "/cart" },
      });
      router.refresh();
    });
  }

  /* One label, rendered in two places. The sticky bar is the same control as
     the main button, not a second one that can disagree with it. */
  const ctaLabel = pending
    ? "Adding"
    : unanswered.length > 0
      ? `Choose ${unanswered[0]!.name.toLowerCase()}`
      : added
        ? "Added"
        : "Add to order";

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
        ref={ctaRef}
        type="button"
        onClick={submit}
        disabled={pending || unanswered.length > 0}
        whileTap={reduced || pending ? undefined : { scale: 0.98 }}
        transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
        className="flex min-h-[56px] cursor-pointer items-center justify-center gap-3 rounded-xl border-[2.5px] border-[var(--ink)] bg-primary px-6 font-heading text-base font-extrabold text-primary-foreground shadow-[5px_5px_0_var(--ink)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[7px_8px_0_var(--ink)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-[5px_5px_0_var(--ink)]"
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

      {/* Sticky bar. Mirrors the button above rather than duplicating its
          state, and is hidden from assistive tech — the real control is already
          in the reading order, and announcing it twice is worse than not at
          all. */}
      <AnimatePresence>
        {!ctaVisible && (
          <motion.div
            aria-hidden="true"
            initial={reduced ? false : { y: "100%" }}
            animate={{ y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: "100%" }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-x-0 bottom-0 z-40 border-t-[2.5px] border-[var(--ink)] bg-[var(--cream-hi)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_-12px_rgba(44,33,27,0.35)]"
          >
            <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-heading text-sm font-extrabold">{product.name}</p>
                <p className="tabular text-sm text-muted-foreground">
                  {quantity} × {formatINR(unitPrice)}
                </p>
              </div>
              <button
                type="button"
                tabIndex={-1}
                onClick={submit}
                disabled={pending || unanswered.length > 0}
                className="flex min-h-[48px] shrink-0 cursor-pointer items-center gap-2 rounded-xl border-[2.5px] border-[var(--ink)] bg-primary px-5 font-heading text-sm font-extrabold text-primary-foreground shadow-[4px_4px_0_var(--ink)] transition-transform duration-200 ease-out active:translate-y-0.5 disabled:opacity-50"
              >
                {ctaLabel}
                {unanswered.length === 0 && !pending && (
                  <span className="tabular">{formatINR(lineTotal)}</span>
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="sr-only" role="status" aria-live="polite">
        {added ? `${product.name} added to your order.` : ""}
      </p>
    </div>
  );
}
