import type { CompleteDeliveryActionResult } from "@/lib/auth/staff-actions";

export type CloseOutcome =
  | { kind: "ok" }
  | { kind: "closed-elsewhere" }
  | { kind: "offline" }
  | { kind: "error"; message: string };

/**
 * `CompleteDeliveryActionResult` is a type-only import — erased at compile
 * time, so it adds no runtime import of `staff-actions.ts` (a "use server"
 * module whose graph is `server-only`-guarded and only resolves under
 * Next's own runtime). A value import of that module would break this file
 * and its test under plain `vitest run`.
 *
 * `completeDeliveryAction` now always resolves, even on a server exception
 * (code `SERVER_ERROR`, logged server-side) — a rejected promise here means
 * the request never reached or returned from the server at all: offline, or
 * a stale tab. `ALREADY_CLOSED` is `completeDelivery`'s own code for the
 * lost race, another device closing the order first; every other code is a
 * real refusal, shown as-is.
 */
export function classifyCloseResult(
  outcome: { thrown: true } | { thrown: false; result: CompleteDeliveryActionResult },
): CloseOutcome {
  if (outcome.thrown) return { kind: "offline" };
  const { result } = outcome;
  if (result.ok) return { kind: "ok" };
  if (result.code === "ALREADY_CLOSED") return { kind: "closed-elsewhere" };
  return { kind: "error", message: result.error };
}
