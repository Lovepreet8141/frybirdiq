import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AttentionCards } from "@/components/iq/attention-cards";
import { Button } from "@/components/ui/button";
import { LimitedBadge } from "@/components/iq/limited-badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type AlertCard, alertSummary } from "@/lib/iq/overview";
import { cn } from "@/lib/utils";

/** The three most urgent findings from `attentionCards`, in a kit card; the rest live on Alerts. */
export function AttentionCard({ cards, className, limited }: { cards: readonly AlertCard[]; className?: string; limited?: readonly string[] }) {
  const urgent = cards.filter((card) => card.level === "NOW" || card.level === "TODAY").length;
  return (
    <Card className={cn("h-full", urgent > 0 && "ring-1 ring-loss/30", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Needs attention
          {urgent > 0 && <span className="tabular flex h-5 min-w-5 items-center justify-center rounded-full bg-loss-soft px-1.5 text-[11px] font-semibold text-loss">{urgent}</span>}
        </CardTitle>
        <CardDescription>{alertSummary(cards)}</CardDescription>
        {limited && limited.length > 0 && <LimitedBadge reasons={limited} className="mt-1" />}
        <CardAction>
          <Button variant="outline" size="sm" asChild>
            <Link href="/app/iq/alerts">
              All alerts
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <AttentionCards cards={cards.slice(0, 3)} />
        {cards.length > 3 && <p className="mt-2 text-[12px] text-muted-foreground">+{cards.length - 3} more on Alerts.</p>}
      </CardContent>
    </Card>
  );
}
