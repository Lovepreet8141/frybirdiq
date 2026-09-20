import type { Metadata } from "next";
import { CommandCenterNav } from "@/components/iq/command-center-nav";
import { DataTrust, Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { ReadinessPanel } from "@/components/iq/readiness-panel";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { addDays, businessDate } from "@/lib/dates";
import { viewerFor } from "@/lib/iq/engine";
import { SEVERITY_WORD, briefSections } from "@/lib/iq/brief/brief-view";
import { composeBrief, parityFromSummary } from "@/lib/iq/brief/compose";
import { readinessBriefLine } from "@/lib/iq/readiness/scores";
import { loadBriefInsightsFor } from "@/lib/repositories/iq-insights";
import { readBriefRunState } from "@/lib/repositories/iq-job-runs";
import { getReadiness } from "@/lib/repositories/iq-readiness";

export const metadata: Metadata = { title: "Daily brief", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * COMMAND CENTER › Daily brief. Yesterday's figures and the checks' findings,
 * composed at read time from stored insights (IQ-2 R2.10) and never written by
 * hand: every line cites stored rows, a number the checks did not store is not
 * shown, and when the day's figures are not finalised the page says so instead
 * of guessing. Payment-ledger findings stay behind finance.view. Above it, the
 * readiness line and panel: how complete the records behind the brief are.
 */
export default async function DailyBriefPage() {
  const staff = await requireStaff();
  if (!(await staffCan("analytics.view"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view the daily brief" />
      </div>
    );
  }

  const now = new Date();
  const date = addDays(businessDate(now), -1);
  const viewer = viewerFor(staff.roles);
  const [readiness, stored, runState] = await Promise.all([
    getReadiness(staff.orgId, now),
    loadBriefInsightsFor(staff.orgId, viewer, date),
    readBriefRunState(staff.orgId, date),
  ]);
  const brief = composeBrief({
    date,
    readAt: now,
    viewer,
    insights: stored.insights,
    checks: runState.checks,
    parity: parityFromSummary(runState.factsSummary),
    detectSummary: runState.detectSummary,
  });
  const sections = briefSections(brief);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader title="Daily brief" description="Yesterday in plain words, and what the checks found. Every line comes from stored records; nothing here is a forecast or a guess." />
      <CommandCenterNav current="brief" />

      <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm" data-brief-readiness="">
        {readinessBriefLine(readiness)}
      </p>

      <Panel data-daily-brief={brief.state}>
        <PanelHeader title={`Brief for ${brief.date}`} description={brief.asOf.text} />
        <PanelBody className="flex flex-col gap-5 pt-0">
          {brief.notReady && (
            <p role="status" className="rounded-lg border border-border border-l-4 border-l-flag bg-surface px-4 py-3 text-sm">
              {brief.notReady.text}
            </p>
          )}
          {sections.map((section) => (
            <section key={section.id} aria-labelledby={`brief-${section.id}`} className="flex flex-col gap-2">
              <div>
                <h2 id={`brief-${section.id}`} className="text-base font-semibold">
                  {section.heading}
                </h2>
                {section.subline && <p className="text-[13px] text-muted-foreground">{section.subline}</p>}
              </div>
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {section.lines.map((row) => (
                  <li key={row.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                    {row.severity !== null && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{SEVERITY_WORD[row.severity]}</span>}
                    <span className="min-w-0 flex-1 break-words">{row.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </PanelBody>
      </Panel>

      <ReadinessPanel readiness={readiness} />

      <DataTrust
        items={[
          { tone: stored.dropped === 0 ? "gain" : "flag", text: stored.dropped === 0 ? "Every stored finding passed its checks" : `${stored.dropped} stored finding(s) failed their checks and were left out` },
          { tone: "neutral", text: "Payment checks are shown to finance roles only" },
        ]}
      />
    </div>
  );
}
