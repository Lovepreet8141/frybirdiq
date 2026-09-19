import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { CommandCenterNav } from "@/components/iq/command-center-nav";
import { type Capability, CapabilityPanel, DataTrust, Panel, PanelBody, PanelHeader, StatusWord } from "@/components/iq/ui";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ReadinessPanel } from "@/components/iq/readiness-panel";
import { requireStaff, staffCan } from "@/lib/auth";
import { readinessBriefLine } from "@/lib/iq/readiness/scores";
import { getReadiness } from "@/lib/repositories/iq-readiness";

export const metadata: Metadata = { title: "AI brief", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * COMMAND CENTER › AI brief — the foundation only. BUILD-PLAN.md §33: the
 * AI never invents a number; prices, availability, hours and order status
 * come from stored rows through server-side tools, and it says so when
 * the data is missing. Nothing here calls a model: there is no tool layer
 * yet, so there is no brief to show and no box to type into.
 */
export default async function AiBriefPage() {
  const staff = await requireStaff();
  if (!(await staffCan("analytics.view"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view the AI brief" />
      </div>
    );
  }

  const readiness = await getReadiness(staff.orgId);
  const keyConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
  const items: readonly Capability[] = [
    { name: "Conversation and tool-call tables", connected: true, note: "ai_conversations and ai_tool_calls exist in the schema; nothing writes to them yet" },
    { name: "Model API key on the server", connected: keyConfigured, note: keyConfigured ? "ANTHROPIC_API_KEY is set; it is never sent to the browser" : "ANTHROPIC_API_KEY is not set on the server" },
    { name: "Server-side tools over the repositories", connected: false, note: "Read-only tools first — sales, orders, menu, costs — each answering from stored rows" },
    { name: "Daily brief", connected: false, note: "A morning summary of yesterday and what needs attention, built only from tool results" },
    { name: "Ask FRYBIRD", connected: false, note: "Questions in plain words, after the Daily brief has proven the tools" },
  ];
  const connected = items.filter((item) => item.connected).length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader title="AI brief" description="A morning brief and a place to ask questions — built on stored rows, never on guesses. Not connected yet; this page says what it will read and what is missing." />
      <CommandCenterNav current="brief" />

      {/* The brief's one live line so far: readiness and the one action, counted from stored records. */}
      <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm" data-brief-readiness="">
        {readinessBriefLine(readiness)}
      </p>
      <ReadinessPanel readiness={readiness} />

      <DataTrust items={[{ tone: "flag", text: `Not connected · ${connected} of ${items.length} prerequisites in place` }, { tone: "neutral", text: "Roadmap Phase 11 — tool layer first, read-only tools only, Daily brief before Ask FRYBIRD" }]} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader
            title={
              <span className="inline-flex items-center gap-2">
                <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
                Today&apos;s brief
              </span>
            }
            meta={<StatusWord tone="flag">Not connected</StatusWord>}
          />
          <PanelBody className="pt-0">
            <div className="rounded-lg border border-dashed border-border-strong/70 bg-surface-muted/40 px-5 py-10 text-center">
              <p className="font-heading text-[15px] font-semibold">No brief has been written</p>
              <p className="mx-auto mt-1 max-w-md text-[13px] leading-[1.5] text-muted-foreground">When connected, the brief will summarise yesterday&apos;s revenue and orders against the comparison you choose, what is late or unsettled right now, food cost against target, and what has stopped selling — every figure traced to the screen it came from.</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href="/app/iq/alerts">What needs attention today</Link>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/app/iq">Overview</Link>
                </Button>
              </div>
            </div>
            <p className="mt-3 text-[12.5px] text-muted-foreground">Until then, the Overview and Alerts screens are the same facts without the prose.</p>
          </PanelBody>
        </Panel>
        <CapabilityPanel title="What it needs" items={items} />
      </div>

      <Panel>
        <PanelHeader title="What it will be allowed to read" description="Each source is a server-side tool over an existing repository. The model sees tool results, never the database." />
        <PanelBody className="pt-0">
          <ul className="grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
            {["Revenue, orders and average order over a range, with the same comparison rules as Overview", "What is in the kitchen, late, or awaiting a decision right now", "Captured payments by method, refunds, provider fees", "Recorded expenses and the month's profit and loss", "Menu items, availability, prices — as the website shows them", "Which products sold and which did not"].map((line) => (
              <li key={line} className="flex gap-2">
                <span className="mt-[7px] size-[5px] shrink-0 rounded-full bg-muted-foreground/60" aria-hidden="true" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </PanelBody>
      </Panel>
    </div>
  );
}
