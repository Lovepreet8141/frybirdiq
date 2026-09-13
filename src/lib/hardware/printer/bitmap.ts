/**
 * Browser-only: an uploaded logo or QR image → a 1-bit bitmap for the
 * raster command. Runs on the device that prints, never on the server.
 * Threshold on luminance; the designer already previews images in
 * greyscale, so what the owner saw is what the head burns.
 */

import type { MonoBitmap } from "./escpos";

export async function loadMonoBitmap(url: string, targetWidth: number): Promise<MonoBitmap | null> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return null;
  try {
    const response = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!response.ok) return null;
    const image = await createImageBitmap(await response.blob());
    const width = Math.max(8, Math.min(targetWidth, image.width));
    const height = Math.max(1, Math.round((image.height * width) / image.width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    const bits = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < bits.length; i++, p += 4) {
      const alpha = (data[p + 3] ?? 255) / 255;
      const luminance = (0.299 * (data[p] ?? 255) + 0.587 * (data[p + 1] ?? 255) + 0.114 * (data[p + 2] ?? 255)) * alpha + 255 * (1 - alpha);
      bits[i] = luminance < 140 ? 1 : 0;
    }
    return { width, height, bits };
  } catch {
    return null;
  }
}

/** Every image the template needs, resolved on this device. Missing ones print as captions. */
export async function loadReceiptImages(urls: readonly string[], dotsPerLine: number): Promise<Map<string, MonoBitmap>> {
  const out = new Map<string, MonoBitmap>();
  await Promise.all(
    [...new Set(urls)].map(async (url) => {
      const bitmap = await loadMonoBitmap(url, dotsPerLine);
      if (bitmap) out.set(url, bitmap);
    }),
  );
  return out;
}
