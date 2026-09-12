"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers, loyaltyAccounts } from "@/db/schema";
import { isSupabaseConfigured, serverEnv } from "@/lib/env";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrg } from "@/lib/repositories/org";
import { resolveHome } from "@/lib/auth/route-home";

export type CustomerAuthState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "check-email"; email: string };

/** Where a confirmation link lands. `SITE_URL` is unset only in a shell with no Supabase project yet. */
function confirmRedirectUrl(): string | undefined {
  const site = serverEnv().SITE_URL;
  return site ? `${site.replace(/\/$/, "")}/auth/confirm` : undefined;
}

const joinSchema = z.object({
  name: z.string().trim().min(1, "Tell us your name.").max(80),
  phone: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number."),
  email: z.email("Enter a valid email address.").max(160),
  password: z.string().min(8, "Use at least 8 characters."),
});

/**
 * Creates a customer account.
 *
 * Self-serve, unlike staff: a customer account grants access to that person's
 * own orders and nothing else, so there is nothing to gate. §61 also says not
 * to force an account before a first order — guest checkout stays, and this is
 * an option rather than a step.
 */
export async function createAccount(_previous: CustomerAuthState, formData: FormData): Promise<CustomerAuthState> {
  if (!isSupabaseConfigured()) return { status: "error", message: "Accounts aren't connected yet." };

  const parsed = joinSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const org = await requireOrg();
  const database = db();

  /*
   * A phone number is never how a sign-up gets access to history.
   *
   * Guest orders are keyed on phone, so a record with this number may already
   * carry someone's addresses and past orders. Typing a number is not proof
   * of owning it — there is no verification step yet (see the OTP item in
   * the README) — so a new account can never be linked to an existing
   * customer row by phone match alone, claimed or not. Every sign-up gets
   * its own fresh row. This used to link an "unclaimed" (no `userId`) row on
   * the theory that nobody else had signed up with it yet; that reasoning
   * confused "nobody has signed up with it" with "belongs to the person
   * typing it" and handed a stranger's order history to whoever typed their
   * number first. Fixed without waiting on OTP: correctness now, convenience
   * (re-linking a returning guest's own past orders) once a number can
   * actually be verified.
   */
  const [existing] = await database
    .select()
    .from(customers)
    .where(and(eq(customers.orgId, org.id), eq(customers.phone, parsed.data.phone)))
    .limit(1);

  if (existing?.userId) {
    return { status: "error", message: "That mobile number already has an account. Sign in instead." };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: confirmRedirectUrl() },
  });

  if (error || !data.user) {
    return {
      status: "error",
      message: error?.message.includes("already registered")
        ? "That email already has an account. Sign in instead."
        : "That account could not be created.",
    };
  }

  // `customers.phone` is unique per org (`customers_org_phone_unique`), and
  // that constraint stays exactly what makes repeat *guest* orders under one
  // number consolidate — the thing worth keeping about phone-keyed rows.
  // What must never happen is a new account silently inheriting whatever
  // already sits under that number. So: no existing row for this phone at
  // all → safe to attach it to the new account, nothing to take over. A row
  // already exists (guest history, unclaimed) → the new account is created
  // without a phone rather than seizing that row's history; the orphaned
  // guest row is untouched and unreachable from this session.
  const [customer] = await database
    .insert(customers)
    .values({
      orgId: org.id,
      userId: data.user.id,
      name: parsed.data.name,
      phone: existing ? null : parsed.data.phone,
      email: parsed.data.email,
    })
    .returning();

  if (customer) {
    await database
      .insert(loyaltyAccounts)
      .values({ orgId: org.id, customerId: customer.id, pointsBalance: 0 })
      .onConflictDoNothing();
  }

  // Confirm email is on for this project, so there is no session yet — say so
  // rather than bouncing to a page that will redirect straight back to
  // sign-in. `email_confirmed_at` unset is the real signal; `data.session`
  // can be present even pre-confirmation for other Supabase configurations,
  // so this doesn't assume which flavour of "unconfirmed" is running.
  if (!data.user.email_confirmed_at) {
    return { status: "check-email", email: parsed.data.email };
  }

  revalidatePath("/", "layout");
  redirect("/account");
}

export type ResendState = { status: "idle" | "sent" | "error"; message?: string };

/**
 * Resends the confirmation email. Supabase's own endpoint is rate-limited —
 * nothing here re-implements that, matching how `signIn` treats sign-in
 * attempts (§ the comment on `signIn`). The error it returns on a limit hit
 * is passed straight through.
 */
export async function resendConfirmation(_previous: ResendState, formData: FormData): Promise<ResendState> {
  if (!isSupabaseConfigured()) return { status: "error", message: "Accounts aren't connected yet." };

  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { status: "error", message: "Missing email address." };

  const supabase = await createServerClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: confirmRedirectUrl() },
  });

  if (error) {
    return {
      status: "error",
      message: error.status === 429 ? "Too many requests. Wait a few minutes and try again." : "Couldn't resend that email. Try again shortly.",
    };
  }

  return { status: "sent", message: "Email sent. Check your inbox." };
}

export async function signInCustomer(
  _previous: CustomerAuthState,
  formData: FormData,
): Promise<CustomerAuthState> {
  if (!isSupabaseConfigured()) return { status: "error", message: "Accounts aren't connected yet." };

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { status: "error", message: "Enter your email and password." };

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Supabase refuses this sign-in outright until the email is confirmed —
    // there is no session to gate here, the account can't get in at all. That
    // is a different fact from a wrong password, so it gets the same
    // check-email panel a fresh sign-up sees, not a generic "didn't match".
    if (error.code === "email_not_confirmed") return { status: "check-email", email };
    // Otherwise deliberately does not say which was wrong — that tells an
    // attacker which addresses have accounts.
    return { status: "error", message: "That email and password don't match." };
  }

  revalidatePath("/", "layout");

  // Staff signing in here are sent to the counter rather than to /account,
  // which they have no customer record for and would be bounced out of.
  const home = await resolveHome();
  if (home.kind === "staff") redirect("/app/orders");
  if (home.kind === "neither") {
    return {
      status: "error",
      message: "That account has no customer profile yet. Create one, or order once as a guest.",
    };
  }

  redirect("/account");
}

// Sign-out lives at `/api/auth/sign-out-customer` (a Route Handler), not
// here. See `src/app/api/auth/sign-out/route.ts`'s comment: a Server Action
// that calls `cookies().set()` and then `redirect()` does not reliably carry
// the cookie deletion onto the redirect response on this Next.js version.
