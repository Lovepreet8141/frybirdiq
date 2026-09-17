/**
 * iq-auto-policies.ts against the real local Supabase stack: versioned
 * compare-and-set with an audit row, concurrent saves, the dec-4 allowlist,
 * location ownership, and lookup precedence within one org.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLogs, iqAutoPolicies, locations } from "@/db/schema";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { getAutoPolicy, setAutoPolicy, type SetAutoPolicyInput } from "./iq-auto-policies";

const OWNER = randomUUID();
let org: TestOrg;
let otherOrg: TestOrg;

beforeAll(async () => {
  org = await createTestOrg();
  otherOrg = await createTestOrg();
});

afterAll(async () => {
  await deleteTestOrg(org.orgId);
  await deleteTestOrg(otherOrg.orgId);
});

const input = (overrides: Partial<SetAutoPolicyInput> = {}): SetAutoPolicyInput => ({
  orgId: org.orgId,
  userId: OWNER,
  actionKind: "inventory.flag_recount",
  locationId: null,
  enabled: false,
  limits: { maxPerDay: 5 },
  reason: "Trying it out",
  expectedVersion: null,
  ...overrides,
});

const auditsFor = (id: string) => db().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.entityId, id)));

describe("setAutoPolicy", () => {
  it("creates at version 1 and bumps the version on each save, auditing each change", async () => {
    const created = await setAutoPolicy(input({ actionKind: "prep_list.prefill" }));
    expect(created).toMatchObject({ ok: true, policy: { version: 1, enabled: false, limits: { maxPerDay: 5 } } });
    if (!created.ok) throw new Error("unreachable");

    const updated = await setAutoPolicy(input({ actionKind: "prep_list.prefill", limits: { maxPerDay: 7 }, expectedVersion: 1 }));
    expect(updated).toMatchObject({ ok: true, policy: { id: created.policy.id, version: 2, limits: { maxPerDay: 7 } } });

    const audits = await auditsFor(created.policy.id);
    expect(audits.map((a) => a.action)).toEqual(["iq_auto_policy_set", "iq_auto_policy_set"]);
    const [row] = await db().select().from(iqAutoPolicies).where(eq(iqAutoPolicies.id, created.policy.id));
    expect(audits.map((a) => a.id)).toContain(row!.auditLogId);
    expect(audits.find((a) => a.id === row!.auditLogId)?.before).toEqual({ enabled: false, limits: { maxPerDay: 5 }, version: 1 });
  });

  it("refuses a stale version, a second create, and a missing policy", async () => {
    const created = await setAutoPolicy(input({ actionKind: "task.open_internal" }));
    expect(created.ok).toBe(true);
    expect(await setAutoPolicy(input({ actionKind: "task.open_internal" }))).toEqual({ ok: false, reason: "VERSION_CONFLICT" });
    await setAutoPolicy(input({ actionKind: "task.open_internal", expectedVersion: 1 }));
    expect(await setAutoPolicy(input({ actionKind: "task.open_internal", expectedVersion: 1 }))).toEqual({
      ok: false,
      reason: "VERSION_CONFLICT",
    });
    expect(await setAutoPolicy(input({ actionKind: "purchase_order.create_draft", expectedVersion: 1 }))).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
  });

  it("lets exactly one of two concurrent saves of the same version win", async () => {
    const created = await setAutoPolicy(input({ actionKind: "inventory.flag_recount", locationId: org.locationId }));
    expect(created.ok).toBe(true);
    const results = await Promise.all([
      setAutoPolicy(input({ locationId: org.locationId, limits: { maxPerDay: 2 }, expectedVersion: 1 })),
      setAutoPolicy(input({ locationId: org.locationId, limits: { maxPerDay: 3 }, expectedVersion: 1 })),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "VERSION_CONFLICT" }]);
  });

  it("refuses to switch on a kind outside A1_AUTO_ALLOWED (empty until dec-4), but allows it through the seam", async () => {
    expect(await setAutoPolicy(input({ actionKind: "purchase_order.create_draft", enabled: true }))).toEqual({
      ok: false,
      reason: "NOT_ALLOWLISTED",
    });
    const allowed = await setAutoPolicy(input({ actionKind: "purchase_order.create_draft", enabled: true }), {
      allowedAutoKinds: ["purchase_order.create_draft"],
    });
    expect(allowed).toMatchObject({ ok: true, policy: { enabled: true } });
  });

  it("refuses invalid input before touching the database", async () => {
    for (const bad of [
      input({ actionKind: "menu.mark_86" }),
      input({ actionKind: "refund.create" }),
      input({ limits: { maxPerDay: 0 } }),
      input({ limits: { maxPerDay: 5, maxPaise: 1 } as never }),
      input({ reason: "  " }),
      input({ orgId: "nope" }),
    ]) {
      expect(await setAutoPolicy(bad)).toEqual({ ok: false, reason: "INVALID" });
    }
  });

  it("refuses a location that belongs to another org", async () => {
    expect(await setAutoPolicy(input({ locationId: otherOrg.locationId }))).toEqual({ ok: false, reason: "LOCATION_NOT_FOUND" });
  });
});

describe("getAutoPolicy", () => {
  it("prefers the location's own row, falls back to org-wide, and never reads another org", async () => {
    const [second] = await db()
      .insert(locations)
      .values({ orgId: org.orgId, name: "Second", slug: `second-${randomUUID().slice(0, 8)}` })
      .returning({ id: locations.id });
    // From the tests above: task.open_internal is org-wide only; inventory.flag_recount has a row for org.locationId.
    const orgWide = await getAutoPolicy(org.orgId, "task.open_internal", second!.id);
    expect(orgWide).toMatchObject({ actionKind: "task.open_internal", locationId: null });

    await setAutoPolicy(input({ actionKind: "inventory.flag_recount", limits: { maxPerDay: 9 } }));
    expect(await getAutoPolicy(org.orgId, "inventory.flag_recount", org.locationId)).toMatchObject({ locationId: org.locationId });
    expect(await getAutoPolicy(org.orgId, "inventory.flag_recount", second!.id)).toMatchObject({ locationId: null });
    expect(await getAutoPolicy(org.orgId, "inventory.flag_recount", null)).toMatchObject({ locationId: null });

    expect(await getAutoPolicy(otherOrg.orgId, "task.open_internal", null)).toBeNull();
  });
});
