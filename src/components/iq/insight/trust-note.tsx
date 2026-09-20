import { StatusWord, type SignalTone } from "@/components/iq/ui";
import type { TrustNote as TrustNoteData } from "@/lib/iq/engine/present";

const TONE_BY_STATE: Record<TrustNoteData["state"], SignalTone> = {
  MEASURED: "neutral",
  NOT_MEASURED: "flag",
  INSUFFICIENT_DATA: "flag",
};

/**
 * The one line every insight carries about how much to trust it — "Data
 * trust 82/100", "not enough data to measure trust". Text only, never a
 * number this component invents: `trust.text` already came out of
 * `present()` from the stored trust grade.
 */
export function TrustNote({ trust }: { trust: TrustNoteData }) {
  return <StatusWord tone={TONE_BY_STATE[trust.state]}>{trust.text}</StatusWord>;
}
