import "server-only";

/**
 * Looking a customer up by phone — the counter's version of what the
 * website does automatically for a signed-in shopper.
 *
 * Read-only and narrow on purpose: this exists so a cashier can see a
 * regular's name and FRYBIRD REWARDS progress before ringing them up, not to
 * edit anything about the customer. `customers.view` gates it, matching the
 * permission the rest of the customer-facing staff screens already use.
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";

export interface CustomerLookup {
  readonly id: string;
  readonly name: string | null;
  readonly phone: string | null;
}

/** Exact match on the 10-digit number, scoped to the org. */
export async function findCustomerByPhone(orgId: string, phone: string): Promise<CustomerLookup | null> {
  const [row] = await db()
    .select({ id: customers.id, name: customers.name, phone: customers.phone })
    .from(customers)
    .where(and(eq(customers.orgId, orgId), eq(customers.phone, phone)))
    .limit(1);
  return row ?? null;
}
