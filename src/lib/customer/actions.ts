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

export type CustomerAuthState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "check-email"; message: string };

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

  // Supabase can be configured to require a confirmation click. When it is,
  // there is no session yet — say so rather than bouncing to a page that will
  // redirect straight back to sign-in.
  if (!data.session) {
    return { status: "check-email", message: "Check your email to confirm your account, then sign in." };
  }

  revalidatePath("/", "layout");
  redirect("/account");
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

  // Deliberately does not say which was wrong — that tells an attacker which
  // addresses have accounts.
  if (error) return { status: "error", message: "That email and password don't match." };

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

export async function signOutCustomer(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
