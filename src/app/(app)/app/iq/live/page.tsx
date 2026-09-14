import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, ChefHat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LiveRefresh } from "@/components/staff/live-refresh";
import { DataTrust, KpiTile, Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import type { FulfilmentType } from "@/domain/order-status";
import { requireStaff, staffCan } from "@/lib/auth";
import { type KitchenStatus, isLate, toKitchenTickets, waitingMinutes } from "@/lib/kitchen/tickets";
import { formatINR, paise } from "@/lib/money";
import { ordersAwaitingDecision, ordersRunningLate } from "@/lib/repositories/analytics";
import { listActiveOrders } from "@/lib/repositories/orders";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Live operations", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const REFRESH_MS = 15_000;

const STAGE: Record<KitchenStatus, { label: string; dot: string }> = {
  ACCEPTED: { label: "New", dot: "bg-status-accepted-dot" },
  PREPARING: { label: "Cooking", dot: "bg-status-cooking-dot" },
  READY: { label: "Ready", dot: "bg-status-ready-dot" },
};

function fulfilmentLabel(fulfilment: FulfilmentType, tableName?: string | null): string {
  if (fulfilment === "DINE_IN") return tableName ?? "Dine-in";
  if (fulfilment === "DELIVERY") return "Delivery";
  return "Collection";
}

function clock(date: Date): string {
  return date.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
}

function minutesSince(date: Date, now: number): number {
  return Math.max(0, Math.floor((now - date.getTime()) / 60_000));
}

/** The three live queries plus the instant they were read — `now` belongs to the snapshot, not to the render. */
async function snapshot(orgId: string) {
  const [active, awaiting, late] = await Promise.all([listActiveOrders(orgId), ordersAwaitingDecision(orgId), ordersRunningLate(orgId)]);
  return { active, awaiting, late, now: Date.now() };
}

/**
 * Live Operations — the manager's glance. COMMAND CENTER › Live.
 *
 * Complements the kitchen display rather than duplicating it: no buttons,
 * no columns to work, just what is in the kitchen, what is waiting on the
 * counter, and what is late — every figure a fact from an existing query
 * (`listActiveOrders`, `ordersAwaitingDecision`, `ordersRunningLate`). No
 * score, no forecast, no threshold: "late" means past the time the counter
 * promised, "longest wait" is the oldest ticket's age, and the headline is
 * only ever a count restated in words.
 *
 * Read-only under `analytics.view`. The only actions are links to where the
 * real ones already live (Orders, the kitchen display).
 */
export default async function LiveOperationsPage() {
  const staff = await requireStaff();
  const [canView, canSeeKitchen] = await Promise.all([staffCan("analytics.view"), staffCan("kitchen.view")]);

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view live operations" />
      </div>
    );
  }

  const { active, awaiting, late, now } = await snapshot(staff.orgId);
  const tickets = toKitchenTickets(active);
  const count = (status: KitchenStatus) => tickets.filter((ticket) => ticket.status === status).length;
  const longest = tickets.reduce((max, ticket) => Math.max(max, waitingMinutes(ticket, now)), 0);

  const headline =
    late.length > 0
      ? `${late.length} ${late.length === 1 ? "order is" : "orders are"} past its promised time.`
      : awaiting.length > 0
        ? `${awaiting.length} ${awaiting.length === 1 ? "order is" : "orders are"} waiting on the counter.`
        : tickets.length > 0
          ? `${tickets.length} in the kitchen, none late.`
          : "Nothing in the kitchen and nothing waiting.";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-6 md:py-8">
      <LiveRefresh orgId={staff.orgId} fallbackMs={REFRESH_MS} />

      <PageHeader
        title="Live operations"
        description={headline}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/app/orders" className="inline-flex h-10 items-center rounded-md border border-border bg-panel px-4 text-sm font-semibold transition-colors hover:border-border-strong">
              Orders
            </Link>
            {canSeeKitchen && (
              <Link href="/app/kds" className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-strong">
                <ChefHat className="size-4" aria-hidden="true" />
                Kitchen display
              </Link>
            )}
          </div>
        }
      />

      <DataTrust items={[{ tone: "gain", text: `Live · refreshes every ${REFRESH_MS / 1000} s · last at ${clock(new Date(now))} IST` }, { tone: "neutral", text: "Every figure is a fact from the order rows — no score, no forecast" }]} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Awaiting decision" value={String(awaiting.length)} note="New orders the counter hasn't accepted" className="min-h-[124px]" />
        <KpiTile label="In the kitchen" value={String(tickets.length)} note={`${count("ACCEPTED")} new · ${count("PREPARING")} cooking · ${count("READY")} ready`} className="min-h-[124px]" />
        <KpiTile label="Late" value={String(late.length)} note="Past the promised time" className={cn("min-h-[124px]", late.length > 0 && "[&_.font-money]:text-loss")} />
        <KpiTile label="Longest wait" value={tickets.length === 0 ? "—" : `${longest} min`} note="Oldest ticket in the kitchen, since placed" className="min-h-[124px]" />
      </div>

      <Panel aria-labelledby="late-heading">
        <PanelHeader
          id="late-heading"
          title={
            <span className="inline-flex items-center gap-2">
              <AlarmClock className={cn("size-4", late.length > 0 ? "text-loss" : "text-muted-foreground")} aria-hidden="true" />
              Late
            </span>
          }
          meta={late.length === 0 ? "nothing past its promised time" : `${late.length} past the promised time`}
        />
        <PanelBody flush={late.length > 0}>
          {late.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nothing is past its promised time.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden sm:table-cell">Promised</TableHead>
                  <TableHead className="text-right">Over by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {late.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <Link href={`/app/orders?open=${row.id}`} className="tabular font-semibold underline-offset-2 hover:underline">
                          #{row.orderNumber}
                        </Link>
                        <span className="text-xs text-muted-foreground">{fulfilmentLabel(row.fulfilment)}</span>
                      </div>
                    </TableCell>
                    <TableCell>{row.customerName ?? "Walk-in"}</TableCell>
                    <TableCell className="tabular hidden text-muted-foreground sm:table-cell">{row.estimatedReadyAt ? clock(row.estimatedReadyAt) : "—"}</TableCell>
                    <TableCell className="tabular text-right font-semibold text-loss">{row.estimatedReadyAt ? `${minutesSince(row.estimatedReadyAt, now)} min` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PanelBody>
      </Panel>

      <Panel aria-labelledby="awaiting-heading">
        <PanelHeader
          id="awaiting-heading"
          title="Awaiting a decision"
          meta={awaiting.length === 0 ? "nothing waiting on the counter" : undefined}
          action={
            awaiting.length > 0 ? (
              <Link href="/app/orders" className="font-semibold text-foreground underline-offset-2 hover:underline">
                Review on Orders →
              </Link>
            ) : undefined
          }
        />
        <PanelBody flush={awaiting.length > 0}>
          {awaiting.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nothing waiting on the counter.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Waiting</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {awaiting.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <Link href={`/app/orders?open=${row.id}`} className="tabular font-semibold underline-offset-2 hover:underline">
                          #{row.orderNumber}
                        </Link>
                        <span className="text-xs text-muted-foreground">{fulfilmentLabel(row.fulfilment)}</span>
                      </div>
                    </TableCell>
                    <TableCell>{row.customerName ?? "Walk-in"}</TableCell>
                    <TableCell className="tabular text-right font-semibold">{formatINR(paise(row.grandTotal))}</TableCell>
                    <TableCell className="tabular text-right">{minutesSince(row.createdAt, now)} min</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PanelBody>
      </Panel>

      <Panel aria-labelledby="kitchen-heading">
        <PanelHeader id="kitchen-heading" title="In the kitchen" meta={tickets.length === 0 ? "the kitchen is clear" : `${tickets.length} ${tickets.length === 1 ? "ticket" : "tickets"} · oldest ${longest} min`} />
        <PanelBody flush={tickets.length > 0}>
          {tickets.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">The kitchen is clear.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="hidden md:table-cell">Items</TableHead>
                  <TableHead className="hidden sm:table-cell">Promised</TableHead>
                  <TableHead className="text-right">Waiting</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => {
                  const ticketLate = isLate(ticket, now);
                  const stage = STAGE[ticket.status];
                  return (
                    <TableRow key={ticket.id}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <Link href={`/app/orders?open=${ticket.id}`} className="tabular font-semibold underline-offset-2 hover:underline">
                            #{ticket.orderNumber}
                          </Link>
                          <span className="text-xs text-muted-foreground">{fulfilmentLabel(ticket.fulfilment, ticket.tableName)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-xs font-semibold">
                          <span className={cn("size-2 rounded-full", stage.dot)} aria-hidden="true" />
                          {stage.label}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="outline">
                          {ticket.items.reduce((sum, item) => sum + item.quantity, 0)} {ticket.items.length === 1 && ticket.items[0]?.quantity === 1 ? "item" : "items"}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular hidden text-muted-foreground sm:table-cell">{ticket.promisedAt ? clock(new Date(ticket.promisedAt)) : "—"}</TableCell>
                      <TableCell className="text-right">
                        <span className={cn("tabular font-semibold", ticketLate && "text-loss")}>
                          {waitingMinutes(ticket, now)} min{ticketLate ? " · late" : ""}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
