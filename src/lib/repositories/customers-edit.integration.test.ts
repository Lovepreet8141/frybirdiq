/**
 * Customer edit (roadmap 7.1): corrects a wrong phone, scoped to the org,
 * idempotent, audited without personal data in the audit row.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, customers } from "@/db/schema";
import { getCustomerProfile, updateCustomer } from "./customers";
import { createTestCustomer, createTestOrg, deleteTestOrg, type TestCustomer, type TestOrg } from "./__test-support__/fixtures";

let org: TestOrg;
let other: TestOrg;
let alice: TestCustomer;
let bob: TestCustomer;
let foreign: TestCustomer;
const actor = randomUUID();

beforeAll(async () => {
  org = await createTestOrg();
  other = await createTestOrg();
  alice = await createTestCustomer(org.orgId);
  bob = await createTestCustomer(org.orgId);
  foreign = await createTestCustomer(other.orgId);
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
  await deleteTestOrg(other.orgId);
});

const auditCount = async () =>
  (await db().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.action, "customer_updated")))).length;

const edit = (over: Partial<Parameters<typeof updateCustomer>[0]> = {}) => ({
  orgId: org.orgId,
  actorUserId: actor,
  customerId: alice.id,
  name: "Test Alice",
  phone: "9000000001",
  email: null,
  notes: "prefers extra napkins",
  key: randomUUID(),
  ...over,
});

describe("updateCustomer", () => {
  it("corrects the phone, sets notes, and shows on the profile", async () => {
    expect(await updateCustomer(edit())).toMatchObject({ ok: true });
    const p = await getCustomerProfile(org.orgId, alice.id);
    expect(p).toMatchObject({ name: "Test Alice", phone: "9000000001", notes: "prefers extra napkins" });
  });

  it("refuses a phone that belongs to another customer of the same org, changing nothing", async () => {
    const r = await updateCustomer(edit({ phone: bob.phone, name: "Changed" }));
    expect(r).toMatchObject({ ok: false, reason: "phone_taken" });
    const p = await getCustomerProfile(org.orgId, alice.id);
    expect(p?.name).toBe("Test Alice");
  });

  it("allows the same phone in a different org's customer, but never edits across orgs", async () => {
    const r = await updateCustomer(edit({ customerId: foreign.id, name: "Hijack" }));
    expect(r).toMatchObject({ ok: false, reason: "not_found" });
    const [row] = await db().select({ name: customers.name }).from(customers).where(eq(customers.id, foreign.id));
    expect(row?.name).toBe("Test Customer");
  });

  it("is idempotent: a retried key replays and writes one audit row", async () => {
    const before = await auditCount();
    const input = edit({ notes: "note v2" });
    const first = await updateCustomer(input);
    const second = await updateCustomer(input);
    expect(second).toEqual(first);
    expect((await auditCount()) - before).toBe(1);
  });

  it("audits who, and what changed, without the phone number or note text", async () => {
    const number = "9000000077";
    await updateCustomer(edit({ phone: number, notes: "secret allergy detail" }));
    const rows = await db().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.action, "customer_updated")));
    const last = rows.at(-1)!;
    expect(last.actorUserId).toBe(actor);
    const dump = JSON.stringify([last.before, last.after]);
    expect(dump).not.toContain(number);
    expect(dump).not.toContain("secret allergy");
    expect(dump).toContain("0077");
  });
});
