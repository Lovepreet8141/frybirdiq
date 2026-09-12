import type { Metadata } from "next";
import { CustomersTable } from "@/components/staff/customers-table";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { listCustomers } from "@/lib/repositories/customers";

export const metadata: Metadata = { title: "Customers", robots: { index: false, follow: false } };

// A phone number just placed an order and the counter is looking it up —
// never a page that's a request behind on who ordered what.
export const dynamic = "force-dynamic";

/**
 * The customer list. BUILD-PLAN.md's Customers module — real data
 * (`customers`, paid `orders`, `loyaltyAccounts`), no new business logic:
 * every figure here is the same "paid order" definition `analytics.ts`
 * already uses for revenue.
 */
export default async function CustomersPage() {
  const staff = await requireStaff();
  const canView = await staffCan("customers.view");

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view customers" />
      </div>
    );
  }

  const customers = await listCustomers(staff.orgId);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Customers"
        description="Every customer who has placed an order, with lifetime spend and FRYBIRD REWARDS progress."
      />
      <CustomersTable
        customers={customers.map((customer) => ({
          ...customer,
          lastOrderAt: customer.lastOrderAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
