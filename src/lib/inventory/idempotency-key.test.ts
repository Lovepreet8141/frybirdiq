import { describe, expect, it } from "vitest";
import { isSettledFormStatus } from "./idempotency-key";

describe("isSettledFormStatus", () => {
  it("is not settled while idle — no submission has happened yet", () => {
    expect(isSettledFormStatus("idle")).toBe(false);
  });

  it("is settled on success", () => {
    expect(isSettledFormStatus("success")).toBe(true);
  });

  it("is settled on error — a validation failure the manager will fix and resubmit with different content", () => {
    expect(isSettledFormStatus("error")).toBe(true);
  });
});
