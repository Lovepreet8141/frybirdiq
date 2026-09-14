import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The panel every IQ screen is built from: a 14/600 title, a quiet meta
 * line or an action on the right, and the body. Sections that hold several
 * panels use `SectionHeading` above them. Same shape on every screen, so
 * the eye learns it once.
 */
export function Panel({ children, className, as: Tag = "section", ...props }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cn("flex flex-col rounded-xl border border-border bg-panel", className)} {...props}>
      {children}
    </Tag>
  );
}

export function PanelHeader({ title, description, meta, action, className, id }: { title: ReactNode; description?: ReactNode; meta?: ReactNode; action?: ReactNode; className?: string; id?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 pt-4 pb-3", className)}>
      <div className="min-w-0">
        <h3 id={id} className="font-heading text-sm font-semibold leading-snug tracking-[-0.005em]">
          {title}
        </h3>
        {description && <p className="mt-0.5 text-[13px] leading-[1.45] text-muted-foreground">{description}</p>}
      </div>
      {(meta || action) && <div className="flex shrink-0 items-center gap-2 text-[13px] text-muted-foreground">{action ?? meta}</div>}
    </div>
  );
}

export function PanelBody({ children, className, flush = false }: { children: ReactNode; className?: string; /** No side padding — for tables and lists that draw their own rows. */ flush?: boolean }) {
  return <div className={cn("flex-1", flush ? "pb-2" : "px-5 pb-5", className)}>{children}</div>;
}

export function PanelFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-[13px] text-muted-foreground", className)}>{children}</div>;
}

/** "Right now — Click a tile…" with an optional link on the right. Sits above a row of panels or tiles. */
export function SectionHeading({ id, title, note, action, className }: { id?: string; title: ReactNode; note?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1", className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={id} className="font-heading text-xl font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        {note && <span className="text-[13px] text-muted-foreground">{note}</span>}
      </div>
      {action && <div className="text-[13px] font-semibold">{action}</div>}
    </div>
  );
}
