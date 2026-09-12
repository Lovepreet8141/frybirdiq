import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { ArrowLeft, Wallet } from "lucide-react";
import { CheckoutForm } from "@/components/cart/checkout-form";
import { CheckoutExtras } from "@/components/cart/extras";
import { OrderSummary } from "@/components/cart/summary";
import type { SavedAddressOption } from "@/components/delivery/delivery-fields";
import { getPricedCart } from "@/lib/cart";
import { readRememberedAddress } from "@/lib/cart/remembered-address";
import { readRememberedContact } from "@/lib/cart/remembered-contact";
import { getCustomer } from "@/lib/customer";
import { toLatLng } from "@/lib/delivery";
import { isLoyaltyEnabled, maxRedeemable } from "@/lib/loyalty";
import { getLoyaltyConfig } from "@/lib/loyalty/config";
import { formatINR } from "@/lib/money";
import { availableMethods } from "@/lib/payments";
import { listSavedAddresses } from "@/lib/repositories/addresses";
import { getDeliverySettings } from "@/lib/repositories/delivery";

export const metadata: Metadata = { title: "Checkout" };

/**
 * Checkout.
 *
 * Built as a confirmation rather than a form. For someone who has ordered
 * before, everything is already known — where it goes, who they are, how they
 * pay — so the page shows those as lines to glance at and one button to press.
 * Anything a minority of orders need (a code, a note, points) sits behind a
 * word rather than taking a field from everyone.
 */
export default async function CheckoutPage() {
  const cart = await getPricedCart();
  if (cart.lines.length === 0) redirect("/cart");

  // Minted per render. Resubmitting the same page cannot create a second order.
  const idempotencyKey = randomUUID();
  const methods = availableMethods();
  const delivery = await getDeliverySettings();
  const shop = delivery?.shop ? toLatLng(delivery.shop) : null;

  const customer = await getCustomer();

  const remembered = customer ? null : await readRememberedContact();
  const contact =
    customer && customer.name && customer.phone && customer.email
      ? { name: customer.name, phone: customer.phone, email: customer.email }
      : remembered;

  // An unverified account's saved addresses are withheld the same as its
  // order history — an unconfirmed email hasn't proven this session owns
  // that customer row yet. Checkout still works: it falls through to the
  // same on-device remembered address a guest gets, never blocking the order.
  const savedAddresses: SavedAddressOption[] = customer?.emailVerified
    ? (await listSavedAddresses(customer.id)).map((address) => ({
        id: address.id,
        line1: address.line1,
        landmark: address.landmark,
        lat: address.lat,
        lng: address.lng,
      }))
    : ((address) => (address ? [{ ...address, id: "remembered", onThisDevice: true }] : []))(
        await readRememberedAddress(),
      );

  // Points are only offered when there is a scheme, an account, and enough
  // balance to be worth a line on the page.
  const loyalty = await getLoyaltyConfig();
  const offer =
    customer?.emailVerified && isLoyaltyEnabled(loyalty) && customer.points > 0
      ? maxRedeemable(customer.points, cart.totals.gross, loyalty)
      : null;

  return (
    <div className="mx-auto w-full max-w-4xl px-[var(--gutter)] py-8 sm:py-12">
      <Link
        href="/cart"
        className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Your order
      </Link>

      <h1 className="mt-3 font-heading text-3xl font-bold tracking-tight sm:text-4xl">Checkout</h1>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px] lg:items-start">
        <CheckoutForm
          idempotencyKey={idempotencyKey}
          shop={shop}
          deliveryEnabled={delivery?.enabled ?? false}
          savedAddresses={savedAddresses}
          contact={contact}
          fromAccount={Boolean(customer)}
          extras={
            <CheckoutExtras
              promotion={cart.promotion ? { code: cart.promotion.code, name: cart.promotion.name } : null}
              promotionError={cart.promotionError}
              points={
                offer && offer.points > 0
                  ? {
                      available: offer.points,
                      spending: cart.points?.points ?? 0,
                      worth: formatINR(offer.discount),
                    }
                  : null
              }
            />
          }
        />

        <div className="flex flex-col gap-3 lg:sticky lg:top-24">
          <OrderSummary cart={cart} />

          {/* Payment, as a line rather than a section. There is one option;
              giving it a heading and a card made it look like a choice. */}
          <p className="flex items-start gap-2 px-1 text-sm text-muted-foreground">
            <Wallet className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            {methods[0]?.label ?? "Pay on collection"} — {methods[0]?.detail ?? "at the counter."} Nothing is charged
            now.
          </p>
        </div>
      </div>
    </div>
  );
}
