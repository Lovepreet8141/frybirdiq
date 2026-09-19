import Link from "next/link";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LimitedBadge } from "@/components/iq/limited-badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ORDER_CHANNEL_LABELS, type OrderChannel } from "@/domain/order-channel";
import { type Paise, formatBps, formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface ChannelRow {
  readonly channel: OrderChannel;
  readonly revenue: Paise;
  readonly orders: number;
  readonly shareBps: number;
  readonly changeBps: number | null;
}

/**
 * The purchased E-commerce dashboard's `SalesByLocation` card
 * (`ecommerce/components/sales-by-location.tsx`): a name, a delta badge,
 * the share on the right, a progress bar beneath. Countries became
 * FRYBIRD's three direct channels; the export menu became a link to the
 * Channels report, because that is where the question continues.
 */
export function ChannelPerformanceCard({ channels, total, periodLabel, className, limited }: { channels: readonly ChannelRow[]; total: Paise; periodLabel: string; className?: string; limited?: readonly string[] }) {
  const empty = total === 0n;
  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle>Channels</CardTitle>
        <CardDescription>{empty ? `No paid orders ${periodLabel.toLowerCase()}` : `${formatINR(total, "whole")} ${periodLabel.toLowerCase()} · vs the previous period`}</CardDescription>
        {limited && limited.length > 0 && <LimitedBadge reasons={limited} className="mt-1" />}
        <CardAction>
          <Button variant="outline" size="sm" asChild>
            <Link href="/app/iq/channels">
              Report
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">Revenue by channel appears once an order in this period has been paid for.</p>
        ) : (
          <div className="space-y-4">
            {channels.map((row) => {
              const up = row.changeBps !== null && row.changeBps > 0;
              const down = row.changeBps !== null && row.changeBps < 0;
              return (
                <div key={row.channel} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{ORDER_CHANNEL_LABELS[row.channel]}</span>
                      {row.changeBps !== null ? (
                        <Badge variant="outline" className={cn("tabular", up && "text-gain", down && "text-loss")}>
                          {up ? <TrendingUp aria-hidden="true" /> : down ? <TrendingDown aria-hidden="true" /> : null}
                          {up ? "+" : down ? "−" : ""}
                          {formatBps(Math.abs(row.changeBps), 1)}
                        </Badge>
                      ) : (
                        <span className="text-[11.5px] text-muted-foreground">no prior period</span>
                      )}
                    </div>
                    <div className="tabular shrink-0 text-[13px]">
                      <span className="font-semibold">{formatBps(row.shareBps, 0)}</span>
                      <span className="text-muted-foreground"> · {formatINR(row.revenue, "whole")} · {row.orders}</span>
                    </div>
                  </div>
                  <Progress value={row.shareBps / 100} aria-label={`${ORDER_CHANNEL_LABELS[row.channel]} ${formatBps(row.shareBps, 1)} of revenue`} />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
