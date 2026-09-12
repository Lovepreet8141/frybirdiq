import type { Metadata } from "next";
import { SuppliersTable } from "@/components/inventory/suppliers-table";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { listSuppliers } from "@/lib/repositories/inventory";

export const metadata: Metadata = { title: "Suppliers", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const staff = await requireStaff();
  const [canView, canManage] = await Promise.all([staffCan("inventory.view"), staffCan("purchasing.manage")]);
  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view suppliers" />
      </div>
    );
  }

  const suppliers = await listSuppliers(staff.orgId);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader title="Suppliers" description="Who you buy from. Prices and purchase orders are recorded against them." />
      <SuppliersTable suppliers={suppliers} canManage={canManage} />
    </div>
  );
}
