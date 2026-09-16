/**
 * Settles the most recent unpaid order as cash taken at the counter.
 *
 * A harness for the COD path until there is staff auth to drive it from a
 * screen. It calls the same service the till will call, with a stand-in actor
 * — it does not reimplement any of it.
 *
 *     pnpm exec tsx scripts/settle-cash.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { desc, eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/connection";
import { orderEvents, orders, payments } from "../src/db/schema";
import { formatINR, paise } from "../src/lib/money";
import { recordCashPayment } from "../src/lib/repositories/payments";

const inr = (value: bigint) => formatINR(paise(value));
const ACTOR = "00000000-0000-4000-8000-000000000001";

async function main() {
  const d = db();
  const [order] = await d
    .select()
    .from(orders)
    .where(eq(orders.status, "PENDING_PAYMENT"))
    .orderBy(desc(orders.createdAt))
    .limit(1);

  if (!order) {
    console.log("no unpaid orders");
    return;
  }

  console.log(`settling #${order.orderNumber} — ${inr(order.grandTotal)}\n`);

  // Permission first: a KITCHEN role holds no orders.update.
  const denied = await recordCashPayment({ orderId: order.id, actorUserId: ACTOR, actorRoles: ["KITCHEN"], orgId: order.orgId });
  console.log(`as KITCHEN  : ${denied.ok ? "ALLOWED (wrong)" : `refused — ${denied.error}`}`);

  const first = await recordCashPayment({ orderId: order.id, actorUserId: ACTOR, actorRoles: ["CASHIER"], orgId: order.orgId });
  console.log(`as CASHIER  : ${first.ok ? `taken (replayed=${first.replayed})` : `failed — ${first.error}`}`);

  // The double-press. Must not book the money twice.
  const second = await recordCashPayment({ orderId: order.id, actorUserId: ACTOR, actorRoles: ["CASHIER"], orgId: order.orgId });
  console.log(`pressed again: ${second.ok ? `ok (replayed=${second.replayed})` : `refused — ${second.error}`}`);

  const [after] = await d.select().from(orders).where(eq(orders.id, order.id)).limit(1);
  const pays = await d.select().from(payments).where(eq(payments.orderId, order.id));
  const events = await d.select().from(orderEvents).where(eq(orderEvents.orderId, order.id));

  console.log(`\nstatus       : ${after?.status}`);
  console.log(`payment rows : ${pays.length}`);
  for (const pay of pays) console.log(`  ${pay.provider}/${pay.method} ${pay.status} ${inr(pay.amount)}`);
  console.log(`total booked : ${inr(pays.filter((p) => p.status === "CAPTURED").reduce((sum, p) => sum + p.amount, 0n))}`);
  console.log(`events       : ${events.map((e) => `${e.fromStatus}->${e.toStatus}`).join(", ")}`);
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
