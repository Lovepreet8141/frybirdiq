"use server";

/**
 * The promotions editor's writes. A promotion changes what an order costs,
 * so every write here is gated on `promotions.manage` (OWNER today) and
 * audited. Saving never activates anything: only a push or Activate
 * (slice B) makes one live.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NotPermitted, NotSignedIn, requirePermission } from "@/lib/auth";
import { CUSTOMER_SEGMENTS, PROMO_TYPES, STACKING, type Promo } from "@/lib/promotions/engine";
import { type PromoInput, toPromo } from "@/lib/promotions/form";
import { deletePromotion, getPromotion, savePromotion } from "@/lib/repositories/promotions";

export type PromotionActionResult = { ok: true; id: string } | { ok: false; error: string };

const slugList = z.array(z.string().trim().min(1).max(80)).max(50);

const inputSchema = z.object({
  id: z.uuid().nullable(),
  name: z.string().trim().max(120),
  type: z.enum(PROMO_TYPES.map(([type]) => type) as [string, ...string[]]),
  description: z.string().trim().max(300),
  code: z.string().trim().max(20),
  buyQty: z.number().int().min(1).max(20),
  buyProducts: slugList,
  getQty: z.number().int().min(1).max(20),
  getProducts: slugList,
  getDiscountPct: z.number().min(0).max(100),
  products: slugList,
  discountPct: z.string().trim().max(10),
  discountAmt: z.string().trim().max(12),
  minOrder: z.string().trim().max(12),
  maxDiscount: z.string().trim().max(12),
  comboPrice: z.string().trim().max(12),
  startDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  endDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  startTime: z.union([z.literal(""), z.string().regex(/^\d{2}:\d{2}$/)]),
  endTime: z.union([z.literal(""), z.string().regex(/^\d{2}:\d{2}$/)]),
  days: z.array(z.boolean()).length(7),
  customer: z.enum(CUSTOMER_SEGMENTS),
  stacking: z.enum(STACKING),
  channels: z.object({ pos: z.boolean(), web: z.boolean() }),
  usageLimit: z.string().trim().max(10),
  perCustomer: z.string().trim().max(10),
});

async function authorise(): Promise<{ orgId: string; userId: string } | { error: string }> {
  try {
    const staff = await requirePermission("promotions.manage");
    return { orgId: staff.orgId, userId: staff.userId };
  } catch (error) {
    if (error instanceof NotSignedIn) return { error: "You've been signed out. Sign in again." };
    if (error instanceof NotPermitted) return { error: "Only an owner can change promotions." };
    throw error;
  }
}

/**
 * Save keeps the status the promotion already has; "Save as draft" keeps a
 * live one live too (the design's rule) and only ever sets draft on one that
 * is not live. Neither activates anything.
 */
export async function savePromotionAction(raw: unknown, mode: "save" | "draft"): Promise<PromotionActionResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const auth = await authorise();
  if ("error" in auth) return { ok: false, error: auth.error };

  const input = parsed.data as PromoInput;
  const existing = input.id ? await getPromotion(auth.orgId, input.id) : null;
  if (input.id && !existing) return { ok: false, error: "That promotion no longer exists." };

  const status = existing ? (mode === "draft" && existing.status !== "live" ? "draft" : existing.status) : "draft";
  const promo: Promo = toPromo(input, { status, liveSince: existing?.liveSince?.toISOString() ?? null, usageCount: existing?.usageCount ?? 0 });

  const result = await savePromotion(auth.orgId, auth.userId, promo);
  if (result.ok) revalidatePath("/app/customers/promotions");
  return result;
}

export async function duplicatePromotionAction(id: unknown): Promise<PromotionActionResult> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "That promotion could not be found." };
  const auth = await authorise();
  if ("error" in auth) return { ok: false, error: auth.error };

  const source = await getPromotion(auth.orgId, parsed.data);
  if (!source) return { ok: false, error: "That promotion no longer exists." };

  // A copy starts over: a draft, on no channel, with a fresh code so the copy cannot collide with the original.
  const copy: Promo = {
    ...source,
    id: null,
    name: `${source.name || "Untitled"} (copy)`,
    code: source.type === "coupon" && source.code ? `${source.code.slice(0, 16)}COPY` : "",
    status: "draft",
    liveSince: null,
    usageCount: 0,
    channels: { pos: false, web: false },
  };
  const result = await savePromotion(auth.orgId, auth.userId, copy);
  if (result.ok) revalidatePath("/app/customers/promotions");
  return result;
}

export async function deletePromotionAction(id: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "That promotion could not be found." };
  const auth = await authorise();
  if ("error" in auth) return { ok: false, error: auth.error };

  const result = await deletePromotion(auth.orgId, auth.userId, parsed.data);
  if (result.ok) revalidatePath("/app/customers/promotions");
  return result;
}
