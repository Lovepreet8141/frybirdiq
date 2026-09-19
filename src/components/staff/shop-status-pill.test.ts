import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/orders/shop-status-actions", () => ({ pauseOrderingAction: vi.fn(), previewPauseAction: vi.fn(), resumeOrderingAction: vi.fn(), readOrderingStatusAction: vi.fn() }));

import { PillFace, PillPanel } from "./shop-status-pill";
import { pillDetail, pillView } from "@/lib/orders/shop-pill";
import { sinceLabel } from "@/components/pos/shop-switch-view";
import type { StaffOrderingStatus } from "@/lib/repositories/shop-status";

const NOW = new Date("2026-09-19T14:30:00.000Z");
const bits = { pausedBy: null, reason: null, ordersStillDue: 2, carriedOver: false, preOrdersOnClosedDays: 0 } as const;
const open: StaffOrderingStatus = { state: "open", closesAt: "23:00", ...bits };
const closed: StaffOrderingStatus = { state: "closedByHours", dayOff: null, reopensAt: new Date("2026-09-20T06:00:00Z"), reopensAtLabel: "tomorrow at 11:30 AM", ...bits };
const off: StaffOrderingStatus = {
  state: "paused", mode: "UNTIL_RESUMED", pausedAt: new Date("2026-09-19T14:12:00Z"), reopensAt: null, reopensAtLabel: null, withinHours: true,
  pausedBy: { userId: "u", name: "Aman" }, reason: "Too busy", ordersStillDue: 2, carriedOver: false, preOrdersOnClosedDays: 0,
};
const hours = { opens: "11:30", closes: "23:00" };

const face = (s: StaffOrderingStatus) => renderToStaticMarkup(createElement(PillFace, { view: pillView(s, NOW) }));
const panel = (s: StaffOrderingStatus, canSwitch: boolean, canEditHours = true) =>
  renderToStaticMarkup(createElement(PillPanel, { view: pillView(s, NOW), detail: pillDetail(s, NOW, hours, sinceLabel), canSwitch, canEditHours, onSwitchOff: () => undefined, onSwitchOn: () => undefined, busy: false }));

describe("the pill face: each state, as rendered", () => {
  it("open: green dot, 'Open · until 11:00 PM', phone word 'Open'", () => {
    const html = face(open);
    expect(html).toContain("bg-success");
    expect(html).toContain("Open · until 11:00 PM");
    expect(html).toMatch(/data-pill-short[^>]*>Open</);
  });
  it("closed by hours: grey dot, 'Closed · opens tomorrow 11:30 AM', phone word 'Closed'", () => {
    const html = face(closed);
    expect(html).toContain("bg-muted-foreground");
    expect(html).toContain("Closed · opens tomorrow 11:30 AM");
    expect(html).toMatch(/data-pill-short[^>]*>Closed</);
  });
  it("orders off: red dot, 'Orders OFF · until switched on', phone word 'Off'", () => {
    const html = face(off);
    expect(html).toContain("bg-destructive");
    expect(html).toContain("Orders OFF · until switched on");
    expect(html).toMatch(/data-pill-short[^>]*>Off</);
  });
  it("collapses at 375 px: the long text is hidden below the sm breakpoint and the one word shows only there; the icon hides too", () => {
    const html = face(off);
    expect(html).toMatch(/data-pill-long[^>]*class="hidden[^"]*sm:inline"|class="hidden[^"]*sm:inline"[^>]*data-pill-long/);
    expect(html).toMatch(/class="sm:hidden"[^>]*data-pill-short|data-pill-short[^>]*class="sm:hidden"/);
    expect(html).toContain("hidden size-4 shrink-0 sm:block");
  });
  it("never colour alone: each state has an icon and words (icon is aria-hidden, the words are the label)", () => {
    for (const s of [open, closed, off]) {
      const html = face(s);
      expect(html).toContain("<svg");
      expect(html).toContain("aria-hidden");
    }
  });
});

describe("the panel", () => {
  it("open: one primary action to switch off, hours, orders not finished, a link to Admin", () => {
    const html = panel(open, true);
    expect(html).toContain("Switch online orders off…");
    expect(html).not.toContain("Switch orders back on");
    expect(html).toContain("Today&#x27;s hours: 11:30 AM – 11:00 PM");
    expect(html).toContain("Orders not finished: 2");
    expect(html).toContain('href="/app/admin/restaurant"');
    expect(html).toContain("Edit opening hours");
  });
  it("orders off: who, when, why, and the one action is 'Switch orders back on'", () => {
    const html = panel(off, true);
    expect(html).toContain("Switched off by Aman at 7:42 PM.");
    expect(html).toContain("Reason: Too busy");
    expect(html).toContain("Switch orders back on");
    expect(html).not.toContain("Switch online orders off…");
  });
  it("READ-ONLY role: the status is there, no action button at all, and it says why", () => {
    for (const s of [open, closed, off]) {
      const html = panel(s, false);
      expect(html).not.toContain("<button");
      expect(html).toContain("Only a manager can switch online orders off or on.");
      expect(html).toContain("Orders not finished");
    }
  });
  it("no link to Admin for a role that cannot open that page", () => {
    expect(panel(open, true, false)).not.toContain("Edit opening hours");
  });
  it("says 'not finished', never the old 'still to make'", () => {
    for (const s of [open, closed, off]) expect(panel(s, true)).not.toMatch(/still to make/i);
  });
});

describe("a switch from the pill is the same switch as from Admin and the POS: one action, one request shape", () => {
  const read = (path: string) => readFileSync(join(__dirname, "..", "..", "..", path), "utf8");

  it("the pill has no action of its own: it goes through useShopSwitch", () => {
    const pill = read("src/components/staff/shop-status-pill.tsx");
    expect(pill).toContain("useShopSwitch");
    expect(pill).not.toMatch(/pauseOrderingAction|resumeOrderingAction/);
  });
  it("useShopSwitch (pill and POS) and the Admin panel both send pauseRequest(...) to the one pauseOrderingAction and resume through resumeOrderingAction", () => {
    for (const file of ["src/components/shop/use-shop-switch.tsx", "src/app/(app)/app/admin/restaurant/close-shop-panel.tsx"]) {
      const text = read(file);
      expect(text).toMatch(/pauseOrderingAction\(pauseRequest\(/);
      expect(text).toMatch(/resumeOrderingAction\(/);
      expect(text).toContain('from "@/lib/orders/shop-status-actions"');
    }
  });
  it("the POS switch uses the same hook, so POS and pill cannot drift", () => {
    expect(read("src/components/pos/shop-switch.tsx")).toContain("useShopSwitch");
  });
});
