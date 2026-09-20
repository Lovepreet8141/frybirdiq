/**
 * HANDOFF to the integrator (roadmap 7.2): advanceOrder lives in orders.ts, which the
 * integrations lane may not edit, so nothing yet enqueues a message when an order moves.
 * This marks the gap with it.fails: it passes today because advanceOrder does not enqueue.
 * When the hook lands, it starts failing, which is the cue to change `it.fails` to `it`.
 *
 * The change: after advanceOrder commits a transition (not inside its locked transaction,
 * and never letting a failure roll the order back), call
 *   await enqueueOrderUpdate({ orgId, orderId, toStatus: to, siteUrl: <SITE_URL> }).catch(() => undefined);
 * then a worker/cron calls dispatchPending({ orgId, provider }) with the provider from a registry.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationOutbox, orders } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { advanceOrder } from "./orders";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

describe("advanceOrder enqueues a WhatsApp update", () => {
  let org: TestOrg;
  beforeAll(async () => {
    org = await createTestOrg();
  });
  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  it.fails("PREPARING -> READY leaves one outbox row (NOT WIRED YET: needs the hook in orders.ts)", async () => {
    const [o] = await db()
      .insert(orders)
      .values({
        orgId: org.orgId,
        locationId: org.locationId,
        orderNumber: `T-${randomUUID().slice(0, 6)}`,
        businessDate: new Date().toISOString().slice(0, 10),
        status: "PREPARING",
        channel: "ONLINE",
        fulfilment: "TAKEAWAY",
        grandTotal: fromRupees("200"),
        customerPhone: "9000000001",
      })
      .returning({ id: orders.id });
    if (!o) throw new Error("fixture");
    const r = await advanceOrder({ orderId: o.id, to: "READY", actorUserId: randomUUID(), orgId: org.orgId });
    expect(r.ok).toBe(true);
    const rows = await db().select().from(notificationOutbox).where(eq(notificationOutbox.orderId, o.id));
    expect(rows).toHaveLength(1);
  });
});
