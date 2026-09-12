import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkbox, optionalInt } from "./form-fields";

const form = z.object({ veg: checkbox, prep: optionalInt(0, 240) });

describe("checkbox", () => {
  it("reads an unticked box (absent key) as false instead of rejecting the form", () => {
    expect(form.parse({}).veg).toBe(false);
  });

  it("reads a ticked box ('on') as true", () => {
    expect(form.parse({ veg: "on" }).veg).toBe(true);
  });

  it("reads a hidden empty value as false", () => {
    expect(form.parse({ veg: "" }).veg).toBe(false);
  });

  it("does not treat the string 'false' as true", () => {
    expect(form.parse({ veg: "false" }).veg).toBe(false);
  });
});

describe("optionalInt", () => {
  it("keeps a blank input blank rather than coercing it to 0", () => {
    expect(form.parse({ prep: "" }).prep).toBe("");
  });

  it("parses a real number", () => {
    expect(form.parse({ prep: "12" }).prep).toBe(12);
  });

  it("leaves a missing key undefined", () => {
    expect(form.parse({}).prep).toBeUndefined();
  });

  it("still enforces the range", () => {
    expect(form.safeParse({ prep: "999" }).success).toBe(false);
    expect(form.safeParse({ prep: "-1" }).success).toBe(false);
  });
});
