/**
 * 0039_ordering_pause against the real local database: the columns behind the
 * Close Shop switch (ops-1, S2).
 *
 * - Every org starts, and existing orgs stay, "taking orders" (all null).
 * - organizations_ordering_pause_check: paused_at and paused_by are set
 *   together (every pause has a person behind it); the reason and
 *   paused_until are null whenever not paused; a reason is 1-200 characters;
 *   paused_until is after paused_at.
 * - The down file, run inside a transaction that is rolled back: it refuses
 *   while any org's pause is in force, manual-only or ending later (dropping
 *   the columns would silently reopen the shop), lets a pause that has already
 *   ended through, sets a 5 s lock timeout, and otherwise removes exactly
 *   what 0039 added.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, isNotNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
  return undefined;
}

type Pause = Partial<Pick<typeof organizations.$inferInsert, "orderingPausedAt" | "orderingPausedBy" | "orderingPausedReason" | "orderingPausedUntil">>;

const setPause = (org: TestOrg, pause: Pause) => db().update(organizations).set(pause).where(eq(organizations.id, org.orgId));

const RESUMED: Pause = { orderingPausedAt: null, orderingPausedBy: null, orderingPausedReason: null, orderingPausedUntil: null };

const ALL_COLUMNS = ["ordering_paused_at", "ordering_paused_by", "ordering_paused_reason", "ordering_paused_until"];

const HOUR = 60 * 60 * 1000;

const pauseColumns = async (tx: Pick<ReturnType<typeof db>, "execute"> = db()) =>
  (
    await tx.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name LIKE 'ordering\_paused\_%'
      ORDER BY column_name
    `)
  ).map((r) => r.column_name);

describe("0039 — organizations ordering pause columns", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
  });

  afterAll(async () => {
    if (org) await deleteTestOrg(org.orgId);
  });

  const readPause = async () =>
    (
      await db()
        .select({
          at: organizations.orderingPausedAt,
          by: organizations.orderingPausedBy,
          reason: organizations.orderingPausedReason,
          until: organizations.orderingPausedUntil,
        })
        .from(organizations)
        .where(eq(organizations.id, org.orgId))
    )[0];

  it("a new org is taking orders: all four columns null", async () => {
    expect(await readPause()).toEqual({ at: null, by: null, reason: null, until: null });
  });

  it("accepts a pause until the next opening, and a resume that clears all four", async () => {
    const at = new Date("2026-09-20T13:12:00.000Z");
    const until = new Date("2026-09-21T06:00:00.000Z"); // 11:30 IST next day
    const by = randomUUID();
    await setPause(org, { orderingPausedAt: at, orderingPausedBy: by, orderingPausedReason: "Fryer down", orderingPausedUntil: until });
    expect(await readPause()).toEqual({ at, by, reason: "Fryer down", until });

    await setPause(org, RESUMED);
    expect(await readPause()).toEqual({ at: null, by: null, reason: null, until: null });
  });

  it("accepts a manual-only pause: paused_until null while paused", async () => {
    expect(await sqlState(setPause(org, { orderingPausedAt: new Date(), orderingPausedBy: randomUUID(), orderingPausedReason: "Until I say" }))).toBeUndefined();
    await setPause(org, RESUMED);
  });

  it("accepts a pause without a reason (the DB is looser than the staff form)", async () => {
    expect(await sqlState(setPause(org, { orderingPausedAt: new Date(), orderingPausedBy: randomUUID() }))).toBeUndefined();
    await setPause(org, RESUMED);
  });

  it("accepts a 200-character reason and refuses 201", async () => {
    const pause = { orderingPausedAt: new Date(), orderingPausedBy: randomUUID() };
    expect(await sqlState(setPause(org, { ...pause, orderingPausedReason: "x".repeat(200) }))).toBeUndefined();
    await setPause(org, RESUMED);
    expect(await sqlState(setPause(org, { ...pause, orderingPausedReason: "x".repeat(201) }))).toBe("23514");
  });

  it.each<[string, Pause]>([
    ["paused_until while not paused", { orderingPausedUntil: new Date(Date.now() + HOUR) }],
    ["paused_until equal to paused_at", { orderingPausedAt: new Date("2026-09-20T13:00:00Z"), orderingPausedBy: randomUUID(), orderingPausedUntil: new Date("2026-09-20T13:00:00Z") }],
    ["paused_until before paused_at", { orderingPausedAt: new Date("2026-09-20T13:00:00Z"), orderingPausedBy: randomUUID(), orderingPausedUntil: new Date("2026-09-20T12:00:00Z") }],
    ["paused_at without paused_by (a pause with no person behind it)", { orderingPausedAt: new Date() }],
    ["paused_by without paused_at", { orderingPausedBy: randomUUID() }],
    ["a reason while not paused", { orderingPausedReason: "left over" }],
    ["an empty reason", { orderingPausedAt: new Date(), orderingPausedBy: randomUUID(), orderingPausedReason: "" }],
  ])("refuses %s", async (_label, pause) => {
    expect(await sqlState(setPause(org, { ...RESUMED, ...pause }))).toBe("23514");
  });
});

/** The down file's body without its own BEGIN/COMMIT, to run inside a transaction the test rolls back. */
function downBody(): string {
  const file = readFileSync(join(__dirname, "../../../supabase/rollback/0039_ordering_pause.down.sql"), "utf8");
  const begin = file.indexOf("\nBEGIN;\n");
  const commit = file.lastIndexOf("\nCOMMIT;");
  if (begin < 0 || commit < begin) throw new Error("ordering-pause-0039: down file has no BEGIN/COMMIT block");
  return file.slice(begin + "\nBEGIN;\n".length, commit);
}

class RollBack extends Error {}

describe("0039 — the down file (run inside a rolled-back transaction)", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
    // The guard reads the whole table: no pause from another file may linger.
    await db().update(organizations).set(RESUMED).where(isNotNull(organizations.orderingPausedAt));
  });

  afterAll(async () => {
    if (org) await deleteTestOrg(org.orgId);
  });

  const runDown = async () => {
    let message = "";
    const state = await sqlState(
      db()
        .transaction(async (tx) => {
          await tx.execute(sql.raw(downBody()));
          throw new RollBack();
        })
        .catch((error: unknown) => {
          if (error instanceof RollBack) return;
          message = (error as { cause?: { message?: string } }).cause?.message ?? "";
          throw error;
        }),
    );
    return { state, message };
  };

  it("refuses while a pause ending later is in force, naming it", async () => {
    const until = new Date(Date.now() + 3 * HOUR);
    await setPause(org, { orderingPausedAt: new Date(), orderingPausedBy: randomUUID(), orderingPausedUntil: until });
    const { state, message } = await runDown();
    expect(state).toBe("55000");
    expect(message).toContain(org.slug);
    expect(message).toContain("until 20");
    expect(await pauseColumns()).toEqual(ALL_COLUMNS);
    await setPause(org, RESUMED);
  });

  it("lets a pause that has already ended through: it counts as open, so nothing reopens", async () => {
    await setPause(org, {
      orderingPausedAt: new Date(Date.now() - 3 * HOUR),
      orderingPausedBy: randomUUID(),
      orderingPausedUntil: new Date(Date.now() - HOUR),
    });
    expect(await runDown()).toEqual({ state: undefined, message: "" });
    expect(await pauseColumns()).toEqual(ALL_COLUMNS);
    await setPause(org, RESUMED);
  });

  it("refuses while a manual-only pause is in force, naming it, and changes nothing", async () => {
    await setPause(org, { orderingPausedAt: new Date(), orderingPausedBy: randomUUID(), orderingPausedReason: "Power cut" });
    let message = "";
    const state = await sqlState(
      db()
        .transaction(async (tx) => {
          await tx.execute(sql.raw(downBody()));
        })
        .catch((error: { cause?: { message?: string } }) => {
          message = error.cause?.message ?? "";
          throw error;
        }),
    );
    expect(state).toBe("55000");
    expect(message).toContain(org.slug);
    expect(message).toContain("silently reopens");
    expect(message).toContain("until switched back on");
    expect(await pauseColumns()).toEqual(ALL_COLUMNS);
    await setPause(org, RESUMED);
  });

  it("with no org paused, sets a 5 s lock timeout and removes exactly 0039's columns and constraint", async () => {
    await expect(
      db().transaction(async (tx) => {
        await tx.execute(sql.raw(downBody()));
        const [timeout] = await tx.execute<{ lock_timeout: string }>(sql`SHOW lock_timeout`);
        expect(timeout?.lock_timeout).toBe("5s");
        expect(await pauseColumns(tx)).toEqual([]);
        const [leftover] = await tx.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM pg_constraint
          WHERE conrelid = 'public.organizations'::regclass AND conname = 'organizations_ordering_pause_check'
        `);
        expect(leftover?.n).toBe(0);
        const [kept] = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM organizations WHERE id = ${org.orgId}`);
        expect(kept?.n).toBe(1);
        throw new RollBack();
      }),
    ).rejects.toBeInstanceOf(RollBack);
    expect(await pauseColumns()).toEqual(ALL_COLUMNS);
  });
});
