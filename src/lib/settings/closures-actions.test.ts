import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  setWeeklyClosedDays: vi.fn(),
  addClosedDate: vi.fn(),
  removeClosedDate: vi.fn(),
  revalidatePath: vi.fn(),
  clearMenuCache: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/repositories/menu-cache", () => ({ clearMenuCache: mocks.clearMenuCache }));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/repositories/closed-dates", () => ({ setWeeklyClosedDays: mocks.setWeeklyClosedDays, addClosedDate: mocks.addClosedDate, removeClosedDate: mocks.removeClosedDate }));

import { addClosedDateAction, removeClosedDateAction, saveWeeklyClosedDaysAction } from "./closures-actions";

const staff = { userId: "11111111-1111-4111-8111-111111111111", orgId: "22222222-2222-4222-8222-222222222222" };
const idle = { status: "idle" } as const;
const form = (entries: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  return data;
};

beforeEach(() => {
  mocks.requirePermission.mockReset().mockResolvedValue(staff);
  mocks.setWeeklyClosedDays.mockReset().mockResolvedValue({ ok: true, preOrders: [] });
  mocks.addClosedDate.mockReset().mockResolvedValue({ ok: true, preOrders: [] });
  mocks.removeClosedDate.mockReset().mockResolvedValue({ ok: true, preOrders: [] });
  mocks.revalidatePath.mockReset();
  mocks.clearMenuCache.mockReset();
});

describe("who may change the days closed", () => {
  it.each([
    ["weekly", () => saveWeeklyClosedDaysAction(idle, form({ closedDay: "2" }))],
    ["add", () => addClosedDateAction(idle, form({ startDate: "2026-10-20", endDate: "", note: "" }))],
    ["remove", () => removeClosedDateAction(idle, form({ id: "33333333-3333-4333-8333-333333333333" }))],
  ])("%s: settings.manage is asked for, and a refusal writes nothing and clears nothing", async (_name, run) => {
    mocks.requirePermission.mockRejectedValue(new Error("no"));
    const result = await run();
    expect(result).toEqual({ status: "error", message: "You don't have permission to change restaurant settings." });
    expect(mocks.requirePermission).toHaveBeenCalledWith("settings.manage");
    for (const write of [mocks.setWeeklyClosedDays, mocks.addClosedDate, mocks.removeClosedDate]) expect(write).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("saveWeeklyClosedDaysAction", () => {
  it("saves the ticked weekdays for the signed-in staff member's own org and clears the same caches as the switch", async () => {
    const result = await saveWeeklyClosedDaysAction(idle, form({ closedDay: "2", orgId: "99999999-9999-4999-8999-999999999999" }));
    expect(mocks.setWeeklyClosedDays).toHaveBeenCalledWith({ orgId: staff.orgId, actorUserId: staff.userId, days: [2] });
    expect(result).toMatchObject({ status: "success", message: "Weekly days off saved. No pre-orders are booked for it." });
    expect(mocks.clearMenuCache).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("no days ticked clears the weekly day off", async () => {
    await saveWeeklyClosedDaysAction(idle, form({}));
    expect(mocks.setWeeklyClosedDays).toHaveBeenCalledWith(expect.objectContaining({ days: [] }));
  });

  it("all seven, or a weekday that does not exist, is refused before anything is written", async () => {
    expect(await saveWeeklyClosedDaysAction(idle, form({ closedDay: ["0", "1", "2", "3", "4", "5", "6"] }))).toMatchObject({ status: "error" });
    expect(await saveWeeklyClosedDaysAction(idle, form({ closedDay: "8" }))).toMatchObject({ status: "error" });
    expect(mocks.setWeeklyClosedDays).not.toHaveBeenCalled();
  });

  it("reports the pre-orders it lands on and says nothing was cancelled", async () => {
    mocks.setWeeklyClosedDays.mockResolvedValue({
      ok: true,
      preOrders: [{ orderId: "o1", orderNumber: "1301", customerName: "Asha", scheduledFor: new Date("2026-09-22T13:00:00+05:30"), date: "2026-09-22", status: "ACCEPTED", note: null }],
    });
    const result = await saveWeeklyClosedDaysAction(idle, form({ closedDay: "2" }));
    expect(result).toMatchObject({ status: "success", preOrders: [{ orderNumber: "1301", when: "Tue 22 Sep, 1:00 PM" }] });
    expect(result.status === "success" && result.message).toContain("Nothing was cancelled");
  });
});

describe("addClosedDateAction", () => {
  it("a blank last day means just that day; a blank note means none", async () => {
    await addClosedDateAction(idle, form({ startDate: "2026-10-20", endDate: "", note: "  " }));
    expect(mocks.addClosedDate).toHaveBeenCalledWith({ orgId: staff.orgId, actorUserId: staff.userId, startDate: "2026-10-20", endDate: "2026-10-20", note: null });
  });

  it("passes a range and a public note", async () => {
    await addClosedDateAction(idle, form({ startDate: "2026-10-20", endDate: "2026-10-22", note: "Closed for Diwali" }));
    expect(mocks.addClosedDate).toHaveBeenCalledWith(expect.objectContaining({ endDate: "2026-10-22", note: "Closed for Diwali" }));
  });

  it("refuses a malformed date or an over-long note without calling the repository", async () => {
    expect(await addClosedDateAction(idle, form({ startDate: "20 Oct", endDate: "", note: "" }))).toMatchObject({ status: "error" });
    expect(await addClosedDateAction(idle, form({ startDate: "2026-10-20", endDate: "", note: "x".repeat(121) }))).toMatchObject({ status: "error" });
    expect(mocks.addClosedDate).not.toHaveBeenCalled();
  });

  it("the repository's own refusal reaches the owner in words and clears nothing", async () => {
    mocks.addClosedDate.mockResolvedValue({ ok: false, code: "INVALID", error: "That date has already passed." });
    expect(await addClosedDateAction(idle, form({ startDate: "2026-01-01", endDate: "", note: "" }))).toEqual({ status: "error", message: "That date has already passed." });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("removeClosedDateAction", () => {
  it("removes by id for the signed-in org only", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    await removeClosedDateAction(idle, form({ id }));
    expect(mocks.removeClosedDate).toHaveBeenCalledWith({ orgId: staff.orgId, actorUserId: staff.userId, id });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("a non-uuid id is refused", async () => {
    expect(await removeClosedDateAction(idle, form({ id: "1 OR 1=1" }))).toMatchObject({ status: "error" });
    expect(mocks.removeClosedDate).not.toHaveBeenCalled();
  });
});
