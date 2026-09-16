import "server-only";

import { db } from "@/db";
import { franchiseInquiries } from "@/db/schema";

export interface FranchiseInquiryInput {
  readonly orgId: string;
  readonly name: string;
  readonly city: string;
  readonly phone: string;
  readonly message: string;
}

/**
 * Records a franchise partner inquiry from the public homepage form.
 *
 * A mailbox, not a CRM — insert only, no status, no read path from this
 * app yet. `franchise_inquiries` has row-level security enabled with no
 * policy at all (supabase/migrations/0030_franchise_inquiries.sql), so an
 * anon or authenticated Supabase client key can neither read nor write
 * it; this insert works only because it runs through this app's own
 * `postgres` connection, which bypasses RLS by design.
 */
export async function recordFranchiseInquiry(input: FranchiseInquiryInput): Promise<void> {
  await db().insert(franchiseInquiries).values({
    orgId: input.orgId,
    name: input.name,
    city: input.city,
    phone: input.phone,
    message: input.message,
  });
}
