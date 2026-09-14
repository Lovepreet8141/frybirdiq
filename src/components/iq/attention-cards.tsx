import { InsightCard } from "@/components/iq/ui";
import type { AlertCard } from "@/lib/iq/overview";

/**
 * "Needs your attention" as findings. The cards themselves come from
 * `attentionCards()` — rules over measured numbers, never free text — so
 * this file only lays them out: a dot for the tone (loss for NOW and
 * TODAY, flag for THIS WEEK and SETUP), the finding, the evidence, the
 * likely cause in bold, the action, and two buttons.
 */
export function AttentionCards({ cards }: { cards: readonly AlertCard[] }) {
  if (cards.length === 0) {
    return <p className="rounded-lg border border-dashed border-border-strong/70 bg-surface-muted/40 px-5 py-8 text-center text-[13px] text-muted-foreground">Nothing needs attention right now.</p>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {cards.map((card) => {
        const urgent = card.level === "NOW" || card.level === "TODAY";
        return (
          <InsightCard
            key={card.id}
            tone={urgent ? "loss" : "flag"}
            level={card.level}
            title={card.title}
            evidence={card.evidence}
            impactLabel={card.causeLabel}
            impact={card.cause}
            action={card.action}
            primary={card.primary}
            secondary={card.secondary}
          />
        );
      })}
    </div>
  );
}
