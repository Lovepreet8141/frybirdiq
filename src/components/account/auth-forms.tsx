"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { type CustomerAuthState, createAccount, signInCustomer } from "@/lib/customer/actions";

function Submit({ label, busy }: { label: string; busy: string }) {
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
          {busy}
        </>
      ) : (
        label
      )}
    </button>
  );
}

function Message({ state }: { state: CustomerAuthState }) {
  if (state.status === "idle") return null;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
      {state.message}
    </p>
  );
}

const field =
  "h-[52px] rounded-md border border-border bg-surface px-4 text-base focus-visible:border-border-strong";

export function JoinForm() {
  const [state, action] = useActionState<CustomerAuthState, FormData>(createAccount, { status: "idle" });

  return (
    <form action={action} className="flex flex-col gap-5">
      <Message state={state} />

      <div className="flex flex-col gap-2">
        <label htmlFor="name" className="text-sm font-semibold">Name</label>
        <input id="name" name="name" required autoComplete="name" className={field} />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="phone" className="text-sm font-semibold">Mobile number</label>
        <input
          id="phone"
          name="phone"
          required
          type="tel"
          inputMode="numeric"
          maxLength={10}
          autoComplete="tel-national"
          className={`${field} tabular`}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-semibold">Email</label>
        <input id="email" name="email" required type="email" autoComplete="email" autoCapitalize="none" className={field} />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="text-sm font-semibold">Password</label>
        <input
          id="password"
          name="password"
          required
          type="password"
          minLength={8}
          autoComplete="new-password"
          aria-describedby="password-hint"
          className={field}
        />
        <p id="password-hint" className="text-sm text-muted-foreground">At least 8 characters.</p>
      </div>

      <Submit label="Create account" busy="Creating your account" />
    </form>
  );
}

export function CustomerSignInForm() {
  const [state, action] = useActionState<CustomerAuthState, FormData>(signInCustomer, { status: "idle" });

  return (
    <form action={action} className="flex flex-col gap-5">
      <Message state={state} />

      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-semibold">Email</label>
        <input id="email" name="email" required type="email" autoComplete="username" autoCapitalize="none" className={field} />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="text-sm font-semibold">Password</label>
        <input id="password" name="password" required type="password" autoComplete="current-password" className={field} />
      </div>

      <Submit label="Sign in" busy="Signing in" />
    </form>
  );
}
