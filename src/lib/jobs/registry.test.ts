import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEFAULT_TIMING, HEAVY_JOB_NAMES, JOB_NAMES, JOB_REGISTRY, heavyJobNames, isJobName, type JobDefinition } from "./registry";

const JOBS_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(JOBS_DIR, "..", "..", "..");

describe("job registry (DESIGN §3, DESIGN-v2-DELTA §3)", () => {
  it("ships only heartbeat in IQ-0", () => {
    expect(JOB_NAMES).toEqual(["heartbeat"]);
    expect(isJobName("heartbeat")).toBe(true);
    expect(isJobName("constructor")).toBe(false);
  });

  it("lists heavy jobs from the registry: none today, since heartbeat is light", () => {
    expect(HEAVY_JOB_NAMES).toEqual([]);
    const fake = (name: string, concurrency: JobDefinition["concurrency"]): JobDefinition => ({
      ...JOB_REGISTRY.heartbeat,
      name,
      concurrency,
    });
    expect(heavyJobNames({ a: fake("a", "heavy"), b: fake("b", "light"), c: fake("c", "heavy") })).toEqual(["a", "c"]);
  });

  it("uses lease 300s, heartbeat 60s, deadline 240s, 3 attempts", () => {
    expect(DEFAULT_TIMING).toEqual({ leaseSeconds: 300, heartbeatSeconds: 60, deadlineSeconds: 240, maxAttempts: 3 });
  });

  it.each(JOB_NAMES)("%s: timing is internally safe", (name) => {
    const def = JOB_REGISTRY[name];
    expect(def.name).toBe(name);
    expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    // Several heartbeats fit in one lease, so one slow heartbeat does not lose it.
    expect(def.heartbeatSeconds * 2).toBeLessThan(def.leaseSeconds);
    // The job stops before its lease could lapse and before curl -m 290 and Node's 300s requestTimeout.
    expect(def.deadlineSeconds).toBeLessThan(def.leaseSeconds);
    expect(def.deadlineSeconds).toBeLessThan(290);
    expect(def.maxAttempts).toBeGreaterThanOrEqual(1);
    expect(def.catchUpPeriods).toBeGreaterThanOrEqual(0);
    expect(def.onCalendarUtc).toMatch(/ UTC$/);
  });

  it("keeps each installed timer in step with the registry", () => {
    const dir = join(REPO_ROOT, "deploy");
    const timers = existsSync(dir) ? readdirSync(dir).filter((f) => /^frybird-job-.+\.timer$/.test(f)) : [];
    for (const file of timers) {
      const job = file.replace(/^frybird-job-/, "").replace(/\.timer$/, "");
      expect(isJobName(job), `${file} has no registry entry`).toBe(true);
      const onCalendar = /^OnCalendar=(.+)$/m.exec(readFileSync(join(dir, file), "utf8"))?.[1]?.trim();
      expect(onCalendar, file).toBe(JOB_REGISTRY[job as keyof typeof JOB_REGISTRY].onCalendarUtc);
    }
  });
});

describe("what job code may import (DESIGN §3, review T5; mirrors QA's eslint rules)", () => {
  const ROUTE_DIR = join(REPO_ROOT, "src", "app", "api", "jobs");

  /** Every job file and the route that wires it. */
  const EVERYWHERE = [
    /["']@\/db(\/|["'])/,
    /["']drizzle-orm/,
    /["']postgres["']/,
    /["']pg["']/,
    /["']@supabase\//,
    /["']@\/lib\/supabase/,
    /["']@\/lib\/payments/,
    /["']@\/lib\/finance/,
    // A repository, but only an iq-* one (wiring and type-only contracts).
    /["']@\/lib\/repositories\/(?!iq-)/,
    /["']react["']/,
  ];
  /** src/lib/jobs: no framework and no secrets — both arrive through the route. */
  const LIBRARY = [/["']next\//, /["']@\/lib\/env/];
  /** src/lib/jobs/jobs: an individual job reaches the database only through ctx (SECURITY condition). */
  const JOB = [/["']@\/lib\/repositories/, /["'](\.\.\/)+.*repositories/, /["']@\/db/];

  const walk = (dir: string, out: string[] = []) => {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) out.push(path);
    }
    return out;
  };
  const files = [...walk(JOBS_DIR), ...walk(ROUTE_DIR)];
  const rel = (path: string) => path.slice(REPO_ROOT.length + 1);

  it("scans the job sources and the route", () => {
    expect(files.some((f) => f.endsWith("heartbeat.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith(join("[job]", "route.ts")))).toBe(true);
  });

  it.each(files.map((f) => [rel(f), f]))("%s imports only what its layer allows", (_rel, path) => {
    const source = readFileSync(path, "utf8");
    const imports = source.split("\n").filter((line) => /\bfrom\s+["']|^\s*import\s+["']|\bimport\(/.test(line));
    const rules = [
      ...EVERYWHERE,
      ...(path.startsWith(JOBS_DIR) ? LIBRARY : []),
      ...(path.startsWith(join(JOBS_DIR, "jobs")) ? JOB : []),
    ];
    for (const pattern of rules) expect(imports.filter((line) => pattern.test(line)), String(pattern)).toEqual([]);
  });

  it("would catch a job that imports a repository or the database directly", () => {
    const probe = ['import { writeInsight } from "@/lib/repositories/iq-insights";', 'import { db } from "@/db";'];
    for (const line of probe) expect(JOB.some((pattern) => pattern.test(line))).toBe(true);
    expect(EVERYWHERE.some((pattern) => pattern.test('import { placeOrder } from "@/lib/repositories/orders";'))).toBe(true);
    expect(EVERYWHERE.some((pattern) => pattern.test('import type { JobTx } from "@/lib/repositories/iq-job-runs";'))).toBe(false);
  });
});
