import { Card, CardContent } from "@/components/ui/card";

/** A single labelled figure in a card — no delta, no comparison. For a screen's headline numbers where `StatTile`'s vs-yesterday framing doesn't apply. */
/** The serif is for figures. A name ("OG Frybird Classic", "Cash") stays in the interface face, a size down. */
const isFigure = (value: string) => /^[₹\d\-—–+]/.test(value.trim());

export function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1.5">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        <p className={isFigure(value) ? "tabular font-money text-[30px] leading-none tracking-[-0.01em]" : "truncate font-heading text-[22px] font-semibold leading-tight tracking-[-0.01em]"}>{value}</p>
        {hint && <p className="text-[12.5px] leading-[1.4] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
