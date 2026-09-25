"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { CodeBoxes } from "@/components/account/code-boxes";
import {
  type ResetRequestState,
  type ResetVerifyState,
  type SetPasswordState,
  requestPasswordResetAction,
  setNewPasswordAction,
  verifyResetCodeAction,
} from "@/lib/auth/actions";

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

const field = "h-[52px] rounded-md border border-border bg-surface px-4 text-base focus-visible:border-border-strong";

const RESEND_WAIT_SECONDS = 60;

function ResendCodeButton({ secondsLeft }: { secondsLeft: number }) {
  const { pending } = useFormStatus();
  const waiting = secondsLeft > 0;
  return (
    <button
      type="submit"
      disabled={pending || waiting}
      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-border px-4 text-sm font-semibold transition-colors hover:bg-surface disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {waiting ? `Resend code (${secondsLeft}s)` : "Resend code"}
    </button>
  );
}

/**
 * Set a new password, once `verifyResetCodeAction` has established a real
 * session for this attempt. `setNewPasswordAction` reads that session's own
 * id (`getUser()`), never anything this form supplies, and redirects itself
 * on success — there is no client-side "done" state to render here.
 */
function SetNewPasswordForm() {
  const [state, action] = useActionState<SetPasswordState, FormData>(setNewPasswordAction, { status: "idle" });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-left">
        <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Code verified. Set a new password to finish.</p>
      </div>

      <form action={action} className="flex flex-col gap-5">
        {state.status === "error" && (
          <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
            {state.message}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="new-password" className="text-sm font-semibold">New password</label>
          <input id="new-password" name="password" required type="password" minLength={10} autoComplete="new-password" className={field} aria-describedby="new-password-hint" />
          <p id="new-password-hint" className="text-sm text-muted-foreground">At least 10 characters.</p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="confirm-password" className="text-sm font-semibold">Confirm new password</label>
          <input id="confirm-password" name="confirmPassword" required type="password" minLength={10} autoComplete="new-password" className={field} />
        </div>

        <Submit label="Set new password" busy="Saving" />
      </form>
    </div>
  );
}

/**
 * The staff/owner "forgot password" flow (auth-v2, item B.1): a 6-digit
 * code, not a link. Same three-step shape as the customer OTP form — email,
 * then code, then (here, uniquely to this flow) a new password.
 */
export function ForgotPasswordForm() {
  const [requestState, requestAction] = useActionState<ResetRequestState, FormData>(requestPasswordResetAction, { status: "idle" });
  const [verifyState, verifyAction] = useActionState<ResetVerifyState, FormData>(verifyResetCodeAction, { status: "idle" });
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [email, setEmail] = useState<string | null>(null);
  // Bumped on every NEW verify error OR every successful resend, never the first send — CodeBoxes remounts on
  // it, clearing a code that a newer email has since superseded. Same live-incident fix as the customer flow.
  const [verifyErrorToken, setVerifyErrorToken] = useState(0);
  const [resendNotice, setResendNotice] = useState(false);

  const [seenRequestState, setSeenRequestState] = useState(requestState);
  if (requestState !== seenRequestState) {
    setSeenRequestState(requestState);
    if (requestState.status === "sent") {
      const isResend = email !== null;
      setEmail(requestState.email);
      setSecondsLeft(RESEND_WAIT_SECONDS);
      if (isResend) {
        setVerifyErrorToken((n) => n + 1);
        setResendNotice(true);
      }
    }
  }

  const [seenVerifyState, setSeenVerifyState] = useState(verifyState);
  if (verifyState !== seenVerifyState) {
    setSeenVerifyState(verifyState);
    if (verifyState.status === "error") setVerifyErrorToken((n) => n + 1);
  }

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  if (verifyState.status === "verified") return <SetNewPasswordForm />;

  if (!email) {
    return (
      <form action={requestAction} className="flex flex-col gap-5">
        {requestState.status === "error" && (
          <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
            {requestState.message}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="reset-email" className="text-sm font-semibold">Email</label>
          <input id="reset-email" name="email" required type="email" autoComplete="username" autoCapitalize="none" className={field} />
        </div>

        <Submit label="Send me a reset code" busy="Sending" />
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <form action={verifyAction} className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-left">
          <KeyRound className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Reset code sent to <strong className="text-foreground">{email}</strong>.
          </p>
        </div>

        {resendNotice && verifyState.status !== "error" && (
          <p role="status" className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
            New code sent. Use the newest email.
          </p>
        )}
        {verifyState.status === "error" && (
          <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
            {verifyState.message}
          </p>
        )}
        {requestState.status === "error" && (
          <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
            {requestState.message}
          </p>
        )}

        <input type="hidden" name="email" value={email} />

        <div className="flex flex-col items-center gap-2">
          <span className="text-sm font-semibold">6-digit code</span>
          <CodeBoxes name="token" resetToken={verifyErrorToken} invalid={verifyState.status === "error"} />
        </div>

        <Submit label="Continue" busy="Checking" />
      </form>

      <form action={requestAction}>
        <input type="hidden" name="email" value={email} />
        <ResendCodeButton secondsLeft={secondsLeft} />
      </form>
    </div>
  );
}
