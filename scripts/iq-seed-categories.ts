import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

/**
 * Seeds the expense categories and accounts a QSR actually has.
 *
 *     pnpm iq:categories
 *
 * Idempotent — re-running adds anything missing and touches nothing else.
 *
 * The DIRECT/FIXED split is the whole point. It decides what break-even means
 * and what "food cost percentage" is measured against, so it is set here from
 * how each cost behaves rather than left for someone to guess per row.
 */

import { and, eq } from "drizzle-orm";

import { closeDb, db, schema } from "@/db/connection";

const CATEGORIES: ReadonlyArray<{
  name: string;
  behaviour: "DIRECT" | "FIXED";
  isNonOperating?: boolean;
}> = [
  // Move with every plate sold.
  { name: "Food supplies", behaviour: "DIRECT" },
  { name: "Packaging", behaviour: "DIRECT" },
  { name: "Delivery rider costs", behaviour: "DIRECT" },

  // Arrive whether the shutter opens or not.
  { name: "Rent", behaviour: "FIXED" },
  { name: "Salaries and wages", behaviour: "FIXED" },
  { name: "Electricity", behaviour: "FIXED" },
  { name: "Gas (LPG)", behaviour: "FIXED" },
  { name: "Water", behaviour: "FIXED" },
  { name: "Internet and phone", behaviour: "FIXED" },
  { name: "Marketing", behaviour: "FIXED" },
  { name: "Repairs and maintenance", behaviour: "FIXED" },
  { name: "Cleaning and consumables", behaviour: "FIXED" },
  { name: "Software and subscriptions", behaviour: "FIXED" },
  { name: "Licences and compliance", behaviour: "FIXED" },
  { name: "Bank and payment charges", behaviour: "FIXED" },
  { name: "Other expenses", behaviour: "FIXED" },

  // Real money leaving, but not a cost of running the month. Counting the
  // owner's drawings as an expense makes a profitable month look like a loss.
  { name: "Owner's drawings", behaviour: "FIXED", isNonOperating: true },
  { name: "Loan repayment (principal)", behaviour: "FIXED", isNonOperating: true },
];

const ACCOUNTS: ReadonlyArray<{ name: string; kind: "CASH" | "BANK" | "UPI" | "CARD" }> = [
  { name: "Cash drawer", kind: "CASH" },
  { name: "Bank account", kind: "BANK" },
  { name: "UPI", kind: "UPI" },
];

async function main() {
  const orgs = await db().select().from(schema.organizations).limit(1);
  const org = orgs[0];
  if (!org) {
    console.error("No organization found. Run pnpm db:seed first.");
    process.exit(1);
  }
  console.log(`Organization: ${org.name}\n`);

  let addedCategories = 0;
  for (const [index, category] of CATEGORIES.entries()) {
    const existing = await db()
      .select({ id: schema.expenseCategories.id })
      .from(schema.expenseCategories)
      .where(
        and(
          eq(schema.expenseCategories.orgId, org.id),
          eq(schema.expenseCategories.name, category.name),
        ),
      )
      .limit(1);
    if (existing.length > 0) continue;

    await db().insert(schema.expenseCategories).values({
      orgId: org.id,
      name: category.name,
      behaviour: category.behaviour,
      isNonOperating: category.isNonOperating ?? false,
      sortOrder: index,
    });
    addedCategories += 1;
    const tag = category.isNonOperating ? "non-operating" : category.behaviour.toLowerCase();
    console.log(`  + ${category.name.padEnd(28)} ${tag}`);
  }

  let addedAccounts = 0;
  for (const account of ACCOUNTS) {
    const existing = await db()
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.orgId, org.id), eq(schema.accounts.name, account.name)))
      .limit(1);
    if (existing.length > 0) continue;

    await db().insert(schema.accounts).values({
      orgId: org.id,
      name: account.name,
      kind: account.kind,
    });
    addedAccounts += 1;
    console.log(`  + ${account.name.padEnd(28)} account`);
  }

  console.log(
    `\n${addedCategories} categories and ${addedAccounts} accounts added.` +
      (addedCategories === 0 && addedAccounts === 0 ? " Nothing was missing." : ""),
  );
  await closeDb();
}

void main();
