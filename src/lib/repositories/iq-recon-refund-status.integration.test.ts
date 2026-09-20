/**
 * The refund rule counts only refunds that SUCCEEDED (migration 0038 gave refunds
 * a status; production has it). A FAILED refund never left the till, so it must
 * not tell the owner "refund on a captured payment" or "over-refunded".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { refunds } from "@/db/schema";
import type { ReconOutcome } from "@/lib/iq/reconcile/rules";
import { paise } from "@/lib/money";
import { createTestProduct, createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { istInstant, seedRefund, seedSale } from "./__test-support__/iq-fixtures";
import { readRecon } from "./iq-recon";

const NOW = new Date("2026-09-17T12:00:00+05:30");
const D = "2026-08-31";
let org: TestOrg;
let productId = "";

beforeAll(async () => {
  org = await createTestOrg();
  productId = (await createTestProduct(org.orgId, { name: "Refund status burger" })).id;
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
});

const refundFindings = (outcomes: readonly ReconOutcome[]) =>
  outcomes.filter((o): o is Extract<ReconOutcome, { status: "FIRED" }> => o.status === "FIRED" && o.ruleId === "recon.refund_vs_payment" && o.unexplained > 0);

async function addRefund(sale: Awaited<ReturnType<typeof seedSale>>, status: "SUCCEEDED" | "FAILED", amount: bigint, at: string, day = "2026-08-05") {
  await db().insert(refunds).values({
    orgId: org.orgId,
    paymentId: sale.payments[0]!.id,
    orderId: sale.order.id,
    amount: paise(amount),
    reason: "test",
    provider: "cash",
    status,
    // The table's own rule: only a SUCCEEDED refund has a finalised time.
    finalizedAt: status === "SUCCEEDED" ? istInstant(day, at) : null,
    createdAt: istInstant(day, at),
    updatedAt: istInstant(day, at),
  });
}

describe("refund status in reconciliation", () => {
  it("a FAILED refund on a captured payment is not a finding: the money never left", async () => {
    const sale = await seedSale(org, { at: istInstant("2026-08-05"), lines: [{ productId, unitPricePaise: 19_900n }] });
    await addRefund(sale, "FAILED", sale.order.grandTotal, "10:00");
    const { outcomes } = await readRecon(org.orgId, D, NOW);
    expect(refundFindings(outcomes.map((o) => o.outcome))).toEqual([]);
  });

  it("a FAILED refund followed by a full successful retry is not 'over-refunded'", async () => {
    const sale = await seedSale(org, { at: istInstant("2026-08-06"), status: "REFUNDED", lines: [{ productId, unitPricePaise: 19_900n }] });
    // The successful retry goes through the fixture that also marks the payment REFUNDED, as the real refund path does;
    // the earlier failed attempt is added after it (the fixture counts every refund row against the payment).
    await seedRefund(sale.payments[0]!, { at: istInstant("2026-08-06", "11:00"), amountPaise: sale.order.grandTotal });
    await addRefund(sale, "FAILED", sale.order.grandTotal, "10:00");
    const { outcomes } = await readRecon(org.orgId, D, NOW);
    expect(refundFindings(outcomes.map((o) => o.outcome))).toEqual([]);
  });

  it("a SUCCEEDED refund larger than the payment is still caught", async () => {
    const sale = await seedSale(org, { at: istInstant("2026-08-07"), lines: [{ productId, unitPricePaise: 19_900n }] });
    await addRefund(sale, "SUCCEEDED", sale.order.grandTotal + 500n, "10:00", "2026-08-07");
    const { outcomes } = await readRecon(org.orgId, D, NOW);
    const found = refundFindings(outcomes.map((o) => o.outcome));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ date: "2026-08-07", amount: 500n });
  });
});
