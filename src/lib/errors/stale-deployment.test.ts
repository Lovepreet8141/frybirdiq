import { describe, expect, it, vi } from "vitest";
import { STALE_DEPLOYMENT_MESSAGE, isStaleDeploymentError, recoverFromStaleDeployment } from "./stale-deployment";

/**
 * The two real-world error strings Next.js's client runtime throws for this
 * failure — captured verbatim from the production incident this module was
 * built to fix (see docs referenced in `stale-deployment.ts`), not guessed.
 */
const REAL_STALE_ERROR_1 = new Error(
  'Failed to find Server Action "00833f53590b112d234deb74a0fc5a71f57510b6a8". This request might be from an older or newer deployment.',
);
const REAL_STALE_ERROR_2 = new Error("This Server Action might be from an older or newer deployment.");

describe("isStaleDeploymentError", () => {
  it("recognizes the exact 'Failed to find Server Action' message Next.js throws", () => {
    expect(isStaleDeploymentError(REAL_STALE_ERROR_1)).toBe(true);
  });

  it("recognizes a differently-worded variant that still names an older/newer deployment", () => {
    expect(isStaleDeploymentError(REAL_STALE_ERROR_2)).toBe(true);
  });

  it("is case-insensitive, in case Next.js's own wording capitalization ever shifts", () => {
    expect(isStaleDeploymentError(new Error("FAILED TO FIND SERVER ACTION \"abc\"."))).toBe(true);
  });

  it("does NOT match a normal validation error — the core requirement that normal errors stay normal", () => {
    expect(isStaleDeploymentError(new Error("Needs a name."))).toBe(false);
  });

  it("does NOT match a permission error", () => {
    expect(isStaleDeploymentError(new Error("You don't have permission to do that."))).toBe(false);
  });

  it("does NOT match an unrelated network/server error", () => {
    expect(isStaleDeploymentError(new Error("fetch failed"))).toBe(false);
  });

  it("does NOT match a non-Error thrown value", () => {
    expect(isStaleDeploymentError("some string")).toBe(false);
    expect(isStaleDeploymentError(undefined)).toBe(false);
    expect(isStaleDeploymentError(null)).toBe(false);
    expect(isStaleDeploymentError({ message: "Failed to find Server Action" })).toBe(false);
  });
});

describe("recoverFromStaleDeployment", () => {
  it("stale Server Action failure: converts a thrown stale-deployment error into a normal, actionable result", async () => {
    const call = vi.fn().mockRejectedValue(REAL_STALE_ERROR_1);
    const result = await recoverFromStaleDeployment(call);
    expect(result).toEqual({ ok: false, error: STALE_DEPLOYMENT_MESSAGE });
    expect(call).toHaveBeenCalledOnce();
  });

  it("reload/recovery behavior: the recovered result carries the exact message the UI keys off of to show the reload action", async () => {
    const call = vi.fn().mockRejectedValue(REAL_STALE_ERROR_2);
    const result = await recoverFromStaleDeployment(call);
    expect(result.ok).toBe(false);
    // The UI (ReloadAppButton wiring across every Menu Manager form) shows
    // the reload action by comparing the displayed error to this exact
    // exported constant — asserting equality here is what keeps that
    // comparison meaningful rather than a string that could silently drift.
    expect(!result.ok && result.error).toBe(STALE_DEPLOYMENT_MESSAGE);
  });

  it("normal validation error: a resolved (not thrown) failure passes through completely unchanged", async () => {
    const validationFailure = { ok: false as const, error: "Needs a name." };
    const call = vi.fn().mockResolvedValue(validationFailure);
    const result = await recoverFromStaleDeployment(call);
    expect(result).toEqual(validationFailure);
    expect(result).not.toEqual({ ok: false, error: STALE_DEPLOYMENT_MESSAGE });
  });

  it("normal validation error: a permission-denied failure is untouched, not reinterpreted as stale", async () => {
    const permissionFailure = { ok: false as const, error: "You don't have permission to do that." };
    const call = vi.fn().mockResolvedValue(permissionFailure);
    const result = await recoverFromStaleDeployment(call);
    expect(result).toEqual(permissionFailure);
  });

  it("a successful result passes through unchanged", async () => {
    const success = { ok: true as const };
    const call = vi.fn().mockResolvedValue(success);
    const result = await recoverFromStaleDeployment(call);
    expect(result).toEqual(success);
  });

  it("form failure state: a genuinely unexpected error is re-thrown, never silently swallowed into a form error", async () => {
    const bug = new Error("Cannot read properties of undefined (reading 'foo')");
    const call = vi.fn().mockRejectedValue(bug);
    await expect(recoverFromStaleDeployment(call)).rejects.toThrow(bug);
  });

  it("form failure state: a cross-org/CrossOrgReference-style error (thrown, not stale) is re-thrown rather than shown as stale", async () => {
    const crossOrg = new Error("menu-admin: category does not belong to this organization");
    const call = vi.fn().mockRejectedValue(crossOrg);
    await expect(recoverFromStaleDeployment(call)).rejects.toThrow(crossOrg);
  });
});
