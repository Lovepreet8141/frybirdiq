import { describe, expect, it } from "vitest";
import { overnightHoursError } from "./hours";

describe("overnightHoursError", () => {
  it.each([["11:30", "23:00"], ["00:00", "23:59"], ["09:00", "09:01"]])("accepts %s–%s", (open, close) => {
    expect(overnightHoursError(open, close)).toBeNull();
  });

  it.each([["18:00", "02:00"], ["23:00", "11:30"], ["23:59", "00:00"]])("refuses overnight %s–%s and says why", (open, close) => {
    const message = overnightHoursError(open, close);
    expect(message).toMatch(/after opening time/);
    expect(message).toMatch(/overnight/);
    expect(message).toMatch(/split/);
  });

  it("refuses equal times", () => {
    expect(overnightHoursError("11:30", "11:30")).toBe("Opening and closing time can't be the same.");
  });
});
