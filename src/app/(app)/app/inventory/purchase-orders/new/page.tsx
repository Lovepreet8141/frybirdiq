import type { Metadata } from "next";
import { Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { PurchaseOrderForm } from "@/components/inventory/purchase-order-form";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { listIngredients, listSuppliers } from "@/lib/repositories/inventory";

export const metadata: Metadata = { title: "New purchase order", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewPurchaseOrderPage() {
  const staff = await requireStaff();
  const canManage = await staffCan("purchasing.manage");
  if (!canManage) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="create purchase orders" />
      </div>
    );
  }

  const [suppliers, ingredients] = await Promise.all([listSuppliers(staff.orgId), listIngredients(staff.orgId)]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader title="New purchase order" description="What you're ordering, from whom, and what you expect to pay." />
      <Panel>
        <PanelHeader title="Order details" />
        <PanelBody>
          <PurchaseOrderForm
            suppliers={suppliers.filter((supplier) => supplier.isActive).map((supplier) => ({ id: supplier.id, name: supplier.name }))}
            ingredients={ingredients
              .filter((ingredient) => ingredient.isActive)
              .map((ingredient) => ({ id: ingredient.id, name: ingredient.name, baseUnit: ingredient.baseUnit, isPackaging: ingredient.isPackaging }))}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
