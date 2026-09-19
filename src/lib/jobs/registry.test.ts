import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { intradayBackfillDates, intradayRetentionFirstDate } from "@/lib/iq/metrics/intraday";
import { RECON_RULE_IDS } from "@/lib/iq/reconcile/rules";

import { DEFAULT_TIMING, HEAVY_JOB_NAMES, JOB_NAMES, JOB_REGISTRY, heavyJobNames, isJobName, type JobDefinition } from "./registry";

const JOBS_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(JOBS_DIR, "..", "..", "..");

describe("job registry (DESIGN §3, DESIGN-v2-DELTA §3)", () => {
  it("ships heartbeat (IQ-0), the three IQ-1 facts jobs, the IQ-2 detect, reconcile, brief and intraday backfill jobs and the ref-b7 refund healer", () => {
    expect(JOB_NAMES).toEqual([
      "heartbeat",
      "iq-facts-nightly",
      "iq-facts-intraday",
      "iq-facts-backfill",
      "iq-detect-daily",
      "iq-intraday-backfill",
      "iq-reconcile-nightly",
      "iq-brief-daily",
      "refund-followup-heal",
    ]);
    expect(isJobName("heartbeat")).toBe(true);
    expect(isJobName("constructor")).toBe(false);
  });

  it("lists heavy jobs from the registry: only the nightly facts job", () => {
    expect(HEAVY_JOB_NAMES).toEqual(["iq-facts-nightly"]);
    const fake = (name: string, concurrency: JobDefinition["concurrency"]): JobDefinition => ({
      ...JOB_REGISTRY.heartbeat,
      name,
      concurrency,
    });
    expect(heavyJobNames({ a: fake("a", "heavy"), b: fake("b", "light"), c: fake("c", "heavy") })).toEqual(["a", "c"]);
  });

  it("keeps every heavy job and every daily job, with all their systemd retries, clear of 21:45-23:00 UTC (backup)", () => {
    // deploy (S10): curl -m 290 per attempt, Restart=on-failure, RestartSec=360, 3 restarts.
    // One attempt lasts at most its deadline plus the commit grace, and never more than curl allows.
    const CURL_MAX_SECONDS = 290;
    const COMMIT_GRACE = 30;
    const RESTART_SEC = 360;
    const RESTARTS = 3;
    const WINDOW_START_MINUTE = 21 * 60 + 45;
    const WINDOW_END_MINUTE = 23 * 60;
    const daily = JOB_NAMES.filter((name) => /^\*-\*-\* \d{2}:\d{2}:00 UTC$/.test(JOB_REGISTRY[name].onCalendarUtc ?? ""));
    expect(daily).toEqual(expect.arrayContaining(["iq-facts-nightly", "iq-detect-daily", "iq-reconcile-nightly"]));
    for (const name of new Set([...HEAVY_JOB_NAMES, ...daily])) {
      const def = JOB_REGISTRY[name as keyof typeof JOB_REGISTRY];
      const match = /^\*-\*-\* (\d{2}):(\d{2}):00 UTC$/.exec(def.onCalendarUtc ?? "");
      expect(match, `${name} needs a fixed daily UTC start`).not.toBeNull();
      const startMinute = Number(match![1]) * 60 + Number(match![2]);
      const attemptSeconds = Math.min(CURL_MAX_SECONDS, def.deadlineSeconds + COMMIT_GRACE);
      const worstCaseEndMinute = startMinute + ((RESTARTS + 1) * attemptSeconds + RESTARTS * RESTART_SEC) / 60;
      const overlaps = startMinute < WINDOW_END_MINUTE && worstCaseEndMinute > WINDOW_START_MINUTE;
      expect(overlaps, `${name} ${def.onCalendarUtc} could run until minute ${worstCaseEndMinute}`).toBe(false);
    }
  });

  it("registers the IQ-2 jobs as designed (R2.8): detect after facts with a facts gate and catch-up 1, intraday backfill by hand", () => {
    expect(JOB_REGISTRY["iq-detect-daily"]).toMatchObject({
      periodKind: "day",
      target: "previous",
      onCalendarUtc: "*-*-* 21:15:00 UTC",
      deadlineSeconds: 60,
      catchUpPeriods: 1,
      concurrency: "light",
    });
    expect(JOB_REGISTRY["iq-intraday-backfill"]).toMatchObject({ periodKind: "day", target: "previous", onCalendarUtc: null, catchUpPeriods: 0, concurrency: "light" });
  });

  it("runs reconciliation before the detectors, with the same facts gate and catch-up (IQ-2 S4)", () => {
    expect(JOB_REGISTRY["iq-reconcile-nightly"]).toMatchObject({
      periodKind: "day",
      target: "previous",
      onCalendarUtc: "*-*-* 21:00:00 UTC",
      catchUpPeriods: 1,
      concurrency: "light",
    });
    // Every rule may spend its full statement timeout and the run must still have room to write.
    // 10 s is iq-recon.ts's RECON_STATEMENT_TIMEOUT_MS; that module is server-only, so it is repeated here.
    const RULE_TIMEOUT_SECONDS = 10;
    expect(JOB_REGISTRY["iq-reconcile-nightly"].deadlineSeconds).toBeGreaterThan(RECON_RULE_IDS.length * RULE_TIMEOUT_SECONDS);
    const hour = (name: keyof typeof JOB_REGISTRY) => /(\d{2}):(\d{2})/.exec(JOB_REGISTRY[name].onCalendarUtc ?? "")!.slice(1).join("");
    expect(hour("iq-facts-nightly") < hour("iq-reconcile-nightly")).toBe(true);
    expect(hour("iq-reconcile-nightly") < hour("iq-detect-daily")).toBe(true);
  });

  it("writes the brief's facts after the night's runs have had their retries, with the facts gate and no catch-up (IQ-2 S10)", () => {
    expect(JOB_REGISTRY["iq-brief-daily"]).toMatchObject({
      periodKind: "day",
      target: "previous",
      onCalendarUtc: "*-*-* 02:00:00 UTC",
      deadlineSeconds: 30,
      catchUpPeriods: 0,
      concurrency: "light",
    });
  });

  it("starts the intraday backfill inside the 63-day retention it is purged by (RELIABILITY C7)", () => {
    for (const today of ["2026-09-17", "2026-03-01", "2027-01-01"]) {
      const dates = intradayBackfillDates(today);
      expect(dates[0]! >= intradayRetentionFirstDate(today)).toBe(true);
      expect(dates.at(-1)! < today).toBe(true);
    }
  });

  it("registers at most one heavy job until heavy exclusion takes a lock (RELIABILITY, s7b)", () => {
    // heavyRunLive is check-then-claim: two different heavy jobs starting together could both run.
    expect(HEAVY_JOB_NAMES.length).toBeLessThanOrEqual(1);
  });

  it("schedules the facts jobs as designed: nightly 03:00 IST for yesterday, intraday every IST quarter for today, backfill by hand", () => {
    expect(JOB_REGISTRY["iq-facts-nightly"]).toMatchObject({ periodKind: "day", target: "previous", onCalendarUtc: "*-*-* 20:30:00 UTC", catchUpPeriods: 0 });
    expect(JOB_REGISTRY["iq-facts-intraday"]).toMatchObject({
      periodKind: "quarter_hour",
      target: "current",
      onCalendarUtc: "*-*-* *:00/15:00 UTC",
      catchUpPeriods: 0,
      concurrency: "light",
    });
    expect(JOB_REGISTRY["iq-facts-backfill"]).toMatchObject({ periodKind: "day", onCalendarUtc: null, catchUpPeriods: 0 });
  });

  it("uses lease 300s, heartbeat 60s, deadline 240s, 3 attempts", () => {
    expect(DEFAULT_TIMING).toEqual({ leaseSeconds: 300, heartbeatSeconds: 60, deadlineSeconds: 240, maxAttempts: 3 });
  });

  it.each(JOB_NAMES)("%s: timing is internally safe", (name) => {
    const def = JOB_REGISTRY[name];
    expect(def.name).toBe(name);
    // A URL segment and a systemd instance name: lower-case letters, digits, - and _.
    expect(name).toMatch(/^[a-z][a-z0-9_-]*$/);
    // Several heartbeats fit in one lease, so one slow heartbeat does not lose it.
    expect(def.heartbeatSeconds * 2).toBeLessThan(def.leaseSeconds);
    // The job stops before its lease could lapse and before curl -m 290 and Node's 300s requestTimeout.
    expect(def.deadlineSeconds).toBeLessThan(def.leaseSeconds);
    expect(def.deadlineSeconds).toBeLessThan(290);
    expect(def.maxAttempts).toBeGreaterThanOrEqual(1);
    expect(def.catchUpPeriods).toBeGreaterThanOrEqual(0);
    if (def.onCalendarUtc !== null) expect(def.onCalendarUtc).toMatch(/ UTC$/);
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
