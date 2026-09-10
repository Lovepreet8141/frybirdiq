/**
 * Prints the most recent order straight from Postgres.
 *
 * A check on what actually landed, rather than on what the confirmation page
 * says it landed. Read-only.
 *
 *     pnpm exec tsx scripts/verify-order.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { desc, eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/connection";
import { orderEvents, orderItemModifiers, orderItems, orders } from "../src/db/schema";
import { formatINR, paise } from "../src/lib/money";

// Money columns come back as plain bigint. `paise()` is the acknowledgement
// that they are already in paise — the branded type refuses to assume it.
const inr = (value: bigint) => formatINR(paise(value));

async function main() {
  const d = db();
  const [o] = await d.select().from(orders).orderBy(desc(orders.createdAt)).limit(1);
  if (!o) {
    console.log("no orders yet");
    return;
  }

  console.log(`order  #${o.orderNumber}   ${o.status}`);
  console.log(`  channel / fulfilment : ${o.channel} / ${o.fulfilment}`);
  console.log(`  customer             : ${o.customerName}  ${o.customerPhone}`);
  console.log(`  listed               : ${inr(o.subtotal)}`);
  console.log(`  taxable (revenue)    : ${inr(o.taxableTotal)}`);
  console.log(`  CGST + SGST          : ${inr(o.cgstTotal)} + ${inr(o.sgstTotal)} = ${inr(o.taxTotal)}`);
  console.log(`  grand total          : ${inr(o.grandTotal)}`);
  console.log(`  taxable + tax = gross: ${o.taxableTotal + o.taxTotal === o.grandTotal}`);
  console.log(`  listed = gross       : ${o.subtotal === o.grandTotal}   (true means prices are GST-inclusive)`);

  const items = await d.select().from(orderItems).where(eq(orderItems.orderId, o.id));
  for (const item of items) {
    const mods = await d.select().from(orderItemModifiers).where(eq(orderItemModifiers.orderItemId, item.id));
    console.log(`  item : ${item.quantity}x ${item.productName} @ ${inr(item.unitPrice)} = ${inr(item.lineTotal)}`);
    console.log(`         hsn=${item.hsnCode} rate=${item.taxRateBps}bps  modifiers=[${mods.map((m) => m.modifierName).join(", ")}]`);
  }

  const events = await d.select().from(orderEvents).where(eq(orderEvents.orderId, o.id));
  console.log(`  events: ${events.map((e) => `${e.fromStatus}->${e.toStatus}`).join(", ")}`);
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });
