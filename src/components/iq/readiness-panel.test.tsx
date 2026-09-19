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
    for (const label of ["Orders closed the same day", "Cash recorded for completed cash orders", "Your 20 best sellers with a recipe", "Stock counts recorded in the last 7 days", "Orders with a customer attached"]) expect(html).toContain(label);
    expect(html).toContain("Count your stock and correct anything that differs: the last recorded count was 9 days ago.");
    expect(html).toContain('href="/app/inventory"');
    expect(html).toContain("Open Inventory");
  });

  it("says 'No data yet' for an unmeasured score, never 0% or 100%", () => {
    expect(html).toMatch(/data-readiness-score="cashRecorded"[\s\S]*?No data yet/);
  });

  it("trends are words with arrows, in points on last week", () => {
    expect(html).toContain("up 30 percentage points on last week");
    expect(html).toContain("down 10 percentage points on last week");
    expect(html).toContain("same as last week");
  });

  it("the stock count is red in words when over 7 days", () => {
    expect(html).toContain("Overdue: the last recorded count was 9 days ago (more than 7).");
  });

  it("a bar only where there is a value; an unmeasured score is text, not an empty bar", () => {
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain('aria-valuetext="no data yet"');
    const cash = html.slice(html.indexOf('data-readiness-score="cashRecorded"'), html.indexOf('data-readiness-score="recipeCoverage"'));
    expect(cash).not.toContain("progressbar");
    expect(cash).toContain("No data yet: cards that rely on this are marked limited");
    expect(cash).not.toContain("Under 80%");
  });

  it("an under-80 score says 'Under 80%', and the stock caveat is on the row itself", () => {
    expect(html).toContain("Under 80%: cards that rely on this are marked limited");
    expect(html).toContain("A count that matches the amount in stock leaves no record");
  });
});

describe("small samples and empty stock", () => {
  it("says how few a score rests on when under 10, and shows no stock overdue line when there is no stock", () => {
    const small = renderToStaticMarkup(<ReadinessPanel readiness={buildReadiness({ ...raw, closedSameDay: { numerator: 2, denominator: 3, previousNumerator: 0, previousDenominator: 0 }, stockCount: { ...z, daysSinceLastCount: null } })} />);
    expect(small).toContain("based on only 3");
    expect(small).not.toContain("Overdue: no stock count");
  });
});

describe("LimitedBadge", () => {
  it("says 'Limited data' in words and names why; renders nothing when nothing is weak", () => {
    const badge = renderToStaticMarkup(<LimitedBadge reasons={["Your 20 best sellers with a recipe: 60%", "Stock counts recorded in the last 7 days: 10%"]} />);
    expect(badge).toContain("Limited data");
    // Visible text, one line per weak score: a phone has no hover.
    expect(badge).toContain("<li>Your 20 best sellers with a recipe: 60%</li>");
    expect(badge).toContain("<li>Stock counts recorded in the last 7 days: 10%</li>");
    expect(badge).not.toContain("title=");
    expect(renderToStaticMarkup(<LimitedBadge reasons={[]} />)).toBe("");
  });
});
