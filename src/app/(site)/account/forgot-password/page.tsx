import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { resolveHome } from "@/lib/auth/route-home";

export const metadata: Metadata = { title: "Reset password", robots: { index: false, follow: false } };

/**
 * Customer-facing forgot-password (auth-v3, item C): same component, same
 * server actions as the staff page at `/forgot-password` — see
 * `ForgotPasswordForm`'s own doc comment for why one implementation covers
 * both. This is also how a customer account created code-only under
 * auth-v2 (no password at all) sets its first one.
 */
export default async function CustomerForgotPasswordPage() {
  const home = await resolveHome();
  if (home.path) redirect(home.path);

  return (
    <div className="mx-auto w-full max-w-sm px-[var(--gutter)] py-14">
      <h1 className="font-heading text-3xl font-bold tracking-tight">Reset password</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        We&rsquo;ll email a 6-digit code, not a link. Every other session on your account is signed out once your new
        password is set.
      </p>

      <div className="mt-8">
        <ForgotPasswordForm />
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        <Link href="/account/sign-in" className="font-semibold text-foreground underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
