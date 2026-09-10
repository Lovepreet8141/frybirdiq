import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LineControls } from "@/components/cart/line-controls";
import { OrderSummary } from "@/components/cart/summary";
import { VegMark } from "@/components/menu/marks";
import { EmptyState, ErrorState } from "@/components/states";
import { formatINR } from "@/lib/money";
import { getPricedCart } from "@/lib/cart";

export const metadata: Metadata = { title: "Your order" };

export default async function CartPage() {
  const cart = await getPricedCart();

  return (
    <div className="mx-auto w-full max-w-4xl px-[var(--gutter)] py-10 sm:py-14">
      <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">Your order</h1>

      {/*
        Lines that could not be honoured are shown, not silently dropped. A cart
        that quietly loses an item between the menu and checkout is how someone
        ends up with the wrong order and no idea why.
      */}
      {cart.rejected.length > 0 && (
        <ErrorState
          className="mt-8"
          title="Some items were removed"
          detail={cart.rejected.map((line) => `${line.slug}: ${line.reason}`).join(". ")}
        />
      )}

      {cart.lines.length === 0 ? (
        <EmptyState
          className="mt-10"
          title="Nothing in your order yet."
          detail="Have a look at the menu."
          action={
            <Link
              href="/menu"
              className="mt-2 inline-flex min-h-[48px] items-center gap-2 rounded-md bg-primary px-5 font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              See the menu
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          }
        />
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px] lg:items-start">
          <ul className="flex flex-col gap-3">
            {cart.lines.map((line) => (
              <li
                key={line.key}
                className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <VegMark veg={line.product.veg} />
                    <h2 className="font-heading font-semibold">{line.product.name}</h2>
                  </div>

                  {line.modifiers.length > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {line.modifiers.map((modifier) => modifier.name).join(" · ")}
                    </p>
                  )}

                  <p className="tabular text-sm text-muted-foreground">
                    {formatINR(line.unitPrice)} each
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <span className="tabular font-semibold">{formatINR(line.priced.gross)}</span>
                  <LineControls lineKey={line.key} quantity={line.quantity} name={line.product.name} />
                </div>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-4 lg:sticky lg:top-24">
            <OrderSummary cart={cart} />

            <Link
              href="/checkout"
              className="flex min-h-[56px] items-center justify-center gap-2 rounded-md bg-primary px-6 font-semibold text-primary-foreground transition-opacity duration-[var(--duration-micro)] hover:opacity-90"
            >
              Checkout
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>

            <Link
              href="/menu"
              className="flex min-h-[44px] items-center justify-center text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              Add something else
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
