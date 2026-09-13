import { describe, expect, it } from "vitest";
import { sampleReceipt } from "./data";
import { renderReceipt } from "./render";
import { type ItemsSection, type ReceiptTemplate, type Section, defaultTemplate, parseTemplate } from "./template";

const seed = { name: "FRYBIRD", address1: "Sector 9", address2: null, city: "Ambala City", state: "Haryana", pin: null, phone: "98765 43210", gstin: null };
const base = defaultTemplate(seed);
const texts = (template: ReceiptTemplate, size: "small" | "normal" | "large" = "normal") =>
  renderReceipt(template, sampleReceipt(size)).map((block) => (block.kind === "text" ? block.text : block.kind === "row" ? `${block.left} | ${block.right}` : block.kind));
const withSection = (template: ReceiptTemplate, id: string, patch: (section: Section) => Section): ReceiptTemplate => ({
  ...template,
  sections: template.sections.map((section) => (section.id === id ? patch(section) : section)),
});

describe("template", () => {
  it("the default template validates and has every section once", () => {
    expect(parseTemplate(base).ok).toBe(true);
    const kinds = base.sections.map((section) => section.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(base.paperWidthMm).toBe(79);
  });

  it("refuses a template that is not one", () => {
    expect(parseTemplate({ version: 1, paperWidthMm: 80, divider: "dashed", sections: [] }).ok).toBe(false);
    expect(parseTemplate({ ...base, sections: [{ id: "x", kind: "nope" }] }).ok).toBe(false);
  });
});

describe("renderReceipt — configuration, never data", () => {
  it("prints the order's own number under the template's rules", () => {
    const lines = texts(base);
    expect(lines).toContain("ORDER #042");
    expect(lines).toContain("FRYBIRD");
    expect(lines).toContain("Phone: 98765 43210");
    expect(lines).toContain("Order type: Dine-in");
    expect(lines).toContain("Table: T4");
  });

  it("a hidden section disappears entirely, divider included", () => {
    const noOrder = withSection(base, "order", (section) => ({ ...section, visible: false }));
    const lines = texts(noOrder);
    expect(lines).not.toContain("ORDER #042");
    expect(lines.filter((line) => line === "rule").length).toBe(texts(base).filter((line) => line === "rule").length - 1);
  });

  it("follows the template's section order", () => {
    const reordered: ReceiptTemplate = { ...base, sections: [...base.sections].reverse() };
    const lines = texts(reordered);
    expect(lines.indexOf("Thank you for visiting FRYBIRD!")).toBeLessThan(lines.indexOf("ORDER #042"));
  });

  it("labels are the template's, amounts are the order's", () => {
    const relabelled = withSection(base, "total", (section) => (section.kind === "total" ? { ...section, rows: section.rows.map((row) => (row.key === "grand" ? { ...row, label: "Grand Total" } : row.key === "subtotal" ? { ...row, label: "Item Total" } : row)) } : section));
    const lines = texts(relabelled);
    expect(lines).toContain("Item Total | ₹457");
    expect(lines).toContain("Grand Total | ₹427");
  });

  it("a coupon prints under its code, and zero lines never print", () => {
    const lines = texts(base);
    expect(lines).toContain("FRYBIRD10 | −₹50");
    expect(lines.some((line) => line.startsWith("Rounding"))).toBe(false);
    expect(lines).toContain("CGST 2.5% | ₹10");
    const noRate = withSection(base, "taxes", (section) => (section.kind === "taxes" ? { ...section, showRate: false } : section));
    expect(texts(noRate)).toContain("CGST | ₹10");
  });

  it("hidden customer fields are not printed", () => {
    const lines = texts(base);
    expect(lines).toContain("Customer | Yuvraj Singh");
    expect(lines.some((line) => line.includes("70154 86625"))).toBe(false);
    const phone = withSection(base, "customer", (section) => (section.kind === "customer" ? { ...section, rows: section.rows.map((row) => (row.key === "phone" ? { ...row, show: true } : row)) } : section));
    expect(texts(phone)).toContain("Phone | 70154 86625");
  });

  it("item layouts", () => {
    const items = base.sections.find((section) => section.kind === "items") as ItemsSection;
    const compact = withSection(base, "items", () => ({ ...items, layout: "compact" }));
    expect(texts(compact)).toContain("Classic Burger × 1 | ₹299");
    const detailed = texts(base);
    expect(detailed).toContain("Classic Burger");
    expect(detailed).toContain("1 × ₹299 | ₹299");
    const qsr = withSection(base, "items", () => ({ ...items, layout: "qsr" }));
    expect(texts(qsr)).toContain("1  Classic Burger | ₹299");
  });

  it("modifiers, notes and item discounts follow their toggles", () => {
    const large = texts(base, "large");
    expect(large).toContain("Extra Cheese | +₹30");
    expect(large).toContain("Extra Sauce | ");
    expect(large).toContain("Note: No onions, extra napkins please");
    const items = base.sections.find((section) => section.kind === "items") as ItemsSection;
    const quiet = withSection(base, "items", () => ({ ...items, show: { ...items.show, modifiers: false, notes: false } }));
    const lines = texts(quiet, "large");
    expect(lines).not.toContain("Extra Cheese | +₹30");
    expect(lines.some((line) => line.startsWith("Note:"))).toBe(false);
  });

  it("payment, change and charges come from the order", () => {
    const large = texts(base, "large");
    expect(large).toContain("Payment | CASH");
    expect(large).toContain("Change | ₹73");
    expect(large).toContain("Delivery fee | ₹40");
    expect(large).toContain("Packaging | ₹20");
    const small = texts(base, "small");
    expect(small).toContain("Payment | UPI");
    expect(small.some((line) => line.startsWith("Change"))).toBe(false);
  });

  it("images only print when uploaded, with the chosen size", () => {
    expect(renderReceipt(base, sampleReceipt("small")).some((block) => block.kind === "image")).toBe(false);
    const withQr = withSection(base, "paymentQr", (section) => (section.kind === "paymentQr" ? { ...section, visible: true, url: "https://example.com/qr.png", size: "lg" } : section));
    const image = renderReceipt(withQr, sampleReceipt("small")).find((block) => block.kind === "image");
    expect(image && image.kind === "image" && image.widthPct).toBe(80);
    expect(texts(withQr, "small")).toContain("Scan to Pay");
  });

  it("custom text blocks print each line with their style", () => {
    const custom: ReceiptTemplate = { ...base, sections: [...base.sections, { id: "t1", kind: "text", visible: true, text: "NO REFUNDS AFTER PAYMENT\nCheck your order before leaving.", style: { align: "center", size: "sm", bold: true, spaceAbove: 1, spaceBelow: 0 } }] };
    const blocks = renderReceipt(custom, sampleReceipt("small"));
    const found = blocks.filter((block) => block.sectionId === "t1");
    expect(found.map((block) => block.kind)).toEqual(["space", "text", "text"]);
  });
});
