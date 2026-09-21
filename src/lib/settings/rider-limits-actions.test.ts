import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  updateRiderLimits: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/repositories/settings", () => ({
  updateBusinessProfile: vi.fn(),
  updateLocationProfile: vi.fn(),
  updateOperationsSettings: vi.fn(),
  updatePaymentSettings: vi.fn(),
  updateRiderLimits: mocks.updateRiderLimits,
}));
vi.mock("@/lib/repositories/delivery", () => ({ updateDeliveryPricing: vi.fn() }));

import { updateRiderLimitsAction } from "./actions";

const staff = { userId: "11111111-1111-4111-8111-111111111111", orgId: "22222222-2222-4222-8222-222222222222" };
const idle = { status: "idle" } as const;
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
};

beforeEach(() => {
  mocks.requirePermission.mockReset().mockResolvedValue(staff);
  mocks.updateRiderLimits.mockReset().mockResolvedValue(undefined);
  mocks.revalidatePath.mockReset();
});

describe("updateRiderLimitsAction", () => {
  it("asks for settings.manage, and a refusal writes nothing", async () => {
    mocks.requirePermission.mockRejectedValue(new Error("no"));
    expect(await updateRiderLimitsAction(idle, form({ riderMaxActive: "2", riderMaxTakesPerHour: "6" }))).toEqual({ status: "error", message: "You don't have permission to change restaurant settings." });
    expect(mocks.requirePermission).toHaveBeenCalledWith("settings.manage");
    expect(mocks.updateRiderLimits).not.toHaveBeenCalled();
  });

  it("saves in-bounds whole numbers against the signed-in org and person, never ones named in the form", async () => {
    const result = await updateRiderLimitsAction(idle, form({ riderMaxActive: "3", riderMaxTakesPerHour: "10", orgId: "99999999-9999-4999-8999-999999999999" }));
    expect(result.status).toBe("success");
    expect(mocks.updateRiderLimits).toHaveBeenCalledWith(staff.orgId, staff.userId, { maxActive: 3, maxTakesPerHour: 10 });
  });

  it.each([
    ["zero active", { riderMaxActive: "0", riderMaxTakesPerHour: "6" }],
    ["six active", { riderMaxActive: "6", riderMaxTakesPerHour: "6" }],
    ["zero takes (would switch the cap off)", { riderMaxActive: "2", riderMaxTakesPerHour: "0" }],
    ["21 takes", { riderMaxActive: "2", riderMaxTakesPerHour: "21" }],
    ["a decimal", { riderMaxActive: "2.5", riderMaxTakesPerHour: "6" }],
    ["a negative", { riderMaxActive: "-1", riderMaxTakesPerHour: "6" }],
    ["text", { riderMaxActive: "two", riderMaxTakesPerHour: "6" }],
    ["blank", { riderMaxActive: "", riderMaxTakesPerHour: "" }],
    ["exponent form", { riderMaxActive: "1e1", riderMaxTakesPerHour: "6" }],
  ])("refuses %s with a plain message and writes nothing", async (_name, fields) => {
    expect((await updateRiderLimitsAction(idle, form(fields))).status).toBe("error");
    expect(mocks.updateRiderLimits).not.toHaveBeenCalled();
  });
});
