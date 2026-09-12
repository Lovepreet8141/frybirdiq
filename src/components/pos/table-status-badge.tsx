import { Badge } from "@/components/ui/badge";

/**
 * Available vs occupied, from FRYBIRD's own semantic tokens — not the
 * reference kit's literal green/blue/red Tailwind classes. Occupied uses the
 * same muted destructive treatment as everywhere else status colour appears
 * on this surface (red is reserved for urgency/loss, not decoration), so a
 * full table reads as "in use", not as an error.
 */
export function TableStatusBadge({ occupied }: { occupied: boolean }) {
  return occupied ? (
    <Badge variant="destructive">Occupied</Badge>
  ) : (
    <Badge className="bg-success text-success-foreground">Available</Badge>
  );
}
