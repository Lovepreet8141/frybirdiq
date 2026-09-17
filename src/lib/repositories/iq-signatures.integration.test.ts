/**
 * IQ-2 S5 money crash signatures against a real local database (DESIGN.md
 * §7 Done-when 2): each rule's broken row state is written directly, with no
 * order flow and no provider call, and yields a count of exactly one for that
 * rule and zero for every other rule; the clean fixture yields zero
 * everywhere. Each test gets its own org, so counts are exact.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { idempotencyKeys, orderEvents, orders, payments, webhookEvents } from "@/db/schema";
import { magnitudeOf } from "@/lib/iq/engine";
import { PRE_REFUND_SIGNATURES, type SignatureRuleId } from "@/lib/iq/signatures/pre-refund";
import { readMoneySignatures, readOnlyRuleTransaction, readSignature } from "./iq-signatures";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { istInstant, seedPayment, seedRefund, seedSale } from "./__test-support__/iq-fixtures";

const ALL = PRE_REFUND_SIGNATURES.map((r) => r.ruleId);
const OLD = istInstant("2026-09-10", "13:00");
const LINE = [{ productId: null, name: "Signature burger", unitPricePaise: 29_900n }];

const orgs: TestOrg[] = [];
const webhookIds: string[] = [];

afterEach(async () => {
  if (webhookIds.length > 0) await db().delete(webhookEvents).where(inArray(webhookEvents.id, webhookIds.splice(0)));
  for (const org of orgs.splice(0)) await deleteTestOrg(org.orgId);
});

async function newOrg(): Promise<TestOrg> {
  const org = await createTestOrg();
  orgs.push(org);
  return org;
}

async function counts(org: TestOrg): Promise<Record<SignatureRuleId, number>> {
  const readings = await readMoneySignatures(org.orgId, ALL);
  return Object.fromEntries(
    readings.map((r) => {
      if (r.status !== "EVALUATED") throw new Error(`${r.ruleId} did not evaluate`);
      return [r.ruleId, Number(magnitudeOf(r.count))];
    }),
  ) as Record<SignatureRuleId, number>;
}

/** Exactly one hit on `rule`, zero on every other rule. */
async function expectOnly(org: TestOrg, rule: SignatureRuleId) {
  const expected = Object.fromEntries(ALL.map((id) => [id, id === rule ? 1 : 0]));
  expect(await counts(org)).toEqual(expected);
}

/** Healthy history: a sale, a partial refund, a full refund with its order refunded, a cancelled order refunded with its money event. */
async function seedClean(org: TestOrg) {
  await seedSale(org, { at: OLD, lines: LINE });

  const partial = await seedSale(org, { at: OLD, lines: LINE });
  await seedRefund(partial.payments[0]!, { at: istInstant("2026-09-10", "14:00"), amountPaise: 5_000n });

  const full = await seedSale(org, { at: OLD, lines: LINE, status: "REFUNDED" });
  await seedRefund(full.payments[0]!, { at: istInstant("2026-09-10", "14:00"), amountPaise: BigInt(full.payments[0]!.amount) });

  const cancelled = await seedSale(org, { at: OLD, lines: LINE, status: "CANCELLED" });
  await seedRefund(cancelled.payments[0]!, { at: istInstant("2026-09-10", "14:00"), amountPaise: BigInt(cancelled.payments[0]!.amount) });
  await db().insert(orderEvents).values({ orgId: org.orgId, orderId: cancelled.order.id, fromStatus: "CANCELLED", toStatus: "CANCELLED", reason: "Refunded ₹299 — never collected", createdAt: istInstant("2026-09-10", "14:00") });
}

describe("money crash signatures (IQ-2 S5)", () => {
  it("the clean fixture trips no rule", async () => {
    const org = await newOrg();
    await seedClean(org);
    expect(Object.values(await counts(org)).every((n) => n === 0)).toBe(true);
  });

  it("sig.double_capture: two captures on one order", async () => {
    const org = await newOrg();
    await seedClean(org);
    await seedSale(org, { at: OLD, lines: LINE, payments: [{}, {}] });
    await expectOnly(org, "sig.double_capture");
  });

  it("sig.double_capture ignores rows changed in the last 5 minutes (R2.7 age guard)", async () => {
    const org = await newOrg();
    await seedSale(org, { at: new Date(), lines: LINE, payments: [{}, {}] });
    expect((await counts(org))["sig.double_capture"]).toBe(0);
  });

  it("sig.refund_unrecorded: a REFUNDED payment with no refund row", async () => {
    const org = await newOrg();
    await seedClean(org);
    const sale = await seedSale(org, { at: OLD, lines: LINE, payments: [{ status: "REFUNDED" }] });
    expect(sale.refunds).toHaveLength(0);
    await expectOnly(org, "sig.refund_unrecorded");
  });

  it("sig.refund_unrecorded: refund rows on a payment still CAPTURED", async () => {
    const org = await newOrg();
    const sale = await seedSale(org, { at: OLD, lines: LINE });
    await seedRefund(sale.payments[0]!, { at: OLD, amountPaise: 5_000n });
    await db().update(payments).set({ status: "CAPTURED" }).where(eq(payments.id, sale.payments[0]!.id));
    await expectOnly(org, "sig.refund_unrecorded");
  });

  it("sig.refund_followup_lost: fully refunded, order still COMPLETED", async () => {
    const org = await newOrg();
    await seedClean(org);
    const sale = await seedSale(org, { at: OLD, lines: LINE }); // COMPLETED by default
    await seedRefund(sale.payments[0]!, { at: istInstant("2026-09-10", "14:00"), amountPaise: BigInt(sale.payments[0]!.amount) });
    await expectOnly(org, "sig.refund_followup_lost");
  });

  it("sig.refund_followup_lost: a fully refunded CANCELLED order with no refund money event (and not once the event exists, pre- or post-redesign)", async () => {
    const org = await newOrg();
    const sale = await seedSale(org, { at: OLD, lines: LINE, status: "CANCELLED" });
    await seedRefund(sale.payments[0]!, { at: istInstant("2026-09-10", "14:00"), amountPaise: BigInt(sale.payments[0]!.amount) });
    await expectOnly(org, "sig.refund_followup_lost");

    await db().insert(orderEvents).values({ orgId: org.orgId, orderId: sale.order.id, fromStatus: "CANCELLED", toStatus: "CANCELLED", reason: "Refund ₹299 — cold", metadata: { refundId: randomUUID() } });
    expect((await counts(org))["sig.refund_followup_lost"]).toBe(0);
  });

  it("sig.refund_followup_lost: one of two captures refunded in full is not a full refund of the order", async () => {
    const org = await newOrg();
    const sale = await seedSale(org, { at: OLD, lines: LINE, payments: [{}, {}] });
    await seedRefund(sale.payments[1]!, { at: istInstant("2026-09-10", "14:00"), amountPaise: BigInt(sale.payments[1]!.amount) });
    const c = await counts(org);
    expect(c["sig.refund_followup_lost"]).toBe(0);
    expect(c["sig.double_capture"]).toBe(1);
  });

  it("sig.half_order: an unpaid order with no payment row", async () => {
    const org = await newOrg();
    await seedClean(org);
    await seedSale(org, { at: OLD, lines: LINE, status: "PENDING_PAYMENT", payments: [] });
    await expectOnly(org, "sig.half_order");
  });

  it("sig.half_order: an unpaid order with a pending payment but no items", async () => {
    const org = await newOrg();
    const sale = await seedSale(org, { at: OLD, lines: LINE, status: "PENDING_PAYMENT", payments: [{ status: "PENDING" }] });
    await db().execute(sql`DELETE FROM order_items WHERE order_id = ${sale.order.id}`);
    await expectOnly(org, "sig.half_order");
  });

  it("sig.capture_on_terminal: money captured after the order was cancelled", async () => {
    const org = await newOrg();
    await seedClean(org);
    const sale = await seedSale(org, { at: OLD, lines: LINE, status: "CANCELLED", payments: [] });
    await db().insert(orderEvents).values({ orgId: org.orgId, orderId: sale.order.id, fromStatus: "PENDING_PAYMENT", toStatus: "CANCELLED", reason: "never collected", createdAt: OLD });
    await seedPayment(sale.order, { at: istInstant("2026-09-10", "15:00"), status: "CAPTURED" });
    await expectOnly(org, "sig.capture_on_terminal");
  });

  it("sig.claim_stuck: an abandoned claim on a money operation, and never one on another operation", async () => {
    const org = await newOrg();
    await seedClean(org);
    const old = new Date(Date.now() - 60 * 60_000);
    await db().insert(idempotencyKeys).values([
      { orgId: org.orgId, key: randomUUID(), operation: "recordPayment", requestFingerprint: "x", expiresAt: new Date(Date.now() + 86_400_000), createdAt: old },
      { orgId: org.orgId, key: randomUUID(), operation: "receive_stock", requestFingerprint: "x", expiresAt: new Date(Date.now() + 86_400_000), createdAt: old },
      { orgId: org.orgId, key: randomUUID(), operation: "refund_payment", requestFingerprint: "x", responseSnapshot: { ok: true }, expiresAt: new Date(Date.now() + 86_400_000), createdAt: old },
      { orgId: org.orgId, key: randomUUID(), operation: "placeOrder", requestFingerprint: "x", expiresAt: new Date(Date.now() + 86_400_000) },
    ]);
    await expectOnly(org, "sig.claim_stuck");
  });

  it("sig.webhook_failed: a failed webhook for this org's Razorpay payment, not for a payment elsewhere", async () => {
    const org = await newOrg();
    const other = await newOrg();
    await seedClean(org);
    const sale = await seedSale(org, { at: OLD, lines: LINE, payments: [{ provider: "razorpay" }] });
    const providerOrderId = `order_sig_${randomUUID().slice(0, 12)}`;
    await db().update(payments).set({ providerOrderId }).where(eq(payments.id, sale.payments[0]!.id));
    const rows = await db()
      .insert(webhookEvents)
      .values([
        { provider: "razorpay", eventId: `evt_${randomUUID()}`, eventType: "payment.captured", payload: { payload: { payment: { entity: { id: "pay_x", order_id: providerOrderId } } } }, signatureVerified: "true", error: "Razorpay could not be reached", createdAt: new Date(Date.now() - 2 * 60 * 60_000) },
        { provider: "razorpay", eventId: `evt_${randomUUID()}`, eventType: "payment.captured", payload: { payload: { payment: { entity: { id: "pay_y", order_id: "order_not_ours" } } } }, signatureVerified: "true", error: "no order", createdAt: new Date(Date.now() - 2 * 60 * 60_000) },
      ])
      .returning({ id: webhookEvents.id });
    webhookIds.push(...rows.map((r) => r.id));
    await expectOnly(org, "sig.webhook_failed");
    expect((await counts(other))["sig.webhook_failed"]).toBe(0);
  });

  it("every rule stays inside its org: another org's broken rows count zero", async () => {
    const broken = await newOrg();
    const other = await newOrg();
    await seedSale(broken, { at: OLD, lines: LINE, payments: [{}, {}] });
    await seedSale(broken, { at: OLD, lines: LINE, status: "PENDING_PAYMENT", payments: [] });
    expect(Object.values(await counts(other)).every((n) => n === 0)).toBe(true);
  });

  it("R2.5: rule transactions are read-only (a write fails with 25006) and time out", async () => {
    const org = await newOrg();
    const write = readOnlyRuleTransaction((tx) => tx.update(orders).set({ notes: "x" }).where(eq(orders.orgId, org.orgId)));
    await expect(write).rejects.toMatchObject({ cause: { code: "25006" } });

    const slow = readOnlyRuleTransaction((tx) => tx.execute(sql`SELECT pg_sleep(1)`), 50);
    await expect(slow).rejects.toMatchObject({ cause: { code: "57014" } });

    const [setting] = await readOnlyRuleTransaction((tx) => tx.execute<{ t: string; ro: string; iso: string }>(sql`SELECT current_setting('statement_timeout') AS t, current_setting('transaction_read_only') AS ro, current_setting('transaction_isolation') AS iso`));
    expect(setting).toEqual({ t: "10s", ro: "on", iso: "repeatable read" });
  });

  it("readSignature reports a statement timeout as RULE_TIMEOUT instead of throwing", async () => {
    const org = await newOrg();
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    // Another session holds refunds exclusively, so the rule's read waits past its budget.
    const holder = db().transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE refunds IN ACCESS EXCLUSIVE MODE`);
      locked();
      await released;
    });
    await isLocked;
    try {
      expect(await readSignature(org.orgId, "sig.refund_unrecorded", 200)).toEqual({ ruleId: "sig.refund_unrecorded", status: "RULE_TIMEOUT" });
    } finally {
      release();
      await holder;
    }
    expect((await readSignature(org.orgId, "sig.refund_unrecorded")).status).toBe("EVALUATED");
  });
});
