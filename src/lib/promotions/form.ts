/**
 * The editor's shape of a promotion — every field a string or a plain
 * number, so it can travel to the browser, sit in form state, and come back
 * — and the one converter to the engine's `Promo`. The editor previews with
 * `toPromo(input)` and the server saves with the same call, so what the
 * owner sees is what the till will evaluate.
 */

import { type Bps, type Paise, bps, formatINR, fromRupees, paise } from "@/lib/money";
import { ALL_DAYS, type CustomerSegment, type Promo, type PromoStatus, type PromoType, type Stacking, blankPromo } from "./engine";

export interface PromoInput {
  readonly id: string | null;
  readonly name: string;
  readonly type: PromoType;
  readonly description: string;
  readonly code: string;
  readonly buyQty: number;
  readonly buyProducts: readonly string[];
  readonly getQty: number;
  readonly getProducts: readonly string[];
  /** 100, 50, 25 */
  readonly getDiscountPct: number;
  readonly products: readonly string[];
  readonly discountPct: string;
  readonly discountAmt: string;
  readonly minOrder: string;
  readonly maxDiscount: string;
  readonly comboPrice: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly days: readonly boolean[];
  readonly customer: CustomerSegment;
  readonly stacking: Stacking;
  readonly channels: { readonly pos: boolean; readonly web: boolean };
  readonly usageLimit: string;
  readonly perCustomer: string;
}

/** What the server knows about a saved promotion that the form does not edit. */
export interface PromoMeta {
  readonly status: PromoStatus;
  readonly liveSince: string | null;
  readonly usageCount: number;
}

const rupeesOrNull = (value: string): Paise | null => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  try {
    return fromRupees(trimmed);
  } catch {
    return null;
  }
};

const intOrNull = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

const pctToBps = (value: string): Bps | null => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  try {
    return bps(Math.round(n * 100) / 100);
  } catch {
    return null;
  }
};

export function toPromo(input: PromoInput, meta: PromoMeta = { status: "draft", liveSince: null, usageCount: 0 }): Promo {
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => Boolean(input.days[i])) as unknown as Promo["days"];
  return {
    id: input.id,
    name: input.name,
    type: input.type,
    description: input.description,
    code: input.code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20),
    buyQty: Math.max(1, Math.floor(input.buyQty || 1)),
    buyProducts: [...input.buyProducts],
    getQty: Math.max(1, Math.floor(input.getQty || 1)),
    getProducts: [...input.getProducts],
    getDiscountBps: bps(Math.min(100, Math.max(0, input.getDiscountPct || 0))),
    products: [...input.products],
    discountBps: pctToBps(input.discountPct),
    discountAmount: rupeesOrNull(input.discountAmt),
    minOrder: rupeesOrNull(input.minOrder),
    maxDiscount: rupeesOrNull(input.maxDiscount),
    comboPrice: rupeesOrNull(input.comboPrice),
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    startTime: input.startTime || null,
    endTime: input.endTime || null,
    days,
    customer: input.customer,
    stacking: input.stacking,
    channels: { pos: input.channels.pos, web: input.channels.web },
    usageLimit: intOrNull(input.usageLimit),
    perCustomer: intOrNull(input.perCustomer),
    usageCount: meta.usageCount,
    status: meta.status,
    liveSince: meta.liveSince ? new Date(meta.liveSince) : null,
  };
}

const rupeeText = (value: Paise | null): string => (value === null ? "" : (Number(value) / 100).toString());

export function promoToInput(promo: Promo): PromoInput {
  return {
    id: promo.id,
    name: promo.name,
    type: promo.type,
    description: promo.description,
    code: promo.code,
    buyQty: promo.buyQty,
    buyProducts: [...promo.buyProducts],
    getQty: promo.getQty,
    getProducts: [...promo.getProducts],
    getDiscountPct: Math.round(promo.getDiscountBps / 100),
    products: [...promo.products],
    discountPct: promo.discountBps === null ? "" : (promo.discountBps / 100).toString(),
    discountAmt: rupeeText(promo.discountAmount),
    minOrder: rupeeText(promo.minOrder),
    maxDiscount: rupeeText(promo.maxDiscount),
    comboPrice: rupeeText(promo.comboPrice),
    startDate: promo.startDate ?? "",
    endDate: promo.endDate ?? "",
    startTime: promo.startTime ?? "",
    endTime: promo.endTime ?? "",
    days: [...promo.days],
    customer: promo.customer,
    stacking: promo.stacking,
    channels: { ...promo.channels },
    usageLimit: promo.usageLimit === null ? "" : String(promo.usageLimit),
    perCustomer: promo.perCustomer === null ? "" : String(promo.perCustomer),
  };
}

/** A new promotion for the editor: the design's blank(), dated from today for two weeks. */
export function blankInput(type: PromoType, today: string, plusDays: (date: string, days: number) => string): PromoInput {
  const promo = blankPromo(type);
  return { ...promoToInput({ ...promo, days: ALL_DAYS }), startDate: today, endDate: plusDays(today, 14) };
}

/** Product as the editor sees it: price as a rupee string so it survives the wire, exact. */
export interface PickerProduct {
  readonly slug: string;
  readonly name: string;
  readonly category: string;
  readonly priceRupees: string;
}

export function toEngineProducts(products: readonly PickerProduct[]) {
  return products.map((product) => ({ slug: product.slug, name: product.name, category: product.category, price: fromRupees(product.priceRupees) }));
}

export function priceLabel(product: PickerProduct): string {
  return formatINR(paise(fromRupees(product.priceRupees)), "whole");
}
