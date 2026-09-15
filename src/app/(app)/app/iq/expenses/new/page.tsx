import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { ExpenseForm } from "@/components/iq/expense-form";
import { PageHeader } from "@/components/staff/page-header";
import { EmptyState } from "@/components/states";
import { getStaff, staffCan } from "@/lib/auth";
import { businessDate } from "@/lib/dates";
import { listAccounts, listCategories } from "@/lib/repositories/expenses";

export const metadata: Metadata = {
  title: "Record an expense — FRYBIRD IQ",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function NewExpensePage() {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  // The form writes money, so it needs the finance permission; viewers of the
  // ledger who cannot record are sent back to it rather than shown a form
  // whose submit would fail.
  if (!(await staffCan("finance.manage"))) redirect("/app/iq/expenses");

  const [categories, accounts] = await Promise.all([
    listCategories(staff.orgId),
    listAccounts(staff.orgId),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-[var(--gutter)] py-8">
      <Link
        href="/app/iq/expenses"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground underline-offset-2 hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Expenses
      </Link>

      <PageHeader
        title="Record an expense"
        description="Money out. Revenue comes from your orders automatically — this is the other half."
      />

      {categories.length === 0 ? (
        <EmptyState
          title="No expense categories yet."
          detail="Run pnpm iq:categories to add the standard set, then come back to record this expense."
        />
      ) : (
        <Panel>
          <PanelHeader title="Details" />
          <PanelBody>
            <ExpenseForm
              categories={categories.map((c) => ({ id: c.id, name: c.name, behaviour: c.behaviour }))}
              accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
              today={businessDate(new Date())}
            />
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
