import "server-only";

/**
 * Receipt designs — draft, active, previous — and the order → receipt
 * adapter the POS prints from.
 *
 * Saving a draft never touches what the POS prints; only `applyDraft`
 * does, and it keeps the design it replaced so `restorePrevious` can put
 * it back. Every one of those three is audited.
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, locations, loyaltyStampEvents, memberships, orderEvents, orderItemModifiers, orderItems, orders, organizations, payments, receiptDesigns, tables } from "@/db/schema";
import { ORDER_CHANNEL_LABELS } from "@/domain/order-channel";
import { type Paise, ZERO, add, paise, subtract } from "@/lib/money";
import type { ReceiptData } from "@/lib/receipt/data";
import { type ReceiptTemplate, type RestaurantSeed, defaultTemplate, parseTemplate } from "@/lib/receipt/template";

/* ------------------------------------------------------------------ */
/* Designs                                                             */
/* ------------------------------------------------------------------ */

export interface ReceiptDesign {
  readonly draft: ReceiptTemplate;
  readonly active: ReceiptTemplate | null;
  readonly previous: ReceiptTemplate | null;
  readonly draftUpdatedAt: Date | null;
  readonly appliedAt: Date | null;
}

/** The restaurant's own details, so a fresh draft starts with the real name, address and GSTIN. */
export async function restaurantSeed(orgId: string): Promise<RestaurantSeed> {
  const [org] = await db().select({ name: organizations.name, gstin: organizations.gstin }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const [location] = await db()
    .select({ address1: locations.addressLine1, address2: locations.addressLine2, city: locations.city, state: locations.state, pin: locations.pincode, phone: locations.phone })
    .from(locations)
    .where(eq(locations.orgId, orgId))
    .limit(1);
  return {
    name: org?.name ?? "FRYBIRD",
    address1: location?.address1 ?? null,
    address2: location?.address2 ?? null,
    city: location?.city ?? null,
    state: location?.state ?? null,
    pin: location?.pin ?? null,
    phone: location?.phone ?? null,
    gstin: org?.gstin ?? null,
  };
}

function templateOrNull(raw: Record<string, unknown> | null): ReceiptTemplate | null {
  if (!raw) return null;
  const parsed = parseTemplate(raw);
  return parsed.ok ? parsed.template : null;
}

/** The org's designs; a default draft is created on first visit. */
export async function getReceiptDesign(orgId: string): Promise<ReceiptDesign> {
  const [row] = await db().select().from(receiptDesigns).where(eq(receiptDesigns.orgId, orgId)).limit(1);
  if (row) {
    const draft = templateOrNull(row.draft) ?? defaultTemplate(await restaurantSeed(orgId));
    return { draft, active: templateOrNull(row.active), previous: templateOrNull(row.previous), draftUpdatedAt: row.draftUpdatedAt, appliedAt: row.appliedAt };
  }
  const draft = defaultTemplate(await restaurantSeed(orgId));
  await db().insert(receiptDesigns).values({ orgId, draft: draft as unknown as Record<string, unknown> }).onConflictDoNothing({ target: receiptDesigns.orgId });
  return { draft, active: null, previous: null, draftUpdatedAt: null, appliedAt: null };
}

/** What the POS prints: the applied design, or the default when nothing has been applied yet. */
export async function getActiveReceiptTemplate(orgId: string): Promise<ReceiptTemplate> {
  const [row] = await db().select({ active: receiptDesigns.active }).from(receiptDesigns).where(eq(receiptDesigns.orgId, orgId)).limit(1);
  return templateOrNull(row?.active ?? null) ?? defaultTemplate(await restaurantSeed(orgId));
}

export async function saveReceiptDraft(orgId: string, actorUserId: string, template: ReceiptTemplate): Promise<void> {
  const now = new Date();
  await db()
    .insert(receiptDesigns)
    .values({ orgId, draft: template as unknown as Record<string, unknown>, draftUpdatedAt: now, draftUpdatedBy: actorUserId })
    .onConflictDoUpdate({ target: receiptDesigns.orgId, set: { draft: template as unknown as Record<string, unknown>, draftUpdatedAt: now, draftUpdatedBy: actorUserId, updatedAt: now } });
  await db().insert(auditLogs).values({ orgId, actorUserId, action: "receipt_draft_saved", entity: "receipt_designs", entityId: orgId, after: { sections: template.sections.map((section) => `${section.kind}:${section.visible ? "on" : "off"}`) } });
}

export async function applyReceiptDraft(orgId: string, actorUserId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return db().transaction(async (tx) => {
    const [row] = await tx.select().from(receiptDesigns).where(eq(receiptDesigns.orgId, orgId)).limit(1);
    if (!row) return { ok: false, error: "Save a draft first." };
    const draft = templateOrNull(row.draft);
    if (!draft) return { ok: false, error: "The draft is not a valid receipt design." };
    const now = new Date();
    await tx
      .update(receiptDesigns)
      .set({ previous: row.active, active: row.draft, appliedAt: now, appliedBy: actorUserId, updatedAt: now })
      .where(eq(receiptDesigns.orgId, orgId));
    await tx.insert(auditLogs).values({ orgId, actorUserId, action: "receipt_design_applied", entity: "receipt_designs", entityId: orgId, before: row.active ? { hadActive: true } : { hadActive: false }, after: { sections: draft.sections.filter((section) => section.visible).map((section) => section.kind) } });
    return { ok: true };
  });
}

export async function restorePreviousReceiptDesign(orgId: string, actorUserId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return db().transaction(async (tx) => {
    const [row] = await tx.select().from(receiptDesigns).where(eq(receiptDesigns.orgId, orgId)).limit(1);
    if (!row || !row.previous) return { ok: false, error: "There is no previous design to restore." };
    const now = new Date();
    // Swap, so a restore can itself be undone by restoring again.
    await tx.update(receiptDesigns).set({ active: row.previous, previous: row.active, appliedAt: now, appliedBy: actorUserId, updatedAt: now }).where(eq(receiptDesigns.orgId, orgId));
    await tx.insert(auditLogs).values({ orgId, actorUserId, action: "receipt_design_restored", entity: "receipt_designs", entityId: orgId });
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Order → receipt data                                                */
/* ------------------------------------------------------------------ */

const str = (value: Paise | bigint): string => value.toString();

/**
 * Everything the receipt prints about one order, read from the rows the
 * POS already wrote. The only figure computed here is change, from the
 * cash the till recorded — and even that is subtraction, not pricing.
 */
export async function receiptDataForOrder(orgId: string, orderId: string, extra: { tendered?: Paise | null } = {}): Promise<ReceiptData | null> {
  const database = db();
  const [order] = await database.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).limit(1);
  if (!order) return null;

  const [lines, payment, placement, table, stamp] = await Promise.all([
    database.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(orderItems.position),
    database.select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, "CAPTURED"))).orderBy(desc(payments.capturedAt)).limit(1),
    database.select({ actorUserId: orderEvents.actorUserId }).from(orderEvents).where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.fromStatus, "DRAFT"))).limit(1),
    order.tableId ? database.select({ name: tables.name }).from(tables).where(eq(tables.id, order.tableId)).limit(1) : Promise.resolve([]),
    // The same "stamp earned" fact the order page shows — read, not recomputed.
    database.select({ id: loyaltyStampEvents.id }).from(loyaltyStampEvents).where(and(eq(loyaltyStampEvents.orderId, orderId), isNull(loyaltyStampEvents.reversedAt))).limit(1),
  ]);
  const lineIds = lines.map((line) => line.id);
  const modifiers = lineIds.length > 0 ? await database.select().from(orderItemModifiers).where(inArray(orderItemModifiers.orderItemId, lineIds)) : [];
  const actorId = placement[0]?.actorUserId ?? null;
  const [cashier] = actorId ? await database.select({ name: memberships.displayName }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, actorId))).limit(1) : [];

  const captured = payment[0] ?? null;
  const tendered = extra.tendered ?? null;
  const grand = paise(order.grandTotal);
  const change = tendered !== null && tendered > grand ? subtract(tendered, grand) : null;

  const loyalty = paise(order.stampRewardDiscount);
  const discountTotal = paise(order.discountTotal);
  const nonLoyalty = discountTotal > loyalty ? subtract(discountTotal, loyalty) : ZERO;
  const taxable = paise(order.taxableTotal);
  const cgst = paise(order.cgstTotal);
  const sgst = paise(order.sgstTotal);
  const rateBps = lines.reduce((best, line) => Math.max(best, line.taxRateBps), 0);
  const delivery = paise(order.deliveryFee);

  const orderType = order.fulfilment === "DELIVERY" ? "Website delivery" : order.fulfilment === "DINE_IN" ? "Dine-in" : order.channel === "ONLINE" ? "Website collection" : ORDER_CHANNEL_LABELS.TAKEAWAY;

  return {
    orderNumber: order.orderNumber,
    invoiceNumber: order.invoiceNumber,
    placedAt: (order.placedAt ?? order.createdAt).toISOString(),
    cashier: cashier?.name ?? null,
    table: table[0]?.name ?? null,
    orderType,
    status: order.status === "PAID" || captured ? "Paid" : order.status.replace(/_/g, " ").toLowerCase(),
    customer: { name: order.customerName, phone: order.customerPhone, email: null, address: null, gstin: null, loyalty: stamp[0] ? "Stamp earned" : null },
    items: lines.map((line) => ({
      name: line.productName,
      sku: null,
      quantity: line.quantity,
      unitPrice: str(paise(line.unitPrice)),
      lineTotal: str(paise(line.lineTotal)),
      lineDiscount: str(paise(line.lineDiscount)),
      lineTax: str(paise(line.lineTax)),
      taxRateBps: line.taxRateBps,
      notes: line.notes,
      modifiers: modifiers.filter((modifier) => modifier.orderItemId === line.id).map((modifier) => ({ name: modifier.modifierName, priceDelta: str(paise(modifier.priceDelta)) })),
    })),
    subtotal: str(paise(order.subtotal)),
    discounts: {
      item: str(lines.reduce<Paise>((sum, line) => add(sum, paise(line.lineDiscount)), ZERO)),
      coupon: order.promotionCode ? str(nonLoyalty) : "0",
      promotion: "0",
      loyalty: str(loyalty),
      manual: order.promotionCode ? "0" : str(nonLoyalty),
      code: order.promotionCode,
    },
    discountTotal: str(discountTotal),
    taxes: [
      ...(cgst > ZERO ? [{ key: "cgst" as const, name: "CGST", rateBps: Math.round(rateBps / 2), amount: str(cgst) }] : []),
      ...(sgst > ZERO ? [{ key: "sgst" as const, name: "SGST", rateBps: Math.round(rateBps / 2), amount: str(sgst) }] : []),
    ],
    taxTotal: str(add(cgst, sgst)),
    charges: delivery > ZERO ? [{ key: "delivery", amount: str(delivery) }] : [],
    chargesTotal: str(delivery),
    rounding: str(subtract(grand, add(taxable, cgst, sgst, delivery))),
    grandTotal: str(grand),
    payment: captured
      ? { method: captured.method, paid: str(tendered ?? paise(captured.amount)), change: change ? str(change) : null, status: "PAID", reference: captured.providerPaymentId }
      : { method: "Unpaid", paid: null, change: null, status: "UNPAID", reference: null },
  };
}
