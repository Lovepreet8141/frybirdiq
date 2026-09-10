import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { getStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Staff sign-in", robots: { index: false, follow: false } };

export default async function SignInPage() {
  // Already signed in and holding a membership — no reason to show this.
  if (await getStaff()) redirect("/app/orders");

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-[var(--gutter)] py-16">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Link href="/" className="font-heading text-xl font-bold tracking-tight">
            FRYB<span className="text-primary">I</span>RD
          </Link>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Staff sign-in</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            For counter and kitchen. Customers don&rsquo;t need an account to order.
          </p>
        </div>

        <SignInForm />

        <p className="text-sm text-muted-foreground">
          Accounts are set up by the owner. If you can&rsquo;t get in, ask them rather than trying again.
        </p>
      </div>
    </div>
  );
}
