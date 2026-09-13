/**
 * ESC/POS for an 80 mm roll — what actually goes down the socket.
 *
 * `EscPosReceiptBuilder` turns text, rows, rules, images and QR codes into
 * printer bytes; `receiptToEscPos` feeds it the blocks the Bill & Receipt
 * designer's renderer already produces, so the paper shows the same
 * design as the preview and the POS print. No HTML, no PDF, no
 * screenshots — the printer receives commands.
 *
 * Widths: 80 mm = 576 dots. Font A is 12 dots wide (48 columns), Font B 9
 * dots (64 columns), double-size Font A 24 columns. 58 mm = 384 dots (32 /
 * 42 / 16). Pure; tested.
 */

import type { ReceiptData } from "@/lib/receipt/data";
import { type Block, renderReceipt } from "@/lib/receipt/render";
import type { Align, ReceiptTemplate, TextSize } from "@/lib/receipt/template";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type PaperWidth = 58 | 80;

/** A 1-bit image: `bits[y * width + x]` is 1 for a black dot. */
export interface MonoBitmap {
  readonly width: number;
  readonly height: number;
  readonly bits: Uint8Array;
}

export interface BuilderOptions {
  readonly paperWidthMm: PaperWidth;
}

const DOTS: Record<PaperWidth, number> = { 80: 576, 58: 384 };

/** Characters a thermal head in its default code page cannot draw, replaced with what it can. */
const TRANSLITERATE: Record<string, string> = {
  "₹": "Rs.",
  "−": "-",
  "–": "-",
  "—": "-",
  "×": "x",
  "·": "-",
  "•": "*",
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  " ": " ",
  "✓": "OK",
  "★": "*",
};

/** Text as the printer will draw it: ASCII, with a few known glyphs spelled out. */
export function transliterate(text: string): string {
  let out = "";
  for (const char of text) {
    const mapped = TRANSLITERATE[char];
    if (mapped !== undefined) out += mapped;
    else if (char.charCodeAt(0) < 0x80) out += char;
    else {
      const stripped = char.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += stripped.charCodeAt(0) < 0x80 ? stripped : "?";
    }
  }
  return out;
}

/** Word-wrap to `width` columns; a word longer than a line is broken. */
export function wrap(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      while (rest.length > width) {
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

export class EscPosReceiptBuilder {
  private readonly chunks: number[] = [];
  private readonly dots: number;
  private font: "A" | "B" = "A";
  private double = false;

  constructor(private readonly options: BuilderOptions) {
    this.dots = DOTS[options.paperWidthMm];
  }

  /** Columns available at the current font and size. */
  get columns(): number {
    const charWidth = (this.font === "A" ? 12 : 9) * (this.double ? 2 : 1);
    return Math.floor(this.dots / charWidth);
  }

  private push(...bytes: number[]): this {
    this.chunks.push(...bytes);
    return this;
  }

  private ascii(text: string): this {
    for (const char of transliterate(text)) this.chunks.push(char.charCodeAt(0) & 0x7f);
    return this;
  }

  /** ESC @ — reset the printer to its defaults. Always first. */
  initialize(): this {
    this.font = "A";
    this.double = false;
    return this.push(ESC, 0x40);
  }

  align(align: Align): this {
    return this.push(ESC, 0x61, align === "center" ? 1 : align === "right" ? 2 : 0);
  }

  bold(on: boolean): this {
    return this.push(ESC, 0x45, on ? 1 : 0);
  }

  /** Small = Font B, normal = Font A, large = Font A double width and height. */
  size(size: TextSize): this {
    this.font = size === "sm" ? "B" : "A";
    this.double = size === "lg";
    this.push(ESC, 0x4d, this.font === "B" ? 1 : 0);
    return this.push(GS, 0x21, this.double ? 0x11 : 0x00);
  }

  /** One line of text, wrapped to the paper. */
  text(text: string): this {
    for (const line of wrap(transliterate(text), this.columns)) this.ascii(line).push(LF);
    return this;
  }

  /** A blank line. */
  line(): this {
    return this.push(LF);
  }

  /** Two columns: left text wraps, right text stays on the first line, flush right. */
  columnsRow(left: string, right: string, indent = 0): this {
    const width = this.columns;
    const rightText = transliterate(right);
    const pad = " ".repeat(Math.min(indent, 4));
    const leftWidth = Math.max(1, width - rightText.length - (rightText ? 1 : 0) - pad.length);
    const lines = wrap(transliterate(left), leftWidth);
    lines.forEach((line, index) => {
      const body = pad + line;
      if (index === 0 && rightText) {
        const gap = Math.max(1, width - body.length - rightText.length);
        this.ascii(body + " ".repeat(gap) + rightText).push(LF);
      } else this.ascii(body).push(LF);
    });
    return this;
  }

  /** A rule the full width of the paper. */
  rule(style: "dashed" | "solid" = "dashed"): this {
    return this.ascii((style === "solid" ? "_" : "-").repeat(this.columns)).push(LF);
  }

  /** Paper feed, n lines. */
  feed(lines = 1): this {
    return this.push(ESC, 0x64, Math.max(0, Math.min(255, lines)));
  }

  /** GS V 66 — partial cut after feeding clear of the blade. */
  cut(): this {
    return this.push(GS, 0x56, 66, 3);
  }

  /**
   * GS v 0 — raster bit image. The bitmap must already be no wider than the
   * paper; `fitBitmap` does that. Printed at the current alignment.
   */
  image(bitmap: MonoBitmap): this {
    const widthBytes = Math.ceil(bitmap.width / 8);
    const height = bitmap.height;
    this.push(GS, 0x76, 0x30, 0, widthBytes & 0xff, (widthBytes >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff);
    for (let y = 0; y < height; y++) {
      for (let byteIndex = 0; byteIndex < widthBytes; byteIndex++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = byteIndex * 8 + bit;
          if (x < bitmap.width && bitmap.bits[y * bitmap.width + x]) byte |= 0x80 >> bit;
        }
        this.chunks.push(byte);
      }
    }
    return this.push(LF);
  }

  /** GS ( k — the printer draws the QR itself. `moduleSize` 1–16 dots. */
  qrCode(text: string, moduleSize = 6): this {
    const data = transliterate(text);
    const length = data.length + 3;
    this.push(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 50, 0); // model 2
    this.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, Math.max(1, Math.min(16, moduleSize))); // module size
    this.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 49); // error correction M
    this.push(GS, 0x28, 0x6b, length & 0xff, (length >> 8) & 0xff, 0x31, 0x50, 0x30); // store
    this.ascii(data);
    this.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30); // print
    return this.push(LF);
  }

  /** The bytes so far. */
  build(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }

  get dotsPerLine(): number {
    return this.dots;
  }
}

/* ------------------------------------------------------------------ */
/* Receipt → bytes                                                     */
/* ------------------------------------------------------------------ */

/** Nearest-neighbour scale so the image is `targetWidth` dots wide. */
export function fitBitmap(bitmap: MonoBitmap, targetWidth: number): MonoBitmap {
  const width = Math.max(8, Math.min(targetWidth, bitmap.width === 0 ? 8 : Math.round(targetWidth)));
  if (bitmap.width === width) return bitmap;
  const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
  const bits = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(bitmap.height - 1, Math.floor((y * bitmap.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(bitmap.width - 1, Math.floor((x * bitmap.width) / width));
      bits[y * width + x] = bitmap.bits[sy * bitmap.width + sx] ?? 0;
    }
  }
  return { width, height, bits };
}

export interface ReceiptImages {
  /** Bitmaps by the URL the template stores; a missing entry prints as its caption only. */
  get(url: string): MonoBitmap | undefined;
}

export interface EscPosReceiptOptions {
  readonly paperWidthMm: PaperWidth;
  readonly images?: ReceiptImages;
  /** Feed lines before the cut, so the last line clears the tear bar. */
  readonly feedBeforeCut?: number;
}

/** Bytes for the blocks the designer's renderer produced. */
export function blocksToEscPos(blocks: readonly Block[], divider: ReceiptTemplate["divider"], options: EscPosReceiptOptions): Uint8Array {
  const builder = new EscPosReceiptBuilder({ paperWidthMm: options.paperWidthMm });
  builder.initialize().align("left").size("md").bold(false);
  let currentAlign: Align = "left";
  const setAlign = (align: Align) => {
    if (align !== currentAlign) {
      builder.align(align);
      currentAlign = align;
    }
  };

  for (const block of blocks) {
    switch (block.kind) {
      case "text":
        setAlign(block.align);
        builder.size(block.size).bold(block.bold).text(block.text || " ");
        break;
      case "row":
        setAlign("left");
        builder.size(block.size).bold(block.bold).columnsRow(block.left, block.right, block.indent ? 2 : 0);
        break;
      case "rule":
        if (divider === "none") break;
        setAlign("left");
        builder.size("md").bold(false).rule(divider);
        break;
      case "space":
        for (let i = 0; i < block.lines; i++) builder.line();
        break;
      case "image": {
        const bitmap = options.images?.get(block.url);
        setAlign(block.align);
        if (bitmap) builder.image(fitBitmap(bitmap, Math.floor((builder.dotsPerLine * block.widthPct) / 100)));
        else builder.size("sm").bold(false).text(`[${block.alt}]`);
        break;
      }
    }
  }

  builder.size("md").bold(false).align("left");
  builder.feed(options.feedBeforeCut ?? 4).cut();
  return builder.build();
}

/** Order + the applied design → ESC/POS. The same renderer the preview and POS print use. */
export function receiptToEscPos(template: ReceiptTemplate, data: ReceiptData, options: EscPosReceiptOptions): Uint8Array {
  return blocksToEscPos(renderReceipt(template, data), template.divider, options);
}

/** A short ticket that proves the bytes reach the paper. No order involved. */
export function testTicket(input: { shopName: string; deviceName: string; printerName: string; at: Date; paperWidthMm: PaperWidth }): Uint8Array {
  const builder = new EscPosReceiptBuilder({ paperWidthMm: input.paperWidthMm });
  builder.initialize().align("center").size("lg").bold(true).text(input.shopName);
  builder.size("md").bold(false).text("FRYBIRD IQ test print").line();
  builder.align("left").rule("dashed");
  builder.columnsRow("Printer", input.printerName);
  builder.columnsRow("From", input.deviceName);
  builder.columnsRow("Paper", `${input.paperWidthMm} mm / ${builder.dotsPerLine} dots`);
  builder.columnsRow("Time", input.at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }));
  builder.rule("dashed");
  builder.size("sm").text("Small font: the quick brown fox jumps over the lazy dog 0123456789");
  builder.size("md").text("Normal font: Rs.1,234.50 x 2 = Rs.2,469");
  builder.size("lg").bold(true).text("LARGE");
  builder.size("md").bold(false).align("center").line().text("If you can read this, the printer is ready.");
  builder.feed(4).cut();
  return builder.build();
}

/* ------------------------------------------------------------------ */
/* Byte helpers                                                        */
/* ------------------------------------------------------------------ */

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(base64, "base64"));
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
