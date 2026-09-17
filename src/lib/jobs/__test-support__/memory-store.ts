/**
 * An in-memory JobRunStore that enforces the same rules the SQL must:
 * unique (job, org, period), CAS takeovers, and the fence on every write.
 * Time is a controllable "database clock".
 */
import type { ClaimRead, ExpectedRow, JobRunRow, JobRunStatus, JobTrigger } from "../claim-decision";
import { LeaseLostError, fenceHolds, type LeaseToken } from "../fence";
import type { ClaimRequest, FinishOutcome, JobRunStore } from "../handle";
import type { JobReadRepos } from "../repos";

export type StoredRun = {
  id: string;
  job: string;
  orgId: string;
  periodKey: string;
  status: JobRunStatus;
  trigger: JobTrigger;
  attempt: number;
  failures: number;
  leaseOwner: string;
  leaseExpiresAt: Date;
  cursor: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  rowsWritten: number;
  summary: Record<string, number>;
};

export type MemoryTx = { write(value: string): void };

export class MemoryStore implements JobRunStore<MemoryTx> {
  nowMs: number;
  orgIds: string[];
  readonly runs = new Map<string, StoredRun>();
  /** Output committed through the fence, in order. */
  readonly committed: string[] = [];
  heartbeats = 0;
  readonly codeVersion = "test-code-version";
  heavyLive = false;
  private nextId = 1;

  constructor(now: Date, orgIds: string[] = ["org-a"]) {
    this.nowMs = now.getTime();
    this.orgIds = orgIds;
  }

  advance(seconds: number) {
    this.nowMs += seconds * 1000;
  }

  run(job: string, orgId: string, periodKey: string): StoredRun | undefined {
    return this.runs.get(`${job}|${orgId}|${periodKey}`);
  }

  seed(
    row: Omit<StoredRun, "id" | "errorCode" | "errorMessage" | "rowsWritten" | "summary" | "trigger" | "failures"> & {
      failures?: number;
    },
  ): StoredRun {
    const stored: StoredRun = {
      failures: 0,
      ...row,
      id: `run-${this.nextId++}`,
      trigger: "TIMER",
      errorCode: null,
      errorMessage: null,
      rowsWritten: 0,
      summary: {},
    };
    this.runs.set(`${row.job}|${row.orgId}|${row.periodKey}`, stored);
    return stored;
  }

  private byId(id: string): StoredRun | undefined {
    return [...this.runs.values()].find((r) => r.id === id);
  }

  private view(r: StoredRun): JobRunRow {
    return {
      id: r.id,
      status: r.status,
      attempt: r.attempt,
      failures: r.failures,
      leaseOwner: r.leaseOwner,
      leaseExpiresAt: new Date(r.leaseExpiresAt),
      cursor: r.cursor,
      errorCode: r.errorCode,
    };
  }

  private fenced(token: LeaseToken, leaseSeconds: number): StoredRun {
    const row = this.byId(token.runId);
    const now = new Date(this.nowMs);
    if (row === undefined || !fenceHolds(row, token, now)) throw new LeaseLostError(token);
    row.leaseExpiresAt = new Date(this.nowMs + leaseSeconds * 1000);
    return row;
  }

  async dbNow() {
    return new Date(this.nowMs);
  }

  async listOrgIds() {
    return this.orgIds;
  }

  async claim(req: ClaimRequest): Promise<ClaimRead> {
    const key = `${req.job}|${req.orgId}|${req.periodKey}`;
    const existing = this.runs.get(key);
    if (existing !== undefined) return { inserted: false, row: this.view(existing) };
    const row = this.seed({
      job: req.job,
      orgId: req.orgId,
      periodKey: req.periodKey,
      status: "RUNNING",
      attempt: 1,
      leaseOwner: req.leaseOwner,
      leaseExpiresAt: new Date(this.nowMs + req.leaseSeconds * 1000),
      cursor: null,
    });
    row.trigger = req.trigger;
    return { inserted: true, row: this.view(row) };
  }

  private matches(expected: ExpectedRow): StoredRun | null {
    const row = this.byId(expected.id);
    if (row === undefined) return null;
    const same =
      row.status === expected.status && row.attempt === expected.attempt && row.leaseOwner === expected.leaseOwner;
    return same ? row : null;
  }

  async takeover(
    expected: ExpectedRow,
    next: { attempt: number; failures: number; leaseOwner: string; trigger: JobTrigger; leaseSeconds: number; deadlineSeconds: number },
  ): Promise<JobRunRow | null> {
    const row = this.matches(expected);
    if (row === null) return null;
    if (row.status === "RUNNING" && row.leaseExpiresAt.getTime() > this.nowMs) return null;
    Object.assign(row, {
      status: "RUNNING",
      attempt: next.attempt,
      failures: next.failures,
      leaseOwner: next.leaseOwner,
      trigger: next.trigger,
      leaseExpiresAt: new Date(this.nowMs + next.leaseSeconds * 1000),
      errorCode: null,
    });
    return this.view(row);
  }

  async closeZombie(expected: ExpectedRow) {
    const row = this.matches(expected);
    if (row !== null && row.leaseExpiresAt.getTime() <= this.nowMs) {
      row.status = "FAILED";
      row.failures += 1;
      row.errorCode = "LEASE_EXPIRED";
    }
  }

  async commit<T>(token: LeaseToken, leaseSeconds: number, write: (tx: MemoryTx) => Promise<T>, cursor?: string): Promise<T> {
    this.fenced(token, leaseSeconds);
    const pending: string[] = [];
    const value = await write({ write: (v) => pending.push(v) });
    // Postgres gets this from the row lock the fence UPDATE holds (fence.ts C1);
    // with no locks here, re-check at commit instead.
    const row = this.fenced(token, leaseSeconds);
    this.committed.push(...pending);
    if (cursor !== undefined) row.cursor = cursor;
    return value;
  }

  async heartbeat(token: LeaseToken, leaseSeconds: number) {
    this.fenced(token, leaseSeconds);
    this.heartbeats += 1;
  }

  async finish(token: LeaseToken, outcome: FinishOutcome) {
    const row = this.fenced(token, 0);
    row.rowsWritten = outcome.rowsWritten;
    row.summary = { ...outcome.summary };
    switch (outcome.status) {
      case "SUCCEEDED":
        row.status = "SUCCEEDED";
        row.cursor = null;
        break;
      case "DEADLINE":
        row.status = "FAILED";
        row.errorCode = outcome.errorCode;
        row.errorMessage = null;
        row.cursor = outcome.cursor;
        row.failures = outcome.failures;
        break;
      case "FAILED":
        row.status = "FAILED";
        row.errorCode = outcome.errorCode;
        row.errorMessage = outcome.errorMessage;
        row.failures = outcome.failures;
        break;
    }
  }

  /** Reads have no in-memory backing; a job test that needs them must supply its own. */
  readRepos(token: LeaseToken): JobReadRepos {
    if (this.byId(token.runId) === undefined) throw new LeaseLostError(token);
    const unavailable = async (): Promise<never> => {
      throw new Error("memory store: no read repositories");
    };
    return {
      healLostRefundFollowUps: unavailable,
      countStuckRefundFollowUps: unavailable,
      factsHistoryStart: unavailable,
      factsReadyFor: unavailable,
      readDetectDays: unavailable,
      readFoodCostTarget: unavailable,
      checkFactsParity: unavailable,
      listInsights: unavailable,
      getInsight: unavailable,
      readFactFigures: unavailable,
      listOpenRecommendations: unavailable,
    };
  }

  async heavyRunLive() {
    return this.heavyLive;
  }
}
