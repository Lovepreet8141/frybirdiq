import { describe, expect, it } from "vitest";
import { summariseBulk } from "./bulk";

describe("summariseBulk", () => {
  it("is a plain success when nothing failed", () => {
    expect(summariseBulk(3, [])).toEqual({ ok: true });
  });

  it("says how many went through and why the rest did not", () => {
    expect(summariseBulk(3, ["That could not be found."])).toEqual({
      ok: false,
      error: "2 of 3 done. 1 failed: That could not be found.",
    });
  });

  it("collapses repeated reasons so one message is not printed five times", () => {
    const result = summariseBulk(4, ["Too slow.", "Too slow.", "Nope."]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("1 of 4 done. 3 failed: Too slow. Nope.");
  });

  it("reports zero done when everything failed", () => {
    expect(summariseBulk(2, ["x", "x"]).error).toBe("0 of 2 done. 2 failed: x");
  });
});
