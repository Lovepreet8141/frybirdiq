import { toCanvas } from "html-to-image";
import { bytesToBase64 } from "@/lib/hardware/printer/escpos";

export interface RenderedImage {
  readonly file: File;
  /** The captured canvas's own pixel dimensions — surfaced so a broken/blank/zero-size capture is visible, not just assumed good because the promise resolved. */
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

export interface RenderOptions {
  readonly pixelRatio: number;
  readonly format: "image/jpeg" | "image/png";
  readonly quality?: number;
}

/**
 * Rasterises a DOM node into an image `File`, entirely client-side — no
 * upload, no server round-trip. `html-to-image`'s `toCanvas` does the DOM
 * capture (fonts, gradients, the logo `<img>`); the encode itself uses the
 * browser's own `canvas.toBlob`, which `toCanvas` doesn't expose
 * quality/format control over on its own.
 *
 * Parameterised (pixelRatio/format) so the diagnostic panel can generate
 * comparison variants of the *same real DOM node* — same investigation this
 * exists for, not a second implementation. `backgroundColor` fills where
 * the DOM has none, since JPEG has no alpha channel; harmless for PNG too.
 */
export async function renderElementToImageFile(
  node: HTMLElement,
  filename: string,
  { pixelRatio, format, quality = 0.92 }: RenderOptions,
): Promise<RenderedImage> {
  const canvas = await toCanvas(node, { pixelRatio, backgroundColor: "#FBF8F1", cacheBust: true });
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Could not create the image."))), format, quality);
  });
  return { file: new File([blob], filename, { type: format }), canvasWidth: canvas.width, canvasHeight: canvas.height };
}

/**
 * The exact call the real "Send on WhatsApp" button uses — pixelRatio 2,
 * JPEG 0.92 — unchanged from before this investigation. A thin wrapper
 * over `renderElementToImageFile` so the production path is provably
 * identical to what shipped in df4d63f, not just "close to" it.
 */
export async function renderElementToJpegFile(node: HTMLElement, filename: string): Promise<RenderedImage> {
  return renderElementToImageFile(node, filename, { pixelRatio: 2, format: "image/jpeg", quality: 0.92 });
}

/**
 * A tiny, known-good image — drawn directly with 2D-context calls, no DOM
 * capture, no external resources. The control in the investigation: if
 * this shares fine but a `renderElementTo*` output doesn't, the difference
 * is something about the captured file (size, dimensions, encoding), not
 * the Web Share mechanism itself.
 */
export async function makeSyntheticTestFile(format: "image/jpeg" | "image/png", filename: string): Promise<RenderedImage> {
  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 200;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D canvas context.");
  ctx.fillStyle = "#D92B2B";
  ctx.fillRect(0, 0, 200, 200);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 24px sans-serif";
  ctx.fillText("TEST", 55, 105);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("canvas.toBlob returned null."))), format, 0.92);
  });
  return { file: new File([blob], filename, { type: format }), canvasWidth: canvas.width, canvasHeight: canvas.height };
}

/** For handing a `File` to the FRYPOS native share bridge, which speaks base64 — same encoder the printer bridge already uses for ESC/POS bytes, not a second one. */
export async function fileToBase64(file: File): Promise<string> {
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
}

/** Whether this browser can actually share this file via the native share sheet — never assumed from device/UA. */
export function canShareFile(file: File): boolean {
  if (typeof navigator === "undefined" || !navigator.share || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** The user closing the native share sheet without picking anything — not a failure. */
export function isShareCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** A short, real diagnostic string — never a generic "something went wrong" — for the one thing on-screen that can show it. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
