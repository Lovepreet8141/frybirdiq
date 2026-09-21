/**
 * The idempotency key of one customer-edit submission attempt.
 *
 * The server keys idempotency globally (key + operation, 24 h) and refuses the same key with a different
 * body. So the key must be unique per ATTEMPT: the same for a double-tap or a network retry of the same
 * content (they replay), new whenever the content changes or a result came back. A key derived from React's
 * `useId` was the same for every fresh page load, so after the first edit anywhere every later edit either
 * failed with a conflict or "saved" as a replay without writing (found in the batch red-team review).
 */
export function newEditKey(): string {
  return globalThis.crypto.randomUUID();
}
