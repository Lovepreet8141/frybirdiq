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

describe("what job code may import (DESIGN §3, review T5)", () => {
  const FORBIDDEN = [
    /["']@\/db(\/|["'])/,
    /["']drizzle-orm/,
    /["']postgres["']/,
    /["']@\/lib\/supabase/,
    /["']@\/lib\/payments/,
    /["']@\/lib\/repositories\/(orders|payments|refunds|invoices|expenses|finance|cash)/,
    /["']@\/lib\/finance/,
    /["']next\//,
    /["']react["']/,
  ];

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) files.push(path);
    }
  };
  walk(JOBS_DIR);

  it("scans the job sources", () => {
    expect(files.some((f) => f.endsWith("heartbeat.ts"))).toBe(true);
  });

  it.each(files.map((f) => [f.slice(JOBS_DIR.length)]))("%s imports no database, money writer or framework", (rel) => {
    const source = readFileSync(join(JOBS_DIR, rel), "utf8");
    const imports = source.split("\n").filter((line) => /\bfrom\s+["']|^\s*import\s+["']|\bimport\(/.test(line));
    for (const pattern of FORBIDDEN) expect(imports.filter((line) => pattern.test(line))).toEqual([]);
  });
});
