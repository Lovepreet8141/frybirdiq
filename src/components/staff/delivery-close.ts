/**
 * `completeDelivery` (src/lib/repositories/orders.ts) returns this exact
 * string when the order was already COMPLETED by the time it re-read the
 * row — the lost-race case where another device closed it first. It is the
 * only literal the server guarantees for that case, so this is the one
 * place that couples to it; treat it as "closed elsewhere", not a failure.
 */
const ALREADY_CLOSED_ERROR = "That delivery is already closed.";

export type CloseOutcome =
  | { kind: "ok" }
  | { kind: "closed-elsewhere" }
  | { kind: "offline" }
  | { kind: "error"; message: string };

/**
 * The shape `classifyCloseResult` needs from `completeDeliveryAction`'s
 * result — spelled out structurally, not imported from `staff-actions.ts`,
 * so this file (and its test) never pulls in that "use server" module
 * graph. Importing it would fail outside Next's own runtime: server actions
 * transitively import `server-only`-guarded code that only resolves under
 * Next's "react-server" condition, which plain `vitest run` does not have.
 */
export interface CloseActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * Turns what `completeDeliveryAction` gave back — or the fact that calling
 * it threw at all — into one of the states the delivery card can show. A
 * thrown error only ever means the request never reached (or returned
 * from) the server, since the action itself catches every server-side
 * failure and always resolves normally.
 */
export function classifyCloseResult(outcome: { thrown: true } | { thrown: false; result: CloseActionResult }): CloseOutcome {
  if (outcome.thrown) return { kind: "offline" };
  const { result } = outcome;
  if (result.ok) return { kind: "ok" };
  if (result.error === ALREADY_CLOSED_ERROR) return { kind: "closed-elsewhere" };
  return { kind: "error", message: result.error ?? "That didn't work." };
}
