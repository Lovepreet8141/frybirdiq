import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EmptyState } from "@/components/states";
import { OrderHistoryList } from "@/components/account/order-history";
import { getCustomer } from "@/lib/customer";
import { listCustomerOrders } from "@/lib/repositories/orders";
import { requireOrg } from "@/lib/repositories/org";

export const metadata: Metadata = { title: "Your orders" };
export const dynamic = "force-dynamic";

export default async function CustomerOrdersPage() {
  const customer = await getCustomer();
  if (!customer) redirect("/account/sign-in");

  const org = await requireOrg();
  const orders = await listCustomerOrders({ customerId: customer.id, orgId: org.id });

  return (
    <div className="mx-auto w-full max-w-3xl px-[var(--gutter)] py-10 sm:py-14">
      <Link
        href="/account"
        className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Account
      </Link>

      <h1 className="mt-4 font-heading text-4xl font-bold tracking-tight">Your orders</h1>

      {orders.length === 0 ? (
        <EmptyState className="mt-8" title="No orders yet." detail="When you order, it'll show up here." />
      ) : (
        <OrderHistoryList orders={orders.map((order) => ({ ...order, placedAt: order.placedAt?.toISOString() ?? null }))} />
      )}
    </div>
  );
}
