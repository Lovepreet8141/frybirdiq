import { describe, expect, it } from "vitest";
import { ROLES } from "@/domain/permissions";
import { mayViewKitchenAnalytics } from "./access";

describe("mayViewKitchenAnalytics", () => {
  it("is granted to the roles that can see analytics or the kitchen", () => {
    for (const role of ["OWNER", "ADMIN", "MANAGER", "CASHIER", "KITCHEN", "ANALYST"] as const) {
      expect(mayViewKitchenAnalytics([role]), role).toBe(true);
    }
  });
  it("is refused to a rider, an inventory clerk and no role at all", () => {
    expect(mayViewKitchenAnalytics(["INVENTORY"])).toBe(false);
    expect(mayViewKitchenAnalytics(["RIDER"])).toBe(false);
    expect(mayViewKitchenAnalytics([])).toBe(false);
  });
  it("accounts for every role, so a new one has to be decided here", () => {
    expect([...ROLES].sort()).toEqual(["ADMIN", "ANALYST", "CASHIER", "INVENTORY", "KITCHEN", "MANAGER", "OWNER", "RIDER"].sort());
  });
});
