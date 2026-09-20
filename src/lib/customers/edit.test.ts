import { describe, expect, it } from "vitest";
import { maskPhone, parseCustomerEdit } from "./edit";

const base = { name: "Test Person", phone: "98765 43210", email: "", notes: "", key: "form-abc123:0" };

describe("parseCustomerEdit", () => {
  it("normalises the phone and turns blanks into null", () => {
    const r = parseCustomerEdit(base);
    expect(r).toEqual({ ok: true, value: { name: "Test Person", phone: "9876543210", email: null, notes: null, key: base.key } });
  });
  it("accepts +91 and a leading 0", () => {
    expect(parseCustomerEdit({ ...base, phone: "+91 98765-43210" })).toMatchObject({ ok: true });
    expect(parseCustomerEdit({ ...base, phone: "09876543210" })).toMatchObject({ ok: true, value: { phone: "9876543210" } });
  });
  it("rejects a bad phone with a sentence", () => {
    const r = parseCustomerEdit({ ...base, phone: "12345" });
    expect(r.ok).toBe(false);
  });
  it("allows clearing the phone", () => {
    expect(parseCustomerEdit({ ...base, phone: "" })).toMatchObject({ ok: true, value: { phone: null } });
  });
  it("rejects a malformed email and an over-long note", () => {
    expect(parseCustomerEdit({ ...base, email: "nope" }).ok).toBe(false);
    expect(parseCustomerEdit({ ...base, notes: "x".repeat(1001) }).ok).toBe(false);
    expect(parseCustomerEdit({ ...base, notes: "x".repeat(1000) }).ok).toBe(true);
  });
  it("rejects a missing idempotency key", () => {
    expect(parseCustomerEdit({ ...base, key: "" }).ok).toBe(false);
  });
});

describe("maskPhone", () => {
  it("keeps only the last four digits", () => {
    expect(maskPhone("9876543210")).toBe("******3210");
    expect(maskPhone(null)).toBeNull();
  });
});
