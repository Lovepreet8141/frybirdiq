/**
 * Sets the business details that appear on a receipt or tax invoice.
 *
 *     pnpm business:show
 *     pnpm business:set --legal-name "Yuvraj Singh"
 *     pnpm business:set --gstin 06ABCDE1234F1Z5
 *     pnpm business:set --gstin none
 *
 * A GSTIN is what turns a receipt into a tax invoice. Without one the document
 * shows no CGST/SGST split, because a business that is not registered for GST
 * cannot collect it and a receipt showing a tax line asserts that it did.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/connection";
import { locations, organizations } from "../src/db/schema";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** 15 characters: 2 state digits, 10-character PAN, entity digit, Z, checksum. */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

async function main() {
  const database = db();
  const [org] = await database.select().from(organizations).where(eq(organizations.slug, "frybird")).limit(1);
  if (!org) throw new Error("No FRYBIRD organization. Run pnpm db:seed first.");

  if (process.argv.length > 2 && !process.argv.includes("--show")) {
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    const legalName = flag("legal-name");
    if (legalName !== undefined) updates.legalName = legalName || null;

    const gstin = flag("gstin");
    if (gstin !== undefined) {
      if (gstin === "none") {
        updates.gstin = null;
      } else {
        const value = gstin.toUpperCase();
        // Checked rather than accepted: a malformed GSTIN on a printed invoice
        // is worse than none, because it looks valid.
        if (!GSTIN.test(value)) {
          throw new Error(`"${gstin}" is not a valid GSTIN. Expected 15 characters, e.g. 06ABCDE1234F1Z5.`);
        }
        updates.gstin = value;
      }
    }

    const phone = flag("phone");
    if (phone !== undefined) {
      const [location] = await database.select().from(locations).where(eq(locations.orgId, org.id)).limit(1);
      if (location) await database.update(locations).set({ phone }).where(eq(locations.id, location.id));
    }

    await database.update(organizations).set(updates).where(eq(organizations.id, org.id));
    console.log("Updated.\n");
  }

  const [current] = await database.select().from(organizations).where(eq(organizations.id, org.id)).limit(1);
  const [location] = await database.select().from(locations).where(eq(locations.orgId, org.id)).limit(1);
  if (!current) return;

  console.log(`trading name : ${current.name}`);
  console.log(`legal name   : ${current.legalName ?? "not set"}`);
  console.log(`GSTIN        : ${current.gstin ?? "not registered"}`);
  console.log(`phone        : ${location?.phone ?? "not set"}`);
  console.log(`address      : ${[location?.addressLine1, location?.city, location?.state].filter(Boolean).join(", ")}`);
  console.log("");
  console.log(
    current.gstin
      ? "Documents are issued as TAX INVOICES with a CGST/SGST split."
      : "Documents are issued as RECEIPTS with no tax split — a business without a\nGSTIN cannot collect GST, so nothing prints a tax line.",
  );
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
