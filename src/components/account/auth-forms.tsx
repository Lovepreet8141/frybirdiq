"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Loader2, Mail, MailCheck } from "lucide-react";
import { CodeBoxes } from "@/components/account/code-boxes";
import {
  type CustomerAuthState,
  type OtpRequestState,
  type OtpVerifyState,
  type ResendState,
  createAccount,
  requestOtpAction,
  resendConfirmation,
  verifyOtpAction,
} from "@/lib/customer/actions";

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
  if (state.status !== "error") return null;
  return (
    <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
      {state.message}
    </p>
  );
}

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
 * The state a sign-up lands in when Supabase requires email confirmation.
 * Its own panel, not a message above the form the person just filled in —
 * the form is done, this is what happens next.
 */
function CheckEmail({ email }: { email: string }) {
  const [state, action] = useActionState<ResendState, FormData>(resendConfirmation, { status: "idle" });

  return (
    <div className="flex flex-col items-center gap-4 rounded-md border border-border bg-surface px-6 py-8 text-center">
      <MailCheck className="size-8 text-primary" aria-hidden="true" />
      <div className="flex flex-col gap-1.5">
        <p className="font-heading text-lg font-semibold">Check your email</p>
        <p className="text-sm text-muted-foreground">
          We sent a confirmation link to <strong className="text-foreground">{email}</strong>. Click it, then sign
          in.
        </p>
      </div>

      <form action={action}>
        <input type="hidden" name="email" value={email} />
        <ResendButton />
      </form>

      {state.status !== "idle" && (
        <p role={state.status === "error" ? "alert" : "status"} className="text-sm text-muted-foreground">
          {state.message}
        </p>
      )}
    </div>
  );
}

const field =
  "h-[52px] rounded-md border border-border bg-surface px-4 text-base focus-visible:border-border-strong";

export function JoinForm() {
  const [state, action] = useActionState<CustomerAuthState, FormData>(createAccount, { status: "idle" });

  if (state.status === "check-email") return <CheckEmail email={state.email} />;

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

const RESEND_WAIT_SECONDS = 60;

/** The resend button: disabled with a live countdown for this long after a code is sent — a client-side clock only, the server enforces the same 60 seconds on its own (checkOtpRequestLimit). */
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
 * The one icon in the verify step, reading only the pending/error states the
 * form already has (`useFormStatus` — this must render inside the `<form>`
 * it reports on) — no new state added anywhere. `verifyOtpAction` has no
 * "success" status at all: a real success calls `redirect()` server-side and
 * the browser navigates away, so success here is inferred purely from
 * timing — a submission that was pending and comes back not pending, not in
 * error — for the moment before that navigation actually lands.
 */
function VerifyStatusIcon({ invalid }: { invalid: boolean }) {
  const { pending } = useFormStatus();
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [seenPending, setSeenPending] = useState(pending);
  if (pending !== seenPending) {
    setSeenPending(pending);
    if (pending) setHasSubmitted(true);
  }

  if (pending) return <Loader2 className="size-5 shrink-0 animate-spin text-primary" aria-hidden="true" />;
  if (hasSubmitted && !invalid) {
    return <CheckCircle2 className="size-5 shrink-0 text-success otp-tick-pop" aria-hidden="true" />;
  }
  return <Mail className="size-5 shrink-0 text-primary" aria-hidden="true" />;
}

/**
 * Email OTP sign-in — the customer login page's primary flow (email-otp
 * card). Two steps in one component so the email typed in step one carries
 * straight into step two without a page transition: enter an email, get a
 * six-digit code by email (the same email also carries a magic link, kept
 * working as a fallback for whoever would rather tap than type — nothing
 * here disables it), type the code, in.
 */
export function OtpSignInForm() {
  const [requestState, requestAction] = useActionState<OtpRequestState, FormData>(requestOtpAction, { status: "idle" });
  const [verifyState, verifyAction] = useActionState<OtpVerifyState, FormData>(verifyOtpAction, { status: "idle" });
  const [secondsLeft, setSecondsLeft] = useState(0);
  // Separate from requestState on purpose: a resend that fails (a network blip, a server-side rate-limit race
  // even with the button disabled client-side) must not drop the user back to "enter your email" and lose the
  // step they already reached — only a *successful* send ever sets this, and nothing ever clears it back to null.
  const [email, setEmail] = useState<string | null>(null);
  // Bumped on every NEW verify error, never on a fresh code request — CodeBoxes remounts on it (see its own
  // comment): a wrong or expired code is never left sitting in the boxes ready to be resubmitted unchanged.
  const [verifyErrorToken, setVerifyErrorToken] = useState(0);

  // Adjusts state during render rather than in an effect (React's own pattern for "derive state from a prop
  // that changed"): detects a NEW successful send by comparing against the last requestState seen, and starts
  // (or restarts, on a resend) the 60-second countdown the moment a code is actually sent.
  const [seenRequestState, setSeenRequestState] = useState(requestState);
  if (requestState !== seenRequestState) {
    setSeenRequestState(requestState);
    if (requestState.status === "sent") {
      setEmail(requestState.email);
      setSecondsLeft(RESEND_WAIT_SECONDS);
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

  if (!email) {
    return (
      <form action={requestAction} className="flex flex-col gap-5">
        {requestState.status === "error" && (
          <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
            {requestState.message}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="otp-email" className="text-sm font-semibold">Email</label>
          <input id="otp-email" name="email" required type="email" autoComplete="username" autoCapitalize="none" className={field} />
        </div>

        <Submit label="Send me a code" busy="Sending" />
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <form action={verifyAction} className="flex flex-col gap-5">
        {/* Compact by default (not just hidden past a breakpoint): a short phone with the keyboard open must
            still show the boxes and the submit button without scrolling. The otp-status-row rule in
            globals.css drops this row entirely below a 500px viewport height as a second line of defense. */}
        <div className="otp-status-row flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-left">
          <VerifyStatusIcon invalid={verifyState.status === "error"} />
          <p className="text-sm text-muted-foreground">
            Code sent to <strong className="text-foreground">{email}</strong>. A sign-in link is in that email too.
          </p>
        </div>

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

        <Submit label="Sign in" busy="Checking" />
      </form>

      <form action={requestAction}>
        <input type="hidden" name="email" value={email} />
        <ResendCodeButton secondsLeft={secondsLeft} />
      </form>
    </div>
  );
}
