import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { JoinForm } from "@/components/account/auth-forms";
import { getCustomer } from "@/lib/customer";
import { getLoyaltyConfig } from "@/lib/loyalty/config";
import { isLoyaltyEnabled } from "@/lib/loyalty";
import { formatBps } from "@/lib/money";

export const metadata: Metadata = { title: "Create an account" };

export default async function JoinPage() {
  if (await getCustomer()) redirect("/account");
  const loyalty = await getLoyaltyConfig();

  return (
    <div className="mx-auto w-full max-w-sm px-[var(--gutter)] py-14">
      <h1 className="font-heading text-3xl font-bold tracking-tight">Create an account</h1>

      {/* Only claims a reward when there is actually one configured. */}
      {isLoyaltyEnabled(loyalty) && (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Earn {formatBps(loyalty.earnBps, 0)} back as points on everything you order, and keep your order history in
          one place.
        </p>
      )}

      <div className="mt-8">
        <JoinForm />
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Already have one?{" "}
        <Link href="/account/sign-in" className="font-semibold text-primary">
          Sign in
        </Link>
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        You don&rsquo;t need an account to order.{" "}
        <Link href="/menu" className="font-semibold text-primary">
          Just order
        </Link>
      </p>
    </div>
  );
}
