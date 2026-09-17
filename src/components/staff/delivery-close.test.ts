import { describe, expect, it } from "vitest";
import { classifyCloseResult } from "./delivery-close";

describe("classifyCloseResult", () => {
  it("is ok when the server closed the delivery", () => {
    expect(classifyCloseResult({ thrown: false, result: { ok: true } })).toEqual({ kind: "ok" });
  });

  it("is offline when calling the action threw — a network failure, not a server response", () => {
    expect(classifyCloseResult({ thrown: true })).toEqual({ kind: "offline" });
  });

  it("is closed-elsewhere on the ALREADY_CLOSED code, the server's lost-race signal", () => {
    expect(
      classifyCloseResult({ thrown: false, result: { ok: false, code: "ALREADY_CLOSED", error: "That delivery is already closed." } }),
    ).toEqual({ kind: "closed-elsewhere" });
  });

  it("falls back to a plain error, showing the message, for any other code", () => {
    expect(
      classifyCloseResult({ thrown: false, result: { ok: false, code: "NOT_OUT_FOR_DELIVERY", error: "That order has not left the shop yet." } }),
    ).toEqual({ kind: "error", message: "That order has not left the shop yet." });
  });

  it("shows the message as-is for a server exception (SERVER_ERROR) too — it never rejects", () => {
    expect(
      classifyCloseResult({
        thrown: false,
        result: { ok: false, code: "SERVER_ERROR", error: "Something went wrong closing that delivery. Try again." },
      }),
    ).toEqual({ kind: "error", message: "Something went wrong closing that delivery. Try again." });
  });
});
