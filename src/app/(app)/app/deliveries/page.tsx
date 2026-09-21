import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DeliveryCard, type RiderDelivery } from "@/components/staff/delivery-card";
import { DeliveryOfferCard } from "@/components/staff/delivery-offer-card";
import { LiveRefresh } from "@/components/staff/live-refresh";
import { PageHeader } from "@/components/staff/page-header";
import { SectionHeading } from "@/components/iq/ui";
import { EmptyState, PermissionDenied } from "@/components/states";
import { getStaff, staffCan } from "@/lib/auth";
import { seesOnlyOwnDeliveries } from "@/domain/permissions";
import { listDeliveries } from "@/lib/repositories/orders";
import { listAssignableRiders, listRiderDeliveries } from "@/lib/repositories/rider-assignment";

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

  // A rider sees their own deliveries in full and the unassigned ones as "Available" offers (pickup-level facts only);
  // the counter and managers see all deliveries and can assign (roadmap 6.3, rider-offer).
  const riderOnly = seesOnlyOwnDeliveries(staff.roles);
  const canAssign = await staffCan("delivery.assign");
  const riderView = riderOnly ? await listRiderDeliveries(staff.orgId, staff.userId) : null;
  const deliveries = riderView ? riderView.mine : await listDeliveries(staff.orgId);
  const offers = riderView?.offers ?? [];
  const riders = canAssign ? await listAssignableRiders(staff.orgId) : undefined;
  const onTheRoad = deliveries.filter((d) => d.status === "OUT_FOR_DELIVERY");
  const waiting = deliveries.length - onTheRoad.length;

  const headline =
    deliveries.length === 0 && offers.length === 0
      ? "Nothing to deliver right now."
      : deliveries.length === 0
        ? `${offers.length} ${offers.length === 1 ? "delivery is" : "deliveries are"} available to take.`
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

      {offers.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionHeading id="offers-heading" title="Available" note={`${offers.length} to take`} />
          <ul aria-labelledby="offers-heading" className="flex flex-col gap-3">
            {offers.map((offer) => (
              <DeliveryOfferCard key={offer.id} offer={offer} />
            ))}
          </ul>
        </div>
      )}

      {deliveries.length === 0 && offers.length > 0 ? null : deliveries.length === 0 ? (
        <EmptyState
          title="Nothing to deliver."
          detail={seesOnlyOwnDeliveries(staff.roles) ? "Deliveries appear here as Available once the kitchen marks them ready, and stay under Yours once you take one." : "Delivery orders appear here once the kitchen marks them ready. Collection orders never do — they are handed over at the counter."}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <SectionHeading id="deliveries-heading" title={riderOnly ? "Yours" : "Today's deliveries"} note={meta} />
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
                    riderUserId: order.riderUserId,
                    delivery: order.delivery ? { ...order.delivery } : null,
                  } satisfies RiderDelivery
                }
                riders={riders}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
