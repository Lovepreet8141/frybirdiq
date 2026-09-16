import { type InventoryFormState } from "@/lib/inventory/actions";

/**
 * Whether a stock-write form's idempotency key should rotate, given the
 * status of a genuinely new, just-settled state object.
 *
 * Pulled out of `useIdempotencyKey` (`src/components/inventory/
 * stock-forms.tsx`) so the one real decision in that hook — settled or
 * not — is a plain function a test can drive directly, rather than only
 * verifiable by rendering the component.
 *
 * Deliberately takes only the new status, not a comparison against the
 * previous one: `useActionState` returns a fresh object on every
 * resolution, even when two different, genuinely separate outcomes share
 * the same status string (a manager recording a second, unrelated
 * delivery right after a first one both settle as `"success"`). The
 * hook is what tells "a fresh object arrived" from "still the same
 * object, re-rendered for an unrelated reason" — by reference, not by
 * this status value — and calls this only when that's already true. A
 * status-string comparison alone would silently fail to rotate for a
 * second, third, fourth... same-status delivery in a row, which is
 * exactly the ordinary way these forms get used.
 */
export function isSettledFormStatus(status: InventoryFormState["status"]): boolean {
  return status === "success" || status === "error";
}
