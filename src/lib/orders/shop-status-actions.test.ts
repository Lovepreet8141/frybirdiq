import { beforeEach, describe, expect, it, vi } from "vitest";
import { can, type Role } from "@/domain/permissions";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  pauseOrdering: vi.fn(),
  resumeOrdering: vi.fn(),
  getOrderingStatusForStaff: vi.fn(),
  previewPause: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined }));
vi.mock("@/lib/auth", () => ({
  NotSignedIn: class NotSignedIn extends Error {},
  NotPermitted: class NotPermitted extends Error {},
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/repositories/shop-status", () => ({
  pauseOrdering: mocks.pauseOrdering,
  resumeOrdering: mocks.resumeOrdering,
  getOrderingStatusForStaff: mocks.getOrderingStatusForStaff,
  previewPause: mocks.previewPause,
}));

import { NotPermitted, NotSignedIn } from "@/lib/auth";
import { pauseOrderingAction, previewPauseAction, readOrderingStatusAction, resumeOrderingAction } from "./shop-status-actions";

const staff = { userId: "11111111-1111-4111-8111-111111111111", orgId: "22222222-2222-4222-8222-222222222222", roles: ["CASHIER"] };

beforeEach(() => {
  mocks.requirePermission.mockReset().mockResolvedValue(staff);
  mocks.pauseOrdering.mockReset().mockResolvedValue({ ok: true, changed: true, status: { state: "paused" } });
  mocks.resumeOrdering.mockReset().mockResolvedValue({ ok: true, changed: true, status: { state: "open" } });
  mocks.revalidatePath.mockReset();
});

describe("who may switch online orders off and on (god's ruling D2: orders.update, both ways)", () => {
  it.each<[Role, boolean]>([
    ["OWNER", true],
    ["ADMIN", true],
    ["MANAGER", true],
    ["CASHIER", true],
    ["KITCHEN", false],
    ["RIDER", false],
    ["INVENTORY", false],
    ["ANALYST", false],
  ])("%s → %s, from the real role table", (role, allowed) => {
    expect(can([role], "orders.update")).toBe(allowed);
  });
});

describe("pauseOrderingAction", () => {
  it("asks for orders.update and pauses the signed-in staff member's own org — never one from the request", async () => {
    await pauseOrderingAction({ reason: "power cut", mode: "UNTIL_RESUMED", orgId: "33333333-3333-4333-8333-333333333333" });
    expect(mocks.requirePermission).toHaveBeenCalledWith("orders.update");
    expect(mocks.pauseOrdering).toHaveBeenCalledWith({ orgId: staff.orgId, actorUserId: staff.userId, reason: "power cut", mode: "UNTIL_RESUMED" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("defaults to 'until we next open', the owner's default", async () => {
    await pauseOrderingAction({ reason: "power cut" });
    expect(mocks.pauseOrdering).toHaveBeenCalledWith(expect.objectContaining({ mode: "UNTIL_NEXT_OPENING" }));
  });

  it.each([{}, { reason: "no" }, { reason: "x".repeat(201) }, { reason: "power cut", mode: "FOREVER" }])(
    "refuses %j before any permission check or write",
    async (input) => {
      const result = await pauseOrderingAction(input);
      expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
      expect(mocks.requirePermission).not.toHaveBeenCalled();
      expect(mocks.pauseOrdering).not.toHaveBeenCalled();
    },
  );

  it("a role without orders.update is refused and nothing is written", async () => {
    mocks.requirePermission.mockRejectedValue(new NotPermitted("orders.update"));
    expect(await pauseOrderingAction({ reason: "power cut" })).toMatchObject({ ok: false, code: "NOT_PERMITTED" });
    expect(mocks.pauseOrdering).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("a signed-out session is told so", async () => {
    mocks.requirePermission.mockRejectedValue(new NotSignedIn());
    expect(await pauseOrderingAction({ reason: "power cut" })).toMatchObject({ ok: false, code: "SIGNED_OUT" });
  });

  it("an unexpected failure is a plain message, not a stack trace", async () => {
    mocks.pauseOrdering.mockRejectedValue(new Error("connection reset"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await pauseOrderingAction({ reason: "power cut" })).toMatchObject({ ok: false, code: "SERVER_ERROR" });
  });
});

describe("resumeOrderingAction", () => {
  const shownPausedAt = "2026-06-10T13:30:00.000Z";

  it("names the pause the screen showed, for the signed-in staff member's own org", async () => {
    await resumeOrderingAction({ shownPausedAt });
    expect(mocks.requirePermission).toHaveBeenCalledWith("orders.update");
    expect(mocks.resumeOrdering).toHaveBeenCalledWith({ orgId: staff.orgId, actorUserId: staff.userId, shownPausedAt: new Date(shownPausedAt) });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("refreshes the screens when the pause turned out to have changed, so they show the one in force", async () => {
    mocks.resumeOrdering.mockResolvedValue({ ok: false, code: "PAUSE_CHANGED", error: "changed", status: { state: "paused" } });
    await resumeOrderingAction({ shownPausedAt });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("refuses a missing or malformed pausedAt before any permission check", async () => {
    for (const input of [{}, { shownPausedAt: "yesterday" }]) {
      expect(await resumeOrderingAction(input)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });
});

describe("readOrderingStatusAction — the POS poll", () => {
  it("anyone who can see orders may read the state, for their own org — and nothing is revalidated", async () => {
    mocks.getOrderingStatusForStaff.mockResolvedValue({ state: "open" });
    expect(await readOrderingStatusAction()).toEqual({ ok: true, status: { state: "open" } });
    expect(mocks.requirePermission).toHaveBeenCalledWith("orders.view");
    expect(mocks.getOrderingStatusForStaff).toHaveBeenCalledWith(staff.orgId);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("a missing shop is an error, not an empty state", async () => {
    mocks.getOrderingStatusForStaff.mockResolvedValue(null);
    expect(await readOrderingStatusAction()).toMatchObject({ ok: false, code: "SERVER_ERROR" });
  });
});

describe("previewPauseAction — the confirm line, before anything changes", () => {
  it("needs orders.update, like the switch itself, and writes nothing", async () => {
    mocks.previewPause.mockResolvedValue({ nextOpeningAt: new Date(), nextOpeningLabel: "today at 11:30 AM", ordersStillDue: 2 });
    expect(await previewPauseAction()).toMatchObject({ ok: true, preview: { nextOpeningLabel: "today at 11:30 AM" } });
    expect(mocks.requirePermission).toHaveBeenCalledWith("orders.update");
    expect(mocks.previewPause).toHaveBeenCalledWith(staff.orgId);
    expect(mocks.pauseOrdering).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("refused without orders.update", async () => {
    mocks.requirePermission.mockRejectedValue(new NotPermitted("orders.update"));
    expect(await previewPauseAction()).toMatchObject({ ok: false, code: "NOT_PERMITTED" });
    expect(mocks.previewPause).not.toHaveBeenCalled();
  });
});
