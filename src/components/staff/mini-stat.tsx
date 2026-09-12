import { Card, CardContent } from "@/components/ui/card";

/** A single labelled figure in a card — no delta, no comparison. For a screen's headline numbers where `StatTile`'s vs-yesterday framing doesn't apply. */
export function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
        <p className="tabular font-heading text-2xl font-bold">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
