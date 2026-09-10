import { formatINR } from "@/lib/money";
import type { PricedCart } from "@/lib/cart";

/**
 * Order totals.
 *
 * When prices carry GST, the headline figure is what the customer pays and the
 * tax is shown as contained within it — "including ₹X GST", never added as a
 * line beneath. Presenting inclusive tax as an addition would make the total
 * look higher than the menu board.
 *
 * When there is no GST to carry — the business is not registered — the line is
 * not rendered at all. "Includes ₹0 GST" is noise at best and a claim about a
 * tax nobody collected at worst.
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

      {totals.total > 0n && (
        <p className="tabular text-xs text-muted-foreground">
          Includes {formatINR(totals.total)} GST ({formatINR(totals.cgst)} CGST + {formatINR(totals.sgst)} SGST)
        </p>
      )}
    </div>
  );
}
