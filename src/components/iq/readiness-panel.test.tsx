import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type ReadinessRaw, buildReadiness } from "@/lib/iq/readiness/scores";
import { LimitedBadge } from "./limited-badge";
import { ReadinessPanel } from "./readiness-panel";

const z = { numerator: 0, denominator: 0, previousNumerator: 0, previousDenominator: 0 };
const raw: ReadinessRaw = {
  closedSameDay: { numerator: 9, denominator: 10, previousNumerator: 6, previousDenominator: 10 },
  cashRecorded: z,
  recipeCoverage: { numerator: 12, denominator: 20, previousNumerator: 12, previousDenominator: 20, firstMissingItem: "Nashville Bomb" },
  stockCount: { numerator: 3, denominator: 30, previousNumerator: 6, previousDenominator: 30, daysSinceLastCount: 9 },
  customerAttached: { numerator: 4, denominator: 10, previousNumerator: 4, previousDenominator: 10 },
};
const html = renderToStaticMarkup(<ReadinessPanel readiness={buildReadiness(raw)} />);

describe("ReadinessPanel", () => {
  it("shows the overall percent, all five labelled scores and the one action with its link", () => {
    expect(html).toContain("IQ readiness");
    expect(html).toContain("Average of 4 of 5 scores (the rest have no data yet).");
    for (const label of ["Orders closed the same day", "Cash recorded for completed cash orders", "Top-20 items with a recipe", "Stock counted in the last 7 days", "Orders with a customer attached"]) expect(html).toContain(label);
    expect(html).toContain("Count stock today: the last count was 9 days ago.");
    expect(html).toContain('href="/app/inventory"');
  });

  it("says 'No data yet' for an unmeasured score, never 0% or 100%", () => {
    expect(html).toMatch(/data-readiness-score="cashRecorded"[\s\S]*?No data yet/);
  });

  it("trends are words with arrows, in points on last week", () => {
    expect(html).toContain("up 30 points on last week");
    expect(html).toContain("down 10 points on last week");
    expect(html).toContain("same as last week");
  });

  it("the stock count is red in words when over 7 days", () => {
    expect(html).toContain("Red: last counted 9 days ago (over 7).");
  });

  it("every progress bar is labelled for a screen reader", () => {
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuetext="no data yet"');
  });
});

describe("LimitedBadge", () => {
  it("says 'Limited data' in words and names why; renders nothing when nothing is weak", () => {
    const badge = renderToStaticMarkup(<LimitedBadge reasons={["Top-20 items with a recipe: 60%"]} />);
    expect(badge).toContain("Limited data");
    expect(badge).toContain("Top-20 items with a recipe: 60%");
    expect(renderToStaticMarkup(<LimitedBadge reasons={[]} />)).toBe("");
  });
});
