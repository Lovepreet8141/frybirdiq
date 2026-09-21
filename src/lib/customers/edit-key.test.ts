import { describe, expect, it } from "vitest";
import { newEditKey } from "./edit-key";

describe("newEditKey", () => {
  it("is unique per attempt, never the same across page loads (the useId bug)", () => {
    const keys = new Set(Array.from({ length: 200 }, () => newEditKey()));
    expect(keys.size).toBe(200);
  });

  it("is a well-formed key the server accepts (8-120 characters)", () => {
    const key = newEditKey();
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(120);
  });
});
