import { describe, expect, it } from "vitest";
import { sampleReceipt } from "@/lib/receipt/data";
import { defaultTemplate } from "@/lib/receipt/template";
import { EscPosReceiptBuilder, type MonoBitmap, base64ToBytes, blocksToEscPos, bytesToBase64, fitBitmap, receiptToEscPos, testTicket, transliterate, wrap } from "./escpos";

const seed = { name: "FRYBIRD", address1: "Sector 9", address2: null, city: "Ambala City", state: "Haryana", pin: null, phone: null, gstin: null };
/** The printable text of a byte stream, with every ESC/POS command (and raster/QR payload) skipped. */
const ascii = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const byte = bytes[i]!;
    if (byte === 0x1b) {
      i += bytes[i + 1] === 0x40 ? 2 : 3;
      continue;
    }
    if (byte === 0x1d) {
      const command = bytes[i + 1];
      if (command === 0x21) i += 3;
      else if (command === 0x56) i += 4;
      else if (command === 0x76) {
        const widthBytes = bytes[i + 4]! + bytes[i + 5]! * 256;
        const height = bytes[i + 6]! + bytes[i + 7]! * 256;
        i += 8 + widthBytes * height;
      } else if (command === 0x28) i += 3 + bytes[i + 3]! + bytes[i + 4]! * 256;
      else i += 2;
      continue;
    }
    if (byte === 0x0a) out += "\n";
    else if (byte >= 0x20 && byte < 0x7f) out += String.fromCharCode(byte);
    i += 1;
  }
  return out;
};
const has = (bytes: Uint8Array, sequence: number[]) => {
  outer: for (let i = 0; i <= bytes.length - sequence.length; i++) {
    for (let j = 0; j < sequence.length; j++) if (bytes[i + j] !== sequence[j]) continue outer;
    return true;
  }
  return false;
};

describe("transliterate / wrap", () => {
  it("spells out what a thermal head cannot draw", () => {
    expect(transliterate("₹1,234 × 2 − ₹50 · café")).toBe("Rs.1,234 x 2 - Rs.50 - cafe");
    expect(transliterate("Peri Peri 🍗")).toBe("Peri Peri ?");
  });

  it("wraps at the column width and breaks over-long words", () => {
    expect(wrap("Nashville Hot Chicken Sandwich with Extra Crispy Coating", 20)).toEqual(["Nashville Hot", "Chicken Sandwich", "with Extra Crispy", "Coating"]);
    expect(wrap("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 10)).toEqual(["ABCDEFGHIJ", "KLMNOPQRST", "UVWXYZ"]);
    expect(wrap("", 10)).toEqual([""]);
  });
});

describe("EscPosReceiptBuilder", () => {
  it("starts with ESC @ and ends with a cut", () => {
    const bytes = new EscPosReceiptBuilder({ paperWidthMm: 80 }).initialize().text("hi").feed(3).cut().build();
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]);
    expect(Array.from(bytes.slice(-4))).toEqual([0x1d, 0x56, 66, 3]);
    expect(has(bytes, [0x1b, 0x64, 3])).toBe(true);
  });

  it("knows its columns: 48 on 80 mm Font A, 64 Font B, 24 double, 32 on 58 mm", () => {
    const wide = new EscPosReceiptBuilder({ paperWidthMm: 80 });
    expect(wide.columns).toBe(48);
    wide.size("sm");
    expect(wide.columns).toBe(64);
    wide.size("lg");
    expect(wide.columns).toBe(24);
    expect(new EscPosReceiptBuilder({ paperWidthMm: 58 }).columns).toBe(32);
  });

  it("lays out two columns flush to both edges and wraps the left", () => {
    const text = ascii(new EscPosReceiptBuilder({ paperWidthMm: 80 }).initialize().columnsRow("Classic Burger", "₹299").build());
    const line = text.split("\n")[0]!;
    expect(line.length).toBe(48);
    expect(line.startsWith("Classic Burger")).toBe(true);
    expect(line.endsWith("Rs.299")).toBe(true);
    const long = ascii(new EscPosReceiptBuilder({ paperWidthMm: 80 }).initialize().columnsRow("Family Feast Party Box for 6 with Assorted Dips and Drinks", "₹1,299").build()).split("\n");
    expect(long[0]!.length).toBe(48);
    expect(long[0]!.endsWith("Rs.1,299")).toBe(true);
    expect(long.length).toBeGreaterThan(2);
  });

  it("emits alignment, bold and size commands", () => {
    const bytes = new EscPosReceiptBuilder({ paperWidthMm: 80 }).initialize().align("center").bold(true).size("lg").build();
    expect(has(bytes, [0x1b, 0x61, 1])).toBe(true);
    expect(has(bytes, [0x1b, 0x45, 1])).toBe(true);
    expect(has(bytes, [0x1d, 0x21, 0x11])).toBe(true);
  });

  it("packs a raster image one bit per dot, MSB first", () => {
    const bitmap: MonoBitmap = { width: 10, height: 2, bits: Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) };
    const bytes = new EscPosReceiptBuilder({ paperWidthMm: 80 }).image(bitmap).build();
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x1d, 0x76, 0x30, 0, 2, 0, 2, 0]);
    expect(Array.from(bytes.slice(8, 12))).toEqual([0x80, 0xc0, 0x00, 0x00]);
  });

  it("emits the QR code command set", () => {
    const bytes = new EscPosReceiptBuilder({ paperWidthMm: 80 }).qrCode("https://frybirdiq.tech", 6).build();
    expect(has(bytes, [0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6])).toBe(true);
    expect(has(bytes, [0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30])).toBe(true);
    expect(has(bytes, Array.from("https://frybirdiq.tech", (char) => char.charCodeAt(0)))).toBe(true);
  });
});

describe("fitBitmap", () => {
  it("scales to the requested width keeping the aspect ratio", () => {
    const bits = new Uint8Array(100 * 50).fill(1);
    const fitted = fitBitmap({ width: 100, height: 50, bits }, 300);
    expect(fitted.width).toBe(300);
    expect(fitted.height).toBe(150);
    expect(fitted.bits[0]).toBe(1);
  });
});

describe("receiptToEscPos — the designer's template on paper", () => {
  const template = defaultTemplate(seed);

  it("prints every section the renderer produces, in order, and cuts", () => {
    const bytes = receiptToEscPos(template, sampleReceipt("normal"), { paperWidthMm: 80 });
    const text = ascii(bytes);
    expect(text.indexOf("FRYBIRD")).toBeLessThan(text.indexOf("ORDER #042"));
    expect(text.indexOf("ORDER #042")).toBeLessThan(text.indexOf("Classic Burger"));
    expect(text).toContain("FRYBIRD10");
    expect(text).toContain("-Rs.50");
    expect(text).toContain("TOTAL");
    expect(text).toContain("Rs.427");
    expect(text).toContain("Thank you for visiting FRYBIRD!");
    expect(Array.from(bytes.slice(-4))).toEqual([0x1d, 0x56, 66, 3]);
  });

  it("a hidden section is absent from the bytes", () => {
    const noFooter = { ...template, sections: template.sections.map((section) => (section.kind === "footer" ? { ...section, visible: false } : section)) };
    expect(ascii(receiptToEscPos(noFooter, sampleReceipt("small"), { paperWidthMm: 80 }))).not.toContain("Thank you");
  });

  it("handles a large order with long names and modifiers on 48 columns", () => {
    const lines = ascii(receiptToEscPos(template, sampleReceipt("large"), { paperWidthMm: 80 })).split("\n");
    expect(lines.every((line) => line.length <= 64)).toBe(true);
    expect(lines.some((line) => line.includes("Extra Cheese"))).toBe(true);
    expect(lines.some((line) => line.includes("Family Feast"))).toBe(true);
    expect(lines.some((line) => line.includes("Change") && line.endsWith("Rs.73"))).toBe(true);
  });

  it("prints an uploaded image as raster when the bitmap is supplied, and its caption when not", () => {
    const withQr = { ...template, sections: template.sections.map((section) => (section.kind === "paymentQr" ? { ...section, visible: true, url: "https://example.com/qr.png" } : section)) };
    const bitmap: MonoBitmap = { width: 16, height: 16, bits: new Uint8Array(256).fill(1) };
    const printed = blocksToEscPos([{ kind: "image", sectionId: "paymentQr", url: "https://example.com/qr.png", widthPct: 55, align: "center", alt: "Payment QR" }], "dashed", { paperWidthMm: 80, images: { get: () => bitmap } });
    expect(has(printed, [0x1d, 0x76, 0x30, 0])).toBe(true);
    const missing = receiptToEscPos(withQr, sampleReceipt("small"), { paperWidthMm: 80 });
    expect(ascii(missing)).toContain("[Payment QR]");
    expect(has(missing, [0x1d, 0x76, 0x30, 0])).toBe(false);
  });

  it("58 mm narrows the columns", () => {
    const lines = ascii(receiptToEscPos({ ...template, paperWidthMm: 58 }, sampleReceipt("normal"), { paperWidthMm: 58 })).split("\n");
    expect(lines.some((line) => line.length === 32)).toBe(true);
    expect(lines.every((line) => line.length <= 42)).toBe(true);
  });
});

describe("test ticket and base64", () => {
  it("builds a test ticket that names the printer and device", () => {
    const text = ascii(testTicket({ shopName: "FRYBIRD", deviceName: "Redmi Pad", printerName: "POSIFLOW KPC307-UEWB", at: new Date("2026-09-13T09:00:00Z"), paperWidthMm: 80 }));
    expect(text).toContain("POSIFLOW KPC307-UEWB");
    expect(text).toContain("Redmi Pad");
    expect(text).toContain("576 dots");
  });

  it("round-trips bytes through base64", () => {
    const bytes = Uint8Array.from([0, 1, 2, 27, 64, 255, 10]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });
});
