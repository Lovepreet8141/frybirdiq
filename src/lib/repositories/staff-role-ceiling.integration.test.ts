/**
 * p0-7 (1): nobody can hand out a role more powerful than their own, on any of
 * the three roster writes. `inviteStaff` used to take no actor roles at all, so
 * the only limit was which options the dropdown rendered and an ADMIN could
 * mint an OWNER. The ceiling is `canGrantRole`; these tests pin it on invite,
 * role change and deactivate, and pin that a refused invite never reaches
 * Supabase Auth (no auth user is created for a refusal).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships } from "@/db/schema";
import { ROLES, type Role } from "@/domain/permissions";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

const invited: string[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        inviteUserByEmail: async (email: string) => {
          invited.push(email);
          return { data: { user: { id: crypto.randomUUID() } }, error: null };
        },
      },
    },
  }),
}));

import { changeStaffRole, deactivateStaff, inviteStaff } from "./staff";

let org: TestOrg;
const actorId = randomUUID();

beforeAll(async () => {
  org = await createTestOrg();
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
});
beforeEach(async () => {
  invited.length = 0;
  await db().delete(memberships).where(eq(memberships.orgId, org.orgId));
  await db().delete(auditLogs).where(eq(auditLogs.orgId, org.orgId));
});

const rowsFor = (email: string) => db().select().from(memberships).where(and(eq(memberships.orgId, org.orgId), eq(memberships.displayName, email.split("@")[0]!)));
async function member(role: Role): Promise<string> {
  const userId = randomUUID();
  await db().insert(memberships).values({ orgId: org.orgId, userId, role, displayName: `${role.toLowerCase()}-${userId.slice(0, 6)}` });
  return userId;
}
const activeRoles = async (userId: string) => (await db().select().from(memberships).where(and(eq(memberships.orgId, org.orgId), eq(memberships.userId, userId), eq(memberships.isActive, true)))).map((r) => r.role);

describe("inviteStaff: the role ceiling", () => {
  it("an ADMIN cannot invite an OWNER: refused, no auth user created, no membership, no audit row", async () => {
    const result = await inviteStaff(org.orgId, actorId, ["ADMIN"], "sneaky@example.test", "OWNER");
    expect(result.ok).toBe(false);
    expect(invited).toEqual([]); // Supabase Auth never called
    expect(await rowsFor("sneaky@example.test")).toEqual([]);
    expect(await db().select().from(auditLogs).where(eq(auditLogs.orgId, org.orgId))).toEqual([]);
  });

  it("an ADMIN cannot invite a MANAGER either (a MANAGER sees money an ADMIN cannot)", async () => {
    expect((await inviteStaff(org.orgId, actorId, ["ADMIN"], "m@example.test", "MANAGER")).ok).toBe(false);
    expect(invited).toEqual([]);
  });

  it("an ADMIN can still invite roles at or below their own", async () => {
    const result = await inviteStaff(org.orgId, actorId, ["ADMIN"], "till@example.test", "CASHIER");
    expect(result).toMatchObject({ ok: true, resent: false });
    expect((await rowsFor("till@example.test")).map((r) => r.role)).toEqual(["CASHIER"]);
  });

  it("an OWNER can invite an OWNER", async () => {
    expect(await inviteStaff(org.orgId, actorId, ["OWNER"], "second-owner@example.test", "OWNER")).toMatchObject({ ok: true });
  });

  it("a CASHIER (who has no staff.manage) holds no ceiling to lean on: no role at all is grantable", async () => {
    for (const role of ROLES) {
      const result = await inviteStaff(org.orgId, actorId, ["CASHIER"], `x-${role}@example.test`, role);
      if (role !== "CASHIER" && role !== "KITCHEN" && role !== "RIDER") expect(result.ok, role).toBe(false);
    }
  });
});

describe("changeStaffRole and deactivateStaff keep their ceilings", () => {
  it("an ADMIN cannot promote someone to OWNER, and cannot touch an OWNER's account", async () => {
    const cashier = await member("CASHIER");
    const owner = await member("OWNER");
    expect((await changeStaffRole(org.orgId, actorId, ["ADMIN"], cashier, "OWNER")).ok).toBe(false);
    expect(await activeRoles(cashier)).toEqual(["CASHIER"]);
    expect((await changeStaffRole(org.orgId, actorId, ["ADMIN"], owner, "CASHIER")).ok).toBe(false);
    expect((await deactivateStaff(org.orgId, actorId, ["ADMIN"], owner)).ok).toBe(false);
    expect(await activeRoles(owner)).toEqual(["OWNER"]);
  });
});
