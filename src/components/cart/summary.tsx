import { formatINR } from "@/lib/money";
import type { PricedCart } from "@/lib/cart";

/**
 * Order totals.
 *
 * Prices are GST-inclusive, so the headline figure is what the customer pays
 * and the tax is shown as contained within it — "including ₹X GST", never
 * added as a line beneath. Presenting inclusive tax as an addition would make
 * the total look higher than the menu board and is the exact confusion the
 * confirmed basis exists to avoid.
 */
export function OrderSummary({ cart }: { cart: PricedCart }) {
  const { totals } = cart;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold">Order total</h2>

      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">
            {cart.itemCount} {cart.itemCount === 1 ? "item" : "items"}
          </dt>
          <dd className="tabular">{formatINR(totals.listed)}</dd>
        </div>

        {totals.discount !== 0n && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Discount</dt>
            <dd className="tabular">−{formatINR(totals.discount)}</dd>
          </div>
        )}
      </dl>

      <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3">
        <span className="font-heading text-lg font-semibold">To pay</span>
        <span className="tabular text-2xl font-bold">{formatINR(totals.gross)}</span>
      </div>

      <p className="tabular text-xs text-muted-foreground">
        Includes {formatINR(totals.total)} GST ({formatINR(totals.cgst)} CGST + {formatINR(totals.sgst)} SGST)
      </p>
    </div>
  );
}
