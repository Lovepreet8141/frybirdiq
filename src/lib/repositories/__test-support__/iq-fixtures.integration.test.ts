/**
 * The IQ-1 fixture helpers write what they say, at the instant they are
 * given, in the org they are given — checked by reading the rows back.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { expenses, inventoryMovements, orderItems, orders, organizations, payments, refunds, targets, wasteEntries } from "@/db/schema";
import { createTestIngredient, createTestProduct } from "./fixtures";
import {
  createTwoTestOrgs,
  istInstant,
  seedExpense,
  seedExpenseCategory,
  seedMovement,
  seedOrder,
  seedPayment,
  seedRefund,
  seedSale,
  seedSaleMovements,
  seedTarget,
  seedWasteEntry,
  type TwoOrgs,
} from "./iq-fixtures";

describe("iq-fixtures", () => {
  let orgs: TwoOrgs;

  beforeAll(async () => {
    orgs = await createTwoTestOrgs();
  });

  afterAll(async () => {
    await orgs.cleanup();
  });

  describe("orders", () => {
    it("stamps created_at, placed_at and the IST business date from the instant, to the millisecond", async () => {
      const lastMs = istInstant("2026-08-31", "23:59:59.999");
      const midnight = istInstant("2026-09-01", "00:00");
      const a = await seedOrder(orgs.a, { at: lastMs, lines: [{ unitPricePaise: 9_900n }] });
      const b = await seedOrder(orgs.a, { at: midnight, lines: [{ unitPricePaise: 9_900n }] });

      const rows = await db()
        .select({ id: orders.id, businessDate: orders.businessDate, createdAt: orders.createdAt, placedAt: orders.placedAt, updatedAt: orders.updatedAt })
        .from(orders)
        .where(inArray(orders.id, [a.id, b.id]));
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(a.id)).toMatchObject({ businessDate: "2026-08-31", createdAt: lastMs, placedAt: lastMs, updatedAt: lastMs });
      expect(byId.get(b.id)).toMatchObject({ businessDate: "2026-09-01", createdAt: midnight, placedAt: midnight });
    });

    it("prices lines GST-inclusive the way placement does, and the lines sum to the order", async () => {
      const product = await createTestProduct(orgs.a.orgId);
      const order = await seedOrder(orgs.a, {
        at: istInstant("2026-09-02", "13:00"),
        lines: [
          { productId: product.id, unitPricePaise: 9_900n },
          { unitPricePaise: 14_900n, quantity: 2, discountPaise: 1_000n },
        ],
      });
      // ₹99 inclusive of 5%: ₹94.29 + ₹4.71.
      expect(order.items[0]).toMatchObject({ productId: product.id, lineTaxable: 9_429n, lineTax: 471n, lineTotal: 9_900n });

      const [row] = await db().select().from(orders).where(eq(orders.id, order.id));
      const items = await db().select().from(orderItems).where(eq(orderItems.orderId, order.id));
      expect(row).toMatchObject({ subtotal: 39_700n, discountTotal: 1_000n, grandTotal: 38_700n, deliveryFee: 0n });
      expect(items.reduce((s, i) => s + i.lineTaxable, 0n)).toBe(row!.taxableTotal);
      expect(items.reduce((s, i) => s + i.lineTax, 0n)).toBe(row!.taxTotal);
      expect(row!.cgstTotal + row!.sgstTotal).toBe(row!.taxTotal);
      expect(row!.taxableTotal + row!.taxTotal).toBe(row!.grandTotal);
    });

    it("taxes a delivery fee into the order, and points lower only what is payable", async () => {
      const order = await seedOrder(orgs.a, {
        at: istInstant("2026-09-02", "20:00"),
        channel: "ONLINE",
        fulfilment: "DELIVERY",
        lines: [{ unitPricePaise: 9_900n }],
        deliveryFeePaise: 3_000n,
        pointsRedeemed: 50,
        pointsDiscountPaise: 500n,
      });
      // Food ₹94.29 + fee ₹28.57 taxable; gross ₹129, less ₹5 of points.
      expect(order).toMatchObject({ taxableTotal: 12_286n, taxTotal: 614n, deliveryFee: 3_000n, grandTotal: 12_400n });
      await expect(
        seedOrder(orgs.a, { at: istInstant("2026-09-02"), lines: [{ unitPricePaise: 100n }], deliveryFeePaise: 3_000n }),
      ).rejects.toThrow(/DELIVERY/);
    });

    it("makes a stamp-reward line free and records the reward", async () => {
      const order = await seedOrder(orgs.a, { at: istInstant("2026-09-03"), lines: [{ unitPricePaise: 9_900n }], stampRewardLine: 0 });
      const [row] = await db().select().from(orders).where(eq(orders.id, order.id));
      expect(row).toMatchObject({ taxableTotal: 0n, taxTotal: 0n, grandTotal: 0n, discountTotal: 9_900n, stampRewardDiscount: 9_900n });
    });

    it("lets a clock-skew case store a business date that disagrees with created_at", async () => {
      const order = await seedOrder(orgs.a, { at: istInstant("2026-09-04", "00:10"), businessDate: "2026-09-03", lines: [{ unitPricePaise: 100n }] });
      expect(order.businessDate).toBe("2026-09-03");
    });

    it("refuses a product from another org", async () => {
      const foreign = await createTestProduct(orgs.b.orgId);
      await expect(seedOrder(orgs.a, { at: istInstant("2026-09-02"), lines: [{ productId: foreign.id, unitPricePaise: 100n }] })).rejects.toThrow(
        /does not belong/,
      );
    });
  });

  describe("payments and refunds", () => {
    it("seeds a double capture as two CAPTURED rows stamped at their instants", async () => {
      const at = istInstant("2026-09-02", "12:00");
      const later = istInstant("2026-09-02", "12:05");
      const sale = await seedSale(orgs.a, { at, lines: [{ unitPricePaise: 9_900n }], payments: [{}, { at: later }] });

      const rows = await db().select().from(payments).where(eq(payments.orderId, sale.order.id));
      expect(rows.map((r) => [r.status, r.amount, r.capturedAt?.getTime(), r.createdAt.getTime()]).sort()).toEqual(
        [
          ["CAPTURED", 9_900n, at.getTime(), at.getTime()],
          ["CAPTURED", 9_900n, later.getTime(), later.getTime()],
        ].sort(),
      );
    });

    it("moves a payment to PARTIALLY_REFUNDED, then REFUNDED, with each refund on its own day", async () => {
      const partialAt = istInstant("2026-09-03", "09:00");
      const restAt = istInstant("2026-09-05", "09:00");
      const sale = await seedSale(orgs.a, {
        at: istInstant("2026-09-02"),
        lines: [{ unitPricePaise: 20_000n }],
        refunds: [{ at: partialAt, amountPaise: 5_000n }],
      });
      expect(sale.refunds[0]?.paymentStatus).toBe("PARTIALLY_REFUNDED");

      const rest = await seedRefund(sale.payments[0]!, { at: restAt, amountPaise: 15_000n });
      expect(rest.paymentStatus).toBe("REFUNDED");

      const [payment] = await db().select().from(payments).where(eq(payments.id, sale.payments[0]!.id));
      expect(payment).toMatchObject({ status: "REFUNDED", updatedAt: restAt });
      const rows = await db().select({ amount: refunds.amount, createdAt: refunds.createdAt }).from(refunds).where(eq(refunds.orderId, sale.order.id));
      expect(rows.map((r) => [r.amount, r.createdAt.getTime()]).sort()).toEqual(
        [
          [5_000n, partialAt.getTime()],
          [15_000n, restAt.getTime()],
        ].sort(),
      );
    });

    it("refuses what the app refuses: over-refunding, or refunding an uncaptured payment", async () => {
      const sale = await seedSale(orgs.a, { at: istInstant("2026-09-02"), lines: [{ unitPricePaise: 1_000n }] });
      await expect(seedRefund(sale.payments[0]!, { at: istInstant("2026-09-02"), amountPaise: 1_001n })).rejects.toThrow(/exceeds/);

      const failed = await seedPayment(sale.order, { at: istInstant("2026-09-02"), status: "FAILED" });
      await expect(seedRefund(failed, { at: istInstant("2026-09-02"), amountPaise: 100n })).rejects.toThrow(/captured/);
      const [row] = await db().select({ capturedAt: payments.capturedAt }).from(payments).where(eq(payments.id, failed.id));
      expect(row?.capturedAt).toBeNull();
    });

    it("seeds an unpaid order with no payment", async () => {
      const sale = await seedSale(orgs.a, { at: istInstant("2026-09-02"), status: "PENDING_PAYMENT", lines: [{ unitPricePaise: 1_000n }], payments: [] });
      expect(await db().select().from(payments).where(eq(payments.orderId, sale.order.id))).toEqual([]);
    });
  });

  describe("expenses and targets", () => {
    it("reuses one category per behaviour and keeps DIRECT, FIXED and non-operating apart", async () => {
      const direct = await seedExpenseCategory(orgs.a, { behaviour: "DIRECT" });
      expect((await seedExpenseCategory(orgs.a, { behaviour: "DIRECT" })).id).toBe(direct.id);
      const fixed = await seedExpenseCategory(orgs.a, { behaviour: "FIXED" });
      const nonOperating = await seedExpenseCategory(orgs.a, { behaviour: "FIXED", nonOperating: true });
      expect(new Set([direct.id, fixed.id, nonOperating.id]).size).toBe(3);
      expect(nonOperating.isNonOperating).toBe(true);
      await expect(seedExpenseCategory(orgs.a, { behaviour: "FIXED", name: "Fixture DIRECT" })).rejects.toThrow(/different behaviour/);
    });

    it("dates an expense paid at 00:10 IST on the IST day, where UTC still reads the day before (D4)", async () => {
      const at = istInstant("2026-09-01", "00:10");
      const expense = await seedExpense(orgs.a, { at, amountPaise: 12_300n, behaviour: "FIXED" });
      expect(at.toISOString().slice(0, 10)).toBe("2026-08-31");
      const [row] = await db().select().from(expenses).where(eq(expenses.id, expense.id));
      expect(row).toMatchObject({ paidOn: "2026-09-01", amount: 12_300n, createdAt: at });
    });

    it("accepts a plain paid-on date, and refuses a category from another org", async () => {
      const expense = await seedExpense(orgs.a, { paidOn: "2026-08-31", amountPaise: 100n });
      expect(expense.paidOn).toBe("2026-08-31");
      const foreign = await seedExpenseCategory(orgs.b, { behaviour: "DIRECT" });
      await expect(seedExpense(orgs.a, { paidOn: "2026-08-31", amountPaise: 100n, categoryId: foreign.id })).rejects.toThrow(/does not belong/);
    });

    it("stores a target on the first of its IST month and replaces it on a second call", async () => {
      await seedTarget(orgs.a, { month: istInstant("2026-09-01", "00:10"), foodCostTargetBps: 3_000 });
      await seedTarget(orgs.a, { month: "2026-09", foodCostTargetBps: 3_500, revenueTargetPaise: 94_000_000n });
      await seedTarget(orgs.a, { month: "2026-08-01", foodCostTargetBps: 2_800 });
      const rows = await db().select().from(targets).where(eq(targets.orgId, orgs.a.orgId));
      expect(rows.map((r) => [r.month, r.foodCostTargetBps, r.revenueTarget]).sort()).toEqual([
        ["2026-08-01", 2_800, null],
        ["2026-09-01", 3_500, 94_000_000n],
      ]);
    });
  });

  describe("inventory", () => {
    it("signs SALE and WASTE out and RETURN in, valued at magnitude × cost, at the instant", async () => {
      const ingredient = await createTestIngredient(orgs.a.orgId, 2n);
      const at = istInstant("2026-09-02", "23:59:59.999");
      const sale = await seedMovement(orgs.a, { at, type: "SALE", ingredientId: ingredient.id, magnitude: 150, costPerBaseUnitPaise: 2n });
      const back = await seedMovement(orgs.a, {
        at,
        type: "RETURN",
        ingredientId: ingredient.id,
        magnitude: 150,
        costPerBaseUnitPaise: 2n,
        reversalOfMovementId: sale.id,
      });
      const waste = await seedMovement(orgs.a, { at, type: "WASTE", ingredientId: ingredient.id, magnitude: 40, costPerBaseUnitPaise: 2n });
      expect([sale.quantity, back.quantity, waste.quantity]).toEqual([-150, 150, -40]);
      expect([sale.totalCost, back.totalCost, waste.totalCost]).toEqual([300n, 300n, 80n]);

      const rows = await db().select().from(inventoryMovements).where(eq(inventoryMovements.id, back.id));
      expect(rows[0]).toMatchObject({ occurredAt: at, createdAt: at, reversalOfMovementId: sale.id, locationId: orgs.a.locationId });
    });

    it("writes one SALE per order line, and the database still refuses a second for the same line", async () => {
      const ingredient = await createTestIngredient(orgs.a.orgId, 3n);
      const order = await seedOrder(orgs.a, { at: istInstant("2026-09-02"), lines: [{ unitPricePaise: 100n, quantity: 2 }, { unitPricePaise: 100n }] });
      const moves = await seedSaleMovements(orgs.a, order, { ingredientId: ingredient.id, perUnit: 10, costPerBaseUnitPaise: 3n });
      expect(moves.map((m) => m.quantity)).toEqual([-20, -10]);
      await expect(
        seedMovement(orgs.a, {
          at: istInstant("2026-09-02"),
          type: "SALE",
          ingredientId: ingredient.id,
          magnitude: 1,
          costPerBaseUnitPaise: 3n,
          orderId: order.id,
          orderItemId: order.items[0]!.id,
        }),
      ).rejects.toThrow();
    });

    it("records cooked-then-cancelled waste with no movement, and refuses another org's ingredient", async () => {
      const ingredient = await createTestIngredient(orgs.a.orgId);
      const at = istInstant("2026-09-02", "21:00");
      const entry = await seedWasteEntry(orgs.a, { at, ingredientId: ingredient.id, magnitude: 200, costPaise: 400n, reason: "CANCELLED_ORDER" });
      const [row] = await db().select().from(wasteEntries).where(eq(wasteEntries.id, entry.id));
      expect(row).toMatchObject({ movementId: null, reason: "CANCELLED_ORDER", occurredAt: at, cost: 400n });

      const foreign = await createTestIngredient(orgs.b.orgId);
      await expect(
        seedMovement(orgs.a, { at, type: "WASTE", ingredientId: foreign.id, magnitude: 1, costPerBaseUnitPaise: 1n }),
      ).rejects.toThrow(/does not belong/);
    });
  });

  describe("two orgs", () => {
    it("keeps identical shapes in each org's own rows", async () => {
      const at = istInstant("2026-09-06");
      const a = await seedSale(orgs.a, { at, lines: [{ unitPricePaise: 5_000n }] });
      const b = await seedSale(orgs.b, { at, lines: [{ unitPricePaise: 5_000n }] });
      const rows = await db()
        .select({ id: orders.id, orgId: orders.orgId })
        .from(orders)
        .where(and(eq(orders.businessDate, "2026-09-06"), inArray(orders.orgId, [orgs.a.orgId, orgs.b.orgId])));
      expect(rows.filter((r) => r.orgId === orgs.a.orgId).map((r) => r.id)).toEqual([a.order.id]);
      expect(rows.filter((r) => r.orgId === orgs.b.orgId).map((r) => r.id)).toEqual([b.order.id]);
      const [paymentB] = await db().select({ orgId: payments.orgId }).from(payments).where(eq(payments.id, b.payments[0]!.id));
      expect(paymentB?.orgId).toBe(orgs.b.orgId);
    });

    it("cleanup removes both orgs and everything seeded under them", async () => {
      const pair = await createTwoTestOrgs();
      const sale = await seedSale(pair.a, { at: istInstant("2026-09-02"), lines: [{ unitPricePaise: 1_000n }], refunds: [{ at: istInstant("2026-09-03"), amountPaise: 100n }] });
      await seedExpense(pair.b, { paidOn: "2026-09-02", amountPaise: 100n });
      await pair.cleanup();
      expect(await db().select().from(organizations).where(inArray(organizations.id, [pair.a.orgId, pair.b.orgId]))).toEqual([]);
      expect(await db().select().from(refunds).where(eq(refunds.orderId, sale.order.id))).toEqual([]);
    });
  });
});
