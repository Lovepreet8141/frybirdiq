import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, ChefHat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AutoRefresh } from "@/components/staff/auto-refresh";
import { MiniStat } from "@/components/staff/mini-stat";
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
  ACCEPTED: { label: "New", dot: "bg-muted-foreground" },
  PREPARING: { label: "Cooking", dot: "bg-warning" },
  READY: { label: "Ready", dot: "bg-[#3F9D52]" },
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <AutoRefresh everyMs={REFRESH_MS} />

      <PageHeader
        title="Live operations"
        description={`${headline} Refreshes every ${REFRESH_MS / 1000} seconds · last at ${clock(new Date(now))}.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/app/orders" className="flex min-h-[44px] items-center rounded-md border border-border px-4 text-sm font-semibold transition-colors hover:bg-surface-muted">
              Orders
            </Link>
            {canSeeKitchen && (
              <Link href="/app/kds" className="flex min-h-[44px] items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
                <ChefHat className="size-4" aria-hidden="true" />
                Kitchen display
              </Link>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MiniStat label="Awaiting decision" value={String(awaiting.length)} hint="New orders the counter hasn't accepted" />
        <MiniStat label="In the kitchen" value={String(tickets.length)} hint={`${count("ACCEPTED")} new · ${count("PREPARING")} cooking · ${count("READY")} ready`} />
        <MiniStat label="Late" value={String(late.length)} hint="Past the promised time" />
        <MiniStat label="Longest wait" value={tickets.length === 0 ? "—" : `${longest} min`} hint="Oldest ticket in the kitchen, since placed" />
      </div>

      <section aria-labelledby="late-heading" className="flex flex-col gap-3">
        <h2 id="late-heading" className="flex items-center gap-2 font-heading text-lg font-semibold">
          <AlarmClock className={cn("size-5", late.length > 0 ? "text-destructive" : "text-muted-foreground")} aria-hidden="true" />
          Late
        </h2>
        {late.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">Nothing is past its promised time.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-destructive bg-surface">
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
                        <span className="tabular font-semibold">#{row.orderNumber}</span>
                        <span className="text-xs text-muted-foreground">{fulfilmentLabel(row.fulfilment)}</span>
                      </div>
                    </TableCell>
                    <TableCell>{row.customerName ?? "Walk-in"}</TableCell>
                    <TableCell className="tabular hidden text-muted-foreground sm:table-cell">{row.estimatedReadyAt ? clock(row.estimatedReadyAt) : "—"}</TableCell>
                    <TableCell className="tabular text-right font-bold text-destructive">
                      {row.estimatedReadyAt ? `${minutesSince(row.estimatedReadyAt, now)} min` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-labelledby="awaiting-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="awaiting-heading" className="font-heading text-lg font-semibold">
            Awaiting a decision
          </h2>
          {awaiting.length > 0 && (
            <Link href="/app/orders" className="text-sm font-semibold underline underline-offset-2">
              Review on Orders
            </Link>
          )}
        </div>
        {awaiting.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">Nothing waiting on the counter.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
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
                        <span className="tabular font-semibold">#{row.orderNumber}</span>
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
          </div>
        )}
      </section>

      <section aria-labelledby="kitchen-heading" className="flex flex-col gap-3">
        <h2 id="kitchen-heading" className="font-heading text-lg font-semibold">
          In the kitchen
        </h2>
        {tickets.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">The kitchen is clear.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
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
                          <span className="tabular font-semibold">#{ticket.orderNumber}</span>
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
                        <span className={cn("tabular font-semibold", ticketLate && "text-destructive")}>
                          {waitingMinutes(ticket, now)} min{ticketLate ? " · late" : ""}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
