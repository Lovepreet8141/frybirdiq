import { menuSource } from "@/lib/repositories/menu";

/**
 * Says out loud when the site is not reading from the database.
 *
 * §70 rule 20 forbids mock data in a production path unless it is explicitly
 * marked. The menu here is not mock — it is the real transcription of the
 * printed boards — but it is not the database either, and orders cannot be
 * placed without one. Saying so beats a site that looks live and silently
 * cannot take an order.
 *
 * Renders nothing once Supabase is configured.
 */
export function PreviewNotice() {
  if (menuSource() === "database") return null;

  return (
    <div role="status" className="border-b border-border bg-surface-muted">
      <p className="mx-auto w-full max-w-6xl px-[var(--gutter)] py-2.5 text-xs leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Preview.</span> The menu below is FRYBIRD&rsquo;s real menu,
        read from the printed boards. The database is not connected yet, so orders cannot be placed.
      </p>
    </div>
  );
}
