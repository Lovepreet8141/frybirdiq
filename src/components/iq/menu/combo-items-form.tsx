"use client";

import { useState, useTransition } from "react";
import { addComboItemAction, removeComboItemAction } from "@/lib/menu-admin/actions";
import { ActionButton } from "./action-button";

export function ComboItemsForm({
  comboProductId,
  items,
  candidates,
}: {
  comboProductId: string;
  items: readonly { id: string; productId: string; productName: string; quantity: number }[];
  candidates: readonly { id: string; name: string }[];
}) {
  const [productId, setProductId] = useState(candidates[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">This combo has no items yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span>
                {item.quantity}× {item.productName}
              </span>
              <ActionButton action={() => removeComboItemAction(item.id)} variant="destructive">
                Remove
              </ActionButton>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-sm text-[var(--destructive)]">
          {error}
        </p>
      )}

      {candidates.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Product
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className="min-h-[36px] rounded-md border border-border bg-surface px-3 font-normal">
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Quantity
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="min-h-[36px] w-20 rounded-md border border-border bg-surface px-3 font-normal" />
          </label>
          <button
            type="button"
            disabled={isPending || !productId}
            onClick={() =>
              startTransition(async () => {
                const result = await addComboItemAction(comboProductId, productId, quantity);
                if (!result.ok) setError(result.error ?? "Could not add.");
                else setError(null);
              })
            }
            className="inline-flex min-h-[36px] items-center rounded-md border border-border px-3 text-sm font-semibold hover:bg-surface-muted disabled:opacity-60"
          >
            {isPending ? "Adding…" : "+ Add item"}
          </button>
        </div>
      )}
    </div>
  );
}
