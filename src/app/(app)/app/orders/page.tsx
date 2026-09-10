import type { Metadata } from "next";
import { OrderCard, type StaffOrder } from "@/components/staff/order-card";
import { EmptyState } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { listActiveOrders } from "@/lib/repositories/orders";

export const metadata: Metadata = { title: "Orders", robots: { index: false, follow: false } };

// Counter screen: always the live list, never a cached one.
export const dynamic = "force-dynamic";

export default async function StaffOrdersPage() {
  const staff = await requireStaff();
  const [orders, canSettle, canAdvance] = await Promise.all([
    listActiveOrders(staff.orgId),
    staffCan("orders.update"),
    staffCan("kitchen.update"),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl px-[var(--gutter)] py-8">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Orders</h1>
        <p className="tabular text-sm text-muted-foreground" aria-live="polite">
          {orders.length} open
        </p>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          className="mt-8"
          title="No open orders."
          detail="New website orders appear here."
        />
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              canSettle={canSettle}
              canAdvance={canAdvance}
              order={
                {
                  ...order,
                  placedAt: order.placedAt?.toISOString() ?? null,
                  items: [...order.items].map((item) => ({ ...item, modifiers: [...item.modifiers] })),
                } as StaffOrder
              }
            />
          ))}
        </ul>
      )}

      {/*
        Orders do not appear on their own yet — realtime is Phase 3. Saying so
        beats a screen that looks live and silently isn't, which is how a
        counter misses an order.
      */}
      <p className="mt-8 text-sm text-muted-foreground">
        This list updates when you reload. Live updates are not built yet.
      </p>
    </div>
  );
}
