import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AutoPrint } from "@/components/staff/auto-print";
import { PermissionDenied } from "@/components/states";
import { ORDER_CHANNEL_LABELS } from "@/domain/order-channel";
import { requireStaff, staffCan } from "@/lib/auth";
import { getKotOrder } from "@/lib/repositories/orders";

export const metadata: Metadata = { title: "Kitchen ticket", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const FULFILMENT_NOTE: Record<string, string> = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
};

/**
 * The kitchen order ticket — a standalone printable page, not a screen.
 *
 * Opened in its own tab (see `openKotWindow` in the staff order card and the
 * accept flow) so `window.print()` targets only this ticket, never the
 * staff shell around it. It carries no price: a KOT tells the kitchen what
 * to cook, not what the customer owes — that number belongs on a bill, and
 * putting it here would let a torn or reprinted ticket be mistaken for one.
 */
export default async function KotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff();

  const canView = await staffCan("kitchen.view");
  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-md p-8">
        <PermissionDenied action="view kitchen tickets" />
      </div>
    );
  }

  const order = await getKotOrder(id, staff.orgId);
  if (!order) notFound();

  const placedAtLabel = order.placedAt
    ? new Date(order.placedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className="min-h-dvh bg-[#f4f4f4] py-8 print:min-h-0 print:bg-white print:py-0">
      <AutoPrint />
      <div className="mx-auto w-[320px] bg-white p-5 font-mono text-[13px] leading-snug text-black shadow-md print:w-full print:p-0 print:shadow-none">
        <p className="text-center text-sm font-bold uppercase tracking-[0.15em]">Kitchen ticket</p>
        <p className="tabular text-center text-3xl font-black leading-tight">#{order.orderNumber}</p>

        <hr className="my-3 border-dashed border-black/60" />

        <p className="font-bold uppercase">
          {ORDER_CHANNEL_LABELS[order.channel]}
          {order.tableLabel ? ` · Table ${order.tableLabel}` : ""}
        </p>
        <p>{order.fulfilment !== order.channel ? FULFILMENT_NOTE[order.fulfilment] : null}</p>
        {placedAtLabel && <p>Placed {placedAtLabel}</p>}
        {order.customerName && <p>{order.customerName}</p>}

        <hr className="my-3 border-dashed border-black/60" />

        <ul className="flex flex-col gap-2.5">
          {order.items.map((item, index) => (
            <li key={index}>
              <p className="tabular font-bold">
                {item.quantity}× {item.name}
              </p>
              {item.modifiers.length > 0 && <p className="pl-4 text-[12px] text-black/80">{item.modifiers.join(", ")}</p>}
            </li>
          ))}
        </ul>

        {order.notes && (
          <>
            <hr className="my-3 border-dashed border-black/60" />
            <p className="italic">Note: {order.notes}</p>
          </>
        )}

        <hr className="my-3 border-dashed border-black/60" />
        <p className="text-center text-[11px] text-black/60">
          Printed {new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}
        </p>
      </div>
    </div>
  );
}
