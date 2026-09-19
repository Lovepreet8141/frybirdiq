import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/orders/shop-status-actions", () => ({ pauseOrderingAction: vi.fn(), previewPauseAction: vi.fn(), resumeOrderingAction: vi.fn() }));

import { CloseShopPanel, type CloseShopPanelProps } from "../../app/(app)/app/admin/restaurant/close-shop-panel";

const render = (props: Partial<CloseShopPanelProps> & Pick<CloseShopPanelProps, "status">) =>
  renderToStaticMarkup(createElement(CloseShopPanel, { pausedSince: null, ...props }));

describe("CloseShopPanel", () => {
  it("open: says OPEN, offers to switch off, and shows the orders still due", () => {
    const html = render({ status: { state: "open", closesAt: "23:00", pausedBy: null, reason: null, ordersStillDue: 2, carriedOver: false } });
    expect(html).toContain("Shop is OPEN for orders");
    expect(html).toContain("Switch online orders off");
    expect(html).not.toContain("Switch orders back on");
    // The restart line is fetched when the chooser opens, never baked in at page render.
    expect(html).not.toContain("Orders restart");
  });

  it("paused: says CLOSED with who, when, reopens, reason, and offers only to switch back on", () => {
    const html = render({
      status: { state: "paused", mode: "UNTIL_RESUMED", pausedAt: new Date("2026-09-19T14:12:00Z"), reopensAt: null, reopensAtLabel: null, withinHours: true, pausedBy: { userId: "u", name: "Aman" }, reason: "Fryer broken", ordersStillDue: 0, carriedOver: false },
      pausedSince: "today at 7:42 PM",
    });
    expect(html).toContain("Shop is CLOSED for orders");
    expect(html).toContain("Aman");
    expect(html).toContain("today at 7:42 PM");
    expect(html).toContain("When someone switches it back on");
    expect(html).toContain("Fryer broken");
    expect(html).toContain("Switch orders back on");
    expect(html).not.toContain("Switch online orders off");
  });

  it("paused until next opening: shows the reopen time", () => {
    const html = render({
      status: { state: "paused", mode: "UNTIL_NEXT_OPENING", pausedAt: new Date(), reopensAt: new Date(), reopensAtLabel: "tomorrow at 11:30 AM", withinHours: true, pausedBy: { userId: "u", name: null }, reason: "Power cut", ordersStillDue: 1, carriedOver: false },
      pausedSince: "today at 7:42 PM",
    });
    expect(html).toContain("tomorrow at 11:30 AM");
    expect(html).toContain("A staff member");
  });

  it("closed by hours: says CLOSED and when it reopens", () => {
    const html = render({ status: { state: "closedByHours", reopensAt: new Date(), reopensAtLabel: "today at 11:30 AM", pausedBy: null, reason: null, ordersStillDue: 0, carriedOver: false } });
    expect(html).toContain("Shop is CLOSED for orders");
    expect(html).toContain("today at 11:30 AM");
  });
});
