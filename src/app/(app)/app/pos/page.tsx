import type { Metadata } from "next";
import { PosShell } from "@/components/pos/pos-shell";
import { PosViewTabs } from "@/components/pos/pos-view-tabs";
import { TablesView } from "@/components/pos/tables-view";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { getMenu } from "@/lib/repositories/menu";
import { getOrder, type OrderView } from "@/lib/repositories/orders";
import { listTables, listUnassignedDineInOrders } from "@/lib/repositories/tables";

export const metadata: Metadata = { title: "POS", robots: { index: false, follow: false } };

// A counter screen: always today's menu and never a cached one.
export const dynamic = "force-dynamic";

/**
 * The POS shell and product grid. BUILD-PLAN.md Phase 4.
 *
 * Payment, receipts and order history are not built here — this screen only
 * builds and prices an order. `orders.create` gates it: a role that cannot
 * create an order (KITCHEN, RIDER, INVENTORY, ANALYST) is told so rather than
 * shown an empty grid. §41 — hiding the page is not the check; the pricing
 * action re-checks the same permission on every call.
 */
export default async function PosPage() {
  const canCreate = await staffCan("orders.create");
  const canLookupCustomers = await staffCan("customers.view");

  if (!canCreate) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="build an order here" />
      </div>
    );
  }

  const menu = await getMenu();

  if (menu.length === 0) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <p className="text-center text-muted-foreground">
          The menu is empty. Add categories and products before taking orders at the counter.
        </p>
      </div>
    );
  }

  const staff = await requireStaff();
  const canAddTable = await staffCan("settings.manage");
  const [tables, unassignedOrders] = await Promise.all([
    listTables(staff.orgId),
    listUnassignedDineInOrders(staff.orgId),
  ]);

  const openOrders = await Promise.all(
    tables.flatMap((table) => (table.openOrder ? [getOrder(table.openOrder.id)] : [])),
  );
  const orderDetails = new Map<string, OrderView>();
  for (const order of openOrders) if (order) orderDetails.set(order.id, order);

  return (
    <PosViewTabs
      order={<PosShell categories={menu} canLookupCustomers={canLookupCustomers} />}
      tables={
        <TablesView tables={tables} orderDetails={orderDetails} unassignedOrders={unassignedOrders} canAddTable={canAddTable} />
      }
    />
  );
}
