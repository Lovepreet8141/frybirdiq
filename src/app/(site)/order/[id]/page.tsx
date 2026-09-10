import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Circle } from "lucide-react";
import { formatINR } from "@/lib/money";
import { type Paise } from "@/lib/money";
import { getOrder } from "@/lib/repositories/orders";
import type { OrderStatus } from "@/domain/order-status";

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
const STEPS = [
  { key: "received", label: "Order received", reached: ["PENDING_PAYMENT", "PAID", "ACCEPTED", "PREPARING", "READY", "COMPLETED"] },
  { key: "accepted", label: "Kitchen accepted", reached: ["ACCEPTED", "PREPARING", "READY", "COMPLETED"] },
  { key: "preparing", label: "Preparing", reached: ["PREPARING", "READY", "COMPLETED"] },
  { key: "ready", label: "Ready to collect", reached: ["READY", "COMPLETED"] },
  { key: "collected", label: "Collected", reached: ["COMPLETED"] },
] as const;

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();

  const status = order.status as OrderStatus;
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
        Thanks{order.customerName ? `, ${order.customerName}` : ""}. We&rsquo;ll call when it&rsquo;s ready to collect.
      </p>

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
          <span className="font-heading text-lg font-semibold">To pay at the counter</span>
          <span className="tabular text-2xl font-bold">{formatINR(order.grandTotal as Paise)}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Includes GST. Cash, UPI or card.</p>
      </section>

      <Link
        href="/menu"
        className="mt-10 inline-flex min-h-[48px] items-center rounded-md border border-border-strong px-5 font-semibold transition-colors hover:bg-surface"
      >
        Order something else
      </Link>
    </div>
  );
}
