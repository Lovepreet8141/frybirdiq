/**
 * Detecting and recovering from a stale-deployment Server Action failure.
 *
 * `deploy/deploy.sh` restarts the whole Node process on every deploy — there
 * is no zero-downtime rollout (docs/DEPLOY.md says so explicitly). A browser
 * tab that was already open before a restart carries Server Action
 * reference ids baked into its JS bundle from the *previous* build. After
 * the restart, the new process's action manifest no longer recognizes those
 * ids, so Next's own client runtime rejects the call with a message like
 * "Failed to find Server Action ... This request might be from an older or
 * newer deployment" — thrown client-side, before the request ever reaches
 * our action code. Nothing runs, nothing is written, and — without this
 * module — nothing tells the person at the keyboard why.
 *
 * This was the root cause traced for the "Menu Manager edit didn't show up
 * on the website" report: the edit never reached Supabase at all, because
 * the tab making it was stale. The fix isn't in the revalidation/cache path
 * (that was verified working) — it's making this specific, recoverable
 * failure impossible to mistake for "my change didn't save right" or "the
 * website is broken."
 */

/** The one message this whole module exists to show, verbatim, everywhere it applies. */
export const STALE_DEPLOYMENT_MESSAGE = "This version of FRYBIRD IQ is out of date. Reload to continue.";

/**
 * True only for the specific client-side rejection Next.js throws when a
 * Server Action id from a previous build no longer resolves against the
 * current one. Matched on the framework's own wording rather than a broader
 * "any network error" guess — a real validation error, a permission
 * refusal, or an actual server exception must never be mistaken for this,
 * per the explicit requirement that normal errors stay normal errors.
 */
export function isStaleDeploymentError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /failed to find server action/i.test(error.message) || /older or newer deployment/i.test(error.message);
}

/**
 * Wraps a single Server Action call so a stale-deployment failure resolves
 * to a normal, in-place `{ ok: false, error: STALE_DEPLOYMENT_MESSAGE }`
 * value instead of throwing all the way up to the nearest error boundary.
 *
 * This is deliberately the *first* line of defence, not the only one: every
 * call site that mutates menu data through the Server Action flow wraps its
 * call with this, so the person filling out that exact form sees the exact
 * message with a reload action right where they are — nothing unmounts,
 * nothing jumps to a different screen. `src/app/(app)/error.tsx` and
 * `src/app/global-error.tsx` are the backstop for anything this wrapper
 * doesn't cover, using the same `isStaleDeploymentError` check.
 *
 * Any *other* thrown error is re-thrown unchanged — this function only ever
 * intercepts the one specific failure it is named for; a genuine bug still
 * reaches the error boundary, which is where an unexpected crash belongs.
 */
export async function recoverFromStaleDeployment<T extends { readonly ok: boolean; readonly error?: string }>(
  call: () => Promise<T>,
): Promise<T | { readonly ok: false; readonly error: typeof STALE_DEPLOYMENT_MESSAGE }> {
  try {
    return await call();
  } catch (error) {
    if (isStaleDeploymentError(error)) {
      return { ok: false, error: STALE_DEPLOYMENT_MESSAGE };
    }
    throw error;
  }
}
