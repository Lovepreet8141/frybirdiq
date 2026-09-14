import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OrderStatus } from "@/domain/order-status";
import { cn } from "@/lib/utils";

export interface ActivityRow {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly to: OrderStatus;
  readonly actorName: string | null;
  readonly at: Date;
}

const STATUS_WORD: Partial<Record<OrderStatus, string>> = {
  DRAFT: "drafted",
  PENDING_PAYMENT: "placed",
  PAID: "paid",
  ACCEPTED: "accepted",
  PREPARING: "cooking",
  READY: "ready",
  OUT_FOR_DELIVERY: "out for delivery",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  REFUNDED: "refunded",
  FAILED: "failed",
};

const TONE: Partial<Record<OrderStatus, string>> = {
  READY: "bg-status-ready-dot",
  COMPLETED: "bg-gain",
  CANCELLED: "bg-loss",
  FAILED: "bg-loss",
  REFUNDED: "bg-loss",
  PREPARING: "bg-status-cooking-dot",
  ACCEPTED: "bg-status-accepted-dot",
  OUT_FOR_DELIVERY: "bg-status-out-for-delivery-dot",
};

const clock = (date: Date) => date.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });

/** The last few order movements from the append-only history — a dot for the status, the order, who, when. Same rows as the Activity screen. */
export function ActivityCard({ events, className }: { events: readonly ActivityRow[]; className?: string }) {
  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>Latest order movements</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" asChild>
            <Link href="/app/iq/activity">
              All
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">No order has moved yet today.</p>
        ) : (
          <ol className="flex flex-col">
            {events.map((event) => (
              <li key={event.id} className="flex items-start gap-2.5 border-b border-border py-2 last:border-b-0 last:pb-0 first:pt-0">
                <span className={cn("mt-[6px] size-[7px] shrink-0 rounded-full", TONE[event.to] ?? "bg-muted-foreground/50")} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px]">
                    <Link href={`/app/orders?open=${event.orderId}`} className="tabular font-semibold underline-offset-2 hover:underline">
                      #{event.orderNumber}
                    </Link>{" "}
                    <span className="text-muted-foreground">{STATUS_WORD[event.to] ?? event.to.toLowerCase()}</span>
                  </p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {event.actorName ?? "System"} · {clock(event.at)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
