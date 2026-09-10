"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { resolveHome } from "./route-home";

export type SignInState = { status: "idle" } | { status: "error"; message: string };

const credentialsSchema = z.object({
  email: z.email("Enter the email address your account uses."),
  password: z.string().min(1, "Enter your password."),
});

/**
 * Signs a staff member in.
 *
 * There is no sign-up. Staff accounts are created by the owner in the Supabase
 * dashboard and given a role with `pnpm staff:grant` — a counter account is not
 * something a stranger should be able to mint for themselves, and §41's roles
 * mean nothing if anyone can obtain one.
 *
 * Rate limiting is Supabase's, on the auth endpoint. Nothing here should try to
 * re-implement it.
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

export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/sign-in");
}
