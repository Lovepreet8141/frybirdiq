/**
 * invite-race-1: two identical invites in flight both used to see "no
 * membership yet"; the loser died on the unique (org, user, role) index (a 500).
 * staff-lock-1: deactivate and role change decided the role ceiling from rows
 * they had not locked, so a simultaneous role change on the same person could be
 * missed. Both now serialise on the person's membership rows.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
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
  ids.clear();
  await db().delete(memberships).where(eq(memberships.orgId, org.orgId));
  await db().delete(auditLogs).where(eq(auditLogs.orgId, org.orgId));
});

async function member(role: Role): Promise<string> {
  const userId = randomUUID();
  await db().insert(memberships).values({ orgId: org.orgId, userId, role, displayName: `${role.toLowerCase()}-${userId.slice(0, 6)}` });
  return userId;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("invite-race-1: identical invites in flight", () => {
  it("five simultaneous identical invites: none throws, exactly one membership, one is the first and the rest resends", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => inviteStaff(org.orgId, actorId, ["OWNER"], "race@example.test", "CASHIER")));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && !r.resent)).toHaveLength(1);
    expect(results.filter((r) => r.ok && r.resent)).toHaveLength(4);
    const rows = await db().select().from(memberships).where(and(eq(memberships.orgId, org.orgId), eq(memberships.displayName, "race")));
    expect(rows).toHaveLength(1);
    const audits = await db().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.action, "staff_invited")));
    expect(audits).toHaveLength(5);
  });

  it("an identical invite committing while ours is between its read and its write: no unique-violation 500, ours becomes a resend", async () => {
    const userId = randomUUID();
    ids.set("held@example.test", userId);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let inserted!: () => void;
    const holding = new Promise<void>((r) => (inserted = r));
    // The "other" invite: its membership row exists but is not committed yet, so ours cannot see it.
    const other = db().transaction(async (tx) => {
      await tx.insert(memberships).values({ orgId: org.orgId, userId, role: "CASHIER", displayName: "held" });
      inserted();
      await gate;
    });
    await holding;
    const ours = inviteStaff(org.orgId, actorId, ["OWNER"], "held@example.test", "CASHIER");
    await wait(300);
    release();
    await other;
    expect(await ours).toMatchObject({ ok: true, resent: true });
    const rows = await db().select().from(memberships).where(and(eq(memberships.orgId, org.orgId), eq(memberships.userId, userId)));
    expect(rows).toHaveLength(1);
  });

  it("re-inviting a deactivated person still reactivates them", async () => {
    await inviteStaff(org.orgId, actorId, ["OWNER"], "back@example.test", "CASHIER");
    const userId = ids.get("back@example.test")!;
    await db().update(memberships).set({ isActive: false }).where(and(eq(memberships.orgId, org.orgId), eq(memberships.userId, userId)));
    expect(await inviteStaff(org.orgId, actorId, ["OWNER"], "back@example.test", "CASHIER")).toMatchObject({ ok: true, resent: true });
    const [row] = await db().select().from(memberships).where(and(eq(memberships.orgId, org.orgId), eq(memberships.userId, userId)));
    expect(row?.isActive).toBe(true);
  });
});

describe("staff-lock-1: the ceiling is decided from locked rows", () => {
  it("deactivate waits for a role change in flight and then sees the new role (an ADMIN cannot deactivate the OWNER the person just became)", async () => {
    const target = await member("CASHIER");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const holding = new Promise<void>((r) => (locked = r));

    // A concurrent role change: locks the person's rows, promotes them to OWNER, commits only when told.
    const promoter = db().transaction(async (tx) => {
      await tx.select().from(memberships).where(and(eq(memberships.orgId, org.orgId), eq(memberships.userId, target))).for("update");
      await tx.update(memberships).set({ role: "OWNER" }).where(and(eq(memberships.orgId, org.orgId), eq(memberships.userId, target)));
      locked();
      await gate;
    });
    await holding;

    let settled = false;
    const deactivation = deactivateStaff(org.orgId, actorId, ["ADMIN"], target).then((r) => {
      settled = true;
      return r;
    });
    await wait(400);
    expect(settled).toBe(false); // waiting on the lock, not deciding from the stale CASHIER row

    release();
    await promoter;
    const result = await deactivation;
    expect(result.ok).toBe(false);
    const [row] = await db().select().from(memberships).where(and(eq(memberships.orgId, org.orgId), eq(memberships.userId, target)));
    expect(row).toMatchObject({ role: "OWNER", isActive: true });
  });

  it("changeStaffRole takes the same lock", async () => {
    const target = await member("CASHIER");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const holding = new Promise<void>((r) => (locked = r));
    const promoter = db().transaction(async (tx) => {
      await tx.select().from(memberships).where(and(eq(memberships.orgId, org.orgId), eq(memberships.userId, target))).for("update");
      await tx.update(memberships).set({ role: "OWNER" }).where(and(eq(memberships.orgId, org.orgId), eq(memberships.userId, target)));
      locked();
      await gate;
    });
    await holding;
    let settled = false;
    const change = changeStaffRole(org.orgId, actorId, ["ADMIN"], target, "KITCHEN").then((r) => {
      settled = true;
      return r;
    });
    await wait(400);
    expect(settled).toBe(false);
    release();
    await promoter;
    expect((await change).ok).toBe(false);
    const [row] = await db().select().from(memberships).where(and(eq(memberships.orgId, org.orgId), eq(memberships.userId, target)));
    expect(row?.role).toBe("OWNER");
  });
});
