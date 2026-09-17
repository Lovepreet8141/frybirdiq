import { InsightCard as AttentionLayout, type SignalTone } from "@/components/iq/ui";
import { EmptyState } from "@/components/states";
import { BUSINESS_TIMEZONE } from "@/lib/dates";
import type { Presentation } from "@/lib/iq/engine/present";
import type { InsightsForViewer, PresentedInsight } from "@/lib/repositories/iq-insights";
import { ClaimBadge, TONE_BY_BADGE_LABEL } from "./claim-badge";
import { TrustNote } from "./trust-note";

const asOfFormat = new Intl.DateTimeFormat("en-IN", { timeZone: BUSINESS_TIMEZONE, dateStyle: "medium", timeStyle: "short" });

/** "sales.below_weekday_baseline" -> "Sales below weekday baseline". The only identifier every kind is guaranteed to carry is `copy.templateId`; FACT and DETECTION have a more precise one (metricId/ruleId) and use it instead. */
export function humanize(id: string): string {
  const words = id.replace(/[._-]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const SEVERITY_LABEL: Record<1 | 2 | 3, string> = { 1: "NOTE", 2: "CHECK", 3: "URGENT" };

/**
 * Severity is how much attention a finding deserves, not whether it is good
 * or bad news — `above_weekday_baseline` and `below_weekday_baseline` are
 * both DETECTIONs and neither carries a direction flag in the contract, so
 * tone is keyed on severity alone rather than guessing a rule's valence.
 */
const SEVERITY_TONE: Record<1 | 2 | 3, SignalTone> = { 1: "neutral", 2: "flag", 3: "loss" };

export type CardShape = { readonly tone: SignalTone; readonly title: string; readonly evidence?: string; readonly impact?: string; readonly impactLabel?: string; readonly level?: string };

/** Pure mapping from a `Presentation` to what the layout needs — no JSX, so it is exercised directly rather than through a render (this suite has no DOM environment). */
export function forPresentation(p: Presentation): CardShape {
  switch (p.kind) {
    case "FACT":
      return { tone: "neutral", title: humanize(p.metricId), impact: p.figure.text };
    case "DETECTION":
      return {
        tone: SEVERITY_TONE[p.severity],
        title: humanize(p.ruleId),
        impact: p.observed.text,
        impactLabel: "Observed",
        evidence: `Usual ${p.baseline.text} · ${p.deviation}`,
        level: SEVERITY_LABEL[p.severity],
      };
    case "FORECAST":
      return { tone: "neutral", title: humanize(p.copy.templateId), impact: p.range.text, impactLabel: `${p.range.coverage}, next ${p.horizonDays}d` };
    case "EXPLANATION":
      // Drivers summing to the total, with the residual, is what makes this
      // an explanation rather than a repeat of the total (UX-ARCHITECTURE,
      // DESIGN.md line 40): every driver renders, never just the residual.
      return {
        tone: "neutral",
        title: humanize(p.copy.templateId),
        impact: p.total.text,
        evidence: [...p.drivers.map((driver) => `${humanize(driver.driverId)}: ${driver.contribution.text}`), `Residual ${p.residual}`].join(" · "),
      };
    case "RECOMMENDATION":
      return { tone: "gain", title: humanize(p.copy.templateId), impact: `${p.impact.low} – ${p.impact.high}`, impactLabel: "Estimated impact" };
    case "AUTOMATION":
      return { tone: TONE_BY_BADGE_LABEL[p.badge.label], title: humanize(p.copy.templateId) };
  }
}

/** One insight, in whichever of the six `Presentation` kinds `present()` produced, plus when it was true as of. */
export function PresentationCard({ item }: { item: PresentedInsight }) {
  const { presentation } = item;
  const shape = forPresentation(presentation);
  return (
    <AttentionLayout
      tone={shape.tone}
      title={shape.title}
      level={shape.level}
      impact={shape.impact}
      impactLabel={shape.impactLabel}
      evidence={
        <span className="flex flex-col gap-1">
          {shape.evidence && <span>{shape.evidence}</span>}
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ClaimBadge badge={presentation.badge} />
            <TrustNote trust={presentation.trust} />
          </span>
          <span className="text-[12px] text-muted-foreground">As of {asOfFormat.format(item.asOf)}</span>
        </span>
      }
    />
  );
}

/**
 * The whole collection `loadInsightsFor`/`presentFor` hand back — restricted,
 * empty, or a list of cards. The one thing a brief or alerts page should
 * need to call to go from that read straight to the screen.
 */
export function InsightList({
  result,
  emptyTitle = "No findings for this period",
  emptyDetail,
}: {
  result: InsightsForViewer;
  emptyTitle?: string;
  emptyDetail?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {result.restricted && (
        <p className="rounded-md border border-dashed border-border-strong px-3 py-2 text-[13px] text-muted-foreground">
          Some findings are restricted to Finance and above.
        </p>
      )}
      {result.items.length === 0 ? (
        <EmptyState title={emptyTitle} detail={emptyDetail} />
      ) : (
        <ul className="flex flex-col gap-3">
          {result.items.map((item) => (
            <li key={item.presentation.insightId}>
              <PresentationCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
