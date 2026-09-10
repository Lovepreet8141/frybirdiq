import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Store, Wallet } from "lucide-react";
import { randomUUID } from "node:crypto";
import { CheckoutForm } from "@/components/cart/checkout-form";
import { availableMethods } from "@/lib/payments";
import { getDeliverySettings } from "@/lib/repositories/delivery";
import { toLatLng } from "@/lib/delivery";
import { getCustomer } from "@/lib/customer";
import { listSavedAddresses } from "@/lib/repositories/addresses";
import { readRememberedAddress } from "@/lib/cart/remembered-address";
import { readRememberedContact } from "@/lib/cart/remembered-contact";
import type { SavedAddressOption } from "@/components/delivery/delivery-fields";
import { OrderSummary } from "@/components/cart/summary";
import { getPricedCart } from "@/lib/cart";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const cart = await getPricedCart();
  if (cart.lines.length === 0) redirect("/cart");

  // Minted per render. Resubmitting the same page cannot create a second order.
  const idempotencyKey = randomUUID();
  const methods = availableMethods();
  const delivery = await getDeliverySettings();
  const shop = delivery?.shop ? toLatLng(delivery.shop) : null;

  /*
   * Saved addresses come from the account when there is one.
   *
   * For a guest, from a cookie on their own device instead — looking them up
   * by a typed phone number would hand one customer's doorstep to anyone who
   * knows their number. A cookie cannot leak across people because it never
   * leaves the browser that wrote it.
   */
  const customer = await getCustomer();

  /*
   * Who is ordering, from the account when there is one and from this device's
   * own memory when there is not. Either way it is a confirmation rather than
   * a form: someone who has ordered before should not retype their own name.
   */
  const remembered = customer ? null : await readRememberedContact();
  const contact =
    customer && customer.name && customer.phone && customer.email
      ? { name: customer.name, phone: customer.phone, email: customer.email }
      : remembered;
  const savedAddresses: SavedAddressOption[] = customer
    ? (await listSavedAddresses(customer.id)).map((address) => ({
        id: address.id,
        line1: address.line1,
        landmark: address.landmark,
        lat: address.lat,
        lng: address.lng,
      }))
    : ((remembered) => (remembered ? [{ ...remembered, id: "remembered", onThisDevice: true }] : []))(
        await readRememberedAddress(),
      );

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
              {delivery?.enabled ? "Collection or delivery" : "Collection"}
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {delivery?.enabled
                ? "Collect from Sector 9, Ambala City, or have it delivered. We'll call when it's on its way."
                : "Collect from Sector 9, Ambala City. We'll call when it's ready."}
            </p>
          </section>

          {/*
            Payment method, listed from the provider registry rather than
            hard-coded. Cash is the only one for now; adding Razorpay adds an
            entry to availableMethods() and this renders it without changing.
          */}
          <section aria-labelledby="payment" className="flex flex-col gap-3">
            <h2 id="payment" className="font-heading text-lg font-semibold">
              Payment
            </h2>
            <ul className="flex flex-col gap-2">
              {methods.map((option) => (
                <li key={option.method}>
                  <div className="flex min-h-[56px] items-center gap-3 rounded-lg border border-primary bg-primary/10 px-4 py-3">
                    <Wallet className="size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="flex flex-col">
                      <span className="font-semibold">{option.label}</span>
                      <span className="text-sm text-muted-foreground">{option.detail}</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">Nothing is charged now.</p>
          </section>

          <section aria-labelledby="details" className="flex flex-col gap-5">
            <h2 id="details" className="font-heading text-lg font-semibold">
              Your details
            </h2>
            <CheckoutForm
            idempotencyKey={idempotencyKey}
            shop={shop}
            deliveryEnabled={delivery?.enabled ?? false}
            savedAddresses={savedAddresses}
            contact={contact}
            fromAccount={Boolean(customer)}
          />
          </section>
        </div>

        <div className="lg:sticky lg:top-24">
          <OrderSummary cart={cart} />
        </div>
      </div>
    </div>
  );
}
