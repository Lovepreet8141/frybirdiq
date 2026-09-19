/**
 * Has the server been deployed since this screen loaded? Pure decisions only;
 * the component owns the timers and the DOM.
 *
 * A staff screen (POS, KDS, orders board, Admin) is left open for a whole
 * shift. `deploy.sh` restarts the process, so the client on screen keeps
 * calling Server Action ids the new build no longer has. This is how such a
 * screen finds out — and reloads itself only when nobody is using it.
 */

/** How often a visible screen asks the server which build it is running. */
export const VERSION_POLL_MS = 60_000;
/** No touch, key or pointer for this long counts as idle. */
export const IDLE_BEFORE_RELOAD_MS = 60_000;
/** After an automatic reload, do not do another for this long (a proxy serving a stale build must not cause a loop). */
export const AUTO_RELOAD_COOLDOWN_MS = 5 * 60_000;

export type VersionVerdict = "same" | "newer" | "unknown";

/** `remote` is whatever `/api/version` returned. Anything unreadable is "unknown", which never prompts. */
export function compareVersions(local: string, remote: unknown): VersionVerdict {
  if (typeof remote !== "string" || remote.length === 0) return "unknown";
  return remote === local ? "same" : "newer";
}

export function parseVersionBody(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const build = (body as { build?: unknown }).build;
  return typeof build === "string" && build.length > 0 ? build : null;
}

export interface ReloadContext {
  /** A newer build is live. */
  readonly stale: boolean;
  /** Milliseconds since the last touch, key or pointer on this screen. */
  readonly idleMs: number;
  /** An order is being built or paid, a dialog is open, or text is being typed. */
  readonly busy: boolean;
  readonly online: boolean;
  /** When this screen last reloaded itself, or null. */
  readonly lastAutoReloadAt: number | null;
  readonly now: number;
}

/** Reload by itself only when there is a newer build, nobody is using the screen, and it is safe to. */
export function shouldAutoReload(context: ReloadContext): boolean {
  if (!context.stale || !context.online || context.busy) return false;
  if (context.idleMs < IDLE_BEFORE_RELOAD_MS) return false;
  if (context.lastAutoReloadAt !== null && context.now - context.lastAutoReloadAt < AUTO_RELOAD_COOLDOWN_MS) return false;
  return true;
}

/** The selector for "someone is in the middle of something" (an open dialog, or a screen that marks an order in progress). */
export const BUSY_SELECTOR = '[role="dialog"], [role="alertdialog"], [data-order-in-progress="true"]';
