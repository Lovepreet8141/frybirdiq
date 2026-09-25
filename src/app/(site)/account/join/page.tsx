import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { JoinForm } from "@/components/account/auth-forms";
import { resolveHome } from "@/lib/auth/route-home";

export const metadata: Metadata = { title: "Create an account" };

/**
 * Sign-up (auth-v3, item A): its own page again, restored from auth-v2's
 * redirect-to-sign-in — name, phone, email and password are collected here,
 * up front, then confirmed with a 6-digit code. See `JoinForm`'s own doc
 * comment.
 */
export default async function JoinPage() {
  const home = await resolveHome();
  if (home.path) redirect(home.path);

  return (
    <div className="mx-auto w-full max-w-sm px-[var(--gutter)] py-14">
      <h1 className="font-heading text-3xl font-bold tracking-tight">Create an account</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Order history, rewards and saved addresses, all in one place from here on.
      </p>

      <div className="mt-8">
        <JoinForm />
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/account/sign-in" className="font-semibold text-primary">
          Sign in
        </Link>
      </p>
    </div>
  );
}
