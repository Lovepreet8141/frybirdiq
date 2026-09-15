"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Status = "checking" | "ready" | "invalid" | "submitting" | "done";

/**
 * Where an invite's email link lands: "set your password", not a form that
 * asks for one. Roadmap 6.1's "Done when" — a new cashier receives an
 * invite, sets a password, and sees only the POS and orders.
 *
 * Supabase's invite email points here with the new session in the URL
 * fragment, not a `?code=`: `inviteUserByEmail`'s own docs say PKCE (which
 * `/auth/confirm` uses for sign-up) is not supported for invites, because
 * the browser that sends the invite is never the browser that accepts it.
 * The browser client's `detectSessionInUrl` (on by default, see
 * `@supabase/ssr`) reads that fragment and establishes the session before
 * `getSession()` below resolves — this page never sees the tokens directly.
 * A fragment never reaches this file's own code or any server, by design.
 */
export function AcceptInviteForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setStatus(data.session ? "ready" : "invalid");
      })
      .catch(() => {
        if (!cancelled) setStatus("invalid");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }

    setStatus("submitting");
    const { error: updateError } = await createClient().auth.updateUser({ password });
    if (updateError) {
      setStatus("ready");
      setError("That password couldn't be set. Try a different one.");
      return;
    }

    setStatus("done");
    // Reuses the sign-in page's own routing: it already sends a signed-in
    // account wherever `resolveHome()` says a person with these roles
    // belongs, so this never needs to know that logic itself.
    router.push("/sign-in");
  }

  if (status === "checking") {
    return (
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Checking your invite
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm">
        <p>This invite link is invalid or has expired.</p>
        <p className="text-muted-foreground">Ask whoever invited you to send a new one from Staff.</p>
      </div>
    );
  }

  const pending = status === "submitting" || status === "done";

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      {error && (
        <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="new-password" className="text-sm font-semibold">
          New password
        </label>
        <input
          id="new-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={pending}
          className="h-[52px] rounded-md border border-border bg-surface px-4 text-base focus-visible:border-border-strong disabled:opacity-60"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="confirm-password" className="text-sm font-semibold">
          Confirm password
        </label>
        <input
          id="confirm-password"
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          disabled={pending}
          className="h-[52px] rounded-md border border-border bg-surface px-4 text-base focus-visible:border-border-strong disabled:opacity-60"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="flex min-h-[52px] w-full items-center justify-center gap-3 rounded-md bg-primary px-6 font-semibold text-primary-foreground transition-opacity duration-[var(--duration-micro)] hover:opacity-90 disabled:opacity-50"
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {status === "done" ? "Signing you in" : "Setting password"}
          </>
        ) : (
          "Set password and sign in"
        )}
      </button>
    </form>
  );
}
