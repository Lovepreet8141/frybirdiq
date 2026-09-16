import { describe, expect, it } from "vitest";
import { channelThankYouMessage } from "./share-message";

describe("channelThankYouMessage", () => {
  it("uses dine-in wording for DINE_IN", () => {
    expect(channelThankYouMessage("DINE_IN")).toBe(
      "Thank you for dining with FRYBIRD! 🍗\nWe hope you enjoyed your meal.\nWe look forward to serving you again!",
    );
  });

  it("uses takeaway wording for TAKEAWAY", () => {
    expect(channelThankYouMessage("TAKEAWAY")).toBe(
      "Thanks for choosing FRYBIRD! 🍗\nWe hope you enjoyed your meal.\nSee you again soon!",
    );
  });

  it("uses delivered wording for DELIVERY", () => {
    expect(channelThankYouMessage("DELIVERY")).toBe(
      "Your FRYBIRD order has been delivered! 🍗\nWe hope you enjoyed your meal.\nThank you for ordering with us — we look forward to serving you again!",
    );
  });
});
