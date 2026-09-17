/**
 * Time-controlled fixtures for the IQ-1 parity suite — slice S5.
 *
 * hive/reviews/iq-1/DESIGN.md, acceptance test: orders on IST day edges,
 * delivery fees, points, stamp rewards, unpaid and failed orders, full and
 * partial refunds, double captures, DIRECT/FIXED/non-operating expenses,
 * SALE/RETURN/WASTE movements, month targets, and a second org holding the
 * same shapes. Each helper writes one fact at the instant the test names:
 * every timestamp column is set explicitly, so nothing depends on the
 * database's or the app's clock, and the business date is derived from the
 * instant through `src/lib/dates` unless a test overrides it on purpose
 * (clock-skew cases, trust signal T5).
 *
 * Totals are priced by `src/lib/pricing` under the org's own
 * `price_basis`, the way order placement prices them, so a seeded bill
 * reconciles the way a real one does (₹99 inclusive of 5% = ₹94.29 + ₹4.71).
 *
 * Tenancy: every row carries the org it was seeded for. A product or
 * ingredient belonging to another org is refused rather than silently
 * linked — the app connects as `postgres`, which bypasses RLS, so the
 * foreign keys alone would accept it.
 *
 * Local `supabase start` stack only; `vitest.integration.setup.ts` refuses
 * anything else.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  expenseCategories,
  expenses,
  ingredients,
  inventoryMovements,
  orderItems,
  orders,
  organizations,
  payments,
  products,
  refunds,
  targets,
  wasteEntries,
} from "@/db/schema";
import { businessDate } from "@/lib/dates";
import { type Paise, ZERO, add, multiply, paise, subtract } from "@/lib/money";
import { pricingContext, priceOrder } from "@/lib/pricing";
import type { OrderChannel } from "@/domain/order-channel";
import type { FulfilmentType, OrderStatus } from "@/domain/order-status";
import { istInstant, monthStart } from "./clock";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./fixtures";

export { istInstant, monthStart };

// ─── Two orgs ───────────────────────────────────────────────────────────────

export interface TwoOrgs {
  /** The org under test. */
  readonly a: TestOrg;
  /** The org whose identical rows must never leak into `a`'s figures. */
  readonly b: TestOrg;
  /** Deletes both; every seeded row cascades. */
  cleanup(): Promise<void>;
}

export async function createTwoTestOrgs(): Promise<TwoOrgs> {
  const a = await createTestOrg();
  const b = await createTestOrg();
  return {
    a,
    b,
    async cleanup() {
      await deleteTestOrg(a.orgId);
      await deleteTestOrg(b.orgId);
    },
  };
}

// ─── Orders ─────────────────────────────────────────────────────────────────

export interface SeedLine {
  /** A product of the same org, for per-product figures; null for a line with no catalogue row. */
  readonly productId?: string | null;
  readonly name?: string;
  /** Listed price of one unit, as the menu board shows it. */
  readonly unitPricePaise: bigint;
  readonly quantity?: number;
  readonly discountPaise?: bigint;
  readonly taxRateBps?: number;
  readonly hsnCode?: string;
}

export interface SeedOrderInput {
  /** When the order was created — `created_at`, and by default `placed_at` and the business date. */
  readonly at: Date;
  readonly lines: readonly SeedLine[];
  readonly status?: OrderStatus;
  readonly channel?: OrderChannel;
  /** Only an ONLINE order chooses; DINE_IN and TAKEAWAY determine their own. */
  readonly fulfilment?: FulfilmentType;
  /** Listed delivery fee; taxed at the first line's rate, as placement does. DELIVERY orders only. */
  readonly deliveryFeePaise?: bigint;
  readonly pointsRedeemed?: number;
  /** What the points took off the payable total. Revenue is unchanged (D18). */
  readonly pointsDiscountPaise?: bigint;
  /** Makes this line free as a FRYBIRD REWARDS stamp reward: its whole listed value becomes the discount. */
  readonly stampRewardLine?: number;
  /** Override for clock-skew cases only; defaults to the IST date of `at`. */
  readonly businessDate?: string;
  /** Defaults to `at`; null for an order that was never placed. */
  readonly placedAt?: Date | null;
  readonly customerId?: string | null;
  /** Issues an invoice number at `invoicedAt` (default `at`). */
  readonly invoicedAt?: Date;
}

export interface SeededOrderItem {
  readonly id: string;
  readonly productId: string | null;
  readonly quantity: number;
  readonly lineTaxable: Paise;
  readonly lineTax: Paise;
  readonly lineTotal: Paise;
}

export interface SeededOrder {
  readonly id: string;
  readonly orgId: string;
  readonly locationId: string;
  readonly businessDate: string;
  readonly createdAt: Date;
  readonly subtotal: Paise;
  readonly discountTotal: Paise;
  readonly taxableTotal: Paise;
  readonly taxTotal: Paise;
  readonly deliveryFee: Paise;
  readonly grandTotal: Paise;
  readonly items: readonly SeededOrderItem[];
}

const FULFILMENT_FOR: Readonly<Record<Exclude<OrderChannel, "ONLINE">, FulfilmentType>> = {
  DINE_IN: "DINE_IN",
  TAKEAWAY: "TAKEAWAY",
};

export async function seedOrder(org: TestOrg, input: SeedOrderInput): Promise<SeededOrder> {
  if (input.lines.length === 0) throw new Error("iq-fixtures: an order needs at least one line");
  const channel = input.channel ?? "TAKEAWAY";
  const fulfilment = channel === "ONLINE" ? (input.fulfilment ?? "TAKEAWAY") : FULFILMENT_FOR[channel];
  if (channel !== "ONLINE" && input.fulfilment !== undefined && input.fulfilment !== fulfilment) {
    throw new Error(`iq-fixtures: a ${channel} order is fulfilled ${fulfilment}, not ${input.fulfilment}`);
  }
  const deliveryFee = paise(input.deliveryFeePaise ?? 0n);
  if (deliveryFee > ZERO && fulfilment !== "DELIVERY") throw new Error("iq-fixtures: only a DELIVERY order carries a delivery fee");

  await assertOwned(org, "product", input.lines.map((l) => l.productId).filter((id): id is string => typeof id === "string"));

  const lines = input.lines.map((line, index) => {
    const quantity = line.quantity ?? 1;
    const unitPrice = paise(line.unitPricePaise);
    const discount = index === input.stampRewardLine ? multiply(unitPrice, quantity) : paise(line.discountPaise ?? 0n);
    return { line, quantity, unitPrice, discount, rateBps: line.taxRateBps ?? 500 };
  });
  if (input.stampRewardLine !== undefined && lines[input.stampRewardLine] === undefined) {
    throw new Error(`iq-fixtures: no line ${input.stampRewardLine} to make a stamp reward`);
  }

  const context = pricingContext({ priceBasis: await priceBasisOf(org) });
  const priced = priceOrder(
    {
      lines: lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity, discount: l.discount, rateBps: l.rateBps })),
      fees: deliveryFee > ZERO ? [{ label: "Delivery", amount: deliveryFee, rateBps: lines[0]!.rateBps }] : [],
    },
    context,
  );
  const grandTotal = subtract(priced.gross, paise(input.pointsDiscountPaise ?? 0n));
  const stampReward = input.stampRewardLine === undefined ? ZERO : lines[input.stampRewardLine]!.discount;

  return db().transaction(async (tx) => {
    const [order] = await tx
      .insert(orders)
      .values({
        orgId: org.orgId,
        locationId: org.locationId,
        orderNumber: `FX-${randomUUID()}`,
        businessDate: input.businessDate ?? businessDate(input.at),
        status: input.status ?? "COMPLETED",
        channel,
        fulfilment,
        customerId: input.customerId ?? null,
        subtotal: priced.listed,
        discountTotal: priced.discount,
        taxableTotal: priced.taxable,
        cgstTotal: priced.cgst,
        sgstTotal: priced.sgst,
        igstTotal: priced.igst,
        taxTotal: priced.total,
        deliveryFee,
        grandTotal,
        pointsRedeemed: input.pointsRedeemed ?? 0,
        stampRewardDiscount: stampReward,
        invoiceNumber: input.invoicedAt === undefined ? null : `FX-INV-${randomUUID()}`,
        invoicedAt: input.invoicedAt ?? null,
        placedAt: input.placedAt === undefined ? input.at : input.placedAt,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .returning({ id: orders.id, businessDate: orders.businessDate });
    if (!order) throw new Error("iq-fixtures: order insert returned no row");

    const items: SeededOrderItem[] = [];
    for (const [position, l] of lines.entries()) {
      const p = priced.lines[position]!;
      const [item] = await tx
        .insert(orderItems)
        .values({
          orgId: org.orgId,
          orderId: order.id,
          productId: l.line.productId ?? null,
          productName: l.line.name ?? `Fixture line ${position + 1}`,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          lineSubtotal: p.listed,
          lineDiscount: p.discount,
          taxRateBps: l.rateBps,
          hsnCode: l.line.hsnCode ?? "996331",
          lineTaxable: p.taxable,
          lineTax: p.total,
          lineTotal: p.gross,
          position,
          createdAt: input.at,
          updatedAt: input.at,
        })
        .returning({ id: orderItems.id });
      if (!item) throw new Error("iq-fixtures: order item insert returned no row");
      items.push({ id: item.id, productId: l.line.productId ?? null, quantity: l.quantity, lineTaxable: p.taxable, lineTax: p.total, lineTotal: p.gross });
    }

    return {
      id: order.id,
      orgId: org.orgId,
      locationId: org.locationId,
      businessDate: order.businessDate,
      createdAt: input.at,
      subtotal: priced.listed,
      discountTotal: priced.discount,
      taxableTotal: priced.taxable,
      taxTotal: priced.total,
      deliveryFee,
      grandTotal,
      items,
    };
  });
}

// ─── Payments and refunds ───────────────────────────────────────────────────

export type SeedPaymentStatus = "PENDING" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";

export interface SeedPaymentInput {
  readonly at: Date;
  readonly status: SeedPaymentStatus;
  /** Defaults to the order's grand total. */
  readonly amountPaise?: bigint;
  readonly method?: "UPI" | "CASH" | "CARD" | "NETBANKING" | "WALLET" | "OTHER";
  readonly provider?: string;
  /** Defaults to `at` for a payment that was ever captured, null otherwise. */
  readonly capturedAt?: Date | null;
}

export interface SeededPayment {
  readonly id: string;
  readonly orgId: string;
  readonly orderId: string;
  readonly amount: Paise;
  readonly status: SeedPaymentStatus;
}

const EVER_CAPTURED: ReadonlySet<SeedPaymentStatus> = new Set(["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"]);

/**
 * One payment row as it stands. Seeding PARTIALLY_REFUNDED or REFUNDED here
 * writes no refund row — the anomaly shape. For the real path seed CAPTURED
 * and then `seedRefund`.
 */
export async function seedPayment(order: SeededOrder, input: SeedPaymentInput): Promise<SeededPayment> {
  const amount = paise(input.amountPaise ?? order.grandTotal);
  const provider = input.provider ?? "cash";
  const [row] = await db()
    .insert(payments)
    .values({
      orgId: order.orgId,
      orderId: order.id,
      status: input.status,
      method: input.method ?? "CASH",
      amount,
      provider,
      // payments_provider_payment_unique: a real provider id is unique; a fixture's must be too.
      providerPaymentId: provider === "cash" ? null : `fx_${randomUUID()}`,
      capturedAt: input.capturedAt === undefined ? (EVER_CAPTURED.has(input.status) ? input.at : null) : input.capturedAt,
      createdAt: input.at,
      updatedAt: input.at,
    })
    .returning({ id: payments.id });
  if (!row) throw new Error("iq-fixtures: payment insert returned no row");
  return { id: row.id, orgId: order.orgId, orderId: order.id, amount, status: input.status };
}

export interface SeedRefundInput {
  readonly at: Date;
  readonly amountPaise: bigint;
  readonly reason?: string;
}

export interface SeededRefund {
  readonly id: string;
  readonly paymentId: string;
  readonly amount: Paise;
  /** The payment's status after this refund. */
  readonly paymentStatus: "PARTIALLY_REFUNDED" | "REFUNDED";
}

/**
 * A refund at `at`, moving its payment to PARTIALLY_REFUNDED or REFUNDED the
 * way `refundPayment` does. It refuses what the app refuses: a payment that
 * was never captured, or more than is left on it.
 */
export async function seedRefund(payment: SeededPayment, input: SeedRefundInput): Promise<SeededRefund> {
  const amount = paise(input.amountPaise);
  if (amount <= ZERO) throw new Error("iq-fixtures: a refund is a positive amount");

  return db().transaction(async (tx) => {
    const [current] = await tx
      .select({ status: payments.status, amount: payments.amount })
      .from(payments)
      .where(and(eq(payments.id, payment.id), eq(payments.orgId, payment.orgId)))
      .for("update");
    if (!current) throw new Error("iq-fixtures: payment not found in its org");
    if (current.status !== "CAPTURED" && current.status !== "PARTIALLY_REFUNDED") {
      throw new Error(`iq-fixtures: only a captured payment can be refunded; this one is ${current.status}`);
    }

    const booked = await tx.select({ amount: refunds.amount }).from(refunds).where(eq(refunds.paymentId, payment.id));
    const already = add(...booked.map((r) => paise(r.amount)));
    const remaining = subtract(paise(current.amount), already);
    if (amount > remaining) throw new Error(`iq-fixtures: refund ${amount} exceeds the ${remaining} left on the payment`);

    const [row] = await tx
      .insert(refunds)
      .values({
        orgId: payment.orgId,
        paymentId: payment.id,
        orderId: payment.orderId,
        amount,
        reason: input.reason ?? "Fixture refund",
        provider: "cash",
        // Migration 0038: a completed cash refund, finalized when it was made.
        status: "SUCCEEDED",
        finalizedAt: input.at,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .returning({ id: refunds.id });
    if (!row) throw new Error("iq-fixtures: refund insert returned no row");

    const paymentStatus = amount === remaining ? "REFUNDED" : "PARTIALLY_REFUNDED";
    await tx.update(payments).set({ status: paymentStatus, updatedAt: input.at }).where(eq(payments.id, payment.id));
    return { id: row.id, paymentId: payment.id, amount, paymentStatus };
  });
}

export interface SeedSaleInput extends SeedOrderInput {
  /** Defaults to one CAPTURED payment of the grand total at the order's instant. Pass [] for an unpaid order. */
  readonly payments?: readonly (Omit<SeedPaymentInput, "at" | "status"> & { readonly at?: Date; readonly status?: SeedPaymentStatus })[];
  /** Applied in order; `payment` is an index into `payments` (default 0). */
  readonly refunds?: readonly (SeedRefundInput & { readonly payment?: number })[];
}

export interface SeededSale {
  readonly order: SeededOrder;
  readonly payments: readonly SeededPayment[];
  readonly refunds: readonly SeededRefund[];
}

/** An order with its payments and refunds — the common shape of a parity case in one call. */
export async function seedSale(org: TestOrg, input: SeedSaleInput): Promise<SeededSale> {
  const order = await seedOrder(org, input);
  const seededPayments: SeededPayment[] = [];
  for (const p of input.payments ?? [{}]) {
    seededPayments.push(await seedPayment(order, { ...p, at: p.at ?? input.at, status: p.status ?? "CAPTURED" }));
  }
  const seededRefunds: SeededRefund[] = [];
  for (const r of input.refunds ?? []) {
    const payment = seededPayments[r.payment ?? 0];
    if (!payment) throw new Error(`iq-fixtures: no payment ${r.payment ?? 0} to refund`);
    seededRefunds.push(await seedRefund(payment, r));
  }
  return { order, payments: seededPayments, refunds: seededRefunds };
}

// ─── Expenses and targets ───────────────────────────────────────────────────

export interface SeedCategoryInput {
  readonly behaviour: "DIRECT" | "FIXED";
  readonly nonOperating?: boolean;
  /** Defaults to one shared category per behaviour and operating flag. */
  readonly name?: string;
}

export interface SeededCategory {
  readonly id: string;
  readonly behaviour: "DIRECT" | "FIXED";
  readonly isNonOperating: boolean;
}

/** Idempotent by name within the org: asking twice returns the same category. */
export async function seedExpenseCategory(org: TestOrg, input: SeedCategoryInput): Promise<SeededCategory> {
  const isNonOperating = input.nonOperating ?? false;
  const name = input.name ?? `Fixture ${input.behaviour}${isNonOperating ? " non-operating" : ""}`;
  await db()
    .insert(expenseCategories)
    .values({ orgId: org.orgId, name, behaviour: input.behaviour, isNonOperating })
    .onConflictDoNothing({ target: [expenseCategories.orgId, expenseCategories.name] });
  const [row] = await db()
    .select({ id: expenseCategories.id, behaviour: expenseCategories.behaviour, isNonOperating: expenseCategories.isNonOperating })
    .from(expenseCategories)
    .where(and(eq(expenseCategories.orgId, org.orgId), eq(expenseCategories.name, name)));
  if (!row) throw new Error("iq-fixtures: category not found after insert");
  if (row.behaviour !== input.behaviour || row.isNonOperating !== isNonOperating) {
    throw new Error(`iq-fixtures: category "${name}" already exists with a different behaviour`);
  }
  return row;
}

export type SeedExpenseInput = {
  readonly amountPaise: bigint;
  readonly description?: string;
} & (
  | { readonly categoryId: string; readonly behaviour?: never; readonly nonOperating?: never }
  | { readonly categoryId?: never; readonly behaviour?: "DIRECT" | "FIXED"; readonly nonOperating?: boolean }
) &
  (
    | { /** The IST date the owner recorded. */ readonly paidOn: string; readonly at?: Date }
    | { readonly paidOn?: never; /** Paid at this instant: `paid_on` is its IST date. */ readonly at: Date }
  );

export interface SeededExpense {
  readonly id: string;
  readonly categoryId: string;
  readonly paidOn: string;
  readonly amount: Paise;
}

export async function seedExpense(org: TestOrg, input: SeedExpenseInput): Promise<SeededExpense> {
  const paidOn = input.paidOn ?? businessDate(input.at!);
  const recordedAt = input.at ?? istInstant(paidOn);
  let categoryId = input.categoryId;
  if (categoryId === undefined) {
    categoryId = (await seedExpenseCategory(org, { behaviour: input.behaviour ?? "DIRECT", nonOperating: input.nonOperating })).id;
  } else {
    await assertOwned(org, "expense category", [categoryId]);
  }
  const amount = paise(input.amountPaise);
  const [row] = await db()
    .insert(expenses)
    .values({
      orgId: org.orgId,
      categoryId,
      description: input.description ?? `Fixture expense ${paidOn}`,
      amount,
      paidOn,
      createdAt: recordedAt,
      updatedAt: recordedAt,
    })
    .returning({ id: expenses.id });
  if (!row) throw new Error("iq-fixtures: expense insert returned no row");
  return { id: row.id, categoryId, paidOn, amount };
}

export interface SeedTargetInput {
  /** "2026-09", "2026-09-01", or an instant in that IST month. */
  readonly month: string | Date;
  readonly revenueTargetPaise?: bigint | null;
  readonly foodCostTargetBps?: number | null;
  readonly netMarginTargetBps?: number | null;
}

/** Upserts the org's target for a month; a second call for the same month replaces it. */
export async function seedTarget(org: TestOrg, input: SeedTargetInput): Promise<{ readonly id: string; readonly month: string }> {
  const month = monthStart(input.month);
  const values = {
    revenueTarget: input.revenueTargetPaise == null ? null : paise(input.revenueTargetPaise),
    foodCostTargetBps: input.foodCostTargetBps ?? null,
    netMarginTargetBps: input.netMarginTargetBps ?? null,
  };
  const [row] = await db()
    .insert(targets)
    .values({ orgId: org.orgId, month, ...values })
    .onConflictDoUpdate({ target: [targets.orgId, targets.month], set: { ...values, updatedAt: sql`now()` } })
    .returning({ id: targets.id });
  if (!row) throw new Error("iq-fixtures: target upsert returned no row");
  return { id: row.id, month };
}

// ─── Inventory ──────────────────────────────────────────────────────────────

export interface SeedMovementInput {
  readonly at: Date;
  readonly type: "SALE" | "RETURN" | "WASTE";
  readonly ingredientId: string;
  /** How much, in base units, always positive: SALE and WASTE take stock out, RETURN puts it back. */
  readonly magnitude: number;
  readonly costPerBaseUnitPaise: bigint;
  readonly orderId?: string | null;
  /** A SALE row is unique per (order item, ingredient), as consumption is. */
  readonly orderItemId?: string | null;
  readonly reversalOfMovementId?: string | null;
  readonly locationId?: string;
}

export interface SeededMovement {
  readonly id: string;
  readonly quantity: number;
  readonly totalCost: Paise;
}

export async function seedMovement(org: TestOrg, input: SeedMovementInput): Promise<SeededMovement> {
  if (!Number.isInteger(input.magnitude) || input.magnitude <= 0) throw new Error("iq-fixtures: magnitude is a positive whole number");
  await assertOwned(org, "ingredient", [input.ingredientId]);
  const quantity = input.type === "RETURN" ? input.magnitude : -input.magnitude;
  const costPerBaseUnit = paise(input.costPerBaseUnitPaise);
  const totalCost = multiply(costPerBaseUnit, input.magnitude);
  const [row] = await db()
    .insert(inventoryMovements)
    .values({
      orgId: org.orgId,
      ingredientId: input.ingredientId,
      locationId: input.locationId ?? org.locationId,
      type: input.type,
      quantity,
      costPerBaseUnit,
      totalCost,
      orderId: input.orderId ?? null,
      orderItemId: input.orderItemId ?? null,
      reversalOfMovementId: input.reversalOfMovementId ?? null,
      occurredAt: input.at,
      createdAt: input.at,
    })
    .returning({ id: inventoryMovements.id });
  if (!row) throw new Error("iq-fixtures: movement insert returned no row");
  return { id: row.id, quantity, totalCost };
}

/** One SALE movement per line of `order`, consuming `perUnit` base units per item sold. */
export async function seedSaleMovements(
  org: TestOrg,
  order: SeededOrder,
  input: { readonly at?: Date; readonly ingredientId: string; readonly perUnit: number; readonly costPerBaseUnitPaise: bigint },
): Promise<readonly SeededMovement[]> {
  const seeded: SeededMovement[] = [];
  for (const item of order.items) {
    seeded.push(
      await seedMovement(org, {
        at: input.at ?? order.createdAt,
        type: "SALE",
        ingredientId: input.ingredientId,
        magnitude: input.perUnit * item.quantity,
        costPerBaseUnitPaise: input.costPerBaseUnitPaise,
        orderId: order.id,
        orderItemId: item.id,
      }),
    );
  }
  return seeded;
}

export interface SeedWasteEntryInput {
  readonly at: Date;
  readonly ingredientId: string;
  readonly magnitude: number;
  readonly costPaise: bigint;
  readonly reason?: "EXPIRED" | "OVERPRODUCTION" | "PREPARATION" | "DAMAGED" | "CUSTOMER_RETURN" | "QUALITY" | "CANCELLED_ORDER";
  readonly orderId?: string | null;
  /** Null for the cooked-then-cancelled case, which writes no WASTE movement (D7). */
  readonly movementId?: string | null;
}

export async function seedWasteEntry(org: TestOrg, input: SeedWasteEntryInput): Promise<{ readonly id: string }> {
  if (!Number.isInteger(input.magnitude) || input.magnitude <= 0) throw new Error("iq-fixtures: magnitude is a positive whole number");
  await assertOwned(org, "ingredient", [input.ingredientId]);
  const [row] = await db()
    .insert(wasteEntries)
    .values({
      orgId: org.orgId,
      ingredientId: input.ingredientId,
      locationId: org.locationId,
      movementId: input.movementId ?? null,
      orderId: input.orderId ?? null,
      quantity: input.magnitude,
      unit: "G",
      reason: input.reason ?? "EXPIRED",
      cost: paise(input.costPaise),
      occurredAt: input.at,
      createdAt: input.at,
      updatedAt: input.at,
    })
    .returning({ id: wasteEntries.id });
  if (!row) throw new Error("iq-fixtures: waste entry insert returned no row");
  return { id: row.id };
}

// ─── Internals ──────────────────────────────────────────────────────────────

async function priceBasisOf(org: TestOrg) {
  const [row] = await db().select({ priceBasis: organizations.priceBasis }).from(organizations).where(eq(organizations.id, org.orgId));
  if (!row) throw new Error("iq-fixtures: org not found");
  return row.priceBasis;
}

const OWNED_TABLES = {
  product: products,
  ingredient: ingredients,
  "expense category": expenseCategories,
} as const;

/** Refuses a referenced row that belongs to another org — the FK alone would accept it. */
async function assertOwned(org: TestOrg, what: keyof typeof OWNED_TABLES, ids: readonly string[]): Promise<void> {
  const table = OWNED_TABLES[what];
  for (const id of new Set(ids)) {
    const [row] = await db().select({ orgId: table.orgId }).from(table).where(eq(table.id, id));
    if (!row || row.orgId !== org.orgId) throw new Error(`iq-fixtures: ${what} ${id} does not belong to this org`);
  }
}
