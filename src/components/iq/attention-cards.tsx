import Link from "next/link";
import type { AlertCard } from "@/lib/iq/overview";
import { cn } from "@/lib/utils";

/**
 * "Needs attention" as cause-and-action cards. The cards themselves come
 * from `attentionCards()` — rules over measured numbers, never free text —
 * so this file only lays them out. NOW and TODAY carry the alert red; THIS
 * WEEK and SETUP the warning amber; the tints are the status tokens already
 * in MASTER.md §5.
 */
export function AttentionCards({ cards }: { cards: readonly AlertCard[] }) {
  if (cards.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-border bg-surface px-6 py-8 text-center text-sm text-muted-foreground">
        Nothing needs attention.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
      {cards.map((card) => {
        const urgent = card.level === "NOW" || card.level === "TODAY";
        return (
          <article
            key={card.id}
            className={cn("flex flex-col gap-3 rounded-[14px] border border-border border-t-[3px] bg-surface px-5 py-5", urgent ? "border-t-destructive" : "border-t-warning")}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-semibold leading-[1.3]">{card.title}</h3>
                <p className="text-[13px] text-muted-foreground">{card.evidence}</p>
              </div>
              <span className={cn("whitespace-nowrap rounded-[5px] px-2 py-[3px] text-[11px] font-semibold tracking-[0.08em]", urgent ? "bg-status-new text-status-new-fg" : "bg-status-cooking text-status-cooking-fg")}>
                {card.level}
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm leading-[1.45]">
              <dt className="whitespace-nowrap text-muted-foreground">{card.causeLabel}</dt>
              <dd>{card.cause}</dd>
              <dt className="whitespace-nowrap text-muted-foreground">Do next</dt>
              <dd className="font-medium">{card.action}</dd>
            </dl>
            <div className="mt-0.5 flex flex-wrap gap-2">
              <Link href={card.primary.href} className="inline-flex min-h-[36px] items-center rounded-[7px] bg-foreground px-3 text-[13px] font-semibold text-background">
                {card.primary.label}
              </Link>
              <Link href={card.secondary.href} className="inline-flex min-h-[36px] items-center rounded-[7px] border border-border px-3 text-[13px] font-semibold">
                {card.secondary.label}
              </Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}
