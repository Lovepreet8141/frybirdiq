"use server";

import { requireOrg } from "@/lib/repositories/org";
import { recordFranchiseInquiry } from "@/lib/repositories/franchise";
import { type FranchiseInquiryInput, franchiseInquirySchema } from "./franchise-schema";

export type FranchiseInquiryResult = { ok: true } | { ok: false; error: string };

/**
 * Ported from frybird-web's src/lib/api/franchise.functions.ts. Same
 * validation and honeypot logic; the transport changes (a TanStack
 * `createServerFn` writing to Cloudflare D1 there, a plain Next.js Server
 * Action writing to this org's own Supabase/Postgres here). Re-validates
 * with the authoritative schema regardless of what the client already
 * checked — the client's pass is only for instant field errors, never
 * trusted on its own.
 */
export async function submitFranchiseInquiry(input: FranchiseInquiryInput): Promise<FranchiseInquiryResult> {
  const parsed = franchiseInquirySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  // Silently "succeed" for a bot that filled the honeypot — same as
  // frybird-web's own behaviour. Telling it the submission failed only
  // teaches it to try again.
  if (parsed.data.company) {
    return { ok: true };
  }

  const org = await requireOrg();
  await recordFranchiseInquiry({
    orgId: org.id,
    name: parsed.data.name,
    city: parsed.data.city,
    phone: parsed.data.phone,
    message: parsed.data.message,
  });

  return { ok: true };
}
