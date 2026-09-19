import type { Metadata } from "next";
import { DeviceAgent } from "@/components/hardware/device-agent";
import { PosShell } from "@/components/pos/pos-shell";
import { PosViewTabs } from "@/components/pos/pos-view-tabs";
import { ShopSwitch } from "@/components/pos/shop-switch";
import { TablesView } from "@/components/pos/tables-view";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { getMenu } from "@/lib/repositories/menu";
import { requireOrg } from "@/lib/repositories/org";
import { getOrder, type OrderView } from "@/lib/repositories/orders";
import { getActiveReceiptTemplate } from "@/lib/repositories/receipt";
import { getOrderingStatusForStaff } from "@/lib/repositories/shop-status";
import { listTables, listUnassignedDineInOrders } from "@/lib/repositories/tables";

export const metadata: Metadata = { title: "POS", robots: { index: false, follow: false } };

// A counter screen: always today's menu and never a cached one.
export const dynamic = "force-dynamic";

/**
 * The POS shell and product grid. BUILD-PLAN.md Phase 4.
 *
 * Builds an order, prices it, takes the cash and prints the slip.
 * `orders.create` gates the screen: a role that cannot create an order
 * (KITCHEN, RIDER, INVENTORY, ANALYST) is told so rather than shown an empty
 * grid. §41 — hiding the page is not the check; every action behind it
 * re-checks the same permission on each call, and the money itself is gated
 * separately on `orders.update` inside `recordCashPayment`.
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
  const org = await requireOrg();
  const canAddTable = await staffCan("settings.manage");
  // A second copy of a bill is a manager's call, like a refund.
  const canDuplicate = await staffCan("orders.refund");
  // Pausing online orders is a counter decision (ops-1 ruling D2): orders.update, which the action checks again.
  const canSwitchOrdering = await staffCan("orders.update");
  const [tables, unassignedOrders, receiptTemplate, orderingStatus] = await Promise.all([
    listTables(staff.orgId),
    listUnassignedDineInOrders(staff.orgId),
    // The design the owner last applied on Bill & Receipt; the till prints it without knowing there is a designer.
    getActiveReceiptTemplate(staff.orgId),
    // The Close Shop switch reads the same state the ordering gate does, never the columns (ops-1 RULE 1).
    getOrderingStatusForStaff(staff.orgId),
  ]);

  const openOrders = await Promise.all(
    tables.flatMap((table) => (table.openOrder ? [getOrder(table.openOrder.id)] : [])),
  );
  const orderDetails = new Map<string, OrderView>();
  for (const order of openOrders) if (order) orderDetails.set(order.id, order);

  return (
    <PosViewTabs
      headerEnd={
        orderingStatus && (
          <ShopSwitch orgId={staff.orgId} initialStatus={orderingStatus} renderedAt={new Date().toISOString()} canSwitch={canSwitchOrdering} />
        )
      }
      order={
        // The device agent registers a FRYBIRD POS device, watches its printer and prints; a plain browser gets nothing but the truth.
        <DeviceAgent autoRegister>
          <PosShell
            orgId={staff.orgId}
            categories={menu}
            canLookupCustomers={canLookupCustomers}
            canDuplicate={canDuplicate}
            shopName={org.name}
            receiptTemplate={receiptTemplate}
            tables={tables.map((table) => ({ id: table.id, name: table.name, available: table.openOrder === null }))}
          />
        </DeviceAgent>
      }
      tables={
        <TablesView tables={tables} orderDetails={orderDetails} unassignedOrders={unassignedOrders} canAddTable={canAddTable} />
      }
    />
  );
}
