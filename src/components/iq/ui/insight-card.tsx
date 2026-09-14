import Link from "next/link";
import type { ReactNode } from "react";
import type { SignalTone } from "./signals";
import { cn } from "@/lib/utils";

/**
 * "Needs your attention", one finding per card: a dot for the tone, the
 * finding in one line, the evidence under it, the rupee impact or the
 * cause in bold, then the action (ink) and a quiet Skip or secondary. Every
 * card is built from measured data by the caller; this only lays it out.
 */
export interface InsightCardProps {
  readonly tone: SignalTone;
  readonly title: string;
  readonly evidence?: ReactNode;
  /** The line the eye lands on: "Costing you ₹31,000 this month." or the likely cause. */
  readonly impact?: ReactNode;
  readonly impactLabel?: string;
  readonly action?: ReactNode;
  readonly primary?: { readonly label: string; readonly href: string };
  readonly secondary?: { readonly label: string; readonly href: string };
  readonly level?: string;
  readonly className?: string;
}

const DOT: Record<SignalTone, string> = { gain: "bg-gain", loss: "bg-loss", flag: "bg-flag", neutral: "bg-muted-foreground/60" };

export function InsightCard({ tone, title, evidence, impact, impactLabel, action, primary, secondary, level, className }: InsightCardProps) {
  return (
    <article className={cn("flex flex-col gap-2.5 rounded-lg border border-border bg-surface-muted/60 px-4 py-4", className)}>
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-[7px] size-[7px] shrink-0 rounded-full", DOT[tone])} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-[15px] font-semibold leading-[1.3]">{title}</h3>
            {level && <span className="shrink-0 rounded-[5px] bg-muted px-1.5 py-[2px] text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground">{level}</span>}
          </div>
          {evidence && <p className="mt-1 text-[13px] leading-[1.45] text-muted-foreground">{evidence}</p>}
          {impact && (
            <p className="mt-1.5 text-[13.5px] leading-[1.45]">
              {impactLabel && <span className="text-muted-foreground">{impactLabel} </span>}
              <span className="font-semibold">{impact}</span>
            </p>
          )}
          {action && (
            <p className="mt-1 text-[13px] leading-[1.45]">
              <span className="text-muted-foreground">Do next </span>
              {action}
            </p>
          )}
        </div>
      </div>
      {(primary || secondary) && (
        <div className="flex flex-wrap gap-2 pl-[17px]">
          {primary && (
            <Link href={primary.href} className="inline-flex min-h-[36px] items-center rounded-md bg-inverse px-3 text-[13px] font-semibold text-inverse-foreground transition-colors hover:bg-inverse/85">
              {primary.label}
            </Link>
          )}
          {secondary && (
            <Link href={secondary.href} className="inline-flex min-h-[36px] items-center rounded-md border border-border bg-panel px-3 text-[13px] font-semibold transition-colors hover:border-border-strong">
              {secondary.label}
            </Link>
          )}
        </div>
      )}
    </article>
  );
}
