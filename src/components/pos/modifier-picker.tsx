"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatINR } from "@/lib/money";
import type { MenuProduct } from "@/lib/repositories/menu";
import { cn } from "@/lib/utils";

/**
 * Choosing a product's modifiers before it goes on the order.
 *
 * Renders whatever groups the product carries — nothing about sizes or heat
 * is hard-coded. A group with `maxSelections: 1` is a radio group; anything
 * else is checkboxes. The running price shown here is display only; the
 * order builder re-prices the whole order from the slugs this sends. §13.
 */
export function ModifierPicker({
  product,
  onClose,
  onAdd,
}: {
  product: MenuProduct | null;
  onClose: () => void;
  onAdd: (input: { slug: string; quantity: number; modifierSlugs: readonly string[] }) => void;
}) {
  return (
    <Dialog open={product !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        {product && (
          // Keyed by slug so a different product remounts this form with
          // fresh defaults, rather than an effect chasing the prop change.
          <ModifierPickerForm key={product.slug} product={product} onAdd={onAdd} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ModifierPickerForm({
  product,
  onAdd,
  onClose,
}: {
  product: MenuProduct;
  onAdd: (input: { slug: string; quantity: number; modifierSlugs: readonly string[] }) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      product.modifierGroups.map((group) => [
        group.slug,
        group.modifiers.filter((modifier) => modifier.isDefault).map((modifier) => modifier.slug),
      ]),
    ),
  );
  const [quantity, setQuantity] = useState(1);

  const isSingleChoice = (groupSlug: string) =>
    product.modifierGroups.find((group) => group.slug === groupSlug)?.maxSelections === 1;

  function toggle(groupSlug: string, modifierSlug: string) {
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

  const unanswered = product.modifierGroups.filter(
    (group) => (selected[group.slug] ?? []).length < group.minSelections,
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>{product.name}</DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-5">
        {product.modifierGroups.map((group) => {
          const single = group.maxSelections === 1;
          const chosen = selected[group.slug] ?? [];

          return (
            <fieldset key={group.slug} className="flex flex-col gap-2">
              <legend className="mb-1 flex items-baseline gap-2 text-sm font-semibold">
                {group.name}
                <span className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {group.minSelections > 0 ? "Required" : "Optional"}
                </span>
              </legend>

              <div className="grid gap-2">
                {group.modifiers.map((modifier) => {
                  const isChosen = chosen.includes(modifier.slug);
                  return (
                    <label
                      key={modifier.slug}
                      className={cn(
                        "flex min-h-[56px] cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors duration-[var(--duration-micro)]",
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
                        <span className="tabular text-sm text-muted-foreground">+{formatINR(modifier.priceDelta)}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}

        <div className="flex items-center gap-4">
          <span id="pos-quantity-label" className="text-sm font-semibold">
            Quantity
          </span>
          <div className="flex items-center gap-1" role="group" aria-labelledby="pos-quantity-label">
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
      </div>

      <DialogFooter>
        <button
          type="button"
          disabled={unanswered.length > 0}
          onClick={() => {
            onAdd({
              slug: product.slug,
              quantity,
              modifierSlugs: Object.values(selected).flat(),
            });
            onClose();
          }}
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-md bg-primary px-5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
        >
          {unanswered.length > 0 ? `Choose ${unanswered[0]!.name.toLowerCase()}` : "Add to order"}
        </button>
      </DialogFooter>
    </>
  );
}
