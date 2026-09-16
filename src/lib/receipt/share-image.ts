import { toCanvas } from "html-to-image";

/**
 * Rasterises a DOM node into a JPEG `File`, entirely client-side — no
 * upload, no server round-trip. `html-to-image`'s `toCanvas` does the DOM
 * capture (fonts, gradients, the logo `<img>`); the JPEG encode itself uses
 * the browser's own `canvas.toBlob`, which `toCanvas` doesn't expose
 * quality/format control over on its own.
 *
 * `pixelRatio: 2` so the result stays sharp on a phone screen even though
 * the receipt itself renders at CSS pixel density; `backgroundColor` fills
 * where the DOM has none, since JPEG has no alpha channel.
 */
export async function renderElementToJpegFile(node: HTMLElement, filename: string): Promise<File> {
  const canvas = await toCanvas(node, { pixelRatio: 2, backgroundColor: "#FBF8F1", cacheBust: true });
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Could not create the invoice image."))), "image/jpeg", 0.92);
  });
  return new File([blob], filename, { type: "image/jpeg" });
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
