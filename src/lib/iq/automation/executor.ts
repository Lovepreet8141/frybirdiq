/**
 * The executor contract — types only; executors arrive with IQ-5.
 *
 * RELIABILITY review of d250328, conditions C4 and C5. An executor must not
 * be able to repeat a side effect after a crash:
 *
 * - `execute` runs inside the SAME transaction as the EXECUTING → SUCCEEDED
 *   compare-and-set. If the transaction rolls back, the effect rolls back with
 *   it, so a retry after FAILED can never find half a draft PO behind it.
 * - Its writes are keyed on `actionId` (for example a draft PO row with a
 *   UNIQUE source_action_id), so even a second call inside a retry is a no-op.
 * - `undo` runs inside the SAME transaction as SUCCEEDED → UNDONE, and checks
 *   that the target still matches `after` before reverting — if someone
 *   changed it since, it refuses rather than overwrite their change. There is
 *   therefore no UNDOING or UNDO_FAILED status.
 *
 * Only executable kinds can have an executor: A3 kinds are excluded by type.
 */
import type { ExecutableActionKind } from "./catalog";

export type ExecutionInput<K extends ExecutableActionKind> = {
  readonly actionId: string;
  readonly orgId: string;
  readonly locationId: string | null;
  readonly kind: K;
  readonly params: unknown;
};

/** Scalar snapshots, matching the AUTOMATION claim's before/after. */
export type ExecutionEffect = {
  readonly before: Readonly<Record<string, string | number | boolean | null>>;
  readonly after: Readonly<Record<string, string | number | boolean | null>>;
};

export interface ActionExecutor<K extends ExecutableActionKind, Tx> {
  readonly kind: K;
  execute(tx: Tx, input: ExecutionInput<K>): Promise<ExecutionEffect>;
  undo?(tx: Tx, input: ExecutionInput<K> & { readonly effect: ExecutionEffect }): Promise<"UNDONE" | "TARGET_CHANGED">;
}
