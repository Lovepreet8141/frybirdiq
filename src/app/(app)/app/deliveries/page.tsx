import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DeliveryCard, type RiderDelivery } from "@/components/staff/delivery-card";
import { LiveRefresh } from "@/components/staff/live-refresh";
import { PageHeader } from "@/components/staff/page-header";
import { SectionHeading } from "@/components/iq/ui";
import { EmptyState, PermissionDenied } from "@/components/states";
import { getStaff, staffCan } from "@/lib/auth";
import { listDeliveries } from "@/lib/repositories/orders";

export const metadata: Metadata = { title: "Deliveries", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function DeliveriesPage() {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");

  const canView = await staffCan("delivery.view");
  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view deliveries" />
      </div>
    );
  }

  const deliveries = await listDeliveries(staff.orgId);
  const onTheRoad = deliveries.filter((d) => d.status === "OUT_FOR_DELIVERY");
  const waiting = deliveries.length - onTheRoad.length;

  const headline =
    deliveries.length === 0
      ? "Nothing to deliver right now."
      : onTheRoad.length === 0
        ? `${deliveries.length} ${deliveries.length === 1 ? "delivery is" : "deliveries are"} waiting for the kitchen.`
        : `${onTheRoad.length} ${onTheRoad.length === 1 ? "delivery is" : "deliveries are"} on the road.`;

  const meta =
    waiting === 0
      ? `${onTheRoad.length} on the road`
      : `${onTheRoad.length} on the road · ${waiting} waiting for the kitchen`;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-[var(--gutter)] py-6 md:py-8">
      <LiveRefresh orgId={staff.orgId} />

      <PageHeader title="Deliveries" description={<span aria-live="polite">{headline}</span>} />

      {deliveries.length === 0 ? (
        <EmptyState
          title="Nothing to deliver."
          detail="Delivery orders appear here once the kitchen marks them ready. Collection orders never do — they are handed over at the counter."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <SectionHeading id="deliveries-heading" title="Today's deliveries" note={meta} />
          <ul aria-labelledby="deliveries-heading" className="flex flex-col gap-3">
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
        </div>
      )}
    </div>
  );
}
