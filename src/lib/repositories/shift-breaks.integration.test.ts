/**
 * Shift breaks and the read-only till view (roadmap 6.4, owner change): times
 * only, one open break per shift, clock-out closes an open break, audited
 * manager correction, and till sessions shown without coupling.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, cashSessions, shiftBreaks, shifts } from "@/db/schema";
import { paise } from "@/lib/money";
import { clockIn, clockOut, correctBreak, endBreak, getOpenBreak, listShifts, listTillSessionsDuring, startBreak } from "./shifts";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

let org: TestOrg;
let other: TestOrg;
const p = randomUUID();
const q = randomUUID();
const manager = randomUUID();
const t = (hhmm: string) => new Date(`2026-09-14T${hhmm}:00Z`);

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

describe("breaks", () => {
  it("needs an open shift", async () => {
    expect(await startBreak(org.orgId, q)).toEqual({ ok: false, reason: "no_shift" });
  });

  it("a simultaneous double tap starts exactly one break and audits once", async () => {
    await clockIn(org.orgId, p, t("04:00"));
    const rs = await Promise.all([startBreak(org.orgId, p, t("07:00")), startBreak(org.orgId, p, t("07:00")), startBreak(org.orgId, p, t("07:00"))]);
    const oks = rs.flatMap((r) => (r.ok ? [r] : []));
    expect(oks.filter((r) => !r.alreadyOn)).toHaveLength(1);
    expect(new Set(oks.map((r) => r.breakId)).size).toBe(1);
    expect(await audits("shift_break_started")).toBe(1);
    expect(await getOpenBreak(org.orgId, p)).not.toBeNull();
  });

  it("ending a break twice changes nothing the second time", async () => {
    const first = await endBreak(org.orgId, p, t("07:30"));
    const second = await endBreak(org.orgId, p, t("07:31"));
    expect(first).toEqual({ ok: true, alreadyOff: false });
    expect(second).toEqual({ ok: true, alreadyOff: true });
    expect(await audits("shift_break_ended")).toBe(1);
    const [b] = await db().select().from(shiftBreaks).where(eq(shiftBreaks.orgId, org.orgId));
    expect(b?.endedAt?.toISOString()).toBe(t("07:30").toISOString());
  });

  it("clock-out while a break is open closes the break at the same instant", async () => {
    await startBreak(org.orgId, p, t("11:00"));
    await clockOut(org.orgId, p, t("11:20"));
    const rows = await db().select().from(shiftBreaks).where(eq(shiftBreaks.orgId, org.orgId));
    const closed = rows.find((r) => r.startedAt.getTime() === t("11:00").getTime());
    expect(closed?.endedAt?.toISOString()).toBe(t("11:20").toISOString());
    expect(await getOpenBreak(org.orgId, p)).toBeNull();
  });

  it("lists breaks with the shift, never another org's", async () => {
    await clockIn(other.orgId, randomUUID(), t("04:00"));
    const [s] = await listShifts(org.orgId, "2026-09-14", "2026-09-14");
    expect(s?.breaks).toHaveLength(2);
    expect(await listShifts(org.orgId, "2026-09-14", "2026-09-14")).toHaveLength(1);
  });
});

describe("correctBreak", () => {
  it("corrects a break with a reason and an audit row holding before and after", async () => {
    const [b] = await db().select().from(shiftBreaks).where(and(eq(shiftBreaks.orgId, org.orgId), eq(shiftBreaks.startedAt, t("07:00"))));
    const now = new Date("2026-09-15T00:00:00Z");
    const res = await correctBreak({ orgId: org.orgId, actorUserId: manager, breakId: b!.id, startedAt: t("07:00"), endedAt: t("07:45"), reason: "took longer" }, now);
    expect(res).toEqual({ ok: true });
    const [log] = await db().select().from(auditLogs).where(and(eq(auditLogs.entityId, b!.id), eq(auditLogs.action, "shift_break_corrected")));
    expect((log?.before as { endedAt: string }).endedAt).toBe(t("07:30").toISOString());
    expect((log?.after as { reason: string }).reason).toBe("took longer");
  });

  it("refuses no reason, a break outside its shift, an overlap, and another org's break", async () => {
    const rows = await db().select().from(shiftBreaks).where(eq(shiftBreaks.orgId, org.orgId));
    const first = rows.find((r) => r.startedAt.getTime() === t("07:00").getTime())!;
    const now = new Date("2026-09-15T00:00:00Z");
    const base = { orgId: org.orgId, actorUserId: manager, breakId: first.id, startedAt: t("07:00"), endedAt: t("07:45") };
    expect(await correctBreak({ ...base, reason: " " }, now)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await correctBreak({ ...base, startedAt: t("03:00"), reason: "x" }, now)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await correctBreak({ ...base, endedAt: t("11:10"), reason: "x" }, now)).toMatchObject({ ok: false, reason: "overlap" });
    expect(await correctBreak({ ...base, orgId: other.orgId, reason: "x" }, now)).toMatchObject({ ok: false, reason: "not_found" });
  });
});

describe("till sessions seen from a shift", () => {
  beforeAll(async () => {
    const [s] = await db().select().from(shifts).where(eq(shifts.orgId, org.orgId));
    expect(s).toBeDefined();
    await db().insert(cashSessions).values({ orgId: org.orgId, locationId: org.locationId, openedBy: p, openedAt: t("04:05"), openingFloat: paise(100_000n), status: "CLOSED", closedBy: p, closedAt: t("11:15"), countedCash: paise(150_000n), expectedCash: paise(160_000n), variance: paise(-10_000n) });
    // A session someone else ran, and one outside the shift.
    await db().insert(cashSessions).values({ orgId: org.orgId, locationId: org.locationId, openedBy: q, openedAt: t("05:00"), openingFloat: paise(0n) });
  });

  it("shows this person's opens and closes in the window, times only by default", async () => {
    const rows = await listTillSessionsDuring(org.orgId, p, t("04:00"), t("11:20"));
    expect(rows.map((r) => r.action)).toEqual(["opened", "closed"]);
    expect(JSON.stringify(rows)).not.toContain("variance");
    expect(rows.every((r) => r.figures === undefined)).toBe(true);
  });

  it("includes counted, expected and variance only when asked (the viewer holds finance.view)", async () => {
    const rows = await listTillSessionsDuring(org.orgId, p, t("04:00"), t("11:20"), true);
    expect(rows.find((r) => r.action === "closed")?.figures).toEqual({ counted: 150_000n, expected: 160_000n, variance: -10_000n });
  });

  it("ignores sessions outside the window and other orgs", async () => {
    expect(await listTillSessionsDuring(org.orgId, p, t("12:00"), t("13:00"))).toEqual([]);
    expect(await listTillSessionsDuring(other.orgId, p, t("04:00"), t("11:20"))).toEqual([]);
  });

  it("clocking in needs no till and a till needs no shift: a shift with no session reads as empty", async () => {
    expect(await listTillSessionsDuring(org.orgId, manager, t("04:00"), t("11:20"))).toEqual([]);
  });
});
