import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomerSignInForm } from "@/components/account/auth-forms";
import { resolveHome } from "@/lib/auth/route-home";

export const metadata: Metadata = { title: "Sign in" };

export default async function CustomerSignInPage() {
  const home = await resolveHome();
  if (home.path) redirect(home.path);

  return (
    <div className="mx-auto w-full max-w-sm px-[var(--gutter)] py-14">
      <h1 className="font-heading text-3xl font-bold tracking-tight">Sign in</h1>
      <div className="mt-8">
        <CustomerSignInForm />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
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
