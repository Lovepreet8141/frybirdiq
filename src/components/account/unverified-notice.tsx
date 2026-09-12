"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, MailWarning } from "lucide-react";
import { type ResendState, resendConfirmation } from "@/lib/customer/actions";
import { cn } from "@/lib/utils";

function ResendButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-border px-4 text-sm font-semibold transition-colors hover:bg-surface disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      Resend the email
    </button>
  );
}

/**
 * Stands in for order history, rewards and stamps until the address is
 * confirmed. Those three are withheld — see `Customer.emailVerified` — and a
 * blank space where they'd be would look like a bug rather than a reason.
 */
export function UnverifiedNotice({ email, className }: { email: string | null; className?: string }) {
  const [state, action] = useActionState<ResendState, FormData>(resendConfirmation, { status: "idle" });

  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border border-border bg-surface p-6", className)}>
      <div className="flex items-start gap-3">
        <MailWarning className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="flex flex-col gap-1.5">
          <p className="font-heading text-lg font-semibold">Confirm your email to see your orders and rewards</p>
          <p className="text-sm text-muted-foreground">
            {email ? (
              <>
                We sent a link to <strong className="text-foreground">{email}</strong> when you signed up. Click it,
                then reload this page.
              </>
            ) : (
              "Click the confirmation link we sent when you signed up, then reload this page."
            )}
          </p>
        </div>
      </div>

      {email && (
        <form action={action} className="flex flex-col items-start gap-2">
          <input type="hidden" name="email" value={email} />
          <ResendButton />
          {state.status !== "idle" && (
            <p role={state.status === "error" ? "alert" : "status"} className="text-sm text-muted-foreground">
              {state.message}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
