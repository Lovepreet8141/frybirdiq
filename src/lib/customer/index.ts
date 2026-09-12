import "server-only";

/**
 * The signed-in customer.
 *
 * Separate from `src/lib/auth`, which is staff. Both sit on the same Supabase
 * Auth user; what differs is what they are attached to. A staff member has a
 * membership of the organization. A customer has a row in `customers`.
 *
 * Someone can be both — the owner ordering their own dinner — and neither
 * lookup grants the other's access.
 */

import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, loyaltyAccounts } from "@/db/schema";
import { isSupabaseConfigured } from "@/lib/env";
import { createServerClient } from "@/lib/supabase/server";
import { getOrg } from "@/lib/repositories/org";

export interface Customer {
  readonly id: string;
  readonly userId: string;
  readonly name: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly marketingConsent: boolean;
  readonly points: number;
  /** Stamps since the last free item — the "buy 7, get the 8th free" card. */
  readonly stampCount: number;
  /**
   * From Supabase Auth's own `email_confirmed_at`, never a column we own —
   * a second copy of this fact could drift from what actually gated sign-in.
   * Order history, rewards balance and saved addresses are withheld until
   * this is true; guest checkout is untouched by it.
   */
  readonly emailVerified: boolean;
}

export const getCustomer = cache(async (): Promise<Customer | null> => {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const org = await getOrg();
  if (!org) return null;

  const [row] = await db()
    .select()
    .from(customers)
    .where(and(eq(customers.userId, user.id), eq(customers.orgId, org.id)))
    .limit(1);

  if (!row) return null;

  const [account] = await db()
    .select()
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.customerId, row.id))
    .limit(1);

  return {
    id: row.id,
    userId: user.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    marketingConsent: row.marketingConsent,
    points: account?.pointsBalance ?? 0,
    stampCount: account?.stampCount ?? 0,
    emailVerified: user.email_confirmed_at != null,
  };
});

export async function requireCustomer(): Promise<Customer> {
  const customer = await getCustomer();
  if (!customer) throw new Error("customer: not signed in");
  return customer;
}
