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
import { locations, organizations } from "@/db/schema";
import { type Paise, paise } from "@/lib/money";
import { DEFAULT_PRICE_BASIS, type PriceBasis, type PricingContext, pricingContext } from "@/lib/pricing";
import { isSupabaseConfigured } from "@/lib/env";

export const ORG_SLUG = "frybird";

export interface Org {
  readonly id: string;
  readonly name: string;
  readonly priceBasis: PriceBasis;
  readonly gstin: string | null;
  /** The most a customer can owe cash before checkout insists on online payment. Roadmap 5.5. */
  readonly codCap: Paise;
  /** Whether cash is offered at checkout. */
  readonly cashEnabled: boolean;
  /** The business's own switch for online payment, on top of whether Razorpay is actually configured. */
  readonly onlineEnabled: boolean;
  /** 24-hour "HH:MM". What the website's opening hours read. */
  readonly openingTime: string;
  readonly closingTime: string;
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
    codCap: paise(org.codCap),
    cashEnabled: org.cashEnabled,
    onlineEnabled: org.onlineEnabled,
    openingTime: org.openingTime,
    closingTime: org.closingTime,
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

export interface StoreHeadline {
  readonly name: string;
  /** "Sector 9 · Ambala City" — the outlet and its city, from the location row. */
  readonly line: string;
}

/** What the shell shows under the wordmark: the store, from the org and location rows. */
export const getStoreHeadline = cache(async (orgId: string): Promise<StoreHeadline> => {
  const [org] = await db().select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const [location] = await db().select({ name: locations.name, city: locations.city }).from(locations).where(eq(locations.orgId, orgId)).orderBy(locations.createdAt).limit(1);
  return { name: org?.name ?? "FRYBIRD", line: [location?.name, location?.city].filter(Boolean).join(" · ") || "1 store" };
});
