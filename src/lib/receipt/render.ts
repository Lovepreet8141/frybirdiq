/**
 * Renders a receipt: template × order → a list of blocks.
 *
 * The blocks are what the 79 mm preview, the test print and the POS print
 * all draw, so the three can never disagree. Nothing here does arithmetic
 * on money: every amount is a paise string from `ReceiptData`, formatted
 * with `formatINR` at this boundary and nowhere else.
 */

import { formatBps, formatINR, paise } from "@/lib/money";
import type { ReceiptData, ReceiptItem } from "./data";
import { IMAGE_WIDTH_PCT, type Align, type ItemsSection, type ReceiptTemplate, type Section, type TextSize, type ToggleRow } from "./template";

export type Block =
  | { readonly kind: "text"; readonly sectionId: string; readonly text: string; readonly align: Align; readonly size: TextSize; readonly bold: boolean; readonly muted?: boolean }
  | { readonly kind: "row"; readonly sectionId: string; readonly left: string; readonly right: string; readonly size: TextSize; readonly bold: boolean; readonly indent?: boolean; readonly muted?: boolean }
  | { readonly kind: "image"; readonly sectionId: string; readonly url: string; readonly widthPct: number; readonly align: Align; readonly alt: string }
  | { readonly kind: "rule"; readonly sectionId: string }
  | { readonly kind: "space"; readonly sectionId: string; readonly lines: number };

const money = (value: string): string => formatINR(paise(BigInt(value)), Number(value) % 100 === 0 ? "whole" : undefined);
const negative = (value: string): string => `−${money(value)}`;
const isZero = (value: string): boolean => BigInt(value) === 0n;
const on = (rows: readonly ToggleRow[], key: string): ToggleRow | null => rows.find((row) => row.key === key && row.show) ?? null;

function clock(iso: string): { date: string; time: string } {
  const at = new Date(iso);
  return {
    date: at.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }),
    time: at.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }),
  };
}

function itemBlocks(section: ItemsSection, data: ReceiptData): Block[] {
  const out: Block[] = [];
  const id = section.id;
  const show = section.show;

  if (section.columnHeader) {
    out.push({ kind: "row", sectionId: id, left: section.layout === "qsr" ? "Qty  Item" : "Item", right: show.total ? "Amount" : "", size: "sm", bold: true, muted: true });
  }

  const modifierLines = (line: ReceiptItem) =>
    show.modifiers
      ? line.modifiers.map<Block>((modifier) => ({
          kind: "row",
          sectionId: id,
          left: modifier.name,
          right: show.modifierPrices && !isZero(modifier.priceDelta) ? `+${money(modifier.priceDelta)}` : "",
          size: "sm",
          bold: false,
          indent: true,
          muted: true,
        }))
      : [];

  const extras = (line: ReceiptItem): Block[] => {
    const rows: Block[] = [];
    if (show.sku && line.sku) rows.push({ kind: "text", sectionId: id, text: `SKU ${line.sku}`, align: "left", size: "sm", bold: false, muted: true });
    if (show.notes && line.notes) rows.push({ kind: "text", sectionId: id, text: `Note: ${line.notes}`, align: "left", size: "sm", bold: false, muted: true });
    if (show.itemDiscount && !isZero(line.lineDiscount)) rows.push({ kind: "row", sectionId: id, left: "Item discount", right: negative(line.lineDiscount), size: "sm", bold: false, indent: true, muted: true });
    if (show.itemTax && !isZero(line.lineTax)) rows.push({ kind: "row", sectionId: id, left: `Tax ${formatBps(line.taxRateBps, 1)}`, right: money(line.lineTax), size: "sm", bold: false, indent: true, muted: true });
    return rows;
  };

  for (const line of data.items) {
    const total = show.total ? money(line.lineTotal) : "";
    switch (section.layout) {
      case "compact":
        out.push({ kind: "row", sectionId: id, left: show.quantity ? `${line.name} × ${line.quantity}` : line.name, right: total, size: "md", bold: false });
        out.push(...modifierLines(line), ...extras(line));
        break;
      case "detailed":
        out.push({ kind: "text", sectionId: id, text: line.name, align: "left", size: "md", bold: false });
        out.push(...modifierLines(line));
        out.push({
          kind: "row",
          sectionId: id,
          left: [show.quantity ? String(line.quantity) : null, show.unitPrice ? money(line.unitPrice) : null].filter(Boolean).join(" × ") || " ",
          right: total,
          size: "md",
          bold: false,
          indent: true,
        });
        out.push(...extras(line));
        break;
      case "qsr":
        out.push({ kind: "row", sectionId: id, left: show.quantity ? `${line.quantity}  ${line.name}` : line.name, right: total, size: "md", bold: false });
        out.push(...modifierLines(line), ...extras(line));
        break;
    }
  }
  return out;
}

function sectionBlocks(section: Section, data: ReceiptData): Block[] {
  const id = section.id;
  switch (section.kind) {
    case "logo": {
      if (!section.url) return [];
      const blocks: Block[] = [];
      if (section.spaceAbove) blocks.push({ kind: "space", sectionId: id, lines: section.spaceAbove });
      blocks.push({ kind: "image", sectionId: id, url: section.url, widthPct: IMAGE_WIDTH_PCT[section.size], align: section.align, alt: "Logo" });
      if (section.spaceBelow) blocks.push({ kind: "space", sectionId: id, lines: section.spaceBelow });
      return blocks;
    }
    case "header":
    case "text":
    case "footer": {
      if (!section.text.trim()) return [];
      const blocks: Block[] = [];
      if (section.style.spaceAbove) blocks.push({ kind: "space", sectionId: id, lines: section.style.spaceAbove });
      for (const line of section.text.split("\n")) blocks.push({ kind: "text", sectionId: id, text: line, align: section.style.align, size: section.style.size, bold: section.style.bold });
      if (section.style.spaceBelow) blocks.push({ kind: "space", sectionId: id, lines: section.style.spaceBelow });
      return blocks;
    }
    case "restaurant":
      return section.fields
        .filter((field) => field.show && field.value.trim())
        .map((field) => {
          const prefixed = field.key === "phone" || field.key === "gstin" || field.key === "fssai" || field.key === "email" || field.key === "website";
          return {
            kind: "text",
            sectionId: id,
            text: prefixed ? `${field.label}: ${field.value}` : field.value,
            align: section.align,
            size: field.key === "name" ? "lg" : "sm",
            bold: field.key === "name",
          };
        });
    case "order": {
      const { date, time } = clock(data.placedAt);
      // The label is the template's prefix ("Cashier", "Served by", "Bill no")
      // and the value is the order's; the date and time print bare.
      const values: Record<string, string | null> = {
        orderNumber: data.orderNumber,
        date,
        time,
        cashier: data.cashier,
        table: data.table,
        orderType: data.orderType,
        customerName: data.customer.name,
        customerPhone: data.customer.phone,
        status: data.status,
      };
      const blocks: Block[] = [];
      const dateRow = on(section.rows, "date");
      const timeRow = on(section.rows, "time");
      for (const row of section.rows) {
        if (!row.show) continue;
        if (row.key === "time" && dateRow) continue; // merged onto the date line
        const value = values[row.key];
        if (!value) continue;
        let text: string;
        if (row.key === "date") text = [date, timeRow ? time : null].filter(Boolean).join(" · ");
        else if (row.key === "time") text = time;
        else if (row.key === "orderNumber") text = `${row.label} #${value}`.trim();
        else text = row.label.trim() ? `${row.label}: ${value}` : value;
        blocks.push({ kind: "text", sectionId: id, text, align: section.align, size: row.key === "orderNumber" ? "md" : "sm", bold: row.key === "orderNumber" });
      }
      return blocks;
    }
    case "customer": {
      const values: Record<string, string | null> = {
        name: data.customer.name,
        phone: data.customer.phone,
        email: data.customer.email,
        address: data.customer.address,
        gstin: data.customer.gstin,
        loyalty: data.customer.loyalty,
      };
      return section.rows
        .filter((row) => row.show && values[row.key])
        .map((row) => ({ kind: "row", sectionId: id, left: row.label, right: values[row.key]!, size: "sm", bold: false }));
    }
    case "items":
      return itemBlocks(section, data);
    case "discounts": {
      const amounts: Record<string, string> = { item: data.discounts.item, coupon: data.discounts.coupon, promotion: data.discounts.promotion, loyalty: data.discounts.loyalty, manual: data.discounts.manual, total: data.discountTotal };
      return section.rows
        .filter((row) => row.show && amounts[row.key] && !isZero(amounts[row.key]!))
        .map((row) => ({
          kind: "row",
          sectionId: id,
          left: (row.key === "coupon" || row.key === "promotion") && data.discounts.code ? data.discounts.code : row.label,
          right: negative(amounts[row.key]!),
          size: "md",
          bold: row.key === "total",
        }));
    }
    case "taxes":
      return data.taxes
        .filter((tax) => !isZero(tax.amount))
        .flatMap((tax) => {
          const row = section.rows.find((candidate) => candidate.key === tax.key);
          if (row && !row.show) return [];
          const label = row?.label || tax.name;
          return [{ kind: "row" as const, sectionId: id, left: section.showRate ? `${label} ${formatBps(tax.rateBps, tax.rateBps % 100 === 0 ? 0 : 1)}` : label, right: money(tax.amount), size: "md" as const, bold: false }];
        });
    case "charges":
      return data.charges
        .filter((charge) => !isZero(charge.amount))
        .flatMap((charge) => {
          const row = section.rows.find((candidate) => candidate.key === charge.key);
          if (row && !row.show) return [];
          return [{ kind: "row" as const, sectionId: id, left: row?.label || charge.key, right: money(charge.amount), size: "md" as const, bold: false }];
        });
    case "total": {
      const amounts: Record<string, string> = { subtotal: data.subtotal, discount: data.discountTotal, taxes: data.taxTotal, charges: data.chargesTotal, rounding: data.rounding, grand: data.grandTotal };
      const blocks: Block[] = [];
      for (const row of section.rows) {
        if (!row.show) continue;
        const amount = amounts[row.key];
        if (amount === undefined) continue;
        if (row.key !== "subtotal" && row.key !== "grand" && isZero(amount)) continue;
        if (row.key === "grand") blocks.push({ kind: "rule", sectionId: id });
        blocks.push({
          kind: "row",
          sectionId: id,
          left: row.label,
          right: row.key === "discount" ? negative(amount) : money(amount),
          size: row.key === "grand" ? "lg" : "md",
          bold: row.key === "grand",
        });
      }
      return blocks;
    }
    case "payment": {
      if (!data.payment) return [];
      const values: Record<string, string | null> = {
        method: data.payment.method,
        paid: data.payment.paid ? money(data.payment.paid) : null,
        change: data.payment.change && !isZero(data.payment.change) ? money(data.payment.change) : null,
        status: data.payment.status,
        reference: data.payment.reference,
      };
      return section.rows.filter((row) => row.show && values[row.key]).map((row) => ({ kind: "row", sectionId: id, left: row.label, right: values[row.key]!, size: "md", bold: row.key === "method" }));
    }
    case "paymentQr": {
      if (!section.url) return [];
      const blocks: Block[] = [{ kind: "space", sectionId: id, lines: 1 }];
      if (section.textAbove.trim()) blocks.push({ kind: "text", sectionId: id, text: section.textAbove, align: section.align, size: "md", bold: true });
      blocks.push({ kind: "image", sectionId: id, url: section.url, widthPct: IMAGE_WIDTH_PCT[section.size], align: section.align, alt: "Payment QR" });
      if (section.textBelow.trim()) blocks.push({ kind: "text", sectionId: id, text: section.textBelow, align: section.align, size: "sm", bold: false });
      blocks.push({ kind: "space", sectionId: id, lines: 1 });
      return blocks;
    }
    case "otherQrs":
      return section.codes
        .filter((code) => code.show && code.url)
        .flatMap<Block>((code) => [
          { kind: "space", sectionId: id, lines: 1 },
          { kind: "text", sectionId: id, text: code.label, align: section.align, size: "sm", bold: true },
          { kind: "image", sectionId: id, url: code.url!, widthPct: IMAGE_WIDTH_PCT[section.size], align: section.align, alt: code.label },
        ]);
  }
}

/**
 * The whole receipt, top to bottom, in the template's own section order.
 * Hidden sections and sections with nothing to show produce nothing — and
 * no divider, so the roll never prints two rules in a row.
 */
export function renderReceipt(template: ReceiptTemplate, data: ReceiptData): readonly Block[] {
  const out: Block[] = [];
  let lastWasRule = true;
  const dividerAfter = new Set(["restaurant", "order", "customer", "items", "charges", "total", "payment"]);

  for (const section of template.sections) {
    if (!section.visible) continue;
    const blocks = sectionBlocks(section, data);
    if (blocks.length === 0) continue;
    out.push(...blocks);
    lastWasRule = false;
    if (template.divider !== "none" && dividerAfter.has(section.kind)) {
      out.push({ kind: "rule", sectionId: section.id });
      lastWasRule = true;
    }
  }
  // A trailing rule after the footer is a wasted line of paper.
  if (lastWasRule && out.length > 0 && out[out.length - 1]?.kind === "rule") out.pop();
  return out;
}

/** The section ids that produced at least one block — what the editor can point at in the preview. */
export function renderedSectionIds(blocks: readonly Block[]): ReadonlySet<string> {
  return new Set(blocks.map((block) => block.sectionId));
}
