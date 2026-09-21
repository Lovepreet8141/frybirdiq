/**
 * The hook in advanceOrder (roadmap 7.2): when WHATSAPP_UPDATES=on, moving an order to a status customers
 * are told about queues ONE outbox row; when it is off (the default, and production today) nothing is queued and
 * no phone number is copied; a failure to queue never fails the order move.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
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

  afterEach(() => vi.unstubAllEnvs());

  async function orderAt(status: "PREPARING" | "ACCEPTED") {
    const [o] = await db()
      .insert(orders)
      .values({
        orgId: org.orgId,
        locationId: org.locationId,
        orderNumber: `T-${randomUUID().slice(0, 6)}`,
        businessDate: new Date().toISOString().slice(0, 10),
        status,
        channel: "ONLINE",
        fulfilment: "TAKEAWAY",
        grandTotal: fromRupees("200"),
        customerPhone: "9000000001",
      })
      .returning({ id: orders.id });
    if (!o) throw new Error("fixture");
    return o.id;
  }
  const rowsFor = (orderId: string) => db().select().from(notificationOutbox).where(eq(notificationOutbox.orderId, orderId));

  it("PREPARING -> READY leaves exactly one outbox row when switched on, and a second identical call adds none", async () => {
    vi.stubEnv("WHATSAPP_UPDATES", "on");
    vi.stubEnv("SITE_URL", "https://example.test");
    const id = await orderAt("PREPARING");
    expect((await advanceOrder({ orderId: id, to: "READY", actorUserId: randomUUID(), orgId: org.orgId })).ok).toBe(true);
    expect(await rowsFor(id)).toHaveLength(1);
    expect((await advanceOrder({ orderId: id, to: "READY", actorUserId: randomUUID(), orgId: org.orgId })).ok).toBe(false); // already READY: refused, nothing more queued
    expect(await rowsFor(id)).toHaveLength(1);
  });

  it("switched off (the default): the order moves and nothing is queued, no phone number is copied", async () => {
    vi.stubEnv("SITE_URL", "https://example.test");
    const id = await orderAt("PREPARING");
    expect((await advanceOrder({ orderId: id, to: "READY", actorUserId: randomUUID(), orgId: org.orgId })).ok).toBe(true);
    expect(await rowsFor(id)).toEqual([]);
  });

  it("a queueing failure never fails the order move", async () => {
    vi.stubEnv("WHATSAPP_UPDATES", "on");
    vi.stubEnv("SITE_URL", "https://example.test");
    const id = await orderAt("PREPARING");
    await db().execute(sql`alter table notification_outbox rename to notification_outbox_x`);
    try {
      expect((await advanceOrder({ orderId: id, to: "READY", actorUserId: randomUUID(), orgId: org.orgId })).ok).toBe(true);
    } finally {
      await db().execute(sql`alter table notification_outbox_x rename to notification_outbox`);
    }
    expect((await db().select({ status: orders.status }).from(orders).where(eq(orders.id, id)))[0]!.status).toBe("READY");
  });
});
