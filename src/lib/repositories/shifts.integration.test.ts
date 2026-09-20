/**
 * Basic shifts (roadmap 6.4): one open shift per person, idempotent clock in
 * and out, org scoping, audited manager correction, IST business date.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, shifts } from "@/db/schema";
import { clockIn, clockOut, correctShift, getOpenShift, listOnShiftNow, listShifts } from "./shifts";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

let org: TestOrg;
let other: TestOrg;
const a = randomUUID();
const b = randomUUID();
const manager = randomUUID();

beforeAll(async () => {
  org = await createTestOrg();
  other = await createTestOrg();
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
  await deleteTestOrg(other.orgId);
});

const audits = async (action: string) =>
  (await db().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.action, action)))).length;

describe("clock in and out", () => {
  it("a simultaneous double tap opens exactly one shift and one audit row", async () => {
    const results = await Promise.all([clockIn(org.orgId, a), clockIn(org.orgId, a), clockIn(org.orgId, a)]);
    expect(results.filter((r) => !r.alreadyOn)).toHaveLength(1);
    expect(new Set(results.map((r) => r.shiftId)).size).toBe(1);
    const open = await db().select().from(shifts).where(and(eq(shifts.orgId, org.orgId), eq(shifts.userId, a)));
    expect(open).toHaveLength(1);
    expect(await audits("shift_clock_in")).toBe(1);
  });

  it("the shift's business date is the IST day: 23:30 UTC is already tomorrow in Ambala", async () => {
    const r = await clockIn(org.orgId, b, new Date("2026-09-10T23:30:00Z"));
    const [row] = await db().select().from(shifts).where(eq(shifts.id, r.shiftId));
    expect(row?.businessDate).toBe("2026-09-11");
    await clockOut(org.orgId, b, new Date("2026-09-11T03:30:00Z"));
  });

  it("who is on shift now lists only open shifts of this org", async () => {
    await clockIn(other.orgId, randomUUID());
    const on = await listOnShiftNow(org.orgId);
    expect(on.map((s) => s.userId)).toEqual([a]);
  });

  it("clock out closes it once; a second tap changes nothing and audits nothing", async () => {
    const first = await clockOut(org.orgId, a);
    const second = await clockOut(org.orgId, a);
    expect(first).toMatchObject({ ok: true, alreadyOff: false });
    expect(second).toEqual({ ok: true, alreadyOff: true });
    expect(await getOpenShift(org.orgId, a)).toBeNull();
    expect(await audits("shift_clock_out")).toBe(2); // b's earlier clock-out plus a's
  });

  it("can clock in again after clocking out", async () => {
    const r = await clockIn(org.orgId, a);
    expect(r.alreadyOn).toBe(false);
    await clockOut(org.orgId, a);
  });
});

describe("correctShift", () => {
  it("fixes a forgotten clock-out with an audit row that keeps before and after", async () => {
    const r = await clockIn(org.orgId, manager, new Date("2026-09-12T04:00:00Z"));
    const res = await correctShift(
      { orgId: org.orgId, actorUserId: manager, shiftId: r.shiftId, clockInAt: new Date("2026-09-12T04:00:00Z"), clockOutAt: new Date("2026-09-12T12:00:00Z"), reason: "forgot to clock out" },
      new Date("2026-09-13T00:00:00Z"),
    );
    expect(res).toEqual({ ok: true });
    const [row] = await db().select().from(shifts).where(eq(shifts.id, r.shiftId));
    expect(row?.clockOutAt?.toISOString()).toBe("2026-09-12T12:00:00.000Z");
    expect(row?.correctedBy).toBe(manager);
    const [log] = await db().select().from(auditLogs).where(and(eq(auditLogs.entityId, r.shiftId), eq(auditLogs.action, "shift_corrected")));
    expect((log?.before as { clockOutAt: unknown }).clockOutAt).toBeNull();
    expect((log?.after as { reason: string }).reason).toBe("forgot to clock out");
  });

  it("refuses a missing reason, an inverted range, and another org's shift", async () => {
    const [mine] = await listShifts(org.orgId, "2026-09-12", "2026-09-12");
    const base = { orgId: org.orgId, actorUserId: manager, shiftId: mine!.id, clockInAt: new Date("2026-09-12T04:00:00Z"), clockOutAt: new Date("2026-09-12T12:00:00Z") };
    const now = new Date("2026-09-13T00:00:00Z");
    expect(await correctShift({ ...base, reason: "  " }, now)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await correctShift({ ...base, clockOutAt: new Date("2026-09-12T03:00:00Z"), reason: "x" }, now)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await correctShift({ ...base, orgId: other.orgId, reason: "x" }, now)).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("refuses to reopen a shift while the person has another one open", async () => {
    const open = await clockIn(org.orgId, manager);
    const [old] = (await listShifts(org.orgId, "2026-09-12", "2026-09-12")).filter((s) => s.userId === manager);
    const res = await correctShift({ orgId: org.orgId, actorUserId: a, shiftId: old!.id, clockInAt: old!.clockInAt, clockOutAt: null, reason: "reopen" }, new Date("2026-09-13T00:00:00Z"));
    expect(res).toEqual({ ok: false, reason: "other_open" });
    expect(open.alreadyOn).toBe(false);
  });
});
