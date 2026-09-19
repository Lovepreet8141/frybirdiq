import type { ShopOrderingState } from "./shop-hours";

/**
 * Runs a status read and turns any failure into null.
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
): Promise<ShopOrderingState | null> {
  try {
    return await read();
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
    log(`ordering status read failed; showing no banner and leaving the server gate to decide (${detail})`);
    return null;
  }
}
