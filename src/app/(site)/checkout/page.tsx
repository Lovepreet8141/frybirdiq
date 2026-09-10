import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Store } from "lucide-react";
import { CheckoutForm } from "@/components/cart/checkout-form";
import { OrderSummary } from "@/components/cart/summary";
import { getPricedCart } from "@/lib/cart";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const cart = await getPricedCart();
  if (cart.lines.length === 0) redirect("/cart");

  return (
    <div className="mx-auto w-full max-w-4xl px-[var(--gutter)] py-10 sm:py-14">
      <Link
        href="/cart"
        className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Your order
      </Link>

      <h1 className="mt-4 font-heading text-4xl font-bold tracking-tight sm:text-5xl">Checkout</h1>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="flex flex-col gap-8">
          {/*
            Collection only. Delivery needs a delivery fee and a radius, and
            neither has been decided — inventing a fee would put a number in
            front of a customer that nobody agreed to.

            Payment is at the counter. Online payment is Phase 2, and §73 is
            explicit that there is to be no fake "payment successful" logic
            before it exists.
          */}
          <section aria-labelledby="collection" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
            <h2 id="collection" className="flex items-center gap-2 font-heading text-lg font-semibold">
              <Store className="size-4 text-primary" aria-hidden="true" />
              Collection
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Collect from Sector 9, Ambala City. We&rsquo;ll call when it&rsquo;s ready.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Pay at the counter — cash, UPI or card. Nothing is charged now.
            </p>
          </section>

          <section aria-labelledby="details" className="flex flex-col gap-5">
            <h2 id="details" className="font-heading text-lg font-semibold">
              Your details
            </h2>
            <CheckoutForm />
          </section>
        </div>

        <div className="lg:sticky lg:top-24">
          <OrderSummary cart={cart} />
        </div>
      </div>
    </div>
  );
}
