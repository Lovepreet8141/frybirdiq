import "server-only";

/**
 * Resolving the current organization.
 *
 * Every repository query scopes by this. That is not belt-and-braces on top of
 * row-level security — it is the only tenant boundary on this path.
 *
 * The application connects to Postgres as the `postgres` role through
 * `DATABASE_URL`, and that role **bypasses row-level security**. The policies
 * in supabase/migrations/0001 guard the Supabase client paths, where a request
 * arrives with an anon or authenticated key. They do nothing for Drizzle.
 *
 * So: a repository query without an org filter returns every organization's
 * rows. §42 warns against retrofitting multi-location once a single-store
 * schema has set; the same applies to a single-org query.
 */

import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { DEFAULT_PRICE_BASIS, type PriceBasis, type PricingContext, pricingContext } from "@/lib/pricing";
import { isSupabaseConfigured } from "@/lib/env";

export const ORG_SLUG = "frybird";

export interface Org {
  readonly id: string;
  readonly name: string;
  readonly priceBasis: PriceBasis;
  readonly gstin: string | null;
}

/**
 * The organization, resolved once per request.
 *
 * `cache` dedupes this across every repository call in a single render, so a
 * page that touches the menu, the cart and the header does one lookup rather
 * than three.
 */
export const getOrg = cache(async (): Promise<Org | null> => {
  const [org] = await db().select().from(organizations).where(eq(organizations.slug, ORG_SLUG)).limit(1);
  if (!org) return null;

  return {
    id: org.id,
    name: org.name,
    priceBasis: org.priceBasis,
    gstin: org.gstin,
  };
});

/** Throws rather than returning an unscoped query. */
export async function requireOrg(): Promise<Org> {
  const org = await getOrg();
  if (!org) throw new Error(`org: no organization with slug "${ORG_SLUG}". Run pnpm db:seed.`);
  return org;
}

/**
 * The pricing context for this business.
 *
 * Reads the GST basis from the organization row — the single switch. Falls
 * back to the confirmed default only when there is no database to read, which
 * is the preview path; the fallback is the same value the seed writes, so the
 * two cannot disagree.
 */
export async function resolvePricingContext(): Promise<PricingContext> {
  if (!isSupabaseConfigured()) return pricingContext({ priceBasis: DEFAULT_PRICE_BASIS });
  const org = await getOrg();
  return pricingContext(org ?? { priceBasis: DEFAULT_PRICE_BASIS });
}
