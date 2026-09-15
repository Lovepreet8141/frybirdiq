/**
 * Exports the marketing list.
 *
 *     pnpm customers:export                 # summary only
 *     pnpm customers:export --out list.csv  # write the CSV
 *
 * Only exports customers who ticked the consent box and have not asked to be
 * deleted. That filter is the whole point of the script: the customers table
 * holds everyone who has ever ordered, and most of them did not agree to be
 * advertised to. Exporting the table wholesale is how a shop ends up sending
 * to people who never opted in.
 *
 * Two things worth knowing before sending anything:
 *
 * Commercial SMS in India goes through DLT — the sender header and message
 * template have to be registered, and unregistered commercial SMS is blocked
 * by the operators rather than merely frowned upon.
 *
 * Every message needs a working way to opt out, and an opt-out has to actually
 * stop the messages.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { writeFileSync } from "node:fs";
import { and, desc, eq, isNull } from "drizzle-orm";
import { closeDb, db } from "../src/db/connection";
import { customers, organizations } from "../src/db/schema";
import { csvCell } from "../src/lib/exports/csv";

async function main() {
  const database = db();
  const [org] = await database.select().from(organizations).where(eq(organizations.slug, "frybird")).limit(1);
  if (!org) throw new Error("No FRYBIRD organization. Run pnpm db:seed first.");

  const everyone = await database.select().from(customers).where(eq(customers.orgId, org.id));

  const optedIn = await database
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.orgId, org.id),
        eq(customers.marketingConsent, true),
        // Anyone who asked to be forgotten is out, consent or not.
        isNull(customers.deletionRequestedAt),
      ),
    )
    .orderBy(desc(customers.createdAt));

  console.log(`customers      : ${everyone.length}`);
  console.log(`opted in       : ${optedIn.length}`);
  console.log(`not opted in   : ${everyone.length - optedIn.length}  (do not message these)`);
  console.log(`with an email  : ${optedIn.filter((c) => c.email).length}`);

  const outIndex = process.argv.indexOf("--out");
  const outPath = outIndex === -1 ? undefined : process.argv[outIndex + 1];

  if (!outPath) {
    console.log("\nPass --out <file.csv> to write the list.");
    return;
  }

  const rows = [
    "name,phone,email,consented_at",
    ...optedIn.map((customer) =>
      [
        csvCell(customer.name),
        csvCell(customer.phone),
        csvCell(customer.email),
        csvCell(customer.marketingConsentAt?.toISOString().slice(0, 10) ?? null),
      ].join(","),
    ),
  ];

  writeFileSync(outPath, rows.join("\n") + "\n", "utf8");
  console.log(`\nWrote ${optedIn.length} contacts to ${outPath}`);
  console.log("This file is personal data. Do not commit it, and delete it when you are done.");
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await closeDb();
    process.exit(1);
  });
