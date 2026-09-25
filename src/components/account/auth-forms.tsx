"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Mail, UserPlus } from "lucide-react";
import { CodeBoxes } from "@/components/account/code-boxes";
import {
  type CompleteProfileState,
  type OtpRequestState,
  type OtpVerifyState,
  completeProfileAction,
  requestOtpAction,
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

const field = "h-[52px] rounded-md border border-border bg-surface px-4 text-base focus-visible:border-border-strong";

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

function RememberMeCheckbox({ defaultChecked }: { defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <input
        type="checkbox"
        name="remember"
        defaultChecked={defaultChecked}
        className="size-4 rounded border-border accent-primary"
      />
      Stay signed in on this device for 30 days
    </label>
  );
}

/**
 * The account-completion step for a brand-new sign-up: the Supabase Auth
 * user and its session already exist (`verifyOtpAction` only reaches this
 * state after a real code verified) — this just asks for the name and phone
 * an order or the account page needs.
 */
function CompleteProfileForm({ email }: { email: string }) {
  const [state, action] = useActionState<CompleteProfileState, FormData>(completeProfileAction, { status: "idle" });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-left">
        <UserPlus className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">{email}</strong> is confirmed. A couple more details to finish setting
          up your account.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-5">
        {state.status === "error" && (
          <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
            {state.message}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="profile-name" className="text-sm font-semibold">Name</label>
          <input id="profile-name" name="name" required autoComplete="name" className={field} />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="profile-phone" className="text-sm font-semibold">Mobile number</label>
          <input
            id="profile-phone"
            name="phone"
            required
            type="tel"
            inputMode="numeric"
            maxLength={10}
            autoComplete="tel-national"
            className={`${field} tabular`}
          />
        </div>

        <Submit label="Finish creating your account" busy="Saving" />
      </form>
    </div>
  );
}

/**
 * Customer auth (auth-v2) — one screen, code only, for both sign-in and
 * sign-up: enter an email, get a six-digit code (`shouldCreateUser: true` —
 * an unknown address becomes a new account the moment its code verifies),
 * type the code, in. No password, no link. A brand-new account's first
 * successful verify continues into `CompleteProfileForm` instead of
 * redirecting straight in — see `verifyOtpAction`'s own doc comment.
 */
export function OtpSignInForm({
  noticeLinksRetired = false,
  rememberDefault,
}: {
  noticeLinksRetired?: boolean;
  rememberDefault: boolean;
}) {
  const [requestState, requestAction] = useActionState<OtpRequestState, FormData>(requestOtpAction, { status: "idle" });
  const [verifyState, verifyAction] = useActionState<OtpVerifyState, FormData>(verifyOtpAction, { status: "idle" });
  const [secondsLeft, setSecondsLeft] = useState(0);
  // Separate from requestState on purpose: a resend that fails (a network blip, a server-side rate-limit race
  // even with the button disabled client-side) must not drop the user back to "enter your email" and lose the
  // step they already reached — only a *successful* send ever sets this, and nothing ever clears it back to null.
  const [email, setEmail] = useState<string | null>(null);
  // Bumped on every NEW verify error OR every successful resend, never on the first send — CodeBoxes remounts
  // on it (see its own comment): a wrong/expired code, or a code superseded by a newer email, is never left
  // sitting in the boxes ready to be resubmitted. This is the live-incident fix (25 Sep 2026): a customer who
  // requested a second code while the first was still showing had no signal the first one was now stale, and
  // the still-visible boxes (never cleared on resend) invited entering the wrong one.
  const [verifyErrorToken, setVerifyErrorToken] = useState(0);
  const [resendNotice, setResendNotice] = useState(false);

  // Adjusts state during render rather than in an effect (React's own pattern for "derive state from a prop
  // that changed"): detects a NEW successful send by comparing against the last requestState seen, and starts
  // (or restarts, on a resend) the 60-second countdown the moment a code is actually sent.
  const [seenRequestState, setSeenRequestState] = useState(requestState);
  if (requestState !== seenRequestState) {
    setSeenRequestState(requestState);
    if (requestState.status === "sent") {
      const isResend = email !== null; // email is already set only once the first send has already landed
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

  if (verifyState.status === "need-profile") return <CompleteProfileForm email={verifyState.email} />;

  if (!email) {
    return (
      <form action={requestAction} className="flex flex-col gap-5">
        {noticeLinksRetired && (
          <p role="status" className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
            Links are no longer used — sign in with a code instead.
          </p>
        )}
        {requestState.status === "error" && (
          <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
            {requestState.message}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="otp-email" className="text-sm font-semibold">Email</label>
          <input id="otp-email" name="email" required type="email" autoComplete="username" autoCapitalize="none" className={field} />
        </div>

        <Submit label="Continue" busy="Sending" />
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <form action={verifyAction} className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-left">
          <Mail className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Code sent to <strong className="text-foreground">{email}</strong>.
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

        <RememberMeCheckbox defaultChecked={rememberDefault} />

        <Submit label="Sign in" busy="Checking" />
      </form>

      <form action={requestAction}>
        <input type="hidden" name="email" value={email} />
        <ResendCodeButton secondsLeft={secondsLeft} />
      </form>
    </div>
  );
}
