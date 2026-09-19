/**
 * IQ-2 S4 — reconciliation on real rows (local stack only).
 *
 * A clean month (a plain sale, a delivery with points, a stamp reward, a
 * partial refund, a full refund, a double capture from before pay-4's deploy)
 * gives zero unexplained findings; each planted mismatch appears exactly once,
 * with its ruleId, on its own day; the double capture is explained by pay-4
 * and still shown with its amount. Also: reads are READ ONLY (25006), rows
 * changed in the last 5 minutes wait for the next run, another org's rows
 * never appear, and the job body writes contract-valid insights.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { iqDailyFacts, orderItems, orders, payments, refunds } from "@/db/schema";
import { InsightSchema } from "@/lib/iq/engine";
import { invoiceNumber } from "@/lib/invoice";
import { runReconcileNightly } from "@/lib/iq/reconcile/reconcile-job";
import type { ReconOutcome } from "@/lib/iq/reconcile/rules";
import { paise } from "@/lib/money";

import { createTestCustomer, createTestProduct, type TestOrg } from "./__test-support__/fixtures";
import { createTwoTestOrgs, istInstant, type SeededSale, seedOrder, seedRefund, seedSale, type TwoOrgs } from "./__test-support__/iq-fixtures";
import { recomputeDay } from "./iq-facts";
import { readFactsParityDays, readRecon, runReconReadOnly } from "./iq-recon";

const D = "2026-08-31";
/** Well after every fixture row, so the 5-minute age guard lets them all in. */
const NOW = new Date("2026-09-17T12:00:00+05:30");

const CLEAN_DAYS = ["2026-08-05", "2026-08-06", "2026-08-07"];
const PLANT = {
  order_totals: "2026-08-12",
  capture_vs_total: "2026-08-13",
  status_vs_payment: "2026-08-14",
  refund_vs_payment: "2026-08-15",
  invoice: "2026-08-16",
  gst_lines: "2026-08-17",
  loyalty_refund: "2026-08-18",
  facts_parity: "2026-08-19",
} as const;

let invoiceSeq = new Map<string, number>();

/** Issues the next proper FY number, as settle() would, keeping updated_at old. */
async function invoice(org: TestOrg, sale: SeededSale) {
  const next = (invoiceSeq.get(org.orgId) ?? 0) + 1;
  invoiceSeq.set(org.orgId, next);
  await db()
    .update(orders)
    .set({ invoiceNumber: invoiceNumber(sale.order.createdAt, next), invoicedAt: sale.order.createdAt, updatedAt: sale.order.createdAt })
    .where(and(eq(orders.id, sale.order.id), eq(orders.orgId, org.orgId)));
}

async function sale(org: TestOrg, input: Parameters<typeof seedSale>[1]): Promise<SeededSale> {
  const seeded = await seedSale(org, input);
  await invoice(org, seeded);
  return seeded;
}

async function seedClean(org: TestOrg) {
  const product = await createTestProduct(org.orgId, { name: "Recon burger" });
  await sale(org, { at: istInstant(CLEAN_DAYS[0]!), lines: [{ productId: product.id, unitPricePaise: 9_900n, quantity: 3 }, { productId: null, name: "Dip", unitPricePaise: 2_000n }] });
  await sale(org, {
    at: istInstant(CLEAN_DAYS[0]!, "20:00"),
    channel: "ONLINE",
    fulfilment: "DELIVERY",
    deliveryFeePaise: 3_000n,
    pointsRedeemed: 10,
    pointsDiscountPaise: 1_000n,
    lines: [{ productId: product.id, unitPricePaise: 24_900n, quantity: 2 }],
  });
  await sale(org, { at: istInstant(CLEAN_DAYS[1]!), stampRewardLine: 0, lines: [{ productId: product.id, unitPricePaise: 9_900n }, { productId: product.id, unitPricePaise: 14_900n }] });
  const partial = await sale(org, { at: istInstant(CLEAN_DAYS[1]!, "19:00"), lines: [{ productId: product.id, unitPricePaise: 39_900n }] });
  await seedRefund(partial.payments[0]!, { at: istInstant(CLEAN_DAYS[2]!, "10:00"), amountPaise: 5_000n });
  const full = await sale(org, { at: istInstant(CLEAN_DAYS[2]!), status: "REFUNDED", lines: [{ productId: product.id, unitPricePaise: 29_900n }] });
  await seedRefund(full.payments[0]!, { at: istInstant(CLEAN_DAYS[2]!, "15:00"), amountPaise: full.order.grandTotal });
  // Captured twice in August: before pay-4 reached production, so explained.
  await sale(org, { at: istInstant(CLEAN_DAYS[2]!, "18:00"), lines: [{ productId: product.id, unitPricePaise: 17_900n }], payments: [{}, {}] });
  // Never paid: nothing to reconcile.
  await seedOrder(org, { at: istInstant(CLEAN_DAYS[2]!, "21:00"), status: "PENDING_PAYMENT", lines: [{ productId: product.id, unitPricePaise: 9_900n }] });
  for (const day of CLEAN_DAYS) await recomputeDay(org.orgId, day);
  return product.id;
}

async function plant(org: TestOrg, productId: string) {
  const line = (price: bigint) => [{ productId, unitPricePaise: price }];

  // 1. A stored grand total one paisa off its taxable + tax (payment matches it, so capture agrees).
  const totals = await sale(org, { at: istInstant(PLANT.order_totals), lines: line(19_900n) });
  await db().update(orders).set({ grandTotal: paise(totals.order.grandTotal + 1n), updatedAt: totals.order.createdAt }).where(eq(orders.id, totals.order.id));
  await db().update(payments).set({ amount: paise(totals.order.grandTotal + 1n) }).where(eq(payments.id, totals.payments[0]!.id));

  // 2. One capture ₹1 short of the bill.
  const short = await sale(org, { at: istInstant(PLANT.capture_vs_total), lines: line(19_900n) });
  await db().update(payments).set({ amount: paise(short.order.grandTotal - 100n) }).where(eq(payments.id, short.payments[0]!.id));

  // 3. COMPLETED with no payment at all.
  await seedOrder(org, { at: istInstant(PLANT.status_vs_payment), status: "COMPLETED", lines: line(19_900n) });

  // 4. A refund row larger than the payment, payment still CAPTURED.
  const over = await sale(org, { at: istInstant(PLANT.refund_vs_payment), lines: line(19_900n) });
  await db().insert(refunds).values({
    orgId: org.orgId,
    paymentId: over.payments[0]!.id,
    orderId: over.order.id,
    amount: paise(over.order.grandTotal + 500n),
    reason: "Planted over-refund",
    provider: "cash",
    createdAt: istInstant(PLANT.refund_vs_payment, "14:00"),
    updatedAt: istInstant(PLANT.refund_vs_payment, "14:00"),
  });

  // 5. Captured, never invoiced.
  await seedSale(org, { at: istInstant(PLANT.invoice), lines: line(19_900n) });

  // 6. One paisa moved from a line's tax to its taxable value: the line still adds up, the order's GST split does not.
  const gst = await sale(org, { at: istInstant(PLANT.gst_lines), lines: line(19_900n) });
  const item = gst.order.items[0]!;
  await db().update(orderItems).set({ lineTax: paise(item.lineTax - 1n), lineTaxable: paise(item.lineTaxable + 1n) }).where(eq(orderItems.id, item.id));

  // 7. Fully refunded order that still holds the points it earned a customer.
  const customer = await createTestCustomer(org.orgId);
  const kept = await sale(org, { at: istInstant(PLANT.loyalty_refund), status: "REFUNDED", lines: line(19_900n) });
  await seedRefund(kept.payments[0]!, { at: istInstant(PLANT.loyalty_refund, "15:00"), amountPaise: kept.order.grandTotal });
  await db().update(orders).set({ customerId: customer.id, pointsEarned: 15, updatedAt: kept.order.createdAt }).where(eq(orders.id, kept.order.id));

  // 8. A daily fact that no longer matches the live P&L.
  await sale(org, { at: istInstant(PLANT.facts_parity), lines: line(19_900n) });
  await recomputeDay(org.orgId, PLANT.facts_parity);
  await db()
    .update(iqDailyFacts)
    .set({ value: sql`${iqDailyFacts.value} + 1` })
    .where(and(eq(iqDailyFacts.orgId, org.orgId), eq(iqDailyFacts.businessDate, PLANT.facts_parity), eq(iqDailyFacts.metricId, "revenue_net"), eq(iqDailyFacts.dimensionKey, "")));
}

const fired = (outcomes: readonly ReconOutcome[]) => outcomes.filter((o): o is Extract<ReconOutcome, { status: "FIRED" }> => o.status === "FIRED");

describe("reconciliation on real rows (IQ-2 S4)", () => {
  let orgs: TwoOrgs;

  beforeAll(async () => {
    invoiceSeq = new Map();
    orgs = await createTwoTestOrgs();
    const product = await seedClean(orgs.a);
    await plant(orgs.a, product);
    // Org B: a clean month plus its own planted break, which must never reach A.
    const productB = await seedClean(orgs.b);
    await seedOrder(orgs.b, { at: istInstant("2026-08-20"), status: "COMPLETED", lines: [{ productId: productB, unitPricePaise: 9_900n }] });
  }, 180_000);

  afterAll(async () => {
    await orgs.cleanup();
  });

  it("finds each planted mismatch exactly once, with its ruleId, on its own day — and nothing else unexplained", async () => {
    const { outcomes } = await readRecon(orgs.a.orgId, D, NOW);
    const unexplained = fired(outcomes.map((o) => o.outcome)).filter((o) => o.unexplained > 0);
    expect(unexplained.map((o) => [o.ruleId, o.date, o.unexplained]).sort()).toEqual(
      Object.entries(PLANT)
        .map(([rule, day]) => [`recon.${rule}`, day, 1])
        .sort(),
    );
    expect(unexplained.find((o) => o.ruleId === "recon.capture_vs_total")?.amount).toBe(100n);
    expect(unexplained.find((o) => o.ruleId === "recon.refund_vs_payment")?.amount).toBe(500n);
  });

  it("the clean month has zero unexplained findings; the pre-pay-4 double capture is explained and still carries its amount", async () => {
    const { outcomes } = await readRecon(orgs.b.orgId, D, NOW);
    const all = fired(outcomes.map((o) => o.outcome));
    expect(all.filter((o) => o.unexplained > 0).map((o) => [o.ruleId, o.date])).toEqual([["recon.status_vs_payment", "2026-08-20"]]);
    const explained = all.filter((o) => o.explained > 0);
    expect(explained).toHaveLength(1);
    expect(explained[0]).toMatchObject({ ruleId: "recon.capture_vs_total", date: CLEAN_DAYS[2], explained: 1, unexplained: 0, explainedBy: "pay-4" });
    expect(explained[0]!.amount).toBeGreaterThan(0n);
  });

  it("parity is checked per day: computed days pass or fail exactly, days without facts are not checked", async () => {
    const days = await readFactsParityDays(orgs.a.orgId, [...CLEAN_DAYS, PLANT.facts_parity, "2026-08-25"]);
    expect(days).toEqual([
      ...CLEAN_DAYS.map((date) => ({ date, computed: true, mismatchedMetrics: [] })),
      { date: PLANT.facts_parity, computed: true, mismatchedMetrics: ["revenue_net"] },
      { date: "2026-08-25", computed: false, mismatchedMetrics: [] },
    ]);
  });

  it("reads inside READ ONLY: a planted write fails with 25006", async () => {
    await expect(
      runReconReadOnly(async (tx) => {
        await tx.execute(sql`UPDATE orders SET notes = 'nope' WHERE org_id = ${orgs.a.orgId}`);
        return [];
      }),
    ).rejects.toMatchObject({ cause: { code: "25006" } });
  });

  it("leaves rows changed in the last 5 minutes for the next run", async () => {
    const product = await createTestProduct(orgs.b.orgId, { name: "Fresh" });
    const fresh = await seedOrder(orgs.b, { at: istInstant("2026-08-22"), status: "COMPLETED", lines: [{ productId: product.id, unitPricePaise: 9_900n }] });
    const changedAt = new Date(NOW.getTime() - 60_000);
    await db().update(orders).set({ updatedAt: changedAt }).where(eq(orders.id, fresh.id));
    const soon = fired((await readRecon(orgs.b.orgId, D, NOW)).outcomes.map((o) => o.outcome));
    expect(soon.some((o) => o.ruleId === "recon.status_vs_payment" && o.date === "2026-08-22")).toBe(false);
    const later = fired((await readRecon(orgs.b.orgId, D, new Date(NOW.getTime() + 10 * 60_000))).outcomes.map((o) => o.outcome));
    expect(later.some((o) => o.ruleId === "recon.status_vs_payment" && o.date === "2026-08-22")).toBe(true);
  });

  it("the job body writes contract-valid recon.* DETECTIONs for what fired and expires clear keys only", async () => {
    const written: unknown[] = [];
    const expired: string[] = [];
    let n = 0;
    const result = await runReconcileNightly({
      orgId: orgs.a.orgId,
      runId: "22222222-2222-4222-8222-222222222222",
      attempt: 1,
      codeVersion: "48c428a",
      date: D,
      factsReady: async () => true,
      readRecon: (date, now) => readRecon(orgs.a.orgId, date, now),
      newId: () => `aaaaaaaa-0000-4000-8000-${String(++n).padStart(12, "0")}`,
      now: () => NOW,
      commit: async (write) =>
        write({
          writeInsight: async (insight) => {
            written.push(insight);
            return { outcome: "INSERTED" };
          },
          expireInsights: async (requests) => {
            expired.push(...requests.map((r) => r.dedupeKey));
            return { expired: 0 };
          },
        }),
    });

    const insights = written.map((row) => InsightSchema.parse(row));
    expect(insights.every((i) => i.producer.startsWith("recon.") && i.claimType === "DETECTION")).toBe(true);
    const keys = insights.map((i) => i.dedupeKey).sort();
    // 8 planted unexplained keys, 2 paise keys (capture, over-refund), and none from the clean days.
    expect(keys).toEqual(
      [
        ...Object.entries(PLANT).map(([rule, day]) => `recon:recon.${rule}:${day}`),
        `recon:recon.capture_vs_total.paise:${PLANT.capture_vs_total}`,
        `recon:recon.refund_vs_payment.paise:${PLANT.refund_vs_payment}`,
        `recon:recon.capture_vs_total.explained:${CLEAN_DAYS[2]}`,
        `recon:recon.capture_vs_total.paise:${CLEAN_DAYS[2]}`,
      ].sort(),
    );
    // Parity on a day without facts is not evaluated, so its key is never expired.
    expect(expired).not.toContain("recon:recon.facts_parity:2026-08-25");
    expect(expired).toContain("recon:recon.order_totals:2026-08-25");
    expect(result).toMatchObject({ status: "COMPLETE", summary: expect.objectContaining({ unexplained: 8, explained: 1, days: 36 }) });
  });
});
