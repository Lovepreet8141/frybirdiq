import { DeltaChip, type SignalTone } from "@/components/iq/ui";
import type { Badge, BadgeLabel } from "@/lib/iq/engine/present";

/**
 * One tone per label, not per claim type: `present()` already picks the
 * exact label an AUTOMATION insight gets ("Done automatically" vs "Waiting
 * approval" — same claimType, different meaning), so the label is the
 * precise thing to key off. Exported so `PresentationCard` (insight-card.tsx)
 * can tint the rest of the card the same way as its own badge.
 */
export const TONE_BY_BADGE_LABEL: Record<BadgeLabel, SignalTone> = {
  Fact: "neutral",
  Detected: "flag",
  Forecast: "neutral",
  Why: "neutral",
  Suggested: "gain",
  "Done automatically": "gain",
  "Waiting approval": "flag",
};

/** The pill every insight card carries — "Fact", "Detected", "Forecast" … — fixed by the claim type, never chosen by a caller. */
export function ClaimBadge({ badge }: { badge: Badge }) {
  return <DeltaChip tone={TONE_BY_BADGE_LABEL[badge.label]}>{badge.label}</DeltaChip>;
}
