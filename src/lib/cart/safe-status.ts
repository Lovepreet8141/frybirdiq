import type { ShopOrderingState } from "./shop-hours";

/** How long a customer page waits for the status read before showing no banner. */
export const STATUS_READ_TIMEOUT_MS = 2500;

/**
 * Runs a status read and turns any failure, or a read that takes too long, into null.
 *
 * The banner is on every customer page, so a slow or dropped status read must
 * not take those pages down. Null means "unknown": every control fails open
 * (`orderingControls(null)` allows ordering) and the server gate in
 * `placeOrder` still refuses a closed or paused shop. Logs the error's name and
 * message only — never the error object, which can carry connection details.
 */
export async function readStatusSafely(
  read: () => Promise<ShopOrderingState | null>,
  log: (message: string) => void = (message) => console.error(message),
  timeoutMs: number = STATUS_READ_TIMEOUT_MS,
): Promise<ShopOrderingState | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // A hung database read would otherwise hang every customer page: the banner is on all of them. The query itself
    // cannot be cancelled and finishes on its own; the page stops waiting for it.
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const outcome = await Promise.race([read(), timedOut]);
    if (outcome === "timeout") {
      log(`ordering status read timed out after ${timeoutMs} ms; showing no banner and leaving the server gate to decide`);
      return null;
    }
    return outcome;
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
    log(`ordering status read failed; showing no banner and leaving the server gate to decide (${detail})`);
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
