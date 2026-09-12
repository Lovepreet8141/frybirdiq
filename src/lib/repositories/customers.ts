import "server-only";

/**
 * Customer lookup and the Customer 360 profile.
 *
 * Read-only, same as the rest of this file. "Paid" here means the same
 * thing it means everywhere else revenue is computed in this app (see
 * `analytics.ts`'s `paidOrders`): a captured payment, on an order that
 * hasn't since been cancelled, failed or refunded. A customer's order count
 * and spend use that definition rather than a looser "every order they ever
 * started", so this screen can never disagree with the dashboard about what
 * counts as a sale.
 */

import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, loyaltyAccounts, orderItems, orders, organizations, payments } from "@/db/schema";
import type { OrderChannel } from "@/domain/order-channel";
import type { OrderStatus } from "@/domain/order-status";
import { type Paise, ZERO, add, paise } from "@/lib/money";

export interface CustomerLookup {
  readonly id: string;
  readonly name: string | null;
  readonly phone: string | null;
}

/** Exact match on the 10-digit number, scoped to the org. */
export async function findCustomerByPhone(orgId: string, phone: string): Promise<CustomerLookup | null> {
  const [row] = await db()
    .select({ id: customers.id, name: customers.name, phone: customers.phone })
    .from(customers)
    .where(and(eq(customers.orgId, orgId), eq(customers.phone, phone)))
    .limit(1);
  return row ?? null;
}

/** A customer's paid orders — the same join `analytics.ts` uses for revenue, without a date range. */
async function paidOrdersFor(orgId: string, customerIds: readonly string[]) {
  if (customerIds.length === 0) return [];
  return db()
    .select({
      id: orders.id,
      customerId: orders.customerId,
      grandTotal: orders.grandTotal,
      placedAt: orders.placedAt,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .innerJoin(payments, and(eq(payments.orderId, orders.id), eq(payments.status, "CAPTURED")))
    .where(
      and(
        eq(orders.orgId, orgId),
        inArray(orders.customerId, customerIds as string[]),
        // Same exclusion `analytics.ts`'s `paidOrders` uses: a refunded or
        // cancelled order is not a sale, whatever was captured on it.
        sql`${orders.status} NOT IN ('CANCELLED', 'FAILED', 'REFUNDED')`,
      ),
    );
}

export interface CustomerListRow {
  readonly id: string;
  readonly name: string | null;
  readonly phone: string | null;
  readonly orderCount: number;
  readonly totalSpend: Paise;
  readonly lastOrderAt: Date | null;
  readonly stampCount: number;
}

/**
 * Every customer, with lifetime stats. Bounded to 200 — a single-location
 * shop's customer list is not yet the kind of thing that needs pagination,
 * and this is the number to revisit first if that stops being true.
 */
export async function listCustomers(orgId: string, search?: string): Promise<readonly CustomerListRow[]> {
  const trimmed = search?.trim();
  const rows = await db()
    .select({ id: customers.id, name: customers.name, phone: customers.phone })
    .from(customers)
    .where(
      and(
        eq(customers.orgId, orgId),
        trimmed ? or(like(customers.name, `%${trimmed}%`), like(customers.phone, `%${trimmed}%`)) : undefined,
      ),
    )
    .orderBy(customers.name)
    .limit(200);

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [paid, loyalty] = await Promise.all([
    paidOrdersFor(orgId, ids),
    db()
      .select({ customerId: loyaltyAccounts.customerId, stampCount: loyaltyAccounts.stampCount })
      .from(loyaltyAccounts)
      .where(and(eq(loyaltyAccounts.orgId, orgId), inArray(loyaltyAccounts.customerId, ids))),
  ]);

  const stampByCustomer = new Map(loyalty.map((row) => [row.customerId, row.stampCount]));

  const statsByCustomer = new Map<string, { orderCount: number; totalSpend: Paise; lastOrderAt: Date | null }>();
  for (const order of paid) {
    if (!order.customerId) continue;
    const found = statsByCustomer.get(order.customerId) ?? { orderCount: 0, totalSpend: ZERO, lastOrderAt: null };
    const at = order.placedAt ?? order.createdAt;
    statsByCustomer.set(order.customerId, {
      orderCount: found.orderCount + 1,
      totalSpend: (found.totalSpend + paise(order.grandTotal)) as Paise,
      lastOrderAt: !found.lastOrderAt || (at && at > found.lastOrderAt) ? at : found.lastOrderAt,
    });
  }

  return rows.map((row) => {
    const stats = statsByCustomer.get(row.id) ?? { orderCount: 0, totalSpend: ZERO, lastOrderAt: null };
    return { ...row, ...stats, stampCount: stampByCustomer.get(row.id) ?? 0 };
  });
}

export interface CustomerProfile {
  readonly id: string;
  readonly name: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly marketingConsent: boolean;
  readonly orderCount: number;
  readonly totalSpend: Paise;
  readonly averageOrder: Paise;
  readonly lastOrderAt: Date | null;
  readonly favoriteProducts: readonly { name: string; quantity: number }[];
  readonly loyalty: { pointsBalance: number; stampCount: number; stampsRequired: number; tier: string | null } | null;
  readonly recentOrders: readonly {
    id: string;
    orderNumber: string;
    placedAt: Date | null;
    grandTotal: Paise;
    status: OrderStatus;
    channel: OrderChannel;
  }[];
}

/** The Customer 360 profile. Null if the customer doesn't exist in this org. */
export async function getCustomerProfile(orgId: string, customerId: string): Promise<CustomerProfile | null> {
  const [customer] = await db()
    .select()
    .from(customers)
    .where(and(eq(customers.orgId, orgId), eq(customers.id, customerId)))
    .limit(1);
  if (!customer) return null;

  const [paid, loyaltyRow, org, recent] = await Promise.all([
    paidOrdersFor(orgId, [customerId]),
    db()
      .select({ pointsBalance: loyaltyAccounts.pointsBalance, stampCount: loyaltyAccounts.stampCount, tier: loyaltyAccounts.tier })
      .from(loyaltyAccounts)
      .where(and(eq(loyaltyAccounts.orgId, orgId), eq(loyaltyAccounts.customerId, customerId)))
      .limit(1),
    db().select({ stampsRequired: organizations.stampsRequired }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
    db()
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        placedAt: orders.placedAt,
        grandTotal: orders.grandTotal,
        status: orders.status,
        channel: orders.channel,
      })
      .from(orders)
      .where(and(eq(orders.orgId, orgId), eq(orders.customerId, customerId)))
      .orderBy(desc(orders.createdAt))
      .limit(20),
  ]);

  const orderCount = paid.length;
  const totalSpend = add(...paid.map((row) => paise(row.grandTotal)));
  const averageOrder = orderCount === 0 ? ZERO : ((totalSpend / BigInt(orderCount)) as Paise);
  const lastOrderAt = paid.reduce<Date | null>((latest, row) => {
    const at = row.placedAt ?? row.createdAt;
    return !latest || (at && at > latest) ? at : latest;
  }, null);

  const paidIds = paid.map((row) => row.id);
  const items = paidIds.length > 0 ? await db().select().from(orderItems).where(inArray(orderItems.orderId, paidIds)) : [];
  const byProduct = new Map<string, number>();
  for (const item of items) byProduct.set(item.productName, (byProduct.get(item.productName) ?? 0) + item.quantity);
  const favoriteProducts = [...byProduct.entries()]
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    marketingConsent: customer.marketingConsent,
    orderCount,
    totalSpend,
    averageOrder,
    lastOrderAt,
    favoriteProducts,
    loyalty: loyaltyRow[0]
      ? {
          pointsBalance: loyaltyRow[0].pointsBalance,
          stampCount: loyaltyRow[0].stampCount,
          stampsRequired: org[0]?.stampsRequired ?? 7,
          tier: loyaltyRow[0].tier,
        }
      : null,
    recentOrders: recent.map((row) => ({ ...row, grandTotal: paise(row.grandTotal) })),
  };
}
