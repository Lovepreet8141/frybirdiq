import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ExpenseForm } from "@/components/iq/expense-form";
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
  if (!(await staffCan("finance.view"))) redirect("/app/iq/expenses");

  const [categories, accounts] = await Promise.all([
    listCategories(staff.orgId),
    listAccounts(staff.orgId),
  ]);

  if (categories.length === 0) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-8">
        <h1 className="font-heading text-2xl font-bold">No expense categories yet</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Run <code className="bg-surface px-1.5 py-0.5">pnpm iq:categories</code> to add the standard set.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-[var(--gutter)] py-8">
      <Link href="/app/iq/expenses" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Expenses
      </Link>
      <h1 className="mt-3 font-heading text-3xl font-bold tracking-tight">Record an expense</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Money out. Revenue comes from your orders automatically — this is the other half.
      </p>

      <ExpenseForm
        categories={categories.map((c) => ({ id: c.id, name: c.name, behaviour: c.behaviour }))}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        today={businessDate(new Date())}
      />
    </div>
  );
}
