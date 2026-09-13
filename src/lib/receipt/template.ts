import { z } from "zod";

/**
 * The receipt template — configuration only, never data.
 *
 * A template says *what* prints, in *which order*, with *which labels* and
 * *how* (alignment, size, spacing, images). Every figure on the bill comes
 * from the order the POS already placed and priced; the template can show
 * or hide a line and rename it, never change a number. One template
 * renders every order (`src/lib/receipt/render.ts`).
 *
 * Optimised for a 79 mm thermal roll; 58 mm is carried as a paper width so
 * the same template can be rendered narrower later.
 */

export type Align = "left" | "center" | "right";
export type TextSize = "sm" | "md" | "lg";
export type ImageSize = "sm" | "md" | "lg";

export interface TextStyle {
  readonly align: Align;
  readonly size: TextSize;
  readonly bold: boolean;
  /** Blank lines above / below. */
  readonly spaceAbove: number;
  readonly spaceBelow: number;
}

export interface ToggleRow {
  readonly key: string;
  readonly label: string;
  readonly show: boolean;
}

export interface RestaurantField extends ToggleRow {
  readonly value: string;
}

export interface LogoSection {
  readonly id: string;
  readonly kind: "logo";
  readonly visible: boolean;
  readonly url: string | null;
  readonly size: ImageSize;
  readonly align: Align;
  readonly spaceAbove: number;
  readonly spaceBelow: number;
}

export interface TextSection {
  readonly id: string;
  readonly kind: "header" | "text" | "footer";
  readonly visible: boolean;
  readonly text: string;
  readonly style: TextStyle;
}

export interface RestaurantSection {
  readonly id: string;
  readonly kind: "restaurant";
  readonly visible: boolean;
  readonly align: Align;
  readonly fields: readonly RestaurantField[];
}

export interface OrderSection {
  readonly id: string;
  readonly kind: "order";
  readonly visible: boolean;
  readonly align: Align;
  readonly rows: readonly ToggleRow[];
}

export interface CustomerSection {
  readonly id: string;
  readonly kind: "customer";
  readonly visible: boolean;
  readonly rows: readonly ToggleRow[];
}

export type ItemLayout = "compact" | "detailed" | "qsr";

export interface ItemsSection {
  readonly id: string;
  readonly kind: "items";
  readonly visible: boolean;
  readonly layout: ItemLayout;
  readonly columnHeader: boolean;
  readonly show: {
    readonly quantity: boolean;
    readonly unitPrice: boolean;
    readonly total: boolean;
    readonly sku: boolean;
    readonly notes: boolean;
    readonly modifiers: boolean;
    readonly modifierPrices: boolean;
    readonly itemDiscount: boolean;
    readonly itemTax: boolean;
  };
}

export interface RowsSection {
  readonly id: string;
  readonly kind: "discounts" | "charges" | "total" | "payment";
  readonly visible: boolean;
  readonly rows: readonly ToggleRow[];
}

export interface TaxesSection {
  readonly id: string;
  readonly kind: "taxes";
  readonly visible: boolean;
  readonly showRate: boolean;
  readonly rows: readonly ToggleRow[];
}

export interface PaymentQrSection {
  readonly id: string;
  readonly kind: "paymentQr";
  readonly visible: boolean;
  readonly url: string | null;
  readonly size: ImageSize;
  readonly align: Align;
  readonly textAbove: string;
  readonly textBelow: string;
}

export type OtherQrKind = "website" | "menu" | "feedback" | "review" | "loyalty" | "social";

export interface OtherQr {
  readonly id: string;
  readonly kind: OtherQrKind;
  readonly label: string;
  readonly url: string | null;
  readonly show: boolean;
}

export interface OtherQrsSection {
  readonly id: string;
  readonly kind: "otherQrs";
  readonly visible: boolean;
  readonly size: ImageSize;
  readonly align: Align;
  readonly codes: readonly OtherQr[];
}

export type Section =
  | LogoSection
  | TextSection
  | RestaurantSection
  | OrderSection
  | CustomerSection
  | ItemsSection
  | RowsSection
  | TaxesSection
  | PaymentQrSection
  | OtherQrsSection;

export type SectionKind = Section["kind"];

export interface ReceiptTemplate {
  readonly version: 1;
  readonly paperWidthMm: 79 | 58;
  readonly divider: "dashed" | "solid" | "none";
  readonly sections: readonly Section[];
}

/* ------------------------------------------------------------------ */
/* Validation — the server never trusts a template from the browser     */
/* ------------------------------------------------------------------ */

const align = z.enum(["left", "center", "right"]);
const size = z.enum(["sm", "md", "lg"]);
const spacing = z.number().int().min(0).max(6);
const style = z.object({ align, size, bold: z.boolean(), spaceAbove: spacing, spaceBelow: spacing });
const id = z.string().min(1).max(40);
const label = z.string().max(60);
const toggleRow = z.object({ key: z.string().min(1).max(40), label, show: z.boolean() });
const url = z.string().url().max(500).nullable();

const sectionSchema = z.discriminatedUnion("kind", [
  z.object({ id, kind: z.literal("logo"), visible: z.boolean(), url, size, align, spaceAbove: spacing, spaceBelow: spacing }),
  z.object({ id, kind: z.enum(["header", "text", "footer"]), visible: z.boolean(), text: z.string().max(600), style }),
  z.object({ id, kind: z.literal("restaurant"), visible: z.boolean(), align, fields: z.array(toggleRow.extend({ value: z.string().max(200) })).max(20) }),
  z.object({ id, kind: z.literal("order"), visible: z.boolean(), align, rows: z.array(toggleRow).max(12) }),
  z.object({ id, kind: z.literal("customer"), visible: z.boolean(), rows: z.array(toggleRow).max(8) }),
  z.object({
    id,
    kind: z.literal("items"),
    visible: z.boolean(),
    layout: z.enum(["compact", "detailed", "qsr"]),
    columnHeader: z.boolean(),
    show: z.object({
      quantity: z.boolean(),
      unitPrice: z.boolean(),
      total: z.boolean(),
      sku: z.boolean(),
      notes: z.boolean(),
      modifiers: z.boolean(),
      modifierPrices: z.boolean(),
      itemDiscount: z.boolean(),
      itemTax: z.boolean(),
    }),
  }),
  z.object({ id, kind: z.enum(["discounts", "charges", "total", "payment"]), visible: z.boolean(), rows: z.array(toggleRow).max(10) }),
  z.object({ id, kind: z.literal("taxes"), visible: z.boolean(), showRate: z.boolean(), rows: z.array(toggleRow).max(6) }),
  z.object({ id, kind: z.literal("paymentQr"), visible: z.boolean(), url, size, align, textAbove: z.string().max(80), textBelow: z.string().max(80) }),
  z.object({
    id,
    kind: z.literal("otherQrs"),
    visible: z.boolean(),
    size,
    align,
    codes: z.array(z.object({ id, kind: z.enum(["website", "menu", "feedback", "review", "loyalty", "social"]), label, url, show: z.boolean() })).max(6),
  }),
]);

export const templateSchema = z.object({
  version: z.literal(1),
  paperWidthMm: z.union([z.literal(79), z.literal(58)]),
  divider: z.enum(["dashed", "solid", "none"]),
  sections: z.array(sectionSchema).min(1).max(40),
});

export function parseTemplate(raw: unknown): { ok: true; template: ReceiptTemplate } | { ok: false; error: string } {
  const parsed = templateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That receipt design is not valid." };
  return { ok: true, template: parsed.data as ReceiptTemplate };
}

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

export interface RestaurantSeed {
  readonly name: string;
  readonly address1: string | null;
  readonly address2: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly pin: string | null;
  readonly phone: string | null;
  readonly gstin: string | null;
}

const centered = (size: TextSize, bold = false, spaceAbove = 0, spaceBelow = 0): TextStyle => ({ align: "center", size, bold, spaceAbove, spaceBelow });

/** Every section a receipt can have, in the order the printer roll reads, seeded from the restaurant's own settings. */
export function defaultTemplate(seed: RestaurantSeed): ReceiptTemplate {
  return {
    version: 1,
    paperWidthMm: 79,
    divider: "dashed",
    sections: [
      { id: "logo", kind: "logo", visible: false, url: null, size: "md", align: "center", spaceAbove: 0, spaceBelow: 1 },
      { id: "header", kind: "header", visible: false, text: "RECEIPT", style: centered("md", true, 0, 0) },
      {
        id: "restaurant",
        kind: "restaurant",
        visible: true,
        align: "center",
        fields: [
          { key: "name", label: "Restaurant name", value: seed.name, show: true },
          { key: "address1", label: "Address line 1", value: seed.address1 ?? "", show: Boolean(seed.address1) },
          { key: "address2", label: "Address line 2", value: seed.address2 ?? "", show: Boolean(seed.address2) },
          { key: "city", label: "City", value: seed.city ?? "", show: Boolean(seed.city) },
          { key: "state", label: "State", value: seed.state ?? "", show: Boolean(seed.state) },
          { key: "country", label: "Country", value: "India", show: false },
          { key: "pin", label: "PIN", value: seed.pin ?? "", show: false },
          { key: "phone", label: "Phone", value: seed.phone ?? "", show: Boolean(seed.phone) },
          { key: "email", label: "Email", value: "", show: false },
          { key: "website", label: "Website", value: "", show: false },
          { key: "gstin", label: "GSTIN", value: seed.gstin ?? "", show: Boolean(seed.gstin) },
          { key: "fssai", label: "FSSAI", value: "", show: false },
          { key: "other", label: "Other registration", value: "", show: false },
        ],
      },
      {
        id: "order",
        kind: "order",
        visible: true,
        align: "left",
        rows: [
          { key: "orderNumber", label: "ORDER", show: true },
          { key: "date", label: "Date", show: true },
          { key: "time", label: "Time", show: true },
          { key: "cashier", label: "Cashier", show: true },
          { key: "table", label: "Table", show: true },
          { key: "orderType", label: "Order type", show: true },
          { key: "customerName", label: "Customer name", show: false },
          { key: "customerPhone", label: "Customer phone", show: false },
          { key: "status", label: "Order status", show: false },
        ],
      },
      {
        id: "customer",
        kind: "customer",
        visible: true,
        rows: [
          { key: "name", label: "Customer", show: true },
          { key: "phone", label: "Phone", show: false },
          { key: "email", label: "Email", show: false },
          { key: "address", label: "Address", show: false },
          { key: "gstin", label: "Customer GSTIN", show: false },
          { key: "loyalty", label: "FRYBIRD REWARDS", show: true },
        ],
      },
      {
        id: "items",
        kind: "items",
        visible: true,
        layout: "detailed",
        columnHeader: false,
        show: { quantity: true, unitPrice: true, total: true, sku: false, notes: true, modifiers: true, modifierPrices: true, itemDiscount: true, itemTax: false },
      },
      {
        id: "discounts",
        kind: "discounts",
        visible: true,
        rows: [
          { key: "item", label: "Item discount", show: false },
          { key: "coupon", label: "Coupon", show: true },
          { key: "promotion", label: "Offer", show: true },
          { key: "loyalty", label: "FRYBIRD REWARDS", show: true },
          { key: "manual", label: "Discount", show: true },
          { key: "total", label: "Total discount", show: false },
        ],
      },
      {
        id: "taxes",
        kind: "taxes",
        visible: true,
        showRate: true,
        rows: [
          { key: "cgst", label: "CGST", show: true },
          { key: "sgst", label: "SGST", show: true },
          { key: "igst", label: "IGST", show: true },
        ],
      },
      {
        id: "charges",
        kind: "charges",
        visible: true,
        rows: [
          { key: "delivery", label: "Delivery fee", show: true },
          { key: "packaging", label: "Packaging", show: true },
          { key: "service", label: "Service charge", show: true },
          { key: "convenience", label: "Convenience fee", show: true },
          { key: "other", label: "Other charges", show: true },
        ],
      },
      {
        id: "total",
        kind: "total",
        visible: true,
        rows: [
          { key: "subtotal", label: "Subtotal", show: true },
          { key: "discount", label: "Discount", show: true },
          { key: "taxes", label: "Taxes", show: false },
          { key: "charges", label: "Charges", show: false },
          { key: "rounding", label: "Rounding", show: true },
          { key: "grand", label: "TOTAL", show: true },
        ],
      },
      {
        id: "payment",
        kind: "payment",
        visible: true,
        rows: [
          { key: "method", label: "Payment", show: true },
          { key: "paid", label: "Paid", show: true },
          { key: "change", label: "Change", show: true },
          { key: "status", label: "Status", show: true },
          { key: "reference", label: "Ref", show: false },
        ],
      },
      { id: "paymentQr", kind: "paymentQr", visible: false, url: null, size: "md", align: "center", textAbove: "Scan to Pay", textBelow: "Pay using UPI" },
      {
        id: "otherQrs",
        kind: "otherQrs",
        visible: false,
        size: "sm",
        align: "center",
        codes: [
          { id: "qr-website", kind: "website", label: "Order online", url: null, show: false },
          { id: "qr-menu", kind: "menu", label: "Menu", url: null, show: false },
          { id: "qr-feedback", kind: "feedback", label: "Tell us how it was", url: null, show: false },
          { id: "qr-review", kind: "review", label: "Review us on Google", url: null, show: false },
          { id: "qr-loyalty", kind: "loyalty", label: "FRYBIRD REWARDS", url: null, show: false },
          { id: "qr-social", kind: "social", label: "Follow us", url: null, show: false },
        ],
      },
      { id: "footer", kind: "footer", visible: true, text: "Thank you for visiting FRYBIRD!\nPlease come again.", style: centered("md", false, 1, 1) },
    ],
  };
}

/** A new custom text block, ready to be placed anywhere. */
export function newTextSection(seq: number): TextSection {
  return { id: `text-${seq}-${Math.random().toString(36).slice(2, 6)}`, kind: "text", visible: true, text: "THANK YOU FOR ORDERING", style: centered("md", true, 1, 1) };
}

export const SECTION_LABELS: Record<SectionKind, string> = {
  logo: "Logo",
  header: "Header",
  text: "Custom text",
  restaurant: "Restaurant details",
  order: "Order details",
  customer: "Customer details",
  items: "Items",
  discounts: "Discounts",
  taxes: "Taxes",
  charges: "Charges",
  total: "Total",
  payment: "Payment",
  paymentQr: "Payment QR",
  otherQrs: "Other QR codes",
  footer: "Footer",
};

/** Image width as a share of the paper, by the three sizes the editor offers. */
export const IMAGE_WIDTH_PCT: Record<ImageSize, number> = { sm: 35, md: 55, lg: 80 };
