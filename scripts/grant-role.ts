/**
 * Gives a Supabase Auth user a role in the FRYBIRD organization.
 *
 *     pnpm staff:grant someone@example.com OWNER
 *
 * There is no sign-up flow, on purpose: a counter account is not something a
 * stranger should be able to mint for themselves, and §41's roles mean nothing
 * if anyone can obtain one. The owner creates the user in the Supabase
 * dashboard (Authentication → Users → Add user), then runs this to say what
 * that person is allowed to do.
 *
 * Without a membership row, an authenticated user is a stranger with an
 * account — `getStaff()` returns null and the staff area stays shut.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { closeDb, db } from "../src/db/connection";
import { memberships, organizations } from "../src/db/schema";
import { ROLES, type Role, permissionsFor } from "../src/domain/permissions";

const ORG_SLUG = "frybird";

async function main() {
  const [email, roleArg] = process.argv.slice(2);

  if (!email || !roleArg) {
    console.error("usage: pnpm staff:grant <email> <role>");
    console.error(`roles: ${ROLES.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const role = roleArg.toUpperCase() as Role;
  if (!ROLES.includes(role)) {
    console.error(`"${roleArg}" is not a role. One of: ${ROLES.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
    process.exitCode = 1;
    return;
  }

  // The admin API is the only way to look a user up by email. This is why the
  // script needs the service role key and why it is a CLI tool, not a route.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;

  const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.error(`No Supabase user with the email ${email}.`);
    console.error("Create them first: Supabase dashboard → Authentication → Users → Add user.");
    process.exitCode = 1;
    return;
  }

  const database = db();
  const [org] = await database.select().from(organizations).where(eq(organizations.slug, ORG_SLUG)).limit(1);
  if (!org) {
    console.error("No FRYBIRD organization. Run pnpm db:seed first.");
    process.exitCode = 1;
    return;
  }

  const [existing] = await database
    .select()
    .from(memberships)
    .where(and(eq(memberships.orgId, org.id), eq(memberships.userId, user.id), eq(memberships.role, role)))
    .limit(1);

  if (existing) {
    if (!existing.isActive) {
      await database.update(memberships).set({ isActive: true }).where(eq(memberships.id, existing.id));
      console.log(`Reactivated ${email} as ${role}.`);
    } else {
      console.log(`${email} is already ${role}.`);
    }
  } else {
    await database.insert(memberships).values({
      orgId: org.id,
      userId: user.id,
      role,
      displayName: email.split("@")[0],
    });
    console.log(`Granted ${email} the ${role} role.`);
  }

  console.log(`\nThat allows: ${permissionsFor(role).join(", ")}`);
}

main()
  .then(async () => {
    await closeDb();
    process.exit(process.exitCode ?? 0);
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await closeDb();
    process.exit(1);
  });
