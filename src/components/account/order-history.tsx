import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { type Paise, formatINR } from "@/lib/money";
import type { OrderStatus } from "@/domain/order-status";

export interface HistoryOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  fulfilment: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
  grandTotal: Paise;
  pointsEarned: number;
  placedAt: string | null;
  itemSummary: string;
}

const LABEL: Partial<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: "Placed",
  PAID: "Paid",
  ACCEPTED: "Accepted",
  PREPARING: "Being cooked",
  READY: "Ready",
  OUT_FOR_DELIVERY: "On its way",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

/** Dates as a person reads them, not as a machine stores them. */
function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function OrderHistoryList({ orders }: { orders: HistoryOrder[] }) {
  return (
    <ul className="mt-6 flex flex-col gap-3">
      {orders.map((order) => (
        <li key={order.id}>
          <Link
            href={`/order/${order.id}`}
            className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4 transition-colors duration-[var(--duration-standard)] hover:border-border-strong"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="tabular font-heading font-semibold">#{order.orderNumber}</span>
                <span className="text-sm text-muted-foreground">{when(order.placedAt)}</span>
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {LABEL[order.status] ?? order.status}
                </span>
              </div>
              <p className="truncate text-sm text-muted-foreground">{order.itemSummary}</p>
              {order.pointsEarned > 0 && (
                <p className="tabular text-sm text-primary">+{order.pointsEarned} points</p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="tabular font-semibold">{formatINR(order.grandTotal)}</span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
