import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Circle, Clock, FileText, Flame, Gift } from "lucide-react";
import { formatINR } from "@/lib/money";
import { type Paise, paise } from "@/lib/money";
import { getOrder } from "@/lib/repositories/orders";
import { getRating } from "@/lib/ratings";
import { OrderRating } from "@/components/order/rating";
import type { FulfilmentType, OrderStatus } from "@/domain/order-status";

export const metadata: Metadata = { title: "Your order" };

/**
 * Order tracking. BUILD-PLAN.md §62.
 *
 * The steps a collection order actually passes through. No estimated-minutes
 * countdown and no live map — §62 is explicit: "Do not fake live location if
 * the system does not actually have reliable data." The shop calls when it is
 * ready, and the page says exactly that.
 *
 * Realtime status updates are Phase 3. Until then the page reflects the status
 * at load, which is honest rather than stale-pretending-to-be-live.
 */
/**
 * The steps an order actually passes through, which differ by how it is going
 * out. A delivery order is never "ready to collect" and is never "collected" —
 * showing those to someone waiting at home is telling them the wrong thing
 * about their own order.
 */
function stepsFor(fulfilment: FulfilmentType) {
  const delivery = fulfilment === "DELIVERY";

  return [
    {
      key: "received",
      label: "Order received",
      reached: ["PENDING_PAYMENT", "PAID", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED"],
    },
    {
      key: "accepted",
      label: "Kitchen accepted",
      reached: ["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED"],
    },
    {
      key: "preparing",
      label: "Preparing",
      reached: ["PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED"],
    },
    delivery
      ? { key: "ready", label: "Ready, waiting for a rider", reached: ["READY", "OUT_FOR_DELIVERY", "COMPLETED"] }
      : { key: "ready", label: "Ready to collect", reached: ["READY", "COMPLETED"] },
    ...(delivery
      ? [{ key: "out", label: "On its way", reached: ["OUT_FOR_DELIVERY", "COMPLETED"] }]
      : []),
    { key: "done", label: delivery ? "Delivered" : "Collected", reached: ["COMPLETED"] },
  ] as const;
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();

  // Only fetched for a finished order — nothing else can carry a rating.
  const rating = order.status === "COMPLETED" ? await getRating(order.id) : null;

  const status = order.status as OrderStatus;
  const isDelivery = order.fulfilment === "DELIVERY";
  const STEPS = stepsFor(order.fulfilment);

  // The repository already decided whether the promised time has passed; this
  // only phrases it.
  const readyLabel = order.readyEta
    ? order.readyEta.passed
      ? `Should be ${isDelivery ? "on its way" : "ready"} now.`
      : `${isDelivery ? "Leaving" : "Ready"} at about ${order.readyEta.at.toLocaleTimeString("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "numeric",
          minute: "2-digit",
        })}`
    : null;
  const cancelled = status === "CANCELLED" || status === "FAILED" || status === "REFUNDED";
  const currentIndex = STEPS.findIndex((step) => !(step.reached as readonly string[]).includes(status));
  const activeIndex = currentIndex === -1 ? STEPS.length - 1 : Math.max(0, currentIndex - 1);

  return (
    <div className="mx-auto w-full max-w-2xl px-[var(--gutter)] py-10 sm:py-14">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">Order received</p>
      <h1 className="mt-2 font-heading text-4xl font-bold tracking-tight sm:text-5xl">
        <span className="tabular">#{order.orderNumber}</span>
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
        Thanks{order.customerName ? `, ${order.customerName}` : ""}.{" "}
        {isDelivery ? "We'll call when it's on its way." : "We'll call when it's ready to collect."}
      </p>

      {/*
        When the kitchen said it would be ready.
        Shown as a clock time rather than "in 20 minutes": this page does not
        refresh itself, so a relative figure would quietly become a lie while
        somebody sat looking at it.
      */}
      {!cancelled && readyLabel && status !== "COMPLETED" && (
        <p className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 font-semibold">
          <Clock className="size-4 shrink-0 text-primary" aria-hidden="true" />
          {readyLabel}
        </p>
      )}

      {cancelled ? (
        <div role="alert" className="mt-8 rounded-lg border border-border bg-surface p-5">
          <p className="font-heading text-lg font-semibold">This order was {status.toLowerCase()}.</p>
          <p className="mt-1 text-sm text-muted-foreground">Call the shop if that wasn&rsquo;t expected.</p>
        </div>
      ) : (
        <ol className="mt-8 flex flex-col gap-0 rounded-lg border border-border bg-surface p-5">
          {STEPS.map((step, index) => {
            const done = (step.reached as readonly string[]).includes(status);
            const active = index === activeIndex && !done;
            return (
              <li key={step.key} className="flex items-center gap-3 py-2.5">
                <span
                  className={
                    done
                      ? "flex size-6 items-center justify-center rounded-full bg-[#3F9D52] text-[#0B1A0E]"
                      : active
                        ? "flex size-6 items-center justify-center rounded-full border-2 border-primary text-primary"
                        : "flex size-6 items-center justify-center rounded-full border-2 border-border text-muted-foreground"
                  }
                  aria-hidden="true"
                >
                  {done ? <Check className="size-3.5" /> : <Circle className="size-2 fill-current" />}
                </span>
                <span className={done || active ? "font-semibold" : "text-muted-foreground"}>{step.label}</span>
                {/* Status is never colour alone — §55. */}
                <span className="sr-only">{done ? "done" : active ? "in progress" : "not yet"}</span>
              </li>
            );
          })}
        </ol>
      )}

      <section aria-labelledby="items" className="mt-8">
        <h2 id="items" className="font-heading text-lg font-semibold">
          What you ordered
        </h2>
        <ul className="mt-4 flex flex-col gap-3">
          {order.items.map((item, index) => (
            <li key={index} className="flex items-start justify-between gap-4 border-b border-border pb-3">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-medium">
                  <span className="tabular">{item.quantity}×</span> {item.name}
                </p>
                {item.modifiers.length > 0 && (
                  <p className="text-sm text-muted-foreground">{item.modifiers.join(" · ")}</p>
                )}
              </div>
              <span className="tabular font-semibold">{formatINR(item.total as Paise)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-baseline justify-between gap-4">
          <span className="font-heading text-lg font-semibold">
            {isDelivery ? "To pay on delivery" : "To pay at the counter"}
          </span>
          <span className="tabular text-2xl font-bold">{formatINR(order.grandTotal as Paise)}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Cash, UPI or card.</p>
      </section>

      {/*
        FRYBIRD REWARDS, told straight for what actually happened to *this*
        order. A stamp is only real once the money has arrived — showing one
        before that would be a promise the payment could still fail to keep.
      */}
      {order.stampRewardDiscount > 0n ? (
        <p className="mt-6 flex items-center gap-2 rounded-lg border-[2.5px] border-[var(--ink)] bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-[4px_4px_0_var(--red-deep)]">
          <Gift className="size-4 shrink-0" aria-hidden="true" />
          Your FRYBIRD REWARDS free item ({formatINR(paise(order.stampRewardDiscount))}) is on this order.
        </p>
      ) : order.stampEarned ? (
        <p className="mt-6 flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm font-semibold">
          <Flame className="size-4 shrink-0 text-primary" aria-hidden="true" fill="currentColor" />
          This order earned you a FRYBIRD REWARDS stamp.
        </p>
      ) : (
        status === "PENDING_PAYMENT" && (
          <p className="mt-6 text-sm text-muted-foreground">This order earns a FRYBIRD REWARDS stamp once it&rsquo;s paid, if it qualifies.</p>
        )
      )}

      {/* Only once the order is finished. Asking someone to score food that has
          not arrived turns a bad minute during the wait into a permanent one
          star. */}
      {order.status === "COMPLETED" && (
        <section
          aria-labelledby="rate"
          className="mt-10 rounded-2xl border-[2.5px] border-[var(--ink)] bg-[var(--cream-hi)] p-5 shadow-[6px_6px_0_var(--red)]"
        >
          <h2 id="rate" className="sr-only">
            Rate this order
          </h2>
          <OrderRating orderId={order.id} initial={rating} />
        </section>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Link
          href="/menu"
          className="inline-flex min-h-[48px] items-center rounded-md border border-border-strong px-5 font-semibold transition-colors hover:bg-surface"
        >
          Order something else
        </Link>

        <Link
          href={`/order/${order.id}/invoice`}
          className="inline-flex min-h-[48px] items-center gap-2 rounded-md border border-border px-5 font-semibold transition-colors hover:bg-surface"
        >
          <FileText className="size-4" aria-hidden="true" />
          {/* An invoice number only exists once the order is paid. */}
          {order.invoiceNumber ? "Invoice" : "Receipt"}
        </Link>
      </div>
    </div>
  );
}
