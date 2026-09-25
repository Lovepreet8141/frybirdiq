import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomerSignInForm } from "@/components/account/auth-forms";
import { resolveHome } from "@/lib/auth/route-home";
import { readRememberChoice } from "@/lib/auth/remember-me-cookies";
import { getLoyaltyConfig } from "@/lib/loyalty/config";
import { isLoyaltyEnabled } from "@/lib/loyalty";
import { formatBps } from "@/lib/money";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Customer sign-in (auth-v3): email and password again — see
 * `CustomerSignInForm`'s own doc comment for the unconfirmed-account
 * escape hatch. `notice=links-retired` still applies: `/auth/confirm`
 * redirects here for any old emailed link, code-only or password-linked,
 * that still shows up in an inbox.
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

      {notice === "links-retired" && (
        <p role="status" className="mt-4 rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
          Links are no longer used — sign in with your password instead.
        </p>
      )}

      <div className="mt-8">
        <CustomerSignInForm rememberDefault={rememberDefault} />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        You don&rsquo;t need an account to order.{" "}
        <Link href="/menu" className="font-semibold text-primary">
          Just order
        </Link>
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/account/join" className="font-semibold text-primary">
          Create an account
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
