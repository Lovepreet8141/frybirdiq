import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DeliveryCard, type RiderDelivery } from "@/components/staff/delivery-card";
import { EmptyState } from "@/components/states";
import { getStaff, staffCan } from "@/lib/auth";
import { listDeliveries } from "@/lib/repositories/orders";

export const metadata: Metadata = { title: "Deliveries", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function DeliveriesPage() {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("delivery.view"))) redirect("/app/orders");

  const deliveries = await listDeliveries(staff.orgId);
  const onTheRoad = deliveries.filter((d) => d.status === "OUT_FOR_DELIVERY");

  return (
    <div className="mx-auto w-full max-w-2xl px-[var(--gutter)] py-8">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Deliveries</h1>
        <p className="tabular text-sm text-muted-foreground" aria-live="polite">
          {onTheRoad.length} out
        </p>
      </div>

      {deliveries.length === 0 ? (
        <EmptyState
          className="mt-8"
          title="Nothing to deliver."
          detail="Delivery orders appear here once the kitchen marks them ready. Collection orders never do — they are handed over at the counter."
        />
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {deliveries.map((order) => (
            <DeliveryCard
              key={order.id}
              delivery={
                {
                  id: order.id,
                  orderNumber: order.orderNumber,
                  status: order.status,
                  customerName: order.customerName,
                  customerPhone: order.customerPhone,
                  grandTotal: order.grandTotal,
                  isPaid: order.isPaid,
                  items: order.items.map((item) => ({ ...item, modifiers: [...item.modifiers] })),
                  notes: order.notes,
                  delivery: order.delivery ? { ...order.delivery } : null,
                } satisfies RiderDelivery
              }
            />
          ))}
        </ul>
      )}

      <p className="mt-8 text-sm text-muted-foreground">
        This list updates when you reload. Live updates are not built yet.
      </p>
    </div>
  );
}
