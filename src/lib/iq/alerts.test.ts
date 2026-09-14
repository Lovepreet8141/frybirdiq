import { describe, expect, it } from "vitest";
import { paise } from "@/lib/money";
import { attentionInput, daysOfHistory, groupAlerts, urgentCount } from "./alerts";
import type { AlertCard } from "./overview";

describe("daysOfHistory", () => {
  it("counts whole days since opening, and never goes negative or guesses without a date", () => {
    expect(daysOfHistory("2026-08-01", "2026-09-14")).toBe(44);
    expect(daysOfHistory("2026-09-14", "2026-09-14")).toBe(0);
    expect(daysOfHistory("2026-10-01", "2026-09-14")).toBe(0);
    expect(daysOfHistory(null, "2026-09-14")).toBe(0);
  });
});

describe("attentionInput", () => {
  const base = {
    late: { count: 1, oldestLateMinutes: 12, inKitchen: 3 },
    prep: { averageMs: 600_000, count: 4 },
    pendingCash: { count: 2, total: paise(50_000), oldestMinutes: 30 },
    unsold: [],
    openingDate: "2026-08-01",
    today: "2026-09-14",
  };

  it("records a direct cost line when this month has one or any recent week had one", () => {
    const thisMonth = attentionInput({ ...base, directTotal: paise(10_000), fixedTotal: paise(0), anyWeeklyDirectCost: false });
    expect(thisMonth.costs).toMatchObject({ directRecorded: true, operatingRecorded: false, costLinesRecorded: 1, costLinesTotal: 4 });

    const earlierWeek = attentionInput({ ...base, directTotal: paise(0), fixedTotal: paise(0), anyWeeklyDirectCost: true });
    expect(earlierWeek.costs.directRecorded).toBe(true);
  });

  it("passes the measurements through untouched and counts both lines when both are recorded", () => {
    const input = attentionInput({ ...base, directTotal: paise(1), fixedTotal: paise(80_000), anyWeeklyDirectCost: false });
    expect(input.late).toEqual(base.late);
    expect(input.daysOfHistory).toBe(44);
    expect(input.costs.operatingThisMonth).toBe(80_000n);
    expect(input.costs.costLinesRecorded).toBe(2);
  });
});

describe("groupAlerts / urgentCount", () => {
  const card = (id: string, level: AlertCard["level"]): AlertCard => ({ id, level, title: id, evidence: "", causeLabel: "", cause: "", action: "", primary: { label: "", href: "/" }, secondary: { label: "", href: "/" } });

  it("orders groups by urgency and drops empty levels", () => {
    const groups = groupAlerts([card("c", "SETUP"), card("a", "NOW"), card("b", "THIS WEEK"), card("d", "NOW")]);
    expect(groups.map((group) => [group.level, group.cards.map((c) => c.id)])).toEqual([
      ["NOW", ["a", "d"]],
      ["THIS WEEK", ["b"]],
      ["SETUP", ["c"]],
    ]);
  });

  it("counts NOW and TODAY as urgent", () => {
    expect(urgentCount([card("a", "NOW"), card("b", "TODAY"), card("c", "SETUP")])).toBe(2);
    expect(urgentCount([])).toBe(0);
  });
});
