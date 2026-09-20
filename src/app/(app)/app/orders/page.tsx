import type { Metadata } from "next";
import type { StaffOrder } from "@/components/staff/order-card";
import { LiveRefresh } from "@/components/staff/live-refresh";
import { listAssignableRiders } from "@/lib/repositories/rider-assignment";
import { OrdersBoard } from "@/components/staff/orders-board";
import { PermissionDenied } from "@/components/states";
import { mayOpenOrdersBoard } from "@/domain/permissions";
import { requireStaff, staffCan } from "@/lib/auth";
import { listActiveOrders } from "@/lib/repositories/orders";

export const metadata: Metadata = { title: "Orders", robots: { index: false, follow: false } };

// Counter screen: always the live list, never a cached one.
export const dynamic = "force-dynamic";

/** The clock the list was fetched at — captured with the data, not read during render. */
async function snapshot(orgId: string) {
  const orders = await listActiveOrders(orgId);
  return { orders, nowMs: Date.now() };
}

export default async function StaffOrdersPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const staff = await requireStaff();
  // The board lists every open order with customer phones and delivery addresses: the counter and the kitchen only.
  // A rider has their own scoped Deliveries page. Checked BEFORE any order is read.
  if (!mayOpenOrdersBoard(staff.roles)) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view the orders board" />
      </div>
    );
  }
  const [{ open }, { orders, nowMs }, canSettle, canAdvance, canPrintKot, canSeeCustomers, canAssign] = await Promise.all([
    searchParams,
    snapshot(staff.orgId),
    staffCan("orders.update"),
    staffCan("kitchen.update"),
    staffCan("kitchen.view"),
    staffCan("customers.view"),
    staffCan("delivery.assign"),
  ]);
  const riders = canAssign ? await listAssignableRiders(staff.orgId) : undefined;

  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-6 px-[var(--gutter)] py-8">
      <OrdersBoard
        orders={orders.map(
          (order) =>
            ({
              ...order,
              placedAt: order.placedAt?.toISOString() ?? null,
              fulfilment: order.fulfilment,
              invoiceNumber: order.invoiceNumber,
              estimatedReadyAt: order.estimatedReadyAt?.toISOString() ?? null,
              scheduledFor: order.scheduledFor?.toISOString() ?? null,
              delivery: order.delivery ? { ...order.delivery } : null,
              items: [...order.items].map((item) => ({ ...item, modifiers: [...item.modifiers] })),
            }) as StaffOrder,
        )}
        nowMs={nowMs}
        canSettle={canSettle}
        canAdvance={canAdvance}
        canPrintKot={canPrintKot}
        canSeeCustomers={canSeeCustomers}
        riders={riders}
        initialSelectedId={open ?? null}
      />

      {/* Orders arrive on their own: every order event re-runs this page (roadmap 2.1), with a slow poll behind it. */}
      <LiveRefresh orgId={staff.orgId} />
    </div>
  );
}
