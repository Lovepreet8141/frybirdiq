import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalJson } from "./content-hash";
import { ActionParamsSchema, MAX_PARAM_KEYS, actionParamsHash, parseActionParams } from "./params";

describe("ActionParamsSchema", () => {
  it("accepts a flat record of scalars under identifier keys", () => {
    expect(parseActionParams({ sku: "wings-8pc", quantity: 12, urgent: false, note: null })).toEqual({
      sku: "wings-8pc",
      quantity: 12,
      urgent: false,
      note: null,
    });
    expect(parseActionParams({})).toEqual({});
  });

  it.each([
    ["a nested object", { target: { sku: "x" } }],
    ["an array", { skus: ["x"] }],
    ["a fractional number", { quantity: 1.5 }],
    ["a string over 200 characters", { note: "x".repeat(201) }],
    ["a non-identifier key", { "Customer Id": "x" }],
    ["too many keys", Object.fromEntries(Array.from({ length: MAX_PARAM_KEYS + 1 }, (_, i) => [`k${i}`, i]))],
  ])("refuses %s", (_case, params) => {
    expect(ActionParamsSchema.safeParse(params).success).toBe(false);
  });

  it.each([
    ["customer_phone", { customer_phone: "x" }],
    ["customername (words run together)", { customername: "x" }],
    ["contact_mobileno", { contact_mobileno: "x" }],
    ["email", { email: "x" }],
    ["a phone-shaped value", { contact: "+91 9876543210" }],
  ])("refuses personal data: %s", (_case, params) => {
    expect(() => parseActionParams(params)).toThrow(/personal data|phone/);
  });
});

describe("actionParamsHash", () => {
  it("is sha256 of the canonical JSON, independent of key order", async () => {
    const params = { sku: "wings", quantity: 12 };
    const expected = createHash("sha256").update(canonicalJson(params)).digest("hex");
    expect(await actionParamsHash(params)).toBe(expected);
    expect(await actionParamsHash({ quantity: 12, sku: "wings" })).toBe(expected);
  });

  it("changes when a value changes and refuses invalid params", async () => {
    expect(await actionParamsHash({ quantity: 12 })).not.toBe(await actionParamsHash({ quantity: 13 }));
    await expect(actionParamsHash({ nested: { a: 1 } } as never)).rejects.toThrow();
  });
});
