"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { requireOrg } from "@/lib/repositories/org";
import { resolveHome } from "./route-home";
import { clientIp } from "./client-ip";
import { setRememberChoice } from "./remember-me-cookies";
import { checkResetRequestLimit, checkResetVerifyLimit } from "./reset-rate-limit";
import { recordPasswordChangedAndAlert } from "./password-changed-alert";

export type SignInState = { status: "idle" } | { status: "error"; message: string };

const credentialsSchema = z.object({
  email: z.email("Enter the email address your account uses."),
  password: z.string().min(1, "Enter your password."),
});

/**
 * Signs a staff member in.
 *
 * There is no self-serve sign-up. An account starts either by an owner or
 * admin inviting an email from Staff (roadmap 6.1 — `lib/staff/actions.ts`,
 * which itself calls the Supabase Admin API, never something a client can
 * reach directly) or, for the one case that UI does not cover, `pnpm
 * staff:grant` against an email that already has a Supabase Auth account. A
 * counter account is not something a stranger should be able to mint for
 * themselves, and §41's roles mean nothing if anyone can obtain one.
 *
 * Rate limiting is Supabase's, on the auth endpoint. Nothing here should try to
 * re-implement it.
 *
 * `remember` (auth-v2): read and applied BEFORE `signInWithPassword` — see
 * `setRememberChoice`'s own doc comment for why the order matters. Default
 * unticked on this form (a shared counter device should not start
 * remembering forever just because nobody unchecked a box).
 */
export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  if (!isSupabaseConfigured()) {
    return { status: "error", message: "Sign-in isn't connected yet." };
  }

  const parsed = credentialsSchema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  await setRememberChoice(formData.get("remember") === "on");

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Deliberately does not say which of the two was wrong. Distinguishing
    // them tells an attacker which addresses have accounts.
    return { status: "error", message: "That email and password don't match." };
  }

  revalidatePath("/", "layout");

  /*
   * Route by what the account is, not by which form it used.
   *
   * A customer who signs in here has a valid session but no membership. Sending
   * them to /app/orders would bounce them straight back to this page, and they
   * would sit in that loop with correct credentials and no explanation.
   */
  const home = await resolveHome();

  if (home.kind === "customer") redirect("/account");
  if (home.kind === "neither") {
    // Signed in, but attached to nothing. Leaving the session in place would
    // keep every page treating them as a stranger with no way to understand it.
    await supabase.auth.signOut();
    return {
      status: "error",
      message: "That account isn't set up for staff access. Ask the owner to grant it a role.",
    };
  }

  redirect("/app/orders");
}

/*
 * Forgot password: a 6-digit code, not a link. Three steps, three actions —
 * request, verify, set — because each needs its own rate limit and its own
 * explicit user action; nothing here can skip a step (`setNewPasswordAction`
 * requires the live session `verifyResetCodeAction` just established, taken
 * from `getUser()`, never an id the form supplies).
 *
 * Shared by staff AND customers (auth-v3, item C — reversing auth-v2's
 * red-team-driven staff-only gate, by explicit owner decision): whose
 * password this resets is still always the live session's own id, so
 * opening it to customers adds no privilege a customer didn't already have
 * over their own account. What changes is only bookkeeping, in
 * `setNewPasswordAction` below: the audit action name and whether an owner
 * alert fires both branch on `resolveHome()`'s own staff-vs-customer
 * routing, never on which page the person was sent from. This is also how a
 * customer account
 * created code-only under auth-v2 (no password at all) sets its first one —
 * `updateUser({ password })` works identically whether or not a password
 * existed before.
 */

const emailSchema = z.object({ email: z.email("Enter a valid email address.").max(160) });

export type ResetRequestState = { status: "idle" } | { status: "error"; message: string } | { status: "sent"; email: string };

/**
 * Sends the reset code. Same anti-enumeration posture as the customer OTP
 * flow: an unknown email and a real send must look identical to the caller.
 */
export async function requestPasswordResetAction(_previous: ResetRequestState, formData: FormData): Promise<ResetRequestState> {
  if (!isSupabaseConfigured()) return { status: "error", message: "Accounts aren't connected yet." };

  const parsed = emailSchema.safeParse({ email: String(formData.get("email") ?? "").trim() });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Enter a valid email address." };
  const email = parsed.data.email;

  const limit = checkResetRequestLimit(email, await clientIp());
  if (!limit.allowed) return { status: "error", message: `Too many requests. Wait ${limit.retryAfterSeconds} seconds and try again.` };

  const supabase = await createServerClient();
  // Result deliberately unused, same reason as requestOtpAction: every outcome reaches the caller identically.
  await supabase.auth.resetPasswordForEmail(email);

  return { status: "sent", email };
}

const resetVerifySchema = z.object({
  email: z.email().max(160),
  token: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code."),
});

export type ResetVerifyState = { status: "idle" } | { status: "error"; message: string } | { status: "verified" };

/**
 * Checks the reset code. Establishes a real session on success (Supabase's
 * own behavior for a `type: 'recovery'` verify) — `setNewPasswordAction`
 * relies on that session, not on anything passed between these two calls.
 *
 * Defaults this session to NOT remembered before verifying, deliberately —
 * a password-reset session is not the ordinary sign-in form, has no
 * remember-me checkbox of its own, and staff/owners' own default (unticked)
 * is the safer one to fall back to here specifically.
 */
export async function verifyResetCodeAction(_previous: ResetVerifyState, formData: FormData): Promise<ResetVerifyState> {
  if (!isSupabaseConfigured()) return { status: "error", message: "Accounts aren't connected yet." };

  const parsed = resetVerifySchema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    token: String(formData.get("token") ?? "").trim(),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Enter the 6-digit code." };
  const { email, token } = parsed.data;

  const limit = checkResetVerifyLimit(email, await clientIp());
  if (!limit.allowed) return { status: "error", message: `Too many attempts. Wait ${limit.retryAfterSeconds} seconds and try again.` };

  await setRememberChoice(false);

  const supabase = await createServerClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "recovery" });

  if (error) {
    return { status: "error", message: "That code didn't work. It may be wrong or expired — check it, or request a new one." };
  }

  return { status: "verified" };
}

const newPasswordSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, { message: "Those passwords don't match.", path: ["confirmPassword"] });

export type SetPasswordState = { status: "idle" } | { status: "error"; message: string };

/**
 * Sets the new password. Requires the live session `verifyResetCodeAction`
 * established — `getUser()`'s own id decides whose password changes, never
 * anything the form supplies, so there is nothing to authorize beyond
 * "does this browser hold a real session right now." No staff-only gate
 * (auth-v3, item C — see the doc comment above this flow's first action):
 * a customer resetting their own account's password is exactly as
 * authorized as a staff member resetting theirs, since both are always
 * acting on their own proven session.
 *
 * Eight characters, not ten (auth-v3): lowered to match `createAccountAction`'s
 * signup minimum, so one number governs every password set anywhere in the
 * app — a customer setting an initial password here (the "code-only account
 * has none yet" case) faces the same bar a fresh signup does, not a
 * stealth-stricter one. Flagged for reviewers: this is a small, deliberate
 * reduction from the previous 10-character staff-only minimum, made for
 * consistency now that this flow is customer-facing too, not an oversight.
 *
 * After a successful change: every OTHER session of this user is revoked
 * (`signOut({ scope: 'others' })` — this one, the one that just proved both
 * inbox access and a new password, is deliberately left signed in), then
 * the audit row, and an owner alert ONLY when this account is staff/owner
 * (`recordPasswordChangedAndAlert`, `kind` decided here from `resolveHome()`
 * — never blocks or fails this action even if it itself has trouble).
 */
export async function setNewPasswordAction(_previous: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  if (!isSupabaseConfigured()) return { status: "error", message: "Accounts aren't connected yet." };

  const parsed = newPasswordSchema.safeParse({
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check your details." };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "That reset code expired. Start over and request a new one." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { status: "error", message: "That password could not be set. Try a different one." };

  try {
    await supabase.auth.signOut({ scope: "others" });
  } catch (err) {
    // The password change already succeeded — a failure to revoke other sessions is logged, not fatal to this action.
    console.error("setNewPasswordAction: failed to revoke other sessions", err);
  }

  const org = await requireOrg();
  // resolveHome(), not a direct getStaff() call: it already decides staff-vs-customer for the redirect below,
  // so reusing it here avoids a second, redundant identity lookup — and it is routing logic, not an
  // authorization gate, so this account's own permission-gate registry test (rightly) never mistakes it for
  // one, the way a bare `getStaff()` call would.
  const home = await resolveHome();
  const kind = home.kind === "staff" ? "staff" : "customer";
  await recordPasswordChangedAndAlert({ orgId: org.id, userId: user.id, email: user.email ?? null, kind });

  revalidatePath("/", "layout");
  redirect(home.path ?? "/account/sign-in");
}

// Sign-out lives at `/api/auth/sign-out` (a Route Handler), not here. See that
// route's comment: a Server Action that calls `cookies().set()` and then
// `redirect()` does not reliably carry the cookie deletion onto the redirect
// response on this Next.js version.
