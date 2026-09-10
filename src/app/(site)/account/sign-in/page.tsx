import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomerSignInForm } from "@/components/account/auth-forms";
import { getCustomer } from "@/lib/customer";

export const metadata: Metadata = { title: "Sign in" };

export default async function CustomerSignInPage() {
  if (await getCustomer()) redirect("/account");

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
    </div>
  );
}
