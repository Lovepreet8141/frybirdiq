import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { resolveHome } from "@/lib/auth/route-home";

export const metadata: Metadata = { title: "Reset password", robots: { index: false, follow: false } };

export default async function ForgotPasswordPage() {
  const home = await resolveHome();
  if (home.path) redirect(home.path);

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-[var(--gutter)] py-16">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Link href="/" className="font-heading text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">
            FRYBIRD
          </Link>
          <h1 className="font-heading text-4xl font-bold tracking-tight">Reset password</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            We&rsquo;ll email a 6-digit code, not a link. Every other session on your account is signed out once your
            new password is set.
          </p>
        </div>

        <ForgotPasswordForm />

        <p className="text-sm text-muted-foreground">
          <Link href="/sign-in" className="font-semibold text-foreground underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
