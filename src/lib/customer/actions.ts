"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers, loyaltyAccounts } from "@/db/schema";
import { cookieSecret, isSupabaseConfigured } from "@/lib/env";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrg } from "@/lib/repositories/org";
import { resolveHome } from "@/lib/auth/route-home";
import { clientIp } from "@/lib/auth/client-ip";
import { checkSignInLimit, checkSignupLimit, checkSignupVerifyLimit } from "@/lib/customer/auth-rate-limit";
import { setRememberChoice } from "@/lib/auth/remember-me-cookies";
import { decodeContactCookie, encodeContactCookie } from "@/lib/cart/contact-cookie";

/*
 * Customer auth (auth-v3, reversing auth-v2 by owner decision): customers
 * are password accounts again. The 6-digit code is used for exactly two
 * things now — confirming the email at signup, and resetting a forgotten
 * password (the latter shares `src/lib/auth/actions.ts`'s reset flow with
 * staff; see that module). It is never a sign-in mechanism of its own —
 * `signInWithOtp`/`shouldCreateUser` and the old unified `requestOtpAction`/
 * `verifyOtpAction`/`completeProfileAction` are gone, not merely unrendered.
 *
 * `createAccountAction` collects name, phone, email and password up front —
 * the SIGNUP FORM asks for all of it in one step, unlike auth-v2's deferred
 * "complete your profile after the code" screen. But the `customers`/
 * `loyaltyAccounts` rows are NOT written at signup time. Security review
 * (auth-v3 delta) found that writing them there — keyed on the id
 * `signUp()` returns, before anyone has proven they own the address —
 * lets an attacker submit a stranger's real email with attacker-chosen
 * name/phone: Supabase creates a real (if unconfirmed) auth user and
 * silently resends its code to the real inbox regardless of who asked, so
 * the row would sit there, pre-seeded with the attacker's data, until the
 * real owner eventually opens that email and verifies — inheriting the
 * attacker's name/phone with no way to fix it (no profile-edit screen
 * exists). A second reviewer independently found a related issue: an
 * unconfirmed row written at signup time still permanently occupies a real
 * phone number (`customers_org_phone_unique`) even if its code is never
 * verified, silently denying that number to whoever actually owns it
 * later, with no expiry.
 *
 * So the write is deferred to `verifySignupCodeAction`, after `verifyOtp`
 * succeeds and a real, proven session exists — the same trust boundary
 * auth-v2's `completeProfileAction` used, just merged into the code-verify
 * step instead of a separate screen, since name/phone/password are already
 * in hand by then. Nothing durable — not even Supabase's own user metadata
 * — is written under an unproven email in between.
 *
 * Red-team (delta, same review) found that carrying name/phone forward as
 * plain hidden form fields was its own hole: nothing bound them to the
 * ORIGINAL signup submission, so anyone could edit the hidden `phone` field
 * before verifying and attach an arbitrary unclaimed number to their own,
 * genuinely-owned account — no email spoofing needed at all, since it's
 * their own real code. `createAccountAction` instead returns a `profileToken`
 * — `{email, name, phone}` signed with `COOKIE_SECRET` via
 * `encodeContactCookie` (the same generic signer `remember-me.ts` and
 * `frybird_contact` use, reused rather than duplicated) — and that's the
 * ONE hidden field the client actually carries. `verifySignupCodeAction`
 * decodes and verifies it, and only trusts the name/phone inside if the
 * signature is valid AND its embedded email matches the email this code was
 * just verified for. A tampered or missing token is never an error — it's
 * simply treated as absent, same fail-closed posture `decodeContactCookie`
 * already has — the account still gets created, just without a name/phone
 * (the same outcome as the sign-in recovery path that never had one).
 *
 * Anti-enumeration for signup leans on Supabase's own behavior for the
 * common case (with `Confirm email` ON, `signUp()` for an already-confirmed
 * address returns success with no error and no real email sent), with an
 * explicit fallback here for the Dashboard configurations where Supabase
 * does return an error (`user_already_exists`/`email_exists`) — see
 * `createAccountAction` below.
 */

const phoneSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number.");

const signupSchema = z
  .object({
    name: z.string().trim().min(1, "Tell us your name.").max(80),
    phone: phoneSchema,
    email: z.email("Enter a valid email address.").max(160),
    password: z.string().min(8, "Use at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, { message: "Those passwords don't match.", path: ["confirmPassword"] });

export type CreateAccountState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "sent"; email: string; profileToken: string | null };

/**
 * `{purpose, email, name, phone}` as `verifySignupCodeAction` needs to trust it: signed, tied to a specific
 * email, and tagged with a fixed `purpose` literal. `encodeContactCookie`/`decodeContactCookie` are the same
 * generic signer `frybird_contact` (`remembered-contact.ts`) already uses with the SAME `COOKIE_SECRET`, and
 * that cookie's own payload shape (`{name, phone, email}`) is otherwise indistinguishable from this one —
 * security review (delta) flagged that a value valid for one would also parse as the other. Traced as not
 * exploitable today (whoever holds a validly signed token of either kind already authored its own contents),
 * but the `purpose` tag closes the class structurally rather than leaving two same-shaped, same-secret
 * tokens to stay accidentally compatible by coincidence.
 */
const profileTokenSchema = z.object({
  purpose: z.literal("signup-profile"),
  email: z.email(),
  name: z.string().trim().min(1).max(80),
  phone: phoneSchema,
});

/**
 * Signs a `{email, name, phone}` tuple for `verifySignupCodeAction` to trust
 * later, or `null` if `COOKIE_SECRET` isn't configured — the caller degrades
 * to an unnamed account rather than trusting an unsigned value (see the
 * module doc comment).
 */
function signProfile(email: string, name: string, phone: string): string | null {
  const secret = cookieSecret();
  if (secret.kind !== "ok") {
    console.error("createAccountAction: COOKIE_SECRET is unset or invalid — signup will proceed without a name/phone");
    return null;
  }
  return encodeContactCookie({ purpose: "signup-profile", email, name, phone }, secret.secret);
}

/**
 * Signs up: creates the Supabase Auth user, then sends a 6-digit
 * confirmation code (the "Confirm signup" template) — no link. Writes
 * NOTHING to `customers`/`loyaltyAccounts` — see the module doc comment for
 * why that's deferred to `verifySignupCodeAction`, after email ownership is
 * actually proven. `profileToken` is the ONLY thing the client carries
 * forward for that later step (see the module doc comment for why it's a
 * signed token now, not raw hidden fields); nothing here writes anywhere
 * durable.
 *
 * Answers the same "sent" state on every outcome that isn't a genuine
 * problem with THIS submission (a weak password, Supabase's own send rate
 * limit, or the Dashboard-configuration case where a duplicate address
 * comes back as an explicit `user_already_exists`/`email_exists` error
 * rather than Supabase's own silent no-op) — none of these branches reveal
 * whether the email already had an account.
 */
export async function createAccountAction(_previous: CreateAccountState, formData: FormData): Promise<CreateAccountState> {
  if (!isSupabaseConfigured()) return { status: "error", message: "Accounts aren't connected yet." };

  const parsed = signupSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check your details." };
  const { name, phone, email, password } = parsed.data;

  const limit = checkSignupLimit(email, await clientIp());
  if (!limit.allowed) return { status: "error", message: `Too many requests. Wait ${limit.retryAfterSeconds} seconds and try again.` };

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    // A genuine problem with THIS submission is surfaced with its own message; a duplicate address (however
    // Supabase's own Dashboard configuration happens to report it) falls back to the identical "sent"
    // response as a real new signup — see the module doc comment. Anything else gets one generic message.
    if (error.code === "weak_password") return { status: "error", message: "Choose a stronger password." };
    if (error.code === "over_email_send_rate_limit") return { status: "error", message: "Too many requests. Wait and try again." };
    if (error.code === "user_already_exists" || error.code === "email_exists") return { status: "sent", email, profileToken: signProfile(email, name, phone) };
    return { status: "error", message: "That didn't go through. Check your details and try again." };
  }

  return { status: "sent", email, profileToken: signProfile(email, name, phone) };
}

const emailSchema = z.object({ email: z.email("Enter a valid email address.").max(160) });

export type ResendSignupCodeState = { status: "idle" } | { status: "error"; message: string } | { status: "sent"; email: string };

/** Resends the signup confirmation code, via Supabase's own `resend`, not a second `signUp()` call. */
export async function resendSignupCodeAction(_previous: ResendSignupCodeState, formData: FormData): Promise<ResendSignupCodeState> {
  if (!isSupabaseConfigured()) return { status: "error", message: "Accounts aren't connected yet." };

  const parsed = emailSchema.safeParse({ email: String(formData.get("email") ?? "").trim() });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Enter a valid email address." };
  const email = parsed.data.email;

  const limit = checkSignupLimit(email, await clientIp());
  if (!limit.allowed) return { status: "error", message: `Too many requests. Wait ${limit.retryAfterSeconds} seconds and try again.` };

  const supabase = await createServerClient();
  await supabase.auth.resend({ type: "signup", email });

  return { status: "sent", email };
}

const signupVerifySchema = z.object({
  email: z.email().max(160),
  token: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code."),
  // Present when reached straight from JoinForm (the common case); absent when reached from
  // CustomerSignInForm's "Send me a code" escape hatch, which never had one to carry — see below.
  // Opaque and unvalidated here on purpose: it's a signature-protected blob, decoded and checked below,
  // never parsed as free-form input.
  profileToken: z.string().optional(),
});

/**
 * Extracts the name/phone this signup actually asked for, from the signed
 * `profileToken` `createAccountAction` issued — or `{name: null, phone:
 * null}` if it's absent, unsigned, wrongly signed, or was issued for a
 * DIFFERENT email than the one just verified. Never throws; a bad token is
 * simply treated the same as no token at all (see the module doc comment).
 */
function readProfileToken(token: string | undefined, verifiedEmail: string): { name: string | null; phone: string | null } {
  if (!token) return { name: null, phone: null };
  const secret = cookieSecret();
  if (secret.kind !== "ok") return { name: null, phone: null };
  const decoded = decodeContactCookie(token, secret.secret);
  const parsed = profileTokenSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.email !== verifiedEmail) return { name: null, phone: null };
  return { name: parsed.data.name, phone: parsed.data.phone };
}

export type SignupVerifyState = { status: "idle" } | { status: "error"; message: string };

/**
 * Checks the signup code. On success this both confirms the email and signs
 * in (Supabase's own behavior for `type: 'signup'`) — and THIS is where the
 * `customers`/`loyaltyAccounts` rows are created, not at signup time; see
 * the module doc comment for why. `remember` has no checkbox on the signup
 * form; a fresh signup always gets the customer default (ticked), applied
 * before `verifyOtp` for the same cookie-ordering reason every other auth
 * action here does.
 *
 * The row-creation step mirrors auth-v2's deleted `completeProfileAction`,
 * now run right here instead of a separate screen: idempotent (a double
 * verify, or a retry after an earlier one raced, never creates a second
 * row), the same phone-collision refusal (a real existing account's phone
 * is never silently seized — safe to report now, since this session has
 * actually proven email ownership), and the same `onConflictDoNothing`
 * against `customers_org_user_unique` (0057) for the identity race. The
 * `customers_org_phone_unique` race the pre-check alone can't close (two
 * verifies racing on the same phone under different emails) is closed by
 * retrying once without the phone rather than surfacing a raw DB error —
 * the code was still right and the session is still real either way.
 *
 * `profileToken` decodes to nothing usable when this is reached from the
 * "send me a code" recovery path on sign-in (an account that started a
 * signup, was never verified, and is only now confirming) — that path never
 * had one to carry — OR when it fails to verify at all (tampered, wrongly
 * signed, or issued for a different email; see `readProfileToken`'s own doc
 * comment for why that's silently treated as absent, never an error). A row
 * is still created either way (a live, proven session must never dead-end
 * into `resolveHome()`'s "neither"), just without a name or phone yet.
 */
export async function verifySignupCodeAction(_previous: SignupVerifyState, formData: FormData): Promise<SignupVerifyState> {
  if (!isSupabaseConfigured()) return { status: "error", message: "Accounts aren't connected yet." };

  const parsed = signupVerifySchema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    token: String(formData.get("token") ?? "").trim(),
    profileToken: formData.has("profileToken") ? String(formData.get("profileToken")) : undefined,
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Enter the 6-digit code." };
  const { email, token } = parsed.data;

  const limit = checkSignupVerifyLimit(email, await clientIp());
  if (!limit.allowed) return { status: "error", message: `Too many attempts. Wait ${limit.retryAfterSeconds} seconds and try again.` };

  await setRememberChoice(true);

  const supabase = await createServerClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "signup" });

  if (error) {
    return { status: "error", message: "That code didn't work. It may be wrong or expired — check it, or request a new one." };
  }

  // Read only NOW, after verifyOtp has actually succeeded for this exact email — never trust the token's
  // claimed email over the one Supabase just verified the code against.
  const { name, phone } = readProfileToken(parsed.data.profileToken, email);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const org = await requireOrg();
    const database = db();

    const [existingRow] = await database
      .select()
      .from(customers)
      .where(and(eq(customers.orgId, org.id), eq(customers.userId, user.id)))
      .limit(1);

    if (!existingRow) {
      let phoneToAttach: string | null = null;

      if (phone) {
        const [existingPhone] = await database
          .select()
          .from(customers)
          .where(and(eq(customers.orgId, org.id), eq(customers.phone, phone)))
          .limit(1);

        if (existingPhone?.userId) {
          return { status: "error", message: "That mobile number already has an account. Sign in instead." };
        }
        // No row at all under this phone → safe to attach. A row already exists but is unclaimed (guest
        // history, userId null) → still never attached, the same as a claimed one: seizing it would hand
        // this new account someone else's guest order history just because they typed the same number.
        phoneToAttach = existingPhone ? null : phone;
      }

      const values = { orgId: org.id, userId: user.id, name: name ?? null, email: user.email ?? email };

      /*
       * onConflictDoNothing only names customers_org_user_unique (0057) — an empty .returning() from THAT
       * insert means a concurrent verify already created this user's row (the org_user race), handled the
       * same as completeProfileAction always did: fall through with customer left undefined, do nothing more.
       * A conflict on customers_org_phone_unique is a DIFFERENT constraint, not covered by that target, so
       * Postgres rejects the insert outright rather than returning empty — the phone pre-check above is a
       * real check, not a guarantee, so this is a real, reachable race (two verifies for different emails
       * landing on the same phone), not a hypothetical. Caught here and retried once without the phone,
       * rather than letting a raw DB error surface: the code was still right and the session is still real
       * either way.
       */
      let customer: { id: string } | undefined;
      try {
        customer = (
          await database
            .insert(customers)
            .values({ ...values, phone: phoneToAttach })
            .onConflictDoNothing({ target: [customers.orgId, customers.userId] })
            .returning()
        )[0];
      } catch (err) {
        if (!phoneToAttach) throw err;
        console.error("verifySignupCodeAction: customers insert failed (likely a phone race) — retrying without the phone", err);
        customer = (
          await database
            .insert(customers)
            .values({ ...values, phone: null })
            .onConflictDoNothing({ target: [customers.orgId, customers.userId] })
            .returning()
        )[0];
      }

      if (customer) {
        await database
          .insert(loyaltyAccounts)
          .values({ orgId: org.id, customerId: customer.id, pointsBalance: 0 })
          .onConflictDoNothing();
      }
    }
  }

  revalidatePath("/", "layout");

  const home = await resolveHome();
  if (home.kind === "staff") redirect(home.path);
  if (home.kind === "neither") {
    // Should not happen — the block above always creates a row for a fresh verify — but never leave a real,
    // proven session dead-ending with no explanation if it somehow does (same defensive shape signInCustomerAction uses).
    await supabase.auth.signOut();
    return { status: "error", message: "That didn't go through. Try signing in again." };
  }
  redirect("/account");
}

const signInSchema = z.object({
  email: z.email("Enter your email address."),
  password: z.string().min(1, "Enter your password."),
});

export type SignInCustomerState = { status: "idle" } | { status: "error"; message: string } | { status: "unconfirmed"; email: string };

/**
 * Signs a customer in with a password. Neutral on every failure that could
 * reveal whether an email has an account ("Email or password is incorrect")
 * — EXCEPT the one case the card explicitly asks to distinguish: an account
 * that exists but has never confirmed its email gets its own `unconfirmed`
 * state, so the form can offer "Send me a code" instead of a dead end. This
 * is a deliberate, owner-requested trade-off, not an oversight — flagged to
 * reviewers for that reason: it does let an attacker learn "this address
 * signed up but never confirmed," which the plain wrong-password case does
 * not.
 *
 * Rate-limited on every attempt, right or wrong (`checkSignInLimit`) —
 * this app's actual brute-force defense; see that module's own comment.
 */
export async function signInCustomerAction(_previous: SignInCustomerState, formData: FormData): Promise<SignInCustomerState> {
  if (!isSupabaseConfigured()) return { status: "error", message: "Sign-in isn't connected yet." };

  const parsed = signInSchema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check your details." };
  const { email, password } = parsed.data;

  const limit = checkSignInLimit(email, await clientIp());
  if (!limit.allowed) return { status: "error", message: `Too many attempts. Wait ${limit.retryAfterSeconds} seconds and try again.` };

  await setRememberChoice(formData.get("remember") === "on");

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.code === "email_not_confirmed") return { status: "unconfirmed", email };
    return { status: "error", message: "Email or password is incorrect." };
  }

  revalidatePath("/", "layout");

  const home = await resolveHome();
  if (home.kind === "staff") redirect(home.path);
  if (home.kind === "neither") {
    await supabase.auth.signOut();
    return { status: "error", message: "That account isn't set up yet. Try signing up instead." };
  }

  redirect("/account");
}

// Sign-out lives at `/api/auth/sign-out-customer` (a Route Handler), not
// here. See `src/app/api/auth/sign-out/route.ts`'s comment: a Server Action
// that calls `cookies().set()` and then `redirect()` does not reliably carry
// the cookie deletion onto the redirect response on this Next.js version.
