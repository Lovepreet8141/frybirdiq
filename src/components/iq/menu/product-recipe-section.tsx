"use client";

import { useState, useTransition } from "react";
import { createBareRecipeAction } from "@/lib/menu-admin/actions";

/**
 * Recipe status only — no ingredient-line editor here. Costing and stock
 * deduction are Phase 8/9 (inventory), unbuilt; this exists so the product
 * editor is honest about what is and is not wired to inventory yet, per
 * BUILD-PLAN's "do not invent inventory quantities".
 */
export function ProductRecipeSection({ productId, status }: { productId: string; status: { linked: boolean; ingredientCount: number } }) {
  const [linked, setLinked] = useState(status.linked);
  const [yieldQuantity, setYieldQuantity] = useState(1);
  const [isPending, startTransition] = useTransition();

  if (linked) {
    return (
      <p className="text-sm text-muted-foreground">
        Recipe linked — {status.ingredientCount} {status.ingredientCount === 1 ? "ingredient" : "ingredients"}.{" "}
        {status.ingredientCount === 0 && "Add ingredients from Inventory once that screen supports it."}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <p className="w-full text-sm text-muted-foreground">
        No recipe linked. Availability cannot be inferred from stock until one exists — &quot;sold out today&quot; above is always a manual call.
      </p>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Yield (portions per batch)
        <input
          type="number"
          min={1}
          value={yieldQuantity}
          onChange={(event) => setYieldQuantity(Number(event.target.value))}
          className="min-h-[36px] w-24 rounded-md border border-border bg-surface px-3 font-normal"
        />
      </label>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await createBareRecipeAction(productId, yieldQuantity);
            if (result.ok) setLinked(true);
          })
        }
        className="inline-flex min-h-[36px] items-center rounded-md border border-border px-3 text-sm font-semibold hover:bg-surface-muted disabled:opacity-60"
      >
        {isPending ? "Creating…" : "Create recipe"}
      </button>
    </div>
  );
}
