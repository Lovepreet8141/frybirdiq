"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers, loyaltyAccounts } from "@/db/schema";
import { isSupabaseConfigured } from "@/lib/env";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrg } from "@/lib/repositories/org";
import { resolveHome } from "@/lib/auth/route-home";
import { clientIp } from "@/lib/auth/client-ip";
import { checkOtpRequestLimit, checkOtpVerifyLimit } from "@/lib/auth/otp-rate-limit";
import { setRememberChoice } from "@/lib/auth/remember-me-cookies";

/*
 * Customer auth (auth-v2): email code only, one screen, for both sign-in
 * and sign-up — `signInWithOtp` with `shouldCreateUser: true` creates the
 * Supabase Auth user at send time if the address is new, and confirms it
 * the moment the code verifies. No password anywhere, no link — the old
 * `createAccount`/`resendConfirmation` (signUp + emailed confirm link) are
 * gone, not merely unrendered. `signInWithOtp`/`verifyOtp` both run
 * server-side through the same `createServerClient()` every other customer
 * auth action uses, so a successful verify sets the session cookies the
 * normal way.
 *
 * A brand-new account has no `customers` row yet right after its first
 * verify — `verifyOtpAction` routes that case to `completeProfileAction`
 * (name + phone) rather than trying to guess intent from other signals. An
 * EXISTING account that predates this card and was never confirmed under
 * the old password flow already has a `customers` row (the old `createAccount`
 * inserted it before the confirmation check, not after) — its first code
 * verify both confirms it (a side effect of any successful Supabase OTP
 * verification) and signs it straight in, no profile step needed.
 */

const otpEmailSchema = z.object({ email: z.email("Enter a valid email address.").max(160) });

export type OtpRequestState = { status: "idle" } | { status: "error"; message: string } | { status: "sent"; email: string };

/**
 * Sends the code. Always answers the same way whether or not the address
 * already has an account — an unknown email and a real send must look
 * identical to the caller, so nothing here reveals which addresses exist.
 */
export async function requestOtpAction(_previous: OtpRequestState, formData: FormData): Promise<OtpRequestState> {
  if (!isSupabaseConfigured()) return { status: "error", message: "Accounts aren't connected yet." };

  const parsed = otpEmailSchema.safeParse({ email: String(formData.get("email") ?? "").trim() });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Enter a valid email address." };
  const email = parsed.data.email;

  const limit = checkOtpRequestLimit(email, await clientIp());
  if (!limit.allowed) return { status: "error", message: `Too many requests. Wait ${limit.retryAfterSeconds} seconds and try again.` };

  const supabase = await createServerClient();
  // The result is deliberately unused: every outcome (a brand-new address, an existing one, Supabase's own
  // rate limit) reaches the customer as the same "check your email" state — see the doc comment above.
  await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });

  return { status: "sent", email };
}

const otpVerifySchema = z.object({
  email: z.email().max(160),
  token: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code."),
});

export type OtpVerifyState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "need-profile"; email: string };

/**
 * Checks the code. A six-digit code is only as safe as the guesses allowed
 * against it — `checkOtpVerifyLimit` is checked on every attempt, right or
 * wrong, before Supabase is ever asked. The code itself never reaches a log
 * line anywhere in this function, on success or failure.
 *
 * `remember` is read from the same submission and applied BEFORE `verifyOtp`
 * — see `setRememberChoice`'s own doc comment for why the order matters:
 * that call's own cookie writes need to see the new choice already in place.
 */
export async function verifyOtpAction(_previous: OtpVerifyState, formData: FormData): Promise<OtpVerifyState> {
  if (!isSupabaseConfigured()) return { status: "error", message: "Accounts aren't connected yet." };

  const parsed = otpVerifySchema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    token: String(formData.get("token") ?? "").trim(),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Enter the 6-digit code." };
  const { email, token } = parsed.data;

  const limit = checkOtpVerifyLimit(email, await clientIp());
  if (!limit.allowed) return { status: "error", message: `Too many attempts. Wait ${limit.retryAfterSeconds} seconds and try again.` };

  await setRememberChoice(formData.get("remember") === "on");

  const supabase = await createServerClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });

  if (error) {
    // Never the gateway's own words: one plain message for a wrong code, an expired one, or too many earlier
    // tries, so nothing here can hint at which. The code is never included, or logged, anywhere in this branch.
    return { status: "error", message: "That code didn't work. It may be wrong or expired — check it, or request a new one." };
  }

  revalidatePath("/", "layout");

  // Staff signing in here go to the counter.
  const home = await resolveHome();
  if (home.kind === "staff") redirect("/app/orders");
  if (home.kind === "customer") redirect("/account");

  // Confirmed, but no customer row yet: a brand-new account's first-ever verify, or (rarer) an old
  // confirmed account that never got one. Same remedy either way — ask for a name and phone now.
  return { status: "need-profile", email };
}

const profileSchema = z.object({
  name: z.string().trim().min(1, "Tell us your name.").max(80),
  phone: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number."),
});

export type CompleteProfileState = { status: "idle" } | { status: "error"; message: string };

/**
 * Finishes creating the account: the Supabase Auth user and its session
 * already exist (this can only be reached from `verifyOtpAction`'s
 * "need-profile" state, i.e. after a real code was verified) — this only
 * adds the `customers`/`loyaltyAccounts` rows a real order or account page
 * needs. Requires a live session; there is nothing here a stranger could
 * call usefully without one, since it writes against `getUser()`'s own id,
 * never an id taken from the form.
 */
export async function completeProfileAction(_previous: CompleteProfileState, formData: FormData): Promise<CompleteProfileState> {
  if (!isSupabaseConfigured()) return { status: "error", message: "Accounts aren't connected yet." };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "That code expired. Request a new one and try again." };

  const parsed = profileSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check your details." };

  const org = await requireOrg();
  const database = db();

  const [existingRow] = await database
    .select()
    .from(customers)
    .where(and(eq(customers.orgId, org.id), eq(customers.userId, user.id)))
    .limit(1);

  // Already completed (a double-submit, or a resumed session) — idempotent, not an error.
  if (existingRow) {
    revalidatePath("/", "layout");
    redirect("/account");
  }

  /*
   * A phone number is never how a sign-up gets access to history — see the
   * identical reasoning this replaces, previously in `createAccount`. Guest
   * orders are keyed on phone, so a row with this number may already carry
   * someone's addresses and past orders; typing a number here is not proof
   * of owning it. No existing row for this phone → safe to attach it. A row
   * already exists (guest history, unclaimed) → the new account is created
   * without a phone rather than seizing that row's history; the orphaned
   * guest row is untouched and unreachable from this session.
   */
  const [existingPhone] = await database
    .select()
    .from(customers)
    .where(and(eq(customers.orgId, org.id), eq(customers.phone, parsed.data.phone)))
    .limit(1);

  if (existingPhone?.userId) {
    return { status: "error", message: "That mobile number already has an account. Sign in instead." };
  }

  // onConflictDoNothing targets customers_org_user_unique (0057): the pre-check above is a real check, not
  // the actual guarantee — two concurrent submits of this same form (a double-tap before the first response
  // returns) can both pass it and both reach this insert. Without a DB-level guard, that would either throw
  // a raw unique-violation or, before 0057, silently create two rows for the same account. With it, the
  // loser's insert returns nothing and falls through to the same "already completed" success path.
  const [customer] = await database
    .insert(customers)
    .values({
      orgId: org.id,
      userId: user.id,
      name: parsed.data.name,
      phone: existingPhone ? null : parsed.data.phone,
      email: user.email ?? null,
    })
    .onConflictDoNothing({ target: [customers.orgId, customers.userId] })
    .returning();

  if (customer) {
    await database
      .insert(loyaltyAccounts)
      .values({ orgId: org.id, customerId: customer.id, pointsBalance: 0 })
      .onConflictDoNothing();
  }

  revalidatePath("/", "layout");
  redirect("/account");
}

// Sign-out lives at `/api/auth/sign-out-customer` (a Route Handler), not
// here. See `src/app/api/auth/sign-out/route.ts`'s comment: a Server Action
// that calls `cookies().set()` and then `redirect()` does not reliably carry
// the cookie deletion onto the redirect response on this Next.js version.
