import { describe, expect, it } from "vitest";
import { ROLES, can, canGrantRole, type Role } from "@/domain/permissions";

/**
 * The IQ approval permissions. hive/reviews/iq-0/DESIGN-v2-DELTA.md §4.
 *
 * Both are OWNER only. ADMIN is the case that matters: ADMIN is built as
 * "every permission except a named few", so a new permission lands on ADMIN
 * unless it is excluded by name.
 */
describe("iq.approve and iq.autopolicy.manage", () => {
  for (const permission of ["iq.approve", "iq.autopolicy.manage"] as const) {
    it(`grants ${permission} to OWNER only`, () => {
      expect(can(["OWNER"], permission)).toBe(true);
      expect(can(["ADMIN"], permission)).toBe(false);
      expect(can(["MANAGER"], permission)).toBe(false);
      const holders = ROLES.filter((role: Role) => can([role], permission));
      expect(holders).toEqual(["OWNER"]);
    });

    it(`does not reach ${permission} through a union of non-owner roles`, () => {
      const nonOwner = ROLES.filter((role) => role !== "OWNER");
      expect(can(nonOwner, permission)).toBe(false);
    });
  }

  it("leaves ADMIN unable to grant OWNER, now that OWNER holds more ADMIN lacks", () => {
    expect(canGrantRole(["ADMIN"], "OWNER")).toBe(false);
    expect(canGrantRole(["OWNER"], "OWNER")).toBe(true);
  });
});
