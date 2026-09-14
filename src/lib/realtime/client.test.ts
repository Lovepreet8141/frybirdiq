import { describe, expect, it } from "vitest";
import { uniqueChannelName } from "./client";

describe("uniqueChannelName", () => {
  it("gives two subscribers to the same organization different channels", () => {
    // supabase.channel(name) returns the existing channel for a repeated name,
    // and a joined channel throws on the next .on() — so the alert in the
    // chrome and the board under it must never resolve to one name.
    const alert = uniqueChannelName("orders:org-1", 1);
    const board = uniqueChannelName("orders:org-1", 2);
    expect(alert).not.toBe(board);
    expect(alert.startsWith("orders:org-1:")).toBe(true);
    expect(board.startsWith("orders:org-1:")).toBe(true);
  });

  it("keeps organizations apart", () => {
    expect(uniqueChannelName("orders:org-1", 1)).not.toBe(uniqueChannelName("orders:org-2", 1));
  });
});
