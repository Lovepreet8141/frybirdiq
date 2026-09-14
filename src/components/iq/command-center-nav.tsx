import Link from "next/link";
import { cn } from "@/lib/utils";

export type CommandCenterSection = "overview" | "live" | "activity" | "alerts" | "brief";

const SECTIONS: readonly { readonly key: CommandCenterSection; readonly label: string; readonly href: string }[] = [
  { key: "overview", label: "Overview", href: "/app/iq" },
  { key: "live", label: "Live operations", href: "/app/iq/live" },
  { key: "activity", label: "Activity", href: "/app/iq/activity" },
  { key: "alerts", label: "Alerts", href: "/app/iq/alerts" },
  { key: "brief", label: "AI brief", href: "/app/iq/brief" },
];

/** The strip the Command Center screens share. Routes, not client tabs; every one sits behind `analytics.view`. */
export function CommandCenterNav({ current, alertCount }: { current: CommandCenterSection; alertCount?: number }) {
  return (
    <nav aria-label="Command Center" className="-mb-px flex max-w-full gap-1 overflow-x-auto border-b border-border">
      {SECTIONS.map((section) => {
        const active = section.key === current;
        const badge = section.key === "alerts" && alertCount !== undefined && alertCount > 0;
        return (
          <Link
            key={section.key}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[13.5px] transition-colors duration-[120ms]",
              active ? "border-primary font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {section.label}
            {badge && <span className="tabular flex h-5 min-w-5 items-center justify-center rounded-full bg-loss-soft px-1.5 text-[11px] font-semibold text-loss">{alertCount}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
