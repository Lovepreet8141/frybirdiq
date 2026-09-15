import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { resolveHome } from "@/lib/auth/route-home";

export const metadata: Metadata = { title: "FRYBIRD IQ", robots: { index: false, follow: false } };

export default async function SignInPage() {
  // Already signed in — go wherever that account actually belongs.
  const home = await resolveHome();
  if (home.path) redirect(home.path);

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-[var(--gutter)] py-16">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Link href="/" className="font-heading text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">
            FRYBIRD
          </Link>
          <h1 className="font-heading text-4xl font-bold tracking-tight">
            FRYBIRD <span className="text-primary">IQ</span>
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Counter and kitchen. Customers order without an account and sign in{" "}
            <Link href="/account/sign-in" className="font-semibold text-foreground underline underline-offset-4">
              over here
            </Link>
            .
          </p>
        </div>

        <SignInForm />

        <p className="text-sm text-muted-foreground">
          Accounts are set up by an owner or admin, from Staff. If you can&rsquo;t get in, ask them rather than trying again.
        </p>
      </div>
    </div>
  );
}
