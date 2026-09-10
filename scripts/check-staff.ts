/**
 * Checks that a granted role will actually resolve at sign-in.
 *
 *     pnpm staff:check someone@example.com
 *
 * Runs the same two conditions `getStaff()` requires — a Supabase Auth user,
 * and an active membership of this organization — so a role that was granted
 * against the wrong org or an unconfirmed user shows up here rather than as a
 * silent redirect back to the sign-in page.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { closeDb, db } from "../src/db/connection";
import { memberships, organizations } from "../src/db/schema";
import { can, permissionsFor } from "../src/domain/permissions";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("usage: pnpm staff:check <email>");
    process.exitCode = 1;
    return;
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  console.log(`auth user        : ${user ? "found" : "NOT FOUND"}`);
  if (!user) return;
  console.log(`  email confirmed: ${user.email_confirmed_at ? "yes" : "NO — sign-in will fail"}`);

  const database = db();
  const [org] = await database.select().from(organizations).where(eq(organizations.slug, "frybird")).limit(1);
  if (!org) {
    console.log("organization     : NOT FOUND — run pnpm db:seed");
    return;
  }

  const rows = await database
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.orgId, org.id), eq(memberships.isActive, true)));

  console.log(`organization     : ${org.name}`);
  console.log(`active membership: ${rows.length > 0 ? rows.map((r) => r.role).join(", ") : "NONE — staff area stays shut"}`);
  if (rows.length === 0) return;

  const roles = rows.map((r) => r.role);
  console.log(`\ngetStaff() would resolve: ${roles.join(", ")}`);
  console.log(`  can take cash (orders.update) : ${can(roles, "orders.update")}`);
  console.log(`  can move tickets (kitchen.update): ${can(roles, "kitchen.update")}`);
  console.log(`  can refund (orders.refund)    : ${can(roles, "orders.refund")}`);
  console.log(`  permissions total             : ${permissionsFor(roles[0]!).length}`);
}

main()
  .then(async () => {
    await closeDb();
    process.exit(process.exitCode ?? 0);
  })
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await closeDb();
    process.exit(1);
  });
