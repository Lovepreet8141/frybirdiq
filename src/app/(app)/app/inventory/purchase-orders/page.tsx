import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PurchaseOrdersTable } from "@/components/inventory/purchase-orders-table";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { Button } from "@/components/ui/button";
import { requireStaff, staffCan } from "@/lib/auth";
import { listPurchaseOrders } from "@/lib/repositories/purchase-orders";

export const metadata: Metadata = { title: "Purchase orders", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage() {
  const staff = await requireStaff();
  const [canView, canManage] = await Promise.all([staffCan("inventory.view"), staffCan("purchasing.manage")]);
  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view purchase orders" />
      </div>
    );
  }

  const orders = await listPurchaseOrders(staff.orgId);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Purchase orders"
        description="Draft, send and receive orders from suppliers. Receiving one lands stock and updates the ingredient's price."
        actions={
          canManage ? (
            <Button variant="inverse" asChild>
              <Link href="/app/inventory/purchase-orders/new">
                <Plus data-icon="inline-start" aria-hidden="true" />
                New purchase order
              </Link>
            </Button>
          ) : undefined
        }
      />
      <PurchaseOrdersTable orders={orders} />
    </div>
  );
}
