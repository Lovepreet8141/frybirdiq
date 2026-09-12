import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Gift, LogOut } from "lucide-react";
import { EmptyState } from "@/components/states";
import { OrderHistoryList } from "@/components/account/order-history";
import { getCustomer } from "@/lib/customer";
import { resolveHome } from "@/lib/auth/route-home";
import { isLoyaltyEnabled, pointsValue } from "@/lib/loyalty";
import { getLoyaltyConfig, getStampConfig } from "@/lib/loyalty/config";
import { isStampProgramEnabled } from "@/lib/loyalty/stamps";
import { StampCard } from "@/components/loyalty/stamp-card";
import { formatBps, formatINR } from "@/lib/money";
import { listCustomerOrders } from "@/lib/repositories/orders";
import { getStampAccountState } from "@/lib/repositories/loyalty";
import { requireOrg } from "@/lib/repositories/org";

export const metadata: Metadata = { title: "Your account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const customer = await getCustomer();
  if (!customer) {
    const home = await resolveHome();
    redirect(home.kind === "staff" ? "/app/orders" : "/account/sign-in");
  }

  const org = await requireOrg();
  const [orders, loyalty, stampConfig, stampState] = await Promise.all([
    listCustomerOrders({ customerId: customer.id, orgId: org.id, limit: 5 }),
    getLoyaltyConfig(),
    getStampConfig(),
    getStampAccountState(customer.id, org.id),
  ]);

  const stampCount = stampState?.stampCount ?? 0;
  const availableRewards = stampState?.availableRewards.length ?? 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-[var(--gutter)] py-10 sm:py-14">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-4xl font-bold tracking-tight">{customer.name ?? "Your account"}</h1>
          <p className="tabular mt-1 text-sm text-muted-foreground">
            {customer.phone} · {customer.email}
          </p>
        </div>
        <form action="/api/auth/sign-out-customer" method="POST">
          <button
            type="submit"
            className="flex min-h-[44px] items-center gap-2 rounded-md border border-border px-3 text-sm font-semibold transition-colors hover:bg-surface"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </button>
        </form>
      </div>

      {isLoyaltyEnabled(loyalty) && (
        <section aria-labelledby="rewards" className="mt-8 rounded-lg border border-border bg-surface p-6">
          <h2 id="rewards" className="flex items-center gap-2 font-heading text-lg font-semibold">
            <Gift className="size-4 text-primary" aria-hidden="true" />
            Rewards
          </h2>

          <p className="tabular mt-4 font-heading text-4xl font-bold">
            {customer.points}
            <span className="ml-2 text-base font-semibold text-muted-foreground">
              {customer.points === 1 ? "point" : "points"}
            </span>
          </p>

          <p className="tabular mt-1 text-sm text-muted-foreground">
            {customer.points > 0
              ? `Worth ${formatINR(pointsValue(customer.points, loyalty))} off your next order.`
              : `Earn ${formatBps(loyalty.earnBps, 0)} back as points on everything you order.`}
          </p>
        </section>
      )}

      {isStampProgramEnabled(stampConfig) && (
        <section aria-labelledby="stamps" className="mt-6 rounded-lg border border-border bg-surface p-6">
          <h2 id="stamps" className="font-heading text-lg font-semibold">
            FRYBIRD REWARDS
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {availableRewards > 0
              ? "Pick your free item from the menu — it's added at no charge when you check out."
              : `${stampCount} of ${stampConfig.stampsRequired} — spend over ${formatINR(stampConfig.minOrderValue)} on ${stampConfig.stampsRequired - stampCount} more order${stampConfig.stampsRequired - stampCount === 1 ? "" : "s"} and your next item up to ${formatINR(stampConfig.maxRewardValue)} is free.`}
          </p>
          <StampCard
            stampsRequired={stampConfig.stampsRequired}
            stampCount={stampCount}
            availableRewards={availableRewards}
            personal
            className="mt-5"
          />
          {availableRewards > 0 && (
            <Link
              href="/menu"
              className="mt-5 inline-flex min-h-[48px] items-center gap-2 rounded-md bg-primary px-5 font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Choose your free item
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          )}
        </section>
      )}

      <section aria-labelledby="orders" className="mt-10">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="orders" className="font-heading text-2xl font-bold tracking-tight">
            Recent orders
          </h2>
          {orders.length > 0 && (
            <Link href="/account/orders" className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
              See all
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          )}
        </div>

        {orders.length === 0 ? (
          <EmptyState
            className="mt-6"
            title="No orders yet."
            detail="When you order, it'll show up here."
            action={
              <Link
                href="/menu"
                className="mt-2 inline-flex min-h-[48px] items-center gap-2 rounded-md bg-primary px-5 font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                See the menu
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            }
          />
        ) : (
          <OrderHistoryList orders={orders.map((order) => ({ ...order, placedAt: order.placedAt?.toISOString() ?? null }))} />
        )}
      </section>
    </div>
  );
}
