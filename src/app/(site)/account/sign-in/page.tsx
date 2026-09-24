import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OtpSignInForm } from "@/components/account/auth-forms";
import { resolveHome } from "@/lib/auth/route-home";
import { readRememberChoice } from "@/lib/auth/remember-me-cookies";
import { getLoyaltyConfig } from "@/lib/loyalty/config";
import { isLoyaltyEnabled } from "@/lib/loyalty";
import { formatBps } from "@/lib/money";

export const metadata: Metadata = { title: "Sign in" };

/**
 * One screen for both sign-in and sign-up (auth-v2) — the email address
 * decides which it is server-side, never a separate page or link. See
 * `OtpSignInForm`'s own doc comment.
 */
export default async function CustomerSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const home = await resolveHome();
  if (home.path) redirect(home.path);

  const { notice } = await searchParams;
  const loyalty = await getLoyaltyConfig();
  const rememberDefault = await readRememberChoice(true);

  return (
    <div className="mx-auto w-full max-w-sm px-[var(--gutter)] py-14">
      <h1 className="font-heading text-3xl font-bold tracking-tight">Sign in</h1>

      {isLoyaltyEnabled(loyalty) && (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Earn {formatBps(loyalty.earnBps, 0)} back as points on everything you order, and keep your order history in
          one place.
        </p>
      )}

      <div className="mt-8">
        <OtpSignInForm noticeLinksRetired={notice === "links-retired"} rememberDefault={rememberDefault} />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        You don&rsquo;t need an account to order.{" "}
        <Link href="/menu" className="font-semibold text-primary">
          Just order
        </Link>
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Staff?{" "}
        <Link href="/sign-in" className="font-semibold text-primary">
          FRYBIRD IQ sign-in
        </Link>
      </p>
    </div>
  );
}
