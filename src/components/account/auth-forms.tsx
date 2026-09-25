"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Eye, EyeOff, KeyRound, Loader2, Mail } from "lucide-react";
import { CodeBoxes } from "@/components/account/code-boxes";
import {
  type CreateAccountState,
  type ResendSignupCodeState,
  type SignInCustomerState,
  type SignupVerifyState,
  createAccountAction,
  resendSignupCodeAction,
  signInCustomerAction,
  verifySignupCodeAction,
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

/** The resend button: disabled with a live countdown for this long after a code is sent — a client-side clock only, the server enforces the same 60 seconds on its own (checkSignupLimit). */
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

/** A password input with a show/hide toggle — used for both the signup password fields and the reset-password form. */
function PasswordField({ id, name, label, autoComplete, hint }: { id: string; name: string; label: string; autoComplete: string; hint?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <div className="relative">
        <input
          id={id}
          name={name}
          required
          type={visible ? "text" : "password"}
          minLength={8}
          autoComplete={autoComplete}
          className={`${field} w-full pr-12`}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          {visible ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
        </button>
      </div>
      {hint && <p id={`${id}-hint`} className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * The 6-digit signup-confirmation code step, shared by two entry points
 * (auth-v3): straight after `JoinForm`'s signup, and from
 * `CustomerSignInForm`'s "Send me a code" escape hatch for an account that
 * exists but never confirmed its email. A successful verify both confirms
 * the email and signs in — the actual `customers`/`loyaltyAccounts` row is
 * only created once that happens (see `verifySignupCodeAction`'s own doc
 * comment for why). `profileToken` — the SIGNED `{email, name, phone}` blob
 * `createAccountAction` returned, not raw values — rides along as the one
 * hidden field that carries them, when there is one (the `JoinForm` path);
 * it's simply omitted from the sign-in escape-hatch path, which never had
 * one to carry. Deliberately not plain `name`/`phone` hidden fields — see
 * the module doc comment in `src/lib/customer/actions.ts` for why an
 * editable, unsigned pair of fields here was itself a real hole.
 */
function SignupCodeForm({ email, profileToken }: { email: string; profileToken?: string | null }) {
  const [verifyState, verifyAction] = useActionState<SignupVerifyState, FormData>(verifySignupCodeAction, { status: "idle" });
  const [resendState, resendAction] = useActionState<ResendSignupCodeState, FormData>(resendSignupCodeAction, { status: "idle" });
  const [secondsLeft, setSecondsLeft] = useState(RESEND_WAIT_SECONDS);
  // Same live-incident fix as the reset and (former) sign-in code flows: bumped on every NEW verify error OR
  // every successful resend, never the first send — CodeBoxes remounts on it, so a code superseded by a
  // newer email is never left sitting in the boxes ready to be resubmitted.
  const [verifyErrorToken, setVerifyErrorToken] = useState(0);
  const [resendNotice, setResendNotice] = useState(false);

  const [seenResendState, setSeenResendState] = useState(resendState);
  if (resendState !== seenResendState) {
    setSeenResendState(resendState);
    if (resendState.status === "sent") {
      setSecondsLeft(RESEND_WAIT_SECONDS);
      setVerifyErrorToken((n) => n + 1);
      setResendNotice(true);
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
        {resendState.status === "error" && (
          <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
            {resendState.message}
          </p>
        )}

        <input type="hidden" name="email" value={email} />
        {profileToken != null && <input type="hidden" name="profileToken" value={profileToken} />}

        <div className="flex flex-col items-center gap-2">
          <span className="text-sm font-semibold">6-digit code</span>
          <CodeBoxes name="token" resetToken={verifyErrorToken} invalid={verifyState.status === "error"} />
        </div>

        <Submit label="Confirm" busy="Checking" />
      </form>

      <form action={resendAction}>
        <input type="hidden" name="email" value={email} />
        <ResendCodeButton secondsLeft={secondsLeft} />
      </form>
    </div>
  );
}

/**
 * Sign up (auth-v3, item A): name, phone, email, password — all up front,
 * unlike auth-v2's deferred profile step. Submitting sends a 6-digit
 * confirmation code and moves straight into `SignupCodeForm`; there is no
 * separate "create account" vs "confirm" page.
 */
export function JoinForm() {
  const [createState, createAction] = useActionState<CreateAccountState, FormData>(createAccountAction, { status: "idle" });

  if (createState.status === "sent") return <SignupCodeForm email={createState.email} profileToken={createState.profileToken} />;

  return (
    <form action={createAction} className="flex flex-col gap-5">
      {createState.status === "error" && (
        <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
          {createState.message}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="join-name" className="text-sm font-semibold">Name</label>
        <input id="join-name" name="name" required autoComplete="name" className={field} />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="join-phone" className="text-sm font-semibold">Mobile number</label>
        <input
          id="join-phone"
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
        <label htmlFor="join-email" className="text-sm font-semibold">Email</label>
        <input id="join-email" name="email" required type="email" autoComplete="username" autoCapitalize="none" className={field} />
      </div>

      <PasswordField id="join-password" name="password" label="Password" autoComplete="new-password" hint="At least 8 characters." />
      <PasswordField id="join-confirm-password" name="confirmPassword" label="Confirm password" autoComplete="new-password" />

      <Submit label="Create account" busy="Sending code" />
    </form>
  );
}

/**
 * Sign in with a password (auth-v3, item B). A neutral error on any
 * mismatch — except an account that exists but never confirmed its email,
 * which gets its own state so the form can offer "Send me a code" and
 * finish through the exact same `SignupCodeForm` a fresh signup uses. See
 * `signInCustomerAction`'s own doc comment for why that one distinction is
 * deliberate.
 */
export function CustomerSignInForm({ rememberDefault }: { rememberDefault: boolean }) {
  const [state, action] = useActionState<SignInCustomerState, FormData>(signInCustomerAction, { status: "idle" });
  const [resendState, resendAction] = useActionState<ResendSignupCodeState, FormData>(resendSignupCodeAction, { status: "idle" });

  if (resendState.status === "sent") return <SignupCodeForm email={resendState.email} />;

  if (state.status === "unconfirmed") {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-left">
          <KeyRound className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{state.email}</strong> hasn&rsquo;t been confirmed yet. Send a fresh
            code to finish.
          </p>
        </div>

        {resendState.status === "error" && (
          <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
            {resendState.message}
          </p>
        )}

        <form action={resendAction}>
          <input type="hidden" name="email" value={state.email} />
          <Submit label="Send me a code" busy="Sending" />
        </form>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-5">
      {state.status === "error" && (
        <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
          {state.message}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="signin-email" className="text-sm font-semibold">Email</label>
        <input id="signin-email" name="email" required type="email" autoComplete="username" autoCapitalize="none" className={field} />
      </div>

      <PasswordField id="signin-password" name="password" label="Password" autoComplete="current-password" />

      <div className="flex items-center justify-between gap-4">
        <RememberMeCheckbox defaultChecked={rememberDefault} />
        <Link href="/account/forgot-password" className="shrink-0 text-sm font-semibold text-primary">
          Forgot password?
        </Link>
      </div>

      <Submit label="Sign in" busy="Checking" />
    </form>
  );
}
