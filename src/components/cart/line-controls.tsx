"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { removeLine, setQuantity } from "@/lib/cart/actions";

/**
 * Quantity and removal for one cart line.
 *
 * Every change round-trips to the server, which re-prices the whole cart. The
 * client never adjusts a total; it asks and re-renders. §13.
 */
export function LineControls({ lineKey, quantity, name }: { lineKey: string; quantity: number; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const change = (next: number) =>
    startTransition(async () => {
      await setQuantity({ key: lineKey, quantity: next });
      router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      await removeLine({ key: lineKey });
      router.refresh();
    });

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => change(quantity - 1)}
          disabled={pending || quantity <= 1}
          className="flex size-[44px] items-center justify-center rounded-md border border-border bg-surface transition-colors hover:border-border-strong disabled:opacity-40"
          aria-label={`One fewer ${name}`}
        >
          <Minus className="size-4" aria-hidden="true" />
        </button>

        <span className="tabular w-8 text-center font-semibold" aria-live="polite">
          {pending ? <Loader2 className="mx-auto size-4 animate-spin" aria-label="Updating" /> : quantity}
        </span>

        <button
          type="button"
          onClick={() => change(quantity + 1)}
          disabled={pending || quantity >= 50}
          className="flex size-[44px] items-center justify-center rounded-md border border-border bg-surface transition-colors hover:border-border-strong disabled:opacity-40"
          aria-label={`One more ${name}`}
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="flex size-[44px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        aria-label={`Remove ${name}`}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
