import { formatINR } from "@/lib/money";
import type { PricedCart } from "@/lib/cart";

/**
 * What the customer pays.
 *
 * Lines appear only when they carry a figure. "Includes ₹0 GST", "− ₹0
 * discount" and an empty points row are noise at best, and a claim about a tax
 * nobody collected at worst.
 */
export function OrderSummary({ cart }: { cart: PricedCart }) {
  const { totals } = cart;

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-5">
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">
            {cart.itemCount} {cart.itemCount === 1 ? "item" : "items"}
          </dt>
          <dd className="tabular">{formatINR(totals.listed)}</dd>
        </div>

        {cart.promotion && (
          <div className="flex items-baseline justify-between gap-4 text-[var(--success,inherit)]">
            <dt className="text-muted-foreground">{cart.promotion.name}</dt>
            <dd className="tabular">−{formatINR(cart.promotion.discount)}</dd>
          </div>
        )}

        {cart.stampReward && (
          <div className="flex items-baseline justify-between gap-4 text-[var(--success,inherit)]">
            <dt className="text-muted-foreground">FRYBIRD REWARDS — free item</dt>
            <dd className="tabular">−{formatINR(cart.stampReward.discount)}</dd>
          </div>
        )}

        {totals.feeTotal > 0n && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Delivery</dt>
            <dd className="tabular">{formatINR(totals.feeTotal)}</dd>
          </div>
        )}

        {cart.points && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{cart.points.points} points</dt>
            <dd className="tabular">−{formatINR(cart.points.discount)}</dd>
          </div>
        )}
      </dl>

      <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3">
        <span className="font-heading text-lg font-semibold">To pay</span>
        <span className="tabular text-2xl font-bold">{formatINR(cart.payable)}</span>
      </div>

      {totals.total > 0n && (
        <p className="tabular text-xs text-muted-foreground">
          Includes {formatINR(totals.total)} GST ({formatINR(totals.cgst)} CGST + {formatINR(totals.sgst)} SGST)
        </p>
      )}
    </div>
  );
}
