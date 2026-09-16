/**
 * One place for the environment questions the motion code keeps asking.
 * Every helper is safe to call during SSR (it answers conservatively) and
 * cheap enough to call inside an effect.
 */

const query = (value: string) =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(value)
    : null;

/** The reader asked their OS to calm animations down. */
export function reduceMotion(): boolean {
  return query("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

/** A phone or tablet: no hover, or a narrow viewport. */
export function isTouchLayout(): boolean {
  return query("(max-width: 860px), (hover: none) and (pointer: coarse)")?.matches ?? false;
}

/** A real mouse or trackpad, where hover and cursor tracking make sense. */
export function isFinePointer(): boolean {
  return query("(hover: hover) and (pointer: fine)")?.matches ?? false;
}

interface Connection {
  saveData?: boolean;
  effectiveType?: string;
}

/** Data Saver, or a connection too slow to spend megabytes on decoration. */
export function isFrugal(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  if (!connection) return false;
  if (connection.saveData) return true;
  return connection.effectiveType === "slow-2g" || connection.effectiveType === "2g";
}

/**
 * A short buzz for a committed tap. Android honours it; iOS Safari has no
 * vibration API, so this is a no-op there rather than a thrown error.
 */
export function buzz(pattern: number | number[] = 8): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers throw when the document has never been interacted with.
  }
}

/**
 * Lock the page behind an overlay. iOS Safari ignores `overflow: hidden` on
 * the body, so the scroll position is parked and restored by hand.
 */
export function lockScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  const { body } = document;
  const y = window.scrollY;
  const previous = {
    left: body.style.left,
    position: body.style.position,
    right: body.style.right,
    top: body.style.top,
    width: body.style.width,
  };
  body.style.position = "fixed";
  body.style.top = `-${y}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  return () => {
    body.style.position = previous.position;
    body.style.top = previous.top;
    body.style.left = previous.left;
    body.style.right = previous.right;
    body.style.width = previous.width;
    window.scrollTo(0, y);
  };
}
