/**
 * alert-owner-created: every path that leaves an OWNER membership active
 * (a fresh invite, a resent invite that reactivates a deactivated OWNER, a
 * role change that reactivates or creates an OWNER row) writes its own
 * dedicated audit row and calls the alert sender — once, with the right
 * event. Every path that does NOT touch an OWNER row (a non-OWNER invite or
 * role change, or a role change onto an OWNER row that was already active)
 * must do neither.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships } from "@/db/schema";
import type { Role } from "@/domain/permissions";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

const ids = new Map<string, string>();
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        // The same email always resolves to the same auth user, as Supabase does for a pending invite.
        inviteUserByEmail: async (email: string) => {
          if (!ids.has(email)) ids.set(email, crypto.randomUUID());
          return { data: { user: { id: ids.get(email) } }, error: null };
        },
      },
    },
  }),
}));

const { sendOwnerMembershipAlert } = vi.hoisted(() => ({ sendOwnerMembershipAlert: vi.fn() }));
vi.mock("@/lib/auth/owner-membership-alert", () => ({ sendOwnerMembershipAlert }));

import { changeStaffRole, inviteStaff } from "./staff";

let org: TestOrg;
const actorId = randomUUID();

beforeAll(async () => {
  org = await createTestOrg();
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
});
beforeEach(async () => {
  ids.clear();
  sendOwnerMembershipAlert.mockReset();
  await db().delete(memberships).where(eq(memberships.orgId, org.orgId));
  await db().delete(auditLogs).where(eq(auditLogs.orgId, org.orgId));
});

async function member(role: Role, isActive = true): Promise<string> {
  const userId = randomUUID();
  await db().insert(memberships).values({ orgId: org.orgId, userId, role, displayName: `${role.toLowerCase()}-${userId.slice(0, 6)}`, isActive });
  return userId;
}
const ownerAudits = () =>
  db()
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.entity, "memberships")))
    .orderBy(asc(auditLogs.createdAt))
    .then((rows) => rows.filter((r) => r.action.startsWith("owner_membership_")));

describe("inviteStaff: alert-owner-created", () => {
  it("a fresh OWNER invite writes owner_membership_created and alerts once, event 'created'", async () => {
    const result = await inviteStaff(org.orgId, actorId, ["OWNER"], "second-owner@example.test", "OWNER");
    expect(result).toMatchObject({ ok: true, resent: false });

    const audits = await ownerAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "owner_membership_created" });

    expect(sendOwnerMembershipAlert).toHaveBeenCalledTimes(1);
    expect(sendOwnerMembershipAlert).toHaveBeenCalledWith("created", org.orgId, ids.get("second-owner@example.test"));
  });

  it("re-inviting a deactivated OWNER reactivates them and writes owner_membership_reactivated", async () => {
    await inviteStaff(org.orgId, actorId, ["OWNER"], "back-owner@example.test", "OWNER");
    sendOwnerMembershipAlert.mockReset();
    const userId = ids.get("back-owner@example.test")!;
    await db().update(memberships).set({ isActive: false }).where(and(eq(memberships.orgId, org.orgId), eq(memberships.userId, userId)));

    const result = await inviteStaff(org.orgId, actorId, ["OWNER"], "back-owner@example.test", "OWNER");
    expect(result).toMatchObject({ ok: true, resent: true });

    const [row] = await db().select().from(memberships).where(and(eq(memberships.orgId, org.orgId), eq(memberships.userId, userId)));
    // Two rows total: the "created" row from the fresh invite earlier in this test, plus this reactivation's own row.
    const audits = await ownerAudits();
    expect(audits).toHaveLength(2);
    expect(audits.map((a) => a.action)).toEqual(["owner_membership_created", "owner_membership_reactivated"]);
    expect(audits[1]).toMatchObject({ action: "owner_membership_reactivated", entityId: row?.id });

    expect(sendOwnerMembershipAlert).toHaveBeenCalledTimes(1);
    expect(sendOwnerMembershipAlert).toHaveBeenCalledWith("reactivated", org.orgId, userId);
  });

  it("resending an invite to an already-ACTIVE OWNER writes no owner alert row and does not call the alert sender again", async () => {
    await inviteStaff(org.orgId, actorId, ["OWNER"], "steady-owner@example.test", "OWNER");
    sendOwnerMembershipAlert.mockReset();
    const auditCountBefore = (await ownerAudits()).length; // the one "created" row from the invite above

    const result = await inviteStaff(org.orgId, actorId, ["OWNER"], "steady-owner@example.test", "OWNER");
    expect(result).toMatchObject({ ok: true, resent: true });

    expect(await ownerAudits()).toHaveLength(auditCountBefore); // unchanged: resending to an already-active OWNER is not an event
    expect(sendOwnerMembershipAlert).not.toHaveBeenCalled();
  });

  it("an ordinary CASHIER invite writes no owner alert row and never calls the alert sender", async () => {
    await inviteStaff(org.orgId, actorId, ["OWNER"], "till@example.test", "CASHIER");
    expect(await ownerAudits()).toHaveLength(0);
    expect(sendOwnerMembershipAlert).not.toHaveBeenCalled();
  });
});

describe("changeStaffRole: alert-owner-created", () => {
  it("promoting an existing person straight to OWNER (new row) writes owner_membership_created and alerts", async () => {
    const target = await member("CASHIER");
    const result = await changeStaffRole(org.orgId, actorId, ["OWNER"], target, "OWNER");
    expect(result).toMatchObject({ ok: true });

    const audits = await ownerAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "owner_membership_created", entityId: target });

    expect(sendOwnerMembershipAlert).toHaveBeenCalledTimes(1);
    expect(sendOwnerMembershipAlert).toHaveBeenCalledWith("created", org.orgId, target);
  });

  it("changing an OWNER-with-a-dormant-OWNER-row back onto OWNER (reactivation) writes owner_membership_reactivated and alerts", async () => {
    // The person currently holds CASHIER active, and has a dormant (inactive) OWNER row from an earlier demotion.
    const target = await member("CASHIER");
    await db().insert(memberships).values({ orgId: org.orgId, userId: target, role: "OWNER", displayName: "dormant-owner", isActive: false });

    const result = await changeStaffRole(org.orgId, actorId, ["OWNER"], target, "OWNER");
    expect(result).toMatchObject({ ok: true });

    const audits = await ownerAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "owner_membership_reactivated", entityId: target });

    expect(sendOwnerMembershipAlert).toHaveBeenCalledTimes(1);
    expect(sendOwnerMembershipAlert).toHaveBeenCalledWith("reactivated", org.orgId, target);
  });

  it("a role change onto a non-OWNER role writes no owner alert row and never calls the alert sender", async () => {
    const target = await member("CASHIER");
    await changeStaffRole(org.orgId, actorId, ["OWNER"], target, "KITCHEN");
    expect(await ownerAudits()).toHaveLength(0);
    expect(sendOwnerMembershipAlert).not.toHaveBeenCalled();
  });

  it("a refused change (actor cannot grant OWNER) writes no owner alert row and never calls the alert sender", async () => {
    const target = await member("CASHIER");
    const result = await changeStaffRole(org.orgId, actorId, ["ADMIN"], target, "OWNER");
    expect(result.ok).toBe(false);
    expect(await ownerAudits()).toHaveLength(0);
    expect(sendOwnerMembershipAlert).not.toHaveBeenCalled();
  });
});
