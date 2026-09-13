/**
 * What a receipt is printed *from*: one order, already placed, priced and
 * paid by the POS. Money travels as paise strings so the shape survives
 * the wire; the renderer formats them with `formatINR` and never computes
 * a figure of its own.
 */

export interface ReceiptModifier {
  readonly name: string;
  /** Paise, may be "0". */
  readonly priceDelta: string;
}

export interface ReceiptItem {
  readonly name: string;
  readonly sku: string | null;
  readonly quantity: number;
  /** Per unit, base plus modifiers, paise. */
  readonly unitPrice: string;
  /** After any line discount, paise. */
  readonly lineTotal: string;
  readonly lineDiscount: string;
  readonly lineTax: string;
  readonly taxRateBps: number;
  readonly notes: string | null;
  readonly modifiers: readonly ReceiptModifier[];
}

export interface ReceiptTax {
  readonly key: "cgst" | "sgst" | "igst" | "other";
  readonly name: string;
  readonly rateBps: number;
  readonly amount: string;
}

export interface ReceiptCharge {
  readonly key: "delivery" | "packaging" | "service" | "convenience" | "other";
  readonly amount: string;
}

export interface ReceiptData {
  readonly orderNumber: string;
  readonly invoiceNumber: string | null;
  /** ISO instant. */
  readonly placedAt: string;
  readonly cashier: string | null;
  readonly table: string | null;
  readonly orderType: string;
  readonly status: string;
  readonly customer: {
    readonly name: string | null;
    readonly phone: string | null;
    readonly email: string | null;
    readonly address: string | null;
    readonly gstin: string | null;
    readonly loyalty: string | null;
  };
  readonly items: readonly ReceiptItem[];
  readonly subtotal: string;
  readonly discounts: {
    readonly item: string;
    readonly coupon: string;
    readonly promotion: string;
    readonly loyalty: string;
    readonly manual: string;
    /** What the coupon or offer was called — printed in place of the generic label when set. */
    readonly code: string | null;
  };
  readonly discountTotal: string;
  readonly taxes: readonly ReceiptTax[];
  readonly taxTotal: string;
  readonly charges: readonly ReceiptCharge[];
  readonly chargesTotal: string;
  readonly rounding: string;
  readonly grandTotal: string;
  readonly payment: {
    readonly method: string;
    readonly paid: string | null;
    readonly change: string | null;
    readonly status: string;
    readonly reference: string | null;
  } | null;
}

export type SampleSize = "small" | "normal" | "large";

const p = (rupees: number): string => String(Math.round(rupees * 100));

const item = (name: string, quantity: number, unit: number, modifiers: readonly [string, number][] = [], extra: Partial<ReceiptItem> = {}): ReceiptItem => {
  const unitWithMods = unit + modifiers.reduce((sum, [, delta]) => sum + delta, 0);
  return {
    name,
    sku: null,
    quantity,
    unitPrice: p(unitWithMods),
    lineTotal: p(unitWithMods * quantity),
    lineDiscount: "0",
    lineTax: "0",
    taxRateBps: 0,
    notes: null,
    modifiers: modifiers.map(([name, delta]) => ({ name, priceDelta: p(delta) })),
    ...extra,
  };
};

/**
 * Sample orders for the designer's preview and the test print. Sample data
 * only — a test bill never creates an order. Three sizes so a design is
 * checked against a two-line slip and a long roll alike.
 */
export function sampleReceipt(size: SampleSize): ReceiptData {
  const base = {
    orderNumber: "042",
    invoiceNumber: null,
    placedAt: "2026-09-13T09:02:00Z",
    cashier: "Lovepreet",
    table: size === "normal" ? "T4" : null,
    orderType: size === "normal" ? "Dine-in" : "Takeaway",
    status: "Paid",
    customer: { name: size === "small" ? null : "Yuvraj Singh", phone: size === "small" ? null : "70154 86625", email: null, address: null, gstin: null, loyalty: size === "large" ? "3 of 7 stamps · 120 points" : size === "normal" ? "Stamp earned · 4 of 7" : null },
  };

  if (size === "small") {
    const items = [item("Classic Burger", 1, 299)];
    return {
      ...base,
      items,
      subtotal: p(299),
      discounts: { item: "0", coupon: "0", promotion: "0", loyalty: "0", manual: "0", code: null },
      discountTotal: "0",
      taxes: [],
      taxTotal: "0",
      charges: [],
      chargesTotal: "0",
      rounding: "0",
      grandTotal: p(299),
      payment: { method: "UPI", paid: p(299), change: null, status: "PAID", reference: "UPI-4F8K2" },
    };
  }

  if (size === "normal") {
    const items = [item("Classic Burger", 1, 299), item("Fries", 1, 99), item("Coke", 1, 59)];
    return {
      ...base,
      items,
      subtotal: p(457),
      discounts: { item: "0", coupon: p(50), promotion: "0", loyalty: "0", manual: "0", code: "FRYBIRD10" },
      discountTotal: p(50),
      taxes: [
        { key: "cgst", name: "CGST", rateBps: 250, amount: p(10) },
        { key: "sgst", name: "SGST", rateBps: 250, amount: p(10) },
      ],
      taxTotal: p(20),
      charges: [],
      chargesTotal: "0",
      rounding: "0",
      grandTotal: p(427),
      payment: { method: "UPI", paid: p(427), change: null, status: "PAID", reference: null },
    };
  }

  const items: ReceiptItem[] = [
    item("Nashville Hot Chicken Sandwich with Extra Crispy Coating", 1, 349, [
      ["Extra Cheese", 30],
      ["Extra Sauce", 0],
    ]),
    item("OG Frybird Classic", 3, 99, [["Signature Mayo", 20]]),
    item("Peri Inferno", 2, 109, [
      ["Green Sauce", 20],
      ["Garlic Parmesan", 25],
      ["Chipotle Sauce", 25],
    ], { notes: "No onions, extra napkins please" }),
    item("Chipotle Crunch Wrap", 2, 139),
    item("Classic Mac & Cheese", 1, 199),
    item("Peri Peri Fries", 2, 119),
    item("OG Salt Fries", 4, 99),
    item("Chicken Wings 6 pc", 2, 159, [["Buffalo", 0]]),
    item("Aloo Tikki Maharaja", 3, 59),
    item("Chicken Tenders", 1, 189),
    item("Classic Rice Bowl", 2, 129, [["Extra Rice", 15]]),
    item("Family Feast Party Box for 6 with Assorted Dips", 1, 1299),
    item("Coke 1L", 2, 89),
    item("Cold Coffee", 3, 129),
  ];
  const subtotal = items.reduce((sum, line) => sum + Number(line.lineTotal), 0);
  const discount = 15000;
  const delivery = 4000;
  const packaging = 2000;
  const taxable = subtotal - discount;
  const cgst = Math.round(taxable * 0.025);
  const sgst = Math.round(taxable * 0.025);
  const grand = taxable + cgst + sgst + delivery + packaging;
  return {
    ...base,
    orderType: "Website delivery",
    customer: { ...base.customer, address: "H.No 42, Sector 9, Ambala City" },
    items,
    subtotal: String(subtotal),
    discounts: { item: "0", coupon: "0", promotion: String(discount), loyalty: "0", manual: "0", code: "Family Feast Offer" },
    discountTotal: String(discount),
    taxes: [
      { key: "cgst", name: "CGST", rateBps: 250, amount: String(cgst) },
      { key: "sgst", name: "SGST", rateBps: 250, amount: String(sgst) },
    ],
    taxTotal: String(cgst + sgst),
    charges: [
      { key: "delivery", amount: String(delivery) },
      { key: "packaging", amount: String(packaging) },
    ],
    chargesTotal: String(delivery + packaging),
    rounding: "0",
    grandTotal: String(grand),
    payment: { method: "CASH", paid: String(grand + 7300), change: "7300", status: "PAID", reference: null },
  };
}
