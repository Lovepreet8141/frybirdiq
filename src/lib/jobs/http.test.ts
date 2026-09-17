import { describe, expect, it } from "vitest";

import { MemoryStore, type MemoryTx } from "./__test-support__/memory-store";
import { JOB_HOST } from "./auth";
import type { HandleDeps } from "./handle";
import { MAX_JOB_BODY_BYTES, respondToJobRequest } from "./http";

const SECRET = "s".repeat(40);
const NOW = new Date("2026-09-17T04:45:00Z"); // 10:15 IST

function deps(overrides: Partial<HandleDeps<MemoryTx>> = {}): HandleDeps<MemoryTx> & { store: MemoryStore } {
  const store = new MemoryStore(NOW);
  let n = 0;
  return {
    secrets: { current: SECRET, previous: undefined },
    store,
    newLeaseOwner: () => `owner-${++n}`,
    monotonicMs: () => 0,
    every: () => () => {},
    ...overrides,
  } as HandleDeps<MemoryTx> & { store: MemoryStore };
}

function post(options: { headers?: Record<string, string | null>; body?: string } = {}): Request {
  const headers = new Headers();
  const merged: Record<string, string | null> = {
    "x-forwarded-for": "127.0.0.1",
    host: JOB_HOST,
    authorization: `Bearer ${SECRET}`,
    ...options.headers,
  };
  for (const [name, value] of Object.entries(merged)) if (value !== null) headers.set(name, value);
  return new Request("http://127.0.0.1:3000/api/jobs/heartbeat", { method: "POST", headers, body: options.body });
}

async function expectEmpty(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(await response.text()).toBe("");
}

describe("job route responses (DESIGN §3, DESIGN-v2-DELTA §3)", () => {
  it("runs heartbeat and answers 200 with the report; a repeat is a no-op", async () => {
    const d = deps();
    const first = await respondToJobRequest(post(), "heartbeat", () => d);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toMatchObject({ job: "heartbeat", periods: ["2026-09-17T10"], counts: { SUCCEEDED: 1 } });
    expect(d.store.run("heartbeat", "org-a", "2026-09-17T10")?.status).toBe("SUCCEEDED");

    const second = await respondToJobRequest(post(), "heartbeat", () => d);
    expect(await second.json()).toMatchObject({ counts: { NOOP: 1 } });
  });

  it.each([
    ["JOB_SECRET unset", () => deps({ secrets: { current: undefined, previous: undefined } }), post()],
    ["wrong bearer", () => deps(), post({ headers: { authorization: `Bearer ${"x".repeat(40)}` } })],
    ["missing bearer", () => deps(), post({ headers: { authorization: null } })],
    ["foreign Host", () => deps(), post({ headers: { host: "frybirdiq.tech" } })],
    ["localhost Host", () => deps(), post({ headers: { host: "localhost:3000" } })],
    ["came through nginx", () => deps(), post({ headers: { "x-real-ip": "203.0.113.9" } })],
    ["public x-forwarded-for", () => deps(), post({ headers: { "x-forwarded-for": "203.0.113.9" } })],
    ["unparseable body", () => deps(), post({ body: "{period:" })],
    ["unknown body key", () => deps(), post({ body: JSON.stringify({ period: "2026-09-17T09", force: true }) })],
    ["oversized body", () => deps(), post({ body: JSON.stringify({ period: "x".repeat(MAX_JOB_BODY_BYTES) }) })],
  ] as const)("answers an empty 404 and writes nothing: %s", async (_name, makeDeps, request) => {
    const d = makeDeps();
    await expectEmpty(await respondToJobRequest(request, "heartbeat", () => d), 404);
    expect(d.store.runs.size).toBe(0);
  });

  it("answers an empty 404 for an unknown job", async () => {
    const d = deps();
    await expectEmpty(await respondToJobRequest(post(), "drop_tables", () => d), 404);
    await expectEmpty(await respondToJobRequest(post(), "__proto__", () => d), 404);
    expect(d.store.runs.size).toBe(0);
  });

  it("answers an empty 404 when the environment fails to load, never its message", async () => {
    const response = await respondToJobRequest(post(), "heartbeat", () => {
      throw new Error("Missing server environment variables: DATABASE_URL=postgresql://secret");
    });
    await expectEmpty(response, 404);
  });

  it("answers an empty 500 when the store fails before any work", async () => {
    const d = deps();
    d.store.listOrgIds = async () => {
      throw new Error("connect postgresql://user:pw@db/x refused");
    };
    await expectEmpty(await respondToJobRequest(post(), "heartbeat", () => d), 500);
  });

  it("accepts an empty body and a manual period", async () => {
    const d = deps();
    expect((await respondToJobRequest(post({ body: "" }), "heartbeat", () => d)).status).toBe(200);
    const manual = await respondToJobRequest(post({ body: JSON.stringify({ period: "2026-09-17T08" }) }), "heartbeat", () => d);
    expect(await manual.json()).toMatchObject({ periods: ["2026-09-17T08"], counts: { SUCCEEDED: 1 } });
  });
});

describe("body handling (review F1)", () => {
  const CHUNK = 64 * 1024;
  const TOTAL = 20 * 1024 * 1024;

  /** A chunked 20 MB body with no Content-Length that counts how much was actually pulled. */
  function chunkedOversize() {
    const counter = { pulled: 0 };
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (counter.pulled >= TOTAL) return controller.close();
          counter.pulled += CHUNK;
          controller.enqueue(new Uint8Array(CHUNK).fill(0x7b));
        },
      },
      { highWaterMark: 0 },
    );
    return { stream, counter };
  }

  const chunkedPost = (stream: ReadableStream<Uint8Array>, headers: Record<string, string>) =>
    new Request("http://127.0.0.1:3000/api/jobs/heartbeat", {
      method: "POST",
      headers,
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

  it("never reads the body of an unauthorized request, even a chunked 20 MB one", async () => {
    const d = deps();
    const { stream, counter } = chunkedOversize();
    const request = chunkedPost(stream, { "x-forwarded-for": "127.0.0.1", host: "frybirdiq.tech", authorization: `Bearer ${SECRET}` });
    expect(request.headers.get("content-length")).toBeNull();
    await expectEmpty(await respondToJobRequest(request, "heartbeat", () => d), 404);
    expect(counter.pulled).toBeLessThanOrEqual(CHUNK);
    expect(d.store.runs.size).toBe(0);
  });

  it("stops reading an authorized chunked body just past 1 KB", async () => {
    const d = deps();
    const { stream, counter } = chunkedOversize();
    const request = chunkedPost(stream, { "x-forwarded-for": "127.0.0.1", host: JOB_HOST, authorization: `Bearer ${SECRET}` });
    await expectEmpty(await respondToJobRequest(request, "heartbeat", () => d), 404);
    expect(counter.pulled).toBeLessThanOrEqual(2 * CHUNK);
    expect(d.store.runs.size).toBe(0);
  });

  it("refuses a body that is not valid UTF-8", async () => {
    const d = deps();
    const bytes = new Uint8Array([0x7b, 0xff, 0x7d]);
    const request = new Request("http://127.0.0.1:3000/api/jobs/heartbeat", {
      method: "POST",
      headers: { "x-forwarded-for": "127.0.0.1", host: JOB_HOST, authorization: `Bearer ${SECRET}` },
      body: bytes,
    });
    await expectEmpty(await respondToJobRequest(request, "heartbeat", () => d), 404);
  });
});
