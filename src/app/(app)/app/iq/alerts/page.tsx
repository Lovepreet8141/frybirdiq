import type { Metadata } from "next";
import Link from "next/link";
import { AttentionCards } from "@/components/iq/attention-cards";
import { InsightList } from "@/components/iq/insight/insight-card";
import { CommandCenterNav } from "@/components/iq/command-center-nav";
import { RightNow } from "@/components/iq/right-now";
import { type Capability, CapabilityPanel, DataTrust, KpiTile, Panel, PanelBody, PanelHeader, SectionHeading, StatusWord } from "@/components/iq/ui";
import { LiveRefresh } from "@/components/staff/live-refresh";
import { PageHeader } from "@/components/staff/page-header";
import { ErrorState, PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { businessDate, resolveRange } from "@/lib/dates";
import { LEVEL_COPY, attentionInput, groupAlerts, urgentCount } from "@/lib/iq/alerts";
import { viewerFor } from "@/lib/iq/engine";
import { alertSummary, attentionCards } from "@/lib/iq/overview";
import { type Paise, formatINR } from "@/lib/money";
import { foodCostWeeklySeries, getProfitAndLoss } from "@/lib/repositories/expenses";
import { type InsightsForViewer, loadInsightsFor } from "@/lib/repositories/iq-insights";
import { getOverviewSettings, getRightNow, productLastSales } from "@/lib/repositories/overview";
import { getSmart86Projections } from "@/lib/repositories/stock";

/** Same base-unit labels the ingredient page and movement history use — Smart 86 never converts to kg/L for display. */
const UNIT_LABEL: Record<string, string> = { G: "g", ML: "ml", PIECE: "pc" };

export const metadata: Metadata = { title: "Alerts", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const REFRESH_MS = 30_000;

/** Which signals feed the rules, and which would-be signals have no source yet. */
const SIGNALS: readonly Capability[] = [
  { name: "Orders past their promised time", connected: true, note: "From the order rows and the time the counter promised" },
  { name: "Prep time this hour", connected: true, note: "Measured from accepted to ready on today's tickets" },
  { name: "Cash orders not yet settled", connected: true, note: "Payments the till has not taken against orders out with a rider or at the counter" },
  { name: "Menu items not selling", connected: true, note: "Days since each live product last sold, once the shop has 7 days of history" },
  { name: "Cost inputs missing", connected: true, note: "Which of food, packaging, labour and operating costs have been recorded" },
  { name: "Rush mode", connected: false, note: "No hold switch or promise-time override exists; today the counter turns orders down one at a time" },
  { name: "Projected stockouts (Smart 86)", connected: true, note: "From the last 7 days' consumption and stock on hand — recommends, never changes availability itself" },
  { name: "Detections against the usual weekday", connected: true, note: "Findings the IQ checks stored: daily sales, orders and costs, and the service pulse. Empty until those checks run" },
  { name: "Alerts to your phone", connected: false, note: "No automatic channel is wired yet — see Admin › Notifications" },
];

/**
 * Active DETECTION insights for this viewer. The viewer comes from the
 * server-side session's roles, never from the client, and payment-ledger
 * findings (recon.*, sig.*) stay behind finance.view (IQ-2 R2.2). A failed
 * read shows an error state for this section only; the rule-based alerts
 * above still render.
 */
async function loadDetections(orgId: string, roles: Parameters<typeof viewerFor>[0]): Promise<InsightsForViewer | null> {
  try {
    return await loadInsightsFor(orgId, viewerFor(roles), { claimTypes: ["DETECTION"], statuses: ["ACTIVE"], limit: 50 });
  } catch (error) {
    console.error(`alerts: detections read failed (${error instanceof Error ? error.name : "unknown"})`);
    return null;
  }
}

/**
 * COMMAND CENTER › Alerts. Every finding the Overview's "Needs your
 * attention" panel can raise, grouped by urgency, with the measurements
 * behind them. Same rules (`attentionCards`), same inputs, same
 * repositories — never a second opinion.
 */
export default async function AlertsPage() {
  const staff = await requireStaff();
  if (!(await staffCan("analytics.view"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view alerts" />
      </div>
    );
  }

  const now = new Date();
  const today = businessDate(now);
  const settings = await getOverviewSettings(staff.orgId);
  const [rightNow, lastSales, pnl, foodCost, smart86, detections] = await Promise.all([
    getRightNow(staff.orgId, settings.kitchenCapacity, now.getTime()),
    productLastSales(staff.orgId, now),
    getProfitAndLoss(staff.orgId, resolveRange("mtd")),
    foodCostWeeklySeries(staff.orgId),
    getSmart86Projections(staff.orgId, now),
    loadDetections(staff.orgId, staff.roles),
  ]);

  const cards = attentionCards(
    attentionInput({
      late: rightNow.late,
      prep: rightNow.prep,
      pendingCash: rightNow.pendingCash,
      unsold: lastSales.map((product) => ({ name: product.name, days: product.days, isHighestPriced: product.isHighestPriced })),
      openingDate: settings.opening.date,
      today,
      directTotal: pnl.direct.reduce((sum, row) => sum + row.amount, 0n) as Paise,
      fixedTotal: pnl.fixed.reduce((sum, row) => sum + row.amount, 0n) as Paise,
      anyWeeklyDirectCost: foodCost.some((point) => point.directCost > 0n),
    }),
  );
  const groups = groupAlerts(cards);
  const urgent = urgentCount(cards);
  const clock = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <LiveRefresh orgId={staff.orgId} fallbackMs={REFRESH_MS} />
      <PageHeader title="Alerts" description={alertSummary(cards)} />
      <CommandCenterNav current="alerts" alertCount={urgent} />

      <DataTrust
        items={[
          { tone: "gain", text: `Rules over measured numbers · rendered ${clock} IST · updates as orders move` },
          { tone: "neutral", text: "Findings and actions come only from data FRYBIRD IQ can see — no forecast" },
        ]}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile label="Needs a hand now" value={String(urgent)} note={urgent === 0 ? "Nothing urgent" : "Now and today"} emphasis={urgent > 0} className={urgent > 0 ? "[&_.font-money]:text-loss" : undefined} />
        <KpiTile label="Later this week" value={String(cards.length - urgent)} note="Decisions and setup" />
        <KpiTile label="Late orders" value={String(rightNow.late.count)} note={rightNow.late.count === 0 ? "Nothing past its promised time" : `Oldest ${rightNow.late.oldestLateMinutes} min over`} className={rightNow.late.count > 0 ? "[&_.font-money]:text-loss" : undefined} />
        <KpiTile label="Cash unsettled" value={rightNow.pendingCash.count === 0 ? "—" : formatINR(rightNow.pendingCash.total, "whole")} missing={rightNow.pendingCash.count === 0} note={rightNow.pendingCash.count === 0 ? "Every cash order is settled" : `${rightNow.pendingCash.count} ${rightNow.pendingCash.count === 1 ? "order" : "orders"} · oldest ${rightNow.pendingCash.oldestMinutes} min`} />
      </div>

      <Panel>
        <PanelHeader
          title="Smart 86 — projected stockouts"
          description="From the last 7 days' velocity and today's stock on hand. Recommends only — nothing here changes a product's availability; that stays a manual call below on each product's own page."
          meta={smart86.length > 0 ? `${smart86.length} ${smart86.length === 1 ? "ingredient" : "ingredients"}` : undefined}
        />
        <PanelBody className="pt-0">
          {smart86.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
              Nothing projected to run short today, and nothing under about 2 days of cover.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {smart86.map((row) => {
                const unit = UNIT_LABEL[row.baseUnit] ?? row.baseUnit.toLowerCase();
                const onHandLabel = `${new Intl.NumberFormat("en-IN").format(row.onHandBase)} ${unit}`;
                const detail =
                  row.risk === "stockout_today"
                    ? row.alreadyOut
                      ? `Out now — ${onHandLabel} on hand`
                      : `Short around ${row.stockoutInstant?.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })} · ${onHandLabel} on hand`
                    : row.belowReorderThreshold
                      ? `Below its reorder point · ${onHandLabel} on hand`
                      : `${row.daysOfCover !== null ? `${row.daysOfCover.toFixed(1)} days of cover` : "Trending low"} · ${onHandLabel} on hand`;
                return (
                  <li key={row.ingredientId} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                      <StatusWord tone={row.risk === "stockout_today" ? "loss" : "flag"} className="text-foreground">
                        <Link href={`/app/inventory/ingredients/${row.ingredientId}`} className="font-medium hover:underline">
                          {row.ingredientName}
                        </Link>
                      </StatusWord>
                      <span className="pl-[15px] text-[13px] text-muted-foreground sm:pl-0">{detail}</span>
                    </div>
                    {row.affectedProducts.length > 0 && (
                      <p className="pl-[15px] text-[12.5px] text-muted-foreground">
                        Affects{" "}
                        {row.affectedProducts.map((product, index) => (
                          <span key={product.id}>
                            {index > 0 && ", "}
                            <Link href={`/app/iq/menu/products/${product.id}`} className="underline underline-offset-2">
                              {product.name}
                            </Link>
                          </span>
                        ))}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </PanelBody>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {groups.length === 0 ? (
            <AttentionCards cards={[]} />
          ) : (
            groups.map((group) => (
              <section key={group.level} aria-labelledby={`alerts-${group.level}`} className="flex flex-col gap-3">
                <SectionHeading id={`alerts-${group.level}`} title={LEVEL_COPY[group.level].title} note={`${group.cards.length} · ${LEVEL_COPY[group.level].note}`} />
                <AttentionCards cards={group.cards} />
              </section>
            ))
          )}
          <section aria-labelledby="alerts-detections" className="flex flex-col gap-3">
            <SectionHeading id="alerts-detections" title="Detected against the usual" note="Checks that compare with the same weekday · active findings" />
            {detections === null ? (
              <ErrorState title="Detections could not be loaded" detail="The rule-based alerts above are unaffected. Try again in a minute." />
            ) : (
              <InsightList result={detections} emptyTitle="Nothing detected" emptyDetail="No check has found anything unusual that is still active." />
            )}
          </section>
        </div>
        <CapabilityPanel title="What the rules can see" items={SIGNALS} />
      </div>

      <section aria-labelledby="health-heading" className="flex flex-col gap-3">
        <SectionHeading id="health-heading" title="Order health right now" note="The measurements the rules read · click a tile for the orders behind it" />
        <RightNow tiles={rightNow.tiles} />
      </section>
    </div>
  );
}
