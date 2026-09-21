import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/uuid";
import { Check, Circle, Clock, FileText, Flame, Gift } from "lucide-react";
import { formatINR } from "@/lib/money";
import { type Paise, paise } from "@/lib/money";
import { getOrder } from "@/lib/repositories/orders";
import { getOrg, getStoreContact } from "@/lib/repositories/org";
import { shopPhone } from "@/lib/contact/phone";
import { CallShop } from "@/components/site/call-shop";
import { getRating } from "@/lib/ratings";
import { getCustomer } from "@/lib/customer";
import { getCustomerOrderingStatus } from "@/lib/cart/ordering-status";
import { orderingControls } from "@/lib/cart/ordering-banner";
import { pendingPaymentNotice } from "@/lib/cart/pending-payment-copy";
import { readRememberedContact } from "@/lib/cart/remembered-contact";
import { OrderRating } from "@/components/order/rating";
import { PayOnline } from "@/components/order/pay-online";
import { ProgressNote } from "@/components/loyalty/progress-note";
import { OrderLive } from "@/components/order/order-live";
import { RiderTracker } from "@/components/order/rider-tracker";
import { greetingName, viewerOwnsOrder } from "@/components/order/viewer-owns-order";
import { RAZORPAY_PROVIDER, razorpayConfig } from "@/lib/payments";
import type { FulfilmentType, OrderStatus } from "@/domain/order-status";

export const metadata: Metadata = { title: "Your order" };

/**
 * Order tracking. BUILD-PLAN.md §62.
 *
 * The steps a collection order actually passes through. No estimated-minutes
 * countdown, and the rider's map appears only when the rider's phone is really reporting a position (Lane B) — §62 is explicit: "Do not fake live location if
 * the system does not actually have reliable data." The shop calls when it is
 * ready, and the page says exactly that.
 *
 * The page keeps itself current (roadmap 2.3): the order's own broadcast
 * topic re-runs this render when the kitchen moves it, with a slow poll
 * behind it, until the order is finished.
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

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ pay?: string }> }) {
  const [{ id }, { pay }] = await Promise.all([params, searchParams]);
  // A mangled link is not a uuid; querying a uuid column with it throws (a 500), so it is a 404 here.
  if (!isUuid(id)) notFound();
  const [order, customer, remembered] = await Promise.all([getOrder(id), getCustomer(), readRememberedContact()]);
  if (!order) notFound();
  // The number comes from the outlet row; null when unset or unusable, and then
  // no copy below tells the customer to call.
  const phone = shopPhone((await getStoreContact())?.phone);
  // While the Close Shop switch is on, the pay button is hidden for a pending online order. That is display
  // only: the payment action has no pause check, so a Razorpay checkout that is already open can still be
  // completed, and an order that was already placed may still be paid (owner decision, 2026-09-20). Only
  // NEW orders are refused while paused, by the gate in placeOrder.
  // Tracking itself works as normal. Read through getOrderingStatus only (ops-1 RULE 1).
  const paused = !orderingControls(await getCustomerOrderingStatus()).canOrder;
  const org = await getOrg();
  const isOwner = viewerOwnsOrder(order, customer, remembered);
  const greetedName = greetingName(order.customerName, isOwner);

  /*
   * Online payment states. Roadmap 1.5: a pending Razorpay payment shows the
   * payment window (opening at once straight after checkout); a captured one
   * says "Paid"; a failed attempt says so and offers a retry. The order's own
   * status never changes from this page — only the server's settlement does.
   */
  const online = order.payment?.provider === RAZORPAY_PROVIDER ? order.payment : null;
  const paidOnline = online?.status === "CAPTURED";
  const awaitingOnline = online !== null && online.status === "PENDING" && order.status === "PENDING_PAYMENT";
  const razorpay = awaitingOnline ? razorpayConfig() : null;

  // Only fetched for a finished order — nothing else can carry a rating.
  const rating = order.status === "COMPLETED" ? await getRating(order.id) : null;

  const status = order.status as OrderStatus;
  const isDelivery = order.fulfilment === "DELIVERY";
  // Same condition gates the pay widget, the "pay below" line and the fallback.
  const canPayOnline = !paused && awaitingOnline && online !== null && razorpay !== null && Boolean(online.providerOrderId);
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
  const scheduledLabel = order.scheduledFor
    ? `You asked for ${order.scheduledFor.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })}`
    : null;
  const cancelled = status === "CANCELLED" || status === "FAILED" || status === "REFUNDED";
  const currentIndex = STEPS.findIndex((step) => !(step.reached as readonly string[]).includes(status));
  const activeIndex = currentIndex === -1 ? STEPS.length - 1 : Math.max(0, currentIndex - 1);

  return (
    <div className="mx-auto w-full max-w-2xl px-[var(--gutter)] py-10 sm:py-14">
      <OrderLive orderId={order.id} active={!cancelled && status !== "COMPLETED"} />
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">Order received</p>
      <h1 className="mt-2 font-heading text-4xl font-bold tracking-tight sm:text-5xl">
        <span className="tabular">#{order.orderNumber}</span>
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
        Thanks{greetedName ? `, ${greetedName}` : ""}.{" "}
        {awaitingOnline
          ? canPayOnline
            ? "Pay below and the kitchen gets your order straight away."
            : "Your order is saved, but it hasn't been paid for yet."
          : isDelivery
            ? "We'll call when it's on its way."
            : "We'll call when it's ready to collect."}
      </p>

      {canPayOnline && online && razorpay && online.providerOrderId && (
        <PayOnline
          orderId={order.id}
          orderNumber={order.orderNumber}
          keyId={razorpay.keyId}
          providerOrderId={online.providerOrderId}
          amountPaise={Number(online.amount)}
          amountLabel={formatINR(paise(online.amount))}
          prefill={isOwner ? { name: order.customerName, email: order.customerEmail, contact: order.customerPhone } : { name: null, email: null, contact: null }}
          autoOpen={pay === "1"}
          failureReason={online.failureReason}
        />
      )}
      {awaitingOnline && paused && (
        <p role="status" className="mt-6 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          Paying online is on hold while we&rsquo;re not taking orders. Your order is saved, and the pay button comes back when ordering resumes. The kitchen starts your order once it is paid.
          {phone && (
            <span className="mt-1 block">
              <CallShop phone={phone} lead="Questions? Call" />
            </span>
          )}
        </p>
      )}
      {awaitingOnline && !paused && !canPayOnline && (
        <p role="alert" className="mt-6 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          {pendingPaymentNotice({ cashEnabled: org?.cashEnabled ?? false, isDelivery })}
          {phone && (
            <span className="mt-1 block">
              <CallShop phone={phone} lead="Questions? Call" />
            </span>
          )}
        </p>
      )}

      {/*
        When the kitchen said it would be ready.
        Shown as a clock time rather than "in 20 minutes": this page does not
        refresh itself, so a relative figure would quietly become a lie while
        somebody sat looking at it.
      */}
      {!cancelled && scheduledLabel && status !== "COMPLETED" && (
        <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Clock className="size-4 shrink-0" aria-hidden="true" />
          {scheduledLabel}
        </p>
      )}

      {!cancelled && readyLabel && status !== "COMPLETED" && (
        <p className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 font-semibold">
          <Clock className="size-4 shrink-0 text-primary" aria-hidden="true" />
          {readyLabel}
        </p>
      )}

      {/* The rider's live position: the order's owner only, and only while it is out (the API route enforces both again). */}
      {isOwner && isDelivery && status === "OUT_FOR_DELIVERY" && <RiderTracker orderId={order.id} />}

      {cancelled ? (
        <div role="alert" className="mt-8 rounded-lg border border-border bg-surface p-5">
          <p className="font-heading text-lg font-semibold">This order was {status.toLowerCase()}.</p>
          {phone && (
            <p className="mt-1 text-sm text-muted-foreground">
              <CallShop phone={phone} lead="If that wasn't expected, call" />
            </p>
          )}
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
            {paidOnline ? "Paid online" : awaitingOnline ? "To pay now" : isDelivery ? "To pay on delivery" : "To pay at the counter"}
          </span>
          <span className="tabular text-2xl font-bold">{formatINR(order.grandTotal as Paise)}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {paidOnline
            ? `${online?.method === "UPI" ? "UPI" : online?.method === "CARD" ? "Card" : online?.method === "NETBANKING" ? "Net banking" : online?.method === "WALLET" ? "Wallet" : "Online"} · received, thank you.`
            : awaitingOnline
              ? "UPI, card, net banking or wallet."
              : "Cash, UPI or card."}
        </p>
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
      <ProgressNote show={isOwner} orderCarriesReward={order.stampRewardDiscount > 0n} />

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
          View receipt
        </Link>
      </div>
    </div>
  );
}
