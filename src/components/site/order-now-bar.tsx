import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { getPricedCart } from "@/lib/cart";
import { formatINR } from "@/lib/money";
import { OrderNowBarMotion } from "./order-now-bar-motion";

/**
 * The bottom-of-screen "order now" bar for phones and small tablets.
 *
 * The header's cart button already does this job on a wide screen; below
 * the breakpoint where the nav collapses, there is otherwise no order route
 * within thumb's reach without scrolling back to the top. §84-adjacent: the
 * conversion action should never be more than one tap away.
 *
 * A Server Component, so the count and total are the server's own — never
 * something the client computed and could get wrong. §13.
 */
export async function OrderNowBar() {
  const cart = await getPricedCart();
  const hasItems = cart.itemCount > 0;

  return (
    <OrderNowBarMotion>
      <Link
        href={hasItems ? "/cart" : "/menu"}
        className="flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-[2.5px] border-[var(--ink)] bg-primary font-heading text-base font-extrabold text-primary-foreground shadow-[4px_4px_0_var(--ink)] transition-transform duration-200 ease-out active:translate-y-0.5"
      >
        <ShoppingBag className="size-5" aria-hidden="true" />
        {hasItems ? (
          <>
            View your order
            <span className="tabular">· {formatINR(cart.payable)}</span>
          </>
        ) : (
          "Order now"
        )}
      </Link>
    </OrderNowBarMotion>
  );
}
