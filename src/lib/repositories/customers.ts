import "server-only";

/**
 * Customer lookup and the Customer 360 profile.
 *
 * Writes: `updateCustomer` (a staff correction, audited and idempotent) and
 * `ensureCustomerByPhone`: a counter
 * enrolment that needs a record to attach an order to. "Paid" here means the same
 * thing it means everywhere else revenue is computed in this app (see
 * `analytics.ts`'s `paidOrders`): a payment in `PAID_PAYMENT_STATUSES`
 * (`CAPTURED` or `PARTIALLY_REFUNDED` — a partial refund does not undo the
 * sale, D2), on an order that hasn't since been cancelled, failed or fully
 * refunded, counted once via `EXISTS` even when an order carries more than
 * one paid payment row (D3). A customer's order count and spend use that
 * exact definition rather than a looser "every order they ever started", so
 * this screen can never disagree with the dashboard about what counts as a
 * sale.
 */

import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, customers, loyaltyAccounts, orderItems, orders, organizations } from "@/db/schema";
import { maskPhone } from "@/lib/customers/edit";
import { withIdempotency } from "@/lib/repositories/idempotency";
import type { OrderChannel } from "@/domain/order-channel";
import type { OrderStatus } from "@/domain/order-status";
import { hasPaidPayment } from "@/lib/repositories/analytics";
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

/**
 * The customer behind a phone number, created with just that number if
 * there is none yet — how a counter enrolment gets a record to attach the
 * order to, so the capture path credits it exactly as it credits a website
 * order (`recordCashPayment` keys on `orders.customer_id`).
 *
 * Same identity rule as the website's checkout upsert: keyed on
 * `(org_id, phone)`. Nothing else is written — no name, no consent — and an
 * existing record is never touched; two tills enrolling the same number at
 * once both land on the one row.
 */
export async function ensureCustomerByPhone(orgId: string, phone: string): Promise<CustomerLookup> {
  const [created] = await db()
    .insert(customers)
    .values({ orgId, phone })
    .onConflictDoNothing({ target: [customers.orgId, customers.phone] })
    .returning({ id: customers.id, name: customers.name, phone: customers.phone });
  if (created) return created;
  const existing = await findCustomerByPhone(orgId, phone);
  if (!existing) throw new Error("customers: phone neither inserted nor found");
  return existing;
}

/**
 * A customer's paid orders — the same `hasPaidPayment` EXISTS check
 * `analytics.ts`'s `paidOrders` uses for revenue, without a date range.
 *
 * `EXISTS`, not a join: an order with two `CAPTURED` payment rows (a double
 * capture) must count once, not twice (D3), and one with a `PARTIALLY_REFUNDED`
 * payment must still count — it was still sold (D2). The previous
 * `innerJoin(payments, ... eq(payments.status, "CAPTURED"))` got both wrong:
 * it multiplied a row per matching payment and dropped partially refunded
 * orders entirely.
 */
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
    .where(
      and(
        eq(orders.orgId, orgId),
        inArray(orders.customerId, customerIds as string[]),
        hasPaidPayment(orders.id),
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
  readonly notes: string | null;
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
    notes: customer.notes,
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

export interface UpdateCustomerInput {
  readonly orgId: string;
  readonly actorUserId: string;
  readonly customerId: string;
  readonly name: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly notes: string | null;
  /** Idempotency key: a retry with the same key replays the first result. */
  readonly key: string;
}

export type UpdateCustomerResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not_found" | "phone_taken" };

/**
 * A staff correction to a customer: name, phone, email, notes. Marketing
 * consent and loyalty are untouched. Scoped to the org; the caller has
 * already passed `customers.edit`.
 *
 * The audit row records who and which fields changed, with the phone masked
 * to its last four digits and the note as a length — the audit log is not a
 * second copy of personal data. Retried by key: one write, one audit row.
 * A number already on another customer of this org is refused (the unique
 * index would refuse it anyway; this says so plainly).
 */
export async function updateCustomer(input: UpdateCustomerInput): Promise<UpdateCustomerResult> {
  const { result } = await withIdempotency(
    { key: input.key, operation: "customer_update", orgId: input.orgId, request: { ...input, key: undefined } },
    async (): Promise<UpdateCustomerResult> =>
      db().transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(customers)
          .where(and(eq(customers.orgId, input.orgId), eq(customers.id, input.customerId)))
          .for("update")
          .limit(1);
        if (!current) return { ok: false, reason: "not_found" };

        if (input.phone && input.phone !== current.phone) {
          const [clash] = await tx
            .select({ id: customers.id })
            .from(customers)
            .where(and(eq(customers.orgId, input.orgId), eq(customers.phone, input.phone)))
            .limit(1);
          if (clash) return { ok: false, reason: "phone_taken" };
        }

        await tx
          .update(customers)
          .set({ name: input.name, phone: input.phone, email: input.email, notes: input.notes, updatedAt: new Date() })
          .where(and(eq(customers.orgId, input.orgId), eq(customers.id, input.customerId)));

        const changed = (
          [
            ["name", current.name !== input.name],
            ["phone", current.phone !== input.phone],
            ["email", current.email !== input.email],
            ["notes", current.notes !== input.notes],
          ] as const
        )
          .filter(([, differs]) => differs)
          .map(([field]) => field);

        await tx.insert(auditLogs).values({
          orgId: input.orgId,
          actorUserId: input.actorUserId,
          action: "customer_updated",
          entity: "customers",
          entityId: input.customerId,
          before: { phone: maskPhone(current.phone), notesLength: current.notes?.length ?? 0 },
          after: { changed, phone: maskPhone(input.phone), notesLength: input.notes?.length ?? 0 },
        });
        return { ok: true };
      }),
  );
  return result;
}
