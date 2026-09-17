import { timingSafeEqual } from "node:crypto";

import { describe, expect, it } from "vitest";

import { JOB_HOST, authorizeJobRequest, type JobSecrets } from "./auth";
import { isJobName } from "./registry";

const CURRENT = "c".repeat(40);
const PREVIOUS = "p".repeat(40);
const secrets: JobSecrets = { current: CURRENT, previous: PREVIOUS };

const valid: Record<string, string> = {
  "x-forwarded-for": "127.0.0.1",
  host: JOB_HOST,
  authorization: `Bearer ${CURRENT}`,
};

const headers = (overrides: Record<string, string | null> = {}) => {
  const merged: Record<string, string | null> = { ...valid, ...overrides };
  return { get: (name: string) => merged[name.toLowerCase()] ?? null };
};

const authorize = (h = headers(), job = "heartbeat", s = secrets) => authorizeJobRequest(h, job, s, isJobName);

describe("job request auth (DESIGN-v2-DELTA §3)", () => {
  it("accepts the local timer with the current secret", () => {
    expect(authorize()).toEqual({ ok: true, job: "heartbeat" });
  });

  it("accepts the previous secret during rotation", () => {
    expect(authorize(headers({ authorization: `Bearer ${PREVIOUS}` }))).toEqual({ ok: true, job: "heartbeat" });
  });

  it("is dormant without a usable JOB_SECRET, even if a previous one is set and presented", () => {
    const h = headers({ authorization: `Bearer ${PREVIOUS}` });
    expect(authorize(h, "heartbeat", { current: undefined, previous: PREVIOUS })).toEqual({ ok: false, reason: "DORMANT" });
    expect(authorize(h, "heartbeat", { current: "", previous: PREVIOUS })).toEqual({ ok: false, reason: "DORMANT" });
    expect(authorize(headers({ authorization: "Bearer short" }), "heartbeat", { current: "short", previous: undefined })).toEqual({
      ok: false,
      reason: "DORMANT",
    });
  });

  it("refuses anything that came through nginx", () => {
    expect(authorize(headers({ "x-real-ip": "203.0.113.9" }))).toEqual({ ok: false, reason: "REAL_IP_PRESENT" });
    expect(authorize(headers({ "x-real-ip": "127.0.0.1" }))).toEqual({ ok: false, reason: "REAL_IP_PRESENT" });
    expect(authorize(headers({ "x-real-ip": "" }))).toEqual({ ok: false, reason: "REAL_IP_PRESENT" });
  });

  it("requires x-forwarded-for, every hop loopback", () => {
    expect(authorize(headers({ "x-forwarded-for": null }))).toEqual({ ok: false, reason: "FORWARDED_FOR_MISSING" });
    expect(authorize(headers({ "x-forwarded-for": " " }))).toEqual({ ok: false, reason: "FORWARDED_FOR_MISSING" });
    for (const ok of ["::1", "::ffff:127.0.0.1", "127.0.0.1, ::1", "127.0.0.1,127.0.0.1"]) {
      expect(authorize(headers({ "x-forwarded-for": ok })).ok).toBe(true);
    }
    for (const bad of ["203.0.113.9", "203.0.113.9, 127.0.0.1", "127.0.0.1, 10.0.0.2", "127.0.0.2", "localhost", "127.0.0.1,"]) {
      expect(authorize(headers({ "x-forwarded-for": bad }))).toEqual({ ok: false, reason: "FORWARDED_FOR_NOT_LOOPBACK" });
    }
  });

  it("requires Host to be exactly 127.0.0.1:3000", () => {
    for (const host of ["localhost:3000", "127.0.0.1", "frybirdiq.tech", "127.0.0.1:3001", "[::1]:3000"]) {
      expect(authorize(headers({ host }))).toEqual({ ok: false, reason: "HOST_MISMATCH" });
    }
    expect(authorize(headers({ host: null }))).toEqual({ ok: false, reason: "HOST_MISMATCH" });
  });

  it("refuses a wrong, missing or malformed bearer", () => {
    for (const authorization of [`Bearer ${"x".repeat(40)}`, `Bearer ${CURRENT}x`, CURRENT, `bearer ${CURRENT}`, "Bearer ", null]) {
      expect(authorize(headers({ authorization }))).toEqual({ ok: false, reason: "BAD_SECRET" });
    }
  });

  it("ignores a too-short previous secret", () => {
    expect(
      authorize(headers({ authorization: "Bearer short" }), "heartbeat", { current: CURRENT, previous: "short" }),
    ).toEqual({ ok: false, reason: "BAD_SECRET" });
  });

  it("always compares against both secrets, as fixed-length digests", () => {
    const calls: [Buffer, Buffer][] = [];
    const compare = (a: Buffer, b: Buffer) => (calls.push([a, b]), timingSafeEqual(a, b));
    for (const [authorization, s] of [
      [`Bearer ${CURRENT}`, secrets],
      [`Bearer ${PREVIOUS}`, secrets],
      ["Bearer wrong", secrets],
      [null, { current: CURRENT, previous: undefined }],
    ] as const) {
      calls.length = 0;
      authorizeJobRequest(headers({ authorization }), "heartbeat", s, isJobName, compare);
      expect(calls).toHaveLength(2);
      for (const [a, b] of calls) {
        expect(a.length).toBe(32);
        expect(b.length).toBe(32);
      }
    }
  });

  it("reveals an unknown job only after the secret is right", () => {
    expect(authorize(headers(), "drop_tables")).toEqual({ ok: false, reason: "UNKNOWN_JOB" });
    expect(authorize(headers({ authorization: "Bearer wrong" }), "drop_tables")).toEqual({ ok: false, reason: "BAD_SECRET" });
    expect(authorize(headers(), "toString")).toEqual({ ok: false, reason: "UNKNOWN_JOB" });
  });

  it("checks in the designed order", () => {
    const everythingWrong = headers({
      "x-real-ip": "203.0.113.9",
      "x-forwarded-for": "203.0.113.9",
      host: "frybirdiq.tech",
      authorization: "Bearer wrong",
    });
    expect(authorize(everythingWrong, "nope", { current: undefined, previous: undefined })).toMatchObject({ reason: "DORMANT" });
    expect(authorize(everythingWrong, "nope")).toMatchObject({ reason: "REAL_IP_PRESENT" });
    expect(authorize(headers({ "x-forwarded-for": "203.0.113.9", host: "x", authorization: null }), "nope")).toMatchObject({
      reason: "FORWARDED_FOR_NOT_LOOPBACK",
    });
    expect(authorize(headers({ host: "x", authorization: null }), "nope")).toMatchObject({ reason: "HOST_MISMATCH" });
    expect(authorize(headers({ authorization: null }), "nope")).toMatchObject({ reason: "BAD_SECRET" });
  });
});
