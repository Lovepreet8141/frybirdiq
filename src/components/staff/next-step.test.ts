import { describe, expect, it } from "vitest";
import { nextStep } from "./next-step";

describe("nextStep — an order waiting on an online payment is not offered an Accept the server would refuse", () => {
  it("PENDING_PAYMENT: Accept for cash orders, nothing for an order awaiting online payment", () => {
    expect(nextStep("PENDING_PAYMENT", "TAKEAWAY")).toEqual({ to: "ACCEPTED", label: "Accept" });
    expect(nextStep("PENDING_PAYMENT", "TAKEAWAY", false)).toEqual({ to: "ACCEPTED", label: "Accept" });
    expect(nextStep("PENDING_PAYMENT", "TAKEAWAY", true)).toBeNull();
  });
  it("once paid, everything moves as before", () => {
    expect(nextStep("PAID", "TAKEAWAY", true)).toEqual({ to: "ACCEPTED", label: "Accept" });
    expect(nextStep("ACCEPTED", "DELIVERY", true)).toEqual({ to: "PREPARING", label: "Start cooking" });
  });
});
