import { describe, expect, it } from "vitest";
import { classifyCloseResult } from "./delivery-close";

describe("classifyCloseResult", () => {
  it("is ok when the server closed the delivery", () => {
    expect(classifyCloseResult({ thrown: false, result: { ok: true } })).toEqual({ kind: "ok" });
  });

  it("is offline when calling the action threw — a network failure, not a server response", () => {
    expect(classifyCloseResult({ thrown: true })).toEqual({ kind: "offline" });
  });

  it("is closed-elsewhere on the server's exact lost-race message, not a generic error", () => {
    expect(classifyCloseResult({ thrown: false, result: { ok: false, error: "That delivery is already closed." } })).toEqual({
      kind: "closed-elsewhere",
    });
  });

  it("falls back to a plain error for any other server message", () => {
    expect(classifyCloseResult({ thrown: false, result: { ok: false, error: "That order has not left the shop yet." } })).toEqual({
      kind: "error",
      message: "That order has not left the shop yet.",
    });
  });

  it("falls back to a generic message when the server gave none", () => {
    expect(classifyCloseResult({ thrown: false, result: { ok: false } })).toEqual({
      kind: "error",
      message: "That didn't work.",
    });
  });
});
