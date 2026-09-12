import type { Metadata } from "next";
import type { StaffOrder } from "@/components/staff/order-card";
import { OrdersTable } from "@/components/staff/orders-table";
import { PageHeader } from "@/components/staff/page-header";
import { EmptyState } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { listActiveOrders } from "@/lib/repositories/orders";

export const metadata: Metadata = { title: "Orders", robots: { index: false, follow: false } };

// Counter screen: always the live list, never a cached one.
export const dynamic = "force-dynamic";

export default async function StaffOrdersPage() {
  const staff = await requireStaff();
  const [orders, canSettle, canAdvance, canPrintKot] = await Promise.all([
    listActiveOrders(staff.orgId),
    staffCan("orders.update"),
    staffCan("kitchen.update"),
    staffCan("kitchen.view"),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Orders"
        actions={
          <p className="tabular text-sm text-muted-foreground" aria-live="polite">
            {orders.length} open
          </p>
        }
      />

      {orders.length === 0 ? (
        <EmptyState title="No open orders." detail="New website orders appear here." />
      ) : (
        <OrdersTable
          orders={orders.map(
            (order) =>
              ({
                ...order,
                placedAt: order.placedAt?.toISOString() ?? null,
                fulfilment: order.fulfilment,
                invoiceNumber: order.invoiceNumber,
                estimatedReadyAt: order.estimatedReadyAt?.toISOString() ?? null,
                delivery: order.delivery ? { ...order.delivery } : null,
                items: [...order.items].map((item) => ({ ...item, modifiers: [...item.modifiers] })),
              }) as StaffOrder,
          )}
          canSettle={canSettle}
          canAdvance={canAdvance}
          canPrintKot={canPrintKot}
        />
      )}

      {/*
        Orders do not appear on their own yet — realtime is Phase 3. Saying so
        beats a screen that looks live and silently isn't, which is how a
        counter misses an order.
      */}
      <p className="text-sm text-muted-foreground">This list updates when you reload. Live updates are not built yet.</p>
    </div>
  );
}
