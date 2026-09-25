"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { type SignInState, signIn } from "@/lib/auth/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex min-h-[52px] w-full items-center justify-center gap-3 rounded-md bg-primary px-6 font-semibold text-primary-foreground transition-opacity duration-[var(--duration-micro)] hover:opacity-90 disabled:opacity-50"
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Signing in
        </>
      ) : (
        "Sign in"
      )}
    </button>
  );
}

export function SignInForm({ rememberDefault }: { rememberDefault: boolean }) {
  const [state, action] = useActionState<SignInState, FormData>(signIn, { status: "idle" });

  return (
    <form action={action} className="flex flex-col gap-5">
      {state.status === "error" && (
        <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
          {state.message}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-semibold">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          autoCapitalize="none"
          className="h-[52px] rounded-md border border-border bg-surface px-4 text-base focus-visible:border-border-strong"
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-sm font-semibold">
            Password
          </label>
          <Link href="/forgot-password" className="text-sm font-semibold text-primary">
            Forgot password?
          </Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="h-[52px] rounded-md border border-border bg-surface px-4 text-base focus-visible:border-border-strong"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" name="remember" defaultChecked={rememberDefault} className="size-4 rounded border-border accent-primary" />
        Stay signed in on this device for 30 days
      </label>

      <SubmitButton />
    </form>
  );
}
