/**
 * Refund slice 5 (refund design Revision 2): the payments ledger sums only
 * SUCCEEDED refunds, dated by finalized_at; lists RESERVED whenever it started
 * and FAILED by created_at, never summing either; flags a RESERVED refund past
 * 15 min (cash) or 60 min (online); and reports per payment what went back and
 * what is held.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { refunds } from "@/db/schema";
import { endOfBusinessDay, startOfBusinessDay } from "@/lib/dates";
import { paise } from "@/lib/money";
import { getPaymentsLedger } from "./finance";
import { type TestOrg } from "./__test-support__/fixtures";
import { createTwoTestOrgs, istInstant, type SeededSale, seedSale, type TwoOrgs } from "./__test-support__/iq-fixtures";

const SEPTEMBER = { from: startOfBusinessDay("2026-09-01"), to: endOfBusinessDay("2026-09-30"), label: "September 2026" };
const NOW = istInstant("2026-09-17", "12:00");

type Status = "RESERVED" | "SUCCEEDED" | "FAILED";

async function refund(sale: SeededSale, provider: "cash" | "razorpay", input: { amount: bigint; status: Status; createdAt: Date; finalizedAt?: Date; reason: string }) {
  const payment = sale.payments[0]!;
  const [row] = await db()
    .insert(refunds)
    .values({
      orgId: sale.order.orgId,
      paymentId: payment.id,
      orderId: sale.order.id,
      amount: paise(input.amount),
      reason: input.reason,
      provider,
      status: input.status,
      finalizedAt: input.status === "SUCCEEDED" ? (input.finalizedAt ?? input.createdAt) : null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
    .returning({ id: refunds.id });
  return row!.id;
}

interface Seeded {
  readonly cash: SeededSale;
  readonly online: SeededSale;
  readonly ids: Readonly<Record<"succeededInRange" | "succeededNextMonth" | "reservedCashFresh" | "failedInRange" | "failedLastMonth" | "reservedOnlineStale" | "reservedOnlineOld", string>>;
}

async function seed(org: TestOrg): Promise<Seeded> {
  const cash = await seedSale(org, { at: istInstant("2026-09-10"), lines: [{ productId: null, name: "Bucket", unitPricePaise: 30_000n }] });
  const online = await seedSale(org, {
    at: istInstant("2026-09-11"),
    channel: "ONLINE",
    fulfilment: "TAKEAWAY",
    lines: [{ productId: null, name: "Box", unitPricePaise: 20_000n }],
    payments: [{ method: "UPI", provider: "razorpay" }],
  });
  const ids = {
    // Asked for on 31 Aug, money back at 00:10 IST on 1 Sep: September's.
    succeededInRange: await refund(cash, "cash", { amount: 5_000n, status: "SUCCEEDED", createdAt: istInstant("2026-08-31", "23:00"), finalizedAt: istInstant("2026-09-01", "00:10"), reason: "late" }),
    // Asked for on 30 Sep, money back on 1 Oct: October's, not September's.
    succeededNextMonth: await refund(cash, "cash", { amount: 2_000n, status: "SUCCEEDED", createdAt: istInstant("2026-09-30", "23:59"), finalizedAt: istInstant("2026-10-01", "00:05"), reason: "cold" }),
    reservedCashFresh: await refund(cash, "cash", { amount: 3_000n, status: "RESERVED", createdAt: istInstant("2026-09-17", "11:50"), reason: "in progress" }),
    failedInRange: await refund(cash, "cash", { amount: 9_999n, status: "FAILED", createdAt: istInstant("2026-09-12"), reason: "refused" }),
    failedLastMonth: await refund(cash, "cash", { amount: 1_111n, status: "FAILED", createdAt: istInstant("2026-08-20"), reason: "old refusal" }),
    reservedOnlineStale: await refund(online, "razorpay", { amount: 4_000n, status: "RESERVED", createdAt: istInstant("2026-09-17", "10:30"), reason: "gateway slow" }),
    reservedOnlineOld: await refund(online, "razorpay", { amount: 500n, status: "RESERVED", createdAt: istInstant("2026-08-01"), reason: "never finished" }),
  };
  return { cash, online, ids };
}

describe("payments ledger — refunds by status (refund slice 5)", () => {
  let orgs: TwoOrgs;
  let a: Seeded;

  beforeAll(async () => {
    orgs = await createTwoTestOrgs();
    a = await seed(orgs.a);
    // The same rows in a second org: nothing of it may appear in A's figures.
    await seed(orgs.b);
  });

  afterAll(async () => {
    await orgs.cleanup();
  });

  it("sums only SUCCEEDED refunds finalized in the range; RESERVED is held apart and FAILED never summed", async () => {
    const ledger = await getPaymentsLedger(orgs.a.orgId, SEPTEMBER, 500, NOW);
    expect({
      refundedTotal: ledger.refundedTotal,
      refundedCount: ledger.refundedCount,
      reservedRefundTotal: ledger.reservedRefundTotal,
      reservedRefundCount: ledger.reservedRefundCount,
      staleReservedRefundCount: ledger.staleReservedRefundCount,
      failedRefundCount: ledger.failedRefundCount,
    }).toEqual({ refundedTotal: 5_000n, refundedCount: 1, reservedRefundTotal: 7_500n, reservedRefundCount: 3, staleReservedRefundCount: 2, failedRefundCount: 1 });
  });

  it("lists SUCCEEDED by finalized_at, FAILED by created_at, and every open RESERVED, each with its status and staleness", async () => {
    const ledger = await getPaymentsLedger(orgs.a.orgId, SEPTEMBER, 500, NOW);
    const byId = new Map(ledger.refunds.map((row) => [row.id, row]));
    expect([...byId.keys()].sort()).toEqual([a.ids.succeededInRange, a.ids.reservedCashFresh, a.ids.failedInRange, a.ids.reservedOnlineStale, a.ids.reservedOnlineOld].sort());
    expect(byId.get(a.ids.succeededInRange)).toMatchObject({ status: "SUCCEEDED", at: istInstant("2026-09-01", "00:10"), stale: false });
    expect(byId.get(a.ids.failedInRange)).toMatchObject({ status: "FAILED", at: istInstant("2026-09-12"), stale: false });
    expect(byId.get(a.ids.reservedCashFresh)).toMatchObject({ status: "RESERVED", stale: false });
    expect(byId.get(a.ids.reservedOnlineStale)).toMatchObject({ status: "RESERVED", stale: true });
    expect(byId.get(a.ids.reservedOnlineOld)).toMatchObject({ status: "RESERVED", stale: true });
  });

  it("gives each payment what went back (every SUCCEEDED, whenever) and what is held (RESERVED), never FAILED", async () => {
    const ledger = await getPaymentsLedger(orgs.a.orgId, SEPTEMBER, 500, NOW);
    const cash = ledger.payments.find((row) => row.id === a.cash.payments[0]!.id);
    const online = ledger.payments.find((row) => row.id === a.online.payments[0]!.id);
    expect(cash).toMatchObject({ refunded: 7_000n, refundReserved: 3_000n, refundStuck: false, refundFailedCount: 2 });
    expect(online).toMatchObject({ refunded: 0n, refundReserved: 4_500n, refundStuck: true, refundFailedCount: 0 });
  });

  it("reports nothing refunded in a month with only FAILED refunds, and still shows open RESERVED ones", async () => {
    const august = { from: startOfBusinessDay("2026-08-01"), to: endOfBusinessDay("2026-08-31"), label: "August 2026" };
    const ledger = await getPaymentsLedger(orgs.a.orgId, august, 500, NOW);
    expect(ledger.refundedTotal).toBe(0n);
    expect(ledger.failedRefundCount).toBe(1);
    expect(ledger.reservedRefundCount).toBe(3);
  });
});
